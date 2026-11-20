//! Copy of the backups in the user's own Google Drive.
//!
//! Scope `drive.file`: the app only sees the files and the folder it created
//! itself, never the rest of the Drive. Same OAuth connection as Google
//! Calendar (the token comes from the frontend). Errors keep the
//! `"<op> failed (<status>) [<reason>]: <msg>"` shape of the calendar module.

use crate::google_calendar::{format_api_error, send_json, url_encode};
use serde::Serialize;
use std::time::Duration;

const FILES_URL: &str = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL: &str = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME: &str = "application/vnd.google-apps.folder";
const FILE_FIELDS: &str = "id,name,modifiedTime,size";

#[derive(Serialize, Debug, Clone)]
pub struct DriveFile {
    pub id: String,
    pub name: String,
    #[serde(rename = "modifiedTime")]
    pub modified_time: Option<String>,
    pub size: Option<u64>,
}

/// Uploads are a few MB: longer timeout than the calendar requests.
fn drive_client() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(180))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

/// Drive ids are letters, digits, `-` and `_`: anything else never reaches a URL.
fn valid_id(id: &str) -> Result<(), String> {
    let ok = !id.is_empty() && id.len() <= 200 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if ok { Ok(()) } else { Err("invalid_drive_id".to_string()) }
}

/// Our own file names (`nutripolo-copia-2026-11-20.json`, the folder name).
fn valid_name(name: &str) -> Result<(), String> {
    let ok = !name.is_empty()
        && name.len() <= 120
        && name.chars().all(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.'));
    if ok { Ok(()) } else { Err("invalid_drive_name".to_string()) }
}

/// Literal inside a Drive query (`name = '...'`).
fn query_literal(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "\\'")
}

fn parse_file(v: &serde_json::Value) -> Option<DriveFile> {
    Some(DriveFile {
        id: v["id"].as_str()?.to_string(),
        name: v["name"].as_str().unwrap_or_default().to_string(),
        modified_time: v["modifiedTime"].as_str().map(|s| s.to_string()),
        // Drive sends the size as a string
        size: v["size"].as_str().and_then(|s| s.parse().ok()).or_else(|| v["size"].as_u64()),
    })
}

/// multipart/related body: JSON metadata + JSON content.
fn multipart_body(boundary: &str, metadata: &serde_json::Value, content: &str) -> String {
    format!(
        "--{b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{m}\r\n--{b}\r\nContent-Type: application/json\r\n\r\n{c}\r\n--{b}--\r\n",
        b = boundary,
        m = metadata,
        c = content
    )
}

/// Id of the backups folder, created if the app has none yet.
#[tauri::command]
pub async fn gdrive_find_or_create_folder(access_token: String, name: String) -> Result<String, String> {
    valid_name(&name)?;
    let q = format!(
        "name = '{}' and mimeType = '{}' and trashed = false",
        query_literal(&name),
        FOLDER_MIME
    );
    let found = send_json(
        "Drive find folder",
        drive_client()
            .get(FILES_URL)
            .bearer_auth(&access_token)
            .query(&[("q", q.as_str()), ("fields", "files(id,name)"), ("spaces", "drive"), ("pageSize", "10")]),
    )
    .await?;
    if let Some(id) = found["files"].as_array().and_then(|f| f.first()).and_then(|f| f["id"].as_str()) {
        return Ok(id.to_string());
    }
    let created = send_json(
        "Drive create folder",
        drive_client()
            .post(FILES_URL)
            .bearer_auth(&access_token)
            .query(&[("fields", "id")])
            .json(&serde_json::json!({ "name": name, "mimeType": FOLDER_MIME })),
    )
    .await?;
    created["id"].as_str().map(|s| s.to_string()).ok_or_else(|| "Drive create folder failed: invalid response".to_string())
}

/// Files in the folder (not trashed), newest name first.
#[tauri::command]
pub async fn gdrive_list_files(access_token: String, folder_id: String) -> Result<Vec<DriveFile>, String> {
    valid_id(&folder_id)?;
    let q = format!("'{}' in parents and trashed = false", folder_id);
    let fields = format!("files({})", FILE_FIELDS);
    let body = send_json(
        "Drive list",
        drive_client().get(FILES_URL).bearer_auth(&access_token).query(&[
            ("q", q.as_str()),
            ("fields", fields.as_str()),
            ("orderBy", "name desc"),
            ("pageSize", "200"),
            ("spaces", "drive"),
        ]),
    )
    .await?;
    Ok(body["files"].as_array().map(|files| files.iter().filter_map(parse_file).collect()).unwrap_or_default())
}

/// Write `content` (JSON) as `name` in the folder: replaces the file `file_id`
/// when given (one file per day, updated during the day), otherwise creates
/// it. A `file_id` that no longer exists (deleted in Drive) is created again.
/// Refused (`drive_encrypted`) while at-rest encryption is on.
#[tauri::command]
pub async fn gdrive_upload_file(
    app_handle: tauri::AppHandle,
    access_token: String,
    folder_id: String,
    name: String,
    content: String,
    file_id: Option<String>,
) -> Result<DriveFile, String> {
    valid_id(&folder_id)?;
    valid_name(&name)?;
    // The data is encrypted at rest: it never leaves in plain text, whatever
    // the frontend decided before (encryption may have just been turned on).
    if crate::encryption_is_enabled_internal(&app_handle) {
        return Err("drive_encrypted".to_string());
    }
    if let Some(id) = file_id.as_deref() {
        valid_id(id)?;
        let resp = drive_client()
            .patch(format!("{}/{}", UPLOAD_URL, url_encode(id)))
            .bearer_auth(&access_token)
            .query(&[("uploadType", "media"), ("fields", FILE_FIELDS)])
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(content.clone())
            .send()
            .await
            .map_err(|e| format!("Drive upload failed: network error: {}", e.without_url()))?;
        let status = resp.status();
        let text = resp.text().await.map_err(|_| "Drive upload failed: network error reading the response".to_string())?;
        if status.is_success() {
            let v: serde_json::Value = serde_json::from_str(&text).map_err(|_| "Drive upload failed: invalid response".to_string())?;
            return parse_file(&v).ok_or_else(|| "Drive upload failed: invalid response".to_string());
        }
        if status != reqwest::StatusCode::NOT_FOUND {
            return Err(format_api_error("Drive upload", status.as_u16(), &text));
        }
        // Gone from Drive: create it again below
    }

    let boundary = format!("nutripolo-{}", rand::random::<u64>());
    let metadata = serde_json::json!({ "name": name, "parents": [folder_id], "mimeType": "application/json" });
    let created = send_json(
        "Drive upload",
        drive_client()
            .post(UPLOAD_URL)
            .bearer_auth(&access_token)
            .query(&[("uploadType", "multipart"), ("fields", FILE_FIELDS)])
            .header(reqwest::header::CONTENT_TYPE, format!("multipart/related; boundary={}", boundary))
            .body(multipart_body(&boundary, &metadata, &content)),
    )
    .await?;
    parse_file(&created).ok_or_else(|| "Drive upload failed: invalid response".to_string())
}

/// Content of a file the app created (to restore a copy).
#[tauri::command]
pub async fn gdrive_download_file(access_token: String, file_id: String) -> Result<String, String> {
    valid_id(&file_id)?;
    let resp = drive_client()
        .get(format!("{}/{}", FILES_URL, url_encode(&file_id)))
        .bearer_auth(&access_token)
        .query(&[("alt", "media")])
        .send()
        .await
        .map_err(|e| format!("Drive download failed: network error: {}", e.without_url()))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|_| "Drive download failed: network error reading the response".to_string())?;
    if !status.is_success() {
        return Err(format_api_error("Drive download", status.as_u16(), &text));
    }
    Ok(text)
}

/// Delete an old copy (to the Drive bin is not possible with this scope: it
/// is deleted). A file already gone is fine.
#[tauri::command]
pub async fn gdrive_delete_file(access_token: String, file_id: String) -> Result<(), String> {
    valid_id(&file_id)?;
    let resp = drive_client()
        .delete(format!("{}/{}", FILES_URL, url_encode(&file_id)))
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| format!("Drive delete failed: network error: {}", e.without_url()))?;
    let status = resp.status();
    if status.is_success() || status == reqwest::StatusCode::NOT_FOUND {
        return Ok(());
    }
    let text = resp.text().await.unwrap_or_default();
    Err(format_api_error("Drive delete", status.as_u16(), &text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_and_names_never_carry_url_or_query_syntax() {
        assert!(valid_id("1AbC_d-9").is_ok());
        for bad in ["", "a/b", "a?b", "a b", "a'b", "../x"] {
            assert!(valid_id(bad).is_err(), "{bad:?}");
        }
        assert!(valid_name("nutripolo-copia-2026-11-20.json").is_ok());
        assert!(valid_name("NutriPolo - Copias de seguridad").is_ok());
        for bad in ["", "a'b", "a/b", "x\" or 1=1"] {
            assert!(valid_name(bad).is_err(), "{bad:?}");
        }
        assert_eq!(query_literal("a'b\\c"), "a\\'b\\\\c");
    }

    #[test]
    fn multipart_has_metadata_then_content() {
        let body = multipart_body("B", &serde_json::json!({ "name": "x.json" }), "{\"a\":1}");
        assert!(body.starts_with("--B\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{\"name\":\"x.json\"}\r\n--B\r\n"));
        assert!(body.ends_with("{\"a\":1}\r\n--B--\r\n"));
    }

    #[test]
    fn parses_drive_sizes_sent_as_strings() {
        let f = parse_file(&serde_json::json!({ "id": "1", "name": "n", "size": "2182820", "modifiedTime": "t" })).unwrap();
        assert_eq!(f.size, Some(2182820));
        assert!(parse_file(&serde_json::json!({ "name": "no id" })).is_none());
    }
}
