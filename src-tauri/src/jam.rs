// Spotify Jam (social-connect): the Jam this account is in, who is in it, and starting, ending
// or leaving one. An internal API like pathfinder: the routes were read from the official
// clients on 23/10/26 (the web player only reads a Jam's info; creating and joining live in the
// desktop and phone apps), so a Spotify update can move them.
//
// GET  /social-connect/v2/sessions/current         the Jam now; 404 when there is none
// GET  /social-connect/v2/sessions/current_or_new  that one, or a new one hosted by this account
// POST /social-connect/v3/sessions/{id}/leave      a guest leaves
// DELETE /social-connect/v3/sessions/{id}          the host ends it for everyone
use http::{header, HeaderMap, HeaderValue, Method};
use librespot_core::{error::ErrorKind, session::Session};
use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::spotify::SpotifyState;

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct Member {
    id: String,
    username: String,
    name: String,
    image: Option<String>,
    is_me: bool,
    is_host: bool,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct Jam {
    id: String,
    /// This account started it: it can end it for everyone.
    is_host: bool,
    /// The invite: opens the Jam in a friend's Spotify app.
    share_url: String,
    members: Vec<Member>,
    max_members: u32,
}

fn parse(v: &Value) -> Option<Jam> {
    let id = v["session_id"].as_str().filter(|s| !s.is_empty())?.to_string();
    let owner = v["session_owner_id"].as_str().unwrap_or_default();
    let token = v["join_session_uri"]
        .as_str()
        .and_then(|u| u.strip_prefix("spotify:socialsession:"))
        .or_else(|| v["join_session_token"].as_str())
        .filter(|t| !t.is_empty())?;
    let text = |m: &Value, key: &str| m[key].as_str().unwrap_or_default().to_string();
    let members = v["session_members"]
        .as_array()
        .map(|list| {
            list.iter()
                .map(|m| {
                    let id = text(m, "id");
                    let username = text(m, "username");
                    let name = m["display_name"].as_str().filter(|s| !s.is_empty()).map_or_else(|| username.clone(), str::to_string);
                    Member {
                        is_host: !owner.is_empty() && id == owner,
                        id,
                        username,
                        name,
                        image: m["image_url"].as_str().filter(|s| !s.is_empty()).map(str::to_string),
                        is_me: m["is_current_user"].as_bool().unwrap_or(false),
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    Some(Jam {
        id,
        is_host: v["is_session_owner"].as_bool().unwrap_or(false),
        share_url: format!("https://open.spotify.com/socialsession/{token}"),
        members,
        max_members: v["maxMemberCount"].as_u64().unwrap_or(32) as u32,
    })
}

async fn request(session: &Session, method: Method, path: &str) -> Result<Option<Value>, String> {
    let mut headers = HeaderMap::new();
    headers.insert(header::ACCEPT, HeaderValue::from_static("application/json"));
    headers.insert("app-platform", HeaderValue::from_static("WebPlayer"));
    match session.spclient().request(&method, path, Some(headers), None).await {
        Ok(bytes) if bytes.is_empty() => Ok(Some(Value::Null)),
        Ok(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|e| e.to_string()),
        Err(e) if e.kind == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// The Jam this account is in, hosting or as a guest; nothing when there is none.
#[tauri::command]
pub async fn jam_current(state: State<'_, SpotifyState>) -> Result<Option<Jam>, String> {
    let session = crate::spotify::session(&state).await?;
    Ok(request(&session, Method::GET, "/social-connect/v2/sessions/current").await?.as_ref().and_then(parse))
}

/// Starts a Jam hosted by this account (or returns the one it is already in).
#[tauri::command]
pub async fn jam_start(state: State<'_, SpotifyState>) -> Result<Jam, String> {
    let session = crate::spotify::session(&state).await?;
    let path = format!(
        "/social-connect/v2/sessions/current_or_new?activate=true&local_device_id={}&type=REMOTE",
        session.device_id()
    );
    request(&session, Method::GET, &path)
        .await?
        .as_ref()
        .and_then(parse)
        .ok_or_else(|| "Spotify did not start the Jam".to_string())
}

/// Ends the Jam for everyone (host) or leaves it (guest).
#[tauri::command]
pub async fn jam_stop(id: String, host: bool, state: State<'_, SpotifyState>) -> Result<(), String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("not a Jam id".into());
    }
    let session = crate::spotify::session(&state).await?;
    let (method, path) = if host {
        (Method::DELETE, format!("/social-connect/v3/sessions/{id}"))
    } else {
        (Method::POST, format!("/social-connect/v3/sessions/{id}/leave"))
    };
    // Already gone counts as done.
    request(&session, method, &path).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    // The shape Spotify answered on 23/10/26, cut down.
    fn sample() -> Value {
        serde_json::json!({
            "session_id": "3f01dd044b9fa276ef774b107c60ee83",
            "join_session_token": "1UTmPaW0Ph5XWaNRHI6RA7",
            "join_session_uri": "spotify:socialsession:1UTmPaW0Ph5XWaNRHI6RA7",
            "session_owner_id": "32ad",
            "is_session_owner": false,
            "maxMemberCount": 32,
            "session_members": [
                { "id": "32ad", "username": "host", "display_name": "Bruno Macedo", "image_url": "https://x/a.jpg", "is_current_user": false },
                { "id": "77ff", "username": "jose", "display_name": "", "image_url": "", "is_current_user": true }
            ]
        })
    }

    #[test]
    fn reads_a_jam() {
        let jam = parse(&sample()).unwrap();
        assert_eq!(jam.id, "3f01dd044b9fa276ef774b107c60ee83");
        assert!(!jam.is_host);
        assert_eq!(jam.share_url, "https://open.spotify.com/socialsession/1UTmPaW0Ph5XWaNRHI6RA7");
        assert_eq!(jam.max_members, 32);
        let [host, me] = &jam.members[..] else { panic!("two members") };
        assert!(host.is_host && !host.is_me);
        assert_eq!(host.name, "Bruno Macedo");
        assert_eq!(host.image.as_deref(), Some("https://x/a.jpg"));
        // No display name: the username; no picture: none.
        assert!(me.is_me && !me.is_host);
        assert_eq!(me.name, "jose");
        assert_eq!(me.image, None);
    }

    #[test]
    fn no_session_id_is_no_jam() {
        let mut v = sample();
        v["session_id"] = Value::from("");
        assert_eq!(parse(&v), None);
        assert_eq!(parse(&Value::Null), None);
    }
}
