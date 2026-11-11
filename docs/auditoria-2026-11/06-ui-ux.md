# 06 — Diseño, UI/UX y accesibilidad  (auditoría nov-2026, v1.18.1)

## Resumen

La base visual está bien resuelta: paleta con variables y modo oscuro, ningún color de Tailwind sin tema en los componentes, contraste AA de `sage-400` ya corregido (4,8:1), modales accesibles (rol, trampa de foco, Escape), foco visible global e i18n ES/CA completa con *fallback*. Los problemas están en **los flujos y en las protecciones**: varios gestos normales (clic fuera del modal, Escape, Ctrl+1…7 con el foco en un botón) tiran lo escrito sin avisar, los borrados se confirman con Enter sobre un botón no destructivo, y dos flujos diarios terminan fuera de la app (enviar una factura por email, enviar la planificación desde su editor). En la agenda, una cita cancelada que viene de Google se ve igual que una programada. El cierre de trimestre no tiene ni filtro trimestral ni exportación.

Recorrido hecho en el navegador integrado (`nutripolo-dev-alt`, 1366×768 y 1093×614 ≈ portátil con escalado del 125 %), con un paciente ficticio y datos de prueba en el `localStorage` del navegador de preview (nada real). Fuera de Tauri fallan los `invoke` (PDF a disco, SMTP, Google): esos pasos se han revisado solo en el código. Capturas en la carpeta de notas compartidas: `side-session-notes/local_21b9c805-…/06-ui-ux-capturas/` (01–07).

| Severidad | Nº |
|---|---|
| CRÍTICA | 0 |
| ALTA | 7 |
| MEDIA | 13 |
| BAJA | 7 |
| **Total** | **27** |

### Flujos clave (clics contados desde el Dashboard, con lo que hace dudar)

| Flujo | Clics aprox. | Puntos de duda / bloqueo |
|---|---|---|
| **Primera visita**: crear ficha → entrevista → medición → necesidades → planificación → PDF → email | ~16 + 2 cambios de vista | Tras crear el cliente se queda en el Dashboard (hay que ir a Clientes y buscarlo). Si la paciente no existe y Raquel empezó por "Nueva cita", no puede crearla desde ahí. Nivel de actividad "Moderado" ya marcado. El editor de planificación no tiene "Enviar": hay que cerrarlo, ir a **Planes** (lista de todos los pacientes), buscar la fila y pulsar el sobre. Sin SMTP, el aviso dice "PDF adjunto listo" y no se adjunta. |
| **Seguimiento**: pesaje → gráfica → nueva planificación copiada | ~8 | La fila de la cita en "Agenda de hoy" no abre la ficha. La búsqueda de "Jose" no encuentra "José". En la tabla, la sugerencia de % muscular parece un dato guardado. La copia de la última planificación es automática y avisa de dónde viene (bien). |
| **Cobrar**: consulta → factura → PDF → email | ~10 + todo el email a mano | Cada "Guardar" de la factura abre "Guardar como". No hay forma de enviarla por email desde la app (el modo "factura" del modal de email no se abre desde ningún sitio). La ficha muestra las facturas pero no se pueden abrir. |
| **Agenda del día**: Dashboard → calendario → recordatorios WhatsApp → sugerencias | 1 por recordatorio | "Consultas hoy" cuenta las canceladas y "Próxima: 09:00" puede estar ya pasada. Tras abrir WhatsApp la app dice "Recordatorio enviado" aunque no se haya pulsado enviar. Cita cancelada de Google = idéntica a programada. |
| **Cierre de trimestre** | 1 por factura | Solo filtro por año y estado; ni trimestre, ni exportación, ni base/IVA/IRPF en la lista. Hay que abrir y sumar a mano. |
| **Ajustes y primera puesta en marcha** | — | Datos personales se guardan solos; ubicaciones y horas bloqueadas piden "Guardar"; la ubicación se borra sin confirmar. Google pide "Client ID / Client Secret" (en inglés, lo tiene que hacer Javier). |

## Hallazgos

### [ALTA] Los atajos globales (Ctrl+1…7, Ctrl+Z) actúan con un modal o el editor abierto y tiran el trabajo sin avisar
- **Ubicación:** `src/App.jsx:427-445` (solo excluye `INPUT`/`TEXTAREA`/`contentEditable`); editores montados dentro de la vista: `src/components/ClientDetailView.jsx:383-386`, `src/components/NutritionPlanEditor.jsx:600-606`.
- **Qué pasa:** el manejador de teclado global ignora si hay un diálogo abierto. Con el foco en un botón, un `select` o un checkbox del modal (o del editor de planificación a pantalla completa), Ctrl+1…7 cambia `currentView`, la vista se desmonta y con ella el modal y su estado; Ctrl+Z deshace la última acción del store por detrás del formulario.
- **Escenario concreto:** (comprobado en el navegador) Ficha → "Nuevo plan" → escribir en "Objetivos del plan" → clic en "Datos generales" del menú lateral → Ctrl+1. Resultado: aparece el Dashboard, el editor desaparece, `nutritionPlans` sigue vacío y no sale el aviso "Hay cambios sin guardar". Igual con "Nueva cita" o "Nueva factura" tras tocar un desplegable.
- **Impacto para Raquel:** pierde media planificación con una tecla que usa a diario para moverse, sin ninguna pregunta.
- **Propuesta:** en el manejador, salir si hay un diálogo abierto (`dialogStack.length > 0` de `useDialogA11y`, o `document.querySelector('[aria-modal="true"]')`), y excluir también `SELECT`. Ctrl+Z solo fuera de diálogos.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [ALTA] Un clic fuera del modal o Escape cierra los formularios y se pierde lo escrito
- **Ubicación:** `src/components/UI.jsx:518-522` (fondo con `onClick={onClose}`), Escape en `useDialogA11y` (`UI.jsx:175-227`); afecta a `ClientModal`, `ConsultationModal`, `InvoiceModal`, `ServicesView`, `SendEmailModal`, `DocumentMetadataModal`. Solo `PlanificacionEditor.jsx:807-810` pregunta antes.
- **Qué pasa:** `Modal` cierra con cualquier clic en el fondo y con Escape, sin saber si el formulario tiene cambios.
- **Escenario concreto:** (comprobado) "Nuevo cliente" → escribir el nombre → clic en la zona gris de la derecha → el modal desaparece y el nombre se ha perdido. También pasa al soltar fuera una selección de texto hecha con el ratón dentro de un campo.
- **Impacto para Raquel:** rellena una ficha o una factura larga, un clic de más o un Escape para cerrar un desplegable, y vuelve a empezar.
- **Propuesta:** prop `dirty` (o `confirmClose`) en `Modal`: si hay cambios, el fondo no cierra y Escape/✕ preguntan "¿Descartar cambios?" con `useConfirm`. Opcional: que el fondo no cierre nunca los modales de formulario.
- **Esfuerzo:** S–M
- **Confianza:** confirmado

### [ALTA] Los borrados se confirman con un botón no destructivo enfocado: Enter borra, y sin "Deshacer" a la vista
- **Ubicación:** `src/components/ClientsView.jsx:55`, `src/components/Invoices.jsx:54`, `src/components/NutritionPlanEditor.jsx:437`, `src/components/client/FollowUpTable.jsx:97`, `src/components/ServicesView.jsx:84` (todas `confirm(string)` → `danger: false`); foco inicial en `UI.jsx:244`.
- **Qué pasa:** con `danger: false` el botón es el primario verde y recibe el foco, así que Enter confirma. Solo documentos, citas, agenda y copias usan `danger: true`. Los toasts de borrado no llevan acción "Deshacer" (el `Toast` ya la admite, `UI.jsx:82-89`).
- **Escenario concreto:** Clientes → papelera de la fila (está al lado del lápiz, ver captura 06) → Enter. Se borran la ficha, consultas, mediciones y planes, y **los documentos se borran del disco para siempre** (`ClientsView.jsx:57`), aunque el texto diga "Ctrl+Z para deshacer".
- **Impacto para Raquel:** un Enter de más borra a una paciente con sus PDF; deshacer solo devuelve una parte y tiene que saber que existe Ctrl+Z.
- **Propuesta:** `danger: true` y título en todos los borrados; botón "Deshacer" en el toast (`toast.success(msg, 8000, { label: t.undo, onClick: undo })`); para el cliente, aplazar el borrado de la carpeta de documentos hasta que caduque el deshacer.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [ALTA] Agenda: las citas que vienen de Google ignoran el estado (cancelada = programada) y en modo oscuro no se leen
- **Ubicación:** `src/components/CalendarView.jsx:66-75` (`calStyle`), `:247-253` y `:466` (mes).
- **Qué pasa:** si el calendario de origen tiene color, la cita usa ese color al 13 % con texto `#1a1a1a` fijo y se salta `STATUS_BG` (tachado y rojo de cancelada, gris de no presentado). En oscuro, el texto casi negro queda sobre la celda oscura (≈1,1:1).
- **Escenario concreto:** (comprobado con datos de prueba) tres citas de hoy: 15:00 programada de Google, 16:00 cancelada en Google (`remoteDeleted`), 17:00 cancelada local. Estilos calculados: la de 15:00 y la de 16:00 son idénticas (`rgba(3,155,229,.13)`, sin tachado); solo la local sale tachada. En oscuro, las dos de Google son ilegibles (captura 02).
- **Impacto para Raquel:** prepara la consulta de una paciente que canceló, o no ve sus citas si usa el tema oscuro.
- **Propuesta:** usar el color del calendario solo como borde izquierdo y mantener el fondo/texto de `STATUS_BG` (con tachado para cancelada y no presentado); nada de `#1a1a1a`.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [ALTA] Email sin SMTP: dice "PDF adjunto listo" y el PDF no se adjunta; el selector de modo permite mandar el plan como "factura"
- **Ubicación:** `src/components/SendEmailModal.jsx:286-289` (aviso), `:187-191` (selector de modo siempre visible), `src/services/emailService.js:444` (`openMailClient` = enlace de Gmail sin adjunto).
- **Qué pasa:** sin SMTP el botón es "Abrir cliente de correo" y se abre Gmail con asunto y cuerpo, pero un enlace no puede llevar adjuntos; aun así se muestra "PDF adjunto listo para enviar". Además, desde "Enviar plan" se puede cambiar a "Factura" o "Cita": se rehace la plantilla y, con SMTP, se envía el PDF del plan con nombre `factura.pdf`.
- **Escenario concreto:** Planes → sobre de una planificación → (SMTP sin configurar) → "Abrir cliente de correo" → Gmail se abre sin adjunto; Raquel envía y la paciente recibe un email que habla de su plan sin el plan.
- **Impacto para Raquel:** la paciente recibe un correo vacío de contenido; o un PDF con nombre equivocado.
- **Propuesta:** si hay adjunto fijo, ocultar el selector de modo. Sin SMTP, sustituir el aviso por "Gmail no permite adjuntar automáticamente: guarda el PDF y arrástralo" con botón "Guardar PDF", o pedir configurar SMTP.
- **Esfuerzo:** S
- **Confianza:** confirmado (código; el envío real no se puede ejecutar fuera de Tauri)

### [ALTA] Enviar por email: las facturas no se pueden enviar y la planificación no se envía desde su editor ni desde la ficha
- **Ubicación:** `src/components/plan/PlanificacionEditor.jsx:897-904` (cabecera: Vista previa, Descargar PDF, Guardar), `src/components/ClientDetailView.jsx:321-339` (planes de la ficha: solo abrir), `src/components/Invoices.jsx:186-209` y `src/components/InvoiceModal.jsx:191-207` (sin email). El modo `invoice` de `SendEmailModal` no se abre desde ningún sitio (`grep mode="invoice"` → 0).
- **Qué pasa:** el único punto para enviar un plan es el icono de sobre de la lista global de Planes; para facturas no hay ninguno. Tampoco se guarda el PDF de la factura en los documentos de la paciente.
- **Escenario concreto:** primera visita: termina la planificación en el editor → busca "Enviar" → no existe → cierra → Planes → localiza la fila entre todas las pacientes → sobre. Cobro: guarda la factura → "Guardar como" → abre Gmail aparte → adjunta a mano.
- **Impacto para Raquel:** el paso final de los dos flujos que más repite sale de la app o le obliga a dar vueltas.
- **Propuesta:** botón "Enviar por email" en la cabecera del editor (genera el PDF con `generate()` y abre `SendEmailModal mode="plan"`), los mismos tres iconos (PDF, guardar en ficha, email) en la lista de planes de la ficha, y "Enviar" en la fila de facturas y en el modal (modo `invoice`, que ya existe).
- **Esfuerzo:** M
- **Confianza:** confirmado

### [ALTA] Cierre de trimestre: sin filtro trimestral, sin exportación y sin desglose base / IVA / IRPF
- **Ubicación:** `src/components/Invoices.jsx:91-136`.
- **Qué pasa:** filtros solo por año y estado; el resumen da total, cobrado y pendiente (con IVA e IRPF mezclados); no hay CSV/Excel ni descarga de los PDF del periodo.
- **Escenario concreto:** el gestor pide los ingresos del 3T: Raquel filtra 2026, revisa fechas a ojo y abre cada factura para apuntar base, IVA e IRPF.
- **Impacto para Raquel:** una tarde por trimestre copiando cifras, con riesgo de equivocarse en datos fiscales.
- **Propuesta:** selector de trimestre (1T–4T) junto al año, columnas o resumen con base imponible, IVA, IRPF y total del periodo, y botón "Exportar para el gestor" (CSV con una fila por factura + ZIP de PDF opcional). Coordinar con la sesión de facturación.
- **Esfuerzo:** M
- **Confianza:** confirmado

### [MEDIA] Modo oscuro: en la ficha, el título de los planes, el nombre de los documentos y el filtro de tipo son invisibles
- **Ubicación:** `src/components/ClientDetailView.jsx:325-331`, `src/components/ClientDocuments.jsx:122,148,158`.
- **Qué pasa:** clases `dark:bg-sage-800` / `dark:text-sage-100`. Como `sage` ya se invierte en oscuro, `sage-100` es casi negro; además `[data-theme="dark"] .bg-white` (`styles.css`) gana a `dark:bg-sage-800`, así que el fondo queda oscuro.
- **Escenario concreto:** (comprobado) tema oscuro → ficha → Planes: título `rgb(34,33,29)` sobre `rgb(38,37,32)` (1,05:1); el `select` de documentos `rgb(48,47,42)` sobre el mismo fondo (captura 01).
- **Impacto para Raquel:** con el tema oscuro (o "Automático" con Windows en oscuro) no sabe qué plan abre.
- **Propuesta:** quitar todas las clases `dark:` de esos dos ficheros (la paleta ya se adapta sola); añadir a la revisión que no aparezcan `dark:` en componentes.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [MEDIA] Dashboard: "Consultas hoy" cuenta las canceladas y "Próxima" puede ser una hora ya pasada
- **Ubicación:** `src/components/Dashboard.jsx:130,140`, `:233`; `src/stores/store.js:1588-1594`.
- **Qué pasa:** el contador usa todas las citas del día (también canceladas y no presentadas); "Próxima" es la primera `programada` del día aunque ya haya pasado. La insignia de una cita programada dice "Pendiente" (en la agenda y en la ficha, "Programada").
- **Escenario concreto:** (comprobado) a las 13:00, con 09:00 programada, 15:00 programada y dos canceladas: "Consultas hoy 4 · Próxima: 09:00".
- **Impacto para Raquel:** el resumen de la mañana miente; no sabe cuántas pacientes le quedan.
- **Propuesta:** contar solo programadas y completadas; "Próxima" = primera programada con hora ≥ ahora; usar `status_programada`.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [MEDIA] Entre paciente y paciente no hay acceso directo a la ficha (Agenda de hoy, cita, recordatorios)
- **Ubicación:** `src/components/Dashboard.jsx:204-237` (filas sin `onClick`), `src/components/ConsultationModal.jsx` (sin enlace a la ficha).
- **Qué pasa:** la fila de "Agenda de hoy" no es clicable y el modal de la cita no lleva a la ficha.
- **Escenario concreto:** llega la paciente de las 15:00 → Clientes → buscar → abrir → Mediciones: 4 pasos y teclear, cada vez.
- **Impacto para Raquel:** pierde tiempo en el momento más justo del día.
- **Propuesta:** fila clicable (abre la ficha con `setSelectedClientId` + `setCurrentView('clients')`) y botón "Abrir ficha" en el modal de la cita.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [MEDIA] WhatsApp: la app dice "Recordatorio enviado" cuando solo ha abierto el chat
- **Ubicación:** `src/hooks/useReminderActions.js:79,104`; texto en `src/i18n.js:158` (ES) y equivalentes CA/EN.
- **Qué pasa:** se abre wa.me con el texto y se muestra un toast de éxito "Recordatorio enviado por WhatsApp"; el estado guardado es `opened`.
- **Escenario concreto:** pulsa WhatsApp, se abre la app de WhatsApp, la distrae otra cosa y no pulsa enviar; la app le ha dicho que ya está enviado.
- **Impacto para Raquel:** cree que la paciente tiene el recordatorio y no es así.
- **Propuesta:** "Chat de WhatsApp abierto: pulsa enviar allí" y que el estado se vea como "Abierto" (no "Enviado") en el panel.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [MEDIA] Tabla de seguimientos: la sugerencia calculada parece un dato guardado
- **Ubicación:** `src/components/client/FollowUpTable.jsx:130-140`, `src/components/client/fields.jsx:10` (`placeholder-sage-500`).
- **Qué pasa:** el % de masa muscular sugerido se muestra como *placeholder* gris (`rgb(117,114,106)`), casi igual que el IMC calculado (`sage-500`), pero no se guarda: la gráfica y el histórico no lo tienen.
- **Escenario concreto:** (comprobado) peso 72,5 y masa muscular 30 → la casilla de % muestra "41,4"; el valor guardado es vacío (captura 04).
- **Impacto para Raquel:** cree que tiene el dato registrado y luego falta en la evolución.
- **Propuesta:** placeholder más claro y en cursiva con "≈", o rellenar la sugerencia con Tab/Enter, o guardarla calculada como el IMC.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [MEDIA] La búsqueda de clientes y Ctrl+K no ignoran acentos ni espacios del teléfono
- **Ubicación:** `src/components/ClientsView.jsx:40-42`, `src/components/CommandPalette.jsx:100-104` (y `:119-121` consultas).
- **Qué pasa:** comparación con `toLowerCase().includes`; el `Combobox` de `UI.jsx:646` ya normaliza acentos, estas dos búsquedas no.
- **Escenario concreto:** buscar "jose" no encuentra "José"; "600 12" no encuentra "600123456".
- **Impacto para Raquel:** cree que la paciente no existe y crea una ficha duplicada.
- **Propuesta:** reutilizar el `normalize` de `UI.jsx` y quitar espacios y `+34` al comparar teléfonos.
- **Esfuerzo:** S
- **Confianza:** confirmado (código)

### [MEDIA] Ficha del cliente: consultas y pagos no se pueden abrir; los estados salen en crudo
- **Ubicación:** `src/components/ClientDetailView.jsx:262-305` (consultas), `:337` (plan), `:358-377` (pagos), `src/components/CommandPalette.jsx:130`.
- **Qué pasa:** las tarjetas de consultas y facturas no tienen acción (ni abrir, ni PDF). Se muestra `{c.estado}` y `{p.estado}` tal cual ("programada", "no_show", "borrador") en vez de `StatusBadge`/`t.status_*`, y "04/11/2026 — " cuando no hay fecha de fin.
- **Escenario concreto:** para descargar de nuevo la factura de una paciente hay que ir a Facturación y buscarla; en la ficha ve "no_show".
- **Impacto para Raquel:** la ficha no sirve de punto de partida; textos técnicos.
- **Propuesta:** abrir `ConsultationModal`/`InvoiceModal` al pulsar; reutilizar los badges de estado traducidos; ocultar "—" si falta la fecha.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [MEDIA] Guardar una factura abre siempre "Guardar como", también para marcarla como pagada
- **Ubicación:** `src/components/InvoiceModal.jsx:191-207`.
- **Qué pasa:** cada guardado genera el PDF y abre el diálogo de archivo.
- **Escenario concreto:** cambiar "Pendiente" → "Pagada" → Guardar → diálogo de Windows → Cancelar.
- **Impacto para Raquel:** un diálogo inútil cada vez y la duda de si se ha guardado.
- **Propuesta:** "Guardar" solo guarda; botón aparte "Guardar y descargar PDF" (o PDF desde la fila); guardar el PDF también en documentos de la paciente.
- **Esfuerzo:** S
- **Confianza:** confirmado (código)

### [MEDIA] Modal de email: errores en crudo, cambios de idioma que borran lo escrito, adjunto sin acentos y selector de cliente enorme
- **Ubicación:** `src/components/SendEmailModal.jsx:156` (muestra `result.error` tal cual: `smtp_password_not_configured`, `mail_client_open_failed` o el texto de Rust), `:222-228` y `:187-191` (cambiar idioma o modo rehace asunto y cuerpo sin preguntar), `:197-208` (`<select>` con todas las pacientes), `src/services/emailService.js:435` (`Planificación 3` → `Planificaci_n_3.pdf`).
- **Escenario concreto:** Raquel personaliza el mensaje, pulsa "CA" para ver la versión en catalán y pierde su texto; o ve "Error: smtp_password_not_configured".
- **Impacto para Raquel:** mensajes que no entiende y trabajo perdido; el paciente recibe un adjunto con nombre feo.
- **Propuesta:** traducir códigos con `reminderErrorText`; pedir confirmación si el cuerpo se ha editado; `Combobox`; usar `planPdfFileName` (mismo nombre que la descarga).
- **Esfuerzo:** S
- **Confianza:** confirmado (código)

### [MEDIA] Nueva ficha: un error en otra pestaña no se ve y el nivel de actividad viene marcado
- **Ubicación:** `src/components/ClientModal.jsx:67-69` (no cambia de pestaña al validar), `:48` (`nivelActividad: 'moderado'`).
- **Qué pasa:** si falta el nombre o el email es inválido y Raquel está en "Salud" u "Objetivos", "Guardar" no hace nada visible. El nivel "Moderado" ya marcado alimenta el factor de actividad 1,55 de las necesidades (`services/energia.js:109`).
- **Escenario concreto:** rellena salud y objetivos primero, pulsa Guardar con el email mal escrito: no pasa nada.
- **Impacto para Raquel:** cree que la app se ha colgado; NEED calculada con una actividad que no eligió.
- **Propuesta:** saltar a la primera pestaña con error (y toast); `nivelActividad: ''` por defecto.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [MEDIA] Paciente nueva: "Nueva cita" no deja crear la ficha y, al crear una ficha, no se abre
- **Ubicación:** `src/components/ConsultationModal.jsx:233-238` (Combobox sin "crear"), `src/components/ClientModal.jsx:72-79` (`onClose` sin navegar).
- **Escenario concreto:** llama alguien nuevo: Nueva cita → la paciente no está → cancelar (se pierde fecha y hora) → Nuevo cliente → Guardar → sigue en el Dashboard → Nueva cita otra vez. Para la entrevista, Clientes → buscar → abrir.
- **Impacto para Raquel:** 4–5 clics y re-teclear en el flujo de primera visita.
- **Propuesta:** opción "Crear «texto»" en el Combobox que abre `ClientModal` prerrellenado y vuelve a la cita; tras crear desde el Dashboard o Clientes, abrir la ficha nueva.
- **Esfuerzo:** M
- **Confianza:** confirmado

### [MEDIA] Editor de planificación en un portátil con escalado 125 %: el menú semanal queda recortado
- **Ubicación:** `src/components/plan/PlanificacionEditor.jsx:770` (`showPreview` siempre `true` al abrir), `:966` (vista previa al 40 %).
- **Qué pasa:** a 1093×614 px (1366×768 al 125 %) el área de edición mide 424 px y la rejilla del menú 600 px: se ven lunes a jueves y hay que desplazar en horizontal. La preferencia de ocultar la vista previa no se recuerda.
- **Escenario concreto:** (medido en el navegador) abrir una planificación → Menú semanal → viernes a domingo fuera de la vista.
- **Impacto para Raquel:** en pantallas pequeñas trabaja con la mitad del espacio.
- **Propuesta:** recordar el estado de la vista previa (store), abrirla cerrada por debajo de ~1280 px, o hacerla redimensionable.
- **Esfuerzo:** S
- **Confianza:** probable (falta confirmar la resolución y el escalado reales del equipo de Raquel)

### [MEDIA] Los documentos de la paciente están escondidos dentro de la pestaña "Planes"
- **Ubicación:** `src/components/ClientDetailView.jsx:94-101` (pestañas) y `:347-354`.
- **Qué pasa:** no hay pestaña "Documentos"; analíticas e informes se suben y se buscan bajo "Planes".
- **Escenario concreto:** la paciente trae una analítica; Raquel busca "Documentos" en la ficha y no lo encuentra.
- **Impacto para Raquel:** duda y clics de exploración.
- **Propuesta:** pestaña propia "Documentos" (y la lista de planes solo con planes).
- **Esfuerzo:** S
- **Confianza:** confirmado

### [BAJA] El diálogo de confirmación junta todas las líneas en una
- **Ubicación:** `src/components/UI.jsx:268` (sin `whitespace-pre-line`); afecta a `src/components/PatientSuggestionsInbox.jsx:404-407` ("Confirmar todas" con la lista de nombres).
- **Impacto para Raquel:** la lista de qué se va a vincular es un párrafo ilegible justo antes de aceptar.
- **Propuesta:** `whitespace-pre-line` en el mensaje (y `max-h` con scroll).
- **Esfuerzo:** S
- **Confianza:** confirmado (código)

### [BAJA] "Clientes" en el menú vuelve a la última ficha abierta, no a la lista
- **Ubicación:** `src/App.jsx:489`, `selectedClientId` persistente en `src/stores/store.js:1114`.
- **Escenario concreto:** (comprobado) ficha abierta → Agenda → Clientes → sale otra vez la ficha; pulsar "Clientes" estando en la ficha no hace nada.
- **Propuesta:** al pulsar el elemento activo del menú (o Ctrl+3), limpiar `selectedClientId`.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [BAJA] Detalles de contraste, tamaño y foco
- **Ubicación:** ejes de la gráfica a 10 px (`src/components/MeasurementChart.jsx:60-65`, regla ≥ 11 px); chips "Fuera de plazo" `text-sage-400` sobre `bg-sage-100` a 11 px = 4,32:1 (`src/components/RemindersPanel.jsx:20-24`); interruptor de sincronización automática con `focus:outline-none` sin anillo (`src/components/SettingsView.jsx:1044`, el `:focus-visible` global pierde por especificidad) y apagado en `sage-200` sobre blanco (≈1,2:1); dos estilos distintos de interruptor (switch en Google/Servicios, checkbox en `settings/SettingsFields.jsx:5`).
- **Propuesta:** 11 px en los ejes; `text-sage-500` en chips sobre `sage-100`; `focus-visible:ring-2` en el switch y borde `sage-400` apagado; un solo componente `Switch` en `UI.jsx`.
- **Esfuerzo:** S
- **Confianza:** confirmado (contraste calculado con la fórmula WCAG)

### [BAJA] Restos de i18n
- **Ubicación:** `src/components/NutritionPlanEditor.jsx:461` ("plan/planes"), `:487-488` ("kcal/día", "comidas"), `:545` ('Error: '), `src/components/ClientDetailView.jsx:331` ("kcal/día"), `src/components/ServicesView.jsx:120` ("/sesión"), `src/components/UnlockScreen.jsx:38-40`, `src/components/SettingsView.jsx:1094,1103` ("Client ID/Secret"). Inglés: faltan 132 claves (casi toda la entrevista `ent_*` y `pf_*`), que salen en castellano.
- **Impacto para Raquel:** poco (usa ES/CA); en catalán o inglés se mezclan idiomas en la misma pantalla.
- **Propuesta:** pasar esas cadenas por `t` y `plural()`; completar EN cuando se toque.
- **Esfuerzo:** S
- **Confianza:** confirmado (script de comparación de claves en el scratchpad)

### [BAJA] Ajustes: una ubicación se borra sin confirmar
- **Ubicación:** `src/components/SettingsView.jsx:41-44`.
- **Impacto para Raquel:** un clic en la papelera y sus citas/facturas quedan sin nombre de centro.
- **Propuesta:** `confirm({ danger: true })` indicando cuántas citas usan esa ubicación.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [BAJA] Pequeñas incoherencias visuales
- **Ubicación:** importes del resumen de Facturación sin `tabular-nums` (`src/components/Invoices.jsx:95-103`); "Altura (cm)" en la tabla vs "Talla (cm)" en necesidades; desplegable "Fórmula TMB" recortado ("Harris-B…") a 1366 px (`src/components/client/EnergyNeedsCard.jsx:113`); el código postal "46001" como placeholder parece un valor (`src/components/ClientModal.jsx:181`); "Fecha de la entrevista" vacía en vez de hoy.
- **Propuesta:** `tabular-nums`; un solo término; ancho mínimo del select; placeholder "Ej. 46001"; fecha por defecto hoy.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [BAJA] Agenda: la cita recién creada antes de la hora actual queda fuera de la vista
- **Ubicación:** `src/components/CalendarView.jsx:220-229` (la semana se abre en "ahora − 1 h").
- **Escenario concreto:** (comprobado) a las 13:00 crea una cita de hoy a las 09:00: "Cita creada", pero no se ve sin desplazar hacia arriba.
- **Propuesta:** tras crear o editar, desplazar hasta la cita.
- **Esfuerzo:** S
- **Confianza:** confirmado

## Las 10 mejoras con más impacto por esfuerzo

| # | Mejora | Hallazgo | Esfuerzo |
|---|---|---|---|
| 1 | No ejecutar Ctrl+1…7 / Ctrl+Z con un diálogo abierto | Atajos globales | S |
| 2 | Preguntar antes de cerrar un modal con cambios (clic fuera, Escape, ✕) | Clic fuera / Escape | S–M |
| 3 | `danger: true` en todos los borrados + botón "Deshacer" en el toast | Borrados | S |
| 4 | Agenda: color del calendario solo en el borde, estado siempre visible | Citas de Google | S |
| 5 | Email: ocultar el selector de modo con adjunto fijo y no prometer adjunto sin SMTP | Email sin SMTP | S |
| 6 | Toast de WhatsApp honesto ("chat abierto, pulsa enviar") | WhatsApp | S |
| 7 | Búsqueda sin acentos ni espacios en Clientes y Ctrl+K | Búsqueda | S |
| 8 | Dashboard: contar sin canceladas, "Próxima" futura, filas que abren la ficha | Dashboard + acceso a ficha | S |
| 9 | "Enviar por email" en el editor de planificación, en la ficha y en facturas | Enviar por email | M |
| 10 | Facturación: filtro por trimestre, desglose y "Exportar para el gestor" | Cierre de trimestre | M |

Justo detrás: quitar las clases `dark:` de la ficha (S) y que "Guardar" factura no abra el diálogo de archivo (S).

## Pendientes de la auditoría de oct-2026

- **#81** `parseInt('')` guarda `NaN`: sigue en la duración por defecto de la consulta (`src/components/SettingsView.jsx:1925`). El puerto SMTP ya está corregido.
- **#83** En Ctrl+K, los resultados de consulta, plan y factura solo cambian de vista y no abren el elemento (`src/components/CommandPalette.jsx:189-196`). Los clientes y "Nuevo cliente" del Dashboard ya están corregidos.
- **§7** Las celdas vacías del calendario siguen siendo solo de ratón (el botón "Nueva cita" lo cubre).
- **§6** Textos fijos: casi todo corregido; los restos están en el hallazgo de i18n.
- **§10** Datos personales reales en los valores por defecto de `config` y en *placeholders* (`src/components/SettingsView.jsx:1888`; se ven en una instalación nueva: nombre, colegiada, email, teléfono, centros). Sigue abierto; no es de UI en sentido estricto.

Verificados como corregidos: #65 (gráfica de perímetros), #68 (duración de toasts), #70 (parpadeo al navegar, ahora con caché de vistas), #71 (icono de búsqueda), #75 (errores de `syncAll` en Ctrl+K), #82 (precio 0), contraste de `sage-400` (4,8:1 sobre blanco), Escape/rol/foco de los modales, `aria-label` en botones de icono, pestañas WAI-ARIA.

## Lo que está bien (breve, para no tocarlo)

- Sistema de color: cero clases de Tailwind sin tema en componentes; solo 3 hex (dos de color de Google, uno el `#1a1a1a` del hallazgo). Semánticos con contraste ≥ 4,6:1 en claro y oscuro.
- `Modal`/`ConfirmModal`: `role`, `aria-modal`, trampa de foco, foco devuelto, Escape solo en el de arriba; `Combobox` accesible y sin acentos; `Toast` con `role="alert"/"status"` y acción opcional.
- Entrevista y seguimientos: navegación tipo hoja de cálculo muy buena, autoguardado, ayuda de atajos plegable, números con coma decimal.
- Editor de planificación: copia automática de la última con aviso de origen, aviso de cambios sin guardar, Ctrl+S, vista previa en vivo del PDF, contadores por sección.
- `:focus-visible` global, `prefers-reduced-motion`, `tabular-nums` en tarjetas y tablas, sin desbordamiento horizontal a 1093 px.
- i18n: ES y CA completos con *fallback* por clave; fechas con `useLocale()`/`Intl`.
- Protección contra doble clic al guardar facturas.

## Fuera de mi área (notas para otras sesiones)

- **Dietas / necesidades:** `nivelActividad: 'moderado'` por defecto en la ficha nueva (`ClientModal.jsx:48`) entra en el factor de actividad (`energia.js:109`) aunque Raquel no lo haya elegido.
- **Citas / recordatorios:** una cita de hoy a las 15:00, vista a las 13:00, sale "Fuera de plazo" en email y WhatsApp; revisar si el WhatsApp manual debería seguir ofreciéndose.
- **Facturación:** el resumen de Facturación suma `total` (con IVA y IRPF); revisar qué cifra necesita el gestor.
- **Datos:** al borrar una ficha, los documentos se eliminan del disco al instante aunque el resto se pueda deshacer (`ClientsView.jsx:57`).
