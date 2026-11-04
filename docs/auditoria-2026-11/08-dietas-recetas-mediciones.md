# 08 — Dietas (planificaciones), recetas, catálogo de alimentos y mediciones  (auditoría nov-2026, v1.18.1)

## Resumen

El núcleo clínico está en buen estado: las fórmulas de energía son correctas (Harris-Benedict y Mifflin-St Jeor coinciden con los valores de referencia), el PDF de la planificación se ve profesional, respeta la escala tipográfica y el contraste en casos normales, y descarta los enlaces que no son http/https. Los riesgos están en otra parte: **lo que se escribe en el editor de planificaciones vive solo en memoria** y se pierde sin aviso con el bloqueo automático o al cambiar de vista con el teclado o la paleta; **las notas de las opciones pasan a "Mis recetas" y se autocompletan en planes de otros pacientes**; y **Deshacer tras crear un cliente borra la ficha** (con su entrevista), y Rehacer la devuelve sin lo que se escribió después. Además, la altura no tiene validación y el IMC guardado no se recalcula al corregirla, y `parseDecimal` lee "1.500" como 1,5.

He generado 6 PDF de prueba con datos inventados (pdf-lib + Onest, renderizados con PyMuPDF) para comprobar los desbordes y los caracteres especiales. `npm test`: 110 ficheros y 1.899 tests en verde. Ojo: el recuento incluye copias de `.claude/worktrees/`; los 13 ficheros de `src/` también pasan.

| Severidad | Nº |
|---|---|
| CRÍTICA | 0 |
| ALTA | 3 |
| MEDIA | 7 |
| BAJA | 8 |

## Hallazgos

### [ALTA] Una planificación sin guardar se pierde sin aviso (bloqueo automático, Ctrl+1…7, paleta Ctrl+K, salir)
- **Ubicación:** `src/components/plan/PlanificacionEditor.jsx:760-805` (el formulario solo vive en `useState`), `src/App.jsx:371-378` (bloqueo automático → `window.location.reload()`), `src/App.jsx:422-446` (atajos globales), `src/App.jsx:574-576` (`ErrorBoundary key={currentView}` + `ViewLoader`), `src/components/CommandPalette.jsx:219` (`z-[60]`, por encima del editor, que va en `z-50`).
- **Qué pasa:** el editor a pantalla completa guarda el contenido solo en el estado local hasta pulsar «Guardar». No hay borrador persistente ni protección ante desmontaje. Hay cuatro formas de desmontarlo sin pasar por `close()`, que es la que pregunta «Hay cambios sin guardar»: (1) con cifrado y `autoLockMinutes > 0`, tras N minutos sin tocar ratón ni teclado se llama a `flushAllPending()`, que solo vacía el *store*, y luego se recarga la página; (2) Ctrl+1…7 cambia de vista si el foco no está en un `INPUT`/`TEXTAREA` (por ejemplo, en una casilla del menú semanal, que es un `<button>`, o en «Intercambiar A/B»); (3) Ctrl+K abre la paleta incluso dentro de un campo, se dibuja encima del editor, y elegir cualquier resultado cambia `currentView`; (4) «Salir» desde la bandeja o reiniciar para actualizar.
- **Escenario concreto:** Raquel monta el menú de lunes a jueves (unos 20 minutos), contesta una llamada larga y el bloqueo de 10 min recarga la app: el menú desaparece. O bien hace clic en la casilla «Martes · Cena B», pulsa Ctrl+3 para mirar la ficha del cliente y el editor se cierra sin preguntar.
- **Impacto para Raquel:** pierde un trabajo largo sin enterarse de por qué. Es la tarea en la que más tiempo invierte por paciente.
- **Propuesta:** guardar un borrador automático (por ejemplo `planDrafts[planId|new-clientId]` en el *store*, con un *debounce*) y ofrecer «Recuperar borrador» al abrir. Como mínimo: no llamar al bloqueo ni al cambio de vista si hay un diálogo con cambios (un registro global `dirtyGuards` que consulten el temporizador de bloqueo, `setCurrentView` y `quit_app`) e ignorar Ctrl+número y Ctrl+K mientras haya un `dialogStack` abierto.
- **Esfuerzo:** M
- **Confianza:** confirmado (lectura de código; el *reload* y el desmontaje por `key={currentView}` son directos)

### [ALTA] Las notas de las opciones (posible dato de un paciente) pasan a «Mis recetas» y se autocompletan en el PDF de otros pacientes
- **Ubicación:** `src/services/planificacion.js:318` (`collectOwnRecipes` guarda `nota` de cada opción), `src/services/planificacion.js:326-337` (`mergeOwnRecipes`: la última versión manda), `src/components/plan/PlanificacionEditor.jsx:102-107` (el autocompletado copia `hit.nota`), `src/components/plan/WebRecipePicker.jsx:218` (elegir de «Mis recetas» copia `nota`).
- **Qué pasa:** al guardar una planificación, cada opción de desayuno, media mañana o merienda con título y alimentos se guarda en la biblioteca global «Mis recetas» **junto con su nota**, sin filtrar nada. Luego, en cualquier otro paciente, escribir el mismo título o elegirla en el selector rellena la nota, y esa nota se imprime en el PDF.
- **Escenario concreto:** en el plan de la paciente A, la opción «Tostada con tomate» lleva la nota «Pan sin gluten, A es celíaca» (o «sin lactosa por su SII»). Se guarda. Semanas después, en el plan de B, escribe «Tostada con tomate», sale del campo y la nota se rellena sola. Si no la revisa, el PDF de B menciona a A y su patología.
- **Impacto para Raquel:** puede entregar a un paciente un dato de salud de otro. Que pase es probable: según `CLAUDE.md`, las notas de la semilla de Canva **tenían nombres de pacientes** y hubo que quitarlos a mano en `build-recetas.py`, así que Raquel escribe ese tipo de notas.
- **Propuesta:** no guardar `nota` en «Mis recetas» (o guardarla aparte, sin autocompletarla y con aviso «nota de otra planificación»). Si se conserva, que el autocompletado nunca rellene la nota y que el selector la muestre para confirmarla. Limpiar las notas que ya estén guardadas con una migración que las mueva a un campo no autocompletado.
- **Esfuerzo:** S
- **Confianza:** probable (el flujo está confirmado en el código; que la fuga ocurra depende de lo que escriba en las notas)

### [ALTA] Ctrl+Z fuera de un campo tras crear un cliente borra la ficha, y Ctrl+Y la devuelve sin entrevista, energía ni altura
- **Ubicación:** `src/stores/store.js:1131` (`add_client` guarda una copia del cliente **en el momento de crearlo**), `src/stores/store.js:1864` (deshacer = quitar el cliente), `src/stores/store.js:1881` (rehacer = volver a poner esa copia), `src/App.jsx:428-433` (Ctrl+Z global si el foco no está en `INPUT`/`TEXTAREA`).
- **Qué pasa:** la entrevista (`client.entrevista`), las necesidades (`client.energia`) y la altura se guardan en el propio objeto cliente con `updateClient`, que no deja rastro en `_history`. Si lo último en el historial es `add_client` (primera visita), un Ctrl+Z con el foco en un botón (las pestañas de la ficha, «Nuevo pesaje») o en un `<select>` (sexo y fórmula en `EnergyNeedsCard`) elimina el cliente. Rehacer reinserta la copia inicial, **sin** nada de lo escrito después. Las mediciones quedan huérfanas mientras tanto.
- **Escenario concreto:** primera visita: crea la ficha, rellena la entrevista y la tarjeta de energía, hace clic en la pestaña «Mediciones», se da cuenta de un error y pulsa Ctrl+Z por costumbre. La ficha desaparece («Deshecho»). Con Ctrl+Y vuelve vacía: se ha perdido toda la entrevista.
- **Impacto para Raquel:** pierde la entrevista completa de la primera visita, que es la consulta más larga.
- **Propuesta:** al rehacer `add_client`, guardar en `_future` el estado **actual** del cliente (no `last.item`). Mejor aún: no permitir deshacer `add_client` si el cliente se ha modificado después, o pedir confirmación («Se borrará la ficha de X»). El Ctrl+Z global no debería actuar con un diálogo o editor abierto.
- **Esfuerzo:** S
- **Confianza:** confirmado (código). Afecta sobre todo al área de datos; aviso a esa sesión en «Fuera de mi área».

### [MEDIA] Las recetas borradas de «Mis recetas» vuelven al crear una planificación desde Planes o al usar «Copiar de»
- **Ubicación:** `src/components/plan/PlanificacionEditor.jsx:767` (`baselineRef = useRef(form)` solo en el primer render), `:916` (elegir cliente → `setState(fresh(id))` sin actualizar la referencia), `:825-831` (`copyFrom` tampoco la actualiza), `:801-802`.
- **Qué pasa:** al guardar solo se añaden a «Mis recetas» los platos que difieren de `baselineRef`. Con «Nueva planificación» desde la lista de Planes (`NutritionPlanEditor.jsx:456`), el editor se abre sin cliente (`form = null`), así que la referencia es `null`. Al elegir el cliente se copia la última planificación, y al guardar **todos** los platos copiados cuentan como nuevos. Con «Copiar de» pasa lo mismo con todo el contenido copiado.
- **Escenario concreto:** borra «Pollo al curry» de «Mis recetas» porque estaba mal. Crea una planificación desde Planes → elige un paciente cuyo último plan tenía ese plato → Guardar → «Pollo al curry» vuelve a la lista con la versión antigua. Lo he comprobado en el scratchpad: `collectOwnRecipes(null)` y `collectOwnRecipes(plan)` devuelven el plato como nuevo.
- **Impacto para Raquel:** los arreglos y borrados de su recetario «no se quedan», lo que confunde y le hace perder tiempo.
- **Propuesta:** poner `baselineRef.current = nuevoForm` dentro de `fresh()` y de `copyFrom()` (el contenido copiado no es contenido nuevo).
- **Esfuerzo:** S
- **Confianza:** confirmado

### [MEDIA] Altura sin validar e IMC guardado que no se recalcula al corregir la altura
- **Ubicación:** `src/stores/store.js:163-167` (`calcIMC`), `src/stores/store.js:1155-1179` (el IMC se calcula y **se guarda** al crear la medición y solo se recalcula si cambia el `peso`), `src/components/client/FollowUpTable.jsx:111` y `src/components/MeasurementChart.jsx:24` (prefieren `m.imc` guardado), `src/components/client/FollowUpTable.jsx:154-158` y `src/components/ClientModal.jsx:71,228` (altura sin mínimo ni máximo).
- **Qué pasa:** (a) si la altura se escribe en metros (1,65) o con un error, todos los pesajes de ese periodo guardan un IMC absurdo (60 kg / 1,65 cm → **220.386**). Al corregir la altura a 165, los IMC guardados **no cambian** y la tabla y el gráfico siguen mostrando el valor viejo. (b) Harris-Benedict con 1,65 «cm» da **1.092 kcal**, un valor que parece normal (el correcto son 1.394), así que el NEED sale un 22 % bajo sin que nada avise. Mifflin da 299 y sí canta. (c) No hay control de valores absurdos (peso 0 o negativo, grasa > 100 %).
- **Escenario concreto:** crea la ficha con altura «1,65», pesa a la paciente tres veces, corrige la altura a 165 → la fila IMC de la tabla de seguimientos y el gráfico de peso/IMC siguen con valores de seis cifras en esos tres pesajes.
- **Impacto para Raquel:** IMC erróneos en el historial clínico y un gasto energético que parece razonable pero está mal calculado.
- **Propuesta:** no guardar `imc` (calcularlo siempre al mostrarlo) o recalcularlo para todas las mediciones del cliente cuando cambie `altura`. Validar la altura (por ejemplo de 100 a 230 cm; si llega un valor < 3, ofrecer convertirlo de metros a cm) y marcar en rojo pesos ≤ 0 o > 350 kg y porcentajes > 100.
- **Esfuerzo:** S
- **Confianza:** confirmado (calculado en el scratchpad)

### [MEDIA] `parseDecimal` lee «1.500» como 1,5 y el texto no válido se ignora sin avisar en la tarjeta de energía
- **Ubicación:** `src/services/energia.js:35-40`; se usa en `EnergyNeedsCard.jsx` (objetivos en kcal, FA, FE, %) y en `fields.jsx` (`NumberInput` de la tabla de seguimientos, incluida «Tasa metabólica»).
- **Qué pasa:** solo cambia la primera coma por un punto y acepta `\d*\.?\d+`, así que el separador de miles español se toma como decimal. En la tarjeta de energía los campos son texto libre: un valor que no se puede leer («70kg», «1,2,5») hace que el cálculo vuelva **en silencio** al valor del perfil, sin marcar el campo, mientras se sigue viendo lo escrito.
- **Escenario concreto:** escribe «1.500» en «Objetivo 1» → la columna sale con 1,5 kcal y unos macros de 0-1 g. En la tabla de pesajes, «Tasa metabólica» = «1.523», copiado de la báscula, se guarda como 1,523, y con la fórmula «Báscula» el TMB sale 1,5 kcal.
- **Impacto para Raquel:** números absurdos que tendrá que descubrir y corregir. En la tabla de seguimientos el valor erróneo queda guardado en el historial.
- **Propuesta:** en campos de kcal, tratar «1.500» / «1 500» como miles (un punto seguido de exactamente 3 cifras y sin coma). Marcar `aria-invalid` y el borde rojo en los campos de `EnergyNeedsCard` que no se puedan leer, como ya hace `NumberInput`.
- **Esfuerzo:** S
- **Confianza:** confirmado (`calcularEnergia` con `objetivos: ['1.500']` → 1,5)

### [MEDIA] Las necesidades energéticas toman el último pesaje aunque no tenga peso
- **Ubicación:** `src/components/MeasurementChart.jsx:90`, `src/services/energia.js:96,104`, `src/components/client/FollowUpTable.jsx:79-86`.
- **Qué pasa:** `lastMeasurement` es la última columna por fecha. Marcar solo «Regla» o escribir solo una nota en la columna nueva crea la medición de hoy sin `peso` ni `tasaMetabolica`, y la tarjeta pasa a «—» con el aviso de que faltan datos. Lo mismo ocurre con un pesaje en el que solo se midieron perímetros.
- **Escenario concreto:** en una revisión solo anota la cintura → el TMB y el NEED desaparecen hasta que se rellena el peso de ese día a mano en la tarjeta.
- **Impacto para Raquel:** parece que la tarjeta «se ha roto».
- **Propuesta:** tomar el peso del último pesaje **que tenga peso** (y lo mismo para `tasaMetabolica`) e indicar la fecha de la que sale.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [MEDIA] Editor de planes antiguos (por comidas): Escape, clic fuera o Cancelar cierran sin confirmar
- **Ubicación:** `src/components/NutritionPlanEditor.jsx:227-249` (`<Modal onClose={onClose}>` con el `onClose` directo), `src/components/UI.jsx:510-522` (el `Modal` cierra con Escape y con clic en el fondo).
- **Qué pasa:** a diferencia del editor nuevo, el antiguo no controla si hay cambios. Escape o un clic accidental fuera del modal descartan lo editado.
- **Escenario concreto:** retoca las opciones de un plan antiguo, pulsa Escape para cerrar el desplegable de la hora y el modal se cierra perdiendo los cambios.
- **Impacto para Raquel:** pérdida de cambios en los planes antiguos que todavía reutilice.
- **Propuesta:** el mismo patrón `dirty` + `confirm(pf_discard_confirm)` que en `PlanificacionEditor.close`.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [MEDIA] PDF de los planes antiguos: los alimentos se funden en un párrafo, el título se sale de la página y los emojis salen como □
- **Ubicación:** `src/services/pdfPlanGenerator.js:36-52` (`wrapText` parte por cualquier espacio, saltos de línea incluidos), `:253,266-269` (una viñeta por línea **de ajuste**, no por alimento), `:258` (`Opción N: descripcion` sin `maxWidth`), `:104-116` (no limpia los caracteres que la fuente no tiene), `:67-71` (si se usa Helvetica, un emoji lanza «WinAnsi cannot encode»).
- **Qué pasa:** lo he comprobado con un PDF de prueba. «Pan integral 60 g / Aguacate ¼ / Huevo / Café…», escritos uno por línea, salen como **una sola viñeta**. Una descripción larga sobrepasa el margen derecho y se corta. «🥗» y «🍎» se dibujan como recuadros vacíos. Además el estilo no sigue el de `CLAUDE.md`: coral `#E8846A`, textos de 7-7,5 pt y colores propios.
- **Escenario concreto:** descargar o enviar por email un plan antiguo con varios alimentos por opción.
- **Impacto para Raquel:** un PDF poco legible y poco profesional para el paciente.
- **Propuesta:** partir `alimentos` con `linesOf` (una viñeta por alimento), ajustar la descripción con `maxWidth`, y reutilizar `makeSanitizer` y la paleta de `pdfPlanificacionGenerator`. Otra opción: convertir los planes antiguos al formato nuevo.
- **Esfuerzo:** S
- **Confianza:** confirmado (render en el scratchpad)

### [MEDIA] Recetas web: parseo frágil y receta «pendiente» para siempre que fuerza resincronizaciones
- **Ubicación:** `src/services/webRecipes.js:74-83` (`sectionAfter` exige un encabezado que sea exactamente «Ingredientes», con dos puntos opcionales), `:147` (`isDetailPending = !ingredientes?.length`), `:122-124` (`isStale` es cierto si hay alguna pendiente), `src/components/plan/WebRecipePicker.jsx:41-51`, `src/services/webRecipes.js:207-210`.
- **Qué pasa:** «Ingredientes (4 personas)», «Ingredientes para la masa» o una plantilla de Elementor distinta devuelven `[]` (comprobado). Una receta con 0 ingredientes leídos no se distingue de una que aún no se ha descargado: (a) cada vez que se abre el editor `isStale` lanza una sincronización completa que vuelve a pedir esas páginas (~6 s cada una, en serie, contra su propia web); (b) al elegirla, el plato queda con título y enlace pero **sin alimentos**, sin ningún aviso; (c) la lista la muestra siempre como «pendiente».
- **Escenario concreto:** Raquel publica recetas nuevas con el encabezado «Ingredientes (2 raciones)» → nunca tienen ingredientes en la app, cada apertura del editor dispara descargas y el menú sale con platos vacíos.
- **Impacto para Raquel:** platos sin alimentos en el PDF y una app que «siempre está sincronizando».
- **Propuesta:** aceptar encabezados que *empiecen* por «Ingredientes». Guardar `detalleLeido: true` (y la fecha) aunque no salgan ingredientes, para que `isStale` no los cuente como pendientes, y avisar al elegir una receta sin ingredientes («No he podido leer los ingredientes de la web»). Añadir un test con una página real guardada como *fixture*.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [BAJA] PDF de la planificación: una tarjeta más alta que una página se corta y deja una página vacía
- **Ubicación:** `src/services/pdfPlanificacionGenerator.js:638-642` (opciones), `:722-728` (grupos de cantidades), `:647-653` (nota con miniaturas).
- **Qué pasa:** si una tarjeta no cabe se abre una página nueva, pero la tarjeta no se parte. Con unas 35 o más líneas el texto sigue por debajo del pie y fuera del papel, y la página anterior queda solo con la cabecera de sección. Lo he comprobado (p3: «Alimento 34–36» y «37–38» fuera de página, y la página 2 vacía).
- **Escenario concreto:** una opción de desayuno con una lista larga de alternativas o un grupo «Grasas» muy detallado.
- **Impacto para Raquel:** poco probable, pero si ocurre el paciente recibe un PDF con texto cortado.
- **Propuesta:** dividir las tarjetas por filas (con «continúa») o, como mínimo, reducir la escala y avisar en la vista previa.
- **Esfuerzo:** M
- **Confianza:** confirmado

### [BAJA] El menú puede bajar hasta ~4,5–6 pt, por debajo de la regla de 7 pt
- **Ubicación:** `src/services/pdfPlanificacionGenerator.js:821-822`.
- **Qué pasa:** si ni una fila por página cabe a 0,94, la escala `k` puede bajar hasta 0,6 y se aplica a **todo** el menú. Un solo plato con unos 40 ingredientes deja la semana entera a 5,9 pt (comprobado en p5). La letra A/B (`cr * 1,2`) ya queda a 6,8 pt en la escala mínima normal.
- **Impacto para Raquel:** un menú difícil de leer por culpa de un solo plato.
- **Propuesta:** limitar la escala de cada página o avisar en el editor («este plato tiene demasiados ingredientes para el menú»).
- **Esfuerzo:** S
- **Confianza:** confirmado

### [BAJA] La migración v16 borra la nota retocada de una receta de la semilla
- **Ubicación:** `src/services/planificacion.js:360-387` (`seedSignature` solo usa título, alimentos y enlace), `src/stores/store.js:331-335`.
- **Qué pasa:** si en la v1.18.0 se cambió solo la `nota` de una receta sembrada (guardando una planificación con esa opción), la firma no cambia y la v16 la sustituye por la semilla nueva con `nota: ''`. Comprobado en el scratchpad.
- **Impacto para Raquel:** pierde una nota editada (ventana corta: solo quien pasó por la v1.18.0).
- **Propuesta:** en futuras migraciones, saltarse las recetas cuya `nota` no coincida con la de la semilla antigua.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [BAJA] Escape para cerrar el autocompletado del título pregunta si cerrar el editor
- **Ubicación:** `src/components/UI.jsx:194-199` + `<datalist>` en `PlanificacionEditor.jsx:112,358`.
- **Qué pasa:** el `keydown` de Escape llega al `document` sin `defaultPrevented`, así que cerrar el desplegable del `datalist` también lanza `close()` → «Hay cambios sin guardar. ¿Cerrar igualmente?». No hay pérdida (pide confirmación), pero asusta.
- **Propuesta:** ignorar Escape si el foco está en un `input[list]` o tiene sugerencias abiertas.
- **Esfuerzo:** S
- **Confianza:** probable (depende del comportamiento del `datalist` en WebView2)

### [BAJA] El índice del PDF promete «platos subrayados» aunque no haya enlaces
- **Ubicación:** `src/services/pdfPlanificacionGenerator.js:101`.
- **Qué pasa:** el texto de la sección Menú siempre dice «Los platos subrayados te llevan a la receta».
- **Propuesta:** añadir la frase solo si algún plato tiene `safeUrl(receta)`.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [BAJA] Guardar unos valores nutricionales vacíos marca el alimento como revisado
- **Ubicación:** `src/services/foodCatalog.js:71`, `src/components/plan/FoodsView.jsx:103-108`.
- **Qué pasa:** «Guardar» con todos los campos vacíos guarda `por100g` con todo a `null`, y `applyFoodEdits` pone `control: 'ok'` y `fuente: 'manual'`. Desaparece el aviso «Revisar / Sin datos». Tampoco se comprueba que la suma cuadre (control Atwater).
- **Propuesta:** no guardar si todo está vacío y aplicar el mismo control Atwater que el importador.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [BAJA] Harris-Benedict es la original de 1919 y no se indica
- **Ubicación:** `src/services/energia.js:70-72`, `src/components/client/EnergyNeedsCard.jsx` (opción «Harris-Benedict»).
- **Qué pasa:** los coeficientes (66,473 + 13,7516·P + 5,0033·T − 6,755·E; 655,0955 + 9,5634·P + 1,8496·T − 4,6756·E) son los de la fórmula **original**, no los de la revisada (Roza-Shizgal, 1984). La diferencia es pequeña (< 1 % en los casos de referencia: H 70 kg/175 cm/30 a: 1.702 frente a 1.696; M 60/165/30: 1.394 frente a 1.384), pero no está documentado.
- **Propuesta:** etiquetarla como «Harris-Benedict (1919)» o añadir la revisada como opción, según lo que use la hoja de Raquel.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [BAJA] Catálogo de Mercadona regenerado en cada versión: las ediciones propias pueden quedar huérfanas
- **Ubicación:** `.github/workflows/release.yml:31-39`, `src/services/foodCatalog.js:37-52,62-74`.
- **Qué pasa:** `foods.json` se vuelve a descargar de Mercadona en cada versión. Si un producto desaparece o cambia de id, las fotos y valores propios (`planLibrary.alimentos[id]`) dejan de aplicarse sin avisar, y el genérico que dependía de ese `sourceId` se queda sin nutrición («sin datos»).
- **Propuesta:** avisar en «Alimentos» de las ediciones que ya no tienen producto, y en el CI comprobar que todos los `mercadona` de `genericFoods.js` existen.
- **Esfuerzo:** S
- **Confianza:** probable

## Pendientes de la auditoría de oct-2026
- **i18n (sección 7, «textos fijos»):** quedan textos en español fijo en `NutritionPlanEditor.jsx` (`'Opción {i}'` :103, `"kcal aprox"` :128, `plan{…'es'}` :461, `kcal/día` :487, `comidas` :488, los `title` de `MacroBar` :31-33) y `name="IMC"` en `MeasurementChart.jsx`. Pendiente de la auditoría de oct-2026.
- Ya arreglados y verificados: #51 (componentes dentro del render en `MeasurementChart`), #52 (el email del plan lleva el PDF), #65 (la pestaña «Perímetros» ya dibuja los perímetros), #66 (`bg-coral-400`), #67 (descarga con diálogo de guardar), #78 (fechas UTC).

## Lo que está bien (breve, para no tocarlo)
- **Fórmulas:** Harris-Benedict y Mifflin-St Jeor coinciden con los valores de referencia (H 70/175/30: 1.702 y 1.649 kcal; M 60/165/30: 1.394 y 1.320). Factores de actividad estándar (1,2 a 1,9), NEED = TMB×FA×FE, macros 4/4/9, `edadDesde` correcta (29-feb incluido).
- **PDF de la planificación:** escala tipográfica respetada (≥ 7 pt en casos normales), colores de texto AA (soft 6,7:1, orangeInk 6:1, blanco sobre olive 7,3:1), ñ/½/¼/°/✓ correctos, emojis eliminados limpiamente, `javascript:` descartado (solo enlaces http/https), nombre largo del paciente en 2 líneas, menú partido en comidas/cenas o por filas cuando no cabe.
- **Copiar la última planificación:** no copia `objetivos`, `observaciones` (notas internas), fechas ni estado.
- **Migraciones v13/v15/v16:** no tocan las recetas editadas o borradas, y las fusiones conservan el id.
- **Recetas web:** sincronización en serie con caché por `modified`, guardado progresivo, una sola descarga por receta, `referrerPolicy`, y `recipes_fetch` limitado al dominio con tamaño máximo y *timeout*.
- **Teclado** (`keyboardGrid`/`useKeyboardForm`): lógica coherente y con tests. Los inputs de fecha y los `select` conservan sus flechas. La entrevista se guarda tecla a tecla desde `getState()`.
- **Catálogo:** si falta `foods.json` se queda con los genéricos sin romperse, y el CI de versión falla si el catálogo tiene < 250 alimentos.

## Fuera de mi área (notas para otras sesiones)
- **audit-datos / audit-ui-ux:** el Ctrl+Z / Ctrl+Y global (ver la tercera ALTA) también actúa con cualquier modal o editor abierto si el foco está en un botón o un `select`. `add_client` es el caso peligroso. El bloqueo automático (`App.jsx:371-378`) recarga y descarta el estado no guardado de **cualquier** modal (consultas, facturas…), no solo de las planificaciones.
- **audit-ui-ux:** Ctrl+K y Ctrl+1…7 no respetan los diálogos abiertos (`App.jsx:422-446`).
- **audit-codigo:** `vitest run` recoge también `.claude/worktrees/**` (110 ficheros en lugar de 13; tarda más y puede dar falsos rojos de ramas viejas): falta `exclude` en la configuración de vitest. `public/pdf.worker.min.mjs` sigue en el repo sin usarse (`PdfPreview` importa el worker de `pdfjs-dist?url`), pendiente de oct-2026.
- **audit-codigo / CI:** la versión depende de que la API de Mercadona responda en ese momento (`release.yml:31-39`).
