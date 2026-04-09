# CLAUDE.md - NutriPolo App

## Descripcion del Projecte

Aplicacio d'escriptori per a Windows 11 per a la gestio de consultes de nutricionistes. Desenvolupada amb **Tauri 1.5** (Rust + React), permet gestionar clients, consultes, plans nutricionals, facturacio, mesures corporals, documents i integracio amb Google Calendar.

**Autor:** Javier Polo Garcia
**Llicencia:** MIT
**Versio:** 1.0.0
**Identificador:** com.nutripolo.app

---

## Stack Tecnologic

### Frontend (React 18)
- **React 18.2** - Biblioteca d'UI
- **Zustand 4.4** - Gestio d'estat global amb persistencia
- **Tailwind CSS 3.3** - Estils utility-first
- **Lucide React** - Icones
- **Recharts 2.10** - Grafics i visualitzacions
- **pdf-lib + fontkit** - Generacio de PDFs vectorials (factures i plans)

### Backend (Rust)
- **Tauri 1.5** - Framework d'apps d'escriptori
- **Serde / Serde JSON** - Serialitzacio
- **lettre 0.11** - Enviament d'emails SMTP
- **reqwest 0.12** - Client HTTP (Google Calendar OAuth)
- **base64** - Codificacio de fitxers

### Build Tools
- **Vite 5** - Bundler i dev server
- **PostCSS + Autoprefixer** - Processament CSS

---

## Estructura del Projecte

```
nutripolo-app/
├── src/                              # Frontend React
│   ├── components/                   # Components UI
│   │   ├── CalendarView.jsx          # Vista calendari (setmana/mes)
│   │   ├── ClientDetailView.jsx      # Fitxa completa del client (tabs)
│   │   ├── ClientDocuments.jsx       # Gestio de documents per client
│   │   ├── ClientModal.jsx           # Modal creacio/edicio clients
│   │   ├── ClientsView.jsx           # Llistat de clients
│   │   ├── CommandPalette.jsx        # Paleta de comandes (Ctrl+K)
│   │   ├── ConsultationModal.jsx     # Modal creacio/edicio consultes + GCal push
│   │   ├── ConsultationsView.jsx     # Llistat de consultes
│   │   ├── Dashboard.jsx             # Vista principal amb estadistiques
│   │   ├── DocumentMetadataModal.jsx # Modal metadades de documents
│   │   ├── InvoiceModal.jsx          # Modal creacio/edicio factures
│   │   ├── Invoices.jsx              # Llistat de factures
│   │   ├── MeasurementChart.jsx      # Grafic d'evolucio de mesures
│   │   ├── NutritionPlanEditor.jsx   # Editor de plans nutricionals + PDF
│   │   ├── SendEmailModal.jsx        # Modal enviament d'emails amb adjunts
│   │   ├── ServicesView.jsx          # Gestio de serveis/tarifes
│   │   ├── SettingsView.jsx          # Configuracio de l'app
│   │   └── UI.jsx                    # Components base reutilitzables (toast, confirm, etc.)
│   │
│   ├── services/                     # Serveis de negoci
│   │   ├── documentService.js        # Upload/open/delete documents via Tauri
│   │   ├── emailService.js           # Enviament d'emails via SMTP
│   │   ├── googleCalendarService.js  # Sync bidireccional amb Google Calendar
│   │   ├── invoiceDesignPresets.js   # Presets de disseny per factures
│   │   ├── pdfInvoiceGenerator.js    # Generacio PDF factures (pdf-lib)
│   │   └── pdfPlanGenerator.js       # Generacio PDF plans nutricionals (pdf-lib)
│   │
│   ├── stores/                       # Estat global (Zustand)
│   │   └── store.js                  # Store unic amb totes les entitats
│   │
│   ├── App.jsx                       # Component arrel + navegacio per vistes
│   ├── i18n.js                       # Traduccions ES/CA
│   ├── main.jsx                      # Punt d'entrada React
│   └── styles.css                    # Estils globals Tailwind
│
├── src-tauri/                        # Backend Rust
│   ├── src/
│   │   ├── main.rs                   # Comandes IPC: save/load, email SMTP, documents
│   │   └── google_calendar.rs        # OAuth2 + API Google Calendar
│   ├── icons/                        # Icones de l'aplicacio
│   ├── Cargo.toml                    # Dependencies Rust
│   └── tauri.conf.json               # Configuracio Tauri + CSP + bundle
│
├── public/                           # Assets estatics
│   ├── icon.svg                      # Icona SVG
│   └── icon-nutripolo.svg            # Icona NutriPolo
│
├── package.json                      # Dependencies Node.js
├── vite.config.js                    # Configuracio Vite
├── tailwind.config.js                # Configuracio Tailwind (paleta NutriPolo)
└── postcss.config.js                 # Configuracio PostCSS
```

---

## Comandes Principals

```bash
# Instal·lar dependencies
npm install

# Desenvolupament amb hot-reload
npm run tauri:dev

# Nomes frontend (sense Tauri)
npm run dev

# Compilar frontend
npm run build

# Compilar aplicacio completa (.exe)
npm run tauri:build

# Preview del build frontend
npm run preview
```

---

## Funcions Tauri (IPC)

### Comandes disponibles (Rust -> JS)

```rust
// Dades
fn save_data(app_handle, key, value) -> Result<(), String>
fn load_data(app_handle, key) -> Result<String, String>
fn delete_data(app_handle, key) -> Result<(), String>

// Fitxers
fn open_file(path) -> Result<(), String>
fn copy_file_to_documents(app_handle, source_path, client_id, dest_filename) -> Result<String, String>
fn read_file_as_base64(app_handle, path) -> Result<String, String>
fn delete_document_file(app_handle, path) -> Result<(), String>
fn delete_documents_directory(app_handle, client_id) -> Result<(), String>
fn save_bytes_to_documents(app_handle, client_id, dest_filename, base64_data) -> Result<String, String>

// Email SMTP
fn send_email_smtp(to_email, to_name, subject, body_text, pdf_base64, pdf_filename, smtp_config) -> SendEmailResult
fn test_smtp_connection(smtp_config) -> SendEmailResult

// Google Calendar (modul google_calendar)
fn gcal_start_auth(client_id) -> Result<AuthResponse, String>
fn gcal_exchange_token(client_id, client_secret, code, redirect_uri) -> Result<TokenResponse, String>
fn gcal_refresh_token(client_id, client_secret, refresh_token) -> Result<TokenResponse, String>
fn gcal_revoke_token(token) -> Result<(), String>
fn gcal_list_calendars(token) -> Result<String, String>
fn gcal_list_events(token, calendar_id, time_min, time_max) -> Result<String, String>
fn gcal_create_event(token, calendar_id, event_json) -> Result<String, String>
fn gcal_update_event(token, calendar_id, event_id, event_json) -> Result<String, String>
fn gcal_delete_event(token, calendar_id, event_id) -> Result<(), String>
```

---

## Patrons i Convencions

### Components React
- Components funcionals amb hooks
- Props destructurades
- Navegacio per vistes via `currentView` al store (sense React Router)
- i18n via `src/i18n.js` amb suport ES/CA

### Gestio d'Estat
- **Zustand** amb persistencia automatica al filesystem via Tauri
- Store unic (`store.js`) amb totes les entitats i accions
- Undo/redo integrat (`_history`, `_future`)

### Estils
- **Tailwind CSS** amb paleta personalitzada (sand, terra, wellness, sage)
- Suport dark mode
- Classes utilitaries sense CSS custom

### Nomenclatura
- **Components:** PascalCase (`InvoiceModal.jsx`)
- **Funcions:** camelCase (`generateInvoiceNumber`)
- **Constants:** SCREAMING_SNAKE_CASE (`DEFAULT_IVA`)
- **Fitxers:** camelCase per serveis, PascalCase per components

---

## Persistencia de Dades

Les dades es guarden localment a:

```
Windows: C:\Users\<usuari>\AppData\Roaming\com.nutripolo.app\
```

Cada entitat es guarda com a fitxer JSON separat (`clients.json`, `consultations.json`, etc.).
Documents dels clients es guarden a `documents/<clientId>/`.

---

## Seguretat

- Dades guardades localment (no cloud)
- CSP configurat per Google OAuth i Google Calendar API
- Validacio de magic bytes per PDFs
- Limit de 50MB per document
- Path traversal protection en lectura/eliminacio de documents
- SMTP password gestionat en memoria (no persistit)

---

## Contacte

**Desenvolupador:** Javier Polo Garcia
**Projecte:** NutriPolo App
**Tecnologies:** Tauri 1.5 + React 18 + Rust
