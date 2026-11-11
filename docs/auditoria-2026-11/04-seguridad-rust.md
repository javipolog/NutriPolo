# 04 — Seguridad, privacidad (RGPD) y backend Rust  (auditoría nov-2026, v1.18.1)

## Resumen

El backend está bastante mejor que en v1.9.0: secretos en el Credential Manager, OAuth con PKCE + `state`, SMTP con TLS obligatorio, rutas de documentos canonizadas, CSP estricta y `clippy --all-targets` sin avisos. El punto débil es el **cifrado en reposo cuando cambia la contraseña**. Si falla a medias, se pierden ficheros sin remedio, y si Raquel reintenta se borra la única copia buena. Además, cualquier guardado que ocurra durante el cambio se cifra con la clave vieja. En privacidad, las «Notas para el cliente» se suben a Google Calendar sin avisar, y borrar a un paciente no borra todo lo que dice el diálogo. Hay dos riesgos latentes en la cadena de publicación: `envPrefix: 'TAURI_'` y las Actions sin fijar a un commit. Cualquiera de los dos puede acabar filtrando la clave de firma del actualizador.

| Severidad | Nº |
|---|---|
| CRÍTICA | 1 |
| ALTA | 2 |
| MEDIA | 9 |
| BAJA | 6 |
| **Total** | **18** |

Comprobaciones hechas: lectura completa de `main.rs`, `encryption.rs`, `google_calendar.rs`, `tauri.conf.json`, `Cargo.toml/lock` y del frontend que llama a `invoke`; `cargo clippy --all-targets --offline` (0 avisos); `npm audit --omit=dev` (1 alta, lodash); dos pruebas en el scratchpad: `Path::join` con `C:` y la normalización de `%2e%2e` con el crate `url` 2.5.8, y un build mínimo de Vite 5.4.21 con `envPrefix` `TAURI_` y variables canario.

---

## Hallazgos

### [CRÍTICA] El cambio de contraseña no es transaccional: un fallo a mitad deja ficheros con una clave perdida, y reintentar borra la copia de seguridad
- **Ubicación:** `src-tauri/src/main.rs:654-666` (copia previa y rekey), `main.rs:656-657` (borra `backup_pre_rekey` al empezar), `main.rs:777-821` (`rekey_all_files` / `rekey_file`), `main.rs:168-184` (`quarantine_data` crea `*.corrupt-<ts>.enc`), `main.rs:663-679` (la sal nueva solo se guarda al final).
- **Qué pasa:** `encryption_change_password` re-cifra los ficheros uno a uno con `new_key = Argon2(nueva, new_salt)`, y `new_salt` solo se escribe en `encryption.json` cuando ha terminado todo. Si cualquier `rekey_file` falla, la función sale con `Err`. Los ficheros ya procesados quedan cifrados con una clave cuya sal no está en ningún sitio, así que no se pueden recuperar ni con la contraseña nueva. Mientras tanto, `encryption.json` y la clave en memoria siguen siendo los viejos. La única copia buena es `backup_pre_rekey/`. Si se vuelve a intentar el cambio, la línea 656 **borra esa carpeta** antes de copiar el estado ya roto. El reintento falla al primer fichero ya re-cifrado (`decrypt_failed` con la clave vieja) y la pérdida pasa a ser definitiva.
  Hay un disparador concreto que se repite siempre: `rekey_all_files` toma cualquier `*.enc` de la raíz, también los `*.corrupt-<ts>.enc` que deja `LoadErrorScreen`. Si un fichero se puso en cuarentena porque no se podía descifrar, todos los cambios de contraseña futuros fallarán al llegar a él. Otros disparadores: un `fs::rename` denegado porque el antivirus o el indexador tienen el fichero abierto, disco lleno, o un documento `.enc` dañado.
- **Escenario concreto:** (1) Un corte de luz daña `nutripolo-storage.enc`. Raquel ve «No se pudieron leer tus datos», restaura la copia de ayer y queda `nutripolo-storage.corrupt-…enc`. (2) Meses después cambia la contraseña. NTFS lista en orden alfabético: `backup-*.enc` y `backup-manifest.enc` se re-cifran con la clave nueva, y al llegar a `nutripolo-storage.corrupt-…enc` el proceso falla. Ve «Error al cambiar la contraseña: decrypt_failed». Las 7 copias automáticas ya no se pueden leer. (3) Lo vuelve a intentar: se borra `backup_pre_rekey` y las copias se pierden para siempre. Si el fallo hubiera llegado en un documento, el fichero principal ya estaría re-cifrado. Al cerrar la app sin ningún cambio pendiente, en el siguiente arranque no se podría leer ni el fichero principal ni ninguna copia.
- **Impacto para Raquel:** puede perder las copias automáticas, documentos de pacientes o incluso todos los datos, justo al hacer algo que se le recomienda hacer.
- **Propuesta:** (a) Mínimo inmediato: en `rekey_all_files`, saltar `*.corrupt-*`. Si `backup_pre_rekey` ya existe, no borrarla: abortar con un código claro. Ante cualquier error, restaurar los ficheros desde `backup_pre_rekey` antes de devolver `Err`. Escribir la sal nueva en un `encryption.json.pending` (con `fsync`) antes de tocar ningún fichero, para poder deshacer o completar al arrancar. (b) De fondo: cifrado por sobre (*envelope*). Una DEK aleatoria cifra los datos y `encryption.json` guarda la DEK envuelta con la clave derivada de la contraseña. Cambiar la contraseña pasa a ser reescribir `encryption.json` de forma atómica, sin tocar ningún fichero. Así desaparece este hallazgo y el siguiente, y se puede añadir una clave de recuperación (ver MEDIA «Sin recuperación…»).
- **Esfuerzo:** M (mínimo) / L (envelope + migración)
- **Confianza:** confirmado (lógica leída línea a línea; el orden alfabético de `read_dir` en NTFS solo cambia qué ficheros se pierden, no que se pierdan)

### [ALTA] Lo que se guarda durante el cambio de contraseña se cifra con la clave vieja → el fichero principal no se puede leer al reiniciar
- **Ubicación:** `src-tauri/src/main.rs:105-128` (`save_data` síncrono, usa `encryption::current_key()`), `main.rs:633-685` (`encryption_change_password` es `async` y solo hace `set_master_key(new_key)` al final), `src/components/SettingsView.jsx:1185-1213` (`handleChange` no vacía ni para las escrituras).
- **Qué pasa:** `save_data` corre en el hilo principal y el rekey en el pool asíncrono, así que se ejecutan a la vez. Cuando el rekey ya ha pasado por `nutripolo-storage.enc`, cualquier guardado del store (el debounce de 300 ms, el sync de Google o los recordatorios de `useBackgroundJobs`) vuelve a escribirlo con la clave **vieja**. Después se instala la clave nueva y en `encryption.json` queda la sal nueva: la vieja desaparece. Si luego no hay otro guardado antes de cerrar, en el siguiente arranque `load_data` devuelve `decrypt_failed`. Pasa lo mismo con `backup-<hoy>.enc` si `runAutoBackup` coincide. En `encryption_setup` no hay daño (el guardado falla con `not_unlocked` y se reintenta en 5 s), pero aparece un error de guardado.
- **Escenario concreto:** Raquel cambia la contraseña mientras la sincronización automática importa una cita. La sync escribe el store en mitad del rekey. Ve «Contraseña cambiada» y cierra la app. Al día siguiente: «No se pudieron leer tus datos». Restaura la copia automática más reciente, pierde lo que hizo desde entonces y queda un `*.corrupt-*.enc`, que a su vez hará fallar el próximo cambio de contraseña (hallazgo CRÍTICO).
- **Impacto para Raquel:** pérdida del trabajo desde la última copia y un susto grande. Poco frecuente (hace falta un guardado en una ventana de segundos), pero puede pasar sin que ella haga nada raro.
- **Propuesta:** un `RwLock` global en Rust (`VAULT`): `save_data`, `load_data` y los comandos de documentos toman el lock de lectura, y `encryption_setup` / `encryption_change_password` el de escritura. En el frontend, `await flushAllPending()` antes de invocar, y pausar `useBackgroundJobs` mientras `busy`. Con el cifrado por sobre deja de hacer falta.
- **Esfuerzo:** S
- **Confianza:** confirmado en la lógica; la frecuencia real depende del momento (probable)

### [ALTA] Las «Notas para el cliente» se suben a Google Calendar (también a calendarios de clínica) sin ningún aviso
- **Ubicación:** `src/services/googleCalendarService.js:433` (`description: consultation.notasCliente`), `googleCalendarService.js:409-411` (título `Consulta - <nombre completo>`), `src-tauri/src/google_calendar.rs:307-314` (la descripción se envía siempre), `src/components/ConsultationModal.jsx:317-320` (campo «Notas para el cliente», placeholder «Instrucciones para el cliente…»).
- **Qué pasa:** el campo pensado para el paciente («instrucciones») se publica tal cual como descripción del evento en Google. Si la cita está en un calendario de clínica con permiso de escritura, también lo ve el personal de la clínica. El título lleva el nombre completo. Nada en la UI dice que esas notas salen del ordenador. Lo que se escribe ahí con naturalidad («reducir a 1.500 kcal», «sin gluten por celiaquía», «control de la glucosa») son datos de salud (art. 9 RGPD) que acaban en Google (una cuenta personal de Gmail no tiene contrato de encargo de tratamiento) y en terceros.
- **Escenario concreto:** Raquel apunta en una cita de la clínica X «Recordar: analítica de tiroides, bajar hidratos». En el siguiente push, la recepción de la clínica lo ve en su Google Calendar.
- **Impacto para Raquel:** posible filtración de datos de salud a terceros sin que lo sepa. Es un riesgo legal (deber de secreto y RGPD) y de confianza.
- **Propuesta:** no enviar `notasCliente` por defecto. Añadir una opción explícita «Enviar las notas a Google Calendar» (desactivada) y no enviarlas nunca a calendarios con `purpose` de clínica. Poner en el campo una pista «No se sincroniza con Google». Opcional: título configurable (nombre completo, nombre + inicial o solo «Consulta»). Revisar con Raquel si usa Google Workspace (DPA) o Gmail personal.
- **Esfuerzo:** S
- **Confianza:** confirmado (no he comprobado qué escribe Raquel en ese campo)

### [MEDIA] Un `client_id` con `:` sale de la carpeta `documents/` (también para borrar)
- **Ubicación:** `src-tauri/src/main.rs:55-60` (`validate_path_component` no rechaza `:`), `main.rs:829-831` (`get_documents_dir` hace `join(client_id)`), `main.rs:952-961` (`delete_documents_directory` → `remove_dir_all`), `main.rs:851-900`, `main.rs:963-1007`; vector: `src/stores/store.js:978-992` (`restoredState` no valida los ids de `data.json`).
- **Qué pasa:** en Windows, `Path::join("C:")` **sustituye** la ruta entera. Prueba en el scratchpad: `…\documents`.join(`"C:"`) = `"C:"`, y .join(`"x:y"`) = `"x:y"`. Con `client_id = "C:"`, `delete_documents_directory` ejecuta `remove_dir_all("C:")`, es decir, el directorio actual del proceso en la unidad C. `copy_file_to_documents` y `save_bytes_to_documents` escribirían fuera de `documents/`. Los ids normales son UUID, pero una copia `.json` o `.zip` importada puede traer cualquier id de cliente (los nombres de documento del ZIP sí se validan, los ids de `data.json` no).
- **Escenario concreto:** se importa una copia manipulada o dañada con un cliente `id: "C:"` y Raquel lo borra. El backend intenta borrar en bloque el directorio de trabajo (si se arranca desde el acceso directo del MSI suele ser la carpeta de instalación; si es protegido, falla parcialmente).
- **Impacto para Raquel:** hoy es poco probable que haga daño real, pero la única barrera entre la app y un borrado recursivo fuera de su carpeta está rota.
- **Propuesta:** validar `client_id` y `dest_filename` con una lista blanca estricta, como `validate_data_key` (`[A-Za-z0-9_-]{1,64}` y `[A-Za-z0-9._-]{1,200}`, sin `:` ni punto/espacio final). Además, comprobar `dest.parent() == docs_root.join(id)` y que `docs_root` sea prefijo antes de escribir o borrar. Validar los ids en `restoredState`.
- **Esfuerzo:** S
- **Confianza:** confirmado (comportamiento de `join` probado; el borrado real no lo he ejecutado)

### [MEDIA] Borrar a un paciente no lo borra todo (derecho de supresión) y no hay exportación por paciente (derecho de acceso)
- **Ubicación:** `src/stores/store.js:908-913` (las consultas con `googleEventId` se desvinculan pero se conservan), `src/components/ClientsView.jsx:57` (`deleteClientDocumentsDir(...).catch(() => {})`), `src/i18n.js:1060` (diálogo), `src/stores/store.js:1972-2021` (solo existe el ZIP completo).
- **Qué pasa:** (1) Las consultas sincronizadas con Google quedan en el store con `notasPrivadas`, `notasCliente`, `googleSummary` (nombre) y el estado de recordatorios, y entran en copias y exportaciones. (2) Los eventos de Google no se tocan. (3) Si el borrado de la carpeta de documentos falla (en modo sin cifrar, un PDF abierto en Acrobat queda bloqueado), el error se ignora: la metadata desaparece y los PDF se quedan huérfanos en disco para siempre. (4) El diálogo promete «Se eliminarán también sus consultas…». (5) Para atender un derecho de acceso o portabilidad no hay forma de sacar «todo lo de este paciente» (ficha, entrevista, mediciones, consultas, planes en PDF, documentos).
- **Escenario concreto:** un paciente pide la supresión. Raquel lo borra y, después, en el Explorador siguen sus PDF en `documents/<id>/`, y en el store y en las copias de los próximos 7 días siguen las notas privadas de sus citas.
- **Impacto para Raquel:** cree que ha cumplido y no es así. La conservación de la historia clínica (≥5 años) y de las facturas es legal, pero entonces el diálogo debería decirlo.
- **Propuesta:** en el borrado, limpiar `notasPrivadas`/`notasCliente`/`googleSummary` de las consultas que se conservan (o borrarlas) y ofrecer «borrar también de Google Calendar». Si falla el borrado de documentos, avisar y reintentar. Ajustar el texto del diálogo. Añadir «Exportar datos del paciente» (ZIP con JSON legible + PDF + documentos) en la ficha.
- **Esfuerzo:** M
- **Confianza:** confirmado

### [MEDIA] `envPrefix: ['VITE_', 'TAURI_']` incrustaría la clave privada del actualizador en el MSI con un solo acceso a `import.meta.env` como objeto
- **Ubicación:** `vite.config.js:11`; `.github/workflows/release.yml:42-46` (`TAURI_PRIVATE_KEY` y `TAURI_KEY_PASSWORD` están en el entorno cuando `tauri-action` ejecuta `npm run build`).
- **Qué pasa:** probado con Vite 5.4.21 en el scratchpad con variables canario: `import.meta.env.DEV` e `import.meta.env?.DEV` se sustituyen sin fugas (el código actual y zustand quedan bien plegados, y el `dist/` local no contiene ningún objeto env). Pero `Object.keys(import.meta.env)`, `import.meta.env[x]` o `console.log(import.meta.env)` generan `const c={…,TAURI_PRIVATE_KEY:"…"}` dentro del bundle. Ese bundle va en el MSI público de GitHub. El código no usa ninguna variable `TAURI_*` desde `import.meta.env` (las de build se leen con `process.env` en el mismo `vite.config.js`).
- **Escenario concreto:** dentro de unos meses alguien añade `console.debug(import.meta.env)` para depurar, o se actualiza una dependencia que accede a `import.meta.env` de forma dinámica. La siguiente release publica la clave y su contraseña, y cualquiera puede firmar una «actualización» que la app de Raquel instalará.
- **Impacto para Raquel:** hoy ninguno. Si se dispara, alguien podría ejecutar código en su ordenador con todos los datos de pacientes.
- **Propuesta:** `envPrefix: ['VITE_']`. Opcional: un paso de CI que haga `grep` del `dist/` buscando el valor de la clave y aborte.
- **Esfuerzo:** S
- **Confianza:** confirmado (mecanismo probado; hoy no hay fuga). Pendiente de la auditoría de oct-2026 (#40, entonces BAJA).

### [MEDIA] La release usa Actions sin fijar a un commit y ejecuta código de terceros con la clave de firma en el entorno
- **Ubicación:** `.github/workflows/release.yml:14-23,42` (`actions/checkout@v4`, `setup-node@v4`, `dtolnay/rust-toolchain@stable`, `swatinem/rust-cache@v2`, `tauri-apps/tauri-action@v0`), `release.yml:44-46`.
- **Qué pasa:** las etiquetas `@v0`/`@stable` se pueden mover. Una acción comprometida (ya ha pasado en 2025 con tj-actions) recibe `TAURI_PRIVATE_KEY`. Además, `npm run build` (todas las dependencias de Vite y sus plugins) corre con la clave en `process.env`. El repositorio es **público**.
- **Escenario concreto:** se publica una versión maliciosa de `tauri-action@v0` que envía la clave. El atacante firma un `latest.json` propio, y el siguiente «Actualizar» de Raquel instala su binario.
- **Impacto para Raquel:** el mismo que el anterior: control total del ordenador con los datos de salud.
- **Propuesta:** fijar cada acción a su SHA (con Dependabot para actualizarlas). Separar el build del frontend (sin secretos) de la firma, por ejemplo con `tauri signer sign` en un paso aparte con solo la clave. `permissions: contents: write` solo en el job de publicación.
- **Esfuerzo:** S
- **Confianza:** confirmado (configuración); el riesgo depende de terceros

### [MEDIA] El ámbito `fs` de la webview cubre toda la carpeta de datos: lee los `.json` en claro y puede sobrescribir `encryption.json`
- **Ubicación:** `src-tauri/tauri.conf.json:31-33` (`"$APP/**", "$APPDATA/**"` con `readFile`/`writeFile`), y en contraste `src-tauri/src/main.rs:62-80` (`validate_data_key` reserva `encryption`).
- **Qué pasa:** todas las lecturas y escrituras de ficheros del JS pasan por un diálogo, y Tauri 1 añade al ámbito la ruta elegida (`store.js:2006-2008, 2025-2041`, `Invoices.jsx:65-71`, `InvoiceModal.jsx:196-202`, `NutritionPlanEditor.jsx:504-512`, `PlanificacionEditor.jsx:842-845`, `SettingsView.jsx:1432-1439`). Así que este ámbito no lo usa nadie, pero le da a cualquier script de la webview lectura de `nutripolo-storage.json` (sin cifrar) y escritura sobre `encryption.json`. Eso se salta la protección que `validate_data_key` documenta («a script could overwrite… and lock the user out»).
- **Escenario concreto:** solo es explotable con una inyección de script, y hoy no he encontrado ninguna vía (no hay `dangerouslySetInnerHTML`, el HTML de las recetas se convierte a texto y la CSP no permite scripts externos). Es defensa en profundidad.
- **Impacto para Raquel:** ninguno mientras no haya XSS. Si lo hubiera, podría bloquearla fuera de sus datos cifrados.
- **Propuesta:** `"scope": []` y comprobar que guardar/abrir con diálogo sigue funcionando (Tauri 1 permite las rutas devueltas por `dialog.open/save`).
- **Esfuerzo:** S
- **Confianza:** confirmado el ámbito; probable que vaciarlo no rompa nada (falta probarlo en la app)

### [MEDIA] Escritura «atómica» sin `fsync`: tras un corte de luz el fichero puede quedar vacío; documentos y `encryption.json` se escriben sin `.tmp`
- **Ubicación:** `src-tauri/src/main.rs:97-103` (`write_atomic`: `fs::write` + `rename`, sin `sync_all`), `main.rs:586` (`encryption.json` en el setup con `fs::write` directo), `main.rs:893` y `main.rs:1004` (documentos con `fs::write` directo), `main.rs:737-738, 767-768, 818-819` (migración/rekey sin `fsync`).
- **Qué pasa:** NTFS registra en el journal el `rename` pero no garantiza que los datos del `.tmp` estén en disco antes, así que un corte justo después puede dejar el fichero nuevo con ceros o truncado. Con cifrado, eso da `decrypt_failed` → cuarentena → un `*.corrupt-*.enc` que además dispara el hallazgo CRÍTICO.
- **Escenario concreto:** portátil sin batería o apagón mientras se guarda → al arrancar, «No se pudieron leer tus datos».
- **Impacto para Raquel:** restaura una copia y pierde lo hecho desde entonces.
- **Propuesta:** en `write_atomic`, abrir el `.tmp`, `write_all`, `sync_all()` y luego `rename`. Usar `write_atomic` también para documentos, para `encryption.json` y en migración/rekey.
- **Esfuerzo:** S
- **Confianza:** probable (depende del hardware y la caché de escritura; no reproducido)

### [MEDIA] Cifrado opcional y, si Raquel olvida la contraseña, no hay recuperación posible
- **Ubicación:** `src-tauri/src/main.rs:560-599` (la clave de datos sale directamente de la contraseña), `src/components/SettingsView.jsx:1158-1183` (casilla `security_ack`), `src/i18n.js:989`.
- **Qué pasa:** por defecto, todos los datos de salud están en claro en `%APPDATA%\com.nutripolo.app\`. Si activa el cifrado, la única llave es la contraseña: no hay clave de recuperación, y el aviso (`security_ack`) lo dice. Las copias automáticas están cifradas con la misma contraseña, así que sin ella tampoco sirven. La única salida es una exportación ZIP en claro, si la ha hecho.
- **Escenario concreto:** activa el cifrado, cambia la contraseña tras una sospecha y la olvida en vacaciones → pierde todas las fichas, facturas y documentos.
- **Impacto para Raquel:** pérdida total. Y si no lo activa, un portátil robado expone todo (salvo que tenga BitLocker).
- **Propuesta:** con el cifrado por sobre (ver CRÍTICA), generar al activar una **clave de recuperación** (24 palabras o código para imprimir) que también envuelva la DEK, más «Restablecer con clave de recuperación» en `UnlockScreen`. En Ajustes → Seguridad, mostrar si BitLocker está activo (o al menos recomendarlo) y proponer el cifrado en el primer arranque.
- **Esfuerzo:** L
- **Confianza:** confirmado

### [MEDIA] Si la activación del cifrado falla a medias, queda «activado» con documentos en claro para siempre y una copia completa en claro sin borrar
- **Ubicación:** `src-tauri/src/main.rs:574-579` (copia `backup_pre_encryption`), `main.rs:586-591` (escribe `encryption.json` **antes** de migrar), `main.rs:597` (solo borra la copia si todo va bien), `main.rs:568-570` (`already_enabled` impide reintentar), `main.rs:751-773`.
- **Qué pasa:** cualquier error en `migrate_plaintext_to_encrypted` (un PDF bloqueado, disco lleno…) devuelve `Err` con `encryption.json` ya escrito y sin clave en memoria. Al desbloquear, el store se recupera solo (la siguiente escritura crea el `.enc` y borra el `.json`), pero no hay nada que vuelva a migrar los documentos que no pasaron: se quedan en claro. Y `backup_pre_encryption/`, una copia completa en claro de datos y documentos, se queda en disco indefinidamente. Reintentar devuelve `already_enabled`.
- **Escenario concreto:** activa el cifrado con un PDF abierto en Acrobat → error → desbloquea → «Cifrado activado», pero tiene una carpeta con todo en claro y parte de los documentos sin cifrar.
- **Impacto para Raquel:** cree que sus datos están protegidos y no lo están.
- **Propuesta:** escribir `encryption.json` al final (o como `.pending`). En cada desbloqueo, ejecutar una migración idempotente que cifre los `.pdf` que queden en `documents/` y borre `backup_pre_encryption` cuando no quede nada en claro. Avisar en la UI si queda algo pendiente.
- **Esfuerzo:** M
- **Confianza:** confirmado (lógica). Pendiente parcial de la auditoría de oct-2026 (#29 y #34: arreglados solo en el caso sin errores).

### [MEDIA] Los errores SMTP se quedan en un código genérico y la UI muestra el código tal cual
- **Ubicación:** `src-tauri/src/main.rs:405-413` (`smtp_connection_failed` / `smtp_send_failed`), `main.rs:432-437` (`test_connection` → `smtp_test_failed` sin causa; el `Ok(false)` y el `Err` se tratan igual), `src/components/SendEmailModal.jsx:156`, `src/components/SettingsView.jsx:327` (`toast.error(result.error || …)`).
- **Qué pasa:** en release, `sanitize_err` descarta el detalle de lettre, así que contraseña incorrecta, puerto bloqueado, TLS rechazado o destinatario inexistente dan el mismo código, y en el modal de envío y en la prueba SMTP se muestra literalmente `smtp_send_failed` / `smtp_test_failed`.
- **Escenario concreto:** Gmail revoca la contraseña de aplicación → los recordatorios por email fallan (`status: 'error', error: 'smtp_send_failed'`) y la prueba solo dice `smtp_test_failed`.
- **Impacto para Raquel:** no sabe qué tocar y los recordatorios dejan de llegar.
- **Propuesta:** mapear `lettre::transport::smtp::Error` a códigos estables (`smtp_auth_failed` cuando la respuesta es 535/534, `smtp_tls_failed`, `smtp_timeout`, `smtp_recipient_rejected` con 550/553, `smtp_dns_failed`) sin incluir datos sensibles, y traducirlos en i18n (`reminderErrorText` ya existe).
- **Esfuerzo:** S
- **Confianza:** confirmado

### [BAJA] `recipes_fetch`: `%2e%2e` se normaliza (cualquier ruta del sitio) y se siguen redirecciones a cualquier host
- **Ubicación:** `src-tauri/src/main.rs:1017-1022` (`recipes_path_allowed` permite `%`), `main.rs:1032-1042` (cliente `reqwest` con la política de redirección por defecto, hasta 10 saltos a cualquier origen).
- **Qué pasa:** probado con `url` 2.5.8: `/receta/%2e%2e/wp-json/wp/v2/users` → `https://nutripoloraquel.com/wp-json/wp/v2/users`. El host no puede cambiar (bien), pero la lista blanca de rutas no se cumple. Si la web (WordPress) se comprometiera o tuviera una redirección abierta, el backend seguiría la redirección a otro host, incluidas `127.0.0.1` o la red local (SSRF), y devolvería el cuerpo al JS.
- **Escenario concreto:** solo con la web comprometida o con XSS en la app.
- **Impacto para Raquel:** muy bajo.
- **Propuesta:** rechazar `%2e`/`%2E` y `%2f`/`%5c` en `recipes_path_allowed`, o comparar `Url::parse(...).path()` ya normalizada con la lista blanca. `.redirect(Policy::custom(...))` que solo acepte `nutripoloraquel.com` (o `Policy::none()`). Reutilizar un cliente estático como en `google_calendar.rs:347-356`.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [BAJA] `open_file`: la copia descifrada reutiliza el nombre y falla si el visor aún la tiene abierta; sin cifrado acepta cualquier PDF del disco
- **Ubicación:** `src-tauri/src/main.rs:263-271` (`remove_file` ignorado + `create_new`), `main.rs:204-220`, `main.rs:277-280`.
- **Qué pasa:** al abrir dos veces el mismo documento cifrado con Acrobat (que bloquea el fichero), `remove_file` falla en silencio y `create_new` devuelve «El archivo ya existe». Las copias en claro se borran al ocultar o bloquear la app, al arrancar, y si tienen más de 30 min en la siguiente apertura: con la ventana siempre visible pueden durar horas. Sin cifrado se lanza `explorer <ruta>` con cualquier `.pdf`, incluidas rutas UNC (`\\host\…`, fuga del hash NTLM si hubiera XSS).
- **Escenario concreto:** Raquel abre una analítica, la deja abierta y vuelve a pulsar «Abrir» → error.
- **Impacto para Raquel:** error confuso. La parte de seguridad es teórica.
- **Propuesta:** nombre único por apertura (`<uuid>-<nombre>.pdf`); limpiar también por temporizador mientras la app corre. Restringir `open_file` a `documents/` o a rutas que la app acaba de escribir con el diálogo, y rechazar `\\?\` y UNC.
- **Esfuerzo:** S
- **Confianza:** probable (depende de que el visor bloquee el fichero; Acrobat sí, Edge no)

### [BAJA] Restos en claro o huérfanos tras guardar y borrar
- **Ubicación:** `src-tauri/src/main.rs:120-122` (`let _ = fs::remove_file(&plain_path)`), `main.rs:928-950` (`delete_document_file` con cifrado: si existen `x.pdf` y `x.pdf.enc`, solo borra el `.enc`), `main.rs:836-849`.
- **Qué pasa:** si borrar el `.json` en claro falla tras escribir el `.enc`, el error se ignora y la copia en claro queda para siempre (la app la ignora porque manda el `.enc`). Un documento que sobrevivió en claro a una migración interrumpida no se borra al «eliminar documento». Los ficheros borrados no se sobrescriben (en un SSD, recuperables forensemente).
- **Impacto para Raquel:** datos de salud en claro que ella cree borrados o cifrados.
- **Propuesta:** reintentar e informar del fallo al borrar el `.json`. En `delete_document_file`, borrar las dos variantes. Recomendar BitLocker (ver MEDIA del cifrado).
- **Esfuerzo:** S
- **Confianza:** confirmado

### [BAJA] Detalles criptográficos: sin AAD y copias de la clave y las contraseñas sin borrar de memoria
- **Ubicación:** `src-tauri/src/encryption.rs:47-72` (AES-GCM sin AAD), `encryption.rs:107-110` (`current_key` devuelve copias que no se borran), `main.rs:609, 646, 664` (`key`, `old_key`, `new_key` y los `String` de contraseña no se borran).
- **Qué pasa:** sin AAD, quien pueda escribir en disco puede cambiar un `.enc` por otro (por ejemplo `backup-X.enc` → `nutripolo-storage.enc`) sin que se detecte. Quedan copias de la clave y de las contraseñas en la pila y el heap hasta que se reutilizan.
- **Impacto para Raquel:** muy bajo (exige acceso local).
- **Propuesta:** AAD = nombre lógico del fichero (`key` o `documents/<id>/<nombre>`) con una versión nueva del formato. Usar `Zeroizing<[u8;32]>` y `Zeroizing<String>` en los comandos.
- **Esfuerzo:** S (zeroize) / M (AAD con migración)
- **Confianza:** confirmado. Pendiente de la auditoría de oct-2026 (#36; `zeroize` ya se usa en el lock).

### [BAJA] Dependencias y Tauri 1 → 2
- **Ubicación:** `package.json` (recharts → lodash 4.17.23), `src-tauri/Cargo.lock` (reqwest 0.11.27 y 0.12.28, hyper 0.14 y 1.9, h2 0.3 y 0.4; tauri 1.8.3, wry 0.24.11).
- **Qué pasa:** `npm audit --omit=dev` marca lodash como **alta** (`_.template`, `_.unset`). No es explotable aquí: recharts no pasa entradas de usuario a esas funciones. Lo duplicado en Rust lo trae el updater de Tauri 1 (pendiente de oct-2026). Tauri 1.8.3 es la última 1.x y está en modo mantenimiento. El motor web (WebView2) lo actualiza Windows, que es la mayor superficie, y la app no carga contenido remoto con IPC, así que el riesgo de seguir en v1 es moderado-bajo.
- **Coste de Tauri 2:** L (≈3–5 días): permisos por *capabilities* en lugar de la allowlist; plugins `fs`, `dialog`, `shell`/`opener`, `process`, `updater`, `single-instance` y `autostart` (sustituye `auto-launch`); bandeja con `tray-icon`; `@tauri-apps/api/core` y paquetes de plugin en el JS; el updater exige `createUpdaterArtifacts: "v1Compatible"` en la versión puente para que las instalaciones v1 actualicen. `app_data_dir` sigue en `%APPDATA%\com.nutripolo.app`, así que los datos no se mueven. Ganancia: soporte activo, permisos por ventana y comando, y un updater más moderno.
- **Propuesta:** `npm update recharts` (o `overrides` para lodash ≥ 4.17.24) cuando haya versión. Planificar Tauri 2 para el primer trimestre de 2027 en una rama propia, después de arreglar el cifrado (para no mezclar dos migraciones de riesgo). Mientras tanto, revisar en cada release los avisos de seguridad (GHSA) de `tauri` 1.x.
- **Esfuerzo:** S (lodash) / L (Tauri 2)
- **Confianza:** confirmado

### [BAJA] Calidad del Rust: duplicación, validaciones repartidas y pequeñas rarezas
- **Ubicación:** `src-tauri/src/main.rs:720-773` y `777-807` (dos recorridos casi idénticos de `documents/`), `main.rs:250-255 / 909-915 / 943-947` (la comprobación «dentro de documents» repetida tres veces), `main.rs:48-53` (`expect` en `get_data_dir`), `main.rs:872-878` (exige `%PDF-` en el byte 0; la especificación admite hasta 1.024 bytes de basura delante y algunos escáneres lo hacen → `invalid_pdf`), `main.rs:466-487` (`get_smtp_password` entrega la contraseña al JS; `has_smtp_password` la lee entera), `main.rs:411` (`message_id` = código SMTP «250»), `google_calendar.rs:465` (`_client_secret` sin uso), `main.rs` (1.276 líneas).
- **Qué pasa:** nada falla hoy, pero la lógica sensible (rutas y cifrado) está repetida y es fácil arreglar una copia y olvidar otra (como en el hallazgo de `client_id`).
- **Propuesta:** un módulo `documents.rs` con una sola función `resolve_in_documents(path) -> Result<PathBuf>`, que use `encryption`, `smtp.rs`, `secrets.rs` y `tray.rs`. Un `walk_store_files(dir, f)` común para migración y rekey. Que Rust lea la contraseña SMTP del keyring en `send_email_smtp` (el JS solo pasa la que se acaba de escribir para la prueba). Buscar `%PDF-` en los primeros 1.024 bytes.
- **Esfuerzo:** M
- **Confianza:** confirmado

---

## Pendientes de la auditoría de oct-2026

- **#29 / #34** (copia en claro y `encryption.json` antes de migrar): arreglados solo en el caso sin errores → ver MEDIA «Si la activación del cifrado falla a medias…».
- **#33** (`backup_pre_rekey`): ahora se borra al acabar, pero también al **empezar** un reintento → ver CRÍTICA.
- **#36** (sin AAD, zeroize parcial) → BAJA «Detalles criptográficos».
- **#40** `envPrefix: 'TAURI_'` sigue (el dev server en `0.0.0.0` sí está arreglado) → ahora MEDIA, con el mecanismo probado.
- **#41** instalador sin firma de código: `tauri.conf.json:76` `certificateThumbprint: null`. Aviso de SmartScreen y UAC «Editor desconocido» en cada actualización. Sigue abierto.
- **#43** documentos de hasta 50 MB en base64 por IPC (`read_file_as_base64`, `save_bytes_to_documents`). Sigue abierto (rendimiento).
- **§9** reqwest 0.11 + 0.12 y Tauri 1 → 2: siguen abiertos → BAJA «Dependencias».
- **§10** datos personales reales en los valores por defecto (`src/stores/store.js:1006-1010`: nombre, nº de colegiada, email y teléfono de Raquel) y en placeholders (`SettingsView.jsx:377, 1592`). Siguen abiertos. Ojo: el **repositorio es público** (`gh repo view` → `PUBLIC`). No son datos de pacientes, pero es la profesional.

## Lo que está bien (breve, para no tocarlo)

- **Cripto:** Argon2id m=64 MiB, t=3, p=4, sal aleatoria de 32 B (nueva en cada cambio), nonce aleatorio de 96 bits por escritura, *blob* de verificación para distinguir contraseña errónea, `zeroize` al bloquear o sustituir.
- **Claves de datos:** `validate_data_key` estricta (sin alias de Windows) y `encryption` reservada, con tests. Escritura `.tmp` + `rename` del store, cuarentena en vez de borrar, escrituras bloqueadas si no se puede leer (`loadFailure`).
- **Secretos:** contraseña SMTP, refresh token y client secret de Google solo en el Credential Manager (`ALLOWED_SECRETS`). El access token solo en memoria. `stripGoogleSecrets` en persistencia, copias y exportación, y restaurar no pisa la conexión. `sanitize_err` solo escribe detalles en debug, y los `console.*` del frontend van casi todos con `import.meta.env.DEV`.
- **OAuth:** loopback en `127.0.0.1:0` abierto antes de lanzar el navegador, PKCE S256, `state` de 32 caracteres, peticiones ajenas ignoradas (otro proceso local no puede inyectar ni abortar), timeout de 180 s, scopes mínimos, `without_url()` en los errores, cliente HTTP compartido con timeouts.
- **SMTP:** rustls (sin OpenSSL), `starttls_relay` (STARTTLS **obligatorio**) o TLS implícito en 465, timeout de 30 s, CR/LF/NUL rechazados en cabeceras, `Mailbox` construido por partes, adjunto ≤ 25 MB.
- **Documentos:** `canonicalize` + `starts_with` en lectura y borrado, magic bytes, 50 MB comprobados antes de decodificar el base64, `create_new` para temporales, carpeta del visor limpiada al arrancar, ocultar y bloquear. La importación ZIP valida nombres y pasa por el backend (cifra si toca). La exportación ZIP avisa de que sale en claro si el cifrado está activo.
- **Webview:** CSP con `connect-src 'self'` e `img-src` limitado, sin `dangerouslySetInnerHTML`, HTML de recetas reducido a texto con regex, `referrerPolicy="no-referrer"`, pdf.js 4.10 con `isEvalSupported: false`, `shell.open` limitado a mailto/tel/http(s)/whatsapp, sin protocolo `asset`.
- **Build:** updater firmado con minisign, `clippy --all-targets` sin avisos, comandos pesados (`setup`, `unlock`, `rekey`, SMTP, documentos) `async`, `[profile.release]` con LTO y strip, instancia única.
- **Datos de pacientes en el repo:** no he encontrado ninguno (búsqueda heurística de correos, nombres en mayúscula y notas en tests, fixtures y en la semilla de recetas actual y la de v1.18.0). Los correos de los tests son `example.com/net`. `build-recetas.py` saca los nombres de pacientes de los nombres de fichero en tiempo de ejecución, no están escritos en el código.

## Fuera de mi área (notas para otras sesiones)

- **01-datos:** `write_atomic` sin `fsync` (aquí como MEDIA). Los `*.corrupt-*` de `LoadErrorScreen` no se limpian nunca y rompen el cambio de contraseña. `runAutoBackup` se traga los errores (`store.js:1955`, solo `console.warn` en DEV): si las copias fallan, nadie se entera. Las copias automáticas están en el mismo disco.
- **03-rendimiento:** `save_data`/`load_data` son comandos **síncronos** en el hilo principal. Con un store grande (fotos de productos en data URL, caché de recetas, logo) y AES, cada guardado bloquea brevemente la UI. `recipes_fetch` crea un cliente `reqwest` en cada llamada. #43 sigue abierto.
- **05-ui-ux:** códigos crudos en toasts (`smtp_send_failed`, `smtp_test_failed`: `SendEmailModal.jsx:156`, `SettingsView.jsx:327`). Textos fijos en español en `LoadErrorScreen.jsx:47-90`.
- **02-citas:** `eventToConsultation` importa la descripción de eventos de clínica como `notasCliente` (`googleCalendarService.js:362`) y el push la vuelve a escribir. Si se aplica la propuesta de no enviar notas, hay que separar «descripción de Google» de «notas para el cliente».
- **06-código:** `scripts/install.ps1` es de otro proyecto («Contabilidad Autónomo»): código muerto.
