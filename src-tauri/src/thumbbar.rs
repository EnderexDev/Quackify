// The buttons under the window's thumbnail in the taskbar: previous, play or pause, next.
// Windows takes them through ITaskbarList3 once it has made the taskbar button (it says so with
// the "TaskbarButtonCreated" message, again each time the window comes back from the tray), and
// sends their clicks to the window as WM_COMMAND. Everything here runs on the window's thread.
use std::cell::RefCell;

use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Gdi::{CreateBitmap, DeleteObject};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
use windows::Win32::UI::Shell::{
    DefSubclassProc, ITaskbarList3, SetWindowSubclass, TaskbarList, THBF_DISABLED, THBF_ENABLED, THBN_CLICKED, THB_FLAGS,
    THB_ICON, THB_TOOLTIP, THUMBBUTTON,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateIconIndirect, GetSystemMetrics, RegisterWindowMessageW, HICON, ICONINFO, SM_CXSMICON, WM_COMMAND,
};
use windows::core::w;

use crate::media::{self, Action};

const PREVIOUS: u32 = 1;
const TOGGLE: u32 = 2;
const NEXT: u32 = 3;
const SUBCLASS_ID: usize = 0x5155_4143; // "QUAC"

struct Bar {
    app: AppHandle,
    hwnd: HWND,
    taskbar_created: u32,
    list: Option<ITaskbarList3>,
    icons: Icons,
    /// What the buttons show now, applied again when Windows makes the button anew.
    playing: bool,
    has_song: bool,
}

struct Icons {
    previous: HICON,
    play: HICON,
    pause: HICON,
    next: HICON,
}

thread_local! {
    static BAR: RefCell<Option<Bar>> = const { RefCell::new(None) };
}

/// Listens on the main window for the taskbar button and the buttons' clicks. From the app's
/// setup (the window's thread), before the window is first shown, so the first
/// "TaskbarButtonCreated" is heard.
pub fn setup(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    let Ok(hwnd) = window.hwnd() else { return };
    let hwnd = HWND(hwnd.0 as _);
    let app = app.clone();
    unsafe {
        let size = GetSystemMetrics(SM_CXSMICON).max(16);
        let icons = Icons {
            previous: icon(size, Glyph::Previous),
            play: icon(size, Glyph::Play),
            pause: icon(size, Glyph::Pause),
            next: icon(size, Glyph::Next),
        };
        let taskbar_created = RegisterWindowMessageW(w!("TaskbarButtonCreated"));
        BAR.with(|b| {
            *b.borrow_mut() = Some(Bar { app, hwnd, taskbar_created, list: None, icons, playing: false, has_song: false })
        });
        if !SetWindowSubclass(hwnd, Some(proc), SUBCLASS_ID, 0).as_bool() {
            eprintln!("thumbbar: the window could not be listened to");
        }
    }
}

/// Shows play or pause, and greys the buttons out with nothing to play.
pub fn update(app: &AppHandle, playing: bool, has_song: bool) {
    let Some(window) = app.get_webview_window("main") else { return };
    let _ = window.run_on_main_thread(move || {
        let Some(Some((list, hwnd, buttons))) = BAR.with(|b| {
            let mut b = b.try_borrow_mut().ok()?;
            let bar = b.as_mut()?;
            if bar.playing == playing && bar.has_song == has_song {
                return Some(None);
            }
            bar.playing = playing;
            bar.has_song = has_song;
            Some(bar.list.clone().map(|l| (l, bar.hwnd, buttons(bar))))
        }) else {
            return;
        };
        if let Err(e) = unsafe { list.ThumbBarUpdateButtons(hwnd, &buttons) } {
            eprintln!("thumbbar: {e}");
        }
    });
}

/// What the window's messages ask of the buttons, worked out with the state borrowed; the
/// calls to Windows come after, with it free, since Windows sends the window messages from
/// inside them (and a panic here, in a window procedure, aborts the app).
enum Todo {
    Add(HWND, [THUMBBUTTON; 3]),
    Run(AppHandle, Action),
}

unsafe extern "system" fn proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM, _id: usize, _data: usize) -> LRESULT {
    let todo = BAR.with(|b| {
        // Borrowed already: a message sent from inside a call below, nothing for the buttons.
        let b = b.try_borrow().ok()?;
        let bar = b.as_ref()?;
        if msg == bar.taskbar_created {
            return Some(Todo::Add(bar.hwnd, buttons(bar)));
        }
        if msg == WM_COMMAND && (wparam.0 >> 16) as u32 & 0xFFFF == THBN_CLICKED {
            let action = match (wparam.0 & 0xFFFF) as u32 {
                PREVIOUS => Action::Previous,
                TOGGLE => Action::Toggle,
                NEXT => Action::Next,
                _ => return None,
            };
            return Some(Todo::Run(bar.app.clone(), action));
        }
        None
    });
    match todo {
        Some(Todo::Add(hwnd, buttons)) => {
            if let Some(list) = add(hwnd, &buttons) {
                BAR.with(|b| {
                    if let Ok(mut b) = b.try_borrow_mut() {
                        if let Some(bar) = b.as_mut() {
                            bar.list = Some(list);
                        }
                    }
                });
            }
        }
        Some(Todo::Run(app, action)) => {
            media::run(&app, action);
            return LRESULT(0);
        }
        None => {}
    }
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

/// The taskbar button is new: its buttons go on. Windows keeps them until the button goes.
fn add(hwnd: HWND, buttons: &[THUMBBUTTON; 3]) -> Option<ITaskbarList3> {
    let result = unsafe {
        let list: ITaskbarList3 = match CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("thumbbar: {e}");
                return None;
            }
        };
        list.HrInit().and_then(|_| list.ThumbBarAddButtons(hwnd, buttons)).map(|_| list)
    };
    match result {
        Ok(list) => Some(list),
        Err(e) => {
            eprintln!("thumbbar: {e}");
            None
        }
    }
}

fn buttons(bar: &Bar) -> [THUMBBUTTON; 3] {
    let flags = if bar.has_song { THBF_ENABLED } else { THBF_DISABLED };
    let button = |id: u32, icon: HICON, tip: &str| {
        let mut b = THUMBBUTTON { dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS, iId: id, hIcon: icon, dwFlags: flags, ..Default::default() };
        for (slot, c) in b.szTip.iter_mut().zip(tip.encode_utf16().take(259)) {
            *slot = c;
        }
        b
    };
    let i = &bar.icons;
    [
        button(PREVIOUS, i.previous, "Previous"),
        if bar.playing { button(TOGGLE, i.pause, "Pause") } else { button(TOGGLE, i.play, "Play") },
        button(NEXT, i.next, "Next"),
    ]
}

#[derive(Clone, Copy)]
enum Glyph {
    Previous,
    Play,
    Pause,
    Next,
}

/// Whether the point (in a 24-unit box) is inside the glyph: the player's icons, solid.
fn inside(glyph: Glyph, x: f32, y: f32) -> bool {
    // A triangle pointing right with its back at `x0`, its tip at `x1`, between y 5 and 19.
    let right = |x0: f32, x1: f32| x >= x0 && x <= x1 && (y - 12.0).abs() <= 7.0 * (x1 - x) / (x1 - x0);
    let left = |x0: f32, x1: f32| x >= x0 && x <= x1 && (y - 12.0).abs() <= 7.0 * (x - x0) / (x1 - x0);
    let bar = |x0: f32, x1: f32| x >= x0 && x <= x1 && (5.0..=19.0).contains(&y);
    match glyph {
        Glyph::Play => right(7.0, 19.0),
        Glyph::Pause => bar(6.5, 10.0) || bar(14.0, 17.5),
        Glyph::Next => right(5.5, 16.0) || bar(16.5, 19.0),
        Glyph::Previous => left(8.0, 18.5) || bar(5.0, 7.5),
    }
}

/// The glyph in white, `size` pixels square, smoothed by sampling each pixel 4×4 times.
fn icon(size: i32, glyph: Glyph) -> HICON {
    const SAMPLES: i32 = 4;
    let mut bgra = Vec::with_capacity((size * size * 4) as usize);
    for py in 0..size {
        for px in 0..size {
            let mut hits = 0;
            for sy in 0..SAMPLES {
                for sx in 0..SAMPLES {
                    let x = (px as f32 + (sx as f32 + 0.5) / SAMPLES as f32) * 24.0 / size as f32;
                    let y = (py as f32 + (sy as f32 + 0.5) / SAMPLES as f32) * 24.0 / size as f32;
                    hits += inside(glyph, x, y) as i32;
                }
            }
            let a = (hits * 255 / (SAMPLES * SAMPLES)) as u8;
            bgra.extend_from_slice(&[255, 255, 255, a]);
        }
    }
    unsafe {
        let color = CreateBitmap(size, size, 1, 32, Some(bgra.as_ptr().cast()));
        let mask_bits = vec![0u8; ((size + 15) / 16 * 2 * size) as usize];
        let mask = CreateBitmap(size, size, 1, 1, Some(mask_bits.as_ptr().cast()));
        let info = ICONINFO { fIcon: true.into(), xHotspot: 0, yHotspot: 0, hbmMask: mask, hbmColor: color };
        let icon = CreateIconIndirect(&info).unwrap_or_default();
        let _ = DeleteObject(color.into());
        let _ = DeleteObject(mask.into());
        icon
    }
}
