# 01 — Datos, persistencia e integridad  (auditoría nov-2026, v1.18.1)

## Resumen

La base es sólida: escritura atómica (`.tmp` + rename), bloqueo de escrituras si el fichero no se puede leer, reintentos con aviso, migraciones puras sobre lo leído del disco (se pueden repetir sin daño) y una sincronización con Google que vuelve a leer el estado antes de cada escritura. Los riesgos que quedan están en los **caminos de recuperación y en el deshacer**: deshacer el borrado de una factura duplica su número, restaurar o importar una copia no valida nada (un JSON equivocado lo vacía todo, sin copia previa), las facturas dependen de la ficha viva del cliente (si se borra, la factura se queda sin destinatario), y las copias automáticas solo se hacen al arrancar, cuando con la bandeja la app puede pasar días sin reiniciarse. También hay varias formas de perder la última edición o una planificación sin guardar al salir, con el bloqueo automático o al instalar una actualización.

`npm test`: **pasa** (110 ficheros, 1899 tests). Ojo: incluye las copias de `.claude/worktrees/`; los tests propios de `src/` son 13 ficheros y 232 tests, todos en verde (`npx vitest run --dir src`). Los hallazgos marcados como "confirmado (test)" los he reproducido con vitest en el scratchpad, fuera del repo.

| Severidad | Nº |
|---|---|
| CRÍTICA | 3 |
| ALTA | 8 |
| MEDIA | 7 |
| BAJA | 4 |
| **Total** | **22** |

## Hallazgos

### [CRÍTICA] Deshacer el borrado de una factura crea dos facturas con el mismo número
- **Ubicación:** `src/stores/store.js:1807-1816` (`deleteInvoice` apunta `delete_invoice` en el historial), `src/stores/store.js:1867` (`undo` la vuelve a insertar sin comprobar nada), `src/stores/store.js:1739-1756` (`generateInvoiceNumber` / `addInvoice` reutilizan el número libre).
- **Qué pasa:** solo se puede borrar la última factura de la serie y su número queda libre (`canDeleteInvoice`). `addInvoice` no vacía `_history`, así que la entrada `delete_invoice` sigue viva. Al deshacer se mete otra vez la factura borrada tal cual, sin mirar si su `numero` ya lo usa otra.
- **Escenario concreto:** NP-2026-001 y NP-2026-002 → se borra la 002 → se crea una factura nueva, que recibe NP-2026-002 → Ctrl+Z fuera de un campo → hay **dos NP-2026-002** (reproducido: `['NP-2026-001','NP-2026-002','NP-2026-002']`).
- **Impacto para Raquel:** numeración duplicada en la contabilidad, justo lo que la regla de "solo borrar la última" quería impedir. Hacienda exige numeración correlativa y única.
- **Propuesta:** al deshacer `delete_invoice`, no restaurar si otra factura ya tiene ese número (avisar), o vaciar las entradas `delete_invoice` del historial al crear una factura. Mejor aún: anular en vez de borrar también la última y quitar el deshacer de facturas.
- **Esfuerzo:** S
- **Confianza:** confirmado (test)

### [CRÍTICA] Restaurar o importar una copia no valida nada y no guarda una copia del estado actual
- **Ubicación:** `src/stores/store.js:960-964` (`backupData`), `src/stores/store.js:978-996` (`restoredState`), `src/stores/store.js:2023-2035` (importar `.json`), `src/stores/store.js:2045-2072` (ZIP), `src/stores/store.js:1966-1970` (copia automática); el mensaje de confirmación está en `src/i18n.js:438`.
- **Qué pasa:** `backupData` acepta cualquier objeto (`parsed.data || parsed.state || parsed`) y `restoredState` sustituye cada colección por `d.x || []`. No se comprueba que sea una copia de NutriPolo, no se enseña qué contiene (fecha, nº de clientes, facturas…), una versión **más nueva** que la app (`version > STORE_VERSION`) se acepta sin migrar ni avisar, y antes de sustituir no se guarda una copia de lo que hay. El aviso dice "Esta acción no se puede deshacer" (y es verdad: el historial se vacía).
- **Escenario concreto:** Raquel elige por error otro `.json` (p. ej. un `package.json` o una exportación de otra herramienta) o una copia parcial que solo trae `clients` → clientes, consultas, facturas, mediciones y planes quedan **vacíos** y se guardan en disco a los 300 ms (reproducido con `{ name, version, dependencies }` → 0 clientes y 0 facturas; y con una copia que solo trae clientes → 0 facturas).
- **Impacto para Raquel:** con un clic equivocado pierde todos los datos. Solo podría recuperarlos con una copia automática (si la hay y es reciente, ver el hallazgo siguiente sobre copias).
- **Propuesta:** (1) validar: exigir `version` entera, un `data` con las claves esperadas y arrays donde tocan, y rechazar versiones futuras; (2) antes de aplicar, guardar el estado actual como `backup-pre-restore-<fecha>` y ofrecerlo en la lista de copias; (3) mostrar un resumen ("copia del 03/11/2026: 214 clientes, 1.830 consultas, 96 facturas") en el diálogo de confirmación.
- **Esfuerzo:** M
- **Confianza:** confirmado (test)

### [CRÍTICA] Las facturas no guardan los datos del cliente: al borrarlo (o editarlo) la factura emitida cambia
- **Ubicación:** `src/stores/store.js:897-899` y `919-940` (`buildClientDeletion` conserva las facturas, pero con un `clienteId` que ya no existe), `src/components/Invoices.jsx:61-62` y `163-166`, `src/components/InvoiceModal.jsx:192`, `src/services/pdfInvoiceGenerator.js:375-427`, `src/stores/store.js:1920-1924` (la comprobación de integridad no mira el cliente de las facturas).
- **Qué pasa:** la factura solo guarda `clienteId`. El listado, la búsqueda y el PDF leen nombre, NIF, dirección, email y teléfono de la ficha **actual**. Al borrar el cliente (el diálogo dice "Las facturas se conservan", `src/i18n.js:1060`), la factura se queda sin destinatario: en la lista sale "—", el PDF se genera con "---" y sin NIF ni dirección, y ya no se encuentra buscando por nombre. Si se edita la dirección o el NIF del cliente, los PDF de facturas antiguas salen con los datos nuevos. `validateDataIntegrity` no avisa de facturas con cliente inexistente.
- **Escenario concreto:** factura NP-2026-031 a un paciente → meses después se borra su ficha (baja RGPD) → para una inspección se vuelve a descargar el PDF de NP-2026-031 → sale sin cliente.
- **Impacto para Raquel:** no puede volver a sacar una factura emitida tal como era, y la obligación de conservarla 4–6 años no se cumple de verdad.
- **Propuesta:** al crear o editar la factura, guardar una copia de los datos fiscales del cliente (`clienteSnapshot: { nombre, nif, calle, cp, ciudad, provincia, email }`) y de los del emisor, y usarla en el listado y el PDF. Migración: rellenarla con la ficha actual en las facturas que aún tienen cliente. Añadir "facturas sin cliente" a `validateDataIntegrity`. (Coordinar con 02-facturación.)
- **Esfuerzo:** M
- **Confianza:** confirmado (lectura)

### [ALTA] Las copias automáticas solo se hacen al arrancar: con la bandeja, días sin copia
- **Ubicación:** `src/App.jsx:339-351` (única llamada a `runAutoBackup`), `src/stores/store.js:1937-1956`; cerrar a la bandeja es el comportamiento por defecto (`store.js:1043`) y la app arranca con Windows (`main.rs:1147-1166`).
- **Qué pasa:** `runAutoBackup` se ejecuta una sola vez, al montar `AppContent` tras la hidratación. No hay temporizador. Si la app vive en la bandeja una o dos semanas (lo normal ahora), la copia más reciente es de ese último arranque.
- **Escenario concreto:** Raquel enciende el PC el lunes y no lo reinicia hasta el viernes de la semana siguiente → el jueves el fichero se corrompe → la copia más nueva es de hace 10 días.
- **Impacto para Raquel:** puede perder días de consultas, notas y facturas aunque crea que tiene copias diarias.
- **Propuesta:** comprobar la copia diaria también en `useBackgroundJobs` (cada tick, si `lastBackupDate !== todayISO()`). Plantearse además una copia "rodante" cada pocas horas y avisar si la última copia tiene más de N días.
- **Esfuerzo:** S
- **Confianza:** confirmado (lectura)

### [ALTA] Pantalla de error de carga: si falla la restauración, "Reintentar" arranca la app vacía
- **Ubicación:** `src/components/LoadErrorScreen.jsx:24-38`, `src/stores/store.js:1966-1970`, `src/App.jsx:339-351`.
- **Qué pasa:** `run()` primero mueve el fichero a cuarentena (`quarantine_data`) y quita el bloqueo (`clearLoadFailure`), y **después** intenta restaurar. Si la restauración falla (copia dañada, o la misma migración que falló al cargar también falla con las copias, que suelen ser de la misma versión), se muestra el error, pero el fichero original ya no está en su sitio y las escrituras ya no están bloqueadas. Al pulsar "Reintentar" (`reload`), `load_data` da `not_found` y la app arranca **vacía** como si fuera la primera vez. Encima hace la copia automática del día con ese estado vacío (y tira la más antigua). Lo mismo pasa con "Empezar con datos vacíos": si ya había una copia de hoy (de un arranque anterior), queda sustituida por una vacía, porque `lastBackupDate` está a `null`.
- **Escenario concreto:** el fichero principal no se puede leer → Raquel elige la copia de ayer → falla → pulsa Reintentar → app vacía, sin ningún aviso de que sus datos están en `nutripolo-storage.corrupt-<ts>.json`.
- **Impacto para Raquel:** cree que lo ha perdido todo y sigue trabajando encima de una base vacía. Recuperar los datos de la cuarentena necesita a alguien técnico.
- **Propuesta:** restaurar antes de mover a cuarentena (o volver a poner `loadFailure` si la restauración falla); que la copia automática no sobrescriba la del día cuando se viene de esta pantalla; avisar de que hay ficheros `*.corrupt-*` y ofrecer recuperarlos.
- **Esfuerzo:** S
- **Confianza:** confirmado (lectura)

### [ALTA] Salir con un guardado fallido pierde los cambios sin avisar
- **Ubicación:** `src/stores/store.js:46-52` (`flushWrite` se resuelve aunque falle), `src/App.jsx:679-681` (`tray-quit`), `src-tauri/src/main.rs:1138-1145` (salida forzada a los 5 s), `src/App.jsx:373-379` (bloqueo automático), `src/App.jsx:85-93` (instalar actualización), `src/i18n.js:877`.
- **Qué pasa:** cuando `save_data` falla (antivirus bloqueando el fichero, disco lleno, OneDrive…), el valor se queda en cola y se reintenta cada 5 s, con un aviso rojo que dice "No cierres la aplicación". Pero `flushAllPending()` se resuelve igual (el error se captura dentro), y "Salir" de la bandeja, cerrar sin bandeja, el bloqueo automático (`encryption_lock` + `reload`) o "Instalar actualización" siguen adelante y descartan lo que está en memoria. Con la ventana escondida en la bandeja, Raquel ni siquiera ve el aviso.
- **Escenario concreto:** el antivirus tiene bloqueado `nutripolo-storage.json` durante un análisis → se guardan notas de 3 consultas → Raquel sale desde la bandeja → al abrir de nuevo, esas notas no están. Si en ese rato se mandó un recordatorio por email, su estado `sent` tampoco se guarda y se volverá a mandar.
- **Impacto para Raquel:** pierde trabajo justo cuando el programa le ha dicho que se reintentaría.
- **Propuesta:** que `flushAllPending` devuelva si quedó algo sin guardar; en `tray-quit`, bloqueo y actualización, si quedó, mostrar la ventana y preguntar ("No se han podido guardar los últimos cambios: Reintentar / Exportar copia / Salir igualmente"). En Rust, alargar o quitar la salida forzada mientras el JS responde.
- **Esfuerzo:** M
- **Confianza:** confirmado (lectura)

### [ALTA] Una planificación (o un formulario) sin guardar se pierde con el bloqueo automático, al salir, con F5 o al actualizar
- **Ubicación:** `src/components/plan/PlanificacionEditor.jsx:760-810` (el estado solo vive en React; solo se pregunta al cerrar con el botón o Esc), `src/App.jsx:373-379` (el bloqueo automático hace `window.location.reload()`), `src/App.jsx:679-681`, `src/App.jsx:85-93`; lo mismo pasa con `ConsultationModal` / `InvoiceModal` / `ClientModal`.
- **Qué pasa:** el editor de planificaciones trabaja con una copia local y solo escribe al "Guardar" o con Ctrl+S. No hay borrador guardado ni aviso en `beforeunload`. El bloqueo por inactividad recarga la página sin mirar si hay editores abiertos, y "Salir" de la bandeja, F5 (WebView2 deja recargar) o instalar una actualización hacen lo mismo.
- **Escenario concreto:** bloqueo automático a 10 min → Raquel lleva 40 min con una dieta semanal, se levanta a atender una llamada → al volver, pantalla de desbloqueo y la planificación ha desaparecido.
- **Impacto para Raquel:** pierde el trabajo más largo que hace en la app, sin aviso.
- **Propuesta:** guardar un borrador del editor (`planDrafts[planId]`, o el propio plan con `estado: 'borrador'`) cada pocos segundos y ofrecer recuperarlo al abrir; antes de bloquear, salir o actualizar, preguntar si hay un editor con cambios (un registro global de "cambios sin guardar"), o pausar el bloqueo automático mientras haya uno.
- **Esfuerzo:** M
- **Confianza:** confirmado (lectura)

### [ALTA] Restaurar una copia antigua reutiliza números de factura ya emitidos y vuelve a mandar recordatorios
- **Ubicación:** `src/stores/store.js:978-996` (`restoredState` sustituye `invoices` y `consultations` enteros), `src/stores/store.js:1739-1747`, `src/hooks/useBackgroundJobs.js:29-53`.
- **Qué pasa:** al restaurar, las facturas emitidas después de la copia desaparecen y el contador (que sale de la lista) vuelve atrás. Las consultas recuperan el estado de recordatorios y reseñas de entonces, así que los emails mandados después vuelven a estar pendientes y el siguiente tick (5 min) los manda otra vez.
- **Escenario concreto:** a las 10:00 Raquel emite NP-2026-045 y la manda al paciente; a las 12:00 restaura la copia de las 8:00 → la siguiente factura vuelve a ser NP-2026-045 (dos facturas reales distintas con el mismo número), y los recordatorios de mañana, enviados a las 9:00, se mandan de nuevo (reproducido: `reminders` vuelve a `undefined`).
- **Impacto para Raquel:** numeración fiscal duplicada y pacientes que reciben el mismo mensaje dos veces.
- **Propuesta:** al restaurar, conservar las facturas actuales que no estén en la copia (o al menos avisar: "hay 3 facturas posteriores a la copia: NP-2026-045…") y mantener el estado `reminders` / `reviewRequest` de la consulta actual si es más reciente (combinar por `id`, como con `BOOKKEEPING_FIELDS`).
- **Esfuerzo:** M
- **Confianza:** confirmado (test)

### [ALTA] Cambiar la contraseña mientras la app guarda puede dejar el fichero principal cifrado con la clave antigua
- **Ubicación:** `src-tauri/src/main.rs:632-685` (`encryption_change_password`, comando `async` en otro hilo), `src-tauri/src/main.rs:105-128` (`save_data`, síncrono en el hilo principal), `src-tauri/src/main.rs:809-821` (`rekey_file`), `src/components/SettingsView.jsx:1194-1199` (no hace `flushAllPending` antes).
- **Qué pasa:** en Tauri 1 los comandos `async` van en un hilo aparte y `save_data` en el hilo principal: pueden coincidir. Durante el recifrado la clave en memoria sigue siendo la antigua. Si `save_data` escribe `nutripolo-storage.enc` (una edición en cola, la sincronización de fondo, un recordatorio…) después de que `rekey_file` lo haya procesado, el fichero queda cifrado con la clave **antigua**. Y si escribe entre la lectura y el rename de `rekey_file`, esa edición se pierde. Al final `backup_pre_rekey/` se borra.
- **Escenario concreto:** Raquel cambia la contraseña con muchos documentos (el recifrado tarda varios segundos) mientras la sincronización de fondo actualiza consultas → al día siguiente, "No se pudieron leer tus datos" (`decrypt_failed`). La copia automática (recifrada bien) la salva, pero pierde lo que hubiera desde esa copia.
- **Impacto para Raquel:** pantalla de datos ilegibles tras algo tan normal como cambiar la contraseña.
- **Propuesta:** un `Mutex` global de E/S de datos en Rust que compartan `save_data`, `load_data`, `encryption_setup`, `encryption_change_password` y `rekey`; en el JS, `flushAllPending()` antes y pausar la cola de escritura mientras dura. Comprobar después que todos los `.enc` se descifran con la clave nueva antes de borrar `backup_pre_rekey`.
- **Esfuerzo:** M
- **Confianza:** probable (es una carrera de tiempos; falta reproducirla con la app en marcha)

### [ALTA] "Backup exportado correctamente" aunque se cancele el diálogo o falle la escritura
- **Ubicación:** `src/stores/store.js:2003-2020`, `src/components/SettingsView.jsx:1806-1812`.
- **Qué pasa:** si Raquel cancela el diálogo de guardar, `path` es `null`, no se escribe nada y la función devuelve `{ skipped }` → toast de éxito. Si `writeBinaryFile` falla (USB lleno, carpeta sin permisos o fuera del alcance), el `catch` prueba la descarga con `<a download>` y un `revokeObjectURL` inmediato, que en Tauri 1 no es fiable (ya se vio en el hallazgo #67 de oct-2026), y también acaba en éxito.
- **Escenario concreto:** exporta la copia mensual al USB, que está lleno → "Backup exportado correctamente" → no hay ningún fichero.
- **Impacto para Raquel:** cree que tiene una copia fuera del PC y no la tiene. Es su única copia con documentos y la única que sirve si el disco falla o se olvida la contraseña.
- **Propuesta:** devolver `{ saved: false }` al cancelar (sin toast), quitar el fallback de `<a download>` y mostrar el error; después de escribir, comprobar el tamaño del fichero.
- **Esfuerzo:** S
- **Confianza:** confirmado (cancelar); probable (fallo de escritura)

### [ALTA] Si falta `encryption.json`, la app arranca vacía sin avisar (y los datos ya no se pueden descifrar)
- **Ubicación:** `src/stores/store.js:55-70` (`loadRaw` toma `not_unlocked` como "no hay datos"), `src-tauri/src/main.rs:137-143` (`load_data` lee `.enc` si existe), `src-tauri/src/main.rs:90-92` (cifrado activo = existe `encryption.json`), `src-tauri/src/main.rs:586` (`encryption.json` se escribe con `fs::write`, sin escritura atómica).
- **Qué pasa:** si `encryption.json` desaparece o queda truncado (corte de luz al activar el cifrado, antivirus, limpieza manual), `EncryptionGate` cree que no hay cifrado y carga sin desbloquear; `load_data` encuentra `nutripolo-storage.enc`, `current_key()` da `not_unlocked` y `loadRaw` devuelve `null` **sin** marcar `loadFailure` → app vacía, escrituras permitidas (en `.json` en claro) y copia automática vacía del día. Además, la sal solo está en ese fichero: sin él no hay forma de derivar la clave, ni siquiera para las copias automáticas (cifradas con la misma clave).
- **Escenario concreto:** apagón justo al activar el cifrado → `encryption.json` vacío → "invalid_encryption_config" al desbloquear. O el fichero desaparece → la app abre vacía como si fuera nueva.
- **Impacto para Raquel:** pérdida total sin entender por qué; solo se salva con un ZIP exportado.
- **Propuesta:** en `loadRaw`, tratar `not_unlocked` como `loadFailure` cuando el cifrado "no está activo" pero existe `.enc`; escribir `encryption.json` con `write_atomic` y guardar una copia (`encryption.backup.json`) que se valide al arrancar; al activar el cifrado, recomendar exportar un ZIP.
- **Esfuerzo:** S
- **Confianza:** confirmado (lectura); la probabilidad es baja

### [MEDIA] Deshacer a ciegas: el historial dura toda la sesión, no dice qué deshace y deja huérfanos
- **Ubicación:** `src/App.jsx:428-439`, `src/stores/store.js:1851-1887`, `src/stores/store.js:1131` (`add_client`), `src/stores/store.js:1864`, `src/i18n.js:878`.
- **Qué pasa:** (1) Deshacer `add_client` quita la ficha pero deja sus consultas, mediciones, planes y facturas con un `clienteId` inexistente (reproducido: 0 clientes, 1 consulta, 1 medición, 1 factura). Al arrancar sale "N consultas referencian clientes eliminados" sin forma de arreglarlo. Lo mismo con un cliente creado desde una sugerencia (`createClientFromSuggestion`): la sugerencia queda `linked` a nadie. (2) Con la app en la bandeja la sesión dura días, y Ctrl+Z fuera de un campo deshace lo último del historial (hasta 20), aunque sea de hace días, con un toast genérico ("Acción deshecha"). (3) `_future` no se invalida con otras ediciones: tras deshacer el borrado de un cliente y añadirle una consulta, Ctrl+Y vuelve a borrarlo con la consulta nueva, sin confirmar.
- **Escenario concreto:** Raquel crea una ficha, le apunta la primera visita y una medición, pulsa Ctrl+Z pensando en deshacer un texto → la ficha desaparece y quedan consultas sin paciente.
- **Impacto para Raquel:** cambios que no entiende y datos colgando.
- **Propuesta:** que el toast diga qué se ha deshecho ("Restaurada la factura NP-2026-002", con botón Rehacer); no registrar `add_client` si ya tiene registros asociados (o deshacerlo en cascada); caducar el historial (p. ej. 15 min) y vaciar `_future` en cualquier escritura de usuario.
- **Esfuerzo:** S
- **Confianza:** confirmado (test)

### [MEDIA] Las migraciones sobrescriben el fichero sin guardar antes la versión anterior
- **Ubicación:** `src/stores/store.js:327-382`, `node_modules/zustand/esm/middleware.mjs:518-525` (después de `migrate`, `setItem()`), `src/stores/store.js:1937-1956`.
- **Qué pasa:** las migraciones son puras sobre lo leído y, si fallan, no tocan el disco (`loadFailure`). Bien. Pero si una migración tiene un error de **lógica** (borra o cambia de más sin lanzar ninguna excepción), el resultado sustituye el fichero a los 300 ms. Las copias automáticas de días anteriores son de la versión vieja y, al restaurarlas, pasan por la **misma** migración. Y la copia automática del día se hace después de migrar. Además, si una migración lanza una excepción (p. ej. v15→v16 con una receta `null` en `planLibrary.recetas`: `TypeError` reproducido), todas las copias de esa versión fallan igual y la única salida es "Empezar con datos vacíos".
- **Escenario concreto:** una futura v17 con un error que vacía `planLibrary.productos` → se escribe al instante → restaurar la copia de ayer lo vuelve a vaciar.
- **Impacto para Raquel:** una actualización con un fallo puede costarle datos sin vuelta atrás.
- **Propuesta:** antes de migrar, guardar el contenido tal como estaba (`nutripolo-storage.v<versión>.json|enc`, solo una vez por versión) y ofrecerlo en `LoadErrorScreen`; las migraciones nuevas, tolerantes a entradas `null`.
- **Esfuerzo:** S
- **Confianza:** confirmado (lectura + test de la excepción)

### [MEDIA] Escritura atómica sin `fsync`: un corte de luz puede dejar el fichero vacío
- **Ubicación:** `src-tauri/src/main.rs:97-103` (`write_atomic`), también `main.rs:737-738`, `767-768` y `818-819`.
- **Qué pasa:** `fs::write` + `fs::rename` sin `File::sync_all()`. En NTFS el rename (metadatos) se registra en el journal, pero los datos del `.tmp` pueden seguir en caché; tras un corte, el fichero puede quedar con longitud 0 o lleno de ceros.
- **Escenario concreto:** portátil sin batería que se apaga justo después de guardar → al arrancar, "No se pudieron leer tus datos".
- **Impacto para Raquel:** pierde lo hecho desde la última copia automática (que con el hallazgo de copias solo-al-arrancar puede ser antigua).
- **Propuesta:** `sync_all()` del `.tmp` antes del rename (y, si se quiere, `FlushFileBuffers` del directorio); guardar la versión anterior como `.bak` antes de sustituirla y probarla automáticamente si el principal no se puede leer.
- **Esfuerzo:** S
- **Confianza:** probable (depende del hardware y la caché; no reproducido)

### [MEDIA] Las copias automáticas fallan en silencio (y un `backup-manifest` dañado las para para siempre)
- **Ubicación:** `src/stores/store.js:1946-1955` (`JSON.parse` del manifiesto dentro del `try`; el `catch` solo escribe en consola en DEV), `src/stores/store.js:1958-1963`.
- **Qué pasa:** si `backup-manifest` no se puede leer o parsear, o falla `save_data`, la copia no se hace y nadie se entera. Con el manifiesto dañado ya no se hace ninguna más, y `getAutoBackupInfo` devuelve una lista vacía: `LoadErrorScreen` no enseña las copias que sí existen en el disco.
- **Escenario concreto:** el manifiesto queda truncado → durante semanas no hay copias nuevas → el día que hacen falta, la pantalla de error no ofrece ninguna.
- **Impacto para Raquel:** red de seguridad desactivada sin saberlo.
- **Propuesta:** si el manifiesto no se puede leer, rehacerlo a partir de los ficheros `backup-*` que haya (hace falta un comando `list_data_keys`); avisar con un toast o un aviso si la copia del día falla; enseñar en Ajustes la fecha de la última copia en rojo si tiene más de 2 días.
- **Esfuerzo:** S
- **Confianza:** confirmado (lectura)

### [MEDIA] "Reiniciar agenda" y "convertir a personal" borran notas clínicas sin deshacer
- **Ubicación:** `src/stores/store.js:1249-1255` (`resetAgenda` también vacía `_history`), `src/components/CalendarView.jsx:651-672`, `src/i18n.js:781`, `src/stores/store.js:1289-1308` (`convertConsultationsToPersonal`), `src/components/SettingsView.jsx:745-751`.
- **Qué pasa:** `resetAgenda` borra **todas** las consultas (también las locales, con `notasPrivadas`, `notasCliente`, recordatorios y vínculos con facturas) y no deja tombstones: el siguiente pull vuelve a importar los eventos de Google como consultas nuevas sin paciente ni notas. Convertir un calendario en "personal" quita a las consultas cliente, notas y estado. Ninguna de las dos se puede deshacer y no se hace copia antes. El aviso habla de "consulta(s) locales", no de notas clínicas.
- **Escenario concreto:** para "limpiar duplicados", Raquel pulsa Reiniciar agenda → se pierden las notas de todas sus consultas.
- **Impacto para Raquel:** pérdida de historia clínica por una acción que parece de mantenimiento.
- **Propuesta:** guardar una copia automática justo antes; decir en el aviso cuántas consultas tienen notas o están facturadas; limitar el reinicio a las consultas importadas sin notas, o quitarlo de la interfaz normal.
- **Esfuerzo:** S
- **Confianza:** confirmado (lectura)

### [MEDIA] Al borrar un cliente, sus notas privadas se quedan en las consultas de Google desvinculadas
- **Ubicación:** `src/stores/store.js:908-913`.
- **Qué pasa:** las consultas con `googleEventId` no se borran (para que el pull no las vuelva a importar); se desvinculan (`clienteId: null`) pero conservan `notasPrivadas`, `notasCliente`, `googleSummary` (el nombre del paciente) y `reminders`. Siguen en la agenda y en las copias.
- **Escenario concreto:** un paciente pide que se borren sus datos (RGPD art. 17) → Raquel borra la ficha → sus notas clínicas siguen en las citas antiguas de la agenda.
- **Impacto para Raquel:** cree que ha cumplido la supresión y no es así.
- **Propuesta:** al desvincular, vaciar `notasPrivadas` / `notasCliente` (que vayan en el snapshot del deshacer) y marcar la cita como "paciente eliminado"; o dejar un tombstone y borrarla del todo.
- **Esfuerzo:** S
- **Confianza:** confirmado (lectura)

### [MEDIA] Importar un ZIP no borra los documentos de clientes que no están en la copia
- **Ubicación:** `src/stores/store.js:2050-2072`.
- **Qué pasa:** se escriben los documentos del ZIP y se sustituye `clientDocuments`, pero los ficheros que ya había en `documents/<id>/` y no están en la copia se quedan en el disco sin metadatos: invisibles para Raquel y sin forma de borrarlos desde la app.
- **Escenario concreto:** importar una copia anterior a varios pacientes nuevos → sus PDF (analíticas, informes) quedan huérfanos en AppData.
- **Impacto para Raquel:** datos de salud que no ve ni puede gestionar.
- **Propuesta:** al terminar la importación, listar `documents/` y mover a una carpeta `documents_huerfanos/` (o borrar, previa confirmación) lo que no esté en `clientDocuments`.
- **Esfuerzo:** S
- **Confianza:** confirmado (lectura)

### [BAJA] `ClientModal` guarda la ficha entera abierta (patrón del #56 de oct-2026, ahora en clientes)
- **Ubicación:** `src/components/ClientModal.jsx:43-55` y `71-73`.
- **Qué pasa:** el formulario se inicia con `...client` y al guardar hace `updateClient(id, { ...form })`, que incluye `entrevista`, `energia`, `recordatorios`… tal como estaban al abrirlo. Hoy nada escribe en clientes en segundo plano, así que el riesgo es bajo, pero cualquier escritura futura (o la entrevista editada en otra vista con el modal abierto) se pisaría.
- **Escenario concreto:** no reproducible hoy con un solo usuario y una sola ventana.
- **Impacto para Raquel:** ninguno de momento.
- **Propuesta:** usar `changedFields(client, form)` como en `ConsultationModal.jsx:142`.
- **Esfuerzo:** S
- **Confianza:** confirmado (lectura)

### [BAJA] `setItem` acepta escrituras antes de hidratar
- **Ubicación:** `src/stores/store.js:83-88`.
- **Qué pasa:** con `skipHydration`, cualquier `set()` antes de que acabe `rehydrate()` pone en cola el estado por defecto (vacío) y lo escribe a los 300 ms. Con cifrado, se reintentaría cada 5 s hasta el desbloqueo y podría coincidir justo antes del `load_data`. Hoy no he encontrado ningún `set()` antes de hidratar (`ErrorBoundary` solo está dentro de `AppContent`), pero es una mina para el futuro.
- **Escenario concreto:** un componente nuevo de la pantalla de desbloqueo que llame a `updateConfig`.
- **Impacto para Raquel:** ninguno hoy.
- **Propuesta:** en `setItem`, no hacer nada mientras `!useStore.persist.hasHydrated()`.
- **Esfuerzo:** S
- **Confianza:** confirmado (lectura); sin un camino que lo dispare hoy

### [BAJA] Carrera entre activar el cifrado y una escritura en curso
- **Ubicación:** `src-tauri/src/main.rs:560-599` frente a `main.rs:105-128`; `src/components/SettingsView.jsx:1173`.
- **Qué pasa:** si `save_data` comprueba "sin cifrar" justo antes de que se escriba `encryption.json` y termina después de que la migración haya convertido el fichero, quedan `.json` (nuevo) y `.enc` (viejo); `load_data` prefiere el `.enc`, y la última edición se pierde si la app se cierra antes del siguiente guardado.
- **Escenario concreto:** activar el cifrado justo después de editar algo. Ventana de milisegundos.
- **Impacto para Raquel:** la última edición podría perderse, muy poco probable.
- **Propuesta:** el mismo mutex de E/S del hallazgo del cambio de contraseña, y `flushAllPending()` antes de activar.
- **Esfuerzo:** S
- **Confianza:** probable

### [BAJA] Rotación de copias: queda un caso en que el manifiesto lista una copia borrada
- **Ubicación:** `src/stores/store.js:1949-1953`.
- **Qué pasa:** se borran `manifest.slice(0, len-6)` del manifiesto **anterior**. Si ese manifiesto ya incluía la fecha de hoy (pasa cuando `lastBackupDate` no se ha guardado, p. ej. tras `LoadErrorScreen`), se borra el fichero más antiguo pero sigue en `newManifest`.
- **Escenario concreto:** 7 copias con la de hoy, segundo `runAutoBackup` el mismo día con `lastBackupDate` a `null` → en la lista sale una copia que no existe y restaurarla da `not_found`.
- **Impacto para Raquel:** un error al restaurar una copia de la lista.
- **Propuesta:** borrar exactamente `manifest` menos `newManifest`.
- **Esfuerzo:** S
- **Confianza:** confirmado (lectura)

## Pendientes de la auditoría de oct-2026

| # oct | Estado ahora |
|---|---|
| 4 — flush en `beforeunload` sin esperar | **Mitigado.** `invoke` hace el `postMessage` IPC de forma síncrona (`node_modules/@tauri-apps/api/tauri.js:45-61`), así que la escritura sale antes de descargar la página. Lo que queda es el caso de un guardado que falla (hallazgo ALTA "Salir con un guardado fallido") y los editores sin guardar. |
| 6 — todo el store se serializa en cada `set()` | **Arreglado** en lo que toca a la integridad: se serializa una vez por escritura agrupada (`store.js:34-39`). El tamaño (logo, fotos de productos, recetas) es cosa de rendimiento. |
| 7 — restaurar/importar ignora `version` | **Arreglado a medias:** ahora migra, vacía el historial y conserva Google y el buzón. **Sigue abierto:** sin validar el formato, acepta versiones futuras y no guarda copia previa (hallazgo CRÍTICA). `personalEvents` / `syncAudit` no van en la copia (aceptable: vienen de Google). |
| 10 — la rotación deja una copia borrada en el manifiesto | **Casi arreglado;** queda un caso límite (BAJA "Rotación de copias"). |
| 12 — `onRehydrateStorage` muta el estado; claves nuevas de `config` | **Arreglado** (`setState`; `merge` de `config` a un nivel). Las claves anidadas (`reminders`, `reviewRequests`) se completan con `getReminderConfig` / `getReviewConfig`. |
| 56 — `ConsultationModal` guarda el snapshot | **Arreglado** (`changedFields`, `ConsultationModal.jsx:142`). El mismo patrón sigue en `ClientModal` (BAJA). |
| 62 — el reinicio de agenda cuenta solo las visibles | **Arreglado** (`CalendarView.jsx:652-653`). El problema de fondo (irreversible, borra notas) va en MEDIA. |
| 72 — deshacer el borrado de un documento | **Arreglado** (sin deshacer, `store.js:1710-1714`). |

## Lo que está bien (breve, para no tocarlo)
- `save_data` escribe en `.tmp` y luego hace rename; el `.json` en claro solo se borra cuando el `.enc` ya está escrito. `quarantine_data` aparta el fichero ilegible en vez de borrarlo.
- `loadFailure` bloquea las escrituras si el fichero existe y no se puede leer, y lo mismo si `JSON.parse` o una migración lanzan una excepción. `LoadErrorScreen` ofrece reintentar, restaurar o empezar vacío.
- Errores de guardado: se reintentan cada 5 s, sin perder el valor, con aviso visible.
- `save_data` es síncrono (hilo principal): las escrituras del mismo fichero nunca se solapan entre sí.
- `SYNC_FIELDS` y `BOOKKEEPING_FIELDS`: un formulario viejo no puede borrar el estado de sync ni un recordatorio enviado. La sync vuelve a leer el estado antes de cada escritura, y `lastSyncedAt` es la hora de *antes* de la petición.
- Los recordatorios se marcan `sending` antes de mandarse (ningún reenvío si se cuelga a medias).
- Las migraciones v13/v15/v16 son puras sobre los datos del disco: si la app se cierra a medias, se repiten igual. La v16 usa la firma de cada receta y no toca las editadas ni las borradas; pasar de v14 a v16 de una vez siembra directamente la versión nueva.
- Ids con `crypto.randomUUID()`; ids de Google deterministas; fechas en hora local (`localISODate`, `fecha + 'T00:00:00'`) y eventos de Google convertidos a la zona del equipo (`parseGoogleDateTime`). No he encontrado ningún `new Date('YYYY-MM-DD')` ni `toISOString().slice(0,10)` en las fechas de negocio.
- Facturas en céntimos enteros (`computeInvoiceTotals`), número derivado de la lista y sin duplicados en `addInvoice` / `updateInvoice`.
- Las entradas del ZIP se validan (`SAFE_SEGMENT`) y se reescriben por el backend (cifradas si toca). Los secretos de Google y SMTP no van en las copias.

## Fuera de mi área (notas para otras sesiones)
- **Código / tests:** `npm test` también ejecuta las copias de `.claude/worktrees/*` (110 ficheros en lugar de 13): falta un `exclude` en la configuración de vitest. Un fallo en `src/` puede quedar enterrado entre las copias y, al revés, una worktree rota puede tumbar `npm test`.
- **Seguridad:** (1) un `nutripolo-storage.json.tmp` en claro, de un rename que falló antes de activar el cifrado, no lo migra `migrate_plaintext_to_encrypted` (solo mira `*.json`) y se queda en claro en AppData. (2) Si la migración a cifrado falla a medias, `backup_pre_encryption/` (en claro) no se borra y los `.json` que faltaban se quedan en claro para siempre (al reintentar sale `already_enabled`). (3) `copy_file_to_documents` y `save_bytes_to_documents` escriben sin `write_atomic`.
- **Facturación:** los datos del **emisor** (nombre, NIF, dirección) también salen de la `config` viva al regenerar el PDF; si cambian, cambian las facturas antiguas (relacionado con el hallazgo CRÍTICA de las facturas).
- **Rendimiento:** `save_data` es síncrono en el hilo principal: con el store entero (logo, fotos de productos, ~1.260 recetas, caché de la web) y el cifrado, cada guardado agrupado (cada 300 ms al escribir en la entrevista) bloquea la UI. Si se pasa a `async`, hace falta el mutex de E/S del hallazgo del cambio de contraseña para no perder el orden de las escrituras.
- **Citas / sync:** después de restaurar una copia, las consultas creadas por la app después de la copia se reimportan desde Google como citas nuevas sin paciente ni notas (la comprobación por `nutripolo_id` no encuentra el id local). No duplica, pero conviene saberlo para el mensaje de restaurar.
