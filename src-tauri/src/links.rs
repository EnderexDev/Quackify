// Spotify links: Quackify offers itself to Windows as an app for spotify: links (the "Open
// Spotify" buttons on web pages, links in other apps), and opens the pages they point to.
//
// Windows keeps the user's choice of app per link type, and no app may set it for them: Quackify
// only shows up in the list, and the Settings page sends the user to Windows' page to pick it.
// Spotify's own spotify: key is left alone (Spotify writes it back on every start anyway).
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

/// The name Windows lists Quackify under, and the key its default-apps page is opened with.
#[cfg_attr(not(windows), allow(dead_code))]
const APP_NAME: &str = "Quackify";
/// The handler Windows records as the user's choice for spotify: links.
#[cfg_attr(not(windows), allow(dead_code))]
const PROG_ID: &str = "Quackify.spotify";

/// A link that arrived before the page could open it (at launch, or before logging in).
#[derive(Default)]
pub struct Pending(Mutex<Option<String>>);

/// The spotify: URI a command-line argument points to: spotify:track:ID, spotify://track/ID,
/// the old spotify:user:NAME:playlist:ID, or an open.spotify.com link.
pub fn to_uri(arg: &str) -> Option<String> {
    let arg = arg.trim().trim_matches('"');
    let arg = arg.strip_prefix("--protocol-uri=").unwrap_or(arg);
    let lower = arg.to_ascii_lowercase();
    let rest = if lower.starts_with("spotify:") {
        &arg["spotify:".len()..]
    } else {
        let web = ["https://", "http://", ""]
            .iter()
            .find_map(|scheme| lower.strip_prefix(scheme)?.strip_prefix("open.spotify.com/").map(|r| r.len()))?;
        &arg[arg.len() - web..]
    };
    // No query (?si=… share codes) or fragment.
    let rest = rest.split(['?', '#']).next().unwrap_or_default();
    let mut parts: Vec<&str> = rest.split([':', '/']).filter(|p| !p.is_empty()).collect();
    // open.spotify.com/intl-pt/track/ID and the embed player's open.spotify.com/embed/track/ID.
    if parts.first().is_some_and(|p| p.starts_with("intl-") || *p == "embed") {
        parts.remove(0);
    }
    let id_ok = |id: &str| id.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
    // Usernames come escaped in links (%2E, + for a space); they stay as they are.
    let user_ok = |name: &str| name.chars().all(|c| c.is_ascii_alphanumeric() || "._-%+".contains(c));
    match parts.as_slice() {
        ["user", _, "playlist", id, ..] if id_ok(id) => Some(format!("spotify:playlist:{id}")),
        // Liked Songs. Saved albums, artists and episodes have no page of their own here (they are
        // in Your Library): those links only bring the window up.
        ["user", _, "collection"] | ["user", _, "collection", "tracks"] | ["collection"] | ["collection", "tracks"] => {
            Some("spotify:collection:tracks".into())
        }
        ["user", name] if user_ok(name) => Some(format!("spotify:user:{name}")),
        [kind @ ("track" | "album" | "artist" | "playlist" | "show" | "episode" | "page" | "genre"), id, ..]
            if id_ok(id) =>
        {
            let kind = if *kind == "genre" { "page" } else { kind };
            Some(format!("spotify:{kind}:{id}"))
        }
        _ => None,
    }
}

/// Hands the first link among `args` to the page. The window is brought up by the callers (the
/// second-launch handler, and a start without `--minimized`), also for links with no page.
pub fn handle_args(app: &AppHandle, args: &[String]) {
    // The first argument is the program itself.
    let Some(uri) = args.iter().skip(1).find_map(|a| to_uri(a)) else { return };
    *app.state::<Pending>().0.lock().unwrap() = Some(uri);
    let _ = app.emit("open-link", ());
}

/// The link waiting to be opened, once: the page calls this when told and when it starts.
#[tauri::command]
pub fn links_take(app: AppHandle) -> Option<String> {
    app.state::<Pending>().0.lock().unwrap().take()
}

/// Whether spotify: links open in Quackify.
#[tauri::command]
pub fn links_status(app: AppHandle) -> bool {
    #[cfg(windows)]
    {
        !crate::variant::is_dev(&app) && registry::is_default()
    }
    #[cfg(not(windows))]
    false
}

/// Makes sure Windows lists Quackify for spotify: links and opens its page for picking the app.
#[tauri::command]
pub fn links_choose(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if crate::variant::is_dev(&app) {
        return Err("Spotify links open in the official Quackify; the dev build leaves them alone.".into());
    }
    #[cfg(windows)]
    registry::register()?;
    let opener = app.opener();
    opener
        .open_url(format!("ms-settings:defaultapps?registeredAppUser={APP_NAME}"), None::<&str>)
        .or_else(|_| opener.open_url("ms-settings:defaultapps", None::<&str>))
        .map_err(|e| e.to_string())
}

/// Offers Quackify for spotify: links, at every start: the program's path follows where it runs
/// from. Picking it stays the user's call. The dev build does not: the keys would point the
/// official app's links at it.
pub fn setup(app: &tauri::App) {
    app.manage(Pending::default());
    #[cfg(windows)]
    if !crate::variant::is_dev(app.handle())
        && let Err(e) = registry::register()
    {
        eprintln!("links: not offered to Windows: {e}");
    }
    handle_args(app.handle(), &std::env::args().collect::<Vec<_>>());
}

#[cfg(windows)]
mod registry {
    use winreg::RegKey;
    use winreg::enums::{HKEY_CLASSES_ROOT, HKEY_CURRENT_USER};

    use super::{APP_NAME, PROG_ID};

    const CAPABILITIES: &str = r"Software\Quackify\Capabilities";

    /// The user's own keys only: no administrator rights needed.
    pub fn register() -> Result<(), String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?.display().to_string();
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let set = |path: &str, name: &str, value: &str| -> std::io::Result<()> {
            hkcu.create_subkey(path)?.0.set_value(name, &value)
        };
        let class = format!(r"Software\Classes\{PROG_ID}");
        let write = || -> std::io::Result<()> {
            set(&class, "", "Spotify link")?;
            set(&class, "URL Protocol", "")?;
            set(&format!(r"{class}\DefaultIcon"), "", &format!("\"{exe}\",0"))?;
            set(&format!(r"{class}\shell\open\command"), "", &format!("\"{exe}\" \"%1\""))?;
            set(CAPABILITIES, "ApplicationName", APP_NAME)?;
            set(CAPABILITIES, "ApplicationDescription", "A yellow, duck-flavoured Spotify client")?;
            set(&format!(r"{CAPABILITIES}\URLAssociations"), "spotify", PROG_ID)?;
            set(r"Software\RegisteredApplications", APP_NAME, CAPABILITIES)
        };
        write().map_err(|e| e.to_string())?;
        notify_changed();
        Ok(())
    }

    /// The user's choice for spotify: links, or with none, what the plain spotify: key runs.
    pub fn is_default() -> bool {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let choice = hkcu
            .open_subkey(r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\spotify\UserChoice")
            .and_then(|k| k.get_value::<String, _>("ProgId"));
        match choice {
            Ok(prog_id) => prog_id.eq_ignore_ascii_case(PROG_ID),
            Err(_) => {
                let Ok(exe) = std::env::current_exe() else { return false };
                RegKey::predef(HKEY_CLASSES_ROOT)
                    .open_subkey(r"spotify\shell\open\command")
                    .and_then(|k| k.get_value::<String, _>(""))
                    .is_ok_and(|cmd| cmd.to_lowercase().contains(&exe.display().to_string().to_lowercase()))
            }
        }
    }

    /// Tells Explorer and Settings that the list of apps for links changed.
    fn notify_changed() {
        #[link(name = "shell32")]
        unsafe extern "system" {
            fn SHChangeNotify(event: i32, flags: u32, item1: *const std::ffi::c_void, item2: *const std::ffi::c_void);
        }
        const SHCNE_ASSOCCHANGED: i32 = 0x0800_0000;
        const SHCNF_IDLIST: u32 = 0;
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, std::ptr::null(), std::ptr::null()) };
    }
}

#[cfg(test)]
mod tests {
    use super::to_uri;

    #[test]
    fn links_of_every_shape_become_uris() {
        let id = "4uLU6hMCjMI75M1A2tKUQC";
        let track = Some(format!("spotify:track:{id}"));
        assert_eq!(to_uri(&format!("spotify:track:{id}")), track);
        assert_eq!(to_uri(&format!("\"spotify:track:{id}?si=abc123\"")), track);
        assert_eq!(to_uri(&format!("spotify://track/{id}")), track);
        assert_eq!(to_uri(&format!("--protocol-uri=spotify:track:{id}")), track);
        assert_eq!(to_uri(&format!("https://open.spotify.com/track/{id}?si=x")), track);
        assert_eq!(to_uri(&format!("https://open.spotify.com/intl-pt/track/{id}")), track);
        assert_eq!(to_uri(&format!("open.spotify.com/embed/track/{id}")), track);
        assert_eq!(to_uri(&format!("spotify:user:someone:playlist:{id}")), Some(format!("spotify:playlist:{id}")));
        assert_eq!(to_uri("spotify:user:someone:collection"), Some("spotify:collection:tracks".into()));
        assert_eq!(to_uri("spotify:collection:tracks"), Some("spotify:collection:tracks".into()));
        assert_eq!(to_uri("spotify:user:ender.dev"), Some("spotify:user:ender.dev".into()));
        assert_eq!(to_uri("spotify:user:ender%2Edev"), Some("spotify:user:ender%2Edev".into()));
        assert_eq!(to_uri("https://open.spotify.com/user/a+b?si=1"), Some("spotify:user:a+b".into()));
        assert_eq!(to_uri(&format!("https://open.spotify.com/genre/{id}")), Some(format!("spotify:page:{id}")));
    }

    #[test]
    fn other_arguments_are_not_links() {
        assert_eq!(to_uri("--minimized"), None);
        assert_eq!(to_uri("spotify:"), None);
        assert_eq!(to_uri("spotify:track:"), None);
        assert_eq!(to_uri("spotify:track:a b"), None);
        assert_eq!(to_uri("spotify:collection:albums"), None);
        assert_eq!(to_uri("spotify:user:someone:collection:artists"), None);
        assert_eq!(to_uri("spotify:track:a%20b"), None);
        assert_eq!(to_uri("https://example.com/track/abc"), None);
        assert_eq!(to_uri("C:\\Program Files\\Quackify\\quackify.exe"), None);
    }
}
