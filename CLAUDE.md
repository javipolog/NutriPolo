# CLAUDE.md - NutriPolo App

## Descripcion del Projecte

Aplicacio d'escriptori per a Windows 11 per a la gestio de consultes de nutricionistes. Desenvolupada amb **Tauri 1.5** (Rust + React), permet gestionar clients, consultes, plans nutricionals, facturacio, mesures corporals, documents, integracio amb Google Calendar i recordatoris de cites (email + WhatsApp).

**Autor:** Javier Polo Garcia
**Llicencia:** MIT
**Versio:** 1.14.1
**Identificador:** com.nutripolo.app

---

## Stack Tecnologic

### Frontend (React 18)
- **React 18.2** - Biblioteca d'UI
- **Zustand 4.4** - Gestio d'estat global amb persistencia
- **Tailwind CSS 3.3** - Estils utility-first
- **Lucide React** - Icones
- **Recharts 2.10** - Grafics i visualitzacions
- **pdf-lib + fontkit** - Generacio de PDFs vectorials (factures i plans), tots amb Onest

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
│   │   ├── LoadErrorScreen.jsx       # Pantalla si el fitxer de dades no es pot llegir
│   │   ├── NutritionPlanEditor.jsx   # Vista Planes (pestanyes Planes / Alimentos / Recetas) + editor antic (per àpats)
│   │   ├── plan/FoodsView.jsx        # Pestanya Alimentos: catàleg d'aliments bàsics (Mercadona + nutrició)
│   │   ├── plan/PlanificacionEditor.jsx # Editor a pantalla completa de la planificació setmanal
│   │   ├── plan/PdfPreview.jsx       # Vista prèvia en viu d'un PDF (pdf.js)
│   │   ├── plan/WebRecipePicker.jsx  # Llista de receptes de nutripoloraquel.com (WebRecipeList: selector i pestanya Recetas)
│   │   ├── plan/FoodCatalogPicker.jsx # Selector del catàleg d'aliments amb foto
│   │   ├── PatientSuggestionsInbox.jsx # Pacients detectats en calendaris externs
│   │   ├── RemindersPanel.jsx        # Panells de recordatoris i de ressenyes (Dashboard)
│   │   ├── SendEmailModal.jsx        # Modal enviament d'emails amb adjunts
│   │   ├── ServicesView.jsx          # Gestio de serveis/tarifes
│   │   ├── SettingsView.jsx          # Configuracio de l'app
│   │   ├── settings/RemindersSection.jsx # Ajustos de recordatoris + editor de plantilles
│   │   ├── settings/ReviewRequestsSection.jsx # Ajustos de ressenyes de Google
│   │   ├── UnlockScreen.jsx          # Desbloqueig (xifratge AES-256)
│   │   └── UI.jsx                    # Components base reutilitzables (toast, confirm, etc.)
│   │
│   ├── hooks/
│   │   ├── useBackgroundJobs.js      # Auto-sync GCal + enviament automatic de recordatoris
│   │   ├── useReminderActions.js     # Accions de recordatori (WhatsApp / email) amb registre
│   │   ├── useWebRecipes.js          # Receptes de la web en memòria cau + sincronització
│   │   └── useNow.js                 # Rellotge que es refresca
│   │
│   ├── services/                     # Serveis de negoci
│   │   ├── documentService.js        # Upload/open/delete documents via Tauri
│   │   ├── emailService.js           # Enviament d'emails via SMTP
│   │   ├── googleCalendarService.js  # Sync bidireccional amb Google Calendar
│   │   ├── invoiceDesignPresets.js   # Presets de disseny per factures
│   │   ├── foodCatalog.js            # Càrrega i filtres del catàleg d'aliments (pur, amb tests)
│   │   ├── genericFoods.js           # Aliments genèrics amb foto (pur, amb tests)
│   │   ├── fuzzyMatcher.js           # Coincidencia difusa de noms de pacients
│   │   ├── pdfFonts.js               # Fonts dels PDF (Onest) i fetch amb cache
│   │   ├── pdfInvoiceGenerator.js    # Generacio PDF factures (pdf-lib)
│   │   ├── pdfPlanGenerator.js       # Generacio PDF plans antics per àpats (pdf-lib)
│   │   ├── pdfPlanificacionGenerator.js # PDF de la planificació (substitueix Canva; Onest + icones Lucide)
│   │   ├── planificacion.js          # Model de la planificació (pur, amb tests)
│   │   ├── planPdf.js                # Tria generador segons format + imatges de productes
│   │   ├── reminderService.js        # Logica de recordatoris (pura, amb tests) + wa.me / SMTP
│   │   ├── webRecipes.js             # Receptari de la web: API REST + parseig HTML (pur, amb tests)
│   │   └── reviewRequestService.js   # Peticio de ressenya a Google despres de la consulta (pura, amb tests)
│   │
│   ├── stores/                       # Estat global (Zustand)
│   │   └── store.js                  # Store unic amb totes les entitats
│   │
│   ├── App.jsx                       # Component arrel + navegacio per vistes
│   ├── i18n.js                       # Traduccions ES/CA/EN (fallback per clau a ES)
│   ├── main.jsx                      # Punt d'entrada React
│   └── styles.css                    # Variables de tema (paleta clar/fosc) i estils globals
│
├── src-tauri/                        # Backend Rust
│   ├── src/
│   │   ├── main.rs                   # Comandes IPC: save/load, email SMTP, documents, keyring
│   │   ├── encryption.rs             # AES-256-GCM + Argon2id
│   │   └── google_calendar.rs        # OAuth2 + API Google Calendar
│   ├── icons/                        # Icones de l'aplicacio
│   ├── Cargo.toml                    # Dependencies Rust
│   └── tauri.conf.json               # Configuracio Tauri + CSP + bundle
│
├── public/                           # Assets estatics
│   ├── alimentos/                    # Fotos del catàleg d'aliments (480 px, fons blanc)
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

# Tests unitaris (vitest)
npm test

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
fn save_data(app_handle, key, value) -> Result<(), String>      // escriptura atomica (.tmp + rename)
fn load_data(app_handle, key) -> Result<String, String>
fn delete_data(app_handle, key) -> Result<(), String>
fn quarantine_data(app_handle, key) -> Result<(), String>       // mou un fitxer illegible a *.corrupt-<ts>

// Secrets (Windows Credential Manager)
fn store_smtp_password / get_smtp_password / clear_smtp_password / has_smtp_password
fn secret_set(name, value) / secret_get(name) / secret_clear(name)  // nomes gcal_refresh_token, gcal_client_secret

// Xifratge
fn encryption_is_enabled / encryption_is_unlocked / encryption_setup / encryption_unlock
fn encryption_lock / encryption_change_password

// Fitxers
fn open_file(path) -> Result<(), String>   // nomes PDF; desxifra a temporal si cal
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
fn gcal_list_events(token, calendar_id, time_min, time_max, time_zone) -> Result<String, String>  // inclou cancel·lats (showDeleted)
fn gcal_get_event(token, calendar_id, event_id) -> Result<String, String>
fn gcal_create_event(token, calendar_id, event_json) -> Result<String, String>      // id determinista; 409 → PATCH
fn gcal_update_event(token, calendar_id, event_id, event_json) -> Result<String, String>  // PATCH
fn gcal_delete_event(token, calendar_id, event_id) -> Result<(), String>

// Receptari de la web (nomes nutripoloraquel.com: /wp-json/wp/v2/receta i /receta/...)
fn recipes_fetch(path) -> Result<String, String>

// Segon pla (safata del sistema + inici amb Windows)
fn autostart_is_enabled() / autostart_set(enabled)   // clau Run del registre, arrenca amb --hidden
fn configure_tray(close_to_tray, show_label, quit_label)
fn quit_app()                                         // el JS el crida despres de flushAllPending (event `tray-quit`)
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
- Migracions a `migrateStore` (STORE_VERSION); `config` es fusiona amb els valors per defecte en hidratar
- Si el fitxer de dades no es pot llegir, les escriptures queden bloquejades (`getLoadFailure`)
- Canvis de sincronitzacio o de recordatoris no han de tocar `localUpdatedAt` (si no, es fa push a Google)

### Google Calendar
- Scopes minims: `calendar.events` + `calendar.calendarlist.readonly`; OAuth loopback a `127.0.0.1` amb PKCE + `state`
- Totes les escriptures a Google (push, esborrat, sync) passen per una sola cua a `googleCalendarService`
- Escriptures del sync: `updateConsultation(id, data, { sync: true })`; les de l'usuari descarten els camps de sync (`SYNC_FIELDS`) i actualitzen `localUpdatedAt`
- Esdeveniments creats amb id determinista (`googleEventIdFor`) → mai duplicats
- Esborrar: `googleCalendar.deleteConsultation` (tombstone a `gcalPendingDeletes` si no hi ha xarxa o el calendari es de nomes lectura); esborrat a Google → s'esborra si la cita es buida, si no queda `cancelada` + `remoteDeleted`
- Errors del backend: `"<op> failed (<status>) [<reason>]: <msg>"`; es reintenten xarxa, 5xx, 429 i 403 de rate limit

### Recordatoris de cites
- Configuracio a `config.reminders` (valors per defecte a `DEFAULT_REMINDER_CONFIG`)
- Estat per consulta a `consultation.reminders.{email|whatsapp}` = `{ status, at, slot, attempts?, error? }`; `slot` = `fecha + 'T' + hora` (reprogramar torna a activar el recordatori)
- Preferencies del client: `client.recordatorios.{email|whatsapp}` (opt-out) i `client.idioma`
- Email automatic per SMTP des de `useBackgroundJobs` (cada 5 min, nomes amb l'app en marxa); WhatsApp semiautomatic via wa.me
- Ressenya de Google despres de la consulta: `config.reviewRequests` (defectes a `DEFAULT_REVIEW_CONFIG`): primera visita / seguiment (per historial del client), enllac i interruptor per ubicacio (`locations[id]`, si no `defaultUrl`), `delayHours` despres del final. Estat a `consultation.reviewRequest.{email|whatsapp}`; nomes un cop per client (`already_asked`); opt-out a `client.recordatorios.review`
- Segon pla: en tancar la finestra l'app queda a la safata (`config.closeToTray`) i pot arrencar amb Windows amagada (`--hidden`); instancia unica (tauri-plugin-single-instance). Amb xifratge cal desbloquejar abans que s'envii res

### Planificacions (dietes setmanals)
- Format nou: `nutritionPlans` amb `formato: 'planificacion'` (model a `planificacion.js`); els plans sense `formato` són els antics per àpats i conserven el seu editor i PDF
- Seccions: `desayunos` / `mediaManana` / `merienda` (opcions), `cantidades`, `menu.dias[]` (7 dies × `comida`/`cena` × `a`/`b`, amb `receta` enllaçada al PDF) i `productos` (ids)
- Productes reutilitzables a `planLibrary.productos` (`{ id, nombre, imagen }`, JPEG petit en data URL); inclosos a les còpies de seguretat
- Secció Productos: un aliment de la planificació que es diu igual que un de la biblioteca d'aliments (`foodMatcher`: primer els genèrics, després el bàsic de Mercadona sense parèntesi) agafa la foto amb un clic; el botó "Biblioteca de alimentos" (`FoodCatalogPicker`) tria de tota la biblioteca. La foto es copia a `planLibrary.productos` (`foodPhotoDataUrl`)
- Una planificació nova copia el contingut de l'última del client; els títols de "Mis recetas" i de la web autocompleten ingredients (`buildDishIndex`)
- "Mis recetas": `planLibrary.recetas` (`{ id, titulo, alimentos, receta, nota, updatedAt }`, clau = `dishKey(titulo)`). En desar una planificació s'hi desen sols els plats i opcions amb títol i aliments nous o canviats des que es va obrir l'editor (`collectOwnRecipes` + `mergeOwnRecipes`), excepte receptes de la web sense retocar (així una recepta esborrada no torna); la migració v13 la sembra amb les planificacions existents. Es tria i s'esborra des de la pestanya del selector de receptes
- PDF: Onest en una sola família; salvia i taronja del logo com a accents, text en `ink`/`soft`/`olive` (AA) i res per sota de ~7 pt
- Ingredients "Nom (170 g)" → quantitat alineada a la dreta (`splitQuantity`); a la guia, "Pa: 60 g" → taula aliment | ració
- El menú va en una pàgina horitzontal si el text hi cap a mida llegible; si no, es parteix en comidas i cenas
- Receptes de la web (`webRecipes.js`): llista per l'API REST de WordPress (tipus `receta`) i ingredients/temps/etiquetes llegits de l'HTML de cada recepta (camps ACF que l'API no exposa). Memòria cau a `planLibrary.recetasWeb` (`{ items, syncedAt }`); es resincronitza en obrir l'editor si té més de 6 h i només es baixen les receptes amb `modified` nou. El servidor atén les peticions en sèrie (~6 s cadascuna): les pàgines es baixen d'una en una, la llista es mostra de seguida amb `ingredientes: null` per a les pendents, i una recepta pendent es baixa a l'acte si es tria (`loadWebRecipeNow`). Triar-ne una omple títol, enllaç (`receta`) i només els ingredients clau (`summarizeIngredients`: sense quantitats, rebost, espècies ni opcionals, i les verdures de sofrit en una línia), o la versió retocada si n'hi ha una a "Mis recetas"; també surten a l'autocompletat de títols (`buildDishIndex`, per darrere de "Mis recetas")
- Les imatges de la web porten `referrerPolicy="no-referrer"`: el servidor talla la connexió si rep un Referer d'un altre lloc

### Catàleg d'aliments (pestanya Alimentos de Planes)
- Planes té tres pestanyes (`plansSection` al store, no es desa): Planes, Alimentos i Recetas (receptari de la web; en prémer una recepta s'obre al navegador). La paleta (Ctrl+K) porta directament a cada pestanya
- El genera `node scripts/catalog/import-mercadona.mjs` a `public/catalog/` (`foods.json` + `images/<id>.jpg`, fora de git); s'empaqueta amb l'app i es llegeix amb `fetch('/catalog/foods.json')` (`foodCatalog.js`). No passa pel store ni per les còpies de seguretat
- Llista curta a `scripts/catalog/basics.json`: ~290 bàsics, cadascun amb un producte de Mercadona (`id`), el nom genèric (`basico`) i, si cal, l'aliment genèric de BEDCA (`bedca`, `aprox`)
- Nutrició per 100 g: Open Food Facts per EAN; si no hi és o no quadra (control Atwater), BEDCA. `nutricion.fuente` / `nutricion.control` (`ok`, `revisar`, `incompleto`, `sin_datos`)
- Fotos: les originals de la botiga (600×600 sobre blanc), sense retocar
- Una sola biblioteca (`buildFoodLibrary` / `loadFoodLibrary`, hook `useFoodLibrary`): els bàsics de Mercadona i els aliments genèrics de `genericFoods.js`, que van primer dins de cada categoria (les mateixes que Mercadona) i prenen la nutrició del producte equivalent (`mercadona` = sourceId, `nutricion.equivalente`). Si Mercadona no s'ha generat, només hi ha els genèrics
- Canvis propis: des del detall d'un aliment es pot canviar la foto i escriure els valors per 100 g. Es guarden a `planLibrary.alimentos` (`{ [foodId]: { imagen?, por100g?, updatedAt } }`, `setFoodEdit` / `clearFoodEdit`), entren a les còpies de seguretat i s'apliquen amb `applyFoodEdits` (`useFoodLibrary`); el catàleg no es toca i es pot tornar a la foto o als valors originals. Els productes de la planificació també poden canviar de foto (`updatePlanProduct`)
- Genèrics: fotos reals de Pixabay a `public/alimentos/<id>.jpg` (sí que van a git), totes retallades sobre blanc amb la mateixa mida i ombra (`scripts/food-catalog-photos.py`, cal Pillow). Res d'imatges generades amb IA

### Estils
- **Tailwind CSS** amb paleta personalitzada: `sage` (neutres càlids), `wellness` (color principal), `terra` (accent) i semàntics (`success`, `warning`, `danger`, `info`)
- `sage`, `wellness` i `terra` són variables CSS a `styles.css` (clar i fosc); no feu servir colors de Tailwind (`red-*`, `orange-*`…) ni hex als components
- Contrast WCAG AA: `sage-400`+ com a text; `wellness-400` / `terra-500` porten text blanc
- Dark mode via `data-theme` a `<html>`; les excepcions (`bg-white`, text semàntic) són a `styles.css`
- Components base a `UI.jsx`: `Button`, `Badge`, `StatusBadge`, `SegmentedControl`, `Combobox` (llistes llargues, p. ex. clients), `Modal` (prop `footer` fora del scroll)
- Tipografia: **Onest a tot arreu** (UI, títols i PDFs). `font-serif` / `font-mono` són només rols (títols de vista `font-serif text-title`, codis) i també són Onest; xifres amb `tabular-nums`; res per sota d'11 px
- UI: Onest empaquetada amb @fontsource (`main.jsx`); PDFs: instàncies estàtiques completes (latin-ext, fletxes) a `public/fonts` amb `Onest-OFL.txt`, via `pdfFonts.js`. Cap petició a Google Fonts

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
- SMTP password i secrets de Google al Windows Credential Manager (mai al store ni als backups)
- Scope de fs limitat (`$APP`, `$APPDATA`, carpetes d'usuari); els camins triats en dialegs s'afegeixen sols

---

## Contacte

**Desenvolupador:** Javier Polo Garcia
**Projecte:** NutriPolo App
**Tecnologies:** Tauri 1.5 + React 18 + Rust
