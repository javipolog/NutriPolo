# 07 — Código muerto, deuda técnica y buenas prácticas  (auditoría nov-2026, v1.18.1)

## Resumen

El código está **más limpio de lo que cabía esperar** tras la auditoría de octubre: ningún fichero de `src/` está huérfano (todos cuelgan de `main.jsx`), no queda ningún `console.log`, no hay `innerHTML`/`eval`, las fechas locales se tratan bien y las dependencias de Rust y de npm se usan. `npm test` pasa (**13 ficheros / 232 tests en `src/`**, 3,7 s). La deuda está en cuatro sitios: **(1)** las releases salen sin ejecutar ni un test y se autoinstalan en el PC de Raquel; **(2)** lo más delicado (migraciones del store, importes de factura, plantillas de email, cifrado, copias de seguridad) casi no tiene tests; **(3)** los errores se tragan en producción (no hay ningún log), incluidas las copias de seguridad; **(4)** seis ficheros enormes, restos de **otro proyecto (PoloTrack / "Contabilidad Autónomo")** y ~115 claves de i18n muertas.

| Severidad | Nº |
|---|---|
| CRÍTICA | 0 |
| ALTA | 2 |
| MEDIA | 7 |
| BAJA | 7 |

Resultado de `npm test` tal cual (`vitest run`): **110 ficheros, 1.899 tests, todos OK, 12 s** — pero 97 de esos ficheros son copias de `.claude/worktrees/*` (ver hallazgo 3). Solo `src/`: 13 ficheros, 232 tests, OK. No he ejecutado `cargo test` (no permitido en mi brief); hay 15 tests Rust en `main.rs` y `google_calendar.rs`, ninguno en `encryption.rs`.

---

## Hallazgos

### [ALTA] Las releases se publican sin pasar ningún test ni compilación de comprobación
- **Ubicación:** `.github/workflows/release.yml:1-60` (único workflow), `src-tauri/tauri.conf.json` (`updater.endpoints` → `releases/latest/download/latest.json`).
- **Qué pasa:** el único workflow se dispara con `push` de tag `v*` y hace `npm ci` → importar catálogo Mercadona → `tauri-action` (compila y publica). No ejecuta `npm test`, ni `cargo test`, ni `cargo clippy`, ni comprueba que el tag coincida con la versión de `package.json`/`Cargo.toml`/`tauri.conf.json`/`App.jsx`. No hay CI en PRs ni en `main`. Como el updater de la app lee `releases/latest`, **lo que se publique se instala solo en el ordenador de Raquel**.
- **Escenario concreto:** un cambio en `migrateStore` rompe la migración v15→v16; se etiqueta `v1.18.2`; el workflow publica; al abrir la app Raquel, el store no migra (o migra mal) sobre sus datos reales. Ningún test lo detectó porque no se ejecutaron.
- **Impacto para Raquel:** una actualización defectuosa llega a su única copia de datos sin red de seguridad.
- **Propuesta:** (a) `.github/workflows/ci.yml` en `pull_request` y `push` a `main`: `npm ci`, `npm run lint` (cuando exista), `npm test`, `npm run build`, `cargo test --manifest-path src-tauri/Cargo.toml` (en `windows-latest`, con `rust-cache`); (b) en `release.yml`, un paso previo `npm test` + `cargo test` y un script que falle si `git tag` ≠ versión en los 4 sitios; (c) opcional: publicar la release como *draft* y promoverla a mano tras probar el MSI.
- **Esfuerzo:** S–M
- **Confianza:** confirmado

### [ALTA] Lo más crítico del producto no tiene tests (migraciones, importes, plantillas de email, cifrado, copias)
- **Ubicación:** `src/stores/store.js:327-998` (`migrateStore`, ~670 líneas, STORE_VERSION 16), `store.js:234` (`computeInvoiceTotals`), `src/services/emailService.js:27` (`resolveTemplate`), `src-tauri/src/encryption.rs` (117 líneas, 0 tests), `store.js:1937-2090` (backup/export/import ZIP), `src/services/pdfInvoiceGenerator.js` (815 líneas), `src/hooks/useBackgroundJobs.js` (`runEmailReminders`/`runReviewEmails`).
- **Qué pasa:** hoy hay buena cobertura de lógica pura reciente (planificación, recordatorios, reseñas, fuzzy matcher, sync GCal, energía, entrevista) pero:
  - `migrateStore` solo se ejercita **indirectamente** con un único backup v10 y otro v13 (`store.test.js:172-210`). Los pasos v1→v9 y v14→v16 no tienen test; el propio comentario de `store.js:325` admite que el paso v4 "ni siquiera se ejecutaba".
  - `computeInvoiceTotals` (base, IVA, IRPF en céntimos) y `updateInvoice` no tienen ningún test; la numeración sí (`store.test.js:144-170`).
  - `resolveTemplate` (sustituye `{{clientNom}}`, fechas, importes en emails a pacientes) sin test: es una función pura y es donde un dato de otra persona o un `{{variable}}` sin sustituir llega a un paciente.
  - `encryption.rs`: nada prueba el ida y vuelta AES-256-GCM/Argon2id, contraseña incorrecta, ni que `change_password` re-cifre todo.
  - Copias: rotación a 7, `manifest` ilegible, ida y vuelta ZIP con documentos, `validateDataIntegrity`, `restoredState`.
  - `pdfInvoiceGenerator`: ningún test de humo (el de planificaciones sí existe: `pdfPlanificacionGenerator.test.js`).
  - Los componentes (`src/components/**`) no tienen ningún test ni hay `jsdom`/Testing Library.
- **Escenario concreto:** al tocar `migrateStore` para la v17 se cambia el orden de dos pasos antiguos; una copia de seguridad v8 restaurada pierde las facturas y nadie lo ve hasta que Raquel la necesita.
- **Impacto para Raquel:** los fallos más caros (datos, importes, mensajes a pacientes) son justo los que no tienen red.
- **Propuesta — tests a añadir, por prioridad:**
  1. **`computeInvoiceTotals`** (+ `addInvoice`/`updateInvoice`): tabla de casos (21 %, 0 % exento, IRPF 7/15 %, cantidades decimales, 0 líneas, redondeo de medio céntimo, total = base + IVA − IRPF) y que el PDF muestre los mismos números. S.
  2. **`migrateStore` con "golden files"**: exportarla (`export function migrateStore`) y probar, por cada versión 1…15, un estado mínimo → v16; idempotencia; que no pierde claves desconocidas ni `clientDocuments`/`invoices`. M.
  3. **`resolveTemplate`**: todas las variables de `AVAILABLE_VARIABLES`, valores ausentes (`—`), idioma, y que no quede ningún `{{…}}` sin resolver. S.
  4. **Rust `encryption.rs`**: ida y vuelta, contraseña mala, nonce distinto por escritura, archivo truncado → error (no datos vacíos); y en `main.rs` path traversal de `copy_file_to_documents`/`read_file_as_base64`/`delete_document_file`, magic bytes PDF y límite 50 MB. M.
  5. **Copias**: `runAutoBackup` (rotación, `manifest` ilegible, fallo de `save_data`), ZIP export→import con documentos y conteos. M.
  6. **`runEmailReminders`/`runReviewEmails`** con `deliverEmailReminder` mockeado: no envía dos veces (`inFlight`), omite citas canceladas/reprogramadas entre medias, respeta horas de silencio. M.
  7. **`pdfInvoiceGenerator`**: humo (N líneas → varias páginas, nombre largo, sin fuentes → Helvetica, caracteres fuera de la fuente) como el test de planificaciones. M.
  8. **`validateDataIntegrity`** y `restoredState`. S.
  9. (Más adelante) Testing Library para 3 flujos: crear factura, crear cita con push, desbloqueo. L.
- **Esfuerzo:** L en conjunto (los puntos 1–3 son S–M y cubren lo más peligroso)
- **Confianza:** confirmado

### [MEDIA] `npm test` ejecuta también las copias de `.claude/worktrees` (8× más trabajo y falsa señal)
- **Ubicación:** `vite.config.js:1-21` (no hay clave `test`); `.git/info/exclude:7` ignora `.claude/worktrees/` solo para git, no para vitest.
- **Qué pasa:** vitest usa su `include` por defecto (`**/*.test.*`) y solo excluye `node_modules`, `dist`, `.git`…; recoge los 9 worktrees de Claude (`.claude/worktrees/app-audit-…`, `gcal-auto-assign-…`, etc.), cada uno con su propia copia de `src/`.
- **Escenario concreto:** `npm test` → `Test Files 110 passed (110), Tests 1899 passed` en 12 s en vez de 13/232 en 3,7 s. Si una rama experimental en un worktree tiene un test roto, el `npm test` de `main` falla (o, al revés, un worktree antiguo da verde engañoso). Además los tests se ejecutan contra código que no es el del árbol actual.
- **Impacto para Raquel:** indirecto; confunde a quien mantenga la app y enmascara si `main` está sano.
- **Propuesta:** en `vite.config.js` añadir `test: { include: ['src/**/*.test.js'], exclude: ['node_modules', 'dist', '.claude/**'] }` (o `dir: 'src'`). Sin ejecutar nada más.
- **Esfuerzo:** S
- **Confianza:** confirmado (ejecutado: 110 ficheros vs `--dir src` 13 ficheros)

### [MEDIA] Copia automática: solo al arrancar, fallos mudos y un `manifest` frágil
- **Ubicación:** `src/App.jsx:339-351` (única llamada a `runAutoBackup`), `src/stores/store.js:1937-1956`, `:1946`, `:1955`, `:1959-1964`.
- **Qué pasa:**
  1. `runAutoBackup` se llama **una vez** tras hidratar. El comentario `lastBackupDate === today` sugiere que debía repetirse, pero no hay intervalo ni gancho al medianoche. La app arranca con Windows y vive en la bandeja días (CLAUDE.md: "Segon pla"): tras el primer arranque, **no hay copia nueva hasta reiniciar**.
  2. Si el backup falla (disco lleno, vault bloqueado…) el `catch` solo hace `console.warn` **en desarrollo** (`:1955`); en producción es invisible. No hay aviso de "llevas N días sin copia".
  3. `load_data('backup-manifest').catch(() => null)` (`:1946`, `:1960`): si la lectura falla puntualmente se toma `[]`; se guarda un manifest nuevo `[hoy]` y **las 6 copias anteriores quedan en disco sin listar** (no se rotan ni se pueden restaurar desde la UI).
- **Escenario concreto:** Raquel arranca el lunes, la app queda en la bandeja; el jueves se corrompe algo; la última copia es del lunes (3 días), sin que nada se lo haya dicho. O: el manifest da un error transitorio un día → desde entonces la lista de copias muestra solo 1.
- **Impacto para Raquel:** su red de seguridad tiene huecos que no ve.
- **Propuesta:** llamar `runAutoBackup` desde `useBackgroundJobs` en cada tick (ya existe el `setInterval` de 5 min y `lastBackupDate` evita repetir); registrar el último fallo en el store (`lastBackupError`) y mostrarlo en Dashboard/Ajustes ("Última copia: hace N días"); si el manifest no se puede leer, reconstruirlo listando `backup-*` en vez de asumir `[]` (comando Rust de listado) o abortar la rotación sin tocar el manifest.
- **Esfuerzo:** S–M
- **Confianza:** confirmado (revisado: no hay más llamadas a `runAutoBackup`)

### [MEDIA] Copia manual ZIP: la importación calla los documentos que no pudo restaurar y la exportación da por buena una escritura fallida
- **Ubicación:** `src/stores/store.js:2050-2072` (restauración de documentos), `:2003-2020` (guardado del ZIP), `src/components/SettingsView.jsx:1827-1831`.
- **Qué pasa:** (a) al importar, cada documento va en un `try/catch` que solo hace `console.warn` en DEV; los que fallan o se saltan por nombre no seguro (`continue`) no se cuentan. La función devuelve `{ documentsRestored }` (solo éxitos), la UI muestra `backup_import_success` sin comparar con el total y no usa ese número. Los metadatos de `clientDocuments` sí se restauran → fichas con documentos "fantasma". (b) al exportar, `writeBinaryFile` está dentro de un `try` cuyo `catch` cae a una descarga vía `<a download>`, que en la webview de Tauri normalmente no hace nada, y la función devuelve igualmente `{ skipped }` → toast de éxito aunque el ZIP no exista (probable: falta comprobar el comportamiento exacto de la webview).
- **Escenario concreto:** disco casi lleno; se exporta el ZIP; falla la escritura; Raquel ve "Copia guardada" y lo tira todo confiando en ese archivo.
- **Impacto para Raquel:** una copia manual que cree buena y no lo es.
- **Propuesta:** devolver `{ total, restored, failed: [...] }` y mostrar aviso con los nombres fallidos; en export, quitar el fallback `<a download>` y propagar el error al toast; comprobar tamaño tras escribir.
- **Esfuerzo:** S
- **Confianza:** (a) confirmado, (b) probable

### [MEDIA] En producción no queda ningún rastro de los errores (19 sitios solo con `if (import.meta.env.DEV)`)
- **Ubicación:** `store.js:796,808,1955,2067`, `googleCalendarService.js:590,707,780,837,1198`, `ConsultationModal.jsx:92`, `InvoiceModal.jsx:209`, `Invoices.jsx:76`, `pdfInvoiceGenerator.js:166,310,784`, `pdfPlanGenerator.js:68,85`, `UI.jsx:114`, `SettingsView.jsx:1475`.
- **Qué pasa:** `console.error/warn` solo se ejecuta en desarrollo y no hay fichero de log. Además hay 4 `catch {}` vacíos (`App.jsx:378`, `SettingsView.jsx:1153`, `UI.jsx:129`, `store.js:41`) y ~20 `.catch(() => {})` (p. ej. `NutritionPlanEditor.jsx:513`/`PlanificacionEditor.jsx:846`: no se abre el PDF recién guardado y no se avisa). Casos con consecuencia real: `store.js:808` (si la escritura del refresh token en el llavero falla no se guarda y Google "se desconecta" al reiniciar sin explicación), `store.js:796` (lectura del llavero), los fallos de GCal por calendario.
- **Escenario concreto:** Raquel dice "el calendario dejó de sincronizar el martes"; no hay nada que consultar: el motivo solo habría aparecido en una consola que no existe en la versión instalada.
- **Impacto para Raquel:** soporte a ciegas; los fallos silenciosos se descubren tarde.
- **Propuesta:** un `logger` mínimo (`src/services/logger.js`) con búfer circular en memoria + volcado a `app_data/logs/app.log` (comando Rust `append_log`, rotado a ~1 MB, **sin datos de pacientes**: solo códigos/estado) y un botón "Copiar diagnóstico" en Ajustes (ya existe `lastError`/diagnóstico en `store.js:1889-1893`). Sustituir los `if (DEV) console.*` por `logger.warn`. Los `catch {}` que importan (llavero, guardado) deben avisar con toast.
- **Esfuerzo:** M
- **Confianza:** confirmado

### [MEDIA] Seis ficheros enormes y componentes de 300–700 líneas (propuesta de partición por fases)
- **Ubicación y tamaño:** `i18n.js` 4.071 · `store.js` 2.159 · `SettingsView.jsx` 2.140 · `googleCalendarService.js` 1.269 · `main.rs` 1.276 · `PlanificacionEditor.jsx` 988 · `pdfPlanificacionGenerator.js` 976 · `CalendarView.jsx` 968 · `pdfInvoiceGenerator.js` 815 · `Dashboard.jsx` 752 (este ya está bien dividido en sub-componentes).
- **Qué pasa:** `SettingsView.jsx` contiene `GoogleCalendarSection` de **~700 líneas en un solo componente** (`:425-1125`), `SecuritySection` 285, `InvoiceDesignSection` 300 y un componente raíz de 370; `store.js` mezcla almacenamiento, utilidades, migraciones (670 líneas), 14 "slices" y backups; `i18n.js` guarda 3 idiomas en un solo fichero.
- **Impacto para Raquel:** indirecto: cada cambio en un fichero así es más arriesgado y lento de revisar; sube la probabilidad de regresiones.
- **Propuesta (cada fase es un PR independiente, solo mover código + re-exportar, sin cambiar comportamiento; `npm test` y `npm run build` verdes entre fases):**
  - **Fase 0 (previa):** arreglar el `vitest` de los worktrees, añadir ESLint y los tests 1–3 de la lista. Borrar antes las 115 claves de i18n muertas (hallazgo 12) para no mover basura.
  - **Fase 1 — `i18n.js`** → `src/i18n/{es,ca,en}.js` + `src/i18n/index.js` (`useT`, `useLocale`, `plural`; `src/i18n.js` pasa a re-exportar). Es solo datos: riesgo nulo y quita 4.000 líneas del radar.
  - **Fase 2 — `store.js`** con barrel `store.js` que re-exporta (los 36 ficheros que importan el store no cambian): `stores/tauriStorage.js` (`:11-110`), `stores/format.js` (`formatCurrency/Date`, `localISODate`, `calcIMC`, `errMsg`: `:113-168`), `stores/invoices.js` (`computeInvoiceTotals` + numeración: `:232-280`, con tests), **`stores/migrations.js`** (`migrateStore`, `:301-998`, pura, ahora testeable), `stores/calendarFilters.js` (`:170-230`). Después pasar a slices de Zustand (`createClientsSlice`, `createInvoicesSlice`, `createPatientSuggestionsSlice` — `:1310-1490`, 300 líneas —, `createSyncAuditSlice`, `createBackupSlice`) combinadas en el mismo `create(persist(...))`. Cuidado: el orden de `partialize`/`merge` y `migrate` debe quedar idéntico.
  - **Fase 3 — `SettingsView.jsx`** → mover cada sección a `components/settings/` (ya existe con `RemindersSection`, `ReviewRequestsSection`, `SettingsFields`): `AgendaSection.jsx` (Locations/Types/BlockedHours, `:20-277`), `SmtpSection.jsx` (`:278-424`), `GoogleCalendarSection.jsx` (partir en `GoogleConnectionCard`, `CalendarsList`, `SyncStatus` + un hook `useGoogleCalendarSettings`), `SecuritySection.jsx` (`:1126-1411`), `InvoiceDesignSection.jsx` (+ `InvoiceDesignPreview`), `BackupSection.jsx` (hoy en el componente raíz). Objetivo: `SettingsView.jsx` < 300 líneas.
  - **Fase 4 — `CalendarView.jsx`**: helpers de fecha (`:13-60`) → `services/calendarDates.js` reutilizando `localISODate` (hallazgo 9); `layoutLanes` (`:119`) → puro con test; `WeekView` (240 l.), `MonthView`, `ListView` → `components/calendar/`.
  - **Fase 5 — `PlanificacionEditor.jsx`**: `OptionSectionEditor`, `CantidadesEditor`, `MenuEditor`, `ProductsEditor`, `GeneralEditor` (`:92-738`) → `components/plan/editor/`; queda el contenedor (`:739-988`).
  - **Fase 6 — PDFs**: extraer `services/pdf/common.js` (`hex/hexToRgb`, `embedFonts`+fallback, `makeSanitizer`, `wrapText`, `dataUrlBytes`, `embedImage`, `drawContained`, `roundedRectPath`, `addLink`) usado por los tres generadores; separar en `pdfPlanificacionGenerator` constantes de maqueta (`C`, `T`, `L`), portada, secciones y menú; `splitQuantity/glueUnits` a `services/planificacionText.js`.
  - **Fase 7 (opcional):** `googleCalendarService.js` en `gcal/{errors,mapping,push,pull,matching}.js`; `main.rs` en módulos Rust (`data.rs`, `email.rs`, `secrets.rs`, `documents.rs`, `recipes.rs`, `tray.rs`; `encryption.rs` y `google_calendar.rs` ya lo son). Es lo menos urgente: ambos tienen tests y se leen por secciones.
- **Esfuerzo:** L en total (cada fase S–M)
- **Confianza:** confirmado

### [MEDIA] Sin ESLint ni Prettier (y quedan `eslint-disable` de una herramienta que no existe)
- **Ubicación:** `package.json` (sin `lint`, sin config), `CalendarView.jsx:229`, `PdfPreview.jsx:70`, `RemindersPanel.jsx:114,205,338`, `SettingsView.jsx:312,470`.
- **Qué pasa:** hay 7 comentarios `eslint-disable` (con razón escrita y razonables), pero no hay ESLint: nada garantiza las dependencias de efectos, variables sin usar ni `catch` vacíos. Ya figuraba en la auditoría de oct-2026 ("lint en backlog"). Mis comprobaciones manuales no encontraron `exhaustive-deps` rotos (los `useEffect` revisados en `useBackgroundJobs`, `App.jsx`, `CalendarView`, `RemindersPanel`, `SettingsView` están bien razonados), así que el valor está en **evitar regresiones**, no en limpiar un desastre.
- **Impacto para Raquel:** indirecto (menos errores tontos en cada release).
- **Propuesta (config mínima):** `eslint` 9 con `eslint.config.js` plano + `eslint-plugin-react-hooks` + `eslint-plugin-react`:
  - `react-hooks/rules-of-hooks`: error; `react-hooks/exhaustive-deps`: warn (los 7 disable ya documentados se quedan).
  - `no-unused-vars` (`argsIgnorePattern: '^_'`, `caughtErrors: 'none'`), `no-undef`, `no-dupe-keys`, `no-unreachable`, `no-self-assign`, `no-fallthrough`, `no-constant-condition`, `no-empty` (`allowEmptyCatch: false`: cazaría los 4 `catch {}`), `eqeqeq: ['error','smart']`.
  - `react/jsx-key`, `react/jsx-no-undef`, `react/no-direct-mutation-state`; `no-await-in-loop` **desactivada** (se usa a propósito en `RemindersPanel`).
  - **Prettier: no reformatar 30.000 líneas de golpe** (ensucia el historial); como mucho `.editorconfig` y Prettier solo en ficheros nuevos.
  - Scripts: `"lint": "eslint src"`, `"check": "npm run lint && npm test && npm run build"`.
- **Esfuerzo:** S (config) + M (primer pase de avisos)
- **Confianza:** confirmado

### [MEDIA] Lógica duplicada: fechas, moneda, normalización de texto, IMC, utilidades de PDF
- **Ubicación y qué repite:**
  - **Quitar tildes/minúsculas ("fold")**: 7 copias — `components/UI.jsx:646`, `foodCatalog.js:94`, `fuzzyMatcher.js:29`, `pdfPlanificacionGenerator.js:137`, `planificacion.js:214`, `webRecipes.js:109`, `store.js:508`.
  - **Fecha dd/mm/aaaa**: `store.js:132 formatDate`, `store.js:138 formatDateShort` (**año de 2 dígitos**), `pdfInvoiceGenerator.js:46 formatDateShort` (**mismo nombre, año de 4 dígitos**), `pdfPlanGenerator.js:30 fmt`, `emailService.js:30 fmt`. Dos funciones con el mismo nombre y salida distinta es una trampa.
  - **Moneda es-ES/EUR**: `store.js:127 formatCurrency`, `pdfInvoiceGenerator.js:41 safeCurrency`, `emailService.js:35 fmtCurrency` (y `formatCurrency/formatDate` están fijados a `es-ES` aunque la app tiene `useLocale()`).
  - **ISO local**: `CalendarView.jsx:27 toISO` ≡ `store.js localISODate`; 22 usos sueltos de `padStart(2, '0')`.
  - **IMC**: `store.js:163 calcIMC` (redondea a 1 decimal) y `energia.js:52 imc` (sin redondear) — dos reglas para el mismo dato.
  - **PDF**: `wrapText` (`pdfInvoiceGenerator.js:52` y `pdfPlanGenerator.js:36`), `embedFonts` con fallback (invoice `:155`, planificación `:152`; el legacy lo hace en línea), `hexToRgb`/`hex`, y solo el generador de planificaciones tiene sanitizador de caracteres (`makeSanitizer`): el de facturas no.
  - **Estilos de campo**: la misma cadena de clases de `<input>` (`border border-sage-300 rounded-button … focus:ring-wellness-400/10`) aparece en `UI.jsx`, `fields.jsx:10 FIELD_CLASS`, `PlanificacionEditor.jsx:24 FIELD` y ~15 componentes; hay 60 `<input>`, 29 `<select>` y 10 `<textarea>` crudos frente a 76 usos de `Input/Select/Textarea` de `UI.jsx`.
- **Qué pasa / impacto:** hoy los resultados coinciden, pero cualquier cambio (formato de fecha en facturas, redondeo del IMC, nueva letra a plegar) hay que hacerlo en N sitios; el nombre repetido `formatDateShort` ya puede dar un año de 2 o de 4 cifras según el import.
- **Propuesta:** `src/services/text.js` (`fold`), `src/services/format.js` (`formatDate`, `formatDateShort`, `formatCurrency` con locale opcional, `localISODate`), un solo `calcIMC`; `services/pdf/common.js` (Fase 6); una clase `fieldClass` exportada desde `UI.jsx`. Con la Fase 2 de la partición esto sale casi gratis.
- **Esfuerzo:** M
- **Confianza:** confirmado

### [BAJA] La versión de la app está escrita a mano en 5 sitios
- **Ubicación:** `package.json:3`, `package-lock.json:3`, `src-tauri/Cargo.toml:3` (+ `Cargo.lock`), `src-tauri/tauri.conf.json:10`, `src/App.jsx:18` (`APP_VERSION`, que dispara el modal "Novedades").
- **Qué pasa:** hoy coinciden (1.18.1), pero cada release exige tocar 5 ficheros y ningún chequeo lo verifica. Si `App.jsx` se queda atrás, el modal no sale; si `tauri.conf.json` se queda atrás, el updater no detecta la versión.
- **Propuesta:** leer `version` de `package.json` con `define` de Vite (`__APP_VERSION__`) y añadir el chequeo de coherencia al CI (hallazgo 1).
- **Esfuerzo:** S
- **Confianza:** confirmado

### [BAJA] Restos de otro proyecto (PoloTrack / "Contabilidad Autónomo") en la raíz, `scripts/` y `docs/`
- **Ubicación y decisión recomendada** (todos comprobados leyendo el contenido y buscando referencias en el repo):

| Fichero | Qué es | Decisión |
|---|---|---|
| `PLAN_PRECISION_GASTOS.md` (28 KB) | Plan de "PoloTrack" (importación de facturas de gastos) | **Borrar** (otro proyecto) |
| `PLAN_REDESIGN_CLAUDE.md` (15 KB) | Rediseño visual "de PoloTrack" (paleta crema/terracota) | **Borrar** (otro proyecto) |
| `PLAN_MEJORAS_V7.md` (12 KB) | "Contabilidad Autónomo v6→v7" (gastos, Notion, impuestos 303/130) | **Borrar** (otro proyecto) |
| `docs/NOTION_SETUP.md` | Integración con Notion; no hay ninguna referencia a Notion en `src/` ni `src-tauri/` | **Borrar** |
| `scripts/fix_polish.cjs`, `fix_polish2.cjs`, `fix_polish3.cjs`, `fix_headings.py`, `fix_theme2.py` | Scripts de un solo uso con rutas `C:/Dev/PoloTrack/src/components/…` (editan `RulesManager.jsx`, `ExpensesView.jsx`, `TaxesView.jsx`… que no existen aquí) | **Borrar** (ejecutarlos por error tocaría otro proyecto) |
| `scripts/install.ps1` | "Instalador de Contabilidad Autónomo" | **Borrar** |
| `Usersjpolo.claudeplansagile-yawning-koala-agent-a5c427d955c2553c6.md` | Plan antiguo de la integración de Google Calendar (sube STORE_VERSION 1→2); ya implementado, hoy es la v16 | **Borrar** (o, si se quiere conservar, `docs/historico/`) |
| `dist/` (16 MB) | Salida de `vite build`; **ya en `.gitignore`**, no está en git | **Mantener** (local) |
| `scripts/catalog/`, `scripts/recetas/`, `scripts/food-catalog-photos.py` | Herramientas vigentes del catálogo y las recetas | **Mantener** |
| `docs/AUDITORIA-2026-10.md` | Auditoría anterior | **Mantener** (mover esta auditoría a `docs/` cuando se consolide) |
| `public/logo-polo.png` | Sin ninguna referencia en `src/`, `index.html` ni scripts | **Revisar y borrar** si Raquel no lo usa en otra parte |

- **Impacto para Raquel:** ninguno directo; confunde a quien mantenga el repo y alguien podría ejecutar por error un `fix_*`. `fix_polish*`/`fix_headings`/`fix_theme2` y el fichero `Usersjpolo…md` ya figuraban como backlog en oct-2026.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [BAJA] ~115 claves de i18n sin usar (×3 idiomas) y la entrevista sin traducir al inglés
- **Ubicación:** `src/i18n.js` (es `:9-1415`, ca `:1416-2796`, en `:2797-4043`).
- **Qué pasa:** de 1.331 claves ES, **115 no se referencian** ni literalmente ni por prefijo dinámico (`status_`, `pf_day_`, `reminders_state_`…, `${key}_hint` incluidos). Por grupos: `whats_new_*` de versiones anteriores (16: `gcal_patients`, `plan_pdf`, `interview`, `library`, `foods`, `reviews`, `reminders`, `reliability`; `App.jsx:42` solo usa `whats_new_canva_recipes_*`), el módulo de planes antiguo (`plan_kcal`, `plan_meal_*`, `plan_option_*`, `plan_observations`, `plan_activate/archive/generate_pdf/send_client`), `dashboard_*`/`calendar_banner_*`/`inbox_*`/`patient_inbox_*`/`match_status_*`/`consultation_modal_review_*` (huérfanas tras el PR5), `invoice_add_*`, `invoice_quantity/unit_price/service/notes`, `payment_bizum`, `mark_as_paid`, `total_paid/pending`, `settings_export/import/backup/font…`, `bmi_*`, `chart_*`, `measurement(s)_*`, `email_subject_*`, `error_*`, `nav_inbox`, `pf_pick_cell`… Era 158 en oct-2026 (**Pendiente parcial**). Además a EN le faltan 132 claves frente a ES (casi todas `ent_*` de la entrevista; cae a español por clave, aceptable) y a CA solo `pf_dish_free_text` (intencionado).
- **Propuesta:** script de 20 líneas (el de este informe se puede reaprovechar) que falle en CI si hay claves no usadas o usadas-no-definidas; borrar las 115 antes de la Fase 1 de partición.
- **Esfuerzo:** S
- **Confianza:** confirmado (búsqueda literal + prefijos dinámicos + `plural()`; revisadas a mano las dinámicas)

### [BAJA] Estado, config y código sin consumidor
- **Ubicación y detalle** (cada caso buscado en `src/`, `src-tauri/`, cadenas y `invoke('…')`):
  - `store.js:363, 1016-1018`: `config.appFont`, `appFontHeading`, `appFontMono` — la tipografía ya es Onest fija; ninguna UI las lee (y `settings_font` en i18n tampoco).
  - `store.js:2077, 2122` y `:969-987`: `emailTemplates` — se persiste y entra en las copias, **nadie lo lee ni lo escribe** fuera del store.
  - `store.js:1836, 1845, 2128`: `consultationFilters` / `setConsultationFilters` — persistidos, sin ningún consumidor.
  - `main.rs:520 secret_clear` — registrado (`:1246`) y documentado en CLAUDE.md, pero el JS nunca lo llama (usa `secret_set(name, '')`, que ya borra la entrada, `main.rs:503-510`). De los 40 comandos registrados, 39 se invocan desde JS y todos los `invoke()` existen en Rust.
  - `energia.js:16 FORMULAS` (definido y no usado) y ~50 `export` que solo se usan dentro de su fichero (p. ej. `Toast`, `ConfirmModal`, `EMAIL_PROVIDERS`, `TRANSLATIONS`, `DATE_LOCALES`, `isHolidayCalendarLike`, `EMPTY_PLAN_LIBRARY`, `backupData`) — sin coste real; ESLint no los marca.
  - Plan antiguo por àpats: `NutritionPlanEditor.jsx` (`LegacyPlanEditorModal`, `:155-388`) + `pdfPlanGenerator.js` (338 líneas) ≈ 600 líneas solo para planes sin `formato`. Se mantienen por decisión de producto (CLAUDE.md), no se pueden crear nuevos; **mantener** hasta que Raquel confirme que no le quedan planes antiguos que editar y luego migrar/convertir a planificación y retirar.
  - Resueltos desde oct-2026 (no repetir): `ConsultationsView.jsx`, `getClientPlans`, `getMonthRevenue`, `planFilters`, `invoiceFilters`, `exportDataToJSON`/`importDataFromJSON`, `isLoading`, `InlineList`, el CSS muerto (`.invoice-preview-modern`, `.print-area`…), las clases inexistentes (`rounded-card`, `border-sage-150`…), `optimizeDeps` de pdfjs, `tokio`.
  - CSS: `animate-fadeInUp` y `animate-shake` definidos en `styles.css:300+` sin uso.
- **Propuesta:** quitar `appFont*`, `emailTemplates`, `consultationFilters` con una migración v17 que los borre del estado persistido; quitar `secret_clear` o usarlo en `SettingsView` al desconectar Google; borrar `FORMULAS`.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [BAJA] Documentación desfasada (`CLAUDE.md` y sobre todo `README.md`)
- **README.md** (última edición abr-2026, 5,9 KB):
  - `Version: 1.0.0` (real 1.18.1).
  - Árbol de ficheros: lista `ConsultationsView.jsx` (borrado) y `whatsappService.js` (no existe); omite `encryption.rs`, `hooks/`, `components/client|plan|settings`, `clientOptions.js` y la mitad de `services/` (reminderService, planificacion*, fuzzyMatcher, webRecipes, foodCatalog…).
  - Versiones: Zustand 4.4 / React 18.2 / Tailwind 3.3 (reales: `package.json` 4.5.5 / 18.3.1 / 3.4.14; la lista de dependencias omite jszip, pdfjs-dist, @fontsource/onest, vitest).
  - "Bilingüe es/ca" (la app tiene ES/CA/EN); la lista de características no menciona recordatorios, reseñas, planificaciones, entrevista, catálogo de alimentos, cifrado, segundo plano ni la bandeja de pacientes.
  - Comandos: no menciona `npm test`.
- **CLAUDE.md** (nov-2026, en general muy al día; versión 1.18.1 ✓, STORE_VERSION 16 ✓, los 40 comandos IPC ✓, límite 50 MB ✓, atajos Ctrl+1…7 ✓):
  - El árbol sigue listando `ConsultationsView.jsx` (`CLAUDE.md:54`; eliminado en PR3).
  - Faltan en el árbol: `src/clientOptions.js`, `hooks/useChartTheme.js`, `hooks/useFoodLibrary.js`, `components/settings/SettingsFields.jsx`, `services/planificacion.fixture.js` y los ficheros `*.test.js`.
  - Versiones de pila: "Zustand 4.4, React 18.2, Tailwind 3.3" (reales 4.5.5, 18.3.1, 3.4.14); crate `tauri` resuelto 1.8.3 (lock) vs "1.5"; `reqwest` figura como 0.12 pero hay también 0.11.27 transitiva (updater).
  - No documenta: cómo se hace una release (los 5 sitios de versión), `cargo test`, que `npm test` debe excluir worktrees, el flujo de tag → GitHub Release → updater.
  - Dice "pdf-lib + fontkit… tots amb Onest": el generador legacy y el de facturas caen a Helvetica si no cargan las fuentes (comportamiento correcto, pero no documentado).
- **Propuesta:** reescribir README en 30 líneas (qué es, cómo arrancar, cómo testear, cómo hacer release, enlace a CLAUDE.md) en vez de mantener un árbol que se desfasa; en CLAUDE.md quitar `ConsultationsView`, añadir los 5–6 ficheros que faltan y una sección "Release".
- **Esfuerzo:** S
- **Confianza:** confirmado

### [BAJA] Dependencias: tipos sin uso, `reqwest` duplicado, Tauri 1 sin evolución
- **Ubicación:** `package.json` (`@types/react`, `@types/react-dom`), `src-tauri/Cargo.lock:3654,3696`.
- **Qué pasa:** (a) `@types/react*` no sirven de nada sin TypeScript ni `jsconfig.json`, salvo autocompletado del editor; (b) `reqwest` 0.11.27 (arrastrada por el updater de Tauri 1) y 0.12.28 (la nuestra) se compilan a la vez — **Pendiente de oct-2026**; (c) Tauri 1.x, React 18, Vite 5, Zustand 4, Tailwind 3 siguen vigentes en el repo pero con versiones nuevas disponibles — **Pendiente de oct-2026** (migración a Tauri 2 recomendada a medio plazo). Dependencias de npm y de Rust: **todas se usan** (comprobado por import/`use`: `jszip` en `store.js`, `pdfjs-dist` en `PdfPreview.jsx`, `urlencoding`/`sha2` en `google_calendar.rs`, `zeroize` en `encryption.rs`/`main.rs`, `auto-launch`, `keyring`, `lettre`, etc.). `[profile.release]` ya tiene LTO/strip (resuelto).
- **Propuesta:** quitar `@types/*` (o añadir `jsconfig.json` con `checkJs` si se quiere tipado ligero); planificar Tauri 2 como proyecto aparte.
- **Esfuerzo:** S (a) / L (c)
- **Confianza:** confirmado

### [BAJA] Detalles menores de calidad
- `MeasurementChart.jsx:60,63,65`: ticks de ejes a 10 px (CLAUDE.md: "res per sota d'11 px").
- `InvoiceModal.jsx:429`: `unbilledConsultations.sort(...)` ordena **en sitio** el array memoizado de `useMemo` (`:70`); inocuo (la ordenación es idempotente) pero es una mutación de un valor memoizado; usar `[...x].sort` o ordenar dentro del `useMemo`.
- 8 `key={i}` por índice (`App.jsx:165`, `Dashboard.jsx:85,326,541`, `SettingsView.jsx:229,1504,1574,1646`): todas en listas estáticas o de solo lectura; sin riesgo real. Las listas editables (líneas de factura, platos, productos) usan ids estables.
- `useEffect(…, [closeToTray, t])` en `App.jsx:312-316`: `t` cambia de identidad cuando cambia el idioma (es un objeto resuelto una vez por idioma), así que solo se re-ejecuta al cambiar de idioma; correcto.
- `index.html`/`.claude/launch.json` correctos; no hay `console.log`, `debugger`, `TODO`/`FIXME` en `src/`.
- **Esfuerzo:** S
- **Confianza:** confirmado

---

## Pendientes de la auditoría de oct-2026
(sección 8–10 de `docs/AUDITORIA-2026-10.md`, comprobados hoy)
- **Siguen abiertos:** claves i18n sin usar (158 → **115**, ver hallazgo); `SettingsView.jsx` y `CalendarView.jsx` sin dividir (ahora 2.140 y 968 líneas, **han crecido**); `scripts/fix_*` y fichero `Usersjpolo…md` sin borrar; sin ESLint/Prettier; `reqwest` 0.11+0.12; migración a Tauri 2/React 19/Vite…; lógica duplicada de formateo/normalización (no listada entonces para fechas/moneda/`fold`).
- **Resueltos y confirmados:** `ConsultationsView.jsx` borrado, store sin uso (`getClientPlans`, `getMonthRevenue`, `planFilters`, `invoiceFilters`, `exportDataToJSON`…), CSS muerto y clases inexistentes, `optimizeDeps` de pdfjs (y `public/pdf.worker.min.mjs` ya se usa en `PdfPreview.jsx`), `tokio`, `zeroize` (ahora usado), versión de `Cargo.toml` alineada, `[profile.release]`, test mínimo con vitest.
- **No he podido comprobar** (fuera de mi brief): "ramas muertas" de `main.rs` (`removed_any`, `enc_path` — `enc_path` sigue y se usa en `main.rs:137-140`; `removed_any` ya no aparece) y `google_calendar.rs:214`; los datos personales por defecto de `config` (`store.js:1006-1012`, hoy `nombre`/`email` de Raquel como valores iniciales) → ver "Fuera de mi área".

## Lo que está bien (breve, para no tocarlo)
- **Cero ficheros huérfanos** en `src/` (grafo de imports desde `main.jsx`); todos los assets de `public/alimentos/` (46) tienen su alimento y viceversa; `pdf.worker.min.mjs` e iconos referenciados.
- **IPC coherente**: 40 comandos registrados en `generate_handler!`, 39 usados desde JS, todos los `invoke()` apuntan a comandos que existen. Documentación de comandos en CLAUDE.md exacta.
- **Convenciones de CLAUDE.md respetadas**: ningún color por defecto de Tailwind (`red-*`…) ni hex en componentes (salvo el diseñador de facturas y un color de calendario), ni `console.log`, ni `innerHTML`/`eval`, ni fechas en UTC (`toISOString().slice(0,10)`: 0 casos).
- **`useBackgroundJobs.js`** es un buen modelo: refs para `toast`/`t`, `inFlight` contra envíos dobles, relectura del estado antes de enviar, `cancelled` en cada `await`.
- **Cobertura de lógica pura reciente** (planificación, recordatorios, reseñas, fuzzy matcher, sync GCal 669 líneas de test, energía, entrevista, teclado) y test de humo del PDF de planificaciones.
- **Rust**: dependencias todas usadas, `[profile.release]` con LTO + strip, tests en el OAuth, el mapeo de eventos y los paths de recetas.
- Los `eslint-disable` existentes (`CalendarView`, `PdfPreview`, `RemindersPanel`, `SettingsView`) tienen la razón escrita y son correctos.

## Fuera de mi área (notas para otras sesiones)
- **Seguridad:** `tauri.conf.json` concede `fs.createDir: true` y `path.all: true` aunque el JS no usa `createDir` (solo `appDataDir`/`join`); `get_smtp_password` devuelve la contraseña al webview y `SettingsView.jsx:300-310` la guarda en estado de React; `read_file_as_base64`/`open_file` y el scope `$APP/**`, `$APPDATA/**` merecen repaso de path traversal (sin tests Rust).
- **Facturación:** `pdfInvoiceGenerator.js` no tiene sanitizador de caracteres (el de planificaciones sí): un nombre de cliente con emoji o carácter fuera de Onest podría lanzar excepción al generar el PDF (sin comprobar); `formatDateShort` con dos comportamientos (ver duplicación).
- **Datos:** `beforeunload → flushAllPending` no se espera; el flujo de cierre de ventana sin bandeja depende de que `invoke` termine tras `beforeunload` (no comprobado); datos personales de Raquel como valores por defecto de `config` (`store.js:1006-1012`, pendiente de oct-2026).
- **Build/release:** `release.yml` descarga el catálogo de Mercadona en cada release (dependencia de red de terceros: ya aborta si salen <250 alimentos, bien) pero no fija versión ni hace caché.
