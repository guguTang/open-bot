//! Windows desktop control.
//!
//! Screenshots use GDI (`GetDC` + `BitBlt`). Pointer and keyboard use `SendInput`.
//! Window lists use `EnumWindows`. The accessibility tree is UI Automation.
//! None of this shells out to an external clicker.
//!
//! `background=true` posts window messages. Apps that only read raw input ignore
//! them. Input into a higher-integrity (administrator) window is blocked by UIPI
//! unless Open Bot is elevated too.

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use super::{
    background_target, button_name, click_count, clamp_scroll, cu_error, element_center, frame_point,
    load_frame, map_image_point, modifier_flag, parse_keystroke, point_error, publish_element,
    require_anchor, screen_rect_to_image, windows_vk, CapturedShot, ShotError, FLAG_COMMAND,
    FLAG_CONTROL, FLAG_OPTION, FLAG_SHIFT, MAX_TYPE_CHARS, MISSING_FRAME_MSG,
    WIN_ACCESSIBILITY_DENIED_MSG, WIN_EVENT_POSTING_DENIED_MSG, WIN_SCREEN_DENIED_MSG,
};
use serde_json::{json, Value};
use windows::core::GUID;
use windows::Win32::Foundation::{CloseHandle, BOOL, HWND, LPARAM, POINT, RECT, TRUE, WPARAM};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, EnumDisplayMonitors,
    GetDC, GetDIBits, GetMonitorInfoW, ReleaseDC, ScreenToClient, SelectObject, BITMAPINFO,
    BITMAPINFOHEADER, DIB_RGB_COLORS, HDC, HMONITOR, MONITORINFO, SRCCOPY,
};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
use windows::Win32::System::StationsAndDesktops::{CloseDesktop, OpenInputDesktop, DESKTOP_READOBJECTS};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Accessibility::{IUIAutomation, IUIAutomationElement, IUIAutomationTreeWalker};
use windows::Win32::UI::HiDpi::{
    GetDpiForMonitor, SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
    MDT_EFFECTIVE_DPI,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYBD_EVENT_FLAGS,
    KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, MOUSEINPUT, MOUSE_EVENT_FLAGS, MOUSEEVENTF_ABSOLUTE,
    MOUSEEVENTF_HWHEEL, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN,
    MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP,
    MOUSEEVENTF_VIRTUALDESK, MOUSEEVENTF_WHEEL, VIRTUAL_KEY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetForegroundWindow, GetSystemMetrics, GetWindowRect, GetWindowTextLengthW,
    GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible, MONITORINFOF_PRIMARY, PostMessageW,
    SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, WM_CHAR, WM_KEYDOWN,
    WM_KEYUP, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN, WM_MBUTTONUP, WM_RBUTTONDOWN, WM_RBUTTONUP,
};

const CLSID_CUIAUTOMATION: GUID = GUID::from_u128(0xff48dba4_60ef_4201_aa87_54103eef594e);

struct Monitor {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    primary: bool,
    dpi: u32,
}

fn nap(ms: u64) {
    thread::sleep(Duration::from_millis(ms));
}

fn prepare_dpi() {
    static ONCE: AtomicBool = AtomicBool::new(false);
    if ONCE.swap(true, Ordering::SeqCst) {
        return;
    }
    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
}

fn monitors() -> Vec<Monitor> {
    prepare_dpi();
    let mut list: Vec<Monitor> = Vec::new();
    unsafe extern "system" fn each(hmon: HMONITOR, _hdc: HDC, _rect: *mut RECT, data: LPARAM) -> BOOL {
        let list = &mut *(data.0 as *mut Vec<Monitor>);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..MONITORINFO::default()
        };
        if GetMonitorInfoW(hmon, &mut info).as_bool() {
            let r = info.rcMonitor;
            let mut dpi_x = 96u32;
            let mut dpi_y = 96u32;
            let _ = GetDpiForMonitor(hmon, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y);
            list.push(Monitor {
                x: r.left,
                y: r.top,
                width: r.right - r.left,
                height: r.bottom - r.top,
                primary: info.dwFlags & MONITORINFOF_PRIMARY != 0,
                dpi: dpi_x.max(96),
            });
        }
        TRUE
    }
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(each), LPARAM(&mut list as *mut Vec<Monitor> as isize));
    }
    list
}

fn pick<'a>(mons: &'a [Monitor], display: Option<u32>) -> Result<&'a Monitor, ShotError> {
    if let Some(n) = display {
        return mons.get((n as usize).saturating_sub(1)).ok_or_else(|| ShotError {
            code: "invalid_display",
            message: "没有这个显示器。display 从 1 开始。".into(),
        });
    }
    mons.iter().find(|m| m.primary).or_else(|| mons.first()).ok_or_else(|| ShotError {
        code: "screenshot_failed",
        message: "没有可用的显示器".into(),
    })
}

pub fn display_bounds(_scope: &str, display: Option<u32>) -> Option<(f64, f64, f64, f64, f64)> {
    let mons = monitors();
    let mon = pick(&mons, display).ok()?;
    let scale = (mon.dpi as f64 / 96.0).max(1.0);
    Some((mon.x as f64, mon.y as f64, mon.width as f64, mon.height as f64, scale))
}

fn grab(x: i32, y: i32, width: i32, height: i32) -> Result<Vec<u8>, ShotError> {
    if width <= 0 || height <= 0 || width > 16384 || height > 16384 {
        return Err(ShotError {
            code: "screenshot_failed",
            message: "截屏尺寸无效".into(),
        });
    }
    unsafe {
        let screen = GetDC(None);
        if screen.is_invalid() {
            return Err(ShotError {
                code: "screen_recording_denied",
                message: WIN_SCREEN_DENIED_MSG.to_string(),
            });
        }
        let mem = CreateCompatibleDC(screen);
        let bmp = CreateCompatibleBitmap(screen, width, height);
        if mem.is_invalid() || bmp.is_invalid() {
            let _ = ReleaseDC(None, screen);
            return Err(ShotError {
                code: "screen_recording_denied",
                message: WIN_SCREEN_DENIED_MSG.to_string(),
            });
        }
        let old = SelectObject(mem, bmp);
        let copied = BitBlt(mem, 0, 0, width, height, screen, x, y, SRCCOPY);
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: 0,
                ..BITMAPINFOHEADER::default()
            },
            ..BITMAPINFO::default()
        };
        let mut bgra = vec![0u8; (width as usize) * (height as usize) * 4];
        let rows = GetDIBits(
            mem,
            bmp,
            0,
            height as u32,
            Some(bgra.as_mut_ptr() as *mut _),
            &mut info,
            DIB_RGB_COLORS,
        );
        if !old.is_invalid() {
            let _ = SelectObject(mem, old);
        }
        let _ = DeleteObject(bmp);
        let _ = DeleteDC(mem);
        let _ = ReleaseDC(None, screen);
        if copied.is_err() || rows == 0 {
            return Err(ShotError {
                code: "screen_recording_denied",
                message: WIN_SCREEN_DENIED_MSG.to_string(),
            });
        }
        let mut rgb = vec![0u8; (width as usize) * (height as usize) * 3];
        for (i, px) in bgra.chunks_exact(4).enumerate() {
            let di = i * 3;
            if di + 2 >= rgb.len() {
                break;
            }
            rgb[di] = px[2];
            rgb[di + 1] = px[1];
            rgb[di + 2] = px[0];
        }
        Ok(rgb)
    }
}

pub fn capture_shot(scope: &str, display: Option<u32>, max_bytes: usize) -> Result<CapturedShot, ShotError> {
    prepare_dpi();
    let (x, y, width, height) = if display.is_none() && scope.eq_ignore_ascii_case("all") {
        unsafe {
            (
                GetSystemMetrics(SM_XVIRTUALSCREEN),
                GetSystemMetrics(SM_YVIRTUALSCREEN),
                GetSystemMetrics(SM_CXVIRTUALSCREEN),
                GetSystemMetrics(SM_CYVIRTUALSCREEN),
            )
        }
    } else {
        let mons = monitors();
        let mon = pick(&mons, display)?;
        (mon.x, mon.y, mon.width, mon.height)
    };
    let rgb = grab(x, y, width, height)?;
    let (bytes, width, height) = crate::host_raster::rgb_to_jpeg_budget(&rgb, width as u32, height as u32, max_bytes)
        .map_err(|message| ShotError {
            code: if message.contains("太大") { "screenshot_too_large" } else { "screenshot_failed" },
            message,
        })?;
    Ok(CapturedShot { bytes, width, height })
}

fn input_allowed() -> bool {
    unsafe {
        match OpenInputDesktop(Default::default(), false, DESKTOP_READOBJECTS) {
            Ok(desk) => {
                let _ = CloseDesktop(desk);
                true
            }
            Err(_) => false,
        }
    }
}

fn ensure_input() -> Result<(), Value> {
    if input_allowed() {
        Ok(())
    } else {
        Err(cu_error("event_posting_denied", WIN_EVENT_POSTING_DENIED_MSG))
    }
}

fn abs_point(x: i32, y: i32) -> (i32, i32) {
    unsafe {
        let vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let vw = (GetSystemMetrics(SM_CXVIRTUALSCREEN) - 1).max(1) as i64;
        let vh = (GetSystemMetrics(SM_CYVIRTUALSCREEN) - 1).max(1) as i64;
        let dx = ((x - vx) as i64 * 65535 / vw) as i32;
        let dy = ((y - vy) as i64 * 65535 / vh) as i32;
        (dx.clamp(0, 65535), dy.clamp(0, 65535))
    }
}

fn send_mouse(flags: MOUSE_EVENT_FLAGS, dx: i32, dy: i32, data: u32) -> Result<(), Value> {
    let input = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx,
                dy,
                mouseData: data,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let n = unsafe { SendInput(&[input], std::mem::size_of::<INPUT>() as i32) };
    if n == 1 {
        Ok(())
    } else {
        Err(cu_error("event_posting_denied", WIN_EVENT_POSTING_DENIED_MSG))
    }
}

fn send_vk(vk: u16, up: bool) -> Result<(), Value> {
    let input = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(vk),
                wScan: 0,
                dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let n = unsafe { SendInput(&[input], std::mem::size_of::<INPUT>() as i32) };
    if n == 1 {
        Ok(())
    } else {
        Err(cu_error("event_posting_denied", WIN_EVENT_POSTING_DENIED_MSG))
    }
}

fn send_unicode(unit: u16) -> Result<(), Value> {
    for up in [false, true] {
        let flags = if up { KEYEVENTF_UNICODE | KEYEVENTF_KEYUP } else { KEYEVENTF_UNICODE };
        let input = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0),
                    wScan: unit,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        let n = unsafe { SendInput(&[input], std::mem::size_of::<INPUT>() as i32) };
        if n != 1 {
            return Err(cu_error("event_posting_denied", WIN_EVENT_POSTING_DENIED_MSG));
        }
    }
    Ok(())
}

fn modifier_vks(flags: u64) -> Vec<u16> {
    let mut out = Vec::new();
    if flags & FLAG_SHIFT != 0 {
        out.push(0x10);
    }
    if flags & FLAG_CONTROL != 0 {
        out.push(0x11);
    }
    if flags & FLAG_OPTION != 0 {
        out.push(0x12);
    }
    if flags & FLAG_COMMAND != 0 {
        out.push(0x5B);
    }
    out
}

fn with_modifiers(flags: u64, body: impl FnOnce() -> Result<(), Value>) -> Result<(), Value> {
    let mods = modifier_vks(flags);
    for vk in &mods {
        send_vk(*vk, false)?;
    }
    let result = body();
    for vk in mods.iter().rev() {
        let _ = send_vk(*vk, true);
    }
    result
}

fn mouse_flags(button: &str, down: bool) -> MOUSE_EVENT_FLAGS {
    match (button, down) {
        ("right", true) => MOUSEEVENTF_RIGHTDOWN,
        ("right", false) => MOUSEEVENTF_RIGHTUP,
        ("middle", true) => MOUSEEVENTF_MIDDLEDOWN,
        ("middle", false) => MOUSEEVENTF_MIDDLEUP,
        (_, true) => MOUSEEVENTF_LEFTDOWN,
        (_, false) => MOUSEEVENTF_LEFTUP,
    }
}

fn move_abs(x: i32, y: i32) -> Result<(), Value> {
    let (dx, dy) = abs_point(x, y);
    send_mouse(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, dx, dy, 0)
}

fn click_at(x: i32, y: i32, button: &str, clicks: i32) -> Result<(), Value> {
    move_abs(x, y)?;
    nap(8);
    let (dx, dy) = abs_point(x, y);
    let base = MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
    for i in 0..clicks {
        send_mouse(base | mouse_flags(button, true), dx, dy, 0)?;
        nap(16);
        send_mouse(base | mouse_flags(button, false), dx, dy, 0)?;
        if i + 1 != clicks {
            nap(40);
        }
    }
    Ok(())
}

struct WinHit {
    hwnd: isize,
    pid: u32,
    app: String,
    title: String,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

fn process_name(pid: u32) -> String {
    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return String::new();
        };
        let mut buf = [0u16; 512];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, windows::core::PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = CloseHandle(handle);
        if ok.is_err() {
            return String::new();
        }
        let full = String::from_utf16_lossy(&buf[..len as usize]);
        full.rsplit(['\\', '/']).next().unwrap_or("").to_string()
    }
}

fn cloaked(hwnd: HWND) -> bool {
    let mut cloaked = 0u32;
    unsafe {
        DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut _, 4).is_ok() && cloaked != 0
    }
}

fn collect_windows() -> Vec<WinHit> {
    let mut rows: Vec<WinHit> = Vec::new();
    unsafe extern "system" fn each(hwnd: HWND, data: LPARAM) -> BOOL {
        let rows = &mut *(data.0 as *mut Vec<WinHit>);
        if rows.len() >= 40 {
            return TRUE;
        }
        if !IsWindowVisible(hwnd).as_bool() || cloaked(hwnd) {
            return TRUE;
        }
        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_err() {
            return TRUE;
        }
        let w = rect.right - rect.left;
        let h = rect.bottom - rect.top;
        if w < 2 || h < 2 {
            return TRUE;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let len = GetWindowTextLengthW(hwnd).max(0) as usize;
        let mut buf = vec![0u16; len + 1];
        let n = GetWindowTextW(hwnd, &mut buf);
        let title = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
        if title.trim().is_empty() && (w < 40 || h < 40) {
            return TRUE;
        }
        rows.push(WinHit {
            hwnd: hwnd.0 as isize,
            pid,
            app: process_name(pid),
            title,
            x: rect.left,
            y: rect.top,
            w,
            h,
        });
        TRUE
    }
    unsafe {
        let _ = EnumWindows(Some(each), LPARAM(&mut rows as *mut Vec<WinHit> as isize));
    }
    rows
}

fn hwnd_of(id: isize) -> HWND {
    HWND(id as *mut std::ffi::c_void)
}

fn find_pid(pid: i32) -> Option<WinHit> {
    collect_windows().into_iter().find(|w| w.pid == pid as u32)
}

fn post_click(win: &WinHit, button: &str, clicks: i32, x: i32, y: i32) -> Result<(), Value> {
    let hwnd = hwnd_of(win.hwnd);
    let mut pt = POINT { x, y };
    unsafe {
        if !ScreenToClient(hwnd, &mut pt).as_bool() {
            return Err(cu_error("input_failed", "无法把坐标换到窗口客户区"));
        }
        let packed = ((pt.y as u32) << 16) | (pt.x as u16 as u32);
        let lp = LPARAM(packed as isize);
        let (down, up) = match button {
            "right" => (WM_RBUTTONDOWN, WM_RBUTTONUP),
            "middle" => (WM_MBUTTONDOWN, WM_MBUTTONUP),
            _ => (WM_LBUTTONDOWN, WM_LBUTTONUP),
        };
        for _ in 0..clicks {
            PostMessageW(hwnd, down, WPARAM(1), lp).map_err(|_| cu_error("input_failed", "后台点击失败"))?;
            nap(16);
            PostMessageW(hwnd, up, WPARAM(0), lp).map_err(|_| cu_error("input_failed", "后台点击失败"))?;
        }
    }
    Ok(())
}

fn frame_or_null(frame_id: &str) -> Value {
    if frame_id.is_empty() { Value::Null } else { json!(frame_id) }
}

fn ok_action(action: &str, background: bool, delivery: &str, extra: Value) -> Value {
    let mut row = json!({
        "ok": true,
        "action": action,
        "background": background,
        "delivery": delivery,
        "platform": "windows",
    });
    if let (Some(obj), Value::Object(extra)) = (row.as_object_mut(), extra) {
        for (k, v) in extra {
            obj.insert(k, v);
        }
    }
    if background {
        row["note"] = json!("background=true 走 PostMessage。只读原始输入的应用会忽略。若画面没变，去掉 background 再试。管理员窗口需要同样以管理员运行 Open Bot。");
    }
    row
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
            None => return Err(cu_error("invalid_args", &format!("不认识的修饰键：{m}"))),
        }
    }
    Ok(flags)
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
    let flags = match flags_of(&modifiers) {
        Ok(f) => f,
        Err(e) => return e,
    };
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
    prepare_dpi();
    let ix = sx.round() as i32;
    let iy = sy.round() as i32;
    let delivery = if let Some(pid) = target {
        let Some(win) = find_pid(pid) else {
            return cu_error("window_not_found", "没有找到这个 pid 的窗口，不能在后台点击。");
        };
        if let Err(e) = post_click(&win, button, clicks, ix, iy) {
            return e;
        }
        "post_message"
    } else {
        if let Err(e) = ensure_input() {
            return e;
        }
        if let Err(e) = with_modifiers(flags, || click_at(ix, iy, button, clicks)) {
            return e;
        }
        "send_input"
    };
    ok_action(
        "click",
        background,
        delivery,
        json!({ "via": via, "button": button, "clicks": clicks, "x_pt": sx, "y_pt": sy, "frame_id": frame_or_null(&frame_id) }),
    )
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
    prepare_dpi();
    if let Some(pid) = target {
        let Some(win) = find_pid(pid) else {
            return cu_error("window_not_found", "没有找到这个 pid 的窗口，不能在后台输入。");
        };
        let hwnd = hwnd_of(win.hwnd);
        unsafe {
            for ch in text.chars() {
                let mut buf = [0u16; 2];
                for unit in ch.encode_utf16(&mut buf) {
                    if PostMessageW(hwnd, WM_CHAR, WPARAM(*unit as usize), LPARAM(0)).is_err() {
                        return cu_error("input_failed", "后台输入失败");
                    }
                }
            }
        }
        return ok_action("type", true, "post_message", json!({ "chars": count }));
    }
    if let Err(e) = ensure_input() {
        return e;
    }
    if !element_ref.is_empty() {
        if let Ok((x, y, _)) = element_center(&element_ref) {
            if let Err(e) = click_at(x.round() as i32, y.round() as i32, "left", 1) {
                return e;
            }
            nap(30);
        }
    }
    for ch in text.chars() {
        if ch == '\n' || ch == '\r' {
            if let Err(e) = send_vk(0x0D, false).and_then(|_| send_vk(0x0D, true)) {
                return e;
            }
        } else if ch == '\t' {
            if let Err(e) = send_vk(0x09, false).and_then(|_| send_vk(0x09, true)) {
                return e;
            }
        } else {
            let mut buf = [0u16; 2];
            for unit in ch.encode_utf16(&mut buf) {
                if let Err(e) = send_unicode(*unit) {
                    return e;
                }
            }
        }
        nap(4);
    }
    ok_action("type", false, "send_input", json!({ "chars": count }))
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
    let Some(vk) = windows_vk(&stroke.name) else {
        return cu_error("invalid_args", &format!("不认识的按键：{}", stroke.name));
    };
    let anchor = match require_anchor(&frame_id, &element_ref) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let target = match background_target(background, pid, anchor) {
        Ok(p) => p,
        Err(e) => return e,
    };
    if let Some(pid) = target {
        let Some(win) = find_pid(pid) else {
            return cu_error("window_not_found", "没有找到这个 pid 的窗口，不能在后台按键。");
        };
        let hwnd = hwnd_of(win.hwnd);
        unsafe {
            if PostMessageW(hwnd, WM_KEYDOWN, WPARAM(vk as usize), LPARAM(0)).is_err() {
                return cu_error("input_failed", "后台按键失败");
            }
            nap(12);
            if PostMessageW(hwnd, WM_KEYUP, WPARAM(vk as usize), LPARAM(0)).is_err() {
                return cu_error("input_failed", "后台按键失败");
            }
        }
        return ok_action("key", true, "post_message", json!({ "key": key }));
    }
    if let Err(e) = ensure_input() {
        return e;
    }
    if let Err(e) = with_modifiers(stroke.flags, || send_vk(vk, false).and_then(|_| send_vk(vk, true))) {
        return e;
    }
    ok_action("key", false, "send_input", json!({ "key": key }))
}

pub fn scroll(frame_id: String, x: Option<f64>, y: Option<f64>, dx: f64, dy: f64, background: bool, pid: Option<i64>) -> Value {
    let (dx, dy) = match clamp_scroll(dx, dy) {
        Ok(v) => v,
        Err(msg) => return cu_error("invalid_args", &msg),
    };
    let (sx, sy) = match frame_point(&frame_id, x, y) {
        Ok(p) => p,
        Err(e) => return e,
    };
    if background_target(background, pid, None).map(|p| p.is_some()).unwrap_or(true) && background {
        return cu_error("background_limited", "Windows 后台滚动不可靠。请去掉 background，在光标处滚动。");
    }
    prepare_dpi();
    if let Err(e) = ensure_input() {
        return e;
    }
    let ix = sx.round() as i32;
    let iy = sy.round() as i32;
    if let Err(e) = move_abs(ix, iy) {
        return e;
    }
    let (dxa, dya) = abs_point(ix, iy);
    if dy != 0 {
        let data = (dy * 120) as i32 as u32;
        if let Err(e) = send_mouse(MOUSEEVENTF_WHEEL | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, dxa, dya, data) {
            return e;
        }
    }
    if dx != 0 {
        let data = (dx * 120) as i32 as u32;
        if let Err(e) = send_mouse(MOUSEEVENTF_HWHEEL | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, dxa, dya, data) {
            return e;
        }
    }
    ok_action("scroll", false, "send_input", json!({ "dx": dx, "dy": dy, "frame_id": frame_id }))
}

pub fn mouse_move(frame_id: String, x: Option<f64>, y: Option<f64>, background: bool, pid: Option<i64>) -> Value {
    let (sx, sy) = match frame_point(&frame_id, x, y) {
        Ok(p) => p,
        Err(e) => return e,
    };
    if background {
        let _ = pid;
        return cu_error("background_limited", "Windows 不能在不移动全局指针的情况下移动鼠标。请去掉 background。");
    }
    prepare_dpi();
    if let Err(e) = ensure_input() {
        return e;
    }
    if let Err(e) = move_abs(sx.round() as i32, sy.round() as i32) {
        return e;
    }
    ok_action("mouse_move", false, "send_input", json!({ "x_pt": sx, "y_pt": sy, "frame_id": frame_id }))
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
        (Some(a), Some(b), Some(c), Some(d)) => (a, b, c, d),
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
    if background {
        let _ = pid;
        return cu_error("background_limited", "Windows 后台拖拽不可用。请去掉 background。");
    }
    prepare_dpi();
    if let Err(e) = ensure_input() {
        return e;
    }
    let x0 = sx.round() as i32;
    let y0 = sy.round() as i32;
    let x1 = ex.round() as i32;
    let y1 = ey.round() as i32;
    if let Err(e) = move_abs(x0, y0) {
        return e;
    }
    nap(8);
    let (dx, dy) = abs_point(x0, y0);
    let base = MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
    if let Err(e) = send_mouse(base | mouse_flags(button, true), dx, dy, 0) {
        return e;
    }
    nap(16);
    for i in 1..=8 {
        let t = i as f64 / 8.0;
        let mx = (x0 as f64 + (x1 as f64 - x0 as f64) * t).round() as i32;
        let my = (y0 as f64 + (y1 as f64 - y0 as f64) * t).round() as i32;
        if let Err(e) = move_abs(mx, my) {
            let _ = send_mouse(base | mouse_flags(button, false), dx, dy, 0);
            return e;
        }
        nap(10);
    }
    let (dx2, dy2) = abs_point(x1, y1);
    if let Err(e) = send_mouse(base | mouse_flags(button, false), dx2, dy2, 0) {
        return e;
    }
    ok_action("drag", false, "send_input", json!({ "button": button, "frame_id": frame_id }))
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
    let wins = collect_windows();
    let mut rows = Vec::new();
    for w in wins {
        let mut row = json!({
            "window_id": w.hwnd,
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
        "platform": "windows",
        "windows": rows,
        "count": rows.len(),
        "frame_id": frame_or_null(&frame_id),
        "screen_recording": input_allowed(),
        "note": "窗口是可见的顶层窗口。点击用 host_click 的 frame_id 坐标，或 host_ax 的 element_ref。",
    })
}

fn com_init() {
    static ONCE: AtomicBool = AtomicBool::new(false);
    if ONCE.swap(true, Ordering::SeqCst) {
        return;
    }
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    }
}

fn automation() -> Result<IUIAutomation, Value> {
    com_init();
    unsafe {
        CoCreateInstance(&CLSID_CUIAUTOMATION, None::<&windows::core::IUnknown>, CLSCTX_INPROC_SERVER)
            .map_err(|_| cu_error("accessibility_denied", WIN_ACCESSIBILITY_DENIED_MSG))
    }
}

fn role_name(id: i32) -> &'static str {
    match id {
        50000 => "Button",
        50002 => "CheckBox",
        50003 => "ComboBox",
        50004 => "Edit",
        50005 => "Hyperlink",
        50011 => "MenuBar",
        50012 => "MenuItem",
        50020 => "Text",
        50025 => "ToolBar",
        50026 => "ToolTip",
        50030 => "Document",
        50032 => "Window",
        50033 => "Pane",
        50036 => "Group",
        _ => "Control",
    }
}

fn push_el(el: &IUIAutomationElement, depth: i32, geom: Option<&super::DisplayGeom>, out: &mut Vec<Value>) {
    unsafe {
        let title = el.CurrentName().map(|b| b.to_string()).unwrap_or_default();
        let role_id = el.CurrentControlType().map(|c| c.0).unwrap_or(0);
        let pid = el.CurrentProcessId().unwrap_or(0);
        let bounds = el.CurrentBoundingRectangle().ok().map(|r| {
            ((r.left) as f64, (r.top) as f64, (r.right - r.left) as f64, (r.bottom - r.top) as f64)
        });
        out.push(publish_element(pid, role_name(role_id), &title, "", "", depth, bounds, geom));
    }
}

fn walk_el(
    walker: &IUIAutomationTreeWalker,
    el: &IUIAutomationElement,
    depth: i32,
    max_depth: i32,
    limit: usize,
    geom: Option<&super::DisplayGeom>,
    out: &mut Vec<Value>,
) {
    if out.len() >= limit {
        return;
    }
    push_el(el, depth, geom, out);
    if depth >= max_depth || out.len() >= limit {
        return;
    }
    let mut child = unsafe { walker.GetFirstChildElement(el).ok() };
    let mut n = 0;
    while let Some(current) = child {
        if out.len() >= limit || n >= 40 {
            break;
        }
        walk_el(walker, &current, depth + 1, max_depth, limit, geom, out);
        child = unsafe { walker.GetNextSiblingElement(&current).ok() };
        n += 1;
    }
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
    let auto = match automation() {
        Ok(v) => v,
        Err(e) => return e,
    };
    let walker = match unsafe { auto.ControlViewWalker() } {
        Ok(v) => v,
        Err(_) => return cu_error("accessibility_denied", WIN_ACCESSIBILITY_DENIED_MSG),
    };
    if x.is_some() || y.is_some() {
        let (ix, iy) = match (x, y) {
            (Some(x), Some(y)) => (x, y),
            _ => return cu_error("invalid_args", "按坐标查看元素需要同时给出 x 和 y"),
        };
        let Some(g) = geom.as_ref() else {
            return cu_error("missing_frame", MISSING_FRAME_MSG);
        };
        let (sx, sy) = match map_image_point(g, ix, iy) {
            Ok(p) => p,
            Err(e) => return point_error(e),
        };
        let el = unsafe { auto.ElementFromPoint(POINT { x: sx.round() as i32, y: sy.round() as i32 }) };
        let Ok(el) = el else {
            return cu_error("ax_failed", "这个坐标上没有可读的界面元素");
        };
        let mut elements = Vec::new();
        push_el(&el, 0, Some(g), &mut elements);
        return json!({
            "ok": true,
            "platform": "windows",
            "elements": elements,
            "count": elements.len(),
            "frame_id": frame_id,
            "coord_space": "image_pixels",
            "note": "优先用 element_ref 点击。x,y 已换算成这张截图的像素。Windows 读的是 UI Automation。",
        });
    }
    let wins = collect_windows();
    let chosen = if let Some(pid) = pid {
        if pid <= 0 || pid > i32::MAX as i64 {
            return cu_error("invalid_args", "pid 无效");
        }
        wins.into_iter().find(|w| w.pid == pid as u32)
    } else if let Some(wid) = window_id {
        wins.into_iter().find(|w| w.hwnd == wid as isize)
    } else if !app.is_empty() {
        let needle = app.to_ascii_lowercase();
        wins.into_iter().find(|w| {
            w.app.to_ascii_lowercase().contains(&needle) || w.title.to_ascii_lowercase().contains(&needle)
        })
    } else {
        let fg = unsafe { GetForegroundWindow() };
        let fg_id = fg.0 as isize;
        wins.into_iter().find(|w| w.hwnd == fg_id).or_else(|| collect_windows().into_iter().next())
    };
    let Some(win) = chosen else {
        return cu_error("app_not_found", "没有找到要读取的窗口。请先列出窗口。");
    };
    let root = match unsafe { auto.ElementFromHandle(hwnd_of(win.hwnd)) } {
        Ok(el) => el,
        Err(_) => return cu_error("accessibility_denied", WIN_ACCESSIBILITY_DENIED_MSG),
    };
    let depth = max_depth.unwrap_or(2).clamp(1, 3) as i32;
    let limit = limit.unwrap_or(60).clamp(1, 120) as usize;
    let mut elements = Vec::new();
    walk_el(&walker, &root, 0, depth, limit, geom.as_ref().filter(|g| g.actionable), &mut elements);
    json!({
        "ok": true,
        "platform": "windows",
        "app": win.app,
        "pid": win.pid,
        "elements": elements,
        "count": elements.len(),
        "frame_id": frame_or_null(&frame_id),
        "note": "优先用 element_ref 点击。Windows 读的是 UI Automation。目标窗口以管理员运行时，普通权限的 Open Bot 读不到。",
    })
}

pub fn tcc_status() -> Value {
    prepare_dpi();
    let screen = unsafe {
        let dc = GetDC(None);
        let ok = !dc.is_invalid();
        if ok {
            let _ = ReleaseDC(None, dc);
        }
        ok
    };
    let posting = input_allowed();
    let accessibility = automation().is_ok();
    json!({
        "ok": true,
        "platform": "windows",
        "screen_recording": {
            "granted": screen,
            "settings": "交互式桌面会话。Win32 桌面应用没有单独的屏幕录制开关；服务或锁屏安全桌面会失败",
        },
        "accessibility": {
            "granted": accessibility,
            "settings": "UI Automation。目标窗口以管理员运行时，Open Bot 也需要管理员",
        },
        "event_posting": {
            "granted": posting,
            "settings": "已解锁的交互桌面。跨完整性级别（UIPI）会拒绝输入",
        },
        "input_backend": "send_input",
    })
}

pub fn open_privacy(pane: &str) -> Result<Value, String> {
    let (uri, hint) = match pane {
        "accessibility" | "assistive" => (
            "ms-settings:easeofaccess",
            "请在「设置 → 辅助功能」查看。UI Automation 对普通桌面应用默认可读；管理员窗口需要同样提升 Open Bot。",
        ),
        "screen" | "screen_recording" | "screencapture" => (
            "ms-settings:display",
            "Win32 截屏没有单独的隐私开关。请确认 Open Bot 跑在已登录并解锁的桌面会话里。",
        ),
        "event" | "event_posting" | "post_event" => (
            "ms-settings:easeofaccess",
            "键鼠发送没有单独的开关。若目标程序以管理员运行，请同样以管理员启动 Open Bot。",
        ),
        _ => return Err("未知的隐私设置页".into()),
    };
    let spawned = std::process::Command::new("cmd")
        .args(["/C", "start", "", uri])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .is_ok();
    if spawned {
        Ok(json!({ "ok": true, "pane": pane, "platform": "windows", "note": hint }))
    } else {
        Err(hint.into())
    }
}
