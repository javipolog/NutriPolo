use serde::{Deserialize, Serialize};
use tauri::Manager;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use tauri::AppHandle;
use rand::Rng;
use sha2::{Digest, Sha256};
use base64::Engine as _;

/// Generate a URL-safe random string of the given length from the
/// unreserved alphabet `[A-Za-z0-9]`. Used for OAuth `state` and for
/// the PKCE `code_verifier`.
fn random_url_safe(len: usize) -> String {
    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();
    (0..len)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

/// PKCE S256 challenge: base64url(sha256(verifier)) without padding.
fn pkce_s256_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

// ---------------------------------------------------------------------------
// Shared data structures
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
    pub token_type: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CalendarEvent {
    pub id: Option<String>,
    pub summary: String,
    pub description: Option<String>,
    pub location: Option<String>,
    pub start_datetime: String,  // ISO 8601
    pub end_datetime: String,    // ISO 8601
    pub status: Option<String>,  // confirmed, cancelled
    pub updated: Option<String>, // ISO 8601 timestamp
    pub nutripolo_id: Option<String>, // stored in extendedProperties.private
    pub timezone: Option<String>, // IANA timezone (e.g. "Europe/Madrid")
}

#[derive(Serialize, Deserialize, Debug)]
pub struct CalendarListEntry {
    pub id: String,
    pub summary: String,
    pub primary: Option<bool>,
    pub background_color: Option<String>,
    pub foreground_color: Option<String>,
    pub access_role: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct AuthResult {
    pub code: String,
    pub redirect_uri: String,
    /// PKCE code_verifier generated for this auth flow. The caller must
    /// pass it back to `gcal_exchange_token` so Google can verify the
    /// S256 challenge sent in the authorization URL.
    pub code_verifier: String,
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/// Find an available TCP port by binding to port 0, reading back the assigned
/// port, and then immediately dropping the listener so the port is free.
fn find_free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    Ok(listener.local_addr().map_err(|e| e.to_string())?.port())
}

/// Extract the value of a named query parameter from the first line of an
/// HTTP request (e.g. `"GET /?code=ABC&state=XYZ HTTP/1.1"`).
fn extract_query_param(request_line: &str, param: &str) -> Option<String> {
    let path_start = request_line.find(' ')? + 1;
    let path_end = request_line[path_start..].find(' ')? + path_start;
    let path = &request_line[path_start..path_end];
    let query = path.split('?').nth(1)?;
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        if let (Some(k), Some(v)) = (parts.next(), parts.next()) {
            if k == param {
                let decoded = v.replace('+', " ");
                return Some(urlencoding::decode(&decoded).map(|c| c.into_owned()).unwrap_or(decoded));
            }
        }
    }
    None
}

/// Map a Google Calendar event JSON value to our `CalendarEvent` struct.
fn map_google_event(event: &serde_json::Value) -> CalendarEvent {
    let id = event["id"].as_str().map(|s| s.to_string());
    let summary = event["summary"].as_str().unwrap_or("").to_string();
    let description = event["description"].as_str().map(|s| s.to_string());
    let location = event["location"].as_str().map(|s| s.to_string());
    let status = event["status"].as_str().map(|s| s.to_string());
    let updated = event["updated"].as_str().map(|s| s.to_string());

    // Google returns either dateTime (timed events) or date (all-day events).
    let start_datetime = event["start"]["dateTime"]
        .as_str()
        .or_else(|| event["start"]["date"].as_str())
        .unwrap_or("")
        .to_string();

    let end_datetime = event["end"]["dateTime"]
        .as_str()
        .or_else(|| event["end"]["date"].as_str())
        .unwrap_or("")
        .to_string();

    let nutripolo_id = event["extendedProperties"]["private"]["nutripoloId"]
        .as_str()
        .map(|s| s.to_string());

    let timezone = event["start"]["timeZone"]
        .as_str()
        .map(|s| s.to_string());

    CalendarEvent {
        id,
        summary,
        description,
        location,
        start_datetime,
        end_datetime,
        status,
        updated,
        nutripolo_id,
        timezone,
    }
}

/// Build the JSON body sent to Google when creating or updating an event.
/// timeZone is included alongside dateTime so Google handles DST transitions correctly.
fn build_event_body(event: &CalendarEvent) -> serde_json::Value {
    let tz = event.timezone.as_deref().unwrap_or("Europe/Madrid");
    let mut body = serde_json::json!({
        "summary": event.summary,
        "start": { "dateTime": event.start_datetime, "timeZone": tz },
        "end":   { "dateTime": event.end_datetime,   "timeZone": tz },
    });

    if let Some(ref desc) = event.description {
        body["description"] = serde_json::Value::String(desc.clone());
    }
    if let Some(ref loc) = event.location {
        body["location"] = serde_json::Value::String(loc.clone());
    }
    if let Some(ref nid) = event.nutripolo_id {
        body["extendedProperties"] = serde_json::json!({
            "private": { "nutripoloId": nid }
        });
    }

    body
}

/// Simple percent-encoder for URL components.
fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            _ => {
                out.push('%');
                out.push_str(&format!("{:02X}", byte));
            }
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Start the OAuth2 authorization flow with CSRF protection (state) and PKCE.
///
/// 1. Find a free local port and build the redirect URI.
/// 2. Generate a random `state` (CSRF token) and a PKCE `code_verifier`;
///    derive the S256 challenge from the verifier.
/// 3. Build the Google OAuth consent URL with `state` + `code_challenge`.
/// 4. Open it in the default browser.
/// 5. Spin up a temporary TCP server on that port and wait (up to 120 s)
///    for Google to redirect back with the authorization code.
/// 6. Verify that the returned `state` matches what we sent — reject otherwise.
/// 7. Return the code and verifier; the caller must pass the verifier to
///    `gcal_exchange_token` so Google can verify the PKCE challenge.
#[tauri::command]
pub async fn gcal_start_auth(
    client_id: String,
    _client_secret: String,
    app_handle: AppHandle,
) -> Result<AuthResult, String> {
    let port = find_free_port()?;
    let redirect_uri = format!("http://localhost:{}", port);

    let state = random_url_safe(32);
    let code_verifier = random_url_safe(64);
    let code_challenge = pkce_s256_challenge(&code_verifier);

    let scope = "https://www.googleapis.com/auth/calendar";
    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth\
         ?client_id={client_id}\
         &redirect_uri={redirect_uri}\
         &response_type=code\
         &scope={scope}\
         &access_type=offline\
         &prompt=consent\
         &state={state}\
         &code_challenge={code_challenge}\
         &code_challenge_method=S256",
        client_id = url_encode(&client_id),
        redirect_uri = url_encode(&redirect_uri),
        scope = url_encode(scope),
        state = url_encode(&state),
        code_challenge = url_encode(&code_challenge),
    );

    tauri::api::shell::open(&app_handle.shell_scope(), &auth_url, None)
        .map_err(|e| format!("Failed to open browser: {}", e))?;

    // Move the expected state into the callback thread. The received
    // value must match exactly or the response is treated as hostile.
    let expected_state = state.clone();
    let (tx, rx) = mpsc::channel::<Result<String, String>>();

    thread::spawn(move || {
        let listener = match TcpListener::bind(format!("127.0.0.1:{}", port)) {
            Ok(l) => l,
            Err(e) => {
                let _ = tx.send(Err(format!("Failed to bind callback port {}: {}", port, e)));
                return;
            }
        };

        match listener.accept() {
            Err(e) => {
                let _ = tx.send(Err(format!("Error waiting for OAuth callback: {}", e)));
            }
            Ok((mut stream, _)) => {
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]);
                let first_line = request.lines().next().unwrap_or("");

                if let Some(error) = extract_query_param(first_line, "error") {
                    let html = "HTTP/1.1 400 Bad Request\r\nContent-Type: text/html\r\n\r\n\
                                <html><body><h1>Authorization failed</h1>\
                                <p>You can close this tab.</p></body></html>";
                    let _ = stream.write_all(html.as_bytes());
                    let _ = tx.send(Err(format!("OAuth error: {}", error)));
                    return;
                }

                // CSRF protection: reject the callback unless `state` matches
                // exactly. A malicious tab on localhost cannot forge this.
                let received_state = extract_query_param(first_line, "state").unwrap_or_default();
                if received_state != expected_state {
                    let html = "HTTP/1.1 400 Bad Request\r\nContent-Type: text/html\r\n\r\n\
                                <html><body><h1>Authorization failed</h1>\
                                <p>State mismatch. You can close this tab.</p></body></html>";
                    let _ = stream.write_all(html.as_bytes());
                    let _ = tx.send(Err("oauth_state_mismatch".to_string()));
                    return;
                }

                match extract_query_param(first_line, "code") {
                    None => {
                        let _ = tx.send(Err(
                            "No authorization code found in callback URL".to_string(),
                        ));
                    }
                    Some(code) => {
                        let html = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n\
                                    <html><body>\
                                    <h1>Authorization successful!</h1>\
                                    <p>You can close this tab and return to NutriPolo.</p>\
                                    </body></html>";
                        let _ = stream.write_all(html.as_bytes());
                        let _ = tx.send(Ok(code));
                    }
                }
            }
        }
    });

    // Wait up to 120 seconds for the callback thread to deliver the code.
    let code = rx.recv_timeout(Duration::from_secs(120))
        .map_err(|_| "Timed out waiting for Google authorization (120 s)".to_string())
        .and_then(|r| r)?;

    Ok(AuthResult { code, redirect_uri, code_verifier })
}

/// Exchange an authorization code for access + refresh tokens.
/// Requires the PKCE `code_verifier` produced by `gcal_start_auth`.
#[tauri::command]
pub async fn gcal_exchange_token(
    client_id: String,
    client_secret: String,
    code: String,
    redirect_uri: String,
    code_verifier: String,
) -> Result<TokenResponse, String> {
    let client = reqwest::Client::new();
    let params = [
        ("client_id", client_id.as_str()),
        ("client_secret", client_secret.as_str()),
        ("code", code.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("grant_type", "authorization_code"),
        ("code_verifier", code_verifier.as_str()),
    ];

    let resp = client
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await
        .map_err(|_| "oauth_network_error".to_string())?;

    let status = resp.status();
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|_| "oauth_parse_error".to_string())?;

    if !status.is_success() {
        #[cfg(debug_assertions)]
        eprintln!("[gcal_exchange_token] status={} body={:?}", status, body);
        return Err("oauth_token_exchange_failed".to_string());
    }

    Ok(TokenResponse {
        access_token: body["access_token"]
            .as_str()
            .ok_or("Missing access_token in response")?
            .to_string(),
        refresh_token: body["refresh_token"].as_str().map(|s| s.to_string()),
        expires_in: body["expires_in"].as_u64().unwrap_or(3600),
        token_type: body["token_type"]
            .as_str()
            .unwrap_or("Bearer")
            .to_string(),
    })
}

/// Use a stored refresh token to obtain a new access token.
#[tauri::command]
pub async fn gcal_refresh_token(
    client_id: String,
    client_secret: String,
    refresh_token: String,
) -> Result<TokenResponse, String> {
    let client = reqwest::Client::new();
    let params = [
        ("client_id", client_id.as_str()),
        ("client_secret", client_secret.as_str()),
        ("refresh_token", refresh_token.as_str()),
        ("grant_type", "refresh_token"),
    ];

    let resp = client
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await
        .map_err(|_| "oauth_network_error".to_string())?;

    let status = resp.status();
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|_| "oauth_parse_error".to_string())?;

    if !status.is_success() {
        #[cfg(debug_assertions)]
        eprintln!("[gcal_refresh_token] status={} body={:?}", status, body);
        return Err("oauth_token_refresh_failed".to_string());
    }

    Ok(TokenResponse {
        access_token: body["access_token"]
            .as_str()
            .ok_or("Missing access_token in response")?
            .to_string(),
        // Google does not re-issue the refresh token; preserve whatever came back.
        refresh_token: body["refresh_token"].as_str().map(|s| s.to_string()),
        expires_in: body["expires_in"].as_u64().unwrap_or(3600),
        token_type: body["token_type"]
            .as_str()
            .unwrap_or("Bearer")
            .to_string(),
    })
}

/// List all calendars visible to the authenticated user.
#[tauri::command]
pub async fn gcal_list_calendars(
    access_token: String,
) -> Result<Vec<CalendarListEntry>, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://www.googleapis.com/calendar/v3/users/me/calendarList")
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| format!("Network error listing calendars: {}", e))?;

    let status = resp.status();
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Error parsing calendar list: {}", e))?;

    if !status.is_success() {
        let err_msg = body["error"]["message"].as_str().unwrap_or("Unknown error");
        return Err(format!("List calendars failed ({}): {}", status, err_msg));
    }

    let items = body["items"].as_array().ok_or("Missing items array")?;
    let calendars = items
        .iter()
        .filter_map(|c| {
            let id = c["id"].as_str()?.to_string();
            let summary = c["summary"].as_str().unwrap_or("").to_string();
            let primary = c["primary"].as_bool();
            let background_color = c["backgroundColor"].as_str().map(|s| s.to_string());
            let foreground_color = c["foregroundColor"].as_str().map(|s| s.to_string());
            let access_role = c["accessRole"].as_str().map(|s| s.to_string());
            Some(CalendarListEntry { id, summary, primary, background_color, foreground_color, access_role })
        })
        .collect();

    Ok(calendars)
}

/// List events in a calendar within a time range.
/// Handles pagination automatically (Google returns max 250 events per page).
#[tauri::command]
pub async fn gcal_list_events(
    access_token: String,
    calendar_id: String,
    time_min: String,
    time_max: String,
) -> Result<Vec<CalendarEvent>, String> {
    let url = format!(
        "https://www.googleapis.com/calendar/v3/calendars/{}/events",
        url_encode(&calendar_id)
    );

    let client = reqwest::Client::new();
    let mut all_events: Vec<CalendarEvent> = Vec::new();
    let mut page_token: Option<String> = None;

    loop {
        let mut query: Vec<(&str, String)> = vec![
            ("timeMin",      time_min.clone()),
            ("timeMax",      time_max.clone()),
            ("singleEvents", "true".to_string()),
            ("orderBy",      "startTime".to_string()),
            ("maxResults",   "250".to_string()),
        ];
        if let Some(ref pt) = page_token {
            query.push(("pageToken", pt.clone()));
        }

        let resp = client
            .get(&url)
            .bearer_auth(&access_token)
            .query(&query)
            .send()
            .await
            .map_err(|e| format!("Network error listing events: {}", e))?;

        let status = resp.status();
        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Error parsing events list: {}", e))?;

        if !status.is_success() {
            let err_msg = body["error"]["message"].as_str().unwrap_or("Unknown error");
            return Err(format!("List events failed ({}): {}", status, err_msg));
        }

        if let Some(items) = body["items"].as_array() {
            all_events.extend(items.iter().map(map_google_event));
        }

        // Follow pagination if there are more pages
        match body["nextPageToken"].as_str() {
            Some(pt) => page_token = Some(pt.to_string()),
            None => break,
        }
    }

    Ok(all_events)
}

/// List deleted/cancelled event IDs within a time range.
/// Uses showDeleted=true with orderBy=updated (required by Google API).
/// Returns only event IDs whose status is "cancelled".
#[tauri::command]
pub async fn gcal_list_deleted_events(
    access_token: String,
    calendar_id: String,
    time_min: String,
    time_max: String,
) -> Result<Vec<String>, String> {
    let url = format!(
        "https://www.googleapis.com/calendar/v3/calendars/{}/events",
        url_encode(&calendar_id)
    );

    let client = reqwest::Client::new();
    let mut deleted_ids: Vec<String> = Vec::new();
    let mut page_token: Option<String> = None;

    loop {
        let mut query: Vec<(&str, String)> = vec![
            ("timeMin",      time_min.clone()),
            ("timeMax",      time_max.clone()),
            ("showDeleted",  "true".to_string()),
            ("orderBy",      "updated".to_string()),
            ("maxResults",   "250".to_string()),
        ];
        if let Some(ref pt) = page_token {
            query.push(("pageToken", pt.clone()));
        }

        let resp = client
            .get(&url)
            .bearer_auth(&access_token)
            .query(&query)
            .send()
            .await
            .map_err(|e| format!("Network error listing deleted events: {}", e))?;

        let status = resp.status();
        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Error parsing deleted events list: {}", e))?;

        if !status.is_success() {
            let err_msg = body["error"]["message"].as_str().unwrap_or("Unknown error");
            return Err(format!("List deleted events failed ({}): {}", status, err_msg));
        }

        if let Some(items) = body["items"].as_array() {
            for item in items {
                if item["status"].as_str() == Some("cancelled") {
                    if let Some(id) = item["id"].as_str() {
                        deleted_ids.push(id.to_string());
                    }
                }
            }
        }

        match body["nextPageToken"].as_str() {
            Some(pt) => page_token = Some(pt.to_string()),
            None => break,
        }
    }

    Ok(deleted_ids)
}

/// Create a new event in the specified calendar.
#[tauri::command]
pub async fn gcal_create_event(
    access_token: String,
    calendar_id: String,
    event: CalendarEvent,
) -> Result<CalendarEvent, String> {
    let url = format!(
        "https://www.googleapis.com/calendar/v3/calendars/{}/events",
        url_encode(&calendar_id)
    );

    let body = build_event_body(&event);
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .bearer_auth(&access_token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network error creating event: {}", e))?;

    let status = resp.status();
    let response_body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Error parsing create event response: {}", e))?;

    if !status.is_success() {
        let err_msg = response_body["error"]["message"]
            .as_str()
            .unwrap_or("Unknown error");
        return Err(format!("Create event failed ({}): {}", status, err_msg));
    }

    Ok(map_google_event(&response_body))
}

/// Update an existing event (full replace via PUT).
#[tauri::command]
pub async fn gcal_update_event(
    access_token: String,
    calendar_id: String,
    event_id: String,
    event: CalendarEvent,
) -> Result<CalendarEvent, String> {
    let url = format!(
        "https://www.googleapis.com/calendar/v3/calendars/{}/events/{}",
        url_encode(&calendar_id),
        url_encode(&event_id)
    );

    let body = build_event_body(&event);
    let client = reqwest::Client::new();
    let resp = client
        .put(&url)
        .bearer_auth(&access_token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network error updating event: {}", e))?;

    let status = resp.status();
    let response_body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Error parsing update event response: {}", e))?;

    if !status.is_success() {
        let err_msg = response_body["error"]["message"]
            .as_str()
            .unwrap_or("Unknown error");
        return Err(format!("Update event failed ({}): {}", status, err_msg));
    }

    Ok(map_google_event(&response_body))
}

/// Revoke an OAuth token (access or refresh) so it can no longer be used.
/// Best-effort: returns Ok even if revocation fails (token may already be expired).
#[tauri::command]
pub async fn gcal_revoke_token(token: String) -> Result<(), String> {
    let client = reqwest::Client::new();
    let _ = client
        .post("https://oauth2.googleapis.com/revoke")
        .form(&[("token", &token)])
        .send()
        .await;
    Ok(())
}

/// Delete an event from the specified calendar.
#[tauri::command]
pub async fn gcal_delete_event(
    access_token: String,
    calendar_id: String,
    event_id: String,
) -> Result<(), String> {
    let url = format!(
        "https://www.googleapis.com/calendar/v3/calendars/{}/events/{}",
        url_encode(&calendar_id),
        url_encode(&event_id)
    );

    let client = reqwest::Client::new();
    let resp = client
        .delete(&url)
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| format!("Network error deleting event: {}", e))?;

    let status = resp.status();

    // 204 No Content is the expected success response for a DELETE.
    if status.is_success() || status == reqwest::StatusCode::NO_CONTENT {
        return Ok(());
    }

    let response_body: serde_json::Value = resp
        .json()
        .await
        .unwrap_or_else(|_| serde_json::json!({}));
    let err_msg = response_body["error"]["message"]
        .as_str()
        .unwrap_or("Unknown error");
    Err(format!("Delete event failed ({}): {}", status, err_msg))
}
