# 03 — Citas, Google Calendar, recordatorios y reseñas  (auditoría nov-2026, v1.18.1)

## Resumen

La base técnica del sync es sólida: una sola cola de escrituras, ids deterministas, campos de sync separados de las ediciones del usuario, tombstones, protección contra borrado masivo y OAuth con PKCE + `state`. Casi todo lo de la auditoría de oct-2026 en esta área está arreglado. Los problemas graves están en **a quién se asigna cada cita importada**: el extractor de nombres agrupa a pacientes distintos bajo la palabra del tipo de cita ("Nutrición - …"), y un teléfono en la descripción gana a un nombre distinto en el título. Los dos acaban con citas en la ficha equivocada y recordatorios "Hola <otra persona>". Además, los recordatorios automáticos siguen saliendo con datos viejos cuando el sync está caído, el opt-out no frena los reintentos, y las citas importadas nunca tienen ubicación (los mensajes dicen "en —" y el interruptor de reseñas por ubicación no hace nada).

`npm test`: 110 ficheros / 1.899 tests en verde (ver "Fuera de mi área": cuenta también copias de `.claude/worktrees`). Las pruebas propias están en el scratchpad (`audit03.test.mjs`, `match.mjs`, `own.mjs`), no en el repo.

| Severidad | Nº |
|---|---|
| CRÍTICA | 2 |
| ALTA | 5 |
| MEDIA | 10 |
| BAJA | 4 |
| **Total** | **21** |

## Hallazgos

### [CRÍTICA] Pacientes distintos agrupados en una sola sugerencia por la palabra del tipo de cita
- **Ubicación:** `src/services/fuzzyMatcher.js:52` (prefijos reconocidos), `:62` (corta todo lo que va tras " - "), `:322` (clave de agrupación); `src/stores/store.js:1321-1325` (una sugerencia por calendario + `normalizedName`), `:1364-1386` (`linkPatientSuggestion` vincula todas las citas con ese `suggestedFromId`); `src/components/PatientSuggestionsInbox.jsx:71,182` (solo enseña el `rawSummary` del primer evento), `:162` (prefill).
- **Qué pasa:** `extractPatientName` solo quita los prefijos `consulta|cita|revisión|seguimiento|urgencia|primera visita`. Con cualquier otra palabra delante, la regla de `:62` borra el nombre del paciente y deja la palabra del tipo: "Nutrición - Laura Martín" → "Nutrición", "Valoración - X" → "Valoración", "Online - X" → "Online", "1ª visita - X" → "1ª visita", "Consulta nutrición - X" → "nutrición". Todas las citas con ese formato comparten `normalizedName` y caen en **una sola sugerencia** con N citas.
- **Escenario concreto (probado, T1):** la clínica escribe "Nutrición - Laura Martín", "Nutrición - Sergio Vidal" y "Nutrición - Pedro Ruiz". Se crea una sugerencia "Nutrición" (3 citas) y la tarjeta enseña "Nutrición - Laura Martín". Raquel escribe "Laura Martín" en el formulario prerrellenado y pulsa crear: **las 3 citas quedan vinculadas a Laura**. Lo mismo pasa con "Vincular" a un cliente existente.
- **Impacto para Raquel:** citas de otros pacientes en la ficha de Laura (historial clínico mezclado). Laura recibe recordatorios automáticos de las citas de Sergio y Pedro, con sus horas. Pedro, que ya era cliente, se queda sin recordatorio.
- **Propuesta:** (1) no cortar en " - " cuando la parte izquierda no parece un nombre (una sola palabra de una lista de tipos ampliable: nutrición, valoración, online, videollamada, visita, 1ª visita, control, dietista…), o probar las dos mitades contra el índice de clientes y quedarse con la que coincida. (2) Añadir esas palabras a `GENERIC_TITLES`. (3) Como red de seguridad, no agrupar en una sugerencia eventos cuyos `rawSummary` difieran más allá del nombre extraído, y que la tarjeta liste todos los títulos antes de vincular. Añadir tests con estos formatos.
- **Esfuerzo:** M
- **Confianza:** confirmado

### [CRÍTICA] Un teléfono o email de la descripción gana a un nombre distinto en el título: la cita se asigna sola a otra persona
- **Ubicación:** `src/services/fuzzyMatcher.js:333-337`; `src/services/googleCalendarService.js:897-898`.
- **Qué pasa:** si el contacto del evento apunta a un solo cliente y el nombre del título **no coincide con ningún cliente** (`byName` vacío), se asigna (`assign`, `matchStatus: 'exact'`) sin mirar si el nombre se parece. El comentario ("A family may share a phone… the name settles it") solo cubre el caso de que el nombre sea de otro cliente, no el de un paciente nuevo.
- **Escenario concreto (probado, T2):** evento "Consulta - Laura Pérez" (paciente nueva, hija de una clienta) con descripción "Reserva: su madre, tel 600112233". El teléfono es el de la clienta Ana López, así que la cita queda vinculada a Ana sin ninguna revisión, y el panel de recordatorios marca email y WhatsApp como "due" para "Ana López". Lo mismo con "derivada por…" + teléfono, o con el teléfono de la clínica guardado en una ficha.
- **Impacto para Raquel:** la primera visita de Laura acaba en la ficha de Ana. Ana recibe "Hola Ana, te recuerdo tu cita…" de una cita que no es suya. Laura no tiene ficha, y la petición de reseña "primera visita" no sale.
- **Propuesta:** con nombre en el título (`hasName`) y sin coincidencia de nombre, asignar por contacto solo si `fuzzyScore(rawName, cliente.nombre) ≥ suggestThreshold`. Si no, `review` con ese cliente como candidato más "crear ficha".
- **Esfuerzo:** S
- **Confianza:** confirmado

### [ALTA] El correo de la cuenta de Google de Raquel puede acabar como "email del paciente" y enlazar todas las citas de la clínica a una ficha
- **Ubicación:** `src/services/googleCalendarService.js:859` (`ignoreEmails` = id del calendario + `config.email`); `src-tauri/src/google_calendar.rs:273-281` (los asistentes excluyen `self`, que es *el calendario que se lista*, no la cuenta).
- **Qué pasa:** en un calendario de clínica, si la recepcionista invita a la cuenta de Google de Raquel, ese correo llega en `attendees`. No se ignora cuando `config.email` (el correo profesional de los ajustes) es distinto de la cuenta de Google (`googleCalendar.userEmail`).
- **Escenario concreto (probado a nivel de `matchPatient`, `own.mjs`):** "Consulta - Laura Pérez" con Raquel invitada → sugerencia nueva con `contactEmail` = correo de Google de Raquel, prerrellenado al crear la ficha. Desde ese momento, todo evento de la clínica con Raquel invitada ("Consulta - Sergio Vidal"…) se **asigna solo** a Laura por email.
- **Impacto para Raquel:** todas las citas de la clínica se cuelgan en una sola ficha, y los recordatorios por email de esa ficha le llegan a ella misma.
- **Propuesta:** añadir a `ignoreEmails` `gc.userEmail` y los ids de todos los calendarios configurados. No prerrellenar en "crear ficha" un email que sea de la cuenta o de un calendario.
- **Esfuerzo:** S
- **Confianza:** confirmado en la lógica; probable en datos reales (depende de que la clínica invite a la cuenta de Raquel)

### [ALTA] Los recordatorios automáticos siguen saliendo con datos viejos cuando el sync falla o está desconectado
- **Ubicación:** `src/hooks/useBackgroundJobs.js:123-147` (tras un fallo de `syncAll` se envían igual los recordatorios), `:134-140` (solo avisa una vez por sesión y solo si `needsReauth`); `src/services/googleCalendarService.js:286-294` (`invalid_grant` → `connected: false`), `:835-839` (calendario suspendido por borrado masivo); `src/components/CalendarView.jsx:759,785` (sin `connected` desaparece el bloque de sync; "Última sync: HH:MM" sin fecha).
- **Qué pasa:** `tick()` hace el sync y después manda los recordatorios aunque el sync haya fallado, el token esté revocado (`connected: false`), un calendario esté suspendido por `massDeletePending` o un calendario concreto devuelva error. Las citas de la clínica pueden haberse movido o cancelado en Google sin que la app lo sepa.
- **Escenario concreto:** el refresh token caduca (el propio código menciona el límite de 7 días de las apps OAuth en modo "Testing"). La recepcionista pasa a una paciente del jueves 10:00 al viernes 12:00. NutriPolo no sincroniza, y el miércoles el recordatorio automático dice "jueves a las 10:00". Raquel vio un toast una vez y la agenda no muestra nada (el bloque de sync se oculta y la hora de la última sync no lleva fecha).
- **Impacto para Raquel:** pacientes que vienen el día o a la hora equivocados por un mensaje de su consulta, o que reciben un recordatorio de una cita que ya cancelaron.
- **Propuesta:** no enviar automáticamente recordatorios de citas con `sourceCalendarId` si ese calendario no ha sincronizado bien en la última hora o en este tick (guardar `lastOkAt` por calendario). Dejarlos en el panel como "pendiente de sincronizar". Aviso persistente (banner en Agenda y Dashboard) mientras `needsReauth` o `connected === false` con calendarios configurados, y fecha en "Última sync".
- **Esfuerzo:** M
- **Confianza:** confirmado

### [ALTA] El opt-out y "ya pedida" no frenan los reintentos automáticos
- **Ubicación:** `src/services/reminderService.js:127-131`; `src/services/reviewRequestService.js:170-175`; `isAutoSendable` `reminderService.js:174-178`, `isReviewAutoSendable` `reviewRequestService.js:230-234`.
- **Qué pasa:** `reminderState` y `reviewState` devuelven el estado del registro guardado (`error`) **antes** de comprobar `recordatorios.{canal} === false`, `recordatorios.review === false` o `already_asked`. Un `error` con `attempts < 3` se reintenta solo.
- **Escenario concreto (probado, T4/T5):** falla el email de recordatorio (SMTP caído), la paciente dice que no quiere emails y Raquel desactiva el canal en su ficha: en el siguiente tick el estado sigue siendo `error` y `isAutoSendable` = `true`, así que se envía igual. Con las reseñas: el email falla, Raquel la pide por WhatsApp (`opened`) y después el email se reintenta solo, así que se le pide dos veces. También se reintenta tras desactivar la reseña.
- **Impacto para Raquel:** mensajes a quien pidió no recibirlos (riesgo RGPD y de imagen) y peticiones de reseña repetidas.
- **Propuesta:** en los dos `*State`, comprobar primero opt-out (y en reseñas, `already_asked` por otro canal u otra cita) y solo después devolver `record.status`, salvo los estados "hechos" (`sent/opened/manual`). Test para cada caso.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [ALTA] Las citas importadas nunca tienen ubicación: mensajes "en —" y el interruptor de reseñas por ubicación no hace nada
- **Ubicación:** `src/services/googleCalendarService.js:351-366` (`eventToConsultation` no pone `locationId` e ignora `event.location`); `src/services/reviewRequestService.js:112-121,210` (sin `locationId` → "activada" + enlace general); `src/services/emailService.js:51`; plantillas `emailService.js:137`, `reminderService.js:24`; `src/components/settings/RemindersSection.jsx:142` (la vista previa usa la primera ubicación); `src/components/settings/ReviewRequestsSection.jsx:115-138` (interruptor por ubicación, sin relación con los calendarios).
- **Qué pasa:** no hay correspondencia calendario → ubicación. Toda cita que viene de Google (sobre todo las de clínicas) tiene `locationId` vacío.
- **Escenario concreto:** (a) el recordatorio por WhatsApp por defecto queda "…a las 10:00 en —." y el email pone "📍 Lugar: —", mientras la vista previa de Ajustes muestra la ubicación bien. (b) Raquel desactiva las reseñas para la "Clínica X" (porque la clínica no quiere, o tiene su propia ficha de Google). Las citas de la clínica, que vienen todas de su calendario, siguen pidiendo reseña con el enlace general en cuanto se marcan como completadas.
- **Impacto para Raquel:** mensajes con aspecto de roto, y peticiones de reseña a pacientes de una clínica en la que las había desactivado.
- **Propuesta:** campo `locationId` por calendario en Ajustes (obligatorio en los de propósito clínica), aplicado en `eventToConsultation` y en una migración para las ya importadas. Mientras falte, que la plantilla omita la frase de lugar y la vista previa use una cita sin ubicación.
- **Esfuerzo:** M
- **Confianza:** confirmado

### [ALTA] Una cita cancelada en NutriPolo de un calendario de solo lectura vuelve a "programada" con cualquier cambio en Google
- **Ubicación:** `src/services/googleCalendarService.js:331-336` (`mergeRemoteEstado` solo protege `completada`/`no_show`), `:1022-1031` (clínica), `:1227-1240` (lectura de calendarios propios en solo lectura).
- **Qué pasa:** en los calendarios de solo lectura la cancelación local no puede subir a Google. Cuando el evento cambia en Google por cualquier motivo (la recepcionista añade "pagado", cambia la sala…), el pull aplica `estado: 'programada'` y pisa la cancelación.
- **Escenario concreto (probado, T9):** la paciente avisa a Raquel de que no irá y Raquel la marca como cancelada. La clínica edita la descripción del evento, el siguiente sync la devuelve a `programada` y el recordatorio automático le sale igual.
- **Impacto para Raquel:** recordatorio de una cita que la paciente ya canceló, y la cita reaparece en la agenda como si nada.
- **Propuesta:** en calendarios donde no se puede hacer push, conservar `cancelada` local frente a `confirmed` remoto (igual que `completada`/`no_show`) y aplicar solo cambios de fecha/hora. Si Google la mueve, avisar en vez de reactivarla.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [MEDIA] Doble envío del recordatorio por email: el lote automático no vuelve a mirar el estado antes de enviar
- **Ubicación:** `src/hooks/useBackgroundJobs.js:38-50` (solo vuelve a comprobar `estado`); compárese con `:75-84` (las reseñas sí lo hacen); `src/hooks/useReminderActions.js:24-41`; `src/components/RemindersPanel.jsx:200-208`; `src/components/ConsultationModal.jsx:383-392`.
- **Qué pasa:** la lista `due` se calcula al empezar el tick y cada envío puede tardar hasta 30 s (`src-tauri/src/main.rs:329`). Si mientras tanto el recordatorio se manda a mano (panel, "Enviar todos", modal) o arranca otra ejecución (el efecto se reinicia al cambiar `connected`/`autoSync`; `inFlight` solo protege el que está enviándose en ese momento), el lote lo vuelve a enviar. Además usa `entry.client` del principio: si entretanto se deshace la vinculación (`unlinkAutoMatch`), el email va al paciente desvinculado.
- **Escenario concreto:** hay 4 recordatorios en cola con un SMTP lento. Mientras sale el primero, Raquel pulsa la flecha del cuarto en el panel. El lote llega al cuarto, ve `programada` y lo vuelve a enviar.
- **Impacto para Raquel:** pacientes que reciben el mismo recordatorio dos veces.
- **Propuesta:** antes de cada envío, recalcular `reminderState` con el estado fresco (como hace `runReviewEmails`) y el cliente fresco por `clienteId`. En `deliverEmailReminder`, no enviar si el registro del slot está en `sending/sent` salvo reenvío explícito.
- **Esfuerzo:** S
- **Confianza:** confirmado por lectura

### [MEDIA] Eventos de día completo: cita a las 09:00 inventada y, al editarla, se convierte en evento con hora en Google
- **Ubicación:** `src/services/googleCalendarService.js:114` (09:00 / 60 min), `:355-365` (no guarda `allDay`), `:413-437`; `src-tauri/src/google_calendar.rs:307-314` (`date: null` + `dateTime`); `src/services/fuzzyMatcher.js:347` (el día completo se asigna con nombre exacto o contacto).
- **Qué pasa:** un evento de día completo con nombre exacto o contacto de un cliente se importa como cita a las 09:00 y se asigna. Se le genera recordatorio "a las 09:00". Cualquier edición del usuario (incluida una nota privada) hace push y el PATCH lo convierte en un evento de 09:00 a 10:00 en Google.
- **Escenario concreto (probado, T6):** evento de día completo "Ana López" (un recordatorio interno, un cumpleaños o un viaje) → cita 09:00 de Ana con email "a las 09:00". Raquel añade una nota privada → `gcal_update_event` → en Google el evento queda de 09:00 a 10:00.
- **Impacto para Raquel:** un mensaje con una hora que no existe, y un evento de su Google modificado sin querer. Pendiente (parcial) del nº 18 de oct-2026.
- **Propuesta:** guardar `allDay` en la consulta. No generar recordatorios ni asignación automática para eventos de día completo (como mucho una sugerencia). En el push, no enviar `start/end` si no han cambiado (o mantener `date`).
- **Esfuerzo:** M
- **Confianza:** confirmado

### [MEDIA] Abrir y guardar una cita importada le pone la primera ubicación y el tipo por defecto, y la sube a Google
- **Ubicación:** `src/components/ConsultationModal.jsx:63-75` (valores por defecto de `locationId` y `tipo` por debajo de `...consultation`), `:142-146`.
- **Qué pasa:** las citas importadas no tienen `locationId` (ni `tipo` las de clínicas), así que el formulario muestra la primera ubicación y "Primera visita". `changedFields` lo cuenta como cambio aunque Raquel no toque nada (probado, T8: `{"locationId":"loc1","tipo":"Primera visita"}`). Se guarda con `localUpdatedAt` y se hace push.
- **Escenario concreto:** Raquel abre una cita de la Clínica X para mirarla y pulsa Guardar. La cita queda en "su consulta" y el recordatorio dice que la cita es en su consulta, no en la clínica. En un calendario propio, además, se reescribe el evento en Google (título y horas).
- **Impacto para Raquel:** ubicación equivocada en el mensaje al paciente, y escrituras en Google que no ha pedido.
- **Propuesta:** opción vacía "— sin ubicación —" y no aplicar valores por defecto en modo edición. Con la propuesta del hallazgo de ubicación por calendario se resuelve del todo.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [MEDIA] Plantillas que muestran valores internos o vacíos al paciente
- **Ubicación:** `src/services/googleCalendarService.js:1254` (`tipo: 'Google Calendar'`); `src/services/emailService.js:51` (cae al id crudo de la ubicación), `:54`, `:138`; `src/services/reminderService.js:183` (una plantilla personalizada con el cuerpo vacío se usa tal cual).
- **Qué pasa:** la plantilla de email por defecto incluye "🗂 Tipo: {{citaTipus}}". Las citas importadas del calendario propio llevan `tipo: 'Google Calendar'` y las de la clínica no llevan nada, así que el paciente lee "Tipo: Google Calendar" o "Tipo: —". Si se borra una ubicación, `{{citaUbicacio}}` muestra su id. Si Raquel deja vacío el cuerpo o el asunto al editar, el email automático sale vacío (el de WhatsApp no, porque cae a la plantilla por defecto). La personalización es por idioma: un cliente con `idioma: 'ca'` recibe la plantilla CA por defecto aunque ella haya personalizado la ES.
- **Impacto para Raquel:** mensajes que no parecen hechos por ella.
- **Propuesta:** no poner `tipo` técnico al importar (o no imprimirlo). Omitir en la plantilla las líneas cuyo valor sea "—". Validar que el asunto y el cuerpo no queden vacíos. Avisar en el editor de que los otros idiomas usan la plantilla por defecto.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [MEDIA] Los fallos del sync en segundo plano pasan en silencio
- **Ubicación:** `src/hooks/useBackgroundJobs.js:126-141` (`stats.errors` y los errores que no son de sesión solo van a la consola en modo dev); `src/components/CalendarView.jsx:781-788`.
- **Qué pasa:** con el sync automático, un calendario que falla (403, 404 por un calendario borrado, 5xx persistente) o un fallo general que no es de sesión no avisa nunca. El indicador de la Agenda solo refleja el sync manual, y "Última sync" muestra la hora sin fecha (la de hace tres días parece de hoy).
- **Impacto para Raquel:** cree que la agenda está al día cuando no lo está (y los recordatorios salen con esos datos, ver el hallazgo ALTA).
- **Propuesta:** guardar el último error por calendario en `syncAudit` y mostrar un indicador persistente (icono rojo + motivo) en la Agenda y el Dashboard. Fecha en "Última sync" cuando no es de hoy. Un toast si fallan varios ticks seguidos.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [MEDIA] Otros formatos de título habituales dan sugerencias basura o se pierden en silencio
- **Ubicación:** `src/services/fuzzyMatcher.js:52,62,245-247,346`.
- **Qué pasa (probado, `match.mjs`):** "Visita - Ana López" → "Visita" (genérico) → `noise`: la cita nunca recibe paciente ni sugerencia, y por tanto tampoco recordatorio. "Cita con Ana López" → sugerencia "con Ana López" (nueva ficha) aunque Ana existe. "Dietista: Pedro Ruiz", "Revisión dieta Ana López" y "NUTRI Ana López" → "crear ficha" con ese texto como nombre, en lugar de proponer el cliente existente.
- **Impacto para Raquel:** fichas duplicadas con nombres raros y citas de clientes reales sin recordatorio, sin que se entere.
- **Propuesta:** mismo arreglo que el hallazgo crítico de agrupación (lista de prefijos y palabras de tipo, "con" tras "cita", prefijos con ":"), y tests con estos títulos.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [MEDIA] La cola de WhatsApp y "Enviar todos" trabajan sobre una foto fija
- **Ubicación:** `src/components/RemindersPanel.jsx:103-128` (`entries` se fija al abrir), `:191-208`, `:325-341`.
- **Qué pasa:** la cola guarda las entradas al abrirla y cada paso usa `entry.consultation` y `entry.client` de ese momento. Si el sync en segundo plano mueve o cancela una cita mientras Raquel recorre la cola, se abre WhatsApp con el texto de la hora vieja (o de una cita cancelada) y se marca `opened` para el slot viejo.
- **Impacto para Raquel:** poco frecuente, pero el mensaje es al paciente y con datos erróneos.
- **Propuesta:** en cada paso, volver a leer la consulta del store por id, saltar las que ya no son `programada` o cuyo slot cambió, y regenerar el texto si no se ha editado.
- **Esfuerzo:** S
- **Confianza:** confirmado por lectura

### [MEDIA] Reintento automático tras un error parcial del SMTP o un cierre a mitad de envío puede duplicar
- **Ubicación:** `src/services/reminderService.js:41,128,174-178`; `src/hooks/useReminderActions.js:29-39`; `src/App.jsx:371-379` (el autobloqueo recarga la página); `src-tauri/src/main.rs:329,410-413`.
- **Qué pasa:** un `error` se reintenta hasta 3 veces. Un `sending` de más de 10 min pasa a `error` y también se reintenta. Si el servidor aceptó el mensaje pero la respuesta no llegó (timeout de 30 s), o la app se recargó o cerró a mitad (autobloqueo, cierre forzado), el email ya salió y se manda otra vez.
- **Impacto para Raquel:** duplicados ocasionales.
- **Propuesta:** no reintentar automáticamente un `sending` caducado (dejarlo "por confirmar" en el panel). Reintentar solo errores claramente previos al DATA (conexión, autenticación). Generar un `Message-ID` estable por consulta y slot para que el cliente de correo agrupe duplicados.
- **Esfuerzo:** M
- **Confianza:** probable (no se ha reproducido contra un SMTP real)

### [MEDIA] "Resetear agenda": borrado total sin deshacer junto al botón de sincronizar, y vuelven a salir recordatorios ya enviados
- **Ubicación:** `src/components/CalendarView.jsx:651-672,770-778`; `src/stores/store.js:1249-1255`; textos `src/i18n.js:781,786`.
- **Qué pasa:** un icono de papelera rojo al lado de "Sincronizar" borra **todas** las consultas: también las locales con notas, las que tienen mediciones o facturas, y el estado de los recordatorios. También vacía `_history`, así que no se puede deshacer. Al resincronizar, los eventos de Google vuelven sin `reminders` ni `reviewRequest` y se vuelven a enviar recordatorios ya enviados. El título del botón ("eliminar todas las consultas y eventos") contradice el mensaje ("los eventos de Google NO se verán afectados").
- **Impacto para Raquel:** un mal clic más una confirmación borran su historial de citas (nº 62 de oct-2026: el recuento ya está arreglado, pero el riesgo sigue).
- **Propuesta:** moverlo a Ajustes → Avanzado, ofrecer solo "quitar las importadas de Google", hacer copia de seguridad automática antes, conservar el estado de los recordatorios por `googleEventId` y unificar los textos.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [MEDIA] Con el autobloqueo activado, el segundo plano se para en silencio
- **Ubicación:** `src/App.jsx:353-389` (el temporizador solo se reinicia con eventos de la propia ventana); `src/hooks/useBackgroundJobs.js` (solo funciona desbloqueado).
- **Qué pasa:** con `autoLockMinutes > 0` y la app en la bandeja, nunca hay `mousemove` en su ventana. A los N minutos se bloquea y recarga, y a partir de ahí no hay sync ni recordatorios automáticos hasta que Raquel la desbloquee. Ajustes no avisa de esto (`security_auto_lock_hint`).
- **Impacto para Raquel:** activa los recordatorios automáticos y el bloqueo, y los recordatorios dejan de salir sin ningún aviso.
- **Propuesta:** avisar en Ajustes de que el bloqueo para los envíos automáticos, y mostrar en la pantalla de desbloqueo cuántos recordatorios han quedado pendientes. Decidir si el bloqueo debe parar o no el segundo plano.
- **Esfuerzo:** S
- **Confianza:** confirmado por lectura

### [BAJA] Propósito y modo de sync independientes: "clínica" + "bidireccional" deja editar cambios que se pierden
- **Ubicación:** `src/components/SettingsView.jsx:852-871`; `src/components/ConsultationModal.jsx:53` (`isReadonly` solo mira `syncMode`); `src/stores/store.js:864-868,227`.
- **Qué pasa:** un calendario `external-clinic` con `bidirectional` no sube nada (`canPushToCalendar`), pero el modal deja cambiar fecha y hora sin avisar, y el siguiente cambio remoto lo pisa. `inferCalendarPurpose` clasifica como clínica cualquier calendario con "nutri" en el nombre ("Nutrición Raquel").
- **Propuesta:** forzar `readonly` al elegir clínica o personal, y usar `canPushToCalendar` en el modal para el aviso.
- **Esfuerzo:** S
- **Confianza:** confirmado por lectura

### [BAJA] Vincular el paciente desde el modal sí escribe en Google (renombra el evento)
- **Ubicación:** `src/stores/store.js:1222-1234` (vincular a mano → `matchedBy: 'user'`); `src/services/googleCalendarService.js:409-411`; `src/components/ConsultationModal.jsx:142-146`.
- **Qué pasa:** CLAUDE.md dice "Assignar no escriu mai a Google". Desde la bandeja de sugerencias se cumple. Desde el modal, cambiar el cliente es una edición: hace push y el título de Google pasa a "Consulta - <Nombre>", y se pierde lo que había escrito la recepcionista ("… - pagado", "sala 2").
- **Propuesta:** conservar `googleSummary` también en las vinculaciones manuales de eventos importados, o avisar antes de renombrar.
- **Esfuerzo:** S
- **Confianza:** confirmado por lectura

### [BAJA] OAuth: no se puede cancelar y queda código muerto
- **Ubicación:** `src-tauri/src/google_calendar.rs:19,463-506` (`_client_secret` sin usar, espera de 180 s); `src/components/SettingsView.jsx:472-482` (sin botón de cancelar; fallback `urn:ietf:wg:oauth:2.0:oob`, retirado por Google).
- **Qué pasa:** si Raquel cierra la pestaña del navegador sin autorizar, la UI se queda "conectando" 3 minutos.
- **Propuesta:** botón "Cancelar" que libere el listener, y quitar el fallback `oob` y el parámetro sin usar.
- **Esfuerzo:** S
- **Confianza:** confirmado por lectura

### [BAJA] Se listan todos los eventos con `showDeleted` en cada sync (sin `syncToken`)
- **Ubicación:** `src-tauri/src/google_calendar.rs:618-647`.
- **Qué pasa:** cada 5 min se pide la ventana completa de 120 días con los borrados incluidos. Funciona con este volumen, pero gasta cuota y depende de cuánto tiempo guarda Google los borrados (lo cubre en parte `_reconcileMissing`, 25 por sync).
- **Propuesta:** sync incremental con `syncToken` por calendario y lista completa solo al empezar o al recibir un 410.
- **Esfuerzo:** M
- **Confianza:** confirmado — Pendiente de la auditoría de oct-2026 (nº 26)

## Pendientes de la auditoría de oct-2026

- **Nº 18** (eventos de día completo que pasan a 60 min): **sigue abierto en parte**. El PUT ya es PATCH y se conservan invitados y demás campos, pero un push de un evento de día completo lo sigue convirtiendo en 09:00-10:00 (ver el hallazgo MEDIA de día completo).
- **Nº 26** (`showDeleted` sin `syncToken`): **sigue abierto** (BAJA).
- **Nº 44** (el sync hace N `set()`): sigue abierto. No lo he medido; es de la sesión de rendimiento.
- **Nº 62** (reset de agenda): el recuento ya está arreglado, pero el riesgo de borrado sigue (ver el hallazgo MEDIA).
- **Arreglados y comprobados:** 13, 14, 15, 16, 17, 19 (tombstones), 20, 21 (loopback 127.0.0.1:0, `state`, varias conexiones, timeout), 22, 23, 24 (solo `defaultPushCalendarId`), 25 (`persistToken` lee el config fresco), 27, 28, 54, 56 (`changedFields`), 73, 75, 85, 86, 87 (`setConsultationReminder` sin `localUpdatedAt`), 88, 89 (casi del todo), 90 (TLS según el puerto). `ConsultationsView.jsx` ya no existe.

## Lo que está bien (breve, para no tocarlo)

- Una sola cola de escrituras a Google (`enqueue`), `syncAll` compartido entre llamadas a la vez y refresco de token deduplicado (`_refreshPromise`). Tras un 401 se reintenta con el token nuevo.
- Ids de evento deterministas (`googleEventIdFor`) con 409 → PATCH: no hay duplicados ni en reintentos ni en carreras. Probado también en el test del repo.
- `SYNC_FIELDS` y `BOOKKEEPING_FIELDS` filtrados en las ediciones del usuario. Los recordatorios y reseñas no tocan `localUpdatedAt`. `lastSyncedAt` = momento antes del request (una edición hecha durante el vuelo no se pierde).
- Tombstones (`gcalPendingDeletes`) escritos antes del request: si se cierra la app con un borrado pendiente, se reintenta y no se reimporta. Deshacer restaura en Google (`restoreRemote`).
- Guardia de borrado masivo con banner para resolverla. `_reconcileMissing` para eventos movidos fuera de la ventana. Los borrados en Google conservan las citas con datos propios.
- El emparejamiento solo asigna solo si el organizador es el propio calendario (las invitaciones de otros solo se proponen). Ninguna escritura del matching sube a Google (test del repo). `unlinkAutoMatch` sin escribir en Google y sin volver a asignar. Las tildes y la ñ se normalizan bien. El teléfono ignora espacios y +34/0034.
- OAuth: PKCE S256, `state` aleatorio de 32 caracteres, scopes mínimos, comprobación del scope concedido, `invalid_grant` → reconectar. Cliente HTTP con timeouts y errores con status + reason bien clasificados.
- Recordatorios: el `slot` vuelve a activarse al reprogramar (probado, T10), hay horas de silencio y `minLeadHours`, las reseñas automáticas solo salen para `completada` y una vez por cliente, las cabeceras SMTP se sanean (en JS y en Rust), y el texto de wa.me va con `encodeURIComponent`.

## Fuera de mi área (notas para otras sesiones)

- **Código / tests:** `npm test` recoge también los tests de las carpetas `.claude/worktrees/*` (hay 9 worktrees antiguos), así que los 110 ficheros y 1.899 tests incluyen copias de versiones viejas. Un test roto en un worktree abandonado haría fallar la suite, y uno nuevo del repo puede quedar tapado. Conviene `exclude: ['.claude/**']` en la config de vitest.
- **Datos / seguridad:** al borrar un cliente (`store.js:908-913`), sus citas sincronizadas quedan en Google con el título "Consulta - <Nombre>" (dato personal fuera de la app tras la baja) y en local sin cliente.
- **Datos:** "Resetear agenda" (ver el hallazgo MEDIA) borra consultas que pueden estar enlazadas a facturas y mediciones, sin copia de seguridad previa.
