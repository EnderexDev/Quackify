// Spotify's internal GraphQL API (pathfinder), the one the official clients use for home,
// search, library and the playlist/album/artist pages. The public Web API is rate limited to
// nothing for librespot's shared client id, so this is where the app's data comes from.
//
// Every operation is a persisted query named by a sha256 hash that changes when Spotify ships
// a new web player. A stale hash answers 412: the hashes are then re-read from the current web
// player bundle, saved, and the query is retried once.
use std::collections::HashMap;
use std::path::PathBuf;

use librespot_core::session::Session;
use regex::Regex;
use serde_json::{json, Value};
use tokio::sync::{Mutex, RwLock};

const ENDPOINT: &str = "https://api-partner.spotify.com/pathfinder/v2/query";
const WEB_PLAYER: &str = "https://open.spotify.com/";
const CDN: &str = "https://open.spotifycdn.com/cdn/build/web-player/";
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

// Read from the web player on 19/10/26; used until a 412 says otherwise.
const DEFAULT_HASHES: &[(&str, &str)] = &[
    ("home", "5fb7da7a03ee2776c0670856609cb85a189a3cecc36cc160b91cde79063b9cf1"),
    ("searchDesktop", "eef7cc54888d91bdd6802623477873caa3948ae173a0c34fd86827b267e94c03"),
    ("libraryV3", "390c78e5b951029bad359785e69b07b536a509c581cbcd0aded5e5067f187455"),
    ("fetchPlaylist", "21ea11a6ac75a5f3e01fd365d29c18e0a4a8b7dc09f89bbb5d73910190c6acaf"),
    ("getAlbum", "0b6ce3511e1b02e4a40fa95440f992acbe85080eb308af9194322d708fc1914f"),
    ("fetchLibraryTracks", "087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240"),
    ("queryArtistOverview", "9f8134ef565e78621f1e1793555bd6633c5ac144ae0f89604ed3ae3f80b3c8e6"),
    // Read on 20/10/26.
    ("areEntitiesInLibrary", "134337999233cc6fdd6b1e6dbf94841409f04a946c5c7b744b09ba0dfe5a85ed"),
    ("addToLibrary", "896ebcb47815681340860d121cb5d494e157e2a78d3950385cd54e0393c67148"),
    ("removeFromLibrary", "896ebcb47815681340860d121cb5d494e157e2a78d3950385cd54e0393c67148"),
    ("editablePlaylists", "d5c4b8096437dcc2ac9528c91dfcd299e35b747cda2f8f75d28f41f49c5092ba"),
    ("addToPlaylist", "b907ad6b088d5bf7680fa81198996d58398c2d55dfcdf59fcc959e0be98a418a"),
    ("removeFromPlaylist", "b907ad6b088d5bf7680fa81198996d58398c2d55dfcdf59fcc959e0be98a418a"),
    ("moveItemsInPlaylist", "b907ad6b088d5bf7680fa81198996d58398c2d55dfcdf59fcc959e0be98a418a"),
];

pub struct Pathfinder {
    http: reqwest::Client,
    hashes: RwLock<HashMap<String, String>>,
    // One refresh at a time; a query that waited on it just retries with the new hashes.
    refreshing: Mutex<()>,
    file: Option<PathBuf>,
}

impl Pathfinder {
    pub fn new(file: Option<PathBuf>) -> Self {
        let mut hashes: HashMap<String, String> = DEFAULT_HASHES
            .iter()
            .map(|(op, hash)| (op.to_string(), hash.to_string()))
            .collect();
        if let Some(saved) = file
            .as_ref()
            .and_then(|f| std::fs::read_to_string(f).ok())
            .and_then(|s| serde_json::from_str::<HashMap<String, String>>(&s).ok())
        {
            hashes.extend(saved);
        }
        Self {
            http: reqwest::Client::new(),
            hashes: RwLock::new(hashes),
            refreshing: Mutex::new(()),
            file,
        }
    }

    pub async fn query(&self, session: &Session, op: &str, variables: Value) -> Result<Value, String> {
        // An operation this build does not know yet may exist in the live web player.
        let hash = match self.hash(op).await {
            Ok(h) => h,
            Err(_) => {
                self.refresh("", op).await?;
                self.hash(op).await?
            }
        };
        match self.send(session, op, &hash, &variables).await? {
            Sent::Ok(v) => Ok(v),
            Sent::StaleHash => {
                self.refresh(&hash, op).await?;
                let hash = self.hash(op).await?;
                match self.send(session, op, &hash, &variables).await? {
                    Sent::Ok(v) => Ok(v),
                    Sent::StaleHash => Err(format!("{op}: Spotify rejected the current hash too")),
                }
            }
        }
    }

    async fn hash(&self, op: &str) -> Result<String, String> {
        self.hashes
            .read()
            .await
            .get(op)
            .cloned()
            .ok_or_else(|| format!("unknown operation {op}"))
    }

    async fn send(&self, session: &Session, op: &str, hash: &str, variables: &Value) -> Result<Sent, String> {
        let token = session
            .login5()
            .auth_token()
            .await
            .map_err(|e| format!("token: {e}"))?;
        let res = self
            .http
            .post(ENDPOINT)
            .bearer_auth(token.access_token)
            .header("app-platform", "WebPlayer")
            .json(&json!({
                "variables": variables,
                "operationName": op,
                "extensions": { "persistedQuery": { "version": 1, "sha256Hash": hash } },
            }))
            .send()
            .await
            .map_err(|e| format!("{op}: {e}"))?;
        let status = res.status();
        if status.as_u16() == 412 {
            return Ok(Sent::StaleHash);
        }
        let body: Value = res.json().await.map_err(|e| format!("{op}: {status}: {e}"))?;
        if !status.is_success() {
            return Err(format!("{op}: {status}"));
        }
        if body["data"].is_null() {
            return Err(format!("{op}: {}", body["errors"]));
        }
        Ok(Sent::Ok(body["data"].clone()))
    }

    /// Re-reads every operation hash from the live web player. `stale` is the hash that just
    /// failed: if another query already replaced it, there is nothing left to do.
    async fn refresh(&self, stale: &str, op: &str) -> Result<(), String> {
        let _guard = self.refreshing.lock().await;
        if self.hash(op).await.is_ok_and(|h| h != stale) {
            return Ok(());
        }
        let found = self.read_web_player().await?;
        if !found.contains_key(op) {
            return Err(format!("{op}: not found in the current web player"));
        }
        let mut hashes = self.hashes.write().await;
        hashes.extend(found);
        if let Some(file) = &self.file {
            if let Ok(s) = serde_json::to_string_pretty(&*hashes) {
                let _ = std::fs::write(file, s);
            }
        }
        Ok(())
    }

    async fn read_web_player(&self) -> Result<HashMap<String, String>, String> {
        let get = |url: String| async move {
            self.http
                .get(&url)
                .header("user-agent", USER_AGENT)
                .send()
                .await
                .and_then(|r| r.error_for_status())
                .map_err(|e| format!("{url}: {e}"))?
                .text()
                .await
                .map_err(|e| format!("{url}: {e}"))
        };
        let page = get(WEB_PLAYER.to_string()).await?;
        let main = Regex::new(r"web-player/(web-player\.[0-9a-f]+\.js)")
            .unwrap()
            .captures(&page)
            .map(|c| c[1].to_string())
            .ok_or("web player bundle not found")?;
        let bundle = get(format!("{CDN}{main}")).await?;
        let mut hashes = extract_hashes(&bundle);
        // Search lives in a lazily loaded route chunk.
        for chunk in route_chunks(&bundle, "search") {
            if let Ok(js) = get(format!("{CDN}{chunk}")).await {
                hashes.extend(extract_hashes(&js));
            }
        }
        Ok(hashes)
    }
}

enum Sent {
    Ok(Value),
    StaleHash,
}

fn extract_hashes(js: &str) -> HashMap<String, String> {
    Regex::new(r#""(\w+)","(?:query|mutation)","([0-9a-f]{64})""#)
        .unwrap()
        .captures_iter(js)
        .map(|c| (c[1].to_string(), c[2].to_string()))
        .collect()
}

/// File names of the webpack chunks whose name contains `word`, from the bundle's two maps
/// (`id:"name"` and `id:"contenthash"`).
fn route_chunks(bundle: &str, word: &str) -> Vec<String> {
    let names = Regex::new(r#"[{,](\d+):"([\w-]+)""#).unwrap();
    let mut out = vec![];
    for c in names.captures_iter(bundle) {
        let (id, name) = (&c[1], &c[2]);
        if !name.contains(word) || name.chars().all(|ch| ch.is_ascii_hexdigit()) {
            continue;
        }
        let hash = Regex::new(&format!(r#"[{{,]{id}:"([0-9a-f]{{8}})""#)).unwrap();
        if let Some(h) = hash.captures(bundle) {
            out.push(format!("{name}.{}.js", &h[1]));
        }
    }
    out.sort();
    out.dedup();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_operation_hashes() {
        let js = r#"x=new i.l("home","query","5fb7da7a03ee2776c0670856609cb85a189a3cecc36cc160b91cde79063b9cf1",null),y=new i.l("addToLibrary","mutation","aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",null)"#;
        let h = extract_hashes(js);
        assert_eq!(h["home"], DEFAULT_HASHES[0].1);
        assert_eq!(h["addToLibrary"].len(), 64);
    }

    /// Network: `cargo test --lib -- --ignored live_web_player`.
    #[tokio::test]
    #[ignore]
    async fn live_web_player_has_every_operation_the_app_uses() {
        let found = Pathfinder::new(None).read_web_player().await.unwrap();
        for (op, _) in DEFAULT_HASHES {
            assert!(found.contains_key(*op), "{op} missing from the live web player");
        }
    }

    #[test]
    fn finds_the_search_route_chunk() {
        let bundle = r#"u.u=e=>""+(({4146:"xpui-routes-your-library-x",4406:"xpui-routes-search",2706:"xpui-routes-recent-searches"})[e]||e)+"."+({4146:"b05b8bc0",4406:"0bd78592",2706:"90a401e7",9999:"12345678"})[e]+".js""#;
        assert_eq!(
            route_chunks(bundle, "search"),
            vec!["xpui-routes-recent-searches.90a401e7.js", "xpui-routes-search.0bd78592.js"]
        );
    }
}
