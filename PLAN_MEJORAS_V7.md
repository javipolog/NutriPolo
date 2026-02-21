# Contabilidad Autónomo v6 → v7: Pla de Millores

## Anàlisi Profunda

### Estat Actual
App Tauri (Rust + React/Zustand) amb ~8.500 línies. Funcionalitats principals: facturació, clients, gastos amb escaneig PDF intel·ligent, dashboard analític, impostos (303/130), disseny de factures, sync Notion, enviament email. Persistència via JSON files al filesystem local.

### Comparativa amb el Mercat (Holded, Quipu, Renn, FacturaDirecta, Xolo)
La teua app ja té features que moltes SaaS de pagament no ofereixen (escaneig PDF amb IA de categories, watcher de carpeta en temps real, memòria de proveïdors). Però li falten pilars bàsics que totes les apps pro tenen.

---

## 🔴 BUGS CRÍTICS I FIXES

### 1. Generació de número de factura amb duplicats potencials
**Problema:** `generateInvoiceNumber()` compta factures existents per obtindre el seq, però si s'esborra una factura i se'n crea una altra, pot reutilitzar un número ja usat. Això és il·legal en Espanya (numeració consecutiva obligatòria).
**Fix:** Guardar un comptador persistent per sèrie (`lastInvoiceSeq`) al store que mai decreix. Comprovar que el número generat no existeix ja.

### 2. Pèrdua de dades: sense autobackup
**Problema:** Si es corromp el JSON o l'app peta durant un `save_data`, es perden totes les dades. L'export manual existeix però ningú el fa.
**Fix:** Autobackup diari automàtic al directori de l'app (rotar últims 7 backups). Avisar si no s'ha fet backup en >7 dies.

### 3. Race condition en `setConfig/setInvoices/etc`
**Problema:** Zustand amb async storage pot tenir escriptures simultànies que es sobreescriuen. Especialment amb el watcher processant PDFs en paral·lel mentre l'usuari edita.
**Fix:** Implementar una cua d'escriptures (`write queue`) amb debounce al tauriStorage adapter, assegurant serialització.

### 4. Gastos: `ivaImporte` no sempre es calcula
**Problema:** Al formulari de gastos, l'IVA es calcula al vol però no es persisiteix correctament com a camp separat si l'usuari edita directament el total.
**Fix:** Recalcular i persistir `ivaImporte = baseImponible * (ivaPorcentaje / 100)` sempre al guardar.

### 5. Model 130: càlcul incorrecte
**Problema:** El model 130 actual aplica `rendimiento * 0.20 - irpfRetenido`, però el model 130 real és ACUMULAT dins l'any fiscal (caselles 01-07 acumulen tots els trimestres anteriors del mateix any, i es resten els pagaments ja fets en trimestres anteriors). El càlcul actual és per trimestre aïllat.
**Fix:** Implementar càlcul acumulat correcte del model 130: `(BaseAcumulada - GastosAcumulats) * 0.20 - RetencionesAcumuladas - PagosAnteriores`.

### 6. Validació de factura incompleta
**Problema:** Es pot guardar una factura sense client, sense número, amb import 0, sense concepte. Això genera problemes en cascada (dashboard, PDF, etc.)
**Fix:** Validació obligatòria: clienteId, numero (únic), fecha, concepto no buit, subtotal > 0.

---

## 🟡 MILLORES FUNCIONALS IMPORTANTS

### 7. Factures rectificatives (abonament)
**Què falta:** Si una factura té un error o cal un canvi, la llei obliga a emetre una factura rectificativa (no es pot simplement "editar" una factura emesa/pagada). Cap app sèria permet editar factures en estat emitida/pagada sense restriccions.
**Implementar:**
- Bloquejar edició de factures en estat `emitida`/`pagada` (només permetre canviar l'estat o afegir notes).
- Botó "Crear Rectificativa" que genera una factura negativa referenciada a l'original.
- Sèrie separada per rectificatives (R-).

### 8. Factures recurrents
**Què falta:** Si factures cada mes al mateix client el mateix import, has de crear-la a mà cada vegada.
**Implementar:** Opció de marcar una factura com a "plantilla recurrent" amb periodicitat (mensual, trimestral). Avís al dashboard quan toca generar-la. Generació amb un clic.

### 9. Pressupostos / Proformes
**Què falta:** Crear pressupostos que es puguen convertir en factura amb un clic.
**Implementar:** Mateixa estructura que una factura però amb estat `presupuesto` i numeració pròpia. Botó "Convertir a Factura".

### 10. PDF professional amb el design editor
**Problema crític:** El PDF generat per Rust amb `printpdf` és extremament bàsic (text pla, sense colors, sense logo, sense el disseny del DesignEditor). El component `InvoicePreviewModern` existeix però NOMÉS es renderitza a pantalla, no al PDF.
**Fix:** Generar el PDF des del frontend usant la mateixa preview (`html2canvas` + `jsPDF`, o millor: `@react-pdf/renderer`) per tindre el PDF idèntic a la preview amb els estils del DesignEditor. Eliminar el generador Rust bàsic.

### 11. Gestió de pagaments parcials
**Què falta:** Ara una factura és "pagada" o "emitida", sense matisos. En la realitat, pot haver-hi pagaments parcials.
**Implementar:** Camp `pagos: [{fecha, importe, metodo}]`. Estat automàtic: si sum(pagos) >= total → pagada, si sum > 0 → parcial, si 0 → pendent.

### 12. Export CSV/Excel per al gestor
**Què falta:** El gestor necessita els llibres de factures emeses i rebudes en format que puga importar al seu software (A3, Sage, etc.).
**Implementar:** Export a CSV/Excel amb les columnes estàndard: Data, Número, NIF Client/Proveïdor, Base, IVA%, Import IVA, IRPF%, Import IRPF, Total. Filtrable per trimestre/any.

### 13. Import/Export de dades complet
**Problema:** `exportDataToJSON` usa Blob + link.click() que NO funciona en Tauri (no hi ha DOM download). Cal usar `save` dialog de Tauri.
**Fix:** Usar `save()` de `@tauri-apps/api/dialog` + `writeBinaryFile` per exportar. Afegir botó d'importar que fusione o substituïsca dades.

---

## 🟢 MILLORES D'UX/UI

### 14. App.jsx massa gran: refactoritzar
**Problema:** `TaxesView`, `SettingsView`, `ClientsView` i `ClientModal` estan tots dins `App.jsx` (~600 línies). Dificulta manteniment.
**Fix:** Extraure cada vista al seu propi fitxer a `components/`.

### 15. Cerca global (Command Palette)
**Implementar:** `Ctrl+K` per obrir un command palette que permet buscar factures, clients, gastos, i navegar a qualsevol secció. Imprescindible per usabilitat pro.

### 16. Undo/Redo
**Implementar:** Middleware de Zustand `temporal` per undo/redo de les últimes accions (especialment eliminacions accidentals).

### 17. Confirmació d'eliminació de factures amb Notion sync
**Problema:** Si es suprimeix una factura que està sincronitzada amb Notion, no s'esborra de Notion automàticament (o sí via `deleteFromNotion` però sense feedback clar).

### 18. Taula de factures: scroll horitzontal excessiu
**Problema:** La taula de factures té massa columnes (12+), forçant scroll horitzontal constant. Poc usable.
**Fix:** Columnes ocultables per l'usuari. Per defecte mostrar: Número, Client, Data, Base, Total, Estat, Accions. Les altres com desplegable o tooltip.

### 19. Temes clar/fosc
**Implementar:** Ara només hi ha dark theme. Afegir opció de light theme o automàtic (seguir sistema). Molts usuaris prefereixen clar per a comptabilitat.

### 20. Responsive sidebar (col·lapsable)
**Implementar:** La sidebar ocupa 256px fixos. En pantalles xicotetes o quan vols maximitzar l'espai de treball, hauria de poder col·lapsar-se a icones.

---

## 🔵 ROBUSTESA I QUALITAT

### 21. Migració de dades (versionat d'esquema)
**Problema:** Si canvies l'estructura de dades (afegir camps, canviar formats), les dades antigues es corrompen. No hi ha cap sistema de migració.
**Fix:** Afegir `schemaVersion` al store. Al carregar, executar migracions seqüencials (v1→v2→v3...) que transformin les dades al format actual.

### 22. Validació d'integritat de dades
**Problema:** Es poden crear factures amb `clienteId` que apunta a un client que ja no existeix (si s'elimina el client abans). El mateix amb gastos orfes.
**Fix:** Validació d'integritat al carregar l'app. Marcar registres inconsistents i oferir reparació.

### 23. Error boundaries
**Problema:** Si un component peta (ex: dades corruptes), tota l'app es queda en blanc sense cap missatge.
**Fix:** Afegir `ErrorBoundary` components que atrapin errors i mostrin missatge amigable amb opció de recarregar.

### 24. Gestió d'anys fiscals complets
**Problema:** El dashboard filtra per any però no hi ha cap resum anual complet tipo "Resum fiscal 20XX" amb tots els trimestres, totals, i estat de presentació.
**Fix:** Vista de resum anual amb els 4 trimestres, models 303/130 de cadascun, resum per a la declaració de la renta (model 100).

---

## ⚫ AUTOCRÍTICA I CONTRAARGUMENTS

1. **"Verifactu no cal per a ús personal"** → Correcte, és per ús personal. Però la numeració consecutiva i les factures rectificatives SÍ són obligatòries legalment i l'app les incompleix. No implementar Verifactu, però sí corregir la legalitat bàsica.

2. **"L'export CSV és trivial, no cal prioritzar-lo"** → Fals. Sense export, cada trimestre has de copiar manualment les dades per al gestor. És la funcionalitat que més temps estalvia al dia a dia real.

3. **"El PDF bàsic és suficient"** → El disseny editor existeix amb preview professional, però genera un PDF lletjíssim amb printpdf. Incoherència greu: l'usuari configura tipografies i colors que després no apareixen al PDF real. Prioritat alta.

4. **"Undo és luxe"** → Eliminar accidentalment una factura sense undo és catastròfic. No és luxe, és necessitat.

5. **"Les millores d'UX (command palette, sidebar, temes) són cosmètiques"** → Per a una app que uses cada dia, la rapidesa de navegació i el confort visual fan la diferència entre usar-la amb gust o amb pereza.

---

## PLA D'EXECUCIÓ PER CLAUDE CODE

### Fase 1: Fixes Crítics (Prioritat Màxima)
```
1. Fix #1: Comptador persistent de factures (store.js)
2. Fix #5: Model 130 acumulat (App.jsx → TaxesView)
3. Fix #6: Validació obligatòria al guardar factures (InvoiceModal.jsx)
4. Fix #4: Persistir ivaImporte correctament (ExpensesView.jsx)
5. Fix #10: Migrar generació PDF a @react-pdf/renderer o html2canvas+jsPDF
   - Eliminar generate_invoice_pdf de main.rs
   - Crear servei pdfGenerator.js que renderitze InvoicePreviewModern a PDF
6. Fix #14: Refactoritzar App.jsx → extraure TaxesView, SettingsView, ClientsView
```

### Fase 2: Robustesa
```
7. #2: Autobackup diari amb rotació de 7 dies
8. #3: Write queue al tauriStorage adapter
9. #21: Schema versioning + migracions
10. #22: Validació d'integritat de dades al boot
11. #23: Error boundaries
12. #13: Fix export JSON per Tauri (usar dialog save)
```

### Fase 3: Funcionalitats Pro
```
13. #7: Factures rectificatives (bloqueig + abonament)
14. #8: Factures recurrents (plantilles + avisos)
15. #11: Pagaments parcials
16. #12: Export CSV/Excel per trimestre
17. #9: Pressupostos convertibles a factura
18. #24: Resum fiscal anual complet
```

### Fase 4: UX Polish
```
19. #15: Command Palette (Ctrl+K)
20. #16: Undo/Redo (zustand temporal middleware)
21. #18: Columnes ocultables a la taula de factures
22. #20: Sidebar col·lapsable
23. #19: Light theme
```

### Notes per a Claude Code
- **Stack:** Tauri v1 (NO migrar a v2), React 18, Zustand 4, Tailwind 3, Recharts 2
- **Idioma del codi:** Comentaris en valencià, UI en castellà (com l'actual)
- **No trencar:** El watcher de carpetes, el scanner PDF, la memòria de proveïdors, la sync Notion — funcionen bé
- **Testing:** Almenys provar manualment cada canvi. No cal test suite formal per app personal
- **Fitxers grans:** Dashboard.jsx (907 línies) i pdfScanner.js (705 línies) no tocar si no cal
- **El PDF és el canvi més impactant:** L'usuari veu un preview preciós i rep un PDF lletjíssim. Solucionar això és el que més satisfacció donarà
