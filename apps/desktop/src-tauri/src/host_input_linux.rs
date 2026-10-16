//! Linux desktop control.
//!
//! Primary path is the X11 protocol (x11rb): RandR for monitors, `GetImage` for
//! screenshots, and the XTest extension for the pointer and keyboard. That is the
//! native API, not a shell-out to xdotool. Accessibility is AT-SPI via libatspi
//! when the library and the a11y bus are present.
//!
//! Wayland without XWayland has no `DISPLAY` and no XTest, so capture and input
//! fail with a permission-style error instead of guessing. `background=true`
//! uses `XSendEvent`; many clients ignore those synthetic events.

use std::ffi::CStr;
use std::os::raw::{c_char, c_void};
use std::process::Command;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use super::{
    background_target, button_name, click_count, cu_error, element_center, frame_point,
    linux_keysym, load_frame, map_image_point, parse_keystroke, point_error,
    publish_element, require_anchor, screen_rect_to_image, CapturedShot, ShotError,
    FLAG_COMMAND, FLAG_CONTROL, FLAG_OPTION, FLAG_SHIFT, LINUX_ACCESSIBILITY_DENIED_MSG,
    LINUX_EVENT_POSTING_DENIED_MSG, LINUX_SCREEN_DENIED_MSG, MAX_TYPE_CHARS,
};
use serde_json::{json, Value};
use x11rb::connection::{Connection, RequestConnection};
use x11rb::x11_utils::Serialize;
use x11rb::protocol::randr::ConnectionExt as _;
use x11rb::protocol::xproto::ConnectionExt as _;
use x11rb::protocol::xproto::{
    AtomEnum, ButtonPressEvent, EventMask, ImageFormat, ImageOrder, KeyButMask,
    MapState, Window, BUTTON_PRESS_EVENT, BUTTON_RELEASE_EVENT, KEY_PRESS_EVENT, KEY_RELEASE_EVENT,
    MOTION_NOTIFY_EVENT,
};
use x11rb::protocol::xtest::ConnectionExt as _;
use x11rb::rust_connection::RustConnection;

static INPUT_LOCK: Mutex<()> = Mutex::new(());

struct Monitor {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    primary: bool,
}

struct X11 {
    conn: RustConnection,
    screen: usize,
    root: Window,
    lsb: bool,
}

impl X11 {
    fn connect() -> Result<Self, ShotError> {
        let (conn, screen) = RustConnection::connect(None).map_err(|_| ShotError {
            code: "screen_recording_denied",
            message: LINUX_SCREEN_DENIED_MSG.to_string(),
        })?;
        let root = conn.setup().roots.get(screen).map(|s| s.root).ok_or_else(|| ShotError {
            code: "screen_recording_denied",
            message: LINUX_SCREEN_DENIED_MSG.to_string(),
        })?;
        let lsb = conn.setup().image_byte_order == ImageOrder::LSB_FIRST;
        Ok(Self { conn, screen, root, lsb })
    }

    fn xtest(&self) -> bool {
        self.conn
            .extension_information(x11rb::protocol::xtest::X11_EXTENSION_NAME)
            .ok()
            .flatten()
            .is_some()
    }

    fn monitors(&self) -> Vec<Monitor> {
        if self
            .conn
            .extension_information(x11rb::protocol::randr::X11_EXTENSION_NAME)
            .ok()
            .flatten()
            .is_some()
        {
            if let Some(reply) = self.conn.randr_get_monitors(self.root, true).ok().and_then(|c| c.reply().ok()) {
                let mons: Vec<Monitor> = reply
                    .monitors
                    .iter()
                    .filter(|m| m.width > 1 && m.height > 1)
                    .map(|m| Monitor {
                        x: m.x as i32,
                        y: m.y as i32,
                        width: m.width as u32,
                        height: m.height as u32,
                        primary: m.primary,
                    })
                    .collect();
                if !mons.is_empty() {
                    return mons;
                }
            }
        }
        let screen = &self.conn.setup().roots[self.screen];
        vec![Monitor {
            x: 0,
            y: 0,
            width: screen.width_in_pixels as u32,
            height: screen.height_in_pixels as u32,
            primary: true,
        }]
    }

    fn grab(&self, x: i32, y: i32, width: u32, height: u32) -> Result<Vec<u8>, ShotError> {
        if width == 0 || height == 0 || width > 16384 || height > 16384 {
            return Err(ShotError {
                code: "screenshot_failed",
                message: "截屏尺寸无效".into(),
            });
        }
        let max_bytes = (self.conn.setup().maximum_request_length as usize)
            .saturating_mul(4)
            .saturating_sub(256)
            .clamp(16_384, 4_000_000);
        let bpp_guess = 4usize;
        let strip = (max_bytes / (width as usize * bpp_guess).max(1))
            .max(1)
            .min(height as usize) as u32;
        let mut rgb = vec![0u8; (width as usize) * (height as usize) * 3];
        let mut row = 0u32;
        while row < height {
            let h = strip.min(height - row);
            let reply = self
                .conn
                .get_image(
                    ImageFormat::Z_PIXMAP,
                    self.root,
                    x as i16,
                    (y + row as i32) as i16,
                    width as u16,
                    h as u16,
                    u32::MAX,
                )
                .map_err(|e| shot_fail(e))?
                .reply()
                .map_err(|e| shot_fail(e))?;
            decode_zpixmap(
                &reply.data,
                reply.depth,
                reply.visual,
                width,
                h,
                self,
                &mut rgb[(row as usize) * (width as usize) * 3..],
            )?;
            row += h;
        }
        Ok(rgb)
    }
}

fn shot_fail(err: impl std::fmt::Display) -> ShotError {
    ShotError {
        code: "screenshot_failed",
        message: format!("截屏失败。{err}"),
    }
}

fn decode_zpixmap(
    data: &[u8],
    depth: u8,
    visual: u32,
    width: u32,
    height: u32,
    x11: &X11,
    out: &mut [u8],
) -> Result<(), ShotError> {
    let setup = x11.conn.setup();
    let (mut red, mut green, mut blue) = (0x00ff0000u32, 0x0000ff00u32, 0x000000ffu32);
    if let Some(screen) = setup.roots.get(x11.screen) {
        for layer in &screen.allowed_depths {
            if let Some(vis) = layer.visuals.iter().find(|v| v.visual_id == visual) {
                red = vis.red_mask;
                green = vis.green_mask;
                blue = vis.blue_mask;
                break;
            }
        }
    }
    let bpp = setup
        .pixmap_formats
        .iter()
        .find(|f| f.depth == depth)
        .map(|f| (f.bits_per_pixel / 8) as usize)
        .filter(|n| *n == 3 || *n == 4)
        .unwrap_or(4);
    let pad = (setup.bitmap_format_scanline_pad as usize / 8).max(1);
    let stride = {
        let raw = width as usize * bpp;
        raw.div_ceil(pad) * pad
    };
    let need = stride.saturating_mul(height as usize);
    if data.len() < need || out.len() < (width as usize) * (height as usize) * 3 {
        return Err(ShotError {
            code: "screenshot_failed",
            message: "截屏像素格式无法解析".into(),
        });
    }
    for y in 0..height as usize {
        for x in 0..width as usize {
            let si = y * stride + x * bpp;
            let pixel = read_pixel(&data[si..si + bpp], x11.lsb);
            let di = (y * width as usize + x) * 3;
            out[di] = channel(pixel, red);
            out[di + 1] = channel(pixel, green);
            out[di + 2] = channel(pixel, blue);
        }
    }
    Ok(())
}

fn read_pixel(bytes: &[u8], lsb: bool) -> u32 {
    let mut buf = [0u8; 4];
    let n = bytes.len().min(4);
    buf[..n].copy_from_slice(&bytes[..n]);
    if lsb {
        u32::from_le_bytes(buf)
    } else if n == 3 {
        u32::from_be_bytes([0, bytes[0], bytes[1], bytes[2]])
    } else {
        u32::from_be_bytes(buf)
    }
}

fn channel(pixel: u32, mask: u32) -> u8 {
    if mask == 0 {
        return 0;
    }
    let shift = mask.trailing_zeros();
    let bits = (mask >> shift).count_ones();
    let raw = (pixel & mask) >> shift;
    if bits >= 8 {
        (raw >> (bits - 8)) as u8
    } else {
        (raw << (8 - bits)) as u8
    }
}

fn pick<'a>(mons: &'a [Monitor], display: Option<u32>) -> Result<&'a Monitor, ShotError> {
    if let Some(n) = display {
        return mons.get((n as usize).saturating_sub(1)).ok_or_else(|| ShotError {
            code: "invalid_display",
            message: "没有这个显示器。display 从 1 开始。".into(),
        });
    }
    mons.iter()
        .find(|m| m.primary)
        .or_else(|| mons.first())
        .ok_or_else(|| ShotError {
            code: "screenshot_failed",
            message: "没有可用的显示器".into(),
        })
}

pub fn display_bounds(_scope: &str, display: Option<u32>) -> Option<(f64, f64, f64, f64, f64)> {
    let x11 = X11::connect().ok()?;
    let mons = x11.monitors();
    let mon = pick(&mons, display).ok()?;
    Some((mon.x as f64, mon.y as f64, mon.width as f64, mon.height as f64, 1.0))
}

pub fn capture_shot(scope: &str, display: Option<u32>, max_bytes: usize) -> Result<CapturedShot, ShotError> {
    let x11 = X11::connect()?;
    let (x, y, width, height) = if display.is_none() && scope.eq_ignore_ascii_case("all") {
        let screen = &x11.conn.setup().roots[x11.screen];
        (0i32, 0i32, screen.width_in_pixels as u32, screen.height_in_pixels as u32)
    } else {
        let mons = x11.monitors();
        let mon = pick(&mons, display)?;
        (mon.x, mon.y, mon.width, mon.height)
    };
    if x < i16::MIN as i32 || y < i16::MIN as i32 || width > u16::MAX as u32 || height > u16::MAX as u32 {
        return Err(ShotError {
            code: "screenshot_failed",
            message: "这块屏幕超出了 X11 截屏能表示的范围".into(),
        });
    }
    let rgb = x11.grab(x, y, width, height)?;
    let (bytes, width, height) = crate::host_raster::rgb_to_jpeg_budget(&rgb, width, height, max_bytes)
        .map_err(|message| ShotError {
            code: if message.contains("太大") {
                "screenshot_too_large"
            } else {
                "screenshot_failed"
            },
            message,
        })?;
    Ok(CapturedShot { bytes, width, height })
}

fn coord(v: f64) -> Result<i16, Value> {
    let r = v.round();
    if r < i16::MIN as f64 || r > i16::MAX as f64 {
        return Err(cu_error("coord_out_of_frame", "坐标超出 X11 能表示的范围"));
    }
    Ok(r as i16)
}

fn ensure_input(x11: &X11) -> Result<(), Value> {
    if x11.xtest() {
        Ok(())
    } else {
        Err(cu_error("event_posting_denied", LINUX_EVENT_POSTING_DENIED_MSG))
    }
}

fn nap(ms: u64) {
    thread::sleep(Duration::from_millis(ms));
}

fn fake(x11: &X11, kind: u8, detail: u8, x: i16, y: i16) -> Result<(), Value> {
    x11.conn
        .xtest_fake_input(kind, detail, 0, x11.root, x, y, 0)
        .map_err(|e| cu_error("input_failed", &format!("发送输入失败。{e}")))?
        .check()
        .map_err(|e| cu_error("input_failed", &format!("发送输入失败。{e}")))?;
    x11.conn
        .flush()
        .map_err(|e| cu_error("input_failed", &format!("发送输入失败。{e}")))
}

fn button_detail(name: &str) -> u8 {
    match name {
        "right" => 3,
        "middle" => 2,
        _ => 1,
    }
}

fn modifier_syms(flags: u64) -> Vec<u32> {
    let mut out = Vec::new();
    if flags & FLAG_SHIFT != 0 {
        out.push(linux_keysym("shift").unwrap_or(0xffe1));
    }
    if flags & FLAG_CONTROL != 0 {
        out.push(linux_keysym("control").unwrap_or(0xffe3));
    }
    if flags & FLAG_OPTION != 0 {
        out.push(linux_keysym("alt").unwrap_or(0xffe9));
    }
    if flags & FLAG_COMMAND != 0 {
        out.push(linux_keysym("command").unwrap_or(0xffeb));
    }
    out
}

struct Keymap {
    min: u8,
    per: usize,
    syms: Vec<u32>,
}

fn keymap(x11: &X11) -> Result<Keymap, Value> {
    let setup = x11.conn.setup();
    let min = setup.min_keycode;
    let max = setup.max_keycode;
    if max < min {
        return Err(cu_error("input_failed", "键盘映射无效"));
    }
    let count = max - min + 1;
    let reply = x11
        .conn
        .get_keyboard_mapping(min, count)
        .map_err(|e| cu_error("input_failed", &e.to_string()))?
        .reply()
        .map_err(|e| cu_error("input_failed", &e.to_string()))?;
    Ok(Keymap {
        min,
        per: reply.keysyms_per_keycode.max(1) as usize,
        syms: reply.keysyms,
    })
}

fn keycode_of(map: &Keymap, keysym: u32) -> Option<u8> {
    if map.per == 0 {
        return None;
    }
    let count = map.syms.len() / map.per;
    for i in 0..count {
        let row = &map.syms[i * map.per..(i + 1) * map.per];
        if row.contains(&keysym) {
            return Some(map.min.saturating_add(i as u8));
        }
    }
    None
}

fn tap_keysym(x11: &X11, map: &mut Keymap, keysym: u32) -> Result<(), Value> {
    if let Some(code) = keycode_of(map, keysym) {
        fake(x11, KEY_PRESS_EVENT, code, 0, 0)?;
        nap(12);
        fake(x11, KEY_RELEASE_EVENT, code, 0, 0)?;
        return Ok(());
    }
    let spare = map.min.saturating_add((map.syms.len() / map.per.max(1)).saturating_sub(1) as u8);
    let idx = (spare - map.min) as usize * map.per;
    if idx + map.per > map.syms.len() {
        return Err(cu_error("input_failed", "这个字符在当前键盘映射里没有键位"));
    }
    let original = map.syms[idx..idx + map.per].to_vec();
    let mut row = vec![0u32; map.per];
    row[0] = keysym;
    let restore = |x11: &X11, row: &[u32]| {
        let _ = x11
            .conn
            .change_keyboard_mapping(1, spare, map.per as u8, row)
            .ok()
            .and_then(|c| c.check().ok());
        let _ = x11.conn.flush();
    };
    x11.conn
        .change_keyboard_mapping(1, spare, map.per as u8, &row)
        .map_err(|e| cu_error("input_failed", &e.to_string()))?
        .check()
        .map_err(|e| cu_error("input_failed", &e.to_string()))?;
    x11.conn.flush().ok();
    let pressed = fake(x11, KEY_PRESS_EVENT, spare, 0, 0);
    nap(12);
    let released = fake(x11, KEY_RELEASE_EVENT, spare, 0, 0);
    restore(x11, &original);
    map.syms[idx..idx + map.per].copy_from_slice(&original);
    pressed?;
    released?;
    Ok(())
}

fn with_modifiers(x11: &X11, map: &mut Keymap, flags: u64, body: impl FnOnce(&X11, &mut Keymap) -> Result<(), Value>) -> Result<(), Value> {
    let mods = modifier_syms(flags);
    for sym in &mods {
        if let Some(code) = keycode_of(map, *sym) {
            fake(x11, KEY_PRESS_EVENT, code, 0, 0)?;
        }
    }
    let result = body(x11, map);
    for sym in mods.iter().rev() {
        if let Some(code) = keycode_of(map, *sym) {
            let _ = fake(x11, KEY_RELEASE_EVENT, code, 0, 0);
        }
    }
    result
}

fn move_ptr(x11: &X11, x: i16, y: i16) -> Result<(), Value> {
    fake(x11, MOTION_NOTIFY_EVENT, 0, x, y)
}

fn click_buttons(x11: &X11, x: i16, y: i16, button: u8, clicks: i32) -> Result<(), Value> {
    move_ptr(x11, x, y)?;
    nap(8);
    for i in 0..clicks {
        fake(x11, BUTTON_PRESS_EVENT, button, x, y)?;
        nap(16);
        fake(x11, BUTTON_RELEASE_EVENT, button, x, y)?;
        if i + 1 != clicks {
            nap(40);
        }
    }
    Ok(())
}

struct WinHit {
    window: Window,
    pid: i32,
    app: String,
    title: String,
    x: i16,
    y: i16,
    w: u16,
    h: u16,
}

fn atom(x11: &X11, name: &str) -> Result<u32, ()> {
    x11.conn
        .intern_atom(false, name.as_bytes())
        .ok()
        .and_then(|c| c.reply().ok())
        .map(|r| r.atom)
        .filter(|a| *a != 0)
        .ok_or(())
}

fn prop_bytes(x11: &X11, window: Window, property: u32, type_: u32) -> Vec<u8> {
    x11.conn
        .get_property(false, window, property, type_, 0, 1024)
        .ok()
        .and_then(|c| c.reply().ok())
        .map(|r| r.value)
        .unwrap_or_default()
}

fn prop_u32(x11: &X11, window: Window, property: u32) -> Option<u32> {
    let bytes = prop_bytes(x11, window, property, AtomEnum::CARDINAL.into());
    let b: [u8; 4] = bytes.get(..4)?.try_into().ok()?;
    Some(if x11.lsb { u32::from_le_bytes(b) } else { u32::from_be_bytes(b) })
}

fn text_prop(x11: &X11, window: Window, property: u32) -> String {
    let bytes = prop_bytes(x11, window, property, AtomEnum::ANY.into());
    let end = bytes.iter().position(|b| *b == 0).unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).chars().filter(|c| !c.is_control()).take(200).collect()
}

fn windows(x11: &X11) -> Vec<WinHit> {
    let Some(list_atom) = atom(x11, "_NET_CLIENT_LIST").ok() else {
        return Vec::new();
    };
    let raw = prop_bytes(x11, x11.root, list_atom, AtomEnum::WINDOW.into());
    let mut ids = Vec::new();
    for chunk in raw.chunks_exact(4) {
        let b = [chunk[0], chunk[1], chunk[2], chunk[3]];
        let id = if x11.lsb { u32::from_le_bytes(b) } else { u32::from_be_bytes(b) };
        if id != 0 {
            ids.push(id);
        }
    }
    ids.reverse();
    let pid_atom = atom(x11, "_NET_WM_PID").unwrap_or(0);
    let name_atom = atom(x11, "_NET_WM_NAME").unwrap_or(0);
    let mut out = Vec::new();
    for window in ids {
        if out.len() >= 40 {
            break;
        }
        let Some(attr) = x11.conn.get_window_attributes(window).ok().and_then(|c| c.reply().ok()) else {
            continue;
        };
        if attr.map_state != MapState::VIEWABLE {
            continue;
        }
        let Some(geom) = x11.conn.get_geometry(window).ok().and_then(|c| c.reply().ok()) else {
            continue;
        };
        if geom.width < 2 || geom.height < 2 {
            continue;
        }
        let translated = x11
            .conn
            .translate_coordinates(window, x11.root, 0, 0)
            .ok()
            .and_then(|c| c.reply().ok());
        let (x, y) = translated.map(|t| (t.dst_x, t.dst_y)).unwrap_or((geom.x, geom.y));
        let pid = if pid_atom == 0 {
            0
        } else {
            prop_u32(x11, window, pid_atom).unwrap_or(0)
        };
        let title = if name_atom != 0 {
            text_prop(x11, window, name_atom)
        } else {
            String::new()
        };
        let title = if title.is_empty() {
            text_prop(x11, window, AtomEnum::WM_NAME.into())
        } else {
            title
        };
        let class_raw = prop_bytes(x11, window, AtomEnum::WM_CLASS.into(), AtomEnum::STRING.into());
        let app = wm_class(&class_raw);
        out.push(WinHit {
            window,
            pid: pid as i32,
            app,
            title,
            x,
            y,
            w: geom.width,
            h: geom.height,
        });
    }
    out
}

fn wm_class(raw: &[u8]) -> String {
    let mut parts = raw.split(|b| *b == 0).filter(|p| !p.is_empty());
    let instance = parts.next().map(|p| String::from_utf8_lossy(p).to_string()).unwrap_or_default();
    let class = parts.next().map(|p| String::from_utf8_lossy(p).to_string()).unwrap_or_default();
    if !class.is_empty() {
        class
    } else {
        instance
    }
}

fn find_window<'a>(wins: &'a [WinHit], pid: i32) -> Option<&'a WinHit> {
    wins.iter().find(|w| w.pid == pid && pid > 0)
}

fn send_button(x11: &X11, win: &WinHit, button: u8, press: bool, x: i16, y: i16) -> Result<(), Value> {
    let ev = ButtonPressEvent {
        response_type: if press { BUTTON_PRESS_EVENT } else { BUTTON_RELEASE_EVENT },
        detail: button,
        sequence: 0,
        time: 0,
        root: x11.root,
        event: win.window,
        child: 0,
        root_x: x,
        root_y: y,
        event_x: x.saturating_sub(win.x),
        event_y: y.saturating_sub(win.y),
        state: KeyButMask::default(),
        same_screen: true,
    };
    x11.conn
        .send_event(false, win.window, EventMask::NO_EVENT, ev.serialize())
        .map_err(|e| cu_error("input_failed", &e.to_string()))?
        .check()
        .map_err(|e| cu_error("input_failed", &e.to_string()))?;
    x11.conn.flush().map_err(|e| cu_error("input_failed", &e.to_string()))
}

fn ok_action(action: &str, background: bool, delivery: &str, extra: Value) -> Value {
    let mut row = json!({
        "ok": true,
        "action": action,
        "background": background,
        "delivery": delivery,
        "platform": "linux",
    });
    if let (Some(obj), Value::Object(extra)) = (row.as_object_mut(), extra) {
        for (k, v) in extra {
            obj.insert(k, v);
        }
    }
    if background {
        row["note"] = json!("background=true 走 XSendEvent，不少应用会忽略。若画面没变，去掉 background 再试（会移动全局指针）。");
    }
    row
}

pub fn click(
    frame_id: String,
    x: Option<f64>,
    y: Option<f64>,
    button: Option<String>,
    clicks: Option<i64>,
    modifiers: Vec<String>,
    element_ref: String,
    background: bool,
    pid: Option<i64>,
) -> Value {
    let button = match button_name(&button) {
        Ok(b) => b,
        Err(e) => return e,
    };
    let clicks = match click_count(clicks) {
        Ok(n) => n,
        Err(e) => return e,
    };
    let mut flags = 0u64;
    for m in &modifiers {
        match super::modifier_flag(&m.trim().to_ascii_lowercase()) {
            Some(f) => flags |= f,
            None if !m.trim().is_empty() => return cu_error("invalid_args", &format!("不认识的修饰键：{m}")),
            None => {}
        }
    }
    let (sx, sy, element_pid, via) = if !element_ref.is_empty() {
        match element_center(&element_ref) {
            Ok((x, y, pid)) => (x, y, Some(pid), "element"),
            Err(e) => return e,
        }
    } else {
        match frame_point(&frame_id, x, y) {
            Ok((x, y)) => (x, y, None, "frame"),
            Err(e) => return e,
        }
    };
    let target = match background_target(background, pid, element_pid) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let _guard = INPUT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let x11 = match X11::connect() {
        Ok(v) => v,
        Err(e) => return cu_error(e.code, &e.message),
    };
    if let Err(e) = ensure_input(&x11) {
        return e;
    }
    let (ix, iy) = match (coord(sx), coord(sy)) {
        (Ok(x), Ok(y)) => (x, y),
        (Err(e), _) | (_, Err(e)) => return e,
    };
    let detail = button_detail(button);
    let delivery = if let Some(pid) = target {
        let wins = windows(&x11);
        let Some(win) = find_window(&wins, pid) else {
            return cu_error("window_not_found", "没有找到这个 pid 的窗口，不能在后台点击。");
        };
        for _ in 0..clicks {
            if send_button(&x11, win, detail, true, ix, iy).is_err() {
                return cu_error("input_failed", "后台点击失败");
            }
            nap(16);
            if send_button(&x11, win, detail, false, ix, iy).is_err() {
                return cu_error("input_failed", "后台点击失败");
            }
        }
        "xsend_event"
    } else {
        let mut map = match keymap(&x11) {
            Ok(m) => m,
            Err(e) => return e,
        };
        if let Err(e) = with_modifiers(&x11, &mut map, flags, |x11, _| click_buttons(x11, ix, iy, detail, clicks)) {
            return e;
        }
        "xtest"
    };
    ok_action(
        "click",
        background,
        delivery,
        json!({ "via": via, "button": button, "clicks": clicks, "x_pt": sx, "y_pt": sy, "frame_id": frame_or_null(&frame_id) }),
    )
}

fn frame_or_null(frame_id: &str) -> Value {
    if frame_id.is_empty() {
        Value::Null
    } else {
        json!(frame_id)
    }
}

pub fn type_text(frame_id: String, text: String, element_ref: String, background: bool, pid: Option<i64>) -> Value {
    let count = text.chars().count();
    if count == 0 {
        return cu_error("invalid_args", "text 是空的");
    }
    if count > MAX_TYPE_CHARS {
        return cu_error("invalid_args", "一次最多输入 2000 个字符");
    }
    let anchor = match require_anchor(&frame_id, &element_ref) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let target = match background_target(background, pid, anchor) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let _guard = INPUT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let x11 = match X11::connect() {
        Ok(v) => v,
        Err(e) => return cu_error(e.code, &e.message),
    };
    if let Err(e) = ensure_input(&x11) {
        return e;
    }
    if target.is_some() {
        return cu_error(
            "background_limited",
            "Linux 后台输入文字不可靠（XSendEvent 会被多数应用丢掉）。请去掉 background，或改用前台 host_type。",
        );
    }
    if !element_ref.is_empty() {
        if let Ok((x, y, _)) = element_center(&element_ref) {
            if let (Ok(ix), Ok(iy)) = (coord(x), coord(y)) {
                if let Err(e) = click_buttons(&x11, ix, iy, 1, 1) {
                    return e;
                }
                nap(30);
            }
        }
    }
    let mut map = match keymap(&x11) {
        Ok(m) => m,
        Err(e) => return e,
    };
    for ch in text.chars() {
        let sym = if ch == '\n' || ch == '\r' {
            linux_keysym("return").unwrap_or(0xff0d)
        } else if ch == '\t' {
            linux_keysym("tab").unwrap_or(0xff09)
        } else {
            let cp = ch as u32;
            if cp <= 0xff { cp } else { 0x0100_0000 + cp }
        };
        if let Err(e) = tap_keysym(&x11, &mut map, sym) {
            return e;
        }
        nap(4);
    }
    ok_action("type", false, "xtest", json!({ "chars": count }))
}

pub fn press_key(
    frame_id: String,
    key: String,
    modifiers: Vec<String>,
    element_ref: String,
    background: bool,
    pid: Option<i64>,
) -> Value {
    let stroke = match parse_keystroke(&key, &modifiers) {
        Ok(s) => s,
        Err(msg) => return cu_error("invalid_args", &msg),
    };
    let anchor = match require_anchor(&frame_id, &element_ref) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let target = match background_target(background, pid, anchor) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let Some(sym) = linux_keysym(&stroke.name) else {
        return cu_error("invalid_args", &format!("不认识的按键：{}", stroke.name));
    };
    let _guard = INPUT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let x11 = match X11::connect() {
        Ok(v) => v,
        Err(e) => return cu_error(e.code, &e.message),
    };
    if let Err(e) = ensure_input(&x11) {
        return e;
    }
    if target.is_some() {
        return cu_error(
            "background_limited",
            "Linux 后台按键走 XSendEvent，多数应用会忽略。请去掉 background 再用 host_key。",
        );
    }
    let mut map = match keymap(&x11) {
        Ok(m) => m,
        Err(e) => return e,
    };
    if let Err(e) = with_modifiers(&x11, &mut map, stroke.flags, |x11, map| tap_keysym(x11, map, sym)) {
        return e;
    }
    ok_action("key", false, "xtest", json!({ "key": key }))
}

pub fn scroll(frame_id: String, x: Option<f64>, y: Option<f64>, dx: f64, dy: f64, background: bool, pid: Option<i64>) -> Value {
    let (dx, dy) = match super::clamp_scroll(dx, dy) {
        Ok(v) => v,
        Err(msg) => return cu_error("invalid_args", &msg),
    };
    let (sx, sy) = match frame_point(&frame_id, x, y) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let target = match background_target(background, pid, None) {
        Ok(p) => p,
        Err(e) => return e,
    };
    if target.is_some() {
        return cu_error("background_limited", "Linux 后台滚动不可用。请去掉 background，在光标处滚动。");
    }
    let (ix, iy) = match (coord(sx), coord(sy)) {
        (Ok(x), Ok(y)) => (x, y),
        (Err(e), _) | (_, Err(e)) => return e,
    };
    let _guard = INPUT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let x11 = match X11::connect() {
        Ok(v) => v,
        Err(e) => return cu_error(e.code, &e.message),
    };
    if let Err(e) = ensure_input(&x11) {
        return e;
    }
    if let Err(e) = move_ptr(&x11, ix, iy) {
        return e;
    }
    let repeat = |button: u8, n: i32| -> Result<(), Value> {
        for _ in 0..n {
            fake(&x11, BUTTON_PRESS_EVENT, button, ix, iy)?;
            fake(&x11, BUTTON_RELEASE_EVENT, button, ix, iy)?;
        }
        Ok(())
    };
    if dy > 0 {
        if let Err(e) = repeat(4, dy) {
            return e;
        }
    } else if dy < 0 {
        if let Err(e) = repeat(5, -dy) {
            return e;
        }
    }
    if dx > 0 {
        if let Err(e) = repeat(7, dx) {
            return e;
        }
    } else if dx < 0 {
        if let Err(e) = repeat(6, -dx) {
            return e;
        }
    }
    ok_action("scroll", false, "xtest", json!({ "dx": dx, "dy": dy, "frame_id": frame_id }))
}

pub fn mouse_move(frame_id: String, x: Option<f64>, y: Option<f64>, background: bool, pid: Option<i64>) -> Value {
    let (sx, sy) = match frame_point(&frame_id, x, y) {
        Ok(p) => p,
        Err(e) => return e,
    };
    if background_target(background, pid, None).ok().flatten().is_some() || background {
        return cu_error("background_limited", "Linux 不能在不移动全局指针的情况下移动鼠标。请去掉 background。");
    }
    let (ix, iy) = match (coord(sx), coord(sy)) {
        (Ok(x), Ok(y)) => (x, y),
        (Err(e), _) | (_, Err(e)) => return e,
    };
    let _guard = INPUT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let x11 = match X11::connect() {
        Ok(v) => v,
        Err(e) => return cu_error(e.code, &e.message),
    };
    if let Err(e) = ensure_input(&x11) {
        return e;
    }
    if let Err(e) = move_ptr(&x11, ix, iy) {
        return e;
    }
    ok_action("mouse_move", false, "xtest", json!({ "x_pt": sx, "y_pt": sy, "frame_id": frame_id }))
}

pub fn drag(
    frame_id: String,
    x: Option<f64>,
    y: Option<f64>,
    x2: Option<f64>,
    y2: Option<f64>,
    button: Option<String>,
    background: bool,
    pid: Option<i64>,
) -> Value {
    let button = match button_name(&button) {
        Ok(b) => b,
        Err(e) => return e,
    };
    let geom = match load_frame(&frame_id) {
        Ok(g) => g,
        Err(e) => return e,
    };
    let (x, y, x2, y2) = match (x, y, x2, y2) {
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
    if background || background_target(background, pid, None).ok().flatten().is_some() {
        return cu_error("background_limited", "Linux 后台拖拽不可用。请去掉 background。");
    }
    let points = [(sx, sy), (ex, ey)];
    let mut mapped = [(0i16, 0i16); 2];
    for (i, (px, py)) in points.iter().enumerate() {
        mapped[i] = match (coord(*px), coord(*py)) {
            (Ok(a), Ok(b)) => (a, b),
            (Err(e), _) | (_, Err(e)) => return e,
        };
    }
    let _guard = INPUT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let x11 = match X11::connect() {
        Ok(v) => v,
        Err(e) => return cu_error(e.code, &e.message),
    };
    if let Err(e) = ensure_input(&x11) {
        return e;
    }
    let detail = button_detail(button);
    let (x0, y0) = mapped[0];
    let (x1, y1) = mapped[1];
    if let Err(e) = move_ptr(&x11, x0, y0) {
        return e;
    }
    nap(8);
    if let Err(e) = fake(&x11, BUTTON_PRESS_EVENT, detail, x0, y0) {
        return e;
    }
    nap(16);
    for i in 1..=8 {
        let t = i as f64 / 8.0;
        let mx = (x0 as f64 + (x1 as f64 - x0 as f64) * t).round() as i16;
        let my = (y0 as f64 + (y1 as f64 - y0 as f64) * t).round() as i16;
        if let Err(e) = move_ptr(&x11, mx, my) {
            return e;
        }
        nap(10);
    }
    if let Err(e) = fake(&x11, BUTTON_RELEASE_EVENT, detail, x1, y1) {
        return e;
    }
    ok_action("drag", false, "xtest", json!({ "button": button, "frame_id": frame_id }))
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
    let x11 = match X11::connect() {
        Ok(v) => v,
        Err(e) => return cu_error(e.code, &e.message),
    };
    let wins = windows(&x11);
    let mut rows = Vec::new();
    for w in wins {
        let mut row = json!({
            "window_id": w.window,
            "pid": w.pid,
            "app": w.app,
            "title": w.title,
            "x_pt": w.x,
            "y_pt": w.y,
            "width_pt": w.w,
            "height_pt": w.h,
        });
        if let Some(g) = geom.as_ref() {
            if let Some((x, y, width, height)) = screen_rect_to_image(g, w.x as f64, w.y as f64, w.w as f64, w.h as f64) {
                row["x"] = json!(x.round() as i64);
                row["y"] = json!(y.round() as i64);
                row["width"] = json!(width.round() as i64);
                row["height"] = json!(height.round() as i64);
                row["coord_space"] = json!("image_pixels");
            }
        }
        rows.push(row);
    }
    json!({
        "ok": true,
        "platform": "linux",
        "windows": rows,
        "count": rows.len(),
        "frame_id": frame_or_null(&frame_id),
        "screen_recording": true,
        "note": "窗口按从前到后排列（X11 _NET_CLIENT_LIST）。点击用 host_click 的 frame_id 坐标，或 host_ax 的 element_ref。",
    })
}

pub fn ax_query(
    frame_id: String,
    app: String,
    pid: Option<i64>,
    window_id: Option<i64>,
    max_depth: Option<i64>,
    limit: Option<i64>,
    x: Option<f64>,
    y: Option<f64>,
) -> Value {
    let geom = if frame_id.is_empty() {
        None
    } else {
        match load_frame(&frame_id) {
            Ok(g) => Some(g),
            Err(e) => return e,
        }
    };
    let x11 = match X11::connect() {
        Ok(v) => v,
        Err(e) => return cu_error(e.code, &e.message),
    };
    let wins = windows(&x11);
    let target_pid = if let Some(pid) = pid {
        if pid <= 0 || pid > i32::MAX as i64 {
            return cu_error("invalid_args", "pid 无效");
        }
        pid as i32
    } else if let Some(wid) = window_id {
        match wins.iter().find(|w| w.window as i64 == wid) {
            Some(w) => w.pid,
            None => return cu_error("window_not_found", "没有这个窗口。请重新列出窗口。"),
        }
    } else if !app.is_empty() {
        let needle = app.to_ascii_lowercase();
        match wins.iter().find(|w| w.app.to_ascii_lowercase().contains(&needle) || w.title.to_ascii_lowercase().contains(&needle)) {
            Some(w) => w.pid,
            None => return cu_error("app_not_found", &format!("没有找到名为「{app}」的窗口")),
        }
    } else {
        wins.first().map(|w| w.pid).unwrap_or(0)
    };
    let Some(bus) = Atspi::open() else {
        return cu_error("accessibility_denied", LINUX_ACCESSIBILITY_DENIED_MSG);
    };
    if x.is_some() || y.is_some() {
        let (ix, iy) = match (x, y) {
            (Some(x), Some(y)) => (x, y),
            _ => return cu_error("invalid_args", "按坐标查看元素需要同时给出 x 和 y"),
        };
        let Some(g) = geom.as_ref() else {
            return cu_error("missing_frame", super::MISSING_FRAME_MSG);
        };
        let (sx, sy) = match map_image_point(g, ix, iy) {
            Ok(p) => p,
            Err(e) => return point_error(e),
        };
        let mut elements = Vec::new();
        if !bus.hit(sx, sy, g, &mut elements) {
            return cu_error("ax_failed", "这个坐标上没有可读的界面元素");
        }
        return json!({
            "ok": true,
            "platform": "linux",
            "elements": elements,
            "count": elements.len(),
            "frame_id": frame_id,
            "coord_space": "image_pixels",
            "note": "优先用 element_ref 点击。x,y 已换算成这张截图的像素。Linux 读的是 AT-SPI。",
        });
    }
    let depth = max_depth.unwrap_or(2).clamp(1, 3);
    let limit = limit.unwrap_or(60).clamp(1, 120) as usize;
    let mut elements = Vec::new();
    let app_name = wins.iter().find(|w| w.pid == target_pid).map(|w| w.app.clone()).unwrap_or_default();
    if !bus.walk_pid(target_pid, &app, depth, limit, geom.as_ref(), &mut elements) && elements.is_empty() {
        return cu_error("accessibility_denied", LINUX_ACCESSIBILITY_DENIED_MSG);
    }
    json!({
        "ok": true,
        "platform": "linux",
        "app": app_name,
        "pid": target_pid,
        "elements": elements,
        "count": elements.len(),
        "frame_id": frame_or_null(&frame_id),
        "note": "优先用 element_ref 点击。带 frame_id 时 x,y 是截图像素。Linux 读的是 AT-SPI，不是 macOS AX。",
    })
}

pub fn tcc_status() -> Value {
    let screen = X11::connect();
    let posting = screen.as_ref().map(|x| x.xtest()).unwrap_or(false);
    let accessibility = Atspi::open().is_some();
    json!({
        "ok": true,
        "platform": "linux",
        "screen_recording": {
            "granted": screen.is_ok(),
            "settings": "图形会话的 X11 DISPLAY（XWayland 也可以）。没有单独的 macOS 式屏幕录制开关",
        },
        "accessibility": {
            "granted": accessibility,
            "settings": "安装 at-spi2-core，并打开桌面辅助功能（GNOME：设置 → 辅助功能）",
        },
        "event_posting": {
            "granted": posting,
            "settings": "X11 的 XTest 扩展。不使用 xdotool。Wayland 原生会话请改用带 XWayland 的会话",
        },
        "input_backend": "x11_xtest",
    })
}

pub fn open_privacy(pane: &str) -> Result<Value, String> {
    let (cmds, hint): (&[(&str, &[&str])], &str) = match pane {
        "accessibility" | "assistive" => (
            &[
                ("gnome-control-center", &["universal-access"]),
                ("xfce4-accessibility-settings", &[]),
            ],
            "请打开桌面设置里的辅助功能，并确认已安装 at-spi2-core。",
        ),
        "screen" | "screen_recording" | "screencapture" => (
            &[
                ("gnome-control-center", &["display"]),
                ("xfce4-display-settings", &[]),
            ],
            "Linux 截屏走 X11 DISPLAY。请确认当前会话有显示服务器（X11 或 XWayland）。",
        ),
        "event" | "event_posting" | "post_event" => (
            &[("gnome-control-center", &["mouse"])],
            "键鼠走 X11 XTest，不是一项可切换的隐私开关。请使用 X11 或 XWayland 会话。",
        ),
        _ => return Err("未知的隐私设置页".into()),
    };
    for (bin, args) in cmds {
        if Command::new(bin)
            .args(*args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .is_ok()
        {
            return Ok(json!({ "ok": true, "pane": pane, "platform": "linux" }));
        }
    }
    Err(hint.into())
}

struct Atspi {
    atspi: libloading::Library,
    glib: libloading::Library,
    gobject: libloading::Library,
}

impl Atspi {
    fn open() -> Option<Self> {
        let atspi = unsafe { libloading::Library::new("libatspi.so.0").ok()? };
        let glib = unsafe { libloading::Library::new("libglib-2.0.so.0").ok()? };
        let gobject = unsafe { libloading::Library::new("libgobject-2.0.so.0").ok()? };
        let bus = Self { atspi, glib, gobject };
        let init: libloading::Symbol<unsafe extern "C" fn() -> i32> = unsafe { bus.atspi.get(b"atspi_init\0").ok()? };
        if unsafe { init() } != 0 {
            return None;
        }
        Some(bus)
    }

    fn desktop(&self) -> *mut c_void {
        let Ok(f) = (unsafe { self.atspi.get::<unsafe extern "C" fn(i32) -> *mut c_void>(b"atspi_get_desktop\0") }) else {
            return std::ptr::null_mut();
        };
        unsafe { f(0) }
    }

    fn child_count(&self, obj: *mut c_void) -> i32 {
        if obj.is_null() {
            return 0;
        }
        let Ok(f) = (unsafe {
            self.atspi.get::<unsafe extern "C" fn(*mut c_void, *mut *mut c_void) -> i32>(b"atspi_accessible_get_child_count\0")
        }) else {
            return 0;
        };
        let mut err = std::ptr::null_mut();
        let n = unsafe { f(obj, &mut err) };
        self.free_err(err);
        n.max(0)
    }

    fn child_at(&self, obj: *mut c_void, index: i32) -> *mut c_void {
        let Ok(f) = (unsafe {
            self.atspi.get::<unsafe extern "C" fn(*mut c_void, i32, *mut *mut c_void) -> *mut c_void>(
                b"atspi_accessible_get_child_at_index\0",
            )
        }) else {
            return std::ptr::null_mut();
        };
        let mut err = std::ptr::null_mut();
        let child = unsafe { f(obj, index, &mut err) };
        self.free_err(err);
        child
    }

    fn string_attr(&self, obj: *mut c_void, symbol: &[u8]) -> String {
        let Ok(f) = (unsafe { self.atspi.get::<unsafe extern "C" fn(*mut c_void, *mut *mut c_void) -> *mut c_char>(symbol) }) else {
            return String::new();
        };
        let mut err = std::ptr::null_mut();
        let ptr = unsafe { f(obj, &mut err) };
        self.free_err(err);
        self.take_cstr(ptr)
    }

    fn pid_of(&self, obj: *mut c_void) -> i32 {
        let Ok(f) = (unsafe { self.atspi.get::<unsafe extern "C" fn(*mut c_void, *mut *mut c_void) -> i32>(b"atspi_accessible_get_process_id\0") }) else {
            return 0;
        };
        let mut err = std::ptr::null_mut();
        let pid = unsafe { f(obj, &mut err) };
        self.free_err(err);
        pid
    }

    fn extents(&self, obj: *mut c_void) -> Option<(f64, f64, f64, f64)> {
        let Ok(component) = (unsafe { self.atspi.get::<unsafe extern "C" fn(*mut c_void) -> *mut c_void>(b"atspi_accessible_get_component_iface\0") }) else {
            return None;
        };
        let comp = unsafe { component(obj) };
        if comp.is_null() {
            return None;
        }
        let Ok(extents) = (unsafe {
            self.atspi.get::<unsafe extern "C" fn(*mut c_void, i32, *mut *mut c_void) -> *mut i32>(b"atspi_component_get_extents\0")
        }) else {
            self.unref(comp);
            return None;
        };
        let mut err = std::ptr::null_mut();
        let rect = unsafe { extents(comp, 0, &mut err) };
        self.free_err(err);
        self.unref(comp);
        if rect.is_null() {
            return None;
        }
        let vals = unsafe { std::slice::from_raw_parts(rect, 4) };
        let out = Some((vals[0] as f64, vals[1] as f64, vals[2] as f64, vals[3] as f64));
        self.g_free(rect as *mut c_void);
        out
    }

    fn hit(&self, x: f64, y: f64, geom: &super::DisplayGeom, out: &mut Vec<Value>) -> bool {
        let desktop = self.desktop();
        if desktop.is_null() {
            return false;
        }
        let Ok(component) = (unsafe { self.atspi.get::<unsafe extern "C" fn(*mut c_void) -> *mut c_void>(b"atspi_accessible_get_component_iface\0") }) else {
            self.unref(desktop);
            return false;
        };
        let comp = unsafe { component(desktop) };
        if comp.is_null() {
            self.unref(desktop);
            return false;
        }
        let Ok(at) = (unsafe {
            self.atspi.get::<unsafe extern "C" fn(*mut c_void, i32, i32, i32, *mut *mut c_void) -> *mut c_void>(
                b"atspi_component_get_accessible_at_point\0",
            )
        }) else {
            self.unref(comp);
            self.unref(desktop);
            return false;
        };
        let mut err = std::ptr::null_mut();
        let el = unsafe { at(comp, x.round() as i32, y.round() as i32, 0, &mut err) };
        self.free_err(err);
        self.unref(comp);
        self.unref(desktop);
        if el.is_null() {
            return false;
        }
        self.push(el, 0, Some(geom), out);
        self.unref(el);
        !out.is_empty()
    }

    fn walk_pid(
        &self,
        pid: i32,
        app_filter: &str,
        max_depth: i64,
        limit: usize,
        geom: Option<&super::DisplayGeom>,
        out: &mut Vec<Value>,
    ) -> bool {
        let desktop = self.desktop();
        if desktop.is_null() {
            return false;
        }
        let n = self.child_count(desktop).min(80);
        let needle = app_filter.to_ascii_lowercase();
        for i in 0..n {
            if out.len() >= limit {
                break;
            }
            let app = self.child_at(desktop, i);
            if app.is_null() {
                continue;
            }
            let app_pid = self.pid_of(app);
            let name = self.string_attr(app, b"atspi_accessible_get_name\0");
            let pid_ok = pid <= 0 || app_pid == pid;
            let name_ok = needle.is_empty() || name.to_ascii_lowercase().contains(&needle);
            if pid_ok && name_ok {
                self.walk(app, 0, max_depth as i32, limit, app_pid, geom, out);
            }
            self.unref(app);
        }
        self.unref(desktop);
        true
    }

    fn walk(
        &self,
        el: *mut c_void,
        depth: i32,
        max_depth: i32,
        limit: usize,
        fallback_pid: i32,
        geom: Option<&super::DisplayGeom>,
        out: &mut Vec<Value>,
    ) {
        if el.is_null() || out.len() >= limit {
            return;
        }
        self.push(el, depth, geom, out);
        if depth >= max_depth || out.len() >= limit {
            return;
        }
        let n = self.child_count(el).min(40);
        for i in 0..n {
            if out.len() >= limit {
                return;
            }
            let child = self.child_at(el, i);
            if child.is_null() {
                continue;
            }
            let _ = fallback_pid;
            self.walk(child, depth + 1, max_depth, limit, fallback_pid, geom, out);
            self.unref(child);
        }
    }

    fn push(&self, el: *mut c_void, depth: i32, geom: Option<&super::DisplayGeom>, out: &mut Vec<Value>) {
        let role = self.string_attr(el, b"atspi_accessible_get_role_name\0");
        let title = self.string_attr(el, b"atspi_accessible_get_name\0");
        let description = self.string_attr(el, b"atspi_accessible_get_description\0");
        let pid = self.pid_of(el).max(0);
        out.push(publish_element(
            pid,
            if role.is_empty() { "unknown" } else { &role },
            &title,
            &description,
            "",
            depth,
            self.extents(el),
            geom.filter(|g| g.actionable),
        ));
    }

    fn take_cstr(&self, ptr: *mut c_char) -> String {
        if ptr.is_null() {
            return String::new();
        }
        let text = unsafe { CStr::from_ptr(ptr) }.to_string_lossy().chars().filter(|c| !c.is_control()).take(200).collect();
        self.g_free(ptr as *mut c_void);
        text
    }

    fn g_free(&self, ptr: *mut c_void) {
        if ptr.is_null() {
            return;
        }
        if let Ok(f) = unsafe { self.glib.get::<unsafe extern "C" fn(*mut c_void)>(b"g_free\0") } {
            unsafe { f(ptr) };
        }
    }

    fn free_err(&self, err: *mut c_void) {
        if err.is_null() {
            return;
        }
        if let Ok(f) = unsafe { self.glib.get::<unsafe extern "C" fn(*mut c_void)>(b"g_error_free\0") } {
            unsafe { f(err) };
        }
    }

    fn unref(&self, obj: *mut c_void) {
        if obj.is_null() {
            return;
        }
        if let Ok(f) = unsafe { self.gobject.get::<unsafe extern "C" fn(*mut c_void)>(b"g_object_unref\0") } {
            unsafe { f(obj) };
        }
    }
}
