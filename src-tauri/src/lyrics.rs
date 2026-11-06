// Lyrics from outside Spotify, for the songs Spotify has none for (or fails to send): LRCLIB
// and NetEase Cloud Music, both open without a key. A wrong song's lyrics are worse than none,
// so a hit counts only when the length is within 3s, the title matches and one artist does.
use std::sync::OnceLock;
use std::time::Duration;

use serde_json::Value;

use crate::spotify::{Lyrics, LyricsLine};

/// How far a hit's length may be from the song's.
const DURATION_SLACK_MS: u64 = 3_000;
const TIMEOUT: Duration = Duration::from_secs(8);
const LRCLIB: &str = "LRCLIB";
const NETEASE: &str = "NetEase Cloud Music";

/// The song as Spotify's metadata has it.
pub(crate) struct Song {
    pub title: String,
    pub artists: Vec<String>,
    pub duration_ms: u64,
}

/// The client, or None when it cannot be built (then the other sources are just skipped:
/// `Client::default` would panic, and the release build aborts on a panic).
fn http() -> Option<&'static reqwest::Client> {
    static CLIENT: OnceLock<Option<reqwest::Client>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .user_agent(concat!(
                    "Quackify/",
                    env!("CARGO_PKG_VERSION"),
                    " (https://github.com/EnderexDev/Quackify)"
                ))
                .timeout(TIMEOUT)
                .build()
                .map_err(|e| log::warn!("[lyrics] no HTTP client: {e}"))
                .ok()
        })
        .as_ref()
}

/// The most a source's answer may weigh: a song's lyrics are a few KB.
const MAX_BODY: usize = 2 * 1024 * 1024;
/// The most lines a song's lyrics may have once repeated times are spread out.
const MAX_LINES: usize = 5_000;

/// The JSON a request answers, read up to `MAX_BODY`; None on any failure.
async fn get_json(req: reqwest::RequestBuilder, source: &str) -> Option<Value> {
    let mut res = req.send().await.map_err(|e| log::warn!("[lyrics] {source}: {e}")).ok()?;
    if res.content_length().is_some_and(|n| n as usize > MAX_BODY) {
        return None;
    }
    let mut body = Vec::new();
    while let Some(chunk) = res.chunk().await.ok()? {
        body.extend_from_slice(&chunk);
        if body.len() > MAX_BODY {
            return None;
        }
    }
    serde_json::from_slice(&body).ok()
}

/// The lyrics of `song` from the other sources, synced ones first: LRCLIB synced, NetEase
/// synced, then the best unsynced. None when no source has a match.
pub(crate) async fn find(song: &Song) -> Option<Lyrics> {
    if song.duration_ms == 0 || song.title.trim().is_empty() {
        return None;
    }
    // Both at once; synced LRCLIB lyrics answer without waiting for NetEase.
    let lrclib = from_lrclib(song);
    let netease = from_netease(song);
    tokio::pin!(lrclib, netease);
    let (mut a, mut b) = (None, None);
    let (mut a_done, mut b_done) = (false, false);
    while !(a_done && b_done) {
        tokio::select! {
            l = &mut lrclib, if !a_done => {
                a_done = true;
                a = l;
                if a.as_ref().is_some_and(|l| l.synced) {
                    break;
                }
            }
            l = &mut netease, if !b_done => {
                b_done = true;
                b = l;
            }
        }
    }
    let both = [a, b];
    let found = match both.iter().position(|l| l.as_ref().is_some_and(|l| l.synced)) {
        Some(i) => both.into_iter().nth(i).flatten(),
        None => both.into_iter().flatten().next(),
    }?;
    log::info!(
        "[lyrics] {} - {}: from {} ({})",
        song.artists.first().map(String::as_str).unwrap_or(""),
        song.title,
        found.provider,
        if found.synced { "synced" } else { "unsynced" }
    );
    Some(found)
}

async fn from_lrclib(song: &Song) -> Option<Lyrics> {
    let req = http()?.get("https://lrclib.net/api/search").query(&[
        ("track_name", clean_title(&song.title).as_str()),
        ("artist_name", song.artists.first().map(String::as_str).unwrap_or("")),
    ]);
    pick_lrclib(song, &get_json(req, LRCLIB).await?)
}

/// The best LRCLIB hit for `song`: a matching one with synced lyrics, else one with plain ones.
/// Instrumental hits carry no lyrics, so they never win.
fn pick_lrclib(song: &Song, hits: &Value) -> Option<Lyrics> {
    let matching: Vec<&Value> = hits
        .as_array()?
        .iter()
        .filter(|h| {
            let ms = (h["duration"].as_f64().unwrap_or(0.0) * 1000.0) as u64;
            matches(song, h["trackName"].as_str().unwrap_or(""), &[h["artistName"].as_str().unwrap_or("")], ms)
        })
        .collect();
    let synced = matching
        .iter()
        .find_map(|h| h["syncedLyrics"].as_str().and_then(|t| from_text(t, LRCLIB)).filter(|l| l.synced));
    synced.or_else(|| matching.iter().find_map(|h| h["plainLyrics"].as_str().and_then(|t| from_text(t, LRCLIB))))
}

async fn from_netease(song: &Song) -> Option<Lyrics> {
    let query = format!("{} {}", clean_title(&song.title), song.artists.first().map(String::as_str).unwrap_or(""));
    let req = http()?
        .get("https://music.163.com/api/search/get")
        .query(&[("s", query.as_str()), ("type", "1"), ("limit", "10")]);
    let found = get_json(req, NETEASE).await?;
    // The first two matching songs: NetEase often has the same song twice, one without lyrics
    // or without times. Synced wins; the first plain one waits as the second choice.
    let mut plain = None;
    for id in netease_ids(song, &found).into_iter().take(2) {
        let req = http()?
            .get("https://music.163.com/api/song/lyric")
            .query(&[("id", id.to_string().as_str()), ("lv", "1"), ("kv", "1"), ("tv", "-1")]);
        let Some(v) = get_json(req, NETEASE).await else { continue };
        match v["lrc"]["lyric"].as_str().and_then(|t| from_text(t, NETEASE)) {
            Some(l) if l.synced => return Some(l),
            Some(l) => plain = plain.or(Some(l)),
            None => {}
        }
    }
    plain
}

/// The ids of the NetEase search results that are `song`.
fn netease_ids(song: &Song, found: &Value) -> Vec<u64> {
    let Some(songs) = found["result"]["songs"].as_array() else { return Vec::new() };
    songs
        .iter()
        .filter(|s| {
            let artists: Vec<&str> = s["artists"]
                .as_array()
                .map(|a| a.iter().filter_map(|a| a["name"].as_str()).collect())
                .unwrap_or_default();
            matches(song, s["name"].as_str().unwrap_or(""), &artists, s["duration"].as_u64().unwrap_or(0))
        })
        .filter_map(|s| s["id"].as_u64())
        .collect()
}

/// Whether a hit is `song`: the length within the slack, the title the same once both are
/// cleaned, and one of the song's artists named in the hit's.
fn matches(song: &Song, title: &str, artists: &[&str], duration_ms: u64) -> bool {
    if duration_ms == 0 || duration_ms.abs_diff(song.duration_ms) > DURATION_SLACK_MS {
        return false;
    }
    let same_title = norm(&clean_title(title)) == norm(&clean_title(&song.title)) || norm(title) == norm(&song.title);
    if !same_title {
        return false;
    }
    let theirs: Vec<String> = artists.iter().map(|a| norm(a)).collect();
    song.artists.iter().map(|a| norm(a)).filter(|a| !a.is_empty()).any(|ours| {
        theirs.iter().any(|t| t == &ours || t.split(' ').collect::<Vec<_>>().windows(ours.split(' ').count()).any(|w| w.join(" ") == ours))
    })
}

/// The title without what Spotify adds to it: " - Remastered 2011", " - Live", "(feat. X)",
/// "[Bonus Track]".
fn clean_title(title: &str) -> String {
    let mut t = title.to_string();
    if let Some(i) = t.find(" - ") {
        t.truncate(i);
    }
    let mut out = String::new();
    let mut depth = 0u32;
    for c in t.chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = depth.saturating_sub(1),
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    let out = out.trim().to_string();
    // A title that is all parentheses ("(Untitled)") keeps them.
    if out.is_empty() { t.trim().to_string() } else { out }
}

/// Lowercase, without accents and punctuation, single spaces. Letters of other scripts stay.
fn norm(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars().flat_map(char::to_lowercase) {
        let c = match c {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => 'a',
            'è' | 'é' | 'ê' | 'ë' => 'e',
            'ì' | 'í' | 'î' | 'ï' => 'i',
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' => 'o',
            'ù' | 'ú' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            'ý' | 'ÿ' => 'y',
            '&' => ' ',
            c => c,
        };
        if c.is_alphanumeric() {
            out.push(c);
        } else if c.is_whitespace() || matches!(c, '-' | '/' | '_' | '.' | ',') {
            if !out.ends_with(' ') && !out.is_empty() {
                out.push(' ');
            }
        }
        // Apostrophes and other marks vanish: "don't" and "dont" are the same.
    }
    out.trim_end().to_string()
}

/// Lyrics from a source's text: LRC (`[mm:ss.xx]` before each line) or plain lines.
fn from_text(text: &str, provider: &str) -> Option<Lyrics> {
    let mut timed: Vec<(u64, String)> = Vec::new();
    let mut plain: Vec<String> = Vec::new();
    let mut bytes = 0usize;
    for raw in text.lines() {
        let raw = raw.trim().replace('\u{200b}', "");
        let mut rest = raw.as_str();
        let mut times = Vec::new();
        while let Some(tag) = rest.strip_prefix('[').and_then(|r| r.split_once(']')) {
            match lrc_time(tag.0) {
                // Checked per tag, so a line of thousands of times never gets copied out.
                Some(_) if timed.len() + times.len() >= MAX_LINES => return None,
                Some(ms) => times.push(ms),
                // [ar:...], [ti:...] and the like: not a line of the song.
                None => break,
            }
            rest = tag.1;
        }
        if rest.starts_with('[') && times.is_empty() {
            continue;
        }
        let words = rest.trim().to_string();
        if is_credit(&words) {
            continue;
        }
        // Text budget after the repeats are spread out, so one long line with many times
        // cannot be copied into gigabytes.
        bytes = bytes.saturating_add(words.len().saturating_mul(times.len().max(1)));
        if bytes > MAX_BODY {
            return None;
        }
        if times.is_empty() {
            plain.push(words);
        } else {
            // A chorus written once with several times goes in at each.
            timed.extend(times.into_iter().map(|t| (t, words.clone())));
        }
        if timed.len() + plain.len() > MAX_LINES {
            return None;
        }
    }
    let synced = timed.iter().any(|(t, _)| *t > 0);
    let mut lines: Vec<LyricsLine> = if synced {
        timed.sort_by_key(|(t, _)| *t);
        timed.into_iter().map(|(start_ms, words)| LyricsLine { start_ms, words }).collect()
    } else {
        timed.into_iter().map(|(_, w)| w).chain(plain).map(|words| LyricsLine { start_ms: 0, words }).collect()
    };
    // One blank between parts, none at the ends (the UI shows a blank synced line as ♪).
    lines.dedup_by(|b, a| a.words.is_empty() && b.words.is_empty());
    if !synced {
        lines.retain(|l| !l.words.is_empty());
    }
    while lines.first().is_some_and(|l| l.words.is_empty()) {
        lines.remove(0);
    }
    while lines.last().is_some_and(|l| l.words.is_empty()) {
        lines.pop();
    }
    if lines.is_empty() || lines.iter().all(|l| is_no_lyrics(&l.words)) {
        return None;
    }
    Some(Lyrics::from_source(synced, lines, provider))
}

/// `mm:ss`, `mm:ss.xx` or `mm:ss.xxx` in milliseconds.
fn lrc_time(tag: &str) -> Option<u64> {
    let (m, s) = tag.split_once(':')?;
    let m: u64 = m.trim().parse().ok()?;
    let (s, frac) = s.split_once(['.', ':']).unwrap_or((s, ""));
    let s: u64 = s.trim().parse().ok()?;
    let frac_ms = match frac.len() {
        0 => 0,
        1 => frac.parse::<u64>().ok()? * 100,
        2 => frac.parse::<u64>().ok()? * 10,
        _ => frac.get(..3)?.parse::<u64>().ok()?,
    };
    // Huge numbers from the source give None instead of overflowing.
    m.checked_mul(60_000)?.checked_add(s.checked_mul(1000)?)?.checked_add(frac_ms)
}

/// NetEase's credit lines ("作词 : X", "作曲 : Y").
fn is_credit(words: &str) -> bool {
    const ROLES: &[&str] = &[
        "作词", "作曲", "编曲", "制作人", "制作", "混音", "母带", "录音", "和声", "监制", "出品", "发行", "词", "曲",
    ];
    let Some((head, _)) = words.split_once([':', '：']) else { return false };
    ROLES.contains(&head.trim())
}

/// NetEase's line for a song with no lyrics ("纯音乐，请欣赏", pure music, enjoy).
fn is_no_lyrics(words: &str) -> bool {
    words.is_empty() || words.contains("纯音乐")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn song() -> Song {
        Song { title: "Azul da Cor do Mar - Remastered".into(), artists: vec!["Tim Maia".into()], duration_ms: 200_000 }
    }

    #[test]
    fn reads_lrc_with_credits_and_repeated_times() {
        let t = "[00:00.000] 作词 : Tim Maia\n[00:00.000] 作曲 : Tim Maia\n[ar:Tim Maia]\n[00:06.914]\u{200b}Ah, se o mundo\u{200b}\n[00:15.81]Tenho muito\n[00:20.00][01:20.5]Refrão\n[00:30.00]\n[00:31.00]\n[00:40.00]Fim\n[00:50.00]";
        let l = from_text(t, NETEASE).unwrap();
        assert!(l.synced);
        let got: Vec<(u64, &str)> = l.lines.iter().map(|x| (x.start_ms, x.words.as_str())).collect();
        assert_eq!(
            got,
            // The blank at 50s sits before the repeated chorus, so it stays; two blanks in a row
            // become one.
            vec![
                (6914, "Ah, se o mundo"),
                (15810, "Tenho muito"),
                (20000, "Refrão"),
                (30000, ""),
                (40000, "Fim"),
                (50000, ""),
                (80500, "Refrão")
            ]
        );
    }

    #[test]
    fn plain_text_is_unsynced_and_pure_music_is_none() {
        let l = from_text("Linha um\n\nLinha dois\n", LRCLIB).unwrap();
        assert!(!l.synced);
        assert_eq!(l.lines.len(), 2);
        assert_eq!(from_text("[00:00.00]纯音乐，请欣赏", NETEASE), None);
        assert_eq!(from_text("[00:00.00] 作词 : X\n", NETEASE), None);
        assert_eq!(from_text("", LRCLIB), None);
    }

    #[test]
    fn cleans_titles_and_names() {
        assert_eq!(clean_title("Hey Jude - Remastered 2015"), "Hey Jude");
        assert_eq!(clean_title("Stay (feat. Justin Bieber)"), "Stay");
        assert_eq!(clean_title("(Untitled)"), "(Untitled)");
        assert_eq!(norm("Coração  Selvagem!"), "coracao selvagem");
        assert_eq!(norm("Don't Stop Me Now"), "dont stop me now");
    }

    #[test]
    fn match_needs_length_title_and_artist() {
        let s = song();
        assert!(matches(&s, "Azul Da Cor Do Mar", &["Tim Maia"], 198_922));
        assert!(matches(&s, "Azul da cor do mar (Ao Vivo)", &["Tim Maia & Banda"], 201_000));
        // 4s off: another version.
        assert!(!matches(&s, "Azul Da Cor Do Mar", &["Tim Maia"], 204_100));
        assert!(!matches(&s, "Azul Da Cor Do Mar", &["Marisa Monte"], 200_000));
        assert!(!matches(&s, "Gostava Tanto de Você", &["Tim Maia"], 200_000));
        // A name inside a longer one only counts as whole words.
        assert!(!matches(&Song { artists: vec!["Tim".into()], ..song() }, "Azul da Cor do Mar", &["Timbaland"], 200_000));
    }

    #[test]
    fn picks_the_synced_lrclib_hit_that_matches() {
        let hits = serde_json::json!([
            { "trackName": "Azul Da Cor Do Mar", "artistName": "Tim Maia", "duration": 240.0, "syncedLyrics": "[00:01.00]Errada" },
            { "trackName": "Azul Da Cor Do Mar", "artistName": "Tim Maia", "duration": 199.0, "plainLyrics": "Simples", "syncedLyrics": null },
            { "trackName": "Azul Da Cor Do Mar", "artistName": "Tim Maia", "duration": 201.0, "syncedLyrics": "[00:02.00]Certa" }
        ]);
        let l = pick_lrclib(&song(), &hits).unwrap();
        assert!(l.synced);
        assert_eq!(l.lines[0].words, "Certa");
        assert_eq!(l.provider, "LRCLIB");
        let instrumental = serde_json::json!([{ "trackName": "Azul da Cor do Mar", "artistName": "Tim Maia", "duration": 200.0, "instrumental": true, "plainLyrics": null }]);
        assert_eq!(pick_lrclib(&song(), &instrumental), None);
        // An instrumental hit first does not hide a later one with lyrics.
        let mixed = serde_json::json!([
            { "trackName": "Azul da Cor do Mar", "artistName": "Tim Maia", "duration": 200.0, "instrumental": true },
            { "trackName": "Azul da Cor do Mar", "artistName": "Tim Maia", "duration": 200.0, "syncedLyrics": "[00:02.00]Certa" }
        ]);
        assert_eq!(pick_lrclib(&song(), &mixed).unwrap().lines[0].words, "Certa");
    }

    #[test]
    fn odd_or_huge_lrc_does_not_panic_or_blow_up() {
        assert_eq!(lrc_time("00:01.a中"), None);
        assert_eq!(lrc_time("00:01.中"), None);
        assert_eq!(lrc_time("01:02.345"), Some(62_345));
        assert_eq!(lrc_time("18446744073709551615:00.00"), None);
        assert_eq!(lrc_time("00:18446744073709551615.00"), None);
        // Few times, one long line: refused by the text budget, not the line count.
        let long = format!("{}{}", "[00:01.00]".repeat(2_000), "x".repeat(10_000));
        assert_eq!(from_text(&long, LRCLIB), None);
        let tags = "[00:01.00]".repeat(MAX_LINES + 1);
        assert_eq!(from_text(&format!("{tags}la"), LRCLIB), None);
        let many: String = (0..MAX_LINES + 1).map(|i| format!("[00:{:02}.00]la\n", i % 60)).collect();
        assert_eq!(from_text(&many, LRCLIB), None);
    }

    #[test]
    fn netease_ids_keep_only_matches() {
        let found = serde_json::json!({ "result": { "songs": [
            { "id": 1, "name": "Azul Da Cor Do Mar", "artists": [{ "name": "Tim Maia" }], "duration": 198_922 },
            { "id": 2, "name": "Azul Da Cor Do Mar", "artists": [{ "name": "Outro" }], "duration": 199_000 },
            { "id": 3, "name": "Azul Da Cor Do Mar", "artists": [{ "name": "Tim Maia" }], "duration": 260_000 }
        ] } });
        assert_eq!(netease_ids(&song(), &found), vec![1]);
    }

    /// Hits the real sources: `cargo test lyrics -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn finds_a_song_on_the_real_sources() {
        let s = Song { title: "Azul da Cor do Mar".into(), artists: vec!["Tim Maia".into()], duration_ms: 199_000 };
        let (a, b) = tokio::join!(from_lrclib(&s), from_netease(&s));
        let a = a.expect("LRCLIB");
        let b = b.expect("NetEase");
        assert!(a.lines.iter().any(|l| l.words.contains("mundo inteiro")));
        assert!(b.synced && b.lines.iter().any(|l| l.words.contains("mundo inteiro")));
        assert!(find(&s).await.unwrap().synced);
    }
}
