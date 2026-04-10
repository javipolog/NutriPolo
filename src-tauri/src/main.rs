// Prevents additional console window on Windows in release, DO NOT REMOVE
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod encryption;
mod google_calendar;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use base64::Engine as _;
use tauri::Manager;
use lettre::{
    message::{header::ContentType, Attachment, Mailbox, MultiPart, SinglePart},
    transport::smtp::authentication::Credentials,
    Message, SmtpTransport, Transport,
};

// ============================================
// SECURITY HELPERS
// ============================================

/// Wrap an internal error with a stable public code; log the detail in debug builds.
/// Callers should use short, snake_case codes (e.g. "smtp_connection_failed")
/// that the frontend can translate into localized user messages.
fn sanitize_err(internal: impl std::fmt::Display, public: &str) -> String {
    #[cfg(debug_assertions)]
    eprintln!("[sanitize_err] {}: {}", public, internal);
    #[cfg(not(debug_assertions))]
    let _ = internal; // suppress unused warning in release
    public.to_string()
}

/// Reject any value containing CR/LF/NUL. Prevents SMTP header injection
/// (e.g. a maliciously crafted `to_name` inserting `Bcc:` headers) and
/// guards against null-byte tricks in general.
fn reject_crlf(value: &str, field: &str) -> Result<(), String> {
    if value.contains('\r') || value.contains('\n') || value.contains('\0') {
        return Err(format!("invalid_{}_contains_control_chars", field));
    }
    Ok(())
}

// ============================================
// DATA PERSISTENCE
// ============================================

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

fn encryption_config_path(app_handle: &tauri::AppHandle) -> PathBuf {
    get_data_dir(app_handle).join("encryption.json")
}

/// Returns true iff an `encryption.json` is present in AppData. The presence
/// of this file is the single source of truth for whether encryption is
/// enabled — its contents (salt + verification blob) are required to
/// attempt any unlock.
fn encryption_is_enabled_internal(app_handle: &tauri::AppHandle) -> bool {
    encryption_config_path(app_handle).exists()
}

#[tauri::command]
fn save_data(app_handle: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    validate_path_component(&key, "key")?;
    let dir = get_data_dir(&app_handle);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // The "encryption" key itself stores the salt + verification blob and
    // must stay in plaintext — otherwise we'd have a chicken-and-egg
    // problem on unlock. Everything else gets transparently encrypted
    // once the master key is unlocked.
    let should_encrypt = encryption_is_enabled_internal(&app_handle) && key != "encryption";

    if should_encrypt {
        let key_bytes = encryption::current_key()?;
        let ct = encryption::encrypt(value.as_bytes(), &key_bytes)?;
        let path = dir.join(format!("{}.enc", key));
        // Remove any stale plaintext version to avoid data divergence.
        let plain_path = dir.join(format!("{}.json", key));
        let _ = fs::remove_file(&plain_path);
        fs::write(&path, ct).map_err(|e| e.to_string())
    } else {
        let path = dir.join(format!("{}.json", key));
        fs::write(&path, value).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn load_data(app_handle: tauri::AppHandle, key: String) -> Result<String, String> {
    validate_path_component(&key, "key")?;
    let dir = get_data_dir(&app_handle);

    // If an `.enc` file exists, it takes precedence — we require the
    // store to be unlocked to read it.
    let enc_path = dir.join(format!("{}.enc", key));
    if enc_path.exists() {
        let key_bytes = encryption::current_key()?;
        let ct = fs::read(&enc_path).map_err(|e| e.to_string())?;
        let pt = encryption::decrypt(&ct, &key_bytes)?;
        return String::from_utf8(pt).map_err(|_| "invalid_utf8".to_string());
    }

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
    let mut removed_any = false;
    for ext in &["json", "enc"] {
        let path = dir.join(format!("{}.{}", key, ext));
        if path.exists() {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
            removed_any = true;
        }
    }
    let _ = removed_any;
    Ok(())
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

// ============================================
// EMAIL (SMTP)
// ============================================

/// Maximum SMTP attachment size (after base64 decode). Most SMTP servers
/// reject anything larger than 25 MB; a hard limit here also prevents
/// OOM attacks from the frontend sending huge payloads.
const MAX_EMAIL_ATTACHMENT: usize = 25 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
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

fn err_result(code: &str) -> SendEmailResult {
    SendEmailResult { success: false, message_id: None, error: Some(code.to_string()) }
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
    // Defense in depth: reject any header field containing CR/LF/NUL,
    // even though the frontend should have already sanitized them.
    let checks: [(&str, &str); 6] = [
        (&to_email,                        "to_email"),
        (to_name.as_deref().unwrap_or(""), "to_name"),
        (&subject,                         "subject"),
        (&smtp_config.from_email,          "from_email"),
        (&smtp_config.from_name,           "from_name"),
        (&smtp_config.host,                "smtp_host"),
    ];
    for (value, field) in checks {
        if let Err(code) = reject_crlf(value, field) {
            return err_result(&code);
        }
    }

    let from: Mailbox = match format!("{} <{}>", smtp_config.from_name, smtp_config.from_email)
        .parse()
    {
        Ok(m) => m,
        Err(e) => return err_result(&sanitize_err(e, "invalid_from_address")),
    };

    let to_str = if let Some(ref name) = to_name {
        format!("{} <{}>", name, to_email)
    } else {
        to_email.clone()
    };
    let to: Mailbox = match to_str.parse() {
        Ok(m) => m,
        Err(e) => return err_result(&sanitize_err(e, "invalid_to_address")),
    };

    let email_result = if let Some(ref b64) = pdf_base64 {
        let pdf_bytes = match base64::engine::general_purpose::STANDARD.decode(b64) {
            Ok(bytes) => bytes,
            Err(e) => return err_result(&sanitize_err(e, "invalid_pdf_data")),
        };
        if pdf_bytes.len() > MAX_EMAIL_ATTACHMENT {
            return err_result("attachment_too_large");
        }
        let filename = pdf_filename.unwrap_or_else(|| "pla_nutricional.pdf".to_string());
        if let Err(code) = reject_crlf(&filename, "pdf_filename") {
            return err_result(&code);
        }
        let ct = match ContentType::parse("application/pdf") {
            Ok(ct) => ct,
            Err(_) => return err_result("internal_content_type"),
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
        Err(e) => return err_result(&sanitize_err(e, "message_build_failed")),
    };

    let creds = Credentials::new(smtp_config.username.clone(), smtp_config.password.clone());
    let transport_result = if smtp_config.use_tls {
        SmtpTransport::starttls_relay(&smtp_config.host).map(|b| b.port(smtp_config.port).credentials(creds).build())
    } else {
        SmtpTransport::relay(&smtp_config.host).map(|b| b.port(smtp_config.port).credentials(creds).build())
    };

    let transport = match transport_result {
        Ok(t) => t,
        Err(e) => return err_result(&sanitize_err(e, "smtp_connection_failed")),
    };

    match transport.send(&email) {
        Ok(response) => SendEmailResult { success: true, message_id: Some(format!("{}", response.code())), error: None },
        Err(e) => err_result(&sanitize_err(e, "smtp_send_failed")),
    }
}

#[tauri::command]
fn test_smtp_connection(smtp_config: SmtpConfig) -> SendEmailResult {
    // Same defensive checks as send_email_smtp — the config fields end
    // up as SMTP protocol content and must not contain CR/LF.
    let checks: [(&str, &str); 4] = [
        (&smtp_config.host,        "smtp_host"),
        (&smtp_config.username,    "smtp_username"),
        (&smtp_config.from_email,  "from_email"),
        (&smtp_config.from_name,   "from_name"),
    ];
    for (value, field) in checks {
        if let Err(code) = reject_crlf(value, field) {
            return err_result(&code);
        }
    }

    let creds = Credentials::new(smtp_config.username.clone(), smtp_config.password.clone());
    let transport_result = if smtp_config.use_tls {
        SmtpTransport::starttls_relay(&smtp_config.host).map(|b| b.port(smtp_config.port).credentials(creds).build())
    } else {
        SmtpTransport::relay(&smtp_config.host).map(|b| b.port(smtp_config.port).credentials(creds).build())
    };

    match transport_result {
        Ok(transport) => match transport.test_connection() {
            Ok(true) => SendEmailResult { success: true, message_id: None, error: None },
            _ => err_result("smtp_test_failed"),
        },
        Err(e) => err_result(&sanitize_err(e, "smtp_connection_failed")),
    }
}

// ============================================
// SMTP PASSWORD (Windows Credential Manager via keyring crate)
// ============================================
// The SMTP password is sensitive and must never hit disk. We store it
// in the OS credential store (Windows Credential Manager on this target)
// under the service "com.nutripolo.app" and user "smtp_password".
// The frontend calls these commands before sending email or when the
// user saves the SMTP settings; the password never appears in the
// Zustand store or in any settings.json.

const KEYRING_SERVICE: &str = "com.nutripolo.app";
const KEYRING_USER_SMTP: &str = "smtp_password";

fn smtp_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_SMTP)
        .map_err(|e| sanitize_err(e, "keyring_error"))
}

#[tauri::command]
fn store_smtp_password(password: String) -> Result<(), String> {
    let entry = smtp_entry()?;
    entry.set_password(&password)
        .map_err(|e| sanitize_err(e, "keyring_store_failed"))
}

#[tauri::command]
fn get_smtp_password() -> Result<String, String> {
    let entry = smtp_entry()?;
    entry.get_password()
        .map_err(|e| sanitize_err(e, "no_smtp_password"))
}

#[tauri::command]
fn clear_smtp_password() -> Result<(), String> {
    let entry = smtp_entry()?;
    // Best-effort: if nothing is stored, treat as success.
    let _ = entry.delete_password();
    Ok(())
}

#[tauri::command]
fn has_smtp_password() -> bool {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_SMTP)
        .ok()
        .and_then(|e| e.get_password().ok())
        .is_some()
}

// ============================================
// AT-REST ENCRYPTION (AES-256-GCM + Argon2id)
// ============================================
// The user opts in from Settings → Seguridad. Once enabled, every
// `save_data`/`load_data` call and every document PDF transparently
// routes through the encryption module. The derived master key is
// held in an in-process `Mutex<Option<[u8;32]>>` (see encryption.rs)
// and never touches disk. On `encryption_lock` (or app exit) it is
// zeroized. The only thing that persists on disk is `encryption.json`
// which holds the salt and a tiny "verification blob" so we can tell
// a wrong password from a correct one without trial-decrypting user
// data.

#[derive(Serialize, Deserialize)]
struct EncryptionConfigFile {
    version: u8,
    salt: Vec<u8>,
    verify_blob: Vec<u8>,
}

#[tauri::command]
fn encryption_is_enabled(app_handle: tauri::AppHandle) -> bool {
    encryption_is_enabled_internal(&app_handle)
}

#[tauri::command]
fn encryption_is_unlocked() -> bool {
    encryption::is_unlocked()
}

/// Enable encryption for the first time. Derives a master key from the
/// password, writes `encryption.json`, migrates all existing plaintext
/// files (and document PDFs) to encrypted `.enc` companions, and leaves
/// the store in the unlocked state ready for immediate use.
#[tauri::command]
fn encryption_setup(app_handle: tauri::AppHandle, password: String) -> Result<(), String> {
    if password.len() < 8 {
        return Err("password_too_short".into());
    }
    let dir = get_data_dir(&app_handle);
    fs::create_dir_all(&dir).map_err(|e| sanitize_err(e, "data_dir_create_failed"))?;

    if encryption_is_enabled_internal(&app_handle) {
        return Err("already_enabled".into());
    }

    // Take a one-shot backup of the current plaintext state so the user
    // can recover manually if anything goes wrong mid-migration.
    let backup_dir = dir.join("backup_pre_encryption");
    if !backup_dir.exists() {
        fs::create_dir_all(&backup_dir).map_err(|e| sanitize_err(e, "backup_dir_create_failed"))?;
        copy_dir_recursive(&dir, &backup_dir, &backup_dir)
            .map_err(|e| sanitize_err(e, "backup_failed"))?;
    }

    let salt = encryption::random_salt();
    let key = encryption::derive_key(&password, &salt)?;
    let verify_blob = encryption::encrypt(encryption::MAGIC_VERIFY, &key)?;
    let cfg = EncryptionConfigFile { version: 1, salt: salt.to_vec(), verify_blob };
    let cfg_json = serde_json::to_string(&cfg).map_err(|e| sanitize_err(e, "serialize_failed"))?;
    fs::write(encryption_config_path(&app_handle), cfg_json)
        .map_err(|e| sanitize_err(e, "encryption_config_write_failed"))?;

    // Migrate all *.json → *.enc (excluding encryption.json itself) and
    // every document PDF under documents/ → .pdf.enc.
    migrate_plaintext_to_encrypted(&dir, &key)?;

    encryption::set_master_key(key);
    Ok(())
}

/// Unlock the store with a user-supplied password. On success the
/// derived key is stored in memory for this session.
#[tauri::command]
fn encryption_unlock(app_handle: tauri::AppHandle, password: String) -> Result<(), String> {
    let cfg_path = encryption_config_path(&app_handle);
    let raw = fs::read_to_string(&cfg_path).map_err(|_| "no_encryption_config".to_string())?;
    let cfg: EncryptionConfigFile = serde_json::from_str(&raw)
        .map_err(|_| "invalid_encryption_config".to_string())?;
    let key = encryption::derive_key(&password, &cfg.salt)?;
    // Trial-decrypt the verification blob. If it matches our magic
    // constant, the password was correct.
    let verified = encryption::decrypt(&cfg.verify_blob, &key)
        .map_err(|_| "wrong_password".to_string())?;
    if verified != encryption::MAGIC_VERIFY {
        return Err("wrong_password".into());
    }
    encryption::set_master_key(key);
    Ok(())
}

#[tauri::command]
fn encryption_lock() {
    encryption::clear_master_key();
}

/// Re-encrypt every file with a new master key. We DO NOT keep both
/// versions on disk simultaneously: for each file we decrypt with
/// the old key, encrypt with the new key, and atomically overwrite.
/// A crash mid-way would leave a mixed state — which is why we take
/// a backup first.
#[tauri::command]
fn encryption_change_password(
    app_handle: tauri::AppHandle,
    old_password: String,
    new_password: String,
) -> Result<(), String> {
    if new_password.len() < 8 {
        return Err("password_too_short".into());
    }
    let cfg_path = encryption_config_path(&app_handle);
    let raw = fs::read_to_string(&cfg_path).map_err(|_| "no_encryption_config".to_string())?;
    let cfg: EncryptionConfigFile = serde_json::from_str(&raw)
        .map_err(|_| "invalid_encryption_config".to_string())?;

    let old_key = encryption::derive_key(&old_password, &cfg.salt)?;
    let verified = encryption::decrypt(&cfg.verify_blob, &old_key)
        .map_err(|_| "wrong_password".to_string())?;
    if verified != encryption::MAGIC_VERIFY {
        return Err("wrong_password".into());
    }

    // Safety net in case rekey fails mid-way through.
    let dir = get_data_dir(&app_handle);
    let rekey_backup = dir.join("backup_pre_rekey");
    if rekey_backup.exists() {
        let _ = fs::remove_dir_all(&rekey_backup);
    }
    fs::create_dir_all(&rekey_backup).map_err(|e| sanitize_err(e, "backup_dir_create_failed"))?;
    copy_dir_recursive(&dir, &rekey_backup, &rekey_backup)
        .map_err(|e| sanitize_err(e, "backup_failed"))?;

    let new_salt = encryption::random_salt();
    let new_key = encryption::derive_key(&new_password, &new_salt)?;

    rekey_all_files(&dir, &old_key, &new_key)?;

    let new_verify = encryption::encrypt(encryption::MAGIC_VERIFY, &new_key)?;
    let new_cfg = EncryptionConfigFile {
        version: 1,
        salt: new_salt.to_vec(),
        verify_blob: new_verify,
    };
    let cfg_json = serde_json::to_string(&new_cfg)
        .map_err(|e| sanitize_err(e, "serialize_failed"))?;
    fs::write(&cfg_path, cfg_json)
        .map_err(|e| sanitize_err(e, "encryption_config_write_failed"))?;

    encryption::set_master_key(new_key);
    Ok(())
}

/// Recursively copy directory contents. Used by `encryption_setup` and
/// `encryption_change_password` to snapshot AppData before touching it.
/// Skips the destination directory itself to avoid infinite recursion.
fn copy_dir_recursive(src: &Path, dst: &Path, skip: &Path) -> std::io::Result<()> {
    if !dst.exists() {
        fs::create_dir_all(dst)?;
    }
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        if path == skip {
            continue;
        }
        // Avoid copying sibling backup dirs into each other.
        let fname = entry.file_name();
        let name = fname.to_string_lossy();
        if name.starts_with("backup_pre_encryption") || name.starts_with("backup_pre_rekey") {
            continue;
        }
        let dest = dst.join(&fname);
        if path.is_dir() {
            copy_dir_recursive(&path, &dest, skip)?;
        } else {
            fs::copy(&path, &dest)?;
        }
    }
    Ok(())
}

/// Walk AppData and convert every plaintext file that the app owns into
/// its encrypted counterpart. We only touch `*.json` at the root (store
/// files) and every file under `documents/<clientId>/`. Everything
/// else (cache, logs, etc.) is left alone.
fn migrate_plaintext_to_encrypted(dir: &Path, key: &[u8; encryption::KEY_LEN]) -> Result<(), String> {
    // Root .json files (excluding encryption.json which must stay in plain).
    for entry in fs::read_dir(dir).map_err(|e| sanitize_err(e, "read_dir_failed"))? {
        let entry = entry.map_err(|e| sanitize_err(e, "read_entry_failed"))?;
        let path = entry.path();
        if !path.is_file() { continue; }
        if path.extension().and_then(|e| e.to_str()) != Some("json") { continue; }
        let fname = path.file_name().and_then(|f| f.to_str()).unwrap_or("");
        if fname == "encryption.json" { continue; }

        let plain = fs::read(&path).map_err(|e| sanitize_err(e, "migrate_read_failed"))?;
        let ct = encryption::encrypt(&plain, key)?;
        let enc_path = path.with_extension("json.enc");
        // Store without the double extension to match save_data convention.
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        let target = path.with_file_name(format!("{}.enc", stem));
        // Write to a temp first to avoid a half-written .enc if we crash.
        let tmp = target.with_extension("enc.tmp");
        fs::write(&tmp, &ct).map_err(|e| sanitize_err(e, "migrate_write_failed"))?;
        fs::rename(&tmp, &target).map_err(|e| sanitize_err(e, "migrate_rename_failed"))?;
        fs::remove_file(&path).map_err(|e| sanitize_err(e, "migrate_remove_failed"))?;
        let _ = enc_path; // suppress unused
    }

    // Document PDFs under documents/<clientId>/*.
    let docs_dir = dir.join("documents");
    if docs_dir.exists() {
        migrate_documents_dir(&docs_dir, key)?;
    }

    Ok(())
}

fn migrate_documents_dir(docs_dir: &Path, key: &[u8; encryption::KEY_LEN]) -> Result<(), String> {
    for client_entry in fs::read_dir(docs_dir).map_err(|e| sanitize_err(e, "read_dir_failed"))? {
        let client_entry = client_entry.map_err(|e| sanitize_err(e, "read_entry_failed"))?;
        let client_path = client_entry.path();
        if !client_path.is_dir() { continue; }
        for entry in fs::read_dir(&client_path).map_err(|e| sanitize_err(e, "read_dir_failed"))? {
            let entry = entry.map_err(|e| sanitize_err(e, "read_entry_failed"))?;
            let path = entry.path();
            if !path.is_file() { continue; }
            // Skip already-encrypted files.
            if path.extension().and_then(|e| e.to_str()) == Some("enc") { continue; }
            let plain = fs::read(&path).map_err(|e| sanitize_err(e, "migrate_read_failed"))?;
            let ct = encryption::encrypt(&plain, key)?;
            let fname = path.file_name().and_then(|f| f.to_str()).unwrap_or("").to_string();
            let target = client_path.join(format!("{}.enc", fname));
            let tmp = target.with_extension("enc.tmp");
            fs::write(&tmp, &ct).map_err(|e| sanitize_err(e, "migrate_write_failed"))?;
            fs::rename(&tmp, &target).map_err(|e| sanitize_err(e, "migrate_rename_failed"))?;
            fs::remove_file(&path).map_err(|e| sanitize_err(e, "migrate_remove_failed"))?;
        }
    }
    Ok(())
}

/// Re-encrypt every `.enc` file under AppData with a new key. Used by
/// `encryption_change_password`.
fn rekey_all_files(
    dir: &Path,
    old_key: &[u8; encryption::KEY_LEN],
    new_key: &[u8; encryption::KEY_LEN],
) -> Result<(), String> {
    // Root .enc files.
    for entry in fs::read_dir(dir).map_err(|e| sanitize_err(e, "read_dir_failed"))? {
        let entry = entry.map_err(|e| sanitize_err(e, "read_entry_failed"))?;
        let path = entry.path();
        if !path.is_file() { continue; }
        if path.extension().and_then(|e| e.to_str()) != Some("enc") { continue; }
        rekey_file(&path, old_key, new_key)?;
    }
    // Documents.
    let docs_dir = dir.join("documents");
    if docs_dir.exists() {
        for client_entry in fs::read_dir(&docs_dir).map_err(|e| sanitize_err(e, "read_dir_failed"))? {
            let client_entry = client_entry.map_err(|e| sanitize_err(e, "read_entry_failed"))?;
            let client_path = client_entry.path();
            if !client_path.is_dir() { continue; }
            for entry in fs::read_dir(&client_path).map_err(|e| sanitize_err(e, "read_dir_failed"))? {
                let entry = entry.map_err(|e| sanitize_err(e, "read_entry_failed"))?;
                let path = entry.path();
                if !path.is_file() { continue; }
                if path.extension().and_then(|e| e.to_str()) != Some("enc") { continue; }
                rekey_file(&path, old_key, new_key)?;
            }
        }
    }
    Ok(())
}

fn rekey_file(
    path: &Path,
    old_key: &[u8; encryption::KEY_LEN],
    new_key: &[u8; encryption::KEY_LEN],
) -> Result<(), String> {
    let ct = fs::read(path).map_err(|e| sanitize_err(e, "rekey_read_failed"))?;
    let pt = encryption::decrypt(&ct, old_key)?;
    let new_ct = encryption::encrypt(&pt, new_key)?;
    let tmp = path.with_extension("enc.tmp");
    fs::write(&tmp, &new_ct).map_err(|e| sanitize_err(e, "rekey_write_failed"))?;
    fs::rename(&tmp, path).map_err(|e| sanitize_err(e, "rekey_rename_failed"))?;
    Ok(())
}

// ============================================
// DOCUMENT FILE MANAGEMENT
// ============================================

const MAX_DOCUMENT_SIZE: u64 = 50 * 1024 * 1024; // 50 MB

fn get_documents_dir(app_handle: &tauri::AppHandle, client_id: &str) -> PathBuf {
    get_data_dir(app_handle).join("documents").join(client_id)
}

/// Resolve the real on-disk path of a document. Callers pass a "logical"
/// path that may end in `.pdf` (plaintext) or `.enc` (encrypted). If
/// encryption is enabled we always prefer the `.enc` companion.
fn resolve_document_path(logical: &str, encrypted: bool) -> PathBuf {
    let p = Path::new(logical);
    if encrypted {
        if p.extension().and_then(|e| e.to_str()) == Some("enc") {
            p.to_path_buf()
        } else {
            PathBuf::from(format!("{}.enc", logical))
        }
    } else {
        p.to_path_buf()
    }
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

    // Validate PDF magic bytes on the source file.
    let mut file = std::fs::File::open(src).map_err(|e| e.to_string())?;
    let mut header = [0u8; 5];
    use std::io::Read;
    file.read_exact(&mut header).map_err(|e| e.to_string())?;
    if &header != b"%PDF-" {
        return Err("invalid_pdf".to_string());
    }

    let dest_dir = get_documents_dir(&app_handle, &client_id);
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    let size = metadata.len();
    let encrypted = encryption_is_enabled_internal(&app_handle);

    if encrypted {
        // Read the full source into memory, encrypt, write to `.enc`.
        // Document size is already capped to 50MB so this is safe.
        let key_bytes = encryption::current_key()?;
        let plain = fs::read(src).map_err(|e| e.to_string())?;
        let ct = encryption::encrypt(&plain, &key_bytes)?;
        let dest_path = dest_dir.join(format!("{}.enc", dest_filename));
        fs::write(&dest_path, &ct).map_err(|e| e.to_string())?;
        Ok(format!("{}|{}", dest_path.to_string_lossy(), size))
    } else {
        let dest_path = dest_dir.join(&dest_filename);
        fs::copy(src, &dest_path).map_err(|e| e.to_string())?;
        Ok(format!("{}|{}", dest_path.to_string_lossy(), size))
    }
}

#[tauri::command]
fn read_file_as_base64(app_handle: tauri::AppHandle, path: String) -> Result<String, String> {
    // Security: only allow reading from documents directory
    let docs_root = get_data_dir(&app_handle).join("documents");
    fs::create_dir_all(&docs_root).map_err(|e| e.to_string())?;

    let encrypted = encryption_is_enabled_internal(&app_handle);
    let real_path = resolve_document_path(&path, encrypted);

    let canonical = std::fs::canonicalize(&real_path).map_err(|e| e.to_string())?;
    let canonical_root = std::fs::canonicalize(&docs_root).map_err(|e| e.to_string())?;
    if !canonical.starts_with(&canonical_root) {
        return Err("Access denied: path outside documents directory".to_string());
    }

    let bytes = fs::read(&real_path).map_err(|e| e.to_string())?;
    let plaintext = if encrypted {
        let key_bytes = encryption::current_key()?;
        encryption::decrypt(&bytes, &key_bytes)?
    } else {
        bytes
    };
    Ok(base64::engine::general_purpose::STANDARD.encode(&plaintext))
}

#[tauri::command]
fn delete_document_file(app_handle: tauri::AppHandle, path: String) -> Result<(), String> {
    // Security: only allow deleting from documents directory
    let docs_root = get_data_dir(&app_handle).join("documents");
    fs::create_dir_all(&docs_root).map_err(|e| e.to_string())?;

    let encrypted = encryption_is_enabled_internal(&app_handle);
    let real_path = resolve_document_path(&path, encrypted);

    // If the resolved path does not exist (e.g. the file was already
    // deleted), there is nothing to do.
    if !real_path.exists() {
        return Ok(());
    }

    let canonical = std::fs::canonicalize(&real_path).map_err(|e| e.to_string())?;
    let canonical_root = std::fs::canonicalize(&docs_root).map_err(|e| e.to_string())?;
    if !canonical.starts_with(&canonical_root) {
        return Err("Access denied: path outside documents directory".to_string());
    }

    fs::remove_file(&real_path).map_err(|e| e.to_string())
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

    let encrypted = encryption_is_enabled_internal(&app_handle);
    let dest_path = if encrypted {
        dest_dir.join(format!("{}.enc", dest_filename))
    } else {
        dest_dir.join(&dest_filename)
    };

    let to_write = if encrypted {
        let key_bytes = encryption::current_key()?;
        encryption::encrypt(&bytes, &key_bytes)?
    } else {
        bytes
    };

    fs::write(&dest_path, &to_write).map_err(|e| e.to_string())?;

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
            store_smtp_password,
            get_smtp_password,
            clear_smtp_password,
            has_smtp_password,
            encryption_is_enabled,
            encryption_is_unlocked,
            encryption_setup,
            encryption_unlock,
            encryption_lock,
            encryption_change_password,
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
