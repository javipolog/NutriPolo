# 05 — Rendimiento y optimización  (auditoría nov-2026, v1.18.1)

## Resumen

Las vistas ya se cargan bajo demanda, la mayoría de cálculos del Dashboard van memorizados y el undo guarda solo lo borrado, no copias del estado. Los dos problemas que Raquel va a notar están en otro sitio:

1. **Cada cambio reescribe el store entero.** Todo vive en un único fichero (`nutripolo-storage`, ~22 MB con el volumen objetivo, la mitad fotos en base64). Se reescribe entero, con un comando síncrono en el hilo principal, 300 ms después de cualquier `set()`: una pausa al escribir en la entrevista, cambiar de vista, buscar o cada sync de 5 min. Medido: **~80 ms de JS + ~50 ms de Rust por escritura**.
2. **La vista previa de la planificación** regenera el PDF entero en el hilo principal (**380–700 ms**, el 74 % en el *shaping* de fontkit) cada vez que Raquel deja de teclear 700 ms. Además pinta todas las páginas con pdf.js.

Le siguen el contador de recordatorios de la barra lateral, que cuesta 7,8 ms en cada pulsación, y el primer sync de un calendario, que congela la app varios segundos.

| Severidad | Nº |
|---|---|
| CRÍTICA | 0 |
| ALTA | 2 |
| MEDIA | 5 |
| BAJA | 6 |

**Cómo se ha medido.** Store sintético inventado (sin datos reales): 500 clientes con entrevista, 5.000 consultas con campos de sync y recordatorios, 3.000 mediciones, 300 planificaciones, 2.000 facturas, 300 productos con foto real del catálogo (≈ la misma que guarda `foodPhotoDataUrl`), las 1.260 recetas de la semilla y 300 recetas web. El store real (zustand + persist) y las funciones puras se ejecutaron con `vite-node`. El cifrado y el parseo IPC de Rust se midieron con un binario `--release` que usa las mismas crates (`aes-gcm` 0.10.3, `serde_json`). El build es `npm run build` (Vite 5) con sourcemaps. Todo en un PC de desarrollo con Node 25: en el portátil de Raquel cuenta con **×1,5–3**. Scripts para repetirlo: `side-session-notes/local_21b9c805-…/05-rendimiento-bench/` (`bench.mjs`, `bench2.mjs`, `pdfprof.mjs`, `ipc.mjs`, `chunks.mjs`, `rsbench-main.rs`).

**Tamaño del fichero sintético (JSON):** `planLibrary.productos` 9,9 MB · consultas 5,3 MB · planificaciones 2,9 MB · clientes 1,6 MB · mediciones 1,2 MB · facturas 0,6 MB · recetas propias 0,3 MB · recetas web 0,15 MB → **21,9 MB**. En el heap, el store parseado ocupa ~70 MB (incluida la cadena original, que se libera después).

---

## Hallazgos

### [ALTA] Cada `set()` reescribe y cifra el store entero (22 MB) con un comando síncrono, también al navegar y cada 5 min en la bandeja
- **Ubicación:** `src/stores/store.js:2080` (una sola clave `nutripolo-storage`), `:2100-2129` (`partialize` devuelve todas las colecciones), `:76-82` (`setItem` con *debounce* de 300 ms), `:34-53` (`flushWrite`: `JSON.stringify` del store entero); `node_modules/zustand/esm/middleware.mjs:351-359` (persist llama a `setItem` en **todo** `set()`, aunque cambie algo no persistido); `src-tauri/src/main.rs:105-128` (`save_data`) y `:130-151` (`load_data`) **sin `async`**: en Tauri 1 corren en el hilo principal. En la bandeja: `src/services/googleCalendarService.js:733` (`setSyncAudit` al final de cada `syncAll`) y `:1052,1104,1265` (`updateCalendarTracking` cambia `config` en cada sync, haya cambios o no).
- **Qué pasa:** el *debounce* agrupa ráfagas, pero cada escritura serializa todas las colecciones (fotos incluidas) y las manda por IPC. La IPC de Tauri 1 vuelve a pasar el string por `JSON.stringify` (escapando cada comilla). Rust la parsea con serde, la cifra con AES-GCM y la escribe entera. Medido a 22 MB:

  | Paso | Hilo | ms |
  |---|---|---|
  | `JSON.stringify` del store | JS (UI) | 46 |
  | `JSON.stringify` del mensaje IPC (doble codificación, 25 MB) | JS (UI) | 36–60 |
  | `serde_json` del mensaje | Rust principal | 27 |
  | AES-256-GCM | Rust principal | 13 |
  | `fs::write` | Rust principal | 12 |
  | **Total por escritura** | | **~135–160 ms** (≈ 6 ms por MB) |

  Escribe aunque lo que cambie no se persista (`currentView`, `selectedClientId`, `clientSearch`, `saveError`, `integrityWarnings`): la persistencia no compara nada antes de escribir.
- **Escenario concreto:** (1) Raquel escribe en la Entrevista (`InterviewTab.jsx:134` → `updateClient` en cada tecla): en cada pausa de más de 300 ms (entre frases, al pensar) la interfaz se congela ~0,1–0,3 s y las teclas siguientes salen a trompicones. (2) Cambia de vista con Ctrl+1…7, busca un cliente o despliega la barra lateral → otra reescritura de 22 MB. (3) Con la app en la bandeja todo el día, el sync de cada 5 min escribe siempre (`lastFullSyncAt`, `lastKnownRemoteSyncAt`): ~120 escrituras al día, **~2,6 GB/día al SSD**, y en cada una ~100 MB de memoria temporal (string JS, mensaje IPC, copia en Rust, texto cifrado).
- **Impacto para Raquel:** tirones al escribir en la ficha y al navegar, que empeoran a medida que acumula pacientes y fotos. Gasto de disco y de batería sin motivo con la app en la bandeja.
- **Propuesta (de menor a mayor esfuerzo):**
  1. **(S)** En `setItem`, comparar por referencia cada colección de `partialize` con la de la última escritura; si no ha cambiado ninguna, no escribir. Navegar, buscar o seleccionar dejan de escribir (−100 % en esos casos).
  2. **(M)** Una clave por colección (`clients`, `consultations`, `planLibrary`, `config+sync`…) y escribir solo las que cambian por referencia. Así funciona lo que `CLAUDE.md` describe («cada entitat es guarda com a fitxer JSON separat»), que **hoy no es cierto**. Una tecla en la entrevista pasa a escribir `clients` (1,6 MB: ~1,5 ms de *stringify* + ~10 ms en total) en vez de 22 MB: **−90–95 %**. El sync escribe `consultations` + `syncAudit`, no las fotos. Hace falta una migración que parta el fichero y siga leyendo el antiguo.
  3. **(S)** `save_data`/`load_data` como `#[tauri::command(async)]`, con un `Mutex` por clave para conservar el orden (ver 01 y 04: el cambio de contraseña ya necesita ese mutex). La parte de Rust (~50 ms) deja de bloquear la ventana.
  4. Sacar las fotos del JSON (siguiente hallazgo).
- **Esfuerzo:** S (1 + 3) / M (2).
- **Confianza:** confirmado (código + medición; el tamaño real del fichero de Raquel no se ha visto: con la mitad de datos el coste es la mitad, ≈ 6 ms/MB).

### [ALTA] La vista previa de la planificación genera el PDF entero en el hilo principal tras cada pausa de 700 ms
- **Ubicación:** `src/components/plan/PdfPreview.jsx:23-75` (*debounce* de 700 ms; el `cancelled` solo se mira después de generar), `:39-56` (pinta **todas** las páginas a `devicePixelRatio`), `src/components/plan/PlanificacionEditor.jsx:833-836` (`generate`) y `:975-978` (`deps` incluye `form`, que cambia con cada tecla), `src/services/pdfPlanificacionGenerator.js:312-375` (`width`/`wrap`/`wrapMax`: miden con `widthOfTextAtSize` la línea entera cada vez que añaden una palabra), `:152-157` (6 fuentes con `subset: true` en cada PDF).
- **Qué pasa:** `generatePlanificacionPDF` con el plan de ejemplo tarda **380 ms** (perfilado) a **660–730 ms** (con un heap grande como el de la app; con 0, 12 o 30 productos casi no cambia). El perfil: **74 % en fontkit** (`applyLookups`, `coverageIndex`, `getClassID`…, el *shaping* OpenType de cada `widthOfTextAtSize`), 113 ms en incrustar las 6 fuentes con *subset* + `save`, el resto en pdf-lib/zlib. Todo en el hilo de la UI y sin poder cortarlo a medias. Después pdf.js parsea el PDF en un worker nuevo y lo dibuja en canvas página a página en el hilo principal.
- **Escenario concreto:** Raquel escribe el menú del martes. Para un segundo a mirar la receta, salta la vista previa y la UI queda congelada ~0,5–1 s (generación + pintado de ~7 páginas). Si vuelve a escribir en ese rato, las letras aparecen todas de golpe. Pasa en cada pausa mientras la vista previa esté abierta, que es como viene por defecto (`showPreview = true`, `:770`).
- **Impacto para Raquel:** la pantalla en la que más escribe (la dieta semanal) va a tirones justo cuando se para a pensar.
- **Propuesta:**
  1. **(S)** Caché de anchos durante una generación: `Map` por (fuente, tamaño, texto) en `width`/`wrap`, o medir cada palabra una vez y sumar el ancho del espacio. Es lo que se lleva casi todo el 74 % de fontkit: **−50–70 % (380 → ~130–190 ms)**.
  2. **(M)** Generar el PDF de la vista previa en un **Web Worker**: pdf-lib y fontkit son JS puro, las fuentes se piden con `fetch` y las fotos ya son data URL. El hilo principal pasa a **0 ms** de generación. El mismo worker sirve para «Descargar PDF».
  3. **(S)** En `PdfPreview`: un solo `pdfjs.PDFWorker` reutilizado (hoy se crea uno por PDF, ver BAJA) y pintar a escala 1 o solo la página de la sección que se edita. Subir el *debounce* a ~1.200 ms y no regenerar si el panel no se ve.
- **Esfuerzo:** S (1 + 3) / M (2).
- **Confianza:** confirmado (medido en Node con el mismo código; el pintado de pdf.js no se ha medido, es probable que añada 100–300 ms).

### [MEDIA] El contador de recordatorios de la barra lateral se recalcula entero (7,8 ms) en cada tecla de la ficha
- **Ubicación:** `src/App.jsx:262-275` (`usePendingReminders`: la caché se invalida si cambian `config`, `consultations` o **`clients`**), `src/components/RemindersPanel.jsx:38-47` (`countPendingReminders`), `src/services/reviewRequestService.js:189-226` (calcula `consultationEnd` con `Date` para las 5.000 consultas antes de filtrar por antigüedad), `src/services/reminderService.js:145-172`.
- **Qué pasa:** cada `updateClient` (una tecla en la entrevista, en seguimientos o en energía) crea un array `clients` nuevo y el selector del *shell* vuelve a calcular recordatorios y reseñas sobre todas las consultas. Medido con el store real y las reseñas activadas: **7,8 ms por cambio** (reseñas 6,0 + recordatorios 1,5). Lo mismo cada minuto (`useNow`) y en cada `set()` del sync.
- **Escenario concreto:** escribir en la entrevista con 5.000 consultas → 8 ms de JS síncrono por tecla, antes del render de React (en un portátil modesto, 15–25 ms: se nota el retardo). En un import de 2.000 eventos son 16 s solo de este cálculo (ver hallazgo del sync).
- **Impacto para Raquel:** teclado menos fluido en la ficha, por un número que casi nunca cambia.
- **Propuesta:** prefiltrar por `fecha` (comparando cadenas) antes de construir fechas: los recordatorios solo miran desde hoy hasta el horizonte y las reseñas los últimos `maxAgeDays` (7). Medido: **7,5 → 0,6 ms (−92 %)**. Además, que la caché no dependa del array `clients` entero: recalcular si cambian `consultations`/`config` o cada minuto. Basta también con una firma barata de los clientes que intervienen.
- **Esfuerzo:** S
- **Confianza:** confirmado (medido)

### [MEDIA] El primer sync de un calendario congela la app varios segundos: un `set()` por evento y emparejamiento difuso sin caché (pendiente nº 44)
- **Ubicación:** `src/services/googleCalendarService.js:1014-1044` (bucle sin `await` entre eventos), `:965-978` (`_importEvent` → `addConsultation`, un `set()` por evento), `:886-893` (`_resolvePatient` → `matchPatient`), `src/services/fuzzyMatcher.js:179-193` (`findBestMatches`: `fuzzyScore` con Levenshtein contra los 500 clientes), `src/stores/store.js:1196` (`addConsultation` copia el array de consultas).
- **Qué pasa:** cada evento nuevo hace un `set()`, que copia el array de 5.000 consultas, ejecuta todos los selectores montados (el contador del hallazgo anterior: 7,8 ms) y reprograma la escritura. Un evento sin coincidencia exacta suma **5,8 ms** de emparejamiento difuso con 500 clientes. Todo dentro de un bucle síncrono.
- **Escenario concreto:** Raquel conecta Google por primera vez, añade el calendario de una clínica o pulsa «Restablecer agenda»: ~1.000–2.000 eventos en la ventana de −30/+90 días. Medido con el store real: **~8 ms por evento con nombre exacto y ~14 ms si es difuso, es decir 8–28 s de hilo principal sin ceder**. La ventana deja de responder («No responde» de Windows).
- **Impacto para Raquel:** parece que la app se ha colgado justo al configurarla. Es poco frecuente, pero puede acabar en un cierre forzado a mitad de importación.
- **Propuesta:** acumular las altas y cambios de un calendario y aplicarlos en **un solo `set()`** al final (o por lotes de ~200 con `await` entre lotes para ceder la UI). Memorizar `matchPatient` por `normalizedName` durante un sync: el mismo paciente sale cada semana, así que se calcula ×3–5 menos. Con el contador arreglado, el coste baja a ~6 ms/evento difuso + 1 `set()`: **−70–90 %**.
- **Esfuerzo:** M
- **Confianza:** confirmado (mecánica y costes por evento medidos; el número de eventos de Raquel es una estimación)

### [MEDIA] Las fotos de productos en data URL dentro del JSON doblan el tamaño de cada escritura, de cada copia de seguridad y del store en memoria
- **Ubicación:** `src/services/planPdf.js:24-47` (JPEG de 480 px, calidad 0,86, como data URL), `src/components/plan/PlanificacionEditor.jsx:442` (`addPlanProduct({ imagen })`), `src/stores/store.js:1657-1668` (`planLibrary.productos`), `:1678-1690` (`planLibrary.alimentos` también guarda `imagen`), `:1937-1956` (`runAutoBackup` copia todo, fotos incluidas, en cada `backup-<fecha>`).
- **Qué pasa:** con 300 productos son **9,9 MB de 21,9 MB (45 %)**. Se reescriben con cualquier cambio (hallazgo ALTA), se cifran, pasan por la IPC dos veces codificadas, se guardan 7 veces en las copias diarias (~70 MB solo de fotos) y viven como strings en el heap. Medido: el *stringify* casi no cambia sin fotos (es un string largo sin escapes), pero el tamaño en IPC, Rust, disco y cifrado sí, a ~2,4 ms/MB.
- **Escenario concreto:** Raquel va añadiendo fotos a la biblioteca de productos durante meses. Cada foto (~33 KB en base64) encarece para siempre todas las escrituras posteriores, y las copias de seguridad crecen a la vez.
- **Impacto para Raquel:** la app se vuelve más pesada cuanto más la usa. Es justo lo que alimenta los tirones del primer hallazgo.
- **Propuesta:** guardar las imágenes aparte: una clave `plan-images` que solo se escribe cuando cambia una foto, o ficheros `$APPDATA/plan-images/<id>.jpg` cifrados como los documentos, leídos bajo demanda. Las copias ZIP ya saben empaquetar ficheros. En el store queda solo `{ id, nombre, imagenRef }`. Se ahorran ~45 % de bytes por escritura y ~10 MB de heap. Si se hace el «una clave por colección», basta con que `planLibrary.productos` vaya en su propia clave.
- **Esfuerzo:** M
- **Confianza:** confirmado (tamaño medido con fotos reales del catálogo; el número de productos de Raquel es una estimación)

### [MEDIA] La sincronización de recetas de la web reescribe el store entero por cada receta que baja
- **Ubicación:** `src/hooks/useWebRecipes.js:44-50` (`onProgress` → `setWebRecipes` en cada receta), `src/services/webRecipes.js:191-197` (una a una, ~6 s cada una), `src/stores/store.js:1691-1696`.
- **Qué pasa:** cada receta descargada hace un `set()` de `planLibrary`, que provoca una escritura completa (hallazgo ALTA) y recalcula el `dishIndex` del editor abierto (`buildDishIndex`: **10,6 ms** con 1.260 + 300 recetas, `PlanificacionEditor.jsx:776`).
- **Escenario concreto:** primera sincronización o la web cambia muchas recetas: 300 recetas × 22 MB = **~6,6 GB escritos en ~30 min**, con un tirón de ~150 ms cada 6 s mientras Raquel edita una dieta.
- **Impacto para Raquel:** el editor de dietas va a tirones durante la media hora que dura la primera sincronización.
- **Propuesta:** escribir el progreso como mucho cada ~30 s o cada 20 recetas (lo ya bajado sigue a salvo) y una vez al final. Con claves por colección, solo se escribe `planLibrary`. El `dishIndex` puede actualizarse al final del lote. Escrituras: **−95 %**.
- **Esfuerzo:** S
- **Confianza:** confirmado (código; el tiempo por receta es el que documenta `CLAUDE.md`)

### [MEDIA] Arranque: carga monolítica por `eval`, copia de seguridad completa, sync y *prefetch* de todo en los primeros segundos
- **Ubicación:** `src/App.jsx:632-646` (rehidratación), `src/stores/store.js:56-70` (`load_data`), `tauri-1.8.3/src/api/ipc.rs:84` (las respuestas `String` no usan la ruta `JSON.parse`, viajan como literal en un `eval`), `src/App.jsx:339-350` (`runAutoBackup` + `validateDataIntegrity` nada más montar), `:309` (`useBackgroundJobs` lanza `syncAll` y los recordatorios en cuanto se monta), `:318-321` + `:218-220` (*prefetch* de todas las vistas a los 1,5 s).
- **Qué pasa:** medido a 22 MB, la carga hace: Rust lee y descifra (13 ms) y serializa la respuesta (25 ms) en el hilo principal; el `eval` del script de respuesta tarda **85 ms**; `JSON.parse` 44–50 ms; luego vienen la migración y el *merge*. **~170 ms** antes de pintar la app, que crecen con los datos. Justo después, el primer arranque de cada día hace otra serialización completa para `backup-<fecha>` (~130 ms) mientras arranca el sync de Google (con sus escrituras) y, a los 1,5 s, se descargan y compilan todas las vistas, entre ellas pdf-lib + fontkit (1,1 MB, por la importación estática de `Invoices.jsx:7`) y recharts (375 KB).
- **Escenario concreto:** Raquel abre la app por la mañana: spinner de «descifrando» y luego 1–2 s en los que la primera vista responde con tirones.
- **Impacto para Raquel:** arranque algo lento que irá a más con los datos. Hoy es tolerable.
- **Propuesta:** con claves por colección, cargar primero `config` + `clients` + `consultations` y el resto después. Retrasar la copia diaria y el primer sync ~10 s o hasta `requestIdleCallback`. Importar `pdfInvoiceGenerator` de forma dinámica (como ya se hace con `planPdf`) para que el *prefetch* no cargue pdf-lib. El `eval` de 85 ms desaparece si las colecciones son pequeñas.
- **Esfuerzo:** M
- **Confianza:** confirmado (costes medidos por separado; el tiempo total de arranque en el equipo de Raquel no se ha medido)

### [BAJA] La paleta Ctrl+K, oculta, recalcula su búsqueda (20 ms) en cada cambio del store
- **Ubicación:** `src/components/CommandPalette.jsx:22-27` (se suscribe a clientes, consultas, planes y facturas), `:87-174` (`results` con `clients.find` dentro de cada `filter`: O(n·m)), `:80-85` (`query` solo se vacía al **abrir**), `:213` (el `return null` va después del `useMemo`).
- **Qué pasa:** tras buscar algo («pa») y elegir un resultado, la paleta se cierra pero conserva `query`. Desde entonces, cada cambio de clientes, consultas, planes o facturas (una tecla en la entrevista, cada `set()` del sync) recalcula la búsqueda con el componente oculto. Medido: **19,6 ms** por cambio; con un `Map` de clientes, **0,9 ms**.
- **Escenario concreto:** Raquel busca un paciente con Ctrl+K, abre su ficha y escribe la entrevista → +20 ms por tecla además de los hallazgos anteriores.
- **Impacto para Raquel:** pequeño, pero se suma al retardo al teclear.
- **Propuesta:** no calcular `results` si `!open` (o vaciar `query` al cerrar) e indexar los clientes con un `Map` (pendiente nº 46).
- **Esfuerzo:** S
- **Confianza:** confirmado (medido)

### [BAJA] Listas largas sin virtualizar y con `.find()` por fila (Facturas, Planes, Clientes)
- **Ubicación:** `src/components/Invoices.jsx:31-43` (filtro con `clients.find` por factura en cada pulsación del buscador), `:162-164` (`clients.find` y `locations.find` por fila), `src/components/NutritionPlanEditor.jsx:471-472`, `src/components/ClientsView.jsx:130`, `src/components/CalendarView.jsx:240,465,527`.
- **Qué pasa:** se pintan todas las filas filtradas (2.000 facturas, 500 clientes) en cada pulsación del buscador, cada una con un `find` lineal sobre los clientes (2.000 × 500).
- **Escenario concreto:** Raquel escribe en el buscador de Facturación con varios años de facturas → cada letra re-renderiza ~2.000 filas.
- **Impacto para Raquel:** buscador de facturas algo lento cuando haya años de facturas.
- **Propuesta:** `Map` de clientes y sedes con `useMemo`. Pintar las primeras ~100 filas con «Mostrar más», o `content-visibility: auto` en las filas. Filtrar con `useDeferredValue(search)`.
- **Esfuerzo:** S
- **Confianza:** probable (el coste del `find` está medido en la paleta; el render del DOM de 2.000 filas no se ha podido medir sin navegador)

### [BAJA] pdf.js crea un worker nuevo en cada regeneración de la vista previa
- **Ubicación:** `src/components/plan/PdfPreview.jsx:34` (`getDocument` sin `worker`), `node_modules/pdfjs-dist/build/pdf.mjs:11409-11416` (sin `worker` ni `workerPort` → `new PDFWorker` por documento; `doc.destroy()` lo termina).
- **Qué pasa:** en cada regeneración se arranca un Web Worker que carga y compila `pdf.worker.min.mjs` (1,4 MB) y luego se destruye.
- **Escenario concreto:** 50 pausas mientras edita una dieta = 50 workers arrancados y destruidos.
- **Impacto para Raquel:** más latencia en la vista previa y picos de memoria. No bloquea la UI.
- **Propuesta:** crear un `new pdfjs.PDFWorker()` al cargar pdf.js, pasarlo como `getDocument({ data, worker })` y destruirlo al desmontar el editor.
- **Esfuerzo:** S
- **Confianza:** confirmado (código de pdf.js 4.10)

### [BAJA] Bundle: el chunk inicial lleva los 3 idiomas y las 1.260 recetas de la migración; el *prefetch* carga pdf-lib y recharts
- **Ubicación:** `src/stores/store.js:7-8` (importación estática de `recetasPlanificaciones.json` + `…V15.json`, solo para las migraciones v15/v16), `src/i18n.js` (4.071 líneas, ES/CA/EN juntos), `src/components/Invoices.jsx:7` y `InvoiceModal.jsx:6` (importan `pdfInvoiceGenerator` de forma estática), `vite.config.js`.
- **Qué pasa:** build medido: `index` **737 KB** (212 KB gzip), del que `i18n.js` es ~241 KB de fuente y las recetas ~250 KB (un literal de objeto que se construye en cada arranque aunque la migración ya no corra). `pdfFonts` **1.119 KB** (fontkit + pdf-lib + pako) se carga con el *prefetch* de Facturación. `ClientModal` 375 KB (recharts + lodash + d3). Compilar en V8 es barato (11 ms el `index`): el coste está sobre todo en la memoria y en evaluar el JSON en cada arranque.
- **Escenario concreto:** cada arranque evalúa ~250 KB de recetas que solo se usaron una vez al actualizar.
- **Impacto para Raquel:** casi nulo hoy (app local); menos memoria y un arranque algo más limpio.
- **Propuesta:** `await import()` de los dos JSON dentro de `migrateStore` (solo si `version < 16`). `pdfInvoiceGenerator` dinámico. Idiomas no activos como chunks dinámicos (opcional). Unos −250 KB del chunk inicial y pdf-lib fuera del *prefetch*.
- **Esfuerzo:** S
- **Confianza:** confirmado (medido con sourcemaps)

### [BAJA] `useNow(60000)` en el *shell* re-renderiza la vista entera cada minuto, también en la bandeja
- **Ubicación:** `src/App.jsx:302` (`useNow` en `AppContent`), `:575` (`<ViewLoader>` sin `memo`), `src/hooks/useNow.js`.
- **Qué pasa:** cada minuto se re-renderizan `AppContent` y, con él, la vista activa entera (Agenda, ficha…), y se recalcula el contador (7,8 ms, ver MEDIA), aunque la ventana esté oculta.
- **Escenario concreto:** la app en la bandeja durante 10 h hace ~600 re-renders de la vista que quedó abierta.
- **Impacto para Raquel:** CPU de fondo pequeña (unos ms por minuto).
- **Propuesta:** `React.memo(ViewLoader)` y pasar `now` solo al contador. Con `document.visibilityState === 'hidden'`, no refrescar.
- **Esfuerzo:** S
- **Confianza:** confirmado (código); no se ha comprobado si WebView2 marca la página como oculta cuando Tauri esconde la ventana

### [BAJA] Agenda: `weekStart`/`monthStart` nuevos en cada render invalidan el `useMemo` (pendiente nº 47)
- **Ubicación:** `src/components/CalendarView.jsx:677-696`.
- **Qué pasa:** `startOfWeek(cursor)` devuelve un `Date` nuevo en cada render y está en las dependencias: el filtro de las 5.000 consultas y los `useMemo` de `WeekView` se recalculan siempre.
- **Escenario concreto:** cualquier re-render de la Agenda (hover, cada minuto, un `set()` del sync) vuelve a filtrar.
- **Impacto para Raquel:** mínimo (~0,2–1 ms).
- **Propuesta:** `useMemo(() => startOfWeek(cursor), [cursor])`, o depender de `toISO(weekStart)`.
- **Esfuerzo:** S
- **Confianza:** confirmado

---

## Pendientes de la auditoría de oct-2026

| Nº | Estado nov-2026 |
|---|---|
| 6 — todo el store se serializa en cada `set()` | **Parcial.** Ahora se serializa una vez por escritura agrupada (300 ms), pero sigue siendo el store entero, en una sola clave, también por cambios no persistidos. → ALTA de arriba. |
| 42 — comandos síncronos en el hilo principal | **Parcial.** Argon2, SMTP, documentos y migraciones ya son `async`; `save_data`/`load_data` (los más frecuentes) siguen síncronos. |
| 43 — documentos de 50 MB en base64 por IPC | **Pendiente de la auditoría de oct-2026** (`main.rs:902-926` `read_file_as_base64`, `save_bytes_to_documents`). Un PDF de 20 MB son ~27 MB de base64 + doble codificación IPC. |
| 44 — la sync hace N `set()` | **Pendiente de la auditoría de oct-2026.** Medido: ~8 ms por `set()` con 5.000 consultas → MEDIA de arriba. |
| 45 — selectores que devuelven arrays nuevos | **Arreglado** (`useShallow` en `ClientDetailView.jsx:54-57`). |
| 46 — `.find()` dentro de bucles | **Pendiente de la auditoría de oct-2026** (CommandPalette, Invoices, NutritionPlanEditor, CalendarView) → BAJAS de arriba. |
| 47 — `weekStart`/`monthStart` invalidan `useMemo` | **Pendiente de la auditoría de oct-2026** → BAJA de arriba. |
| 48 — `AppContent` suscrito a todo `config` | **Arreglado** (selectores estrechos en `App.jsx:283-301`). `updateConfig` en cada tecla de Ajustes sigue provocando escritura completa e invalidando el contador. |

## Lo que está bien (breve, para no tocarlo)

- Vistas con `import()` dinámico y caché de módulo (`App.jsx:199-233`); generadores de PDF y pdf.js cargados bajo demanda (`planPdf.js:8-15`, `PdfPreview.jsx:7-17`); jszip dinámico.
- Undo/redo ligero: `_history` guarda solo el elemento borrado (y la cascada de un cliente), con un máximo de 20; no son copias del estado.
- Serialización agrupada con *debounce* y reintento (`store.js:34-53`), y `flushAllPending` antes de cerrar o bloquear.
- `ClientDetailView` con `useShallow`; Dashboard con `useMemo` y `Map` de clientes; `getReviewCandidates`/`getReminderCandidates` indexan por cliente (el coste es la creación de fechas, no un O(n²)).
- Fuentes de PDF en caché de memoria (`pdfFonts.js:13-21`); imágenes redimensionadas a 480 px antes de guardarlas; fuentes de la UI empaquetadas (nada de Google Fonts).
- Sync con índice `existingByGoogleId` y `clientIndex` construido una vez por sync; solo actualiza si `ev.updated` es más nuevo.
- `[profile.release]` con `lto`, `codegen-units = 1` y `strip`. Ni intervalos ni *listeners* sin limpiar (`useBackgroundJobs`, `useNow`, `UpdateChecker`, auto-bloqueo); los *object URLs* se revocan.

## Fuera de mi área (notas para otras sesiones)

- **01-datos / 07-código:** `CLAUDE.md` («Persistencia de Dades») dice que cada entidad se guarda en su propio JSON (`clients.json`, `consultations.json`…); en el código hay **un solo** `nutripolo-storage.json/.enc` (`store.js:2080`). Conviene corregir la documentación o hacer el cambio.
- **01-datos:** `runAutoBackup` solo se ejecuta al montar la app (`App.jsx:339-350`). Con la app en la bandeja y el inicio con Windows, si Raquel no la reinicia en días, no se hacen copias diarias. Cada copia es un duplicado completo del store (fotos incluidas): 7 × 22 MB ≈ 150 MB con el volumen objetivo.
- **01/04:** si `save_data` pasa a `async`, hace falta un mutex por clave para no desordenar escrituras (y el del cambio de contraseña que ya proponen).
- **08-dietas:** la vista previa del PDF está activada por defecto y regenera tras 700 ms (ver ALTA). Si se toca el generador, la caché de anchos no cambia el resultado visual.
