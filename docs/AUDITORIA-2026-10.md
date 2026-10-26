# Auditoría NutriPolo — octubre 2026 (v1.9.0)

Revisión completa de frontend (`src/`), backend Rust (`src-tauri/`) y configuración.
Severidad: **A** alta (pérdida de datos, seguridad, datos incorrectos) · **M** media · **B** baja.
Columna *Estado*: `PR1`…`PR4` = corregido en esa fase · `backlog` = pendiente.

Las referencias `archivo:línea` corresponden a la versión 1.9.0 (commit `fb337961`).

---

## 1. Persistencia e integridad de datos

| # | Sev | Ubicación | Hallazgo | Estado |
|---|---|---|---|---|
| 1 | A | `store.js:16` | `flushWrite` se traga cualquier error de guardado (`.catch(() => {})`); los cambios se pierden sin aviso. | PR1 |
| 2 | A | `store.js:24-33` | `getItem` cae a `localStorage` ante cualquier error (`decrypt_failed`, `invalid_utf8`…); la app arranca vacía y el siguiente guardado sobrescribe el fichero real. | PR1 |
| 3 | A | `main.rs:92,95` | `save_data` usa `fs::write` directo (no atómico). Un corte deja el JSON truncado. Además borra el `.json` antes de escribir el `.enc`. | PR1 |
| 4 | M | `store.js:57-59` | El flush en `beforeunload` no espera al `invoke`; se pueden perder los últimos 300 ms. | backlog |
| 5 | M | `SettingsView.jsx:1160`, `App.jsx:359` | `encryption_lock` se ejecuta antes de vaciar la cola de escritura → la escritura falla con `not_unlocked` (silenciado). | PR1 |
| 6 | M | `store.js:1678` | Todo el store se serializa en cada `set()` (incluye el logo en base64). | backlog |
| 7 | M | `store.js:1469-1608` | Restaurar/importar ignora `version` (sin migración), omite `personalEvents`/`patientSuggestions`/`syncAudit`, no limpia `_history`, mezcla tokens OAuth del backup. | backlog (tokens: PR1) |
| 8 | M | `store.js:698` | `addClient` registra undo `delete_client` → deshacer duplica el cliente. | PR1 |
| 9 | M | `store.js:705-736`, `ClientsView.jsx:55` | `deleteClient` no borra consultas/mediciones/planes/documentos, pero el diálogo dice que sí. | PR1 |
| 10 | B | `store.js:1452-1456` | Rotación de backups: borra el fichero más antiguo pero el manifiesto lo sigue listando. | backlog |
| 11 | B | `store.js:1130,1141,1181` | Límites de fecha con `toISOString()` (UTC) comparados con fechas locales. | PR3 |
| 12 | B | `store.js:1716-1736` | `onRehydrateStorage` muta el estado in situ; claves nuevas de `config` no llegan a usuarios existentes sin migración. | backlog |

## 2. Sincronización con Google Calendar

| # | Sev | Ubicación | Hallazgo | Estado |
|---|---|---|---|---|
| 13 | A | `google_calendar.rs:442…720`, `googleCalendarService.js:258-260` | Los errores se formatean como `(401 Unauthorized)`; el JS busca `(401)` → nunca refresca el token y reintenta 3 veces errores 4xx. | PR2 |
| 14 | A | `googleCalendarService.js:262-274` | El reintento tras refrescar usa el token antiguo capturado. | PR2 |
| 15 | A | `googleCalendarService.js:327,996-999,1034-1046,149` | Tras un push, `remoteUpdated` queda con el valor previo; el siguiente pull aplica `eventToConsultation`, que devuelve `programada` → **las citas completadas / no-show vuelven a programada**. | PR2 |
| 16 | A | `google_calendar.rs:155-176` | `build_event_body` ignora el estado: cancelar en local no llega a Google. | PR2 |
| 17 | M | `googleCalendarService.js:1007,1081` | La actualización por cancelación remota no se marca como operación de sync → bucle de push a un evento borrado. | PR2 |
| 18 | M | `google_calendar.rs:633-670` | El update usa PUT y borra asistentes, recordatorios, colorId… Eventos de día completo pasan a 60 min. | backlog |
| 19 | M | `googleCalendarService.js:1058-1073` | Una consulta borrada en local cuyo delete remoto falló se reimporta. | backlog |
| 20 | M | `googleCalendarService.js:955-961` | `conflictShadow` lee `start?.dateTime`, pero Rust devuelve `start_datetime`. | PR2 |
| 21 | M | `google_calendar.rs:252-312` | Listener OAuth: acepta solo la primera conexión, bloquea un worker 120 s, `localhost` vs `127.0.0.1`, carrera en `find_free_port`. | backlog |
| 22 | M | `google_calendar.rs` (todas las peticiones) | `reqwest::Client::new()` por llamada y sin timeout. | PR2 |
| 23 | M | `google_calendar.rs:709` | Borrar un evento ya inexistente (404/410) se trata como error. | PR2 |
| 24 | B | `googleCalendarService.js:924` | "Caso 1" empuja todas las consultas sin vincular del rango a cualquier calendario bidireccional, ignorando `defaultPushCalendarId`. | backlog |
| 25 | B | `googleCalendarService.js:302,345,397` | El guardado de tokens hace spread de un `googleCalendar` posiblemente obsoleto. | backlog |
| 26 | B | `google_calendar.rs:529-592` | Los eventos borrados se piden listando todo con `showDeleted` (sin `syncToken`). | backlog |
| 27 | B | — | `invalid_grant` en el refresh no marca la conexión como desconectada. | PR2 |
| 28 | M | `CalendarView.jsx:509-516` | El auto-sync solo corre mientras la vista Agenda está montada. | PR2 |

## 3. Seguridad y cifrado

| # | Sev | Ubicación | Hallazgo | Estado |
|---|---|---|---|---|
| 29 | A | `main.rs:401-406` | `encryption_setup` copia todos los datos **en claro** a `backup_pre_encryption/` y nunca los borra. | PR1 |
| 30 | A | `store.js:1689-1715` | `clientSecret`, `accessToken`, `refreshToken` de Google se guardan en `config` y viajan a backups y exportaciones. | PR1 |
| 31 | A | `store.js:1577-1595` | La importación ZIP escribe documentos en claro aunque el cifrado esté activo, y no valida los nombres de entrada. | PR1 |
| 32 | M | `tauri.conf.json:33` | Scope de fs `$HOME/**`: cualquier XSS podría leer/escribir todo el perfil. | PR1 |
| 33 | M | `main.rs:477-499` | Tras cambiar la contraseña queda `backup_pre_rekey/` descifrable con la contraseña antigua. | PR1 |
| 34 | M | `main.rs:413-418` | `encryption.json` se escribe antes de migrar; un fallo deja datos mitad cifrados. | PR1 |
| 35 | M | `main.rs:138-149` | `open_file` acepta cualquier ruta; con el scope por defecto de `shell.open` probablemente no abre ficheros locales; con cifrado abriría el `.enc`. | PR1 |
| 36 | B/M | `encryption.rs:81-110` | `zeroize` es dependencia pero no se usa; los bucles de borrado pueden optimizarse; sin AAD. Nonce aleatorio de 96 bits y Argon2id correctos. | backlog |
| 37 | B | `main.rs:74,122-136` | La clave `"encryption"` no está reservada en `save_data`/`delete_data`. | backlog |
| 38 | B | `main.rs:670-795` | `save_bytes_to_documents` decodifica antes de comprobar tamaño y no valida la firma PDF. | backlog |
| 39 | B | `tauri.conf.json:94`, `index.html:9-17` | CSP con hosts OAuth innecesarios; Google Fonts remotas (fuga de uso, rompe offline). | backlog |
| 40 | B | `vite.config.js:10,12` | Dev server en `0.0.0.0`; `envPrefix: 'TAURI_'`. | backlog |
| 41 | B | `tauri.conf.json:87` | Instalador sin firma de código (aviso de SmartScreen). | backlog |

## 4. Rendimiento

| # | Sev | Ubicación | Hallazgo | Estado |
|---|---|---|---|---|
| 42 | M | `main.rs` | Comandos síncronos lentos (Argon2, SMTP, migraciones, lectura de documentos) corren en el hilo principal y congelan la UI. | PR1 |
| 43 | M | `main.rs:721-743` | Documentos de hasta 50 MB viajan en base64 por IPC. | backlog |
| 44 | B | `googleCalendarService.js:741,766…` | La sync hace N `set()` separados; agrupar. | backlog |
| 45 | M | `ClientDetailView.jsx:26-30`, `ClientDocuments.jsx:36` | Selectores Zustand que devuelven arrays nuevos → re-render en cualquier cambio del store. | backlog |
| 46 | M | `CommandPalette.jsx`, `CalendarView.jsx`, `Invoices.jsx`… | `.find()` dentro de bucles (O(n·m)) en cada render/pulsación. | backlog |
| 47 | M | `CalendarView.jsx:518-541` | `weekStart`/`monthStart` nuevos en cada render invalidan los `useMemo`. | backlog |
| 48 | M | `SettingsView.jsx`, `App.jsx:266` | `updateConfig` en cada pulsación + `AppContent` suscrito a todo `config` → re-render de toda la app. | backlog |

## 5. Frontend — errores funcionales

| # | Sev | Ubicación | Hallazgo | Estado |
|---|---|---|---|---|
| 49 | A | `styles.css:58-106` | Modo oscuro: solo remapea `sand`/`terra` (4 usos); `sage` (862) y `wellness` (220) quedan en claro → texto ilegible. | PR3 |
| 50 | A | `i18n.js:1242` | `useT()` sin fallback por clave: en inglés faltan 79 claves usadas → etiquetas vacías. | PR3 |
| 51 | A | `MeasurementChart.jsx:38`, `SettingsView.jsx:78,1420,1443,1457` | Componentes definidos dentro del render → los inputs pierden el foco en cada tecla / el color picker no se puede arrastrar. | PR3 |
| 52 | A | `NutritionPlanEditor.jsx:563`, `SendEmailModal.jsx:113` | "Enviar plan" envía el email sin el PDF. | PR3 |
| 53 | A | `Invoices.jsx:51-52,105` | Los totales incluyen facturas anuladas. | PR3 |
| 54 | M | `PatientSuggestionsInbox.jsx:386` | `confirm(title, msg)` con dos argumentos; el detalle nunca se muestra. | PR3 |
| 55 | M | `ConsultationModal.jsx:157` | `clients.sort()` muta el array del store. | PR3 |
| 56 | M | `ConsultationModal.jsx:87` | Guardar sobrescribe con el snapshot del formulario (pierde cambios de sync concurrentes). | backlog |
| 57 | M | `ClientDetailView.jsx:41` | `onBack()` llamado durante el render. | PR3 |
| 58 | M | `Dashboard.jsx:200` | Lee `c.localizacion` en vez de `c.locationId`. | PR3 |
| 59 | M | `Dashboard.jsx:26,234` | Usa `no_asistio`; el resto de la app usa `no_show`. | PR3 |
| 60 | M | `CalendarView.jsx:80,106` | La vista semanal solo pinta 8–20 h; citas fuera de rango invisibles. | PR3 |
| 61 | M | `CalendarView.jsx:562` | `setMonth(+1)` salta un mes los días 29–31. | PR3 |
| 62 | M | `CalendarView.jsx:481-494` | El reset de agenda cuenta solo las visibles pero borra todas. | backlog |
| 63 | M | `SendEmailModal.jsx:48-61,291` | En modo documento se puede enviar antes de que cargue el adjunto. | backlog |
| 64 | M | `InvoiceModal.jsx:154-208` | Guardado async sin estado "ocupado": doble clic = factura duplicada. | PR3 |
| 65 | M | `MeasurementChart.jsx:168-170` | La pestaña "Perímetros" grafica el peso. | backlog |
| 66 | M | `NutritionPlanEditor.jsx:25,30` | `bg-coral-400` no existe (barra de hidratos invisible). | PR3 |
| 67 | M | `NutritionPlanEditor.jsx:485-489` | Descarga del PDF con `<a download>` + revoke inmediato: no fiable en Tauri. | PR3 |
| 68 | M | `UI.jsx:55,72-75` | Cada toast tiene temporizador fijo de 4 s; ignora duraciones personalizadas. | backlog |
| 69 | M | `App.jsx:416` | Ctrl+Shift+Z (rehacer) nunca se dispara (`e.key === 'Z'`). | PR3 |
| 70 | M | `App.jsx:555` | `ErrorBoundary key={currentView}` desmonta el cargador: parpadeo "en construcción" al navegar. | backlog |
| 71 | M | `ClientsView.jsx:88-95` | `pl-9` se aplica al wrapper: el icono de búsqueda tapa el texto. | backlog |
| 72 | M | `ClientDocuments.jsx:104-106` | Deshacer el borrado de un documento restaura metadatos de un fichero ya eliminado. | backlog |
| 73 | M | `SettingsView.jsx:555-563` | Si falla la carga de calendarios, "Cargando calendarios..." para siempre. | backlog |
| 74 | M | `CommandPalette.jsx:7-9` | `highlight()` revienta con etiquetas `undefined`. | PR3 |
| 75 | M | `CommandPalette.jsx:31-39` | Errores de `syncAll` sin capturar. | backlog |
| 76 | M | varios | Los errores de `invoke` son strings y se muestran como `e.message` → "undefined". | PR3 |
| 77 | M | `tailwind.config.js` | Sin `darkMode`: las clases `dark:` siguen al SO, no al tema de la app. | PR3 |
| 78 | M | `MeasurementChart.jsx:12`, `DocumentMetadataModal.jsx:36` | Fechas con `toISOString().slice(0,10)` (UTC) → "ayer" de 0 a 2 h. | PR3 |
| 79 | M | `Dashboard.jsx:57-66` | "Hace -3 días" para fechas futuras. | PR3 |
| 80 | B | `ConsultationModal.jsx:176` | `duracion` se guarda como string. | PR3 |
| 81 | B | `SettingsView.jsx:383,1811` | `parseInt('')` guarda `NaN`. | backlog |
| 82 | B | `ServicesView.jsx:24` | Un precio de 0 no pasa la validación. | backlog |
| 83 | B | `Dashboard.jsx:362`, `CommandPalette.jsx:180-185` | "Nuevo cliente" / seleccionar un elemento solo navega, no abre el elemento. | backlog |
| 84 | B | `App.jsx:32,117` | Título de "Novedades" con versión fija; el banner de actualización se solapa con los toasts. | PR4 (versión) |
| 85 | M | `whatsappService.js:42` | `window.open` en Tauri 1 no abre el navegador de forma fiable. | PR4 |
| 86 | M | `whatsappService.js:21-31` | Un teléfono guardado como `+34 6…` acaba como `34346…`. | PR4 |
| 87 | M | `ConsultationsView.jsx:82`, `Dashboard.jsx:168`, `ClientDetailView.jsx:55` | El recordatorio WhatsApp marca `lastWhatsappReminder` con `updateConsultation`, que cambia `localUpdatedAt` y fuerza un push a Google. | PR4 |
| 88 | B | `emailService.js:55` | `replaceAll` interpreta `$&`/`$1` en datos del cliente. | PR4 |
| 89 | B | `emailService.js:307-310` | `openMailClient` devuelve `success:true` aunque falle. | backlog |
| 90 | M | `main.rs:256-260`, `SettingsView.jsx:335` | La UI nunca fija `smtp.secure` → siempre STARTTLS; servidores en 465 fallan. | backlog |

## 6. i18n

- ~250 de 461 claves ES nunca se usan: hay grupos enteros traducidos (`inbox_*`, `gcal_*`, `smtp_*`, `dashboard_*`…) mientras los componentes siguen con texto en español fijo (`PatientSuggestionsInbox`, `Dashboard`, `CalendarView`, `SettingsView`, `App.jsx`, `UI.jsx`). **backlog**
- Claves usadas que no existen: `search_placeholder`, `settings_personal`. **PR3**
- Claves usadas que faltan en CA: `consultation_status`, `consultation_measurement`, `settings_email`, `settings_appearance`. **PR3**
- Fechas con `es-ES` y nombres de mes/día fijos (`Dashboard.jsx:20,41`, `CalendarView.jsx:11-12`…). **backlog**

## 7. Accesibilidad (todo backlog)

- `Modal`/`ConfirmModal` (`UI.jsx:158-192,334-357`): sin Escape, sin `role="dialog"`/`aria-modal`, sin trampa de foco.
- Etiquetas no vinculadas a sus inputs (`htmlFor`/`id`) en `UI.jsx:266-314`.
- `<div onClick>` sin soporte de teclado (`CalendarView`, `ClientsView:142`, `UI.jsx:325`).
- `text-sage-400` sobre blanco ≈ 2,3:1 de contraste (no cumple AA).
- Botones solo con icono sin `aria-label` (`ClientsView`, `Invoices`, `NutritionPlanEditor`, `ServicesView`, `CalendarView`, `SettingsView`, `UI.jsx`).
- Pestañas sin `role="tablist"`; interruptor sin `role="switch"`.

## 8. Código muerto

- `ConsultationsView.jsx` completo (no se importa). **PR3**
- `SettingsView.jsx`: `InlineList`, `adding`, import dinámico redundante. **PR3** (parcial)
- Store sin uso: `getClientPlans`, `getMonthRevenue`, `deletePersonalEvent`, `planFilters`, `invoiceFilters`, `exportDataToJSON`/`importDataFromJSON`, `isLoading`. **backlog**
- Ramas muertas: `store.js:720-722`, `store.js:420-424`, `main.rs` (`removed_any`, `enc_path`), `google_calendar.rs:214`. **backlog**
- Imports sin usar en `App.jsx`, `CalendarView.jsx`, `ClientDetailView.jsx`, `ClientModal.jsx`, `Dashboard.jsx`, `SettingsView.jsx`. **PR3**
- CSS sin uso: `.invoice-preview-modern`, `.design-preview-container`, `.input-error`, `.input-success`, `.toast-exit`, `.animate-*`, `.print-area` (→ `@media print` imprime en blanco). Keyframes duplicados con `tailwind.config.js`. **backlog**
- Clases inexistentes: `rounded-card`, `border-sage-150`, `border-l-coral-400`, `animate-in slide-in-from-bottom`. **backlog**
- `vite.config.js:19` `optimizeDeps: ['pdfjs-dist']` (paquete no instalado), `public/pdf.worker.min.mjs`, scripts `scripts/fix_*`, fichero suelto `Usersjpolo.claudeplans…md` en la raíz. **PR3** (vite) / backlog

## 9. Dependencias, tests y build

- Sin tests, sin ESLint/Prettier, sin scripts `lint`/`test`; la CI solo compila con tags. **PR4** añade vitest (mínimo); lint en backlog.
- Rust: `tokio` sin uso; `zeroize` sin uso; `reqwest` 0.11 (updater) y 0.12 compilados a la vez. **PR1** (tokio) / backlog
- Versiones desalineadas: `Cargo.toml` 1.0.0 vs 1.9.0. **PR1**
- Sin `[profile.release]` (lto, strip). backlog
- Dependencias desactualizadas (Tauri 1 → 2, Vite 5 → 8, React 18 → 19, Zustand 4 → 5, Tailwind 3 → 4…). Migración a Tauri 2 recomendada a medio plazo (Tauri 1 sin evolución). backlog

## 10. Duplicación y tamaño

- `SettingsView.jsx` (2026 líneas) y `CalendarView.jsx` (806): dividir en subcomponentes. backlog
- Lógica duplicada: apertura de WhatsApp (3), handler de recordatorio (3 → **PR4**), `locationName` (5), etiquetas de objetivos (3, distintas), guardado de PDF de factura (2), comprobación de horas bloqueadas (2), mapas de colores de estado (5), conteo de sugerencias pendientes (5), handlers de sync + toast (3).
- Datos personales reales en placeholders (`SettingsView.jsx:388,1485,1521`) y en los valores por defecto de `config` (`store.js:611-616`). backlog
