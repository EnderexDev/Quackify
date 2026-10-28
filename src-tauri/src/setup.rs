// Quackify's own installer and update window (spec "Instalador e atualizações"). The NSIS
// installer Tauri builds still does the installing (files, registry, uninstaller, shortcuts),
// run silently under a window in Quackify's own look:
// - Quackify-Setup.exe is quackify.exe with the NSIS installer appended (scripts/release.mjs) and
//   a trailer saying how long it is: finding it in its own file, the exe opens the installer
//   window instead of the player.
// - An update: the app copies itself to the temp folder as Quackify-Updater.exe, starts it with
//   --quackify-update and closes. The copy downloads the update (its signature checked against
//   tauri.conf.json's key), runs NSIS with /UPDATE /R, and NSIS opens the new Quackify. From
//   the temp folder, because NSIS overwrites the install folder, and by another name, because
//   NSIS closes every quackify.exe before it starts.
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "setup";
/// The end of Quackify-Setup.exe: the installer's length (u64, little endian), then this.
const MAGIC: &[u8; 8] = b"QKSETUP1";
const UPDATE_ARG: &str = "--quackify-update";
const UPDATER_EXE: &str = "Quackify-Updater.exe";
/// The NSIS script's binary (the crate's). Its other names come from productName, read with
/// variant::name: Quackify, or Quackify Dev for an installer of the dev build.
const BINARY: &str = "quackify.exe";

pub enum Mode {
    /// Quackify-Setup.exe: the installer starts this many bytes from the end of the exe.
    Install { offset: u64, len: u64 },
    /// The temp copy, updating the Quackify installed in `dir`.
    Update { dir: PathBuf },
}

/// What this start of the exe is for, read before anything else starts.
pub fn mode() -> Option<Mode> {
    let args: Vec<String> = std::env::args().collect();
    if let Some(i) = args.iter().position(|a| a == UPDATE_ARG) {
        return args.get(i + 1).map(|dir| Mode::Update { dir: PathBuf::from(dir) });
    }
    let exe = std::env::current_exe().ok()?;
    let mut file = File::open(exe).ok()?;
    let size = file.metadata().ok()?.len();
    if size < 16 {
        return None;
    }
    let mut tail = [0u8; 16];
    file.seek(SeekFrom::End(-16)).ok()?;
    file.read_exact(&mut tail).ok()?;
    if &tail[8..] != MAGIC {
        return None;
    }
    let len = u64::from_le_bytes(tail[..8].try_into().ok()?);
    // size >= 16 here, so the subtraction cannot wrap whatever the trailer claims.
    (len > 0 && len <= size - 16).then(|| Mode::Install { offset: size - 16 - len, len })
}

/// Runs the installer window in place of the app: no tray, player or single instance.
pub fn run(mut context: tauri::Context<tauri::Wry>, mode: Mode) {
    // Only the setup window: the app's own windows stay unmade.
    context.config_mut().app.windows.clear();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(mode)
        .setup(|app| {
            // Its own WebView2 data: a first install may run while Quackify is open, on the same
            // identifier's folder.
            let data = std::env::temp_dir().join("Quackify-Setup-WebView");
            WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
                .title("Quackify")
                .inner_size(560.0, 440.0)
                .resizable(false)
                .maximizable(false)
                .decorations(false)
                .center()
                .background_color(tauri::window::Color(10, 10, 12, 255))
                .data_directory(data)
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            setup_info,
            setup_installed,
            setup_pick_folder,
            setup_install,
            setup_update,
            setup_launch,
            setup_close,
        ])
        .run(context)
        .expect("error while running the Quackify installer");
}

#[derive(Serialize)]
pub struct Info {
    /// "install" or "update".
    mode: &'static str,
    /// The version this installer carries; "" for an update, which learns it from GitHub.
    version: String,
    /// Where it installs: the folder of an earlier install, or the NSIS default.
    dir: String,
    /// Quackify is already installed there (the button says Update instead of Install).
    installed: bool,
}

#[tauri::command]
fn setup_info(app: AppHandle) -> Info {
    let mode = app.state::<Mode>();
    let (kind, version, dir) = match mode.inner() {
        Mode::Install { .. } => ("install", app.package_info().version.to_string(), default_dir(&crate::variant::name(&app))),
        Mode::Update { dir } => ("update", String::new(), dir.clone()),
    };
    Info { mode: kind, version, installed: dir.join(BINARY).exists(), dir: dir.display().to_string() }
}

/// The folder of the last install (the key NSIS writes), or %LOCALAPPDATA%\<name>.
fn default_dir(name: &str) -> PathBuf {
    #[cfg(windows)]
    {
        use winreg::RegKey;
        use winreg::enums::HKEY_CURRENT_USER;
        if let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(format!("Software\\enderex\\{name}")) {
            if let Ok(dir) = key.get_value::<String, _>("") {
                if !dir.is_empty() {
                    return PathBuf::from(dir);
                }
            }
        }
    }
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    local.join(name)
}

/// Whether Quackify is already in `dir` (the button says Update instead of Install).
#[tauri::command]
fn setup_installed(dir: String) -> bool {
    Path::new(&dir).join(BINARY).exists()
}

#[tauri::command]
async fn setup_pick_folder(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let dialog = app.dialog().clone();
    let name = crate::variant::name(&app);
    tauri::async_runtime::spawn_blocking(move || dialog.file().set_title("Where to install Quackify").blocking_pick_folder())
        .await
        .ok()
        .flatten()
        .and_then(|p| p.into_path().ok())
        // NSIS puts the files straight in the folder given: a Quackify folder inside the one picked.
        .map(|p| if p.ends_with(&name) { p } else { p.join(&name) })
        .map(|p| p.display().to_string())
}

/// Installs from the installer inside this exe. `desktop`: keep the desktop shortcut NSIS makes.
#[tauri::command]
async fn setup_install(app: AppHandle, dir: String, desktop: bool) -> Result<(), String> {
    let (offset, len) = match app.state::<Mode>().inner() {
        Mode::Install { offset, len } => (*offset, *len),
        Mode::Update { .. } => return Err("not an installer".into()),
    };
    let shortcut = desktop_shortcut(&crate::variant::name(&app));
    tauri::async_runtime::spawn_blocking(move || {
        let installer = std::env::temp_dir().join(format!("Quackify-Install-{}.exe", std::process::id()));
        let bytes = extract(offset, len);
        let had_shortcut = shortcut.as_ref().is_some_and(|p| p.exists());
        bytes.and_then(|bytes| install_from(&installer, &bytes, &[], Path::new(&dir)))?;
        // Silent NSIS always makes the desktop shortcut; /NS would skip the Start menu's too.
        if !desktop && !had_shortcut {
            if let Some(p) = shortcut {
                let _ = std::fs::remove_file(p);
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The installer inside this exe.
fn extract(offset: u64, len: u64) -> Result<Vec<u8>, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut from = File::open(exe).map_err(|e| e.to_string())?;
    from.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    let mut bytes = Vec::with_capacity(len as usize);
    from.take(len).read_to_end(&mut bytes).map_err(|e| format!("could not read the installer: {e}"))?;
    Ok(bytes)
}

/// Writes `bytes` to `path` and runs them as NSIS, the file held so nothing can change or delete
/// it in between: reopened sharing only reading (Windows still runs it), then checked against
/// `bytes`, the copy whose signature the updater checked.
fn install_from(path: &Path, bytes: &[u8], flags: &[&str], dir: &Path) -> Result<(), String> {
    std::fs::write(path, bytes).map_err(|e| format!("could not write the installer: {e}"))?;
    let result = (|| {
        let mut options = std::fs::OpenOptions::new();
        options.read(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            // FILE_SHARE_READ only: no writing or deleting while this handle lives.
            options.share_mode(0x1);
        }
        let mut held = options.open(path).map_err(|e| format!("could not open the installer: {e}"))?;
        let mut on_disk = Vec::with_capacity(bytes.len());
        held.read_to_end(&mut on_disk).map_err(|e| format!("could not read the installer: {e}"))?;
        if on_disk != bytes {
            return Err("the installer changed on disk before it ran".to_string());
        }
        run_nsis(path, flags, dir)
    })();
    let _ = std::fs::remove_file(path);
    result
}

/// Runs NSIS silently into `dir` and waits for it.
fn run_nsis(installer: &Path, flags: &[&str], dir: &Path) -> Result<(), String> {
    // /D= has to be the last argument and unquoted, spaces and all: NSIS reads the rest of the
    // line as the folder. raw_arg keeps Rust from quoting it.
    #[cfg(windows)]
    use std::os::windows::process::CommandExt;
    let mut cmd = Command::new(installer);
    cmd.arg("/S").args(flags);
    #[cfg(windows)]
    cmd.raw_arg(format!("/D={}", dir.display()));
    let status = cmd.status().map_err(|e| format!("could not start the installer: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("the installer stopped with code {}", status.code().unwrap_or(-1)))
    }
}

#[cfg(windows)]
fn desktop_shortcut(name: &str) -> Option<PathBuf> {
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::{FOLDERID_Desktop, KF_FLAG_DEFAULT, SHGetKnownFolderPath};
    unsafe {
        let path = SHGetKnownFolderPath(&FOLDERID_Desktop, KF_FLAG_DEFAULT, None).ok()?;
        let desktop = path.to_string().ok();
        CoTaskMemFree(Some(path.0 as _));
        desktop.map(|d| PathBuf::from(d).join(format!("{name}.lnk")))
    }
}

#[cfg(not(windows))]
fn desktop_shortcut(_name: &str) -> Option<PathBuf> {
    None
}

#[derive(Clone, Serialize)]
#[serde(tag = "stage", rename_all = "lowercase")]
pub enum Progress {
    Found { version: String },
    Downloading { percent: Option<u8> },
    Installing,
}

/// The update window's whole job: the newest version from GitHub, downloaded and checked, then
/// installed over the folder; NSIS opens the new Quackify and this window closes.
#[tauri::command]
async fn setup_update(app: AppHandle, progress: Channel<Progress>) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let dir = match app.state::<Mode>().inner() {
        Mode::Update { dir } => dir.clone(),
        Mode::Install { .. } => return Err("not an update".into()),
    };
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or("Quackify is already up to date")?;
    let _ = progress.send(Progress::Found { version: update.version.clone() });
    // Some(None): a download whose size the server did not give, shown without a number.
    let (mut got, mut shown) = (0u64, None::<Option<u8>>);
    let bytes = update
        .download(
            |chunk, total| {
                got += chunk as u64;
                let percent = total.filter(|t| *t > 0).map(|t| (got * 100 / t).min(100) as u8);
                // Only when the number shown moves: thousands of chunks.
                if shown != Some(percent) {
                    shown = Some(percent);
                    let _ = progress.send(Progress::Downloading { percent });
                }
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    let _ = progress.send(Progress::Installing);
    tauri::async_runtime::spawn_blocking(move || {
        let installer = std::env::temp_dir().join(format!("Quackify-Update-{}.exe", update.version));
        install_from(&installer, &bytes, &["/UPDATE", "/R"], &dir)
    })
    .await
    .map_err(|e| e.to_string())??;
    app.exit(0);
    Ok(())
}

/// Opens the Quackify installed in `dir` and closes this window.
#[tauri::command]
fn setup_launch(app: AppHandle, dir: String) -> Result<(), String> {
    Command::new(Path::new(&dir).join(BINARY))
        .spawn()
        .map_err(|e| format!("could not open Quackify: {e}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn setup_close(app: AppHandle) {
    app.exit(0);
}

/// From the app: hands the update to a copy of this exe in the temp folder and quits.
#[tauri::command]
pub fn update_in_window(app: AppHandle) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("no install folder")?.to_path_buf();
    let copy = std::env::temp_dir().join(UPDATER_EXE);
    std::fs::copy(&exe, &copy).map_err(|e| format!("could not copy Quackify for the update: {e}"))?;
    Command::new(&copy)
        .arg(UPDATE_ARG)
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("could not start the update: {e}"))?;
    app.exit(0);
    Ok(())
}

/// The updater copy a past update left in the temp folder (it cannot delete its own file).
pub fn clean_up() {
    let _ = std::fs::remove_file(std::env::temp_dir().join(UPDATER_EXE));
}
