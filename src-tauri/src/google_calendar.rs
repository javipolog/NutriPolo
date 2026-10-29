use serde::{Deserialize, Serialize};
use tauri::Manager;
use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use rand::Rng;
use sha2::{Digest, Sha256};
use base64::Engine as _;

/// Least-privilege scopes: create / edit / delete events on any calendar the
/// user can write to, and read the calendar list. No access to calendar
/// settings, sharing (ACLs) or deleting whole calendars.
const OAUTH_SCOPES: &str = "https://www.googleapis.com/auth/calendar.events \
                            https://www.googleapis.com/auth/calendar.calendarlist.readonly";

/// How long the loopback server waits for Google to redirect back.
const AUTH_TIMEOUT: Duration = Duration::from_secs(180);

/// Safety cap on pagination, so a misbehaving response can never loop forever.
const MAX_PAGES: usize = 40;

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
    /// Space-separated scopes actually granted (the user can untick some
    /// on Google's granular consent screen).
    pub scope: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CalendarEvent {
    /// On create: the event id to use (makes creation idempotent).
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
// OAuth loopback callback
// ---------------------------------------------------------------------------

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

#[derive(Debug, PartialEq)]
enum CallbackOutcome {
    /// Not the OAuth redirect (favicon, preconnect, a stray or forged
    /// request): answer and keep waiting for the real one.
    Ignore,
    Code(String),
    Error(String),
}

/// Decide what a request reaching the loopback server means. Only a request
/// carrying our exact `state` can finish the flow, so another local process
/// can neither inject a code nor abort the sign-in.
fn classify_callback(request_line: &str, expected_state: &str) -> CallbackOutcome {
    if !request_line.starts_with("GET ") {
        return CallbackOutcome::Ignore;
    }
    match extract_query_param(request_line, "state") {
        Some(state) if state == expected_state => {}
        _ => return CallbackOutcome::Ignore,
    }
    if let Some(error) = extract_query_param(request_line, "error") {
        return CallbackOutcome::Error(format!("oauth_denied: {}", error));
    }
    match extract_query_param(request_line, "code") {
        Some(code) if !code.is_empty() => CallbackOutcome::Code(code),
        _ => CallbackOutcome::Error("oauth_missing_code".to_string()),
    }
}

/// Read the request line (up to 8 KB) from the socket.
fn read_request_line(stream: &mut TcpStream) -> String {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    while buf.len() < 8192 {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf.windows(2).any(|w| w == b"\r\n") {
                    break;
                }
            }
        }
    }
    String::from_utf8_lossy(&buf).lines().next().unwrap_or("").to_string()
}

fn respond(stream: &mut TcpStream, status: &str, title: &str, message: &str) {
    let body = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>NutriPolo</title></head>\
         <body style=\"font-family:sans-serif;text-align:center;padding:48px\">\
         <h1>{}</h1><p>{}</p></body></html>",
        title, message
    );
    let response = format!(
        "HTTP/1.1 {}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\
         Cache-Control: no-store\r\nConnection: close\r\n\r\n{}",
        status,
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

/// Serve the loopback redirect until the real callback arrives or the
/// deadline passes. The listener is dropped on return, freeing the port.
fn wait_for_callback(listener: TcpListener, expected_state: &str, timeout: Duration) -> Result<String, String> {
    let deadline = Instant::now() + timeout;
    loop {
        if Instant::now() >= deadline {
            return Err("oauth_timeout".to_string());
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_nonblocking(false);
                let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
                let request_line = read_request_line(&mut stream);
                match classify_callback(&request_line, expected_state) {
                    CallbackOutcome::Ignore => {
                        respond(&mut stream, "404 Not Found", "NutriPolo", "");
                    }
                    CallbackOutcome::Code(code) => {
                        respond(
                            &mut stream,
                            "200 OK",
                            "Authorization successful",
                            "You can close this tab and return to NutriPolo.",
                        );
                        return Ok(code);
                    }
                    CallbackOutcome::Error(e) => {
                        respond(
                            &mut stream,
                            "400 Bad Request",
                            "Authorization failed",
                            "You can close this tab and return to NutriPolo.",
                        );
                        return Err(e);
                    }
                }
            }
            Err(ref e) if e.kind() == ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(format!("Error waiting for OAuth callback: {}", e)),
        }
    }
}

// ---------------------------------------------------------------------------
// Google API helpers
// ---------------------------------------------------------------------------

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

/// Build the JSON body sent to Google when creating or patching an event.
/// timeZone is included alongside dateTime so Google handles DST transitions
/// correctly; `date: null` clears an all-day date when patching. The
/// description is always sent so clearing the notes locally clears it too.
fn build_event_body(event: &CalendarEvent) -> serde_json::Value {
    let tz = event.timezone.as_deref().unwrap_or("Europe/Madrid");
    let mut body = serde_json::json!({
        "summary": event.summary,
        "description": event.description.clone().unwrap_or_default(),
        "start": { "dateTime": event.start_datetime, "timeZone": tz, "date": null },
        "end":   { "dateTime": event.end_datetime,   "timeZone": tz, "date": null },
    });

    if let Some(ref loc) = event.location {
        body["location"] = serde_json::Value::String(loc.clone());
    }
    // "cancelled" cancels the event in Google; "confirmed" restores it.
    if let Some(ref status) = event.status {
        body["status"] = serde_json::Value::String(status.clone());
    }
    if let Some(ref nid) = event.nutripolo_id {
        body["extendedProperties"] = serde_json::json!({
            "private": { "nutripoloId": nid }
        });
    }

    body
}

/// Uniform API error: `"<op> failed (<status>) [<reason>]: <message>"`.
/// The JS side parses the status and reason to decide whether to retry.
/// Non-JSON bodies (e.g. an HTML 502 page) keep the status.
fn format_api_error(op: &str, status: u16, body: &str) -> String {
    let json: serde_json::Value = serde_json::from_str(body).unwrap_or(serde_json::Value::Null);
    let reason = json["error"]["errors"][0]["reason"]
        .as_str()
        .or_else(|| json["error"]["status"].as_str())
        .unwrap_or("unknown");
    let message = json["error"]["message"].as_str().unwrap_or("HTTP error");
    format!("{} failed ({}) [{}]: {}", op, status, reason, message)
}

/// Shared HTTP client: connection reuse plus timeouts, so a stalled request
/// can never hang a sync forever.
fn http_client() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(20))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

/// Send a Google API request and return the parsed JSON body (Null when
/// empty). Network failures carry no status, so the caller retries them.
async fn send_json(op: &str, request: reqwest::RequestBuilder) -> Result<serde_json::Value, String> {
    let resp = request
        .send()
        .await
        .map_err(|e| format!("{} failed: network error: {}", op, e.without_url()))?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|_| format!("{} failed: network error reading the response", op))?;
    if !status.is_success() {
        return Err(format_api_error(op, status.as_u16(), &text));
    }
    if text.trim().is_empty() {
        return Ok(serde_json::Value::Null);
    }
    serde_json::from_str(&text).map_err(|_| format!("{} failed: invalid response", op))
}

/// POST to Google's token endpoint. OAuth errors are mapped to stable codes
/// (`oauth_*`) the UI can translate.
async fn token_request(params: &[(&str, &str)], failure_code: &str) -> Result<TokenResponse, String> {
    let resp = http_client()
        .post("https://oauth2.googleapis.com/token")
        .form(params)
        .send()
        .await
        .map_err(|_| "oauth_network_error".to_string())?;

    let status = resp.status();
    let text = resp.text().await.map_err(|_| "oauth_network_error".to_string())?;
    let body: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);

    if !status.is_success() {
        #[cfg(debug_assertions)]
        eprintln!("[gcal token] status={} error={:?}", status, body["error"]);
        // The refresh token was revoked or expired: the user must reconnect.
        if body["error"].as_str() == Some("invalid_grant") {
            return Err("oauth_invalid_grant".to_string());
        }
        if status.is_server_error() {
            return Err("oauth_network_error".to_string());
        }
        return Err(failure_code.to_string());
    }

    Ok(TokenResponse {
        access_token: body["access_token"]
            .as_str()
            .ok_or("oauth_parse_error")?
            .to_string(),
        // Google does not re-issue the refresh token on refresh; the caller
        // keeps the previous one when this is None.
        refresh_token: body["refresh_token"].as_str().map(|s| s.to_string()),
        expires_in: body["expires_in"].as_u64().unwrap_or(3600),
        token_type: body["token_type"].as_str().unwrap_or("Bearer").to_string(),
        scope: body["scope"].as_str().map(|s| s.to_string()),
    })
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

fn events_url(calendar_id: &str) -> String {
    format!(
        "https://www.googleapis.com/calendar/v3/calendars/{}/events",
        url_encode(calendar_id)
    )
}

fn event_url(calendar_id: &str, event_id: &str) -> String {
    format!("{}/{}", events_url(calendar_id), url_encode(event_id))
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Start the OAuth2 authorization flow (loopback redirect, RFC 8252) with
/// CSRF protection (`state`) and PKCE.
///
/// 1. Bind the loopback listener on 127.0.0.1 first, so the redirect can
///    never arrive before we are listening.
/// 2. Generate a random `state` and a PKCE `code_verifier`.
/// 3. Open the consent URL in the default browser.
/// 4. Serve the redirect on a blocking thread until a request carrying our
///    `state` arrives, or the timeout passes; other requests are ignored.
/// 5. Return the code and verifier for `gcal_exchange_token`.
#[tauri::command]
pub async fn gcal_start_auth(
    client_id: String,
    _client_secret: String,
    app_handle: AppHandle,
) -> Result<AuthResult, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to open the OAuth callback port: {}", e))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let redirect_uri = format!("http://127.0.0.1:{}", port);

    let state = random_url_safe(32);
    let code_verifier = random_url_safe(64);
    let code_challenge = pkce_s256_challenge(&code_verifier);

    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth\
         ?client_id={client_id}\
         &redirect_uri={redirect_uri}\
         &response_type=code\
         &scope={scope}\
         &access_type=offline\
         &prompt=consent\
         &include_granted_scopes=false\
         &state={state}\
         &code_challenge={code_challenge}\
         &code_challenge_method=S256",
        client_id = url_encode(&client_id),
        redirect_uri = url_encode(&redirect_uri),
        scope = url_encode(OAUTH_SCOPES),
        state = url_encode(&state),
        code_challenge = url_encode(&code_challenge),
    );

    tauri::api::shell::open(&app_handle.shell_scope(), &auth_url, None)
        .map_err(|e| format!("Failed to open browser: {}", e))?;

    let code = tauri::async_runtime::spawn_blocking(move || {
        wait_for_callback(listener, &state, AUTH_TIMEOUT)
    })
    .await
    .map_err(|e| format!("OAuth callback task failed: {}", e))??;

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
    token_request(
        &[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("code", code.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("grant_type", "authorization_code"),
            ("code_verifier", code_verifier.as_str()),
        ],
        "oauth_token_exchange_failed",
    )
    .await
}

/// Use a stored refresh token to obtain a new access token.
#[tauri::command]
pub async fn gcal_refresh_token(
    client_id: String,
    client_secret: String,
    refresh_token: String,
) -> Result<TokenResponse, String> {
    token_request(
        &[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("refresh_token", refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ],
        "oauth_token_refresh_failed",
    )
    .await
}

/// List all calendars visible to the authenticated user (all pages).
#[tauri::command]
pub async fn gcal_list_calendars(
    access_token: String,
) -> Result<Vec<CalendarListEntry>, String> {
    let client = http_client();
    let mut calendars = Vec::new();
    let mut page_token: Option<String> = None;

    for _ in 0..MAX_PAGES {
        let mut query: Vec<(&str, String)> = vec![("maxResults", "250".to_string())];
        if let Some(ref pt) = page_token {
            query.push(("pageToken", pt.clone()));
        }
        let body = send_json(
            "List calendars",
            client
                .get("https://www.googleapis.com/calendar/v3/users/me/calendarList")
                .bearer_auth(&access_token)
                .query(&query),
        )
        .await?;

        if let Some(items) = body["items"].as_array() {
            calendars.extend(items.iter().filter_map(|c| {
                Some(CalendarListEntry {
                    id: c["id"].as_str()?.to_string(),
                    summary: c["summaryOverride"]
                        .as_str()
                        .or_else(|| c["summary"].as_str())
                        .unwrap_or("")
                        .to_string(),
                    primary: c["primary"].as_bool(),
                    background_color: c["backgroundColor"].as_str().map(|s| s.to_string()),
                    foreground_color: c["foregroundColor"].as_str().map(|s| s.to_string()),
                    access_role: c["accessRole"].as_str().map(|s| s.to_string()),
                })
            }));
        }

        match body["nextPageToken"].as_str() {
            Some(pt) => page_token = Some(pt.to_string()),
            None => break,
        }
    }

    Ok(calendars)
}

/// List events in a calendar within a time range, recurring events expanded
/// into instances. Includes deleted events and cancelled instances
/// (`status == "cancelled"`), so a single call tells the caller about both
/// live and removed events. Handles pagination.
#[tauri::command]
pub async fn gcal_list_events(
    access_token: String,
    calendar_id: String,
    time_min: String,
    time_max: String,
    time_zone: Option<String>,
) -> Result<Vec<CalendarEvent>, String> {
    let url = events_url(&calendar_id);
    let client = http_client();
    let mut all_events: Vec<CalendarEvent> = Vec::new();
    let mut page_token: Option<String> = None;

    for _ in 0..MAX_PAGES {
        let mut query: Vec<(&str, String)> = vec![
            ("timeMin",      time_min.clone()),
            ("timeMax",      time_max.clone()),
            ("singleEvents", "true".to_string()),
            ("showDeleted",  "true".to_string()),
            ("maxResults",   "2500".to_string()),
        ];
        if let Some(ref tz) = time_zone {
            query.push(("timeZone", tz.clone()));
        }
        if let Some(ref pt) = page_token {
            query.push(("pageToken", pt.clone()));
        }

        let body = send_json(
            "List events",
            client.get(&url).bearer_auth(&access_token).query(&query),
        )
        .await?;

        if let Some(items) = body["items"].as_array() {
            all_events.extend(items.iter().map(map_google_event));
        }

        match body["nextPageToken"].as_str() {
            Some(pt) => page_token = Some(pt.to_string()),
            None => break,
        }
    }

    Ok(all_events)
}

/// Fetch a single event. Used to reconcile linked events that dropped out
/// of the sync window (moved far away, or deleted long ago).
#[tauri::command]
pub async fn gcal_get_event(
    access_token: String,
    calendar_id: String,
    event_id: String,
) -> Result<CalendarEvent, String> {
    let body = send_json(
        "Get event",
        http_client()
            .get(event_url(&calendar_id, &event_id))
            .bearer_auth(&access_token),
    )
    .await?;
    Ok(map_google_event(&body))
}

/// Create an event. When `event.id` is set it becomes the Google event id,
/// which makes creation idempotent: if that id already exists (a retry after
/// a lost response, or an event deleted earlier) the event is patched instead.
#[tauri::command]
pub async fn gcal_create_event(
    access_token: String,
    calendar_id: String,
    event: CalendarEvent,
) -> Result<CalendarEvent, String> {
    let client = http_client();
    let mut body = build_event_body(&event);
    if let Some(ref id) = event.id {
        body["id"] = serde_json::Value::String(id.clone());
    }

    let created = send_json(
        "Create event",
        client.post(events_url(&calendar_id)).bearer_auth(&access_token).json(&body),
    )
    .await;

    match (created, event.id.as_ref()) {
        (Err(e), Some(id)) if e.starts_with("Create event failed (409)") => {
            let patched = send_json(
                "Update event",
                client
                    .patch(event_url(&calendar_id, id))
                    .bearer_auth(&access_token)
                    .json(&build_event_body(&event)),
            )
            .await?;
            Ok(map_google_event(&patched))
        }
        (result, _) => result.map(|v| map_google_event(&v)),
    }
}

/// Update an existing event with PATCH, so fields NutriPolo does not manage
/// (guests, reminders, colour, Meet link, attachments) are preserved.
#[tauri::command]
pub async fn gcal_update_event(
    access_token: String,
    calendar_id: String,
    event_id: String,
    event: CalendarEvent,
) -> Result<CalendarEvent, String> {
    let body = send_json(
        "Update event",
        http_client()
            .patch(event_url(&calendar_id, &event_id))
            .bearer_auth(&access_token)
            .json(&build_event_body(&event)),
    )
    .await?;
    Ok(map_google_event(&body))
}

/// Revoke an OAuth token (access or refresh) so it can no longer be used.
/// Best-effort: returns Ok even if revocation fails (token may already be expired).
#[tauri::command]
pub async fn gcal_revoke_token(token: String) -> Result<(), String> {
    let client = http_client();
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
    let resp = http_client()
        .delete(event_url(&calendar_id, &event_id))
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| format!("Delete event failed: network error: {}", e.without_url()))?;

    let status = resp.status();

    // 204 No Content is the expected success response for a DELETE. An event
    // that is already gone (404 / 410 Gone) is the desired end state too.
    if status.is_success()
        || status == reqwest::StatusCode::NOT_FOUND
        || status == reqwest::StatusCode::GONE
    {
        return Ok(());
    }

    let text = resp.text().await.unwrap_or_default();
    Err(format_api_error("Delete event", status.as_u16(), &text))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_and_decodes_query_params() {
        let line = "GET /?state=abc&code=4%2F0Ab+x HTTP/1.1";
        assert_eq!(extract_query_param(line, "state").as_deref(), Some("abc"));
        assert_eq!(extract_query_param(line, "code").as_deref(), Some("4/0Ab x"));
        assert_eq!(extract_query_param(line, "error"), None);
        assert_eq!(extract_query_param("GET /favicon.ico HTTP/1.1", "code"), None);
    }

    #[test]
    fn callback_requires_matching_state() {
        assert_eq!(
            classify_callback("GET /?state=s1&code=c1 HTTP/1.1", "s1"),
            CallbackOutcome::Code("c1".to_string())
        );
        // Forged or stray requests are ignored, never fatal.
        assert_eq!(classify_callback("GET /?state=bad&code=c1 HTTP/1.1", "s1"), CallbackOutcome::Ignore);
        assert_eq!(classify_callback("GET /?error=access_denied HTTP/1.1", "s1"), CallbackOutcome::Ignore);
        assert_eq!(classify_callback("GET /favicon.ico HTTP/1.1", "s1"), CallbackOutcome::Ignore);
        assert_eq!(classify_callback("POST /?state=s1&code=c1 HTTP/1.1", "s1"), CallbackOutcome::Ignore);
        assert_eq!(classify_callback("", "s1"), CallbackOutcome::Ignore);
    }

    #[test]
    fn callback_reports_denial_and_missing_code() {
        assert_eq!(
            classify_callback("GET /?state=s1&error=access_denied HTTP/1.1", "s1"),
            CallbackOutcome::Error("oauth_denied: access_denied".to_string())
        );
        assert_eq!(
            classify_callback("GET /?state=s1 HTTP/1.1", "s1"),
            CallbackOutcome::Error("oauth_missing_code".to_string())
        );
    }

    fn sample_event() -> CalendarEvent {
        CalendarEvent {
            id: Some("np0123".to_string()),
            summary: "Consulta - Ana".to_string(),
            description: None,
            location: None,
            start_datetime: "2026-04-01T09:00:00+02:00".to_string(),
            end_datetime: "2026-04-01T09:45:00+02:00".to_string(),
            status: Some("confirmed".to_string()),
            updated: None,
            nutripolo_id: Some("abc".to_string()),
            timezone: Some("Europe/Madrid".to_string()),
        }
    }

    #[test]
    fn event_body_clears_description_and_all_day_date() {
        let body = build_event_body(&sample_event());
        assert_eq!(body["description"], "");
        assert!(body["start"]["date"].is_null());
        assert_eq!(body["start"]["timeZone"], "Europe/Madrid");
        assert_eq!(body["status"], "confirmed");
        assert_eq!(body["extendedProperties"]["private"]["nutripoloId"], "abc");
        // The id is only added on create, not part of the patch body.
        assert!(body.get("id").is_none());
    }

    #[test]
    fn api_errors_keep_status_and_reason() {
        let body = r#"{"error":{"code":403,"message":"Rate Limit Exceeded","errors":[{"reason":"rateLimitExceeded"}]}}"#;
        assert_eq!(
            format_api_error("List events", 403, body),
            "List events failed (403) [rateLimitExceeded]: Rate Limit Exceeded"
        );
        assert_eq!(
            format_api_error("Update event", 502, "<html>Bad Gateway</html>"),
            "Update event failed (502) [unknown]: HTTP error"
        );
    }

    #[test]
    fn maps_all_day_and_cancelled_events() {
        let ev = map_google_event(&serde_json::json!({
            "id": "e1", "status": "cancelled",
            "start": { "date": "2026-04-01" }, "end": { "date": "2026-04-02" }
        }));
        assert_eq!(ev.start_datetime, "2026-04-01");
        assert_eq!(ev.status.as_deref(), Some("cancelled"));
        let minimal = map_google_event(&serde_json::json!({ "id": "e2", "status": "cancelled" }));
        assert_eq!(minimal.start_datetime, "");
    }
}
