// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::Manager;

// ============================================
// DATA STRUCTURES
// ============================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub nombre: String,
    pub nif: String,
    pub direccion: String,
    pub email: String,
    pub telefono: String,
    pub web: String,
    pub iban: String,
    #[serde(rename = "tipoIva")]
    pub tipo_iva: f64,
    #[serde(rename = "tipoIrpf")]
    pub tipo_irpf: f64,
    #[serde(rename = "idiomaDefecto")]
    pub idioma_defecto: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Client {
    pub id: String,
    pub nombre: String,
    #[serde(rename = "cifNif")]
    pub cif_nif: String,
    pub direccion: String,
    pub codigo: String,
    pub email: Option<String>,
    pub telefono: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Invoice {
    pub id: String,
    pub numero: String,
    #[serde(rename = "clienteId")]
    pub cliente_id: String,
    pub fecha: String,
    pub tipo: String,
    pub idioma: String,
    pub concepto: String,
    #[serde(rename = "baseImponible")]
    pub base_imponible: Option<f64>,
    pub jornadas: Option<f64>,
    #[serde(rename = "tarifaDia")]
    pub tarifa_dia: Option<f64>,
    pub subtotal: f64,
    #[serde(rename = "ivaPorcentaje")]
    pub iva_porcentaje: f64,
    pub iva: f64,
    #[serde(rename = "irpfPorcentaje")]
    pub irpf_porcentaje: f64,
    pub irpf: f64,
    pub total: f64,
    pub estado: String,
}

// Watcher event payload sent to frontend
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WatcherEvent {
    pub event_type: String,
    pub path: Option<String>,
    pub folder: Option<String>,
    pub message: Option<String>,
}

// ============================================
// WATCHER STATE
// ============================================

struct WatcherState {
    watcher: Option<RecommendedWatcher>,
    watched_folder: Option<String>,
}

impl Default for WatcherState {
    fn default() -> Self {
        Self {
            watcher: None,
            watched_folder: None,
        }
    }
}

// ============================================
// CORE DATA COMMANDS
// ============================================

fn get_data_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    let app_dir = app_handle
        .path_resolver()
        .app_data_dir()
        .expect("Failed to get app data dir");

    if !app_dir.exists() {
        fs::create_dir_all(&app_dir).expect("Failed to create app data dir");
    }

    app_dir
}

#[tauri::command]
fn save_data(app_handle: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let data_dir = get_data_dir(&app_handle);
    let file_path = data_dir.join(format!("{}.json", key));
    fs::write(&file_path, &value).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_data(app_handle: tauri::AppHandle, key: String) -> Result<String, String> {
    let data_dir = get_data_dir(&app_handle);
    let file_path = data_dir.join(format!("{}.json", key));
    if file_path.exists() {
        fs::read_to_string(&file_path).map_err(|e| e.to_string())
    } else {
        Err("File not found".to_string())
    }
}

#[tauri::command]
fn delete_data(app_handle: tauri::AppHandle, key: String) -> Result<(), String> {
    let data_dir = get_data_dir(&app_handle);
    let file_path = data_dir.join(format!("{}.json", key));
    if file_path.exists() {
        fs::remove_file(&file_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ============================================
// FOLDER WATCHER COMMANDS
// ============================================

fn is_pdf_file(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false)
}

fn is_in_ingresos(path: &std::path::Path) -> bool {
    path.components().any(|c| {
        c.as_os_str()
            .to_str()
            .map(|s| s.eq_ignore_ascii_case("INGRESOS"))
            .unwrap_or(false)
    })
}

/// Recursively collect all existing PDF files in a directory
fn collect_existing_pdfs(dir: &std::path::Path) -> Vec<String> {
    let mut pdfs = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.eq_ignore_ascii_case("INGRESOS") {
                        continue;
                    }
                }
                pdfs.extend(collect_existing_pdfs(&path));
            } else if is_pdf_file(&path) {
                if let Some(path_str) = path.to_str() {
                    pdfs.push(path_str.to_string());
                }
            }
        }
    }
    pdfs
}

/// Start watching a folder for PDF changes (recursive, realtime)
#[tauri::command]
fn start_watcher(
    app_handle: tauri::AppHandle,
    folder: String,
    state: tauri::State<'_, Arc<Mutex<WatcherState>>>,
) -> Result<Vec<String>, String> {
    let mut watcher_state = state.lock().map_err(|e| e.to_string())?;

    // Stop existing watcher if any
    watcher_state.watcher = None;
    watcher_state.watched_folder = None;

    let folder_path = std::path::Path::new(&folder);
    if !folder_path.exists() || !folder_path.is_dir() {
        return Err(format!("La carpeta no existeix: {}", folder));
    }

    // Collect existing PDFs (initial scan)
    let existing_pdfs = collect_existing_pdfs(folder_path);

    let app = app_handle.clone();
    let watched_folder = folder.clone();

    // Create the native filesystem watcher
    let mut watcher = RecommendedWatcher::new(
        move |result: Result<Event, notify::Error>| {
            match result {
                Ok(event) => {
                    let pdf_paths: Vec<String> = event
                        .paths
                        .iter()
                        .filter(|p| is_pdf_file(p) && !is_in_ingresos(p))
                        .filter_map(|p| p.to_str().map(String::from))
                        .collect();

                    if pdf_paths.is_empty() {
                        return;
                    }

                    match event.kind {
                        EventKind::Create(_) | EventKind::Modify(_) => {
                            for path in pdf_paths {
                                let payload = WatcherEvent {
                                    event_type: "pdf_detected".to_string(),
                                    path: Some(path),
                                    folder: Some(watched_folder.clone()),
                                    message: None,
                                };
                                let _ = app.emit_all("watcher-event", &payload);
                            }
                        }
                        EventKind::Remove(_) => {
                            for path in pdf_paths {
                                let payload = WatcherEvent {
                                    event_type: "pdf_removed".to_string(),
                                    path: Some(path),
                                    folder: Some(watched_folder.clone()),
                                    message: None,
                                };
                                let _ = app.emit_all("watcher-event", &payload);
                            }
                        }
                        _ => {}
                    }
                }
                Err(e) => {
                    let payload = WatcherEvent {
                        event_type: "error".to_string(),
                        path: None,
                        folder: Some(watched_folder.clone()),
                        message: Some(e.to_string()),
                    };
                    let _ = app.emit_all("watcher-event", &payload);
                }
            }
        },
        Config::default(),
    )
    .map_err(|e| format!("Error creant el watcher: {}", e))?;

    watcher
        .watch(folder_path, RecursiveMode::Recursive)
        .map_err(|e| format!("Error iniciant la vigilància: {}", e))?;

    watcher_state.watcher = Some(watcher);
    watcher_state.watched_folder = Some(folder.clone());

    // Emit started event
    let payload = WatcherEvent {
        event_type: "started".to_string(),
        path: None,
        folder: Some(folder),
        message: Some(format!("{} PDFs trobats inicialment", existing_pdfs.len())),
    };
    let _ = app_handle.emit_all("watcher-event", &payload);

    Ok(existing_pdfs)
}

/// Stop the folder watcher
#[tauri::command]
fn stop_watcher(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<WatcherState>>>,
) -> Result<(), String> {
    let mut watcher_state = state.lock().map_err(|e| e.to_string())?;

    let folder = watcher_state.watched_folder.clone();
    watcher_state.watcher = None;
    watcher_state.watched_folder = None;

    let payload = WatcherEvent {
        event_type: "stopped".to_string(),
        path: None,
        folder,
        message: None,
    };
    let _ = app_handle.emit_all("watcher-event", &payload);

    Ok(())
}

/// Get current watcher status
#[tauri::command]
fn get_watcher_status(
    state: tauri::State<'_, Arc<Mutex<WatcherState>>>,
) -> Result<serde_json::Value, String> {
    let watcher_state = state.lock().map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "active": watcher_state.watcher.is_some(),
        "folder": watcher_state.watched_folder,
    }))
}

// ============================================
// INVOICE PDF GENERATION
// ============================================

/// Genera el PDF a una ruta determinada per l'usuari (selector)
#[tauri::command]
fn generate_invoice_pdf(
    invoice: Invoice,
    client: Client,
    config: AppConfig,
    output_path: String,
) -> Result<String, String> {
    use printpdf::*;

    let (doc, page1, layer1) =
        PdfDocument::new(&invoice.numero, Mm(210.0), Mm(297.0), "Layer 1");

    let current_layer = doc.get_page(page1).get_layer(layer1);

    let font = doc
        .add_builtin_font(BuiltinFont::Helvetica)
        .map_err(|e| e.to_string())?;
    let font_bold = doc
        .add_builtin_font(BuiltinFont::HelveticaBold)
        .map_err(|e| e.to_string())?;

    let (lbl_freelance, lbl_client, lbl_concept, lbl_base, lbl_date, lbl_payment, lbl_bank, lbl_transfer) =
        if invoice.idioma == "ca" {
            (
                "FREELANCE", "CLIENT", "CONCEPTE", "BASE IMPOSABLE", "DATA",
                "FORMA DE PAGAMENT", "DADES BANCÀRIES", "Transferència bancària",
            )
        } else {
            (
                "FREELANCE", "CLIENTE", "CONCEPTO", "BASE IMPONIBLE", "FECHA",
                "FORMA DE PAGO", "DATOS BANCARIOS", "Transferencia bancaria",
            )
        };

    let date_parts: Vec<&str> = invoice.fecha.split('-').collect();
    let formatted_date = if date_parts.len() == 3 {
        format!("{}/{}/{}", date_parts[2], date_parts[1], &date_parts[0][2..])
    } else {
        invoice.fecha.clone()
    };

    let format_currency = |amount: f64| -> String { format!("{:.2}€", amount).replace(".", ",") };

    let gray = Color::Rgb(Rgb::new(0.4, 0.4, 0.4, None));

    current_layer.use_text("Nº", 10.0, Mm(160.0), Mm(280.0), &font_bold);
    current_layer.use_text(&invoice.numero, 10.0, Mm(175.0), Mm(280.0), &font);
    current_layer.use_text(lbl_date, 10.0, Mm(160.0), Mm(274.0), &font_bold);
    current_layer.use_text(&formatted_date, 10.0, Mm(175.0), Mm(274.0), &font);

    current_layer.use_text(
        &format!(": {}", lbl_freelance), 10.0, Mm(20.0), Mm(240.0), &font_bold,
    );
    current_layer.use_text(&config.nombre, 10.0, Mm(20.0), Mm(230.0), &font);
    current_layer.use_text(
        &format!("N.I.F: {}", config.nif), 10.0, Mm(20.0), Mm(224.0), &font,
    );

    let mut y_pos = 218.0;
    for line in config.direccion.lines() {
        current_layer.use_text(line, 10.0, Mm(20.0), Mm(y_pos), &font);
        y_pos -= 6.0;
    }

    current_layer.use_text(
        &format!(": {}", lbl_client), 10.0, Mm(110.0), Mm(240.0), &font_bold,
    );
    current_layer.use_text(&client.nombre, 10.0, Mm(110.0), Mm(230.0), &font);
    current_layer.use_text(
        &format!("N.I.F: {}", client.cif_nif), 10.0, Mm(110.0), Mm(224.0), &font,
    );

    let mut y_pos = 218.0;
    for line in client.direccion.lines() {
        current_layer.use_text(line, 10.0, Mm(110.0), Mm(y_pos), &font);
        y_pos -= 6.0;
    }

    current_layer.use_text(
        &format!(": {}", lbl_concept), 10.0, Mm(20.0), Mm(175.0), &font_bold,
    );
    current_layer.use_text(
        &format!(": {}", lbl_base), 10.0, Mm(160.0), Mm(175.0), &font_bold,
    );

    let black = Color::Rgb(Rgb::new(0.0, 0.0, 0.0, None));
    current_layer.set_outline_color(black);
    current_layer.set_outline_thickness(0.5);
    let line_points = vec![
        (Point::new(Mm(20.0), Mm(172.0)), false),
        (Point::new(Mm(190.0), Mm(172.0)), false),
    ];
    current_layer.add_line(Line { points: line_points, is_closed: false });

    current_layer.use_text(&invoice.concepto, 10.0, Mm(20.0), Mm(165.0), &font);
    current_layer.use_text(
        &format_currency(invoice.subtotal), 10.0, Mm(175.0), Mm(165.0), &font,
    );

    current_layer.use_text(
        &format!("+ {}% IVA", invoice.iva_porcentaje as i32), 10.0, Mm(140.0), Mm(140.0), &font,
    );
    current_layer.use_text(
        &format_currency(invoice.iva), 10.0, Mm(175.0), Mm(140.0), &font,
    );

    current_layer.use_text(
        &format!("- {}% IRPF", invoice.irpf_porcentaje as i32), 10.0, Mm(140.0), Mm(133.0), &font,
    );
    current_layer.use_text(
        &format_currency(invoice.irpf), 10.0, Mm(175.0), Mm(133.0), &font,
    );

    current_layer.set_outline_thickness(1.0);
    let total_line = vec![
        (Point::new(Mm(140.0), Mm(125.0)), false),
        (Point::new(Mm(190.0), Mm(125.0)), false),
    ];
    current_layer.add_line(Line { points: total_line, is_closed: false });

    current_layer.use_text("TOTAL", 12.0, Mm(140.0), Mm(115.0), &font_bold);
    current_layer.use_text(
        &format_currency(invoice.total), 12.0, Mm(170.0), Mm(115.0), &font_bold,
    );

    current_layer.use_text(lbl_payment, 9.0, Mm(20.0), Mm(45.0), &font_bold);
    current_layer.use_text(lbl_transfer, 9.0, Mm(160.0), Mm(45.0), &font);
    current_layer.use_text(lbl_bank, 9.0, Mm(20.0), Mm(39.0), &font_bold);
    current_layer.use_text(&config.iban, 9.0, Mm(145.0), Mm(39.0), &font);
    current_layer.use_text("CONCEPTO", 9.0, Mm(20.0), Mm(33.0), &font_bold);
    current_layer.use_text(&invoice.numero, 9.0, Mm(170.0), Mm(33.0), &font);

    current_layer.set_fill_color(gray);
    current_layer.use_text(&config.email, 9.0, Mm(20.0), Mm(20.0), &font);
    current_layer.use_text(&config.web, 9.0, Mm(95.0), Mm(20.0), &font_bold);
    current_layer.use_text(&config.telefono, 9.0, Mm(170.0), Mm(20.0), &font);

    doc.save(&mut std::io::BufWriter::new(
        fs::File::create(&output_path).map_err(|e| e.to_string())?,
    ))
    .map_err(|e| e.to_string())?;

    Ok(output_path)
}

#[tauri::command]
fn open_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ============================================
// MAIN
// ============================================

/// Genera el PDF a la carpeta temporal de l'app i retorna la ruta.
/// Usat per al flux d'enviament per email.
#[tauri::command]
fn generate_invoice_pdf_temp(
    app_handle: tauri::AppHandle,
    invoice: Invoice,
    client: Client,
    config: AppConfig,
) -> Result<String, String> {
    let app_dir = app_handle
        .path_resolver()
        .app_data_dir()
        .expect("Failed to get app data dir");

    let temp_dir = app_dir.join("temp_invoices");
    if !temp_dir.exists() {
        fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    }

    let safe_name = invoice
        .numero
        .replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    let output_path = temp_dir
        .join(format!("{}.pdf", safe_name))
        .to_string_lossy()
        .to_string();

    // Reutilitzem la mateixa lògica de generate_invoice_pdf
    generate_invoice_pdf(invoice, client, config, output_path.clone())?;

    Ok(output_path)
}

fn main() {
    let watcher_state = Arc::new(Mutex::new(WatcherState::default()));

    tauri::Builder::default()
        .manage(watcher_state)
        .invoke_handler(tauri::generate_handler![
            save_data,
            load_data,
            delete_data,
            generate_invoice_pdf,
            generate_invoice_pdf_temp,
            open_file,
            start_watcher,
            stop_watcher,
            get_watcher_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
