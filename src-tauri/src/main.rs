// Prevents additional console window on Windows in release, DO NOT REMOVE
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod google_calendar;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use base64::Engine as _;
use tauri::Manager;
use lettre::{
    message::{header::ContentType, Attachment, Mailbox, MultiPart, SinglePart},
    transport::smtp::authentication::Credentials,
    Message, SmtpTransport, Transport,
};

fn get_data_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    app_handle
        .path_resolver()
        .app_data_dir()
        .expect("Failed to get app data dir")
}

fn validate_path_component(name: &str, label: &str) -> Result<(), String> {
    if name.is_empty() || name.contains("..") || name.contains('/') || name.contains('\\') || name.contains('\0') {
        return Err(format!("Invalid {}: must not be empty or contain path separators", label));
    }
    Ok(())
}

#[tauri::command]
fn save_data(app_handle: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    validate_path_component(&key, "key")?;
    let dir = get_data_dir(&app_handle);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.json", key));
    fs::write(&path, value).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_data(app_handle: tauri::AppHandle, key: String) -> Result<String, String> {
    validate_path_component(&key, "key")?;
    let dir = get_data_dir(&app_handle);
    let path = dir.join(format!("{}.json", key));
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| e.to_string())
    } else {
        Err("not_found".to_string())
    }
}

#[tauri::command]
fn delete_data(app_handle: tauri::AppHandle, key: String) -> Result<(), String> {
    validate_path_component(&key, "key")?;
    let dir = get_data_dir(&app_handle);
    let path = dir.join(format!("{}.json", key));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
fn open_file(app_handle: tauri::AppHandle, path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err("File not found".to_string());
    }
    if !p.is_file() {
        return Err("Path is not a file".to_string());
    }
    tauri::api::shell::open(&app_handle.shell_scope(), &path, None)
        .map_err(|e| e.to_string())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub from_name: String,
    pub from_email: String,
    pub use_tls: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SendEmailResult {
    pub success: bool,
    pub message_id: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
fn send_email_smtp(
    to_email: String,
    to_name: Option<String>,
    subject: String,
    body_text: String,
    pdf_base64: Option<String>,
    pdf_filename: Option<String>,
    smtp_config: SmtpConfig,
) -> SendEmailResult {
    let from: Mailbox = match format!("{} <{}>", smtp_config.from_name, smtp_config.from_email)
        .parse()
    {
        Ok(m) => m,
        Err(e) => return SendEmailResult { success: false, message_id: None, error: Some(format!("Invalid from address: {}", e)) },
    };

    let to_str = if let Some(ref name) = to_name {
        format!("{} <{}>", name, to_email)
    } else {
        to_email.clone()
    };
    let to: Mailbox = match to_str.parse() {
        Ok(m) => m,
        Err(e) => return SendEmailResult { success: false, message_id: None, error: Some(format!("Invalid to address: {}", e)) },
    };

    let email_result = if let Some(ref b64) = pdf_base64 {
        let pdf_bytes = match base64::engine::general_purpose::STANDARD.decode(b64) {
            Ok(bytes) => bytes,
            Err(e) => return SendEmailResult { success: false, message_id: None, error: Some(format!("Error decoding PDF: {}", e)) },
        };
        let filename = pdf_filename.unwrap_or_else(|| "pla_nutricional.pdf".to_string());
        let ct = match ContentType::parse("application/pdf") {
            Ok(ct) => ct,
            Err(_) => return SendEmailResult { success: false, message_id: None, error: Some("Internal error: invalid content type".into()) },
        };
        let attachment = Attachment::new(filename).body(pdf_bytes, ct);
        let text_part = SinglePart::builder().content_type(ContentType::TEXT_PLAIN).body(body_text);
        Message::builder().from(from).to(to).subject(&subject)
            .multipart(MultiPart::mixed().singlepart(text_part).singlepart(attachment))
    } else {
        Message::builder().from(from).to(to).subject(&subject).body(body_text)
    };

    let email = match email_result {
        Ok(e) => e,
        Err(e) => return SendEmailResult { success: false, message_id: None, error: Some(format!("Error building message: {}", e)) },
    };

    let creds = Credentials::new(smtp_config.username.clone(), smtp_config.password.clone());
    let transport_result = if smtp_config.use_tls {
        SmtpTransport::starttls_relay(&smtp_config.host).map(|b| b.port(smtp_config.port).credentials(creds).build())
    } else {
        SmtpTransport::relay(&smtp_config.host).map(|b| b.port(smtp_config.port).credentials(creds).build())
    };

    let transport = match transport_result {
        Ok(t) => t,
        Err(e) => return SendEmailResult { success: false, message_id: None, error: Some(format!("SMTP connection error: {}", e)) },
    };

    match transport.send(&email) {
        Ok(response) => SendEmailResult { success: true, message_id: Some(format!("{}", response.code())), error: None },
        Err(e) => SendEmailResult { success: false, message_id: None, error: Some(format!("{}", e)) },
    }
}

#[tauri::command]
fn test_smtp_connection(smtp_config: SmtpConfig) -> SendEmailResult {
    let creds = Credentials::new(smtp_config.username.clone(), smtp_config.password.clone());
    let transport_result = if smtp_config.use_tls {
        SmtpTransport::starttls_relay(&smtp_config.host).map(|b| b.port(smtp_config.port).credentials(creds).build())
    } else {
        SmtpTransport::relay(&smtp_config.host).map(|b| b.port(smtp_config.port).credentials(creds).build())
    };

    match transport_result {
        Ok(transport) => match transport.test_connection() {
            Ok(true) => SendEmailResult { success: true, message_id: None, error: None },
            _ => SendEmailResult { success: false, message_id: None, error: Some("Connection test failed".to_string()) },
        },
        Err(e) => SendEmailResult { success: false, message_id: None, error: Some(format!("Connection error: {}", e)) },
    }
}

// ============================================
// DOCUMENT FILE MANAGEMENT
// ============================================

const MAX_DOCUMENT_SIZE: u64 = 50 * 1024 * 1024; // 50 MB

fn get_documents_dir(app_handle: &tauri::AppHandle, client_id: &str) -> PathBuf {
    get_data_dir(app_handle).join("documents").join(client_id)
}

#[tauri::command]
fn copy_file_to_documents(
    app_handle: tauri::AppHandle,
    source_path: String,
    client_id: String,
    dest_filename: String,
) -> Result<String, String> {
    validate_path_component(&client_id, "client_id")?;
    validate_path_component(&dest_filename, "dest_filename")?;
    let src = std::path::Path::new(&source_path);
    if !src.exists() {
        return Err("Source file not found".to_string());
    }

    // Check file size
    let metadata = fs::metadata(src).map_err(|e| e.to_string())?;
    if metadata.len() > MAX_DOCUMENT_SIZE {
        return Err("file_too_large".to_string());
    }

    // Validate PDF magic bytes
    let mut file = std::fs::File::open(src).map_err(|e| e.to_string())?;
    let mut header = [0u8; 5];
    use std::io::Read;
    file.read_exact(&mut header).map_err(|e| e.to_string())?;
    if &header != b"%PDF-" {
        return Err("invalid_pdf".to_string());
    }

    let dest_dir = get_documents_dir(&app_handle, &client_id);
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    let dest_path = dest_dir.join(&dest_filename);
    fs::copy(src, &dest_path).map_err(|e| e.to_string())?;

    // Return JSON with path and file size
    let size = metadata.len();
    Ok(format!("{}|{}", dest_path.to_string_lossy(), size))
}

#[tauri::command]
fn read_file_as_base64(app_handle: tauri::AppHandle, path: String) -> Result<String, String> {
    // Security: only allow reading from documents directory
    let docs_root = get_data_dir(&app_handle).join("documents");
    fs::create_dir_all(&docs_root).map_err(|e| e.to_string())?;
    let canonical = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    let canonical_root = std::fs::canonicalize(&docs_root).map_err(|e| e.to_string())?;
    if !canonical.starts_with(&canonical_root) {
        return Err("Access denied: path outside documents directory".to_string());
    }

    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

#[tauri::command]
fn delete_document_file(app_handle: tauri::AppHandle, path: String) -> Result<(), String> {
    // Security: only allow deleting from documents directory
    let docs_root = get_data_dir(&app_handle).join("documents");
    fs::create_dir_all(&docs_root).map_err(|e| e.to_string())?;
    let canonical = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    let canonical_root = std::fs::canonicalize(&docs_root).map_err(|e| e.to_string())?;
    if !canonical.starts_with(&canonical_root) {
        return Err("Access denied: path outside documents directory".to_string());
    }

    if std::path::Path::new(&path).exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
fn delete_documents_directory(app_handle: tauri::AppHandle, client_id: String) -> Result<(), String> {
    validate_path_component(&client_id, "client_id")?;
    let dir = get_documents_dir(&app_handle, &client_id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
fn save_bytes_to_documents(
    app_handle: tauri::AppHandle,
    client_id: String,
    dest_filename: String,
    base64_data: String,
) -> Result<String, String> {
    validate_path_component(&client_id, "client_id")?;
    validate_path_component(&dest_filename, "dest_filename")?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|e| format!("Base64 decode error: {}", e))?;

    if bytes.len() as u64 > MAX_DOCUMENT_SIZE {
        return Err("file_too_large".to_string());
    }

    let dest_dir = get_documents_dir(&app_handle, &client_id);
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    let dest_path = dest_dir.join(&dest_filename);
    fs::write(&dest_path, &bytes).map_err(|e| e.to_string())?;

    Ok(dest_path.to_string_lossy().to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            save_data,
            load_data,
            delete_data,
            open_file,
            send_email_smtp,
            test_smtp_connection,
            google_calendar::gcal_start_auth,
            google_calendar::gcal_exchange_token,
            google_calendar::gcal_refresh_token,
            google_calendar::gcal_revoke_token,
            google_calendar::gcal_list_calendars,
            google_calendar::gcal_list_events,
            google_calendar::gcal_list_deleted_events,
            google_calendar::gcal_create_event,
            google_calendar::gcal_update_event,
            google_calendar::gcal_delete_event,
            copy_file_to_documents,
            read_file_as_base64,
            delete_document_file,
            delete_documents_directory,
            save_bytes_to_documents
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
