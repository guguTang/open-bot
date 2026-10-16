#![cfg_attr(not(target_os = "macos"), allow(dead_code))]
//! First-class desktop input for the host bridge.
//!
//! Screenshot pixels and later clicks share one frame: the model sends image
//! coordinates from `host_screenshot` (`width` × `height`, origin top-left)
//! plus that `frame_id`. The host converts them with the display bounds stored
//! for the frame. `scale` is informational — callers must not multiply
//! coordinates by it or add `origin`.
//!
//! macOS posts through CoreGraphics and reads AX. Windows uses GDI, SendInput,
//! and UI Automation. Linux uses the X11 protocol (RandR, GetImage, XTest) and
//! AT-SPI. Tool names stay the same; only the backend changes.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

const FRAME_TTL_MS: u64 = 180_000;
const FRAME_TTL_SEC: u64 = 180;
const MAX_FRAMES: usize = 8;
const MAX_ELEMENTS: usize = 400;
const MAX_TYPE_CHARS: usize = 2000;
const COORD_SLOP: f64 = 2.0;

const FLAG_SHIFT: u64 = 1 << 17;
const FLAG_CONTROL: u64 = 1 << 18;
const FLAG_OPTION: u64 = 1 << 19;
const FLAG_COMMAND: u64 = 1 << 20;

pub const ACCESSIBILITY_DENIED_MSG: &str = "没有辅助功能权限。请到「系统设置 → 隐私与安全性 → 辅助功能」允许已安装的 Open Bot，然后重试。请打开 DMG 或「应用程序」里的 Open Bot，不要直接运行 Contents/MacOS 里的二进制。桌面设置里也可以打开这一页。";
pub const EVENT_POSTING_DENIED_MSG: &str = "没有发送事件权限。请到「系统设置 → 隐私与安全性 → 辅助功能」允许已安装的 Open Bot 发送事件，然后重试。桌面设置里也可以打开这一页。若系统列出「输入监控」或「事件发布」，也允许 Open Bot。若系统弹出单独的发送事件提示，请点允许。";
const STALE_FRAME_MSG: &str = "画面已过期或 frame_id 对不上。请重新截取屏幕，用新的 frame_id 再操作。不要沿用旧坐标。";
const MISSING_FRAME_MSG: &str = "需要最近一次截图的 frame_id。先截取屏幕，再把返回的 frame_id 和图像像素坐标传进来。";
#[cfg(any(target_os = "linux", test))]
pub const LINUX_SCREEN_DENIED_MSG: &str = "无法截取屏幕。Linux 桌面操控使用 X11（含 XWayland 的 DISPLAY），不使用 xdotool 或 grim。请确认 DISPLAY 可用。Wayland 原生若没有 XWayland 目前不能截屏。";
#[cfg(any(target_os = "linux", test))]
pub const LINUX_ACCESSIBILITY_DENIED_MSG: &str = "没有辅助功能。请安装 at-spi2-core（libatspi），并打开辅助功能（GNOME：设置 → 辅助功能）。";
#[cfg(any(target_os = "linux", test))]
pub const LINUX_EVENT_POSTING_DENIED_MSG: &str = "无法发送键鼠。主路径是 X11 的 XTest，不使用 xdotool。请确认 XTest 扩展可用。Wayland 原生若没有 XWayland 目前不能发送键鼠。";
#[cfg(any(target_os = "windows", test))]
pub const WIN_SCREEN_DENIED_MSG: &str = "无法截取屏幕。请确认 Open Bot 在已登录的交互桌面（不是服务或锁屏安全桌面）。没有单独的屏幕录制开关。";
#[cfg(any(target_os = "windows", test))]
pub const WIN_ACCESSIBILITY_DENIED_MSG: &str = "无法读取 UI Automation。权限级别需与目标窗口一致（管理员窗口要管理员启动 Open Bot）。";
#[cfg(any(target_os = "windows", test))]
pub const WIN_EVENT_POSTING_DENIED_MSG: &str = "无法发送键鼠。请在已解锁的交互桌面运行 Open Bot，不要以服务运行。UIPI 会拦住对管理员窗口的输入。";
const FRAME_NOT_ACTIONABLE_MSG: &str =
    "这张图不能用来点击（全部屏幕，或缺少显示器尺寸）。请用主屏幕或指定一个显示器重新截一张单屏图。";
const COORD_OUT_MSG: &str = "坐标超出这张截图的宽高。请按图像像素重新估计，不要乘 scale，也不要加上 origin。";
#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
const UNSUPPORTED_MSG: &str = "当前系统暂不支持桌面操控（需要 macOS、Windows 或 Linux 桌面端）";
const STALE_ELEMENT_MSG: &str = "界面元素已过期。请重新查看界面元素，用新的 element_ref。";
const ELEMENT_NOT_CLICKABLE_MSG: &str =
    "这个元素没有可用的位置或大小。请改用截图坐标点击，或重新查看界面元素。";

fn cu_error(code: &str, error: &str) -> Value {
    json!({ "ok": false, "error": error, "code": code })
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn unsupported() -> Value {
    cu_error("unsupported_platform", UNSUPPORTED_MSG)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn frame_is_fresh(created_ms: u64, now: u64) -> bool {
    now.saturating_sub(created_ms) <= FRAME_TTL_MS
}

static SEQ: AtomicU64 = AtomicU64::new(1);

fn new_id(prefix: char) -> String {
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}{:x}{n:x}", now_ms())
}

#[derive(Clone, Debug)]
struct DisplayGeom {
    image_width: u32,
    image_height: u32,
    origin_x: f64,
    origin_y: f64,
    width_pt: f64,
    height_pt: f64,
    scale: f64,
    actionable: bool,
}

impl DisplayGeom {
    fn inert(image_width: u32, image_height: u32) -> Self {
        Self {
            image_width,
            image_height,
            origin_x: 0.0,
            origin_y: 0.0,
            width_pt: 0.0,
            height_pt: 0.0,
            scale: 1.0,
            actionable: false,
        }
    }
}

#[derive(Debug, PartialEq)]
enum PointMapError {
    NotActionable,
    OutOfFrame,
    BadFrame,
}

fn map_image_point(geom: &DisplayGeom, x: f64, y: f64) -> Result<(f64, f64), PointMapError> {
    if !geom.actionable {
        return Err(PointMapError::NotActionable);
    }
    if geom.image_width == 0
        || geom.image_height == 0
        || !(geom.width_pt.is_finite() && geom.width_pt > 1.0)
        || !(geom.height_pt.is_finite() && geom.height_pt > 1.0)
    {
        return Err(PointMapError::BadFrame);
    }
    if !x.is_finite() || !y.is_finite() {
        return Err(PointMapError::OutOfFrame);
    }
    let max_x = geom.image_width as f64;
    let max_y = geom.image_height as f64;
    if x < -COORD_SLOP || y < -COORD_SLOP || x > max_x + COORD_SLOP || y > max_y + COORD_SLOP {
        return Err(PointMapError::OutOfFrame);
    }
    let x = x.clamp(0.0, max_x);
    let y = y.clamp(0.0, max_y);
    let sx = geom.origin_x + (x / max_x) * geom.width_pt;
    let sy = geom.origin_y + (y / max_y) * geom.height_pt;
    Ok((sx, sy))
}

fn screen_rect_to_image(
    geom: &DisplayGeom,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Option<(f64, f64, f64, f64)> {
    if !geom.actionable || geom.width_pt <= 1.0 || geom.height_pt <= 1.0 || geom.image_width == 0 {
        return None;
    }
    let cx = x + w / 2.0;
    let cy = y + h / 2.0;
    if cx < geom.origin_x
        || cy < geom.origin_y
        || cx > geom.origin_x + geom.width_pt
        || cy > geom.origin_y + geom.height_pt
    {
        return None;
    }
    let sx = (x - geom.origin_x) / geom.width_pt * geom.image_width as f64;
    let sy = (y - geom.origin_y) / geom.height_pt * geom.image_height as f64;
    let sw = w / geom.width_pt * geom.image_width as f64;
    let sh = h / geom.height_pt * geom.image_height as f64;
    Some((sx, sy, sw, sh))
}

fn point_error(err: PointMapError) -> Value {
    match err {
        PointMapError::NotActionable | PointMapError::BadFrame => {
            cu_error("frame_not_actionable", FRAME_NOT_ACTIONABLE_MSG)
        }
        PointMapError::OutOfFrame => cu_error("coord_out_of_frame", COORD_OUT_MSG),
    }
}

struct StoredFrame {
    id: String,
    created_ms: u64,
    geom: DisplayGeom,
}

static FRAMES: Mutex<Vec<StoredFrame>> = Mutex::new(Vec::new());

fn lock_frames() -> std::sync::MutexGuard<'static, Vec<StoredFrame>> {
    FRAMES.lock().unwrap_or_else(|e| e.into_inner())
}

fn remember_frame(geom: DisplayGeom) -> (String, u64) {
    let id = new_id('f');
    let created = now_ms();
    let mut frames = lock_frames();
    frames.retain(|f| frame_is_fresh(f.created_ms, created));
    frames.push(StoredFrame {
        id: id.clone(),
        created_ms: created,
        geom,
    });
    if frames.len() > MAX_FRAMES {
        let drop_n = frames.len() - MAX_FRAMES;
        frames.drain(0..drop_n);
    }
    (id, created)
}

fn lookup_frame(id: &str) -> Result<DisplayGeom, ()> {
    let id = id.trim();
    if id.is_empty() {
        return Err(());
    }
    let now = now_ms();
    let frames = lock_frames();
    match frames.iter().find(|f| f.id == id) {
        Some(f) if frame_is_fresh(f.created_ms, now) => Ok(f.geom.clone()),
        _ => Err(()),
    }
}

fn load_frame(id: &str) -> Result<DisplayGeom, Value> {
    let id = id.trim();
    if id.is_empty() {
        return Err(cu_error("missing_frame", MISSING_FRAME_MSG));
    }
    lookup_frame(id).map_err(|_| cu_error("stale_frame", STALE_FRAME_MSG))
}

#[derive(Clone, Debug)]
struct ElementGeom {
    pid: i32,
    x_pt: f64,
    y_pt: f64,
    w_pt: f64,
    h_pt: f64,
}

struct StoredElement {
    id: String,
    created_ms: u64,
    geom: ElementGeom,
}

static ELEMENTS: Mutex<Vec<StoredElement>> = Mutex::new(Vec::new());

fn remember_element(geom: ElementGeom) -> String {
    let id = new_id('e');
    let created = now_ms();
    let mut rows = ELEMENTS.lock().unwrap_or_else(|e| e.into_inner());
    rows.retain(|e| frame_is_fresh(e.created_ms, created));
    rows.push(StoredElement {
        id: id.clone(),
        created_ms: created,
        geom,
    });
    if rows.len() > MAX_ELEMENTS {
        let drop_n = rows.len() - MAX_ELEMENTS;
        rows.drain(0..drop_n);
    }
    id
}

fn lookup_element(id: &str) -> Result<ElementGeom, Value> {
    let id = id.trim();
    if id.is_empty() {
        return Err(cu_error("stale_element", STALE_ELEMENT_MSG));
    }
    let now = now_ms();
    let rows = ELEMENTS.lock().unwrap_or_else(|e| e.into_inner());
    match rows.iter().find(|e| e.id == id) {
        Some(e) if frame_is_fresh(e.created_ms, now) => Ok(e.geom.clone()),
        _ => Err(cu_error("stale_element", STALE_ELEMENT_MSG)),
    }
}

pub struct FrameMeta {
    pub frame_id: String,
    pub scale: f64,
    pub actionable: bool,
    pub expires_in_sec: u64,
    pub origin_x: f64,
    pub origin_y: f64,
    pub width_pt: f64,
    pub height_pt: f64,
}

fn finite(n: f64, fallback: f64) -> f64 {
    if n.is_finite() { n } else { fallback }
}

/// Record the screenshot the model is about to see. `scope` is `main`, `display`, `all`, or `window`.
/// Pass `window_bounds` as (origin_x, origin_y, width_pt, height_pt) for `scope=window`.
pub fn bind_screenshot_frame(
    scope: &str,
    display: Option<u32>,
    image_w: Option<u32>,
    image_h: Option<u32>,
) -> FrameMeta {
    bind_screenshot_frame_at(scope, display, image_w, image_h, None)
}

/// Like [`bind_screenshot_frame`], but binds a window origin when `window_bounds` is set.
pub fn bind_screenshot_frame_at(
    scope: &str,
    display: Option<u32>,
    image_w: Option<u32>,
    image_h: Option<u32>,
    window_bounds: Option<(f64, f64, f64, f64)>,
) -> FrameMeta {
    let (iw, ih) = match (image_w, image_h) {
        (Some(w), Some(h)) if w > 0 && h > 0 => (w, h),
        _ => (0, 0),
    };
    let geom = if let Some((ox, oy, wp, hp)) = window_bounds {
        let actionable = iw > 0 && ih > 0 && wp > 1.0 && hp > 1.0;
        let scale = if actionable && wp > 1.0 {
            iw as f64 / wp
        } else {
            1.0
        };
        DisplayGeom {
            image_width: iw,
            image_height: ih,
            origin_x: ox,
            origin_y: oy,
            width_pt: wp,
            height_pt: hp,
            scale: if scale.is_finite() && scale > 0.0 { scale } else { 1.0 },
            actionable,
        }
    } else {
        capture_geom(scope, display, iw, ih)
    };
    let scale = finite(geom.scale, 1.0);
    let (frame_id, _) = remember_frame(geom.clone());
    FrameMeta {
        frame_id,
        scale,
        actionable: geom.actionable,
        expires_in_sec: FRAME_TTL_SEC,
        origin_x: finite(geom.origin_x, 0.0),
        origin_y: finite(geom.origin_y, 0.0),
        width_pt: finite(geom.width_pt, 0.0),
        height_pt: finite(geom.height_pt, 0.0),
    }
}

fn platform_display_bounds(scope: &str, display: Option<u32>) -> Option<(f64, f64, f64, f64, f64)> {
    #[cfg(target_os = "macos")]
    {
        return mac::display_bounds(scope, display);
    }
    #[cfg(target_os = "linux")]
    {
        return linux::display_bounds(scope, display);
    }
    #[cfg(target_os = "windows")]
    {
        return win::display_bounds(scope, display);
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = (scope, display);
        None
    }
}

fn capture_geom(scope: &str, display: Option<u32>, image_w: u32, image_h: u32) -> DisplayGeom {
    if image_w == 0 || image_h == 0 || scope.eq_ignore_ascii_case("all") {
        return DisplayGeom::inert(image_w, image_h);
    }
    if let Some((origin_x, origin_y, width_pt, height_pt, scale)) = platform_display_bounds(scope, display) {
        let actionable = width_pt > 1.0 && height_pt > 1.0;
        return DisplayGeom {
            image_width: image_w,
            image_height: image_h,
            origin_x,
            origin_y,
            width_pt,
            height_pt,
            scale: if scale.is_finite() && scale > 0.0 { scale } else { 1.0 },
            actionable,
        };
    }
    DisplayGeom::inert(image_w, image_h)
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
pub struct CapturedShot {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Window capture: JPEG pixels plus screen-point bounds for [`bind_screenshot_frame_at`].
#[cfg(any(target_os = "linux", target_os = "windows"))]
pub struct CapturedWindowShot {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub origin_x: f64,
    pub origin_y: f64,
    pub width_pt: f64,
    pub height_pt: f64,
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
pub struct ShotError {
    pub code: &'static str,
    pub message: String,
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
pub fn capture_shot(scope: &str, display: Option<u32>, max_bytes: usize) -> Result<CapturedShot, ShotError> {
    #[cfg(target_os = "linux")]
    {
        linux::capture_shot(scope, display, max_bytes)
    }
    #[cfg(target_os = "windows")]
    {
        win::capture_shot(scope, display, max_bytes)
    }
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
pub fn capture_window_shot(window_id: i64, max_bytes: usize) -> Result<CapturedWindowShot, ShotError> {
    #[cfg(target_os = "linux")]
    {
        linux::capture_window_shot(window_id, max_bytes)
    }
    #[cfg(target_os = "windows")]
    {
        win::capture_window_shot(window_id, max_bytes)
    }
}


/// Look up on-screen window bounds (points) by `host_list_windows` window_id.
#[cfg(target_os = "macos")]
pub fn mac_window_bounds(window_id: i64) -> Option<(f64, f64, f64, f64)> {
    mac::window_bounds(window_id)
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
pub fn open_platform_privacy(pane: &str) -> Result<Value, String> {
    #[cfg(target_os = "linux")]
    {
        linux::open_privacy(pane)
    }
    #[cfg(target_os = "windows")]
    {
        win::open_privacy(pane)
    }
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn background_target(background: bool, pid: Option<i64>, element_pid: Option<i32>) -> Result<Option<i32>, Value> {
    if !background {
        return Ok(None);
    }
    let resolved = pid
        .filter(|p| *p > 0 && *p <= i32::MAX as i64)
        .map(|p| p as i32)
        .or(element_pid);
    match resolved {
        Some(p) if p > 0 => Ok(Some(p)),
        _ => Err(cu_error(
            "missing_pid",
            "后台发送需要 pid。先列出窗口或查看界面元素，把对应 pid 传进来。",
        )),
    }
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn frame_point(frame_id: &str, x: Option<f64>, y: Option<f64>) -> Result<(f64, f64), Value> {
    let geom = load_frame(frame_id)?;
    let (x, y) = match (x, y) {
        (Some(x), Some(y)) => (x, y),
        _ => return Err(cu_error("invalid_args", "需要 x、y 和 frame_id")),
    };
    map_image_point(&geom, x, y).map_err(point_error)
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn element_center(id: &str) -> Result<(f64, f64, i32), Value> {
    let el = lookup_element(id)?;
    if el.w_pt <= 1.0 || el.h_pt <= 1.0 {
        return Err(cu_error("element_not_clickable", ELEMENT_NOT_CLICKABLE_MSG));
    }
    Ok((el.x_pt + el.w_pt / 2.0, el.y_pt + el.h_pt / 2.0, el.pid))
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn require_anchor(frame_id: &str, element_ref: &str) -> Result<Option<i32>, Value> {
    if !element_ref.is_empty() {
        let el = lookup_element(element_ref)?;
        if !frame_id.is_empty() {
            load_frame(frame_id)?;
        }
        return Ok(Some(el.pid));
    }
    load_frame(frame_id)?;
    Ok(None)
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn publish_element(
    pid: i32,
    role: &str,
    title: &str,
    description: &str,
    value: &str,
    depth: i32,
    bounds: Option<(f64, f64, f64, f64)>,
    geom: Option<&DisplayGeom>,
) -> Value {
    let (x_pt, y_pt, w_pt, h_pt) = bounds.unwrap_or((0.0, 0.0, 0.0, 0.0));
    let id = remember_element(ElementGeom {
        pid,
        x_pt,
        y_pt,
        w_pt,
        h_pt,
    });
    let mut row = json!({
        "element_ref": id,
        "role": if role.is_empty() { "AXUnknown" } else { role },
        "title": title,
        "description": description,
        "value": value,
        "depth": depth,
        "pid": pid,
    });
    if let Some((x, y, w, h)) = bounds {
        if let Some(g) = geom.filter(|g| g.actionable) {
            if let Some((ix, iy, iw, ih)) = screen_rect_to_image(g, x, y, w, h) {
                row["x"] = json!(ix.round() as i64);
                row["y"] = json!(iy.round() as i64);
                row["width"] = json!(iw.round() as i64);
                row["height"] = json!(ih.round() as i64);
                row["coord_space"] = json!("image_pixels");
                return row;
            }
        }
        row["x"] = json!(x.round() as i64);
        row["y"] = json!(y.round() as i64);
        row["width"] = json!(w.round() as i64);
        row["height"] = json!(h.round() as i64);
        row["coord_space"] = json!("screen_points");
    }
    row
}

#[derive(Debug, PartialEq)]
pub struct KeyStroke {
    pub keycode: u16,
    pub flags: u64,
    /// Logical name (`t`, `return`, `arrowup`). Mac uses `keycode`; Windows and Linux map this name.
    pub name: String,
}

fn modifier_flag(name: &str) -> Option<u64> {
    match name {
        "shift" => Some(FLAG_SHIFT),
        "control" | "ctrl" | "ctl" => Some(FLAG_CONTROL),
        "option" | "opt" | "alt" => Some(FLAG_OPTION),
        "command" | "cmd" | "meta" => Some(FLAG_COMMAND),
        _ => None,
    }
}

fn modifier_keycode(name: &str) -> Option<u16> {
    match name {
        "shift" => Some(56),
        "control" | "ctrl" | "ctl" => Some(59),
        "option" | "opt" | "alt" => Some(58),
        "command" | "cmd" | "meta" => Some(55),
        _ => None,
    }
}

fn keycode_for(name: &str) -> Option<u16> {
    if let Some(code) = modifier_keycode(name) {
        return Some(code);
    }
    Some(match name {
        "a" => 0,
        "s" => 1,
        "d" => 2,
        "f" => 3,
        "h" => 4,
        "g" => 5,
        "z" => 6,
        "x" => 7,
        "c" => 8,
        "v" => 9,
        "b" => 11,
        "q" => 12,
        "w" => 13,
        "e" => 14,
        "r" => 15,
        "y" => 16,
        "t" => 17,
        "1" => 18,
        "2" => 19,
        "3" => 20,
        "4" => 21,
        "6" => 22,
        "5" => 23,
        "=" | "equal" => 24,
        "9" => 25,
        "7" => 26,
        "-" | "minus" => 27,
        "8" => 28,
        "0" => 29,
        "]" => 30,
        "o" => 31,
        "u" => 32,
        "[" => 33,
        "i" => 34,
        "p" => 35,
        "return" | "enter" => 36,
        "l" => 37,
        "j" => 38,
        "'" | "quote" => 39,
        "k" => 40,
        ";" | "semicolon" => 41,
        "\\" | "backslash" => 42,
        "," | "comma" => 43,
        "/" | "slash" => 44,
        "n" => 45,
        "m" => 46,
        "." | "period" => 47,
        "tab" => 48,
        "space" | "spacebar" => 49,
        "`" | "grave" => 50,
        "delete" | "backspace" => 51,
        "escape" | "esc" => 53,
        "f5" => 96,
        "f6" => 97,
        "f7" => 98,
        "f3" => 99,
        "f8" => 100,
        "f9" => 101,
        "f11" => 103,
        "f10" => 109,
        "f12" => 111,
        "home" => 115,
        "pageup" | "pgup" => 116,
        "forwarddelete" | "del" => 117,
        "f4" => 118,
        "end" => 119,
        "f2" => 120,
        "pagedown" | "pgdn" => 121,
        "f1" => 122,
        "left" | "arrowleft" => 123,
        "right" | "arrowright" => 124,
        "down" | "arrowdown" => 125,
        "up" | "arrowup" => 126,
        _ => return None,
    })
}

pub fn parse_keystroke(key: &str, extra_modifiers: &[String]) -> Result<KeyStroke, String> {
    let raw = key.trim();
    if raw.is_empty() || raw.chars().count() > 64 {
        return Err("按键无效".into());
    }
    let mut flags = 0u64;
    let mut key_token: Option<String> = None;
    for part in raw.split('+') {
        let token = part.trim().to_ascii_lowercase();
        if token.is_empty() {
            continue;
        }
        if let Some(flag) = modifier_flag(&token) {
            flags |= flag;
            if key_token.is_none() {
                key_token = Some(token);
            } else if modifier_flag(key_token.as_deref().unwrap_or("")).is_some() {
                key_token = Some(token);
            }
            continue;
        }
        key_token = Some(token);
    }
    for extra in extra_modifiers {
        let token = extra.trim().to_ascii_lowercase();
        if token.is_empty() {
            continue;
        }
        match modifier_flag(&token) {
            Some(flag) => flags |= flag,
            None => return Err(format!("不认识的修饰键：{extra}")),
        }
    }
    let Some(token) = key_token else {
        return Err("按键无效".into());
    };
    if modifier_flag(&token).is_some() {
        let only_modifier = raw.split('+').all(|p| {
            let t = p.trim().to_ascii_lowercase();
            t.is_empty() || modifier_flag(&t).is_some()
        }) && extra_modifiers.iter().all(|m| modifier_flag(&m.trim().to_ascii_lowercase()).is_some());
        if !only_modifier {
            return Err(format!("不认识的按键：{raw}"));
        }
    }
    let Some(keycode) = keycode_for(&token) else {
        return Err(format!("不认识的按键：{token}"));
    };
    Ok(KeyStroke {
        keycode,
        flags,
        name: token,
    })
}

/// X11 keysym for a logical key name. Mac virtual keycodes are not reused here.
#[cfg(any(target_os = "linux", test))]
pub fn linux_keysym(name: &str) -> Option<u32> {
    Some(match name.trim().to_ascii_lowercase().as_str() {
        "return" | "enter" => 0xff0d,
        "escape" | "esc" => 0xff1b,
        "tab" => 0xff09,
        "space" | "spacebar" => 0x20,
        "delete" | "backspace" => 0xff08,
        "forwarddelete" | "del" => 0xffff,
        "left" | "arrowleft" => 0xff51,
        "up" | "arrowup" => 0xff52,
        "right" | "arrowright" => 0xff53,
        "down" | "arrowdown" => 0xff54,
        "home" => 0xff50,
        "end" => 0xff57,
        "pageup" | "pgup" => 0xff55,
        "pagedown" | "pgdn" => 0xff56,
        "f1" => 0xffbe,
        "f2" => 0xffbf,
        "f3" => 0xffc0,
        "f4" => 0xffc1,
        "f5" => 0xffc2,
        "f6" => 0xffc3,
        "f7" => 0xffc4,
        "f8" => 0xffc5,
        "f9" => 0xffc6,
        "f10" => 0xffc7,
        "f11" => 0xffc8,
        "f12" => 0xffc9,
        "shift" => 0xffe1,
        "control" | "ctrl" | "ctl" => 0xffe3,
        "option" | "opt" | "alt" => 0xffe9,
        "command" | "cmd" | "meta" => 0xffeb,
        "=" | "equal" => 0x3d,
        "-" | "minus" => 0x2d,
        "[" => 0x5b,
        "]" => 0x5d,
        "'" | "quote" => 0x27,
        ";" | "semicolon" => 0x3b,
        "\\" | "backslash" => 0x5c,
        "," | "comma" => 0x2c,
        "/" | "slash" => 0x2f,
        "." | "period" => 0x2e,
        "`" | "grave" => 0x60,
        other => {
            let mut chars = other.chars();
            match (chars.next(), chars.next()) {
                (Some(ch), None) if ch.is_ascii() && !ch.is_control() => ch as u32,
                _ => return None,
            }
        }
    })
}

/// Win32 virtual-key for a logical key name. Letters assume the US layout's A–Z VKs.
#[cfg(any(target_os = "windows", test))]
pub fn windows_vk(name: &str) -> Option<u16> {
    let name = name.trim().to_ascii_lowercase();
    if let Some(ch) = name.chars().next() {
        if name.chars().count() == 1 {
            if ch.is_ascii_lowercase() {
                return Some(0x41 + (ch as u16 - b'a' as u16));
            }
            if ch.is_ascii_digit() {
                return Some(0x30 + (ch as u16 - b'0' as u16));
            }
        }
    }
    Some(match name.as_str() {
        "return" | "enter" => 0x0d,
        "tab" => 0x09,
        "escape" | "esc" => 0x1b,
        "space" | "spacebar" => 0x20,
        "delete" | "backspace" => 0x08,
        "forwarddelete" | "del" => 0x2e,
        "left" | "arrowleft" => 0x25,
        "up" | "arrowup" => 0x26,
        "right" | "arrowright" => 0x27,
        "down" | "arrowdown" => 0x28,
        "home" => 0x24,
        "end" => 0x23,
        "pageup" | "pgup" => 0x21,
        "pagedown" | "pgdn" => 0x22,
        "shift" => 0x10,
        "control" | "ctrl" | "ctl" => 0x11,
        "option" | "opt" | "alt" => 0x12,
        "command" | "cmd" | "meta" => 0x5b,
        "f1" => 0x70,
        "f2" => 0x71,
        "f3" => 0x72,
        "f4" => 0x73,
        "f5" => 0x74,
        "f6" => 0x75,
        "f7" => 0x76,
        "f8" => 0x77,
        "f9" => 0x78,
        "f10" => 0x79,
        "f11" => 0x7a,
        "f12" => 0x7b,
        "=" | "equal" => 0xbb,
        "-" | "minus" => 0xbd,
        "[" => 0xdb,
        "]" => 0xdd,
        "'" | "quote" => 0xde,
        ";" | "semicolon" => 0xba,
        "\\" | "backslash" => 0xdc,
        "," | "comma" => 0xbc,
        "/" | "slash" => 0xbf,
        "." | "period" => 0xbe,
        "`" | "grave" => 0xc0,
        _ => return None,
    })
}

pub fn clamp_scroll(dx: f64, dy: f64) -> Result<(i32, i32), String> {
    if !dx.is_finite() || !dy.is_finite() {
        return Err("滚动量无效".into());
    }
    let dx = dx.clamp(-40.0, 40.0).round() as i32;
    let dy = dy.clamp(-40.0, 40.0).round() as i32;
    if dx == 0 && dy == 0 {
        return Err("滚动距离是 0".into());
    }
    Ok((dx, dy))
}

fn opt_str(v: &Option<String>) -> String {
    v.as_deref().unwrap_or("").trim().to_string()
}

fn button_name(raw: &Option<String>) -> Result<&'static str, Value> {
    match opt_str(raw).to_ascii_lowercase().as_str() {
        "" | "left" => Ok("left"),
        "right" => Ok("right"),
        "middle" | "center" => Ok("middle"),
        other => Err(cu_error(
            "invalid_args",
            &format!("button 只能是 left、right 或 middle（收到 {other}）"),
        )),
    }
}

fn click_count(raw: Option<i64>) -> Result<i32, Value> {
    let n = raw.unwrap_or(1);
    if !(1..=3).contains(&n) {
        return Err(cu_error("invalid_args", "clicks 需为 1 到 3"));
    }
    Ok(n as i32)
}

/// Ask macOS to show the event-posting prompt once per process (Settings UI or first click).
pub fn request_event_posting() {
    #[cfg(target_os = "macos")]
    {
        mac::request_posting_once();
    }
}

#[tauri::command(rename_all = "snake_case")]
pub fn host_tcc_status() -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    {
        return Ok(mac::tcc_status());
    }
    #[cfg(target_os = "linux")]
    {
        return Ok(linux::tcc_status());
    }
    #[cfg(target_os = "windows")]
    {
        return Ok(win::tcc_status());
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        Ok(unsupported())
    }
}

#[tauri::command(rename_all = "snake_case")]
pub fn host_list_windows(frame_id: Option<String>) -> Result<Value, String> {
    let frame_id = opt_str(&frame_id);
    #[cfg(target_os = "macos")]
    {
        return Ok(mac::list_windows(frame_id));
    }
    #[cfg(target_os = "linux")]
    {
        return Ok(linux::list_windows(frame_id));
    }
    #[cfg(target_os = "windows")]
    {
        return Ok(win::list_windows(frame_id));
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = frame_id;
        Ok(unsupported())
    }
}

#[allow(clippy::too_many_arguments)]
#[tauri::command(rename_all = "snake_case")]
pub fn host_ax(
    frame_id: Option<String>,
    app: Option<String>,
    pid: Option<i64>,
    window_id: Option<i64>,
    max_depth: Option<i64>,
    limit: Option<i64>,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    {
        return Ok(mac::ax_query(mac::AxQuery {
            frame_id: opt_str(&frame_id),
            app: opt_str(&app),
            pid,
            window_id,
            max_depth,
            limit,
            x,
            y,
        }));
    }
    #[cfg(target_os = "linux")]
    {
        return Ok(linux::ax_query(
            opt_str(&frame_id),
            opt_str(&app),
            pid,
            window_id,
            max_depth,
            limit,
            x,
            y,
        ));
    }
    #[cfg(target_os = "windows")]
    {
        return Ok(win::ax_query(
            opt_str(&frame_id),
            opt_str(&app),
            pid,
            window_id,
            max_depth,
            limit,
            x,
            y,
        ));
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = (frame_id, app, pid, window_id, max_depth, limit, x, y);
        Ok(unsupported())
    }
}

#[allow(clippy::too_many_arguments)]
#[tauri::command(rename_all = "snake_case")]
pub fn host_click(
    frame_id: Option<String>,
    x: Option<f64>,
    y: Option<f64>,
    button: Option<String>,
    clicks: Option<i64>,
    modifiers: Option<Vec<String>>,
    element_ref: Option<String>,
    background: Option<bool>,
    pid: Option<i64>,
) -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    {
        return Ok(mac::click(mac::ClickReq {
            frame_id: opt_str(&frame_id),
            x,
            y,
            button,
            clicks,
            modifiers: modifiers.unwrap_or_default(),
            element_ref: opt_str(&element_ref),
            background: background.unwrap_or(false),
            pid,
        }));
    }
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    {
        let frame_id = opt_str(&frame_id);
        let modifiers = modifiers.unwrap_or_default();
        let element_ref = opt_str(&element_ref);
        let background = background.unwrap_or(false);
        #[cfg(target_os = "linux")]
        {
            return Ok(linux::click(frame_id, x, y, button, clicks, modifiers, element_ref, background, pid));
        }
        #[cfg(target_os = "windows")]
        {
            return Ok(win::click(frame_id, x, y, button, clicks, modifiers, element_ref, background, pid));
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = (frame_id, x, y, button, clicks, modifiers, element_ref, background, pid);
        Ok(unsupported())
    }
}

#[tauri::command(rename_all = "snake_case")]
pub fn host_type(
    frame_id: Option<String>,
    text: Option<String>,
    element_ref: Option<String>,
    background: Option<bool>,
    pid: Option<i64>,
) -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    {
        return Ok(mac::type_text(mac::TypeReq {
            frame_id: opt_str(&frame_id),
            text: text.unwrap_or_default(),
            element_ref: opt_str(&element_ref),
            background: background.unwrap_or(false),
            pid,
        }));
    }
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    {
        let frame_id = opt_str(&frame_id);
        let text = text.unwrap_or_default();
        let element_ref = opt_str(&element_ref);
        let background = background.unwrap_or(false);
        #[cfg(target_os = "linux")]
        {
            return Ok(linux::type_text(frame_id, text, element_ref, background, pid));
        }
        #[cfg(target_os = "windows")]
        {
            return Ok(win::type_text(frame_id, text, element_ref, background, pid));
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = (frame_id, text, element_ref, background, pid);
        Ok(unsupported())
    }
}

#[tauri::command(rename_all = "snake_case")]
pub fn host_key(
    frame_id: Option<String>,
    key: Option<String>,
    modifiers: Option<Vec<String>>,
    element_ref: Option<String>,
    background: Option<bool>,
    pid: Option<i64>,
) -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    {
        return Ok(mac::press_key(mac::KeyReq {
            frame_id: opt_str(&frame_id),
            key: key.unwrap_or_default(),
            modifiers: modifiers.unwrap_or_default(),
            element_ref: opt_str(&element_ref),
            background: background.unwrap_or(false),
            pid,
        }));
    }
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    {
        let frame_id = opt_str(&frame_id);
        let key = key.unwrap_or_default();
        let modifiers = modifiers.unwrap_or_default();
        let element_ref = opt_str(&element_ref);
        let background = background.unwrap_or(false);
        #[cfg(target_os = "linux")]
        {
            return Ok(linux::press_key(frame_id, key, modifiers, element_ref, background, pid));
        }
        #[cfg(target_os = "windows")]
        {
            return Ok(win::press_key(frame_id, key, modifiers, element_ref, background, pid));
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = (frame_id, key, modifiers, element_ref, background, pid);
        Ok(unsupported())
    }
}

#[allow(clippy::too_many_arguments)]
#[tauri::command(rename_all = "snake_case")]
pub fn host_scroll(
    frame_id: Option<String>,
    x: Option<f64>,
    y: Option<f64>,
    dx: Option<f64>,
    dy: Option<f64>,
    background: Option<bool>,
    pid: Option<i64>,
) -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    {
        return Ok(mac::scroll(mac::ScrollReq {
            frame_id: opt_str(&frame_id),
            x,
            y,
            dx: dx.unwrap_or(0.0),
            dy: dy.unwrap_or(0.0),
            background: background.unwrap_or(false),
            pid,
        }));
    }
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    {
        let frame_id = opt_str(&frame_id);
        let dx = dx.unwrap_or(0.0);
        let dy = dy.unwrap_or(0.0);
        let background = background.unwrap_or(false);
        #[cfg(target_os = "linux")]
        {
            return Ok(linux::scroll(frame_id, x, y, dx, dy, background, pid));
        }
        #[cfg(target_os = "windows")]
        {
            return Ok(win::scroll(frame_id, x, y, dx, dy, background, pid));
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = (frame_id, x, y, dx, dy, background, pid);
        Ok(unsupported())
    }
}

#[tauri::command(rename_all = "snake_case")]
pub fn host_mouse_move(
    frame_id: Option<String>,
    x: Option<f64>,
    y: Option<f64>,
    background: Option<bool>,
    pid: Option<i64>,
) -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    {
        return Ok(mac::mouse_move(mac::MoveReq {
            frame_id: opt_str(&frame_id),
            x,
            y,
            background: background.unwrap_or(false),
            pid,
        }));
    }
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    {
        let frame_id = opt_str(&frame_id);
        let background = background.unwrap_or(false);
        #[cfg(target_os = "linux")]
        {
            return Ok(linux::mouse_move(frame_id, x, y, background, pid));
        }
        #[cfg(target_os = "windows")]
        {
            return Ok(win::mouse_move(frame_id, x, y, background, pid));
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = (frame_id, x, y, background, pid);
        Ok(unsupported())
    }
}

#[allow(clippy::too_many_arguments)]
#[tauri::command(rename_all = "snake_case")]
pub fn host_drag(
    frame_id: Option<String>,
    x: Option<f64>,
    y: Option<f64>,
    x2: Option<f64>,
    y2: Option<f64>,
    button: Option<String>,
    background: Option<bool>,
    pid: Option<i64>,
) -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    {
        return Ok(mac::drag(mac::DragReq {
            frame_id: opt_str(&frame_id),
            x,
            y,
            x2,
            y2,
            button,
            background: background.unwrap_or(false),
            pid,
        }));
    }
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    {
        let frame_id = opt_str(&frame_id);
        let background = background.unwrap_or(false);
        #[cfg(target_os = "linux")]
        {
            return Ok(linux::drag(frame_id, x, y, x2, y2, button, background, pid));
        }
        #[cfg(target_os = "windows")]
        {
            return Ok(win::drag(frame_id, x, y, x2, y2, button, background, pid));
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = (frame_id, x, y, x2, y2, button, background, pid);
        Ok(unsupported())
    }
}

#[cfg(target_os = "linux")]
#[path = "host_input_linux.rs"]
mod linux;

#[cfg(target_os = "windows")]
#[path = "host_input_win.rs"]
mod win;

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use std::ffi::CString;
    use std::os::raw::{c_char, c_void};
    use std::ptr;
    use std::thread;
    use std::time::Duration;

    pub type CFTypeRef = *const c_void;
    pub type CFStringRef = *const c_void;
    pub type CFArrayRef = *const c_void;
    pub type CFDictionaryRef = *const c_void;
    pub type AXUIElementRef = *mut c_void;
    pub type CGEventRef = *mut c_void;

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct CGPoint {
        pub x: f64,
        pub y: f64,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct CGSize {
        pub width: f64,
        pub height: f64,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct CGRect {
        pub origin: CGPoint,
        pub size: CGSize,
    }

    const K_CG_EVENT_LEFT_MOUSE_DOWN: u32 = 1;
    const K_CG_EVENT_LEFT_MOUSE_UP: u32 = 2;
    const K_CG_EVENT_RIGHT_MOUSE_DOWN: u32 = 3;
    const K_CG_EVENT_RIGHT_MOUSE_UP: u32 = 4;
    const K_CG_EVENT_MOUSE_MOVED: u32 = 5;
    const K_CG_EVENT_LEFT_MOUSE_DRAGGED: u32 = 6;
    const K_CG_EVENT_RIGHT_MOUSE_DRAGGED: u32 = 7;
    const K_CG_EVENT_OTHER_MOUSE_DOWN: u32 = 25;
    const K_CG_EVENT_OTHER_MOUSE_UP: u32 = 26;
    const K_CG_EVENT_OTHER_MOUSE_DRAGGED: u32 = 27;
    const K_CG_MOUSE_BUTTON_LEFT: u32 = 0;
    const K_CG_MOUSE_BUTTON_RIGHT: u32 = 1;
    const K_CG_MOUSE_BUTTON_CENTER: u32 = 2;
    const K_CG_SCROLL_EVENT_UNIT_LINE: u32 = 1;
    const K_CF_STRING_UTF8: u32 = 0x0800_0100;
    const K_AX_ERROR_API_DISABLED: i32 = -25211;

    #[link(name = "CoreGraphics", kind = "framework")]
    #[link(name = "CoreFoundation", kind = "framework")]
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        pub fn CGPreflightScreenCaptureAccess() -> bool;
        pub fn CGPreflightPostEventAccess() -> bool;
        pub fn CGRequestPostEventAccess();
        pub fn CGMainDisplayID() -> u32;
        pub fn CGDisplayBounds(display: u32) -> CGRect;
        pub fn CGDisplayPixelsWide(display: u32) -> usize;
        pub fn CGGetActiveDisplayList(max: u32, displays: *mut u32, count: *mut u32) -> i32;
        pub fn CGEventCreateMouseEvent(
            source: *mut c_void,
            mouse_type: u32,
            pos: CGPoint,
            button: u32,
        ) -> CGEventRef;
        pub fn CGEventCreateKeyboardEvent(
            source: *mut c_void,
            key: u16,
            key_down: bool,
        ) -> CGEventRef;
        pub fn CGEventKeyboardSetUnicodeString(event: CGEventRef, length: u64, chars: *const u16);
        pub fn CGEventSetFlags(event: CGEventRef, flags: u64);
        pub fn CGEventSetIntegerValueField(event: CGEventRef, field: u32, value: i64);
        pub fn CGEventSetLocation(event: CGEventRef, location: CGPoint);
        pub fn CGEventPost(tap: u32, event: CGEventRef);
        pub fn CGEventPostToPid(pid: i32, event: CGEventRef);
        pub fn CGEventCreateScrollWheelEvent(
            source: *mut c_void,
            units: u32,
            wheel_count: u32,
            wheel1: i32,
            ...
        ) -> CGEventRef;
        pub fn CGWindowListCopyWindowInfo(option: u32, relative: u32) -> CFArrayRef;
        pub fn CGRectMakeWithDictionaryRepresentation(dict: CFDictionaryRef, rect: *mut CGRect)
            -> bool;
        pub static kCGWindowName: CFStringRef;
        pub static kCGWindowOwnerName: CFStringRef;
        pub static kCGWindowNumber: CFStringRef;
        pub static kCGWindowOwnerPID: CFStringRef;
        pub static kCGWindowBounds: CFStringRef;
        pub static kCGWindowLayer: CFStringRef;

        pub fn CFRelease(cf: CFTypeRef);
        pub fn CFStringCreateWithCString(
            alloc: *const c_void,
            cstr: *const c_char,
            encoding: u32,
        ) -> CFStringRef;
        pub fn CFStringGetCString(
            s: CFStringRef,
            buf: *mut c_char,
            size: isize,
            encoding: u32,
        ) -> bool;
        pub fn CFGetTypeID(cf: CFTypeRef) -> usize;
        pub fn CFStringGetTypeID() -> usize;
        pub fn CFArrayGetTypeID() -> usize;
        pub fn CFDictionaryGetTypeID() -> usize;
        pub fn CFNumberGetTypeID() -> usize;
        pub fn CFBooleanGetTypeID() -> usize;
        pub fn CFArrayGetCount(arr: CFArrayRef) -> isize;
        pub fn CFArrayGetValueAtIndex(arr: CFArrayRef, idx: isize) -> *const c_void;
        pub fn CFDictionaryGetValue(dict: CFDictionaryRef, key: *const c_void) -> *const c_void;
        pub fn CFNumberGetValue(number: *const c_void, kind: i32, value: *mut c_void) -> bool;
        pub fn CFBooleanGetValue(b: *const c_void) -> bool;

        pub fn AXIsProcessTrusted() -> bool;
        pub fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
        pub static kAXTrustedCheckOptionPrompt: CFStringRef;
        pub static kCFBooleanTrue: *const c_void;
        pub static kCFTypeDictionaryKeyCallBacks: u8;
        pub static kCFTypeDictionaryValueCallBacks: u8;
        pub fn CFDictionaryCreate(
            allocator: *const c_void,
            keys: *const *const c_void,
            values: *const *const c_void,
            num_values: isize,
            key_callbacks: *const c_void,
            value_callbacks: *const c_void,
        ) -> CFDictionaryRef;
        pub fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
        pub fn AXUIElementCreateSystemWide() -> AXUIElementRef;
        pub fn AXUIElementCopyAttributeValue(
            el: AXUIElementRef,
            attr: CFStringRef,
            value: *mut CFTypeRef,
        ) -> i32;
        pub fn AXUIElementCopyElementAtPosition(
            app: AXUIElementRef,
            x: f32,
            y: f32,
            element: *mut AXUIElementRef,
        ) -> i32;
        pub fn AXUIElementGetPid(el: AXUIElementRef, pid: *mut i32) -> i32;
        pub fn AXValueGetValue(value: *const c_void, kind: u32, out: *mut c_void) -> bool;
    }

    struct Released(CFTypeRef);
    impl Drop for Released {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { CFRelease(self.0) }
            }
        }
    }

    fn cf_string(s: &str) -> CFStringRef {
        let Ok(c) = CString::new(s) else {
            return ptr::null();
        };
        unsafe { CFStringCreateWithCString(ptr::null(), c.as_ptr(), K_CF_STRING_UTF8) }
    }

    fn read_cf_string(s: CFStringRef) -> String {
        if s.is_null() {
            return String::new();
        }
        let mut buf = [0u8; 768];
        let ok = unsafe {
            CFStringGetCString(
                s,
                buf.as_mut_ptr() as *mut c_char,
                buf.len() as isize,
                K_CF_STRING_UTF8,
            )
        };
        if !ok {
            return String::new();
        }
        let len = buf.iter().position(|b| *b == 0).unwrap_or(buf.len());
        String::from_utf8_lossy(&buf[..len]).trim().to_string()
    }

    fn clip(s: &str, n: usize) -> String {
        let t: String = s.chars().filter(|c| !c.is_control()).take(n).collect();
        t
    }

    fn as_i64(v: CFTypeRef) -> Option<i64> {
        if v.is_null() {
            return None;
        }
        unsafe {
            if CFGetTypeID(v) != CFNumberGetTypeID() {
                if CFGetTypeID(v) == CFBooleanGetTypeID() {
                    return Some(if CFBooleanGetValue(v) { 1 } else { 0 });
                }
                return None;
            }
            let mut out: i64 = 0;
            // kCFNumberSInt64Type = 4
            if CFNumberGetValue(v, 4, &mut out as *mut i64 as *mut c_void) {
                return Some(out);
            }
            None
        }
    }

    fn dict_get(dict: CFDictionaryRef, key: CFStringRef) -> CFTypeRef {
        if dict.is_null() || key.is_null() {
            return ptr::null();
        }
        unsafe { CFDictionaryGetValue(dict, key) }
    }

    pub fn display_bounds(scope: &str, display: Option<u32>) -> Option<(f64, f64, f64, f64, f64)> {
        let _ = scope;
        let id = if let Some(n) = display {
            if n == 0 {
                return None;
            }
            let mut ids = [0u32; 16];
            let mut count = 0u32;
            let err = unsafe { CGGetActiveDisplayList(16, ids.as_mut_ptr(), &mut count) };
            if err != 0 || n as usize > count as usize || count == 0 {
                return None;
            }
            ids[(n as usize) - 1]
        } else {
            unsafe { CGMainDisplayID() }
        };
        let bounds = unsafe { CGDisplayBounds(id) };
        let px = unsafe { CGDisplayPixelsWide(id) } as f64;
        let scale = if bounds.size.width > 1.0 {
            px / bounds.size.width
        } else {
            1.0
        };
        Some((
            bounds.origin.x,
            bounds.origin.y,
            bounds.size.width,
            bounds.size.height,
            scale,
        ))
    }

    fn tcc_bucket(granted: bool, settings: &str) -> Value {
        json!({
            "granted": granted,
            "settings": settings,
        })
    }

    fn code_identity() -> Value {
        use std::process::Command;
        let exe = std::env::current_exe()
            .map(|p| p.display().to_string())
            .unwrap_or_default();
        let mut identifier = "com.openbot.desktop".to_string();
        let mut cdhash = String::new();
        let mut signature = String::new();
        let mut team = String::new();
        if !exe.is_empty() {
            if let Ok(output) = Command::new("codesign")
                .args(["-dv", "--verbose=4", &exe])
                .output()
            {
                // codesign -dv writes details to stderr
                let text = String::from_utf8_lossy(&output.stderr);
                for line in text.lines() {
                    if let Some(v) = line.strip_prefix("Identifier=") {
                        identifier = v.to_string();
                    } else if let Some(v) = line.strip_prefix("CDHash=") {
                        cdhash = v.to_string();
                    } else if let Some(v) = line.strip_prefix("Signature=") {
                        signature = v.to_string();
                    } else if let Some(v) = line.strip_prefix("TeamIdentifier=") {
                        team = v.to_string();
                    }
                }
            }
        }
        json!({
            "executable": exe,
            "identifier": identifier,
            "cdhash": cdhash,
            "signature": signature,
            "team_identifier": team,
            "hint": "权限必须授给正在运行的这个身份（看 identifier + cdhash）。adhoc 每次重新打包 CDHash 会变；请只打开「应用程序」里的 Open Bot.app，在系统设置里勾选名为 Open Bot、标识 com.openbot.desktop 的那一项，然后完全退出再开。不要给 Terminal、Cursor、cargo run 或 make dev-desktop 产生的二进制授权。",
        })
    }

    fn open_privacy_anchor(anchor: &str) {
        use std::process::Command;
        let url = format!("x-apple.systempreferences:com.apple.preference.security?{anchor}");
        let _ = Command::new("open").arg(url).status();
    }

    static TCC_SETTINGS_OPENED: AtomicBool = AtomicBool::new(false);

    /// Preflight all three buckets. If any is denied, fire one-shot Request/prompt,
    /// Preflight again, and (once per process) open the matching System Settings pane.
    pub fn tcc_status() -> Value {
        let mut screen = unsafe { CGPreflightScreenCaptureAccess() };
        let mut accessibility = unsafe { AXIsProcessTrusted() };
        let mut posting = unsafe { CGPreflightPostEventAccess() };
        let mut requested = json!({
            "screen_recording": false,
            "accessibility": false,
            "event_posting": false,
        });

        if !screen {
            crate::host_cmd::request_screen_recording();
            requested["screen_recording"] = json!(true);
            screen = unsafe { CGPreflightScreenCaptureAccess() };
        }
        if !accessibility {
            let already = ACCESSIBILITY_PROMPTED.load(Ordering::SeqCst);
            prompt_accessibility_once();
            requested["accessibility"] = json!(!already);
            accessibility = unsafe { AXIsProcessTrusted() };
        }
        if !posting {
            let already = POSTING_REQUESTED.load(Ordering::SeqCst);
            request_posting_once();
            requested["event_posting"] = json!(!already);
            posting = unsafe { CGPreflightPostEventAccess() };
        }

        let any_denied = !screen || !accessibility || !posting;
        let mut opened_settings = false;
        if any_denied && !TCC_SETTINGS_OPENED.swap(true, Ordering::SeqCst) {
            opened_settings = true;
            // Prefer the first missing bucket's pane.
            if !screen {
                open_privacy_anchor("Privacy_ScreenCapture");
            } else {
                open_privacy_anchor("Privacy_Accessibility");
            }
        }

        json!({
            "ok": true,
            "platform": "macos",
            "screen_recording": tcc_bucket(screen, "系统设置 → 隐私与安全性 → 屏幕录制"),
            "accessibility": tcc_bucket(accessibility, "系统设置 → 隐私与安全性 → 辅助功能"),
            "event_posting": tcc_bucket(posting, "系统设置 → 隐私与安全性 → 辅助功能（发送事件）"),
            "identity": code_identity(),
            "requested": requested,
            "opened_settings": opened_settings,
        })
    }

    static POSTING_REQUESTED: AtomicBool = AtomicBool::new(false);
    static ACCESSIBILITY_PROMPTED: AtomicBool = AtomicBool::new(false);

    pub fn request_posting_once() {
        if POSTING_REQUESTED.swap(true, Ordering::SeqCst) {
            return;
        }
        unsafe { CGRequestPostEventAccess() };
    }

    fn prompt_accessibility_once() {
        if ACCESSIBILITY_PROMPTED.swap(true, Ordering::SeqCst) {
            return;
        }
        unsafe {
            let key = kAXTrustedCheckOptionPrompt as *const c_void;
            let value = kCFBooleanTrue;
            let keys = [key];
            let values = [value];
            let options = CFDictionaryCreate(
                ptr::null(),
                keys.as_ptr(),
                values.as_ptr(),
                1,
                std::ptr::addr_of!(kCFTypeDictionaryKeyCallBacks) as *const c_void,
                std::ptr::addr_of!(kCFTypeDictionaryValueCallBacks) as *const c_void,
            );
            let _ = AXIsProcessTrustedWithOptions(options);
            if !options.is_null() {
                CFRelease(options);
            }
        }
    }

    fn ensure_posting() -> Result<(), Value> {
        if unsafe { CGPreflightPostEventAccess() } {
            return Ok(());
        }
        request_posting_once();
        if unsafe { CGPreflightPostEventAccess() } {
            return Ok(());
        }
        Err(cu_error("event_posting_denied", EVENT_POSTING_DENIED_MSG))
    }

    fn ensure_accessibility() -> Result<(), Value> {
        if unsafe { AXIsProcessTrusted() } {
            return Ok(());
        }
        prompt_accessibility_once();
        if unsafe { AXIsProcessTrusted() } {
            return Ok(());
        }
        Err(cu_error("accessibility_denied", ACCESSIBILITY_DENIED_MSG))
    }

    fn post(event: CGEventRef, pid: Option<i32>) {
        if event.is_null() {
            return;
        }
        unsafe {
            if let Some(pid) = pid {
                CGEventPostToPid(pid, event);
            } else {
                CGEventPost(0, event);
            }
            CFRelease(event as CFTypeRef);
        }
    }

    fn nap(ms: u64) {
        thread::sleep(Duration::from_millis(ms));
    }

    fn mouse_kinds(button: &str) -> (u32, u32, u32, u32) {
        match button {
            "right" => (
                K_CG_EVENT_RIGHT_MOUSE_DOWN,
                K_CG_EVENT_RIGHT_MOUSE_UP,
                K_CG_EVENT_RIGHT_MOUSE_DRAGGED,
                K_CG_MOUSE_BUTTON_RIGHT,
            ),
            "middle" => (
                K_CG_EVENT_OTHER_MOUSE_DOWN,
                K_CG_EVENT_OTHER_MOUSE_UP,
                K_CG_EVENT_OTHER_MOUSE_DRAGGED,
                K_CG_MOUSE_BUTTON_CENTER,
            ),
            _ => (
                K_CG_EVENT_LEFT_MOUSE_DOWN,
                K_CG_EVENT_LEFT_MOUSE_UP,
                K_CG_EVENT_LEFT_MOUSE_DRAGGED,
                K_CG_MOUSE_BUTTON_LEFT,
            ),
        }
    }

    fn flags_of(modifiers: &[String]) -> Result<u64, Value> {
        let mut flags = 0u64;
        for m in modifiers {
            let token = m.trim().to_ascii_lowercase();
            if token.is_empty() {
                continue;
            }
            match modifier_flag(&token) {
                Some(f) => flags |= f,
                None => {
                    return Err(cu_error(
                        "invalid_args",
                        &format!("不认识的修饰键：{m}"),
                    ))
                }
            }
        }
        Ok(flags)
    }

    fn target_pid(background: bool, pid: Option<i64>, element_pid: Option<i32>) -> Result<Option<i32>, Value> {
        if !background {
            return Ok(None);
        }
        let resolved = pid
            .filter(|p| *p > 0 && *p <= i32::MAX as i64)
            .map(|p| p as i32)
            .or(element_pid);
        match resolved {
            Some(p) if p > 0 => Ok(Some(p)),
            _ => Err(cu_error(
                "missing_pid",
                "后台发送需要 pid。先列出窗口或查看界面元素，把对应 pid 传进来。",
            )),
        }
    }

    fn move_cursor(pt: CGPoint, pid: Option<i32>, flags: u64) {
        unsafe {
            let ev = CGEventCreateMouseEvent(ptr::null_mut(), K_CG_EVENT_MOUSE_MOVED, pt, K_CG_MOUSE_BUTTON_LEFT);
            if !ev.is_null() && flags != 0 {
                CGEventSetFlags(ev, flags);
            }
            post(ev, pid);
        }
    }

    fn click_at(pt: CGPoint, button: &str, clicks: i32, flags: u64, pid: Option<i32>) {
        let (down_t, up_t, _, btn) = mouse_kinds(button);
        if pid.is_none() {
            move_cursor(pt, None, flags);
            nap(8);
        }
        for i in 1..=clicks {
            unsafe {
                let down = CGEventCreateMouseEvent(ptr::null_mut(), down_t, pt, btn);
                if !down.is_null() {
                    CGEventSetIntegerValueField(down, 1, i as i64);
                    if flags != 0 {
                        CGEventSetFlags(down, flags);
                    }
                }
                post(down, pid);
            }
            nap(16);
            unsafe {
                let up = CGEventCreateMouseEvent(ptr::null_mut(), up_t, pt, btn);
                if !up.is_null() {
                    CGEventSetIntegerValueField(up, 1, i as i64);
                    if flags != 0 {
                        CGEventSetFlags(up, flags);
                    }
                }
                post(up, pid);
            }
            if i != clicks {
                nap(40);
            }
        }
    }

    fn resolve_click_point(req: &ClickReq) -> Result<(CGPoint, Option<i32>, String), Value> {
        if !req.element_ref.is_empty() {
            let el = lookup_element(&req.element_ref)?;
            if el.w_pt <= 1.0 || el.h_pt <= 1.0 {
                return Err(cu_error("element_not_clickable", ELEMENT_NOT_CLICKABLE_MSG));
            }
            if !req.frame_id.is_empty() {
                let _ = load_frame(&req.frame_id)?;
            }
            return Ok((
                CGPoint {
                    x: el.x_pt + el.w_pt / 2.0,
                    y: el.y_pt + el.h_pt / 2.0,
                },
                Some(el.pid),
                "element".into(),
            ));
        }
        let geom = load_frame(&req.frame_id)?;
        let (x, y) = match (req.x, req.y) {
            (Some(x), Some(y)) => (x, y),
            _ => return Err(cu_error("invalid_args", "点击需要 x、y 和 frame_id，或 element_ref")),
        };
        let (sx, sy) = map_image_point(&geom, x, y).map_err(point_error)?;
        Ok((CGPoint { x: sx, y: sy }, None, "frame".into()))
    }

    pub struct ClickReq {
        pub frame_id: String,
        pub x: Option<f64>,
        pub y: Option<f64>,
        pub button: Option<String>,
        pub clicks: Option<i64>,
        pub modifiers: Vec<String>,
        pub element_ref: String,
        pub background: bool,
        pub pid: Option<i64>,
    }

    pub fn click(req: ClickReq) -> Value {
        let button = match button_name(&req.button) {
            Ok(b) => b,
            Err(e) => return e,
        };
        let clicks = match click_count(req.clicks) {
            Ok(n) => n,
            Err(e) => return e,
        };
        let flags = match flags_of(&req.modifiers) {
            Ok(f) => f,
            Err(e) => return e,
        };
        if let Err(e) = ensure_posting() {
            return e;
        }
        let (pt, element_pid, via) = match resolve_click_point(&req) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let pid = match target_pid(req.background, req.pid, element_pid) {
            Ok(p) => p,
            Err(e) => return e,
        };
        click_at(pt, button, clicks, flags, pid);
        json!({
            "ok": true,
            "action": "click",
            "via": via,
            "button": button,
            "clicks": clicks,
            "background": req.background,
            "x_pt": pt.x,
            "y_pt": pt.y,
            "frame_id": if req.frame_id.is_empty() { Value::Null } else { json!(req.frame_id) },
        })
    }

    fn post_unicode(ch: char, flags: u64, pid: Option<i32>) {
        let mut buf = [0u16; 2];
        let encoded = ch.encode_utf16(&mut buf);
        let len = encoded.len() as u64;
        unsafe {
            let down = CGEventCreateKeyboardEvent(ptr::null_mut(), 0, true);
            if !down.is_null() {
                CGEventKeyboardSetUnicodeString(down, len, buf.as_ptr());
                if flags != 0 {
                    CGEventSetFlags(down, flags);
                }
            }
            post(down, pid);
            let up = CGEventCreateKeyboardEvent(ptr::null_mut(), 0, false);
            if !up.is_null() {
                CGEventKeyboardSetUnicodeString(up, len, buf.as_ptr());
                if flags != 0 {
                    CGEventSetFlags(up, flags);
                }
            }
            post(up, pid);
        }
    }

    fn post_key(stroke: &KeyStroke, pid: Option<i32>) {
        unsafe {
            let down = CGEventCreateKeyboardEvent(ptr::null_mut(), stroke.keycode, true);
            if !down.is_null() && stroke.flags != 0 {
                CGEventSetFlags(down, stroke.flags);
            }
            post(down, pid);
            nap(12);
            let up = CGEventCreateKeyboardEvent(ptr::null_mut(), stroke.keycode, false);
            if !up.is_null() && stroke.flags != 0 {
                CGEventSetFlags(up, stroke.flags);
            }
            post(up, pid);
        }
    }

    pub struct TypeReq {
        pub frame_id: String,
        pub text: String,
        pub element_ref: String,
        pub background: bool,
        pub pid: Option<i64>,
    }

    pub fn type_text(req: TypeReq) -> Value {
        let text = req.text;
        let count = text.chars().count();
        if count == 0 {
            return cu_error("invalid_args", "text 是空的");
        }
        if count > MAX_TYPE_CHARS {
            return cu_error("invalid_args", "一次最多输入 2000 个字符");
        }
        let mut element_pid = None;
        if !req.element_ref.is_empty() {
            let el = match lookup_element(&req.element_ref) {
                Ok(el) => el,
                Err(e) => return e,
            };
            element_pid = Some(el.pid);
            if el.w_pt > 1.0 && el.h_pt > 1.0 {
                if let Err(e) = ensure_posting() {
                    return e;
                }
                let pid = match target_pid(req.background, req.pid, element_pid) {
                    Ok(p) => p,
                    Err(e) => return e,
                };
                click_at(
                    CGPoint {
                        x: el.x_pt + el.w_pt / 2.0,
                        y: el.y_pt + el.h_pt / 2.0,
                    },
                    "left",
                    1,
                    0,
                    pid,
                );
                nap(30);
            }
        } else if let Err(e) = load_frame(&req.frame_id) {
            return e;
        }
        if let Err(e) = ensure_posting() {
            return e;
        }
        let pid = match target_pid(req.background, req.pid, element_pid) {
            Ok(p) => p,
            Err(e) => return e,
        };
        for ch in text.chars() {
            if ch == '\n' || ch == '\r' {
                post_key(
                    &KeyStroke {
                        keycode: 36,
                        flags: 0,
                        name: "return".into(),
                    },
                    pid,
                );
            } else if ch == '\t' {
                post_key(
                    &KeyStroke {
                        keycode: 48,
                        flags: 0,
                        name: "tab".into(),
                    },
                    pid,
                );
            } else {
                post_unicode(ch, 0, pid);
            }
            nap(4);
        }
        json!({
            "ok": true,
            "action": "type",
            "chars": count,
            "background": req.background,
        })
    }

    pub struct KeyReq {
        pub frame_id: String,
        pub key: String,
        pub modifiers: Vec<String>,
        pub element_ref: String,
        pub background: bool,
        pub pid: Option<i64>,
    }

    pub fn press_key(req: KeyReq) -> Value {
        let stroke = match parse_keystroke(&req.key, &req.modifiers) {
            Ok(s) => s,
            Err(msg) => return cu_error("invalid_args", &msg),
        };
        let mut element_pid = None;
        if !req.element_ref.is_empty() {
            match lookup_element(&req.element_ref) {
                Ok(el) => element_pid = Some(el.pid),
                Err(e) => return e,
            }
        } else if let Err(e) = load_frame(&req.frame_id) {
            return e;
        }
        if let Err(e) = ensure_posting() {
            return e;
        }
        let pid = match target_pid(req.background, req.pid, element_pid) {
            Ok(p) => p,
            Err(e) => return e,
        };
        post_key(&stroke, pid);
        json!({
            "ok": true,
            "action": "key",
            "key": req.key,
            "background": req.background,
        })
    }

    pub struct ScrollReq {
        pub frame_id: String,
        pub x: Option<f64>,
        pub y: Option<f64>,
        pub dx: f64,
        pub dy: f64,
        pub background: bool,
        pub pid: Option<i64>,
    }

    pub fn scroll(req: ScrollReq) -> Value {
        let (dx, dy) = match clamp_scroll(req.dx, req.dy) {
            Ok(v) => v,
            Err(msg) => return cu_error("invalid_args", &msg),
        };
        let geom = match load_frame(&req.frame_id) {
            Ok(g) => g,
            Err(e) => return e,
        };
        let (x, y) = match (req.x, req.y) {
            (Some(x), Some(y)) => (x, y),
            _ => return cu_error("invalid_args", "滚动需要 frame_id、x、y"),
        };
        let (sx, sy) = match map_image_point(&geom, x, y) {
            Ok(p) => p,
            Err(e) => return point_error(e),
        };
        if let Err(e) = ensure_posting() {
            return e;
        }
        let pid = match target_pid(req.background, req.pid, None) {
            Ok(p) => p,
            Err(e) => return e,
        };
        let pt = CGPoint { x: sx, y: sy };
        if pid.is_none() {
            move_cursor(pt, None, 0);
            nap(8);
        }
        unsafe {
            // axis1 is vertical: positive scrolls up. axis2 is horizontal: positive scrolls right.
            let ev = CGEventCreateScrollWheelEvent(
                ptr::null_mut(),
                K_CG_SCROLL_EVENT_UNIT_LINE,
                2,
                dy,
                dx,
            );
            if !ev.is_null() {
                CGEventSetLocation(ev, pt);
            }
            post(ev, pid);
        }
        json!({
            "ok": true,
            "action": "scroll",
            "dx": dx,
            "dy": dy,
            "background": req.background,
            "frame_id": req.frame_id,
        })
    }

    pub struct MoveReq {
        pub frame_id: String,
        pub x: Option<f64>,
        pub y: Option<f64>,
        pub background: bool,
        pub pid: Option<i64>,
    }

    pub fn mouse_move(req: MoveReq) -> Value {
        let geom = match load_frame(&req.frame_id) {
            Ok(g) => g,
            Err(e) => return e,
        };
        let (x, y) = match (req.x, req.y) {
            (Some(x), Some(y)) => (x, y),
            _ => return cu_error("invalid_args", "移动鼠标需要 frame_id、x、y"),
        };
        let (sx, sy) = match map_image_point(&geom, x, y) {
            Ok(p) => p,
            Err(e) => return point_error(e),
        };
        if let Err(e) = ensure_posting() {
            return e;
        }
        let pid = match target_pid(req.background, req.pid, None) {
            Ok(p) => p,
            Err(e) => return e,
        };
        move_cursor(CGPoint { x: sx, y: sy }, pid, 0);
        json!({
            "ok": true,
            "action": "mouse_move",
            "x_pt": sx,
            "y_pt": sy,
            "background": req.background,
            "frame_id": req.frame_id,
        })
    }

    pub struct DragReq {
        pub frame_id: String,
        pub x: Option<f64>,
        pub y: Option<f64>,
        pub x2: Option<f64>,
        pub y2: Option<f64>,
        pub button: Option<String>,
        pub background: bool,
        pub pid: Option<i64>,
    }

    pub fn drag(req: DragReq) -> Value {
        let button = match button_name(&req.button) {
            Ok(b) => b,
            Err(e) => return e,
        };
        let geom = match load_frame(&req.frame_id) {
            Ok(g) => g,
            Err(e) => return e,
        };
        let (x, y, x2, y2) = match (req.x, req.y, req.x2, req.y2) {
            (Some(x), Some(y), Some(x2), Some(y2)) => (x, y, x2, y2),
            _ => return cu_error("invalid_args", "拖拽需要 frame_id、x、y、x2、y2"),
        };
        let (sx, sy) = match map_image_point(&geom, x, y) {
            Ok(p) => p,
            Err(e) => return point_error(e),
        };
        let (ex, ey) = match map_image_point(&geom, x2, y2) {
            Ok(p) => p,
            Err(e) => return point_error(e),
        };
        if let Err(e) = ensure_posting() {
            return e;
        }
        let pid = match target_pid(req.background, req.pid, None) {
            Ok(p) => p,
            Err(e) => return e,
        };
        let (down_t, up_t, drag_t, btn) = mouse_kinds(button);
        let start = CGPoint { x: sx, y: sy };
        let end = CGPoint { x: ex, y: ey };
        if pid.is_none() {
            move_cursor(start, None, 0);
            nap(8);
        }
        unsafe {
            let down = CGEventCreateMouseEvent(ptr::null_mut(), down_t, start, btn);
            post(down, pid);
        }
        nap(16);
        for i in 1..=8 {
            let t = i as f64 / 8.0;
            let pt = CGPoint {
                x: start.x + (end.x - start.x) * t,
                y: start.y + (end.y - start.y) * t,
            };
            unsafe {
                let ev = CGEventCreateMouseEvent(ptr::null_mut(), drag_t, pt, btn);
                post(ev, pid);
            }
            nap(10);
        }
        unsafe {
            let up = CGEventCreateMouseEvent(ptr::null_mut(), up_t, end, btn);
            post(up, pid);
        }
        json!({
            "ok": true,
            "action": "drag",
            "button": button,
            "background": req.background,
            "frame_id": req.frame_id,
        })
    }

    struct WinInfo {
        window_id: i64,
        pid: i32,
        app: String,
        title: String,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    }

    fn copy_windows() -> Vec<WinInfo> {
        // onscreen only (1) + exclude desktop elements (16)
        let arr = unsafe { CGWindowListCopyWindowInfo(1 | 16, 0) };
        if arr.is_null() {
            return Vec::new();
        }
        let _keep = Released(arr);
        let n = unsafe { CFArrayGetCount(arr) };
        let mut out = Vec::new();
        let (k_name, k_owner, k_num, k_pid, k_bounds, k_layer) = unsafe {
            (
                kCGWindowName,
                kCGWindowOwnerName,
                kCGWindowNumber,
                kCGWindowOwnerPID,
                kCGWindowBounds,
                kCGWindowLayer,
            )
        };
        for i in 0..n {
            let item = unsafe { CFArrayGetValueAtIndex(arr, i) };
            if item.is_null() || unsafe { CFGetTypeID(item) } != unsafe { CFDictionaryGetTypeID() } {
                continue;
            }
            let dict = item as CFDictionaryRef;
            let layer = as_i64(dict_get(dict, k_layer)).unwrap_or(0);
            if layer != 0 {
                continue;
            }
            let app = read_cf_string(dict_get(dict, k_owner) as CFStringRef);
            if app.is_empty() || app == "Window Server" {
                continue;
            }
            let title = read_cf_string(dict_get(dict, k_name) as CFStringRef);
            let window_id = as_i64(dict_get(dict, k_num)).unwrap_or(0);
            let pid = as_i64(dict_get(dict, k_pid)).unwrap_or(0);
            if pid <= 0 || pid > i32::MAX as i64 {
                continue;
            }
            let bounds_v = dict_get(dict, k_bounds);
            let mut rect = CGRect {
                origin: CGPoint { x: 0.0, y: 0.0 },
                size: CGSize { width: 0.0, height: 0.0 },
            };
            if bounds_v.is_null()
                || unsafe { CFGetTypeID(bounds_v) } != unsafe { CFDictionaryGetTypeID() }
                || !unsafe { CGRectMakeWithDictionaryRepresentation(bounds_v as CFDictionaryRef, &mut rect) }
            {
                continue;
            }
            if rect.size.width < 2.0 || rect.size.height < 2.0 {
                continue;
            }
            out.push(WinInfo {
                window_id,
                pid: pid as i32,
                app,
                title,
                x: rect.origin.x,
                y: rect.origin.y,
                w: rect.size.width,
                h: rect.size.height,
            });
            if out.len() >= 40 {
                break;
            }
        }
        out
    }


    /// Screen-point bounds for a CGWindowID from `host_list_windows`.
    pub fn window_bounds(window_id: i64) -> Option<(f64, f64, f64, f64)> {
        if window_id <= 0 {
            return None;
        }
        copy_windows()
            .into_iter()
            .find(|w| w.window_id == window_id)
            .map(|w| (w.x, w.y, w.w, w.h))
    }

    pub fn list_windows(frame_id: String) -> Value {
        let geom = if frame_id.is_empty() {
            None
        } else {
            match load_frame(&frame_id) {
                Ok(g) => Some(g),
                Err(e) => return e,
            }
        };
        let screen = unsafe { CGPreflightScreenCaptureAccess() };
        let wins = copy_windows();
        let mut rows = Vec::new();
        for w in wins {
            let mut row = json!({
                "window_id": w.window_id,
                "pid": w.pid,
                "app": w.app,
                "title": w.title,
                "x_pt": w.x,
                "y_pt": w.y,
                "width_pt": w.w,
                "height_pt": w.h,
            });
            if let Some(g) = geom.as_ref() {
                if let Some((x, y, width, height)) = screen_rect_to_image(g, w.x, w.y, w.w, w.h) {
                    row["x"] = json!(x.round() as i64);
                    row["y"] = json!(y.round() as i64);
                    row["width"] = json!(width.round() as i64);
                    row["height"] = json!(height.round() as i64);
                    row["coord_space"] = json!("image_pixels");
                }
            }
            rows.push(row);
        }
        let mut note = "窗口按从前到后排列。点击请用 host_click 的 frame_id 坐标，或 host_ax 的 element_ref。";
        if !screen {
            note = "没有屏幕录制权限时，窗口标题可能是空的。请到「系统设置 → 隐私与安全性 → 屏幕录制」允许 Open Bot。";
        }
        json!({
            "ok": true,
            "windows": rows,
            "count": rows.len(),
            "frame_id": if frame_id.is_empty() { Value::Null } else { json!(frame_id) },
            "screen_recording": screen,
            "note": note,
        })
    }

    fn copy_attr(el: AXUIElementRef, name: &str) -> Option<CFTypeRef> {
        let key = cf_string(name);
        if key.is_null() {
            return None;
        }
        let _key = Released(key);
        let mut value: CFTypeRef = ptr::null();
        let err = unsafe { AXUIElementCopyAttributeValue(el, key, &mut value) };
        if err != 0 || value.is_null() {
            if !value.is_null() {
                unsafe { CFRelease(value) }
            }
            if err == K_AX_ERROR_API_DISABLED {
                return None;
            }
            return None;
        }
        Some(value)
    }

    fn ax_string(el: AXUIElementRef, name: &str) -> String {
        let Some(v) = copy_attr(el, name) else {
            return String::new();
        };
        let _keep = Released(v);
        unsafe {
            if CFGetTypeID(v) == CFStringGetTypeID() {
                return clip(&read_cf_string(v as CFStringRef), 180);
            }
            if CFGetTypeID(v) == CFNumberGetTypeID() || CFGetTypeID(v) == CFBooleanGetTypeID() {
                if let Some(n) = as_i64(v) {
                    return n.to_string();
                }
            }
        }
        String::new()
    }

    fn ax_point_size(el: AXUIElementRef) -> Option<(f64, f64, f64, f64)> {
        let pos = copy_attr(el, "AXPosition")?;
        let size = copy_attr(el, "AXSize")?;
        let _p = Released(pos);
        let _s = Released(size);
        let mut point = CGPoint { x: 0.0, y: 0.0 };
        let mut sz = CGSize { width: 0.0, height: 0.0 };
        let ok_p = unsafe { AXValueGetValue(pos, 1, &mut point as *mut CGPoint as *mut c_void) };
        let ok_s = unsafe { AXValueGetValue(size, 2, &mut sz as *mut CGSize as *mut c_void) };
        if !ok_p || !ok_s {
            return None;
        }
        Some((point.x, point.y, sz.width, sz.height))
    }

    fn push_element(
        el: AXUIElementRef,
        depth: i32,
        fallback_pid: i32,
        geom: Option<&DisplayGeom>,
        out: &mut Vec<Value>,
    ) {
        let mut pid = fallback_pid;
        let mut got = 0i32;
        if unsafe { AXUIElementGetPid(el, &mut got) } == 0 && got > 0 {
            pid = got;
        }
        let role = ax_string(el, "AXRole");
        let title = ax_string(el, "AXTitle");
        let description = ax_string(el, "AXDescription");
        let value = ax_string(el, "AXValue");
        let bounds = ax_point_size(el);
        let (x_pt, y_pt, w_pt, h_pt) = bounds.unwrap_or((0.0, 0.0, 0.0, 0.0));
        let id = remember_element(ElementGeom {
            pid,
            x_pt,
            y_pt,
            w_pt,
            h_pt,
        });
        let mut row = json!({
            "element_ref": id,
            "role": if role.is_empty() { "AXUnknown".to_string() } else { role },
            "title": title,
            "description": description,
            "value": value,
            "depth": depth,
            "pid": pid,
        });
        if let (Some(g), Some((x, y, w, h))) = (geom, bounds) {
            if let Some((ix, iy, iw, ih)) = screen_rect_to_image(g, x, y, w, h) {
                row["x"] = json!(ix.round() as i64);
                row["y"] = json!(iy.round() as i64);
                row["width"] = json!(iw.round() as i64);
                row["height"] = json!(ih.round() as i64);
                row["coord_space"] = json!("image_pixels");
            }
        } else if bounds.is_some() {
            row["x"] = json!(x_pt.round() as i64);
            row["y"] = json!(y_pt.round() as i64);
            row["width"] = json!(w_pt.round() as i64);
            row["height"] = json!(h_pt.round() as i64);
            row["coord_space"] = json!("screen_points");
        }
        out.push(row);
    }

    fn walk(
        el: AXUIElementRef,
        depth: i32,
        max_depth: i32,
        limit: usize,
        pid: i32,
        geom: Option<&DisplayGeom>,
        out: &mut Vec<Value>,
    ) {
        if out.len() >= limit || el.is_null() {
            return;
        }
        push_element(el, depth, pid, geom, out);
        if depth >= max_depth || out.len() >= limit {
            return;
        }
        let Some(children) = copy_attr(el, "AXChildren") else {
            return;
        };
        let _keep = Released(children);
        unsafe {
            if CFGetTypeID(children) != CFArrayGetTypeID() {
                return;
            }
        }
        let n = unsafe { CFArrayGetCount(children as CFArrayRef) }.min(40);
        for i in 0..n {
            if out.len() >= limit {
                return;
            }
            let child = unsafe { CFArrayGetValueAtIndex(children as CFArrayRef, i) } as AXUIElementRef;
            if child.is_null() {
                continue;
            }
            walk(child, depth + 1, max_depth, limit, pid, geom, out);
        }
    }

    pub struct AxQuery {
        pub frame_id: String,
        pub app: String,
        pub pid: Option<i64>,
        pub window_id: Option<i64>,
        pub max_depth: Option<i64>,
        pub limit: Option<i64>,
        pub x: Option<f64>,
        pub y: Option<f64>,
    }

    fn resolve_pid(q: &AxQuery, wins: &[WinInfo]) -> Result<i32, Value> {
        if let Some(pid) = q.pid {
            if pid > 0 && pid <= i32::MAX as i64 {
                return Ok(pid as i32);
            }
            return Err(cu_error("invalid_args", "pid 无效"));
        }
        if let Some(wid) = q.window_id {
            if let Some(w) = wins.iter().find(|w| w.window_id == wid) {
                return Ok(w.pid);
            }
            return Err(cu_error("window_not_found", "没有这个窗口。请重新列出窗口。"));
        }
        if !q.app.is_empty() {
            let needle = q.app.to_ascii_lowercase();
            if let Some(w) = wins.iter().find(|w| w.app.to_ascii_lowercase().contains(&needle)) {
                return Ok(w.pid);
            }
            return Err(cu_error(
                "app_not_found",
                &format!("没有找到名为「{}」的窗口", q.app),
            ));
        }
        wins.first().map(|w| w.pid).ok_or_else(|| {
            cu_error("app_not_found", "没有找到前台窗口。请先打开要操作的应用。")
        })
    }

    pub fn ax_query(q: AxQuery) -> Value {
        if let Err(e) = ensure_accessibility() {
            return e;
        }
        let geom = if q.frame_id.is_empty() {
            None
        } else {
            match load_frame(&q.frame_id) {
                Ok(g) => Some(g),
                Err(e) => return e,
            }
        };
        if q.x.is_some() || q.y.is_some() {
            let (x, y) = match (q.x, q.y) {
                (Some(x), Some(y)) => (x, y),
                _ => return cu_error("invalid_args", "按坐标查看元素需要同时给出 x 和 y"),
            };
            let Some(g) = geom.as_ref() else {
                return cu_error("missing_frame", MISSING_FRAME_MSG);
            };
            let (sx, sy) = match map_image_point(g, x, y) {
                Ok(p) => p,
                Err(e) => return point_error(e),
            };
            let sys = unsafe { AXUIElementCreateSystemWide() };
            if sys.is_null() {
                return cu_error("ax_failed", "无法读取辅助功能树");
            }
            let _sys = Released(sys as CFTypeRef);
            let mut el: AXUIElementRef = ptr::null_mut();
            let err = unsafe { AXUIElementCopyElementAtPosition(sys, sx as f32, sy as f32, &mut el) };
            if err == K_AX_ERROR_API_DISABLED {
                return cu_error("accessibility_denied", ACCESSIBILITY_DENIED_MSG);
            }
            if err != 0 || el.is_null() {
                return cu_error("ax_failed", "这个坐标上没有可读的界面元素");
            }
            let _el = Released(el as CFTypeRef);
            let mut elements = Vec::new();
            push_element(el, 0, 0, Some(g), &mut elements);
            return json!({
                "ok": true,
                "elements": elements,
                "count": elements.len(),
                "frame_id": q.frame_id,
                "coord_space": "image_pixels",
                "note": "优先用 element_ref 点击。x,y 已换算成这张截图的像素。",
            });
        }
        let depth = q.max_depth.unwrap_or(2).clamp(1, 3) as i32;
        let limit = q.limit.unwrap_or(60).clamp(1, 120) as usize;
        let wins = copy_windows();
        let pid = match resolve_pid(&q, &wins) {
            Ok(p) => p,
            Err(e) => return e,
        };
        let app_name = wins.iter().find(|w| w.pid == pid).map(|w| w.app.clone()).unwrap_or_default();
        let app = unsafe { AXUIElementCreateApplication(pid) };
        if app.is_null() {
            return cu_error("ax_failed", "无法读取这个应用的辅助功能树");
        }
        let _app = Released(app as CFTypeRef);
        let mut elements = Vec::new();
        if let Some(windows) = copy_attr(app, "AXWindows") {
            let _keep = Released(windows);
            unsafe {
                if CFGetTypeID(windows) == CFArrayGetTypeID() {
                    let n = CFArrayGetCount(windows as CFArrayRef).min(6);
                    for i in 0..n {
                        if elements.len() >= limit {
                            break;
                        }
                        let child = CFArrayGetValueAtIndex(windows as CFArrayRef, i) as AXUIElementRef;
                        if child.is_null() {
                            continue;
                        }
                        walk(child, 0, depth, limit, pid, geom.as_ref(), &mut elements);
                    }
                }
            }
        }
        json!({
            "ok": true,
            "app": app_name,
            "pid": pid,
            "elements": elements,
            "count": elements.len(),
            "frame_id": if q.frame_id.is_empty() { Value::Null } else { json!(q.frame_id) },
            "note": "优先用 element_ref 点击。带 frame_id 时 x,y 是截图像素；没有 frame_id 时 x,y 是屏幕点，不要拿去 host_click。",
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn retina_frame() -> DisplayGeom {
        DisplayGeom {
            image_width: 1000,
            image_height: 500,
            origin_x: 100.0,
            origin_y: 40.0,
            width_pt: 1000.0,
            height_pt: 500.0,
            scale: 2.0,
            actionable: true,
        }
    }

    #[test]
    fn image_pixels_map_without_multiplying_retina_scale() {
        let g = retina_frame();
        assert_eq!(map_image_point(&g, 0.0, 0.0).unwrap(), (100.0, 40.0));
        assert_eq!(map_image_point(&g, 1000.0, 500.0).unwrap(), (1100.0, 540.0));
        assert_eq!(map_image_point(&g, 500.0, 250.0).unwrap(), (600.0, 290.0));
        let shrunk = DisplayGeom {
            image_width: 500,
            image_height: 250,
            ..g.clone()
        };
        assert_eq!(map_image_point(&shrunk, 500.0, 250.0).unwrap(), (1100.0, 540.0));
        assert_eq!(map_image_point(&shrunk, 0.0, 0.0).unwrap(), (100.0, 40.0));
    }

    #[test]
    fn rejects_points_outside_the_frame_and_all_display_frames() {
        let g = retina_frame();
        assert_eq!(map_image_point(&g, -3.0, 0.0), Err(PointMapError::OutOfFrame));
        // Two pixels of slop so a slightly-past-the-edge guess still hits the frame.
        assert!(map_image_point(&g, 1002.0, 500.0).is_ok());
        assert_eq!(map_image_point(&g, 1003.0, 10.0), Err(PointMapError::OutOfFrame));
        let all = DisplayGeom { actionable: false, ..g };
        assert_eq!(map_image_point(&all, 10.0, 10.0), Err(PointMapError::NotActionable));
    }

    #[test]
    fn frame_expires() {
        assert!(frame_is_fresh(1_000, 1_000 + FRAME_TTL_MS));
        assert!(!frame_is_fresh(1_000, 1_000 + FRAME_TTL_MS + 1));
    }

    #[test]
    fn keystroke_modifiers_and_aliases() {
        let t = parse_keystroke("cmd+t", &[]).unwrap();
        assert_eq!(t.keycode, 17);
        assert_eq!(t.flags, FLAG_COMMAND);
        let tab = parse_keystroke("shift+tab", &[]).unwrap();
        assert_eq!(tab.keycode, 48);
        assert_eq!(tab.flags, FLAG_SHIFT);
        let ret = parse_keystroke("Return", &["command".into()]).unwrap();
        assert_eq!(ret.keycode, 36);
        assert_eq!(ret.flags, FLAG_COMMAND);
        assert_eq!(parse_keystroke("esc", &[]).unwrap().keycode, 53);
        assert_eq!(parse_keystroke("arrowup", &[]).unwrap().keycode, 126);
        assert!(parse_keystroke("notakey", &[]).is_err());
        assert!(parse_keystroke("", &[]).is_err());
    }

    #[test]
    fn scroll_clamps_and_rejects_zero() {
        assert_eq!(clamp_scroll(1.2, -3.4).unwrap(), (1, -3));
        assert_eq!(clamp_scroll(100.0, 0.0).unwrap(), (40, 0));
        assert!(clamp_scroll(0.0, 0.0).is_err());
        assert!(clamp_scroll(f64::NAN, 1.0).is_err());
    }

    #[test]
    fn screen_rect_uses_image_space_only_on_that_display() {
        let g = retina_frame();
        let hit = screen_rect_to_image(&g, 100.0, 40.0, 200.0, 100.0).unwrap();
        assert_eq!(hit.0, 0.0);
        assert_eq!(hit.1, 0.0);
        assert!(screen_rect_to_image(&g, 5_000.0, 5_000.0, 10.0, 10.0).is_none());
    }

    #[test]
    fn permission_messages_name_the_panes() {
        assert!(ACCESSIBILITY_DENIED_MSG.contains("辅助功能"));
        assert!(EVENT_POSTING_DENIED_MSG.contains("发送事件"));
        assert!(EVENT_POSTING_DENIED_MSG.contains("辅助功能"));
        assert!(LINUX_SCREEN_DENIED_MSG.contains("X11"));
        assert!(LINUX_ACCESSIBILITY_DENIED_MSG.contains("辅助功能"));
        assert!(LINUX_EVENT_POSTING_DENIED_MSG.contains("XTest"));
        assert!(WIN_SCREEN_DENIED_MSG.contains("交互桌面"));
        assert!(WIN_ACCESSIBILITY_DENIED_MSG.contains("UI Automation"));
        assert!(WIN_EVENT_POSTING_DENIED_MSG.contains("UIPI"));
    }

    #[test]
    fn logical_names_map_without_reusing_mac_keycodes() {
        let t = parse_keystroke("cmd+t", &[]).unwrap();
        assert_eq!(t.name, "t");
        assert_eq!(linux_keysym(&t.name), Some(b't' as u32));
        assert_eq!(windows_vk(&t.name), Some(b'T' as u16));
        assert_eq!(linux_keysym("return"), Some(0xff0d));
        assert_eq!(linux_keysym("arrowup"), Some(0xff52));
        assert_eq!(linux_keysym("command"), Some(0xffeb));
        assert_eq!(windows_vk("return"), Some(0x0d));
        assert_eq!(windows_vk("arrowup"), Some(0x26));
        assert_eq!(windows_vk("command"), Some(0x5b));
        assert_eq!(windows_vk("delete"), Some(0x08));
        assert_eq!(windows_vk("del"), Some(0x2e));
        assert!(linux_keysym("notakey").is_none());
        assert!(windows_vk("notakey").is_none());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_capture_is_jpeg_or_a_named_denial() {
        match capture_shot("main", None, 1_200_000) {
            Ok(shot) => {
                assert!(shot.bytes.starts_with(&[0xFF, 0xD8]), "jpeg magic");
                assert!(shot.width > 0 && shot.height > 0);
            }
            Err(err) => {
                assert!(
                    err.code == "screen_recording_denied" || err.code == "screenshot_failed",
                    "{}",
                    err.message
                );
                assert!(
                    err.message.contains("X11") || err.message.contains("截屏"),
                    "{}",
                    err.message
                );
            }
        }
    }
}
