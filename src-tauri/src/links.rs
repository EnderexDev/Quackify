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
///
/// Besides Spotify's own URIs it gives the page (src/util/links.ts `openLink`, which reads the
/// same shapes the search does) three of Quackify's:
/// - `spotify:artist:ID:discography`, an artist's discography link;
/// - `spotify:episode:ID?t=SECONDS`, an episode shared from a point in it;
/// - `spotify:collection:albums` (`artists`, `podcasts`, `playlists`), a tab of Your Library.
///
/// An album link that marks one of its songs (`?highlight=spotify:track:ID`) is that song.
pub fn to_uri(arg: &str) -> Option<String> {
    let arg = arg.trim().trim_matches('"');
    let arg = arg.strip_prefix("--protocol-uri=").unwrap_or(arg);
    let lower = arg.to_ascii_lowercase();
    let rest = if lower.starts_with("spotify:") {
        &arg["spotify:".len()..]
    } else {
        let web = ["https://", "http://", ""].iter().find_map(|scheme| {
            let host = lower.strip_prefix(scheme)?;
            let host = host.strip_prefix("www.").unwrap_or(host);
            ["open.spotify.com/", "play.spotify.com/"].iter().find_map(|h| host.strip_prefix(h)).map(|r| r.len())
        })?;
        &arg[arg.len() - web..]
    };
    // The query (?si=… share codes) and fragment, read only for the two parameters above.
    let (path, query) = rest.split_once(['?', '#']).unwrap_or((rest, ""));
    let param = |name: &str| {
        query
            .split(['&', '?', '#'])
            .find_map(|kv| kv.split_once('=').filter(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v))
    };
    let mut parts: Vec<&str> = path.split([':', '/']).filter(|p| !p.is_empty()).collect();
    // open.spotify.com/intl-pt/track/ID and the embed player's open.spotify.com/embed/track/ID.
    if parts.first().is_some_and(|p| p.starts_with("intl-") || *p == "embed") {
        parts.remove(0);
    }
    let id_ok = |id: &str| id.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
    // Usernames come escaped in links (%2E, + for a space); they stay as they are.
    let user_ok = |name: &str| name.chars().all(|c| c.is_ascii_alphanumeric() || "._-%+".contains(c));
    match parts.as_slice() {
        ["user", _, "playlist", id, ..] if id_ok(id) => Some(format!("spotify:playlist:{id}")),
        // Liked Songs, and the tabs of Your Library. Saved episodes have no page of their own:
        // those links only bring the window up.
        ["user", _, "collection"] | ["user", _, "collection", "tracks"] | ["collection"] | ["collection", "tracks"] => {
            Some("spotify:collection:tracks".into())
        }
        ["user", _, "collection", tab @ ("albums" | "artists" | "podcasts" | "playlists")]
        | ["collection", tab @ ("albums" | "artists" | "podcasts" | "playlists")] => Some(format!("spotify:collection:{tab}")),
        ["user", name] if user_ok(name) => Some(format!("spotify:user:{name}")),
        // Spotify's search: the words stay escaped as they came (+ or %20 for a space).
        // Anything a URL keeps unescaped in a path segment (Don't%20Stop, (Live)).
        ["search", term, ..] if term.chars().all(|c| c.is_ascii_alphanumeric() || "._%+~!*'(),;-".contains(c)) => {
            Some(format!("spotify:search:{term}"))
        }
        ["album", id, ..] if id_ok(id) => {
            let song = param("highlight").and_then(|h| {
                let h = h.replace("%3A", ":").replace("%3a", ":");
                h.strip_prefix("spotify:track:").filter(|s| !s.is_empty() && id_ok(s)).map(str::to_owned)
            });
            Some(song.map_or_else(|| format!("spotify:album:{id}"), |s| format!("spotify:track:{s}")))
        }
        ["artist", id, "discography", ..] if id_ok(id) => Some(format!("spotify:artist:{id}:discography")),
        ["episode", id, ..] if id_ok(id) => {
            let at = param("t").filter(|t| !t.is_empty() && t.chars().all(|c| c.is_ascii_digit()) && *t != "0");
            Some(at.map_or_else(|| format!("spotify:episode:{id}"), |t| format!("spotify:episode:{id}?t={t}")))
        }
        [kind @ ("track" | "artist" | "playlist" | "show" | "page" | "genre"), id, ..] if id_ok(id) => {
            let kind = if *kind == "genre" { "page" } else { kind };
            Some(format!("spotify:{kind}:{id}"))
        }
        _ => None,
    }
}

/// The address of a Spotify short link (spotify.link, from the phone app's Share; the older
/// spoti.fi and link.tospotify.com), which says where it points only when fetched.
pub fn short_link(arg: &str) -> Option<String> {
    let arg = arg.trim().trim_matches('"');
    let lower = arg.to_ascii_lowercase();
    let host_and_code = ["https://", "http://", ""].iter().find_map(|s| lower.strip_prefix(s))?;
    let (host, code) = host_and_code.split_once('/')?;
    let known = ["spotify.link", "spotify.app.link", "spoti.fi", "link.tospotify.com"].contains(&host);
    let code = code.split(['?', '#']).next().unwrap_or_default();
    (known && !code.is_empty() && code.chars().all(|c| c.is_ascii_alphanumeric() || "_-".contains(c)))
        .then(|| format!("https://{}", &arg[arg.len() - host_and_code.len()..]))
}

/// Where a short link points. spotify.link answers an app (not a browser) with a 200 page that
/// carries the open.spotify.com address (measured 12/11/26: the redirect is in its script);
/// spoti.fi redirects over HTTP.
pub async fn resolve_short(url: &str) -> Option<String> {
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(10)).build().ok()?;
    let res = client.get(url).send().await.ok()?;
    if let Some(uri) = to_uri(res.url().as_str()) {
        return Some(uri);
    }
    let page = res.text().await.ok()?;
    page.match_indices("open.spotify.com/").find_map(|(at, _)| {
        let tail = &page[at..];
        let end = tail.find(|c: char| c == '"' || c == '\'' || c == '<' || c.is_whitespace()).unwrap_or(tail.len());
        to_uri(&tail[..end].replace("&amp;", "&"))
    })
}

/// A link typed or pasted in the search: what it points to, a short link fetched first.
#[tauri::command]
pub async fn links_resolve(text: String) -> Option<String> {
    match to_uri(&text) {
        Some(uri) => Some(uri),
        None => resolve_short(&short_link(&text)?).await,
    }
}

/// Hands the first link among `args` to the page. The window is brought up by the callers (the
/// second-launch handler, and a start without `--minimized`), also for links with no page.
pub fn handle_args(app: &AppHandle, args: &[String]) {
    // The first argument is the program itself.
    let args = &args[args.len().min(1)..];
    if let Some(uri) = args.iter().find_map(|a| to_uri(a)) {
        return hand_over(app, uri);
    }
    // A short link is fetched first; the window is already up meanwhile.
    let Some(url) = args.iter().find_map(|a| short_link(a)) else { return };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match resolve_short(&url).await {
            Some(uri) => hand_over(&app, uri),
            None => log::warn!("links: {url} points nowhere Quackify knows"),
        }
    });
}

fn hand_over(app: &AppHandle, uri: String) {
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
        log::warn!("links: not offered to Windows: {e}");
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
    use super::{resolve_short, short_link, to_uri};

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
        assert_eq!(to_uri(&format!("https://www.open.spotify.com/track/{id}")), track);
        assert_eq!(to_uri(&format!("www.open.spotify.com/track/{id}")), track);
        assert_eq!(to_uri(&format!("open.spotify.com/embed/track/{id}")), track);
        assert_eq!(to_uri(&format!("spotify:user:someone:playlist:{id}")), Some(format!("spotify:playlist:{id}")));
        assert_eq!(to_uri("spotify:user:someone:collection"), Some("spotify:collection:tracks".into()));
        assert_eq!(to_uri("spotify:collection:tracks"), Some("spotify:collection:tracks".into()));
        assert_eq!(to_uri("spotify:user:ender.dev"), Some("spotify:user:ender.dev".into()));
        assert_eq!(to_uri("spotify:user:ender%2Edev"), Some("spotify:user:ender%2Edev".into()));
        assert_eq!(to_uri("https://open.spotify.com/user/a+b?si=1"), Some("spotify:user:a+b".into()));
        assert_eq!(to_uri(&format!("https://open.spotify.com/genre/{id}")), Some(format!("spotify:page:{id}")));
        assert_eq!(to_uri(&format!("https://play.spotify.com/track/{id}")), track);
    }

    #[test]
    fn links_to_quackify_pages() {
        let id = "4uLU6hMCjMI75M1A2tKUQC";
        let song = "7xtG2Kac0KPcd1ThPEGbZw";
        assert_eq!(to_uri("spotify:search:daft+punk"), Some("spotify:search:daft+punk".into()));
        assert_eq!(to_uri("https://open.spotify.com/search/daft%20punk"), Some("spotify:search:daft%20punk".into()));
        assert_eq!(to_uri("https://open.spotify.com/search/Don't%20Stop%20(Live)"), Some("spotify:search:Don't%20Stop%20(Live)".into()));
        assert_eq!(to_uri("https://open.spotify.com/search/a b"), None);
        assert_eq!(to_uri(&format!("https://open.spotify.com/album/{id}?highlight=spotify:track:{song}")), Some(format!("spotify:track:{song}")));
        assert_eq!(to_uri(&format!("https://open.spotify.com/album/{id}?si=x&highlight=spotify%3Atrack%3A{song}")), Some(format!("spotify:track:{song}")));
        assert_eq!(to_uri(&format!("https://open.spotify.com/album/{id}?si=x")), Some(format!("spotify:album:{id}")));
        assert_eq!(to_uri(&format!("https://open.spotify.com/artist/{id}/discography/all")), Some(format!("spotify:artist:{id}:discography")));
        assert_eq!(to_uri(&format!("https://open.spotify.com/episode/{id}?si=a&t=90")), Some(format!("spotify:episode:{id}?t=90")));
        assert_eq!(to_uri(&format!("https://open.spotify.com/episode/{id}?t=0")), Some(format!("spotify:episode:{id}")));
        assert_eq!(to_uri(&format!("https://open.spotify.com/episode/{id}?t=1m")), Some(format!("spotify:episode:{id}")));
        assert_eq!(to_uri("spotify:collection:albums"), Some("spotify:collection:albums".into()));
        assert_eq!(to_uri("spotify:user:someone:collection:artists"), Some("spotify:collection:artists".into()));
        assert_eq!(to_uri("https://open.spotify.com/collection/podcasts"), Some("spotify:collection:podcasts".into()));
    }

    #[test]
    fn short_links_are_known_by_host() {
        assert_eq!(short_link("https://spotify.link/hRkBrwub9xb"), Some("https://spotify.link/hRkBrwub9xb".into()));
        assert_eq!(short_link("spoti.fi/3abc?x=1"), Some("https://spoti.fi/3abc?x=1".into()));
        assert_eq!(short_link("https://spotify.link/"), None);
        assert_eq!(short_link("https://example.com/hRkBrwub9xb"), None);
        assert_eq!(short_link("https://open.spotify.com/track/x"), None);
    }

    /// Fetches a real short link; `cargo test -- --ignored` runs it.
    #[tokio::test]
    #[ignore = "network"]
    async fn a_real_short_link_resolves() {
        assert_eq!(resolve_short("https://spotify.link/hRkBrwub9xb").await, Some("spotify:track:7xtG2Kac0KPcd1ThPEGbZw".into()));
    }

    #[test]
    fn other_arguments_are_not_links() {
        assert_eq!(to_uri("--minimized"), None);
        assert_eq!(to_uri("spotify:"), None);
        assert_eq!(to_uri("spotify:track:"), None);
        assert_eq!(to_uri("spotify:track:a b"), None);
        assert_eq!(to_uri("spotify:collection:your-episodes"), None);
        assert_eq!(to_uri("spotify:search:"), None);
        assert_eq!(to_uri("spotify:track:a%20b"), None);
        assert_eq!(to_uri("https://example.com/track/abc"), None);
        assert_eq!(to_uri("C:\\Program Files\\Quackify\\quackify.exe"), None);
    }
}
