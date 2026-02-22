# 🎯 Pla de Precisió Zero-Error en Gastos — PoloTrack

## Resum Executiu

L'objectiu és reduir a **zero** els errors d'importació automàtica de factures de gastos en els 4 camps crítics: **data d'emissió**, **import + IVA**, **proveïdor** i **categoria**. La clau és combinar un sistema de **regles configurable per l'usuari** (determinista, 100% fiable) amb millores al motor d'extracció PDF (heurístic, mai 100%), de manera que les regles sempre tinguen prioritat sobre la detecció automàtica.

---

## Diagnòstic Actual (per camp)

### 1. 📅 Data d'Emissió
**Com funciona ara:** Regex per formats `dd/mm/yyyy`, `yyyy-mm-dd`, dates llargues en castellà/anglés. Scoring per proximitat a keywords (`fecha`, `emisión`). Penalització per keywords de venciment (`vencimiento`, `due date`). Fallback a data inferida del path (`/2025/03/`).

**On falla:**
- Factures amb múltiples dates (emissió, venciment, període de facturació) → pot agafar la incorrecta
- Dates dins de taules de línies de detall (dates de serveis) confonen el scoring
- Format ambiguo `01/02/2025` → és 1 de febrer o 2 de gener? Depén del proveïdor
- Factures sense data explícita (rebuts, tiquets) → fallback al path que pot ser incorrecte
- Períodes de facturació (`01/01/2025 - 31/01/2025`) → pot agafar qualsevol de les dos

### 2. 💰 Import + IVA
**Com funciona ara:** Detecta imports via regex amb scoring posicional (bold, tamany font, proximitat a keywords `total`, `base imponible`). Cross-validació `base + IVA = total`. Fallback via IVA candidates. Default a 21%.

**On falla:**
- Factures amb múltiples línies de detall → imports parcials puntuen alt
- Descomptes no considerats → el cross-validation falla
- Factures amb recàrrec d'equivalència o IRPF retingut → trenca la fórmula `base * 1.21 = total`
- Factures en moneda estrangera (USD, GBP) amb conversió
- Imports amb format atípic (`1.234,56 €` vs `1234.56 EUR`)
- IVA mixt dins la mateixa factura (21% + 10%)
- Factures exemptes d'IVA (assegurances, serveis mèdics) → el 0% no es detecta bé

### 3. 👤 Proveïdor
**Com funciona ara:** Scoring per bold, tamany de font, posició vertical (header = top), sufixos legals (S.L., S.A.), dominis web. Matching contra proveïdors existents i memòria.

**On falla:**
- El nom del teu propi negoci apareix destacat a factures on tu eres el client → falsa detecció
- Factures generades per plataformes (Stripe, PayPal, Amazon) → detecta la plataforma, no el proveïdor real
- Raó social vs nom comercial → `Telefónica de España S.A.U.` vs `Movistar`
- PDFs escanejats o amb fonts incrustades no estàndard → el text no s'extrau bé
- Proveïdors amb noms genèrics (`Servicios Integrales S.L.`) → difícil de vincular

### 4. 🏷️ Categoria
**Com funciona ara:** Cadena de prioritat: regles personalitzades → memòria proveïdor → expenses existents → keywords. Les regles busquen paraules clau en el text/proveïdor/concepte/filename.

**On falla:**
- Les regles actuals **NOMÉS assignen categoria**, no poden forçar proveïdor, IVA o data
- Un proveïdor pot tindre múltiples categories (Amazon pot ser `Equipos informáticos` o `Material de oficina`)
- Keywords massa genèriques (`google` → és Google Ads o Google Workspace?)
- Nous proveïdors sense historial → cau a `Otros`

---

## Arquitectura de la Solució

### Principi Fonamental
> **Regla de l'usuari > Memòria > Detecció automàtica**
> 
> Si l'usuari ha definit una regla que fa match, eixa regla és LLEI. No es qüestiona. La detecció automàtica només actua quan no hi ha regla aplicable.

### Diagrama de Flux Proposat

```
PDF Detectat
    │
    ▼
Extracció de text (pdfjs) ──→ rawText, metadataItems
    │
    ▼
Detecció bàsica (actual): fecha, total, base, iva, proveïdor, cif, categoria
    │
    ▼
┌─────────────────────────────────────────────────────┐
│  MOTOR DE REGLES (NOU - Fase 1)                     │
│                                                     │
│  Per cada regla (per ordre de prioritat):            │
│    ① Avaluar condicions (keywords + matchField)      │
│    ② Si match → SOBREESCRIURE camps configurats:     │
│       - proveïdor (forçat)                          │
│       - categoria (forçat)                          │
│       - ivaPorcentaje (forçat)                      │
│       - dateStrategy (forçat)                       │
│       - cifNif (forçat)                             │
│       - deduciblePorcentaje (forçat)                │
│    ③ Camps NO configurats → mantenir auto-detect     │
│    ④ BREAK al primer match (no continuar)            │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│  MEMÒRIA DE PROVEÏDORS (existent, millorat)         │
│                                                     │
│  Si no hi ha regla → buscar en memòria:              │
│    - Categoria recordada                            │
│    - IVA habitual del proveïdor                     │
│    - CIF recordat                                   │
│    - Nom normalitzat del proveïdor                  │
└─────────────────────────────────────────────────────┘
    │
    ▼
Resultat final amb `source` per cada camp (rule/memory/auto)
    │
    ▼
Vista prèvia amb badges de confiança per camp
```

---

## Fases d'Implementació

---

## FASE 1: Sistema de Regles Avançat (CORE — Prioritat Màxima)

### 1.1 Ampliar el model de dades de `customRules`

**Fitxer:** `src/services/providerMemory.js`

Canviar el model de regla de:
```javascript
// ACTUAL
{
  id, name, keywords, categoria,
  matchField, matchMode, priority, enabled
}
```

A:
```javascript
// NOU
{
  id: string,
  name: string,                    // "Iberdrola", "Amazon Tech", etc.
  enabled: boolean,
  priority: number,

  // ── Condicions de matching ──
  conditions: {
    keywords: string,              // "iberdrola, i-de redes" (comes)
    matchField: 'any' | 'proveedor' | 'concepto' | 'filename' | 'rawText' | 'cif',
    matchMode: 'any' | 'all',     // Qualsevol keyword o totes
  },

  // ── Accions (què sobreescriure) ──
  // Cada camp és null = "no tocar, usar autodetecció"
  // Cada camp amb valor = "forçar sempre este valor"
  actions: {
    proveedor: string | null,       // Ex: "Iberdrola S.A."
    categoria: string | null,       // Ex: "Suministros"
    ivaPorcentaje: number | null,   // Ex: 21, 10, 0
    cifNif: string | null,          // Ex: "A48010615"
    concepto: string | null,        // Ex: "Subministrament elèctric"
    deducible: boolean | null,      // Ex: true
    deduciblePct: number | null,    // Ex: 30 (per ús parcial vivenda)

    // Estratègia de data (NOU)
    dateStrategy: null | {
      prefer: 'first' | 'last' | 'nearest_to_keyword',
      keyword: string | null,       // Ex: "fecha emisión", "fecha factura"
      skipKeywords: string[],       // Ex: ["vencimiento", "periodo"]
      dayOfMonth: number | null,    // Forçar dia fix (ex: factures sempre el dia 1)
    }
  },

  createdAt: string,
  updatedAt: string,
}
```

**Migració:** Convertir les regles existents al nou format. Les regles actuals que només tenen `categoria` es migren amb `actions: { categoria: X, resta null }`.

### 1.2 Aplicar regles al pipeline de scanning

**Fitxer:** `src/services/pdfScanner.js` — funció `parseInvoiceText()`

Després de la detecció automàtica, aplicar les regles:

```javascript
// Pseudocodi del flux millorat
const autoDetected = {
  fecha, proveedor, cifProveedor, categoria, baseImponible,
  ivaPorcentaje, total, concepto
};

// Aplicar regles
const ruleResult = providerMemory.applyAdvancedRules({
  proveedor: autoDetected.proveedor,
  concepto: autoDetected.concepto,
  filename: context.filename || '',
  rawText: cleanText,
  cif: autoDetected.cifProveedor,
});

if (ruleResult) {
  // Sobreescriure NOMÉS els camps que la regla defineix
  if (ruleResult.actions.proveedor) autoDetected.proveedor = ruleResult.actions.proveedor;
  if (ruleResult.actions.categoria) autoDetected.categoria = ruleResult.actions.categoria;
  if (ruleResult.actions.ivaPorcentaje !== null) {
    autoDetected.ivaPorcentaje = ruleResult.actions.ivaPorcentaje;
    // Recalcular base si forcem IVA
    autoDetected.baseImponible = autoDetected.total / (1 + ruleResult.actions.ivaPorcentaje / 100);
  }
  if (ruleResult.actions.cifNif) autoDetected.cifProveedor = ruleResult.actions.cifNif;
  if (ruleResult.actions.concepto) autoDetected.concepto = ruleResult.actions.concepto;
  if (ruleResult.actions.deducible !== null) autoDetected.deducible = ruleResult.actions.deducible;
  if (ruleResult.actions.deduciblePct !== null) autoDetected.deduciblePct = ruleResult.actions.deduciblePct;

  // Estratègia de data
  if (ruleResult.actions.dateStrategy) {
    autoDetected.fecha = applyDateStrategy(dateCandidates, ruleResult.actions.dateStrategy, context);
  }

  autoDetected.ruleApplied = ruleResult.ruleName;
  autoDetected.ruleId = ruleResult.ruleId;
}
```

### 1.3 Nova funció `applyDateStrategy`

```javascript
const applyDateStrategy = (dateCandidates, strategy, context) => {
  let candidates = [...dateCandidates];

  // Filtrar dates amb keywords a evitar
  if (strategy.skipKeywords?.length) {
    candidates = candidates.filter(c =>
      !strategy.skipKeywords.some(sk => c.surroundingText?.toLowerCase().includes(sk))
    );
  }

  // Preferència per keyword específic
  if (strategy.prefer === 'nearest_to_keyword' && strategy.keyword) {
    candidates.sort((a, b) => {
      const aHas = a.surroundingText?.toLowerCase().includes(strategy.keyword.toLowerCase());
      const bHas = b.surroundingText?.toLowerCase().includes(strategy.keyword.toLowerCase());
      if (aHas && !bHas) return -1;
      if (bHas && !aHas) return 1;
      return b.score - a.score;
    });
  }

  // Primera o última data
  if (strategy.prefer === 'first') candidates.sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (strategy.prefer === 'last') candidates.sort((a, b) => b.fecha.localeCompare(a.fecha));

  let result = candidates[0]?.fecha || context.fallbackDate;

  // Forçar dia del mes
  if (strategy.dayOfMonth && result) {
    const [y, m] = result.split('-');
    result = `${y}-${m}-${String(strategy.dayOfMonth).padStart(2, '0')}`;
  }

  return result;
};
```

### 1.4 Actualitzar UI del RulesManager

**Fitxer:** `src/components/RulesManager.jsx`

Redissenyar el formulari per permetre configurar TOTS els camps d'acció:

```
┌─────────────────────────────────────────────────┐
│  ⚡ Nova Regla                                   │
│                                                 │
│  Nom: [Iberdrola___________________]            │
│                                                 │
│  ── Quan detectar ──                            │
│  Keywords: [iberdrola, i-de redes___]           │
│  Cercar en: [▼ Qualsevol camp      ]            │
│  Condició:  [▼ Almenys una paraula ]            │
│                                                 │
│  ── Què assignar (deixar buit = autodetectar) ──│
│                                                 │
│  Proveïdor:  [Iberdrola S.A.______]   ← NOU    │
│  Categoria:  [▼ Suministros       ]             │
│  CIF/NIF:    [A48010615___________]   ← NOU    │
│  IVA:        [▼ 21%               ]   ← NOU    │
│  Concepte:   [Subministrament elèctric] ← NOU  │
│  Deduïble:   [▼ Sí, al 30%        ]   ← NOU    │
│                                                 │
│  ── Data (avançat) ──                           │
│  Estratègia: [▼ Més propera a keyword]  ← NOU  │
│  Keyword:    [fecha emisión________]   ← NOU    │
│  Ignorar:    [vencimiento, periodo_]   ← NOU    │
│                                                 │
│  [Cancel·lar]              [💾 Guardar regla]    │
└─────────────────────────────────────────────────┘
```

La secció "Què assignar" es mostra en mode **acorden/collapsable** amb les opcions avançades (data, deduïble) amagades per defecte. Cada camp té un toggle o es deixa buit per indicar "no sobreescriure".

### 1.5 Regles per defecte pre-configurades

Afegir un conjunt ampliat d'exemples que l'usuari pot importar amb un clic:

```javascript
const EXAMPLE_RULES_V2 = [
  {
    name: 'Iberdrola',
    conditions: { keywords: 'iberdrola, i-de redes', matchField: 'any', matchMode: 'any' },
    actions: { proveedor: 'Iberdrola S.A.', categoria: 'Suministros', ivaPorcentaje: 21, cifNif: 'A95075578' }
  },
  {
    name: 'Endesa',
    conditions: { keywords: 'endesa, enel', matchField: 'any', matchMode: 'any' },
    actions: { proveedor: 'Endesa Energía S.A.', categoria: 'Suministros', ivaPorcentaje: 21, cifNif: 'A81948077' }
  },
  {
    name: 'Movistar',
    conditions: { keywords: 'movistar, telefonica, telefónica', matchField: 'any', matchMode: 'any' },
    actions: { proveedor: 'Telefónica de España S.A.U.', categoria: 'Telecomunicaciones', ivaPorcentaje: 21, cifNif: 'A82018474' }
  },
  {
    name: 'Vodafone',
    conditions: { keywords: 'vodafone', matchField: 'any', matchMode: 'any' },
    actions: { proveedor: 'Vodafone España S.A.U.', categoria: 'Telecomunicaciones', ivaPorcentaje: 21, cifNif: 'A80907397' }
  },
  {
    name: 'Adobe',
    conditions: { keywords: 'adobe', matchField: 'any', matchMode: 'any' },
    actions: { proveedor: 'Adobe Systems', categoria: 'Software y suscripciones', ivaPorcentaje: 21 }
  },
  {
    name: 'Amazon (equips)',
    conditions: { keywords: 'amazon', matchField: 'any', matchMode: 'any' },
    actions: { proveedor: 'Amazon EU S.à r.l.', categoria: 'Equipos informáticos', ivaPorcentaje: 21 }
  },
  {
    name: 'Seguretat Social / RETA',
    conditions: { keywords: 'seguridad social, TGSS', matchField: 'any', matchMode: 'any' },
    actions: { proveedor: 'Seguridad Social', categoria: 'Seguros', ivaPorcentaje: 0, deducible: true }
  },
  {
    name: 'Assegurança RC',
    conditions: { keywords: 'mapfre, axa, allianz, zurich, seguro profesional', matchField: 'any', matchMode: 'any' },
    actions: { categoria: 'Seguros', ivaPorcentaje: 0 }
  },
  {
    name: 'Gasolinera',
    conditions: { keywords: 'repsol, cepsa, bp, shell, galp, gasolina, combustible', matchField: 'any', matchMode: 'any' },
    actions: { categoria: 'Transporte', ivaPorcentaje: 21 }
  },
  {
    name: 'Gestoria',
    conditions: { keywords: 'gestoria, gestoría, asesoria, asesoría', matchField: 'any', matchMode: 'any' },
    actions: { categoria: 'Gestoría y asesoría', ivaPorcentaje: 21 }
  },
];
```

---

## FASE 2: Millores al Motor d'Extracció PDF

### 2.1 Data d'Emissió — Millores al `parseInvoiceText`

**Fitxer:** `src/services/pdfScanner.js`

**A. Guardar `surroundingText` en cada `dateCandidate`:**
```javascript
// ACTUAL: dateCandidates.push({ fecha: fechaStr, score });
// NOU:
dateCandidates.push({
  fecha: fechaStr,
  score,
  surroundingText: surrounding,  // ← Nou camp per a regles dateStrategy
  matchType: type,               // 'std', 'es', 'en'
  rawMatch: dx[0],
});
```

**B. Millorar scoring de dates:**
- Afegir penalització per dates dins de taules de línies de detall (detectar proximitat a keywords com `cantidad`, `descripción`, `unidades`)
- Afegir bonus per dates que apareixen a la primera pàgina, part superior
- Si hi ha exactament 2 dates i una conté keyword de venciment → l'altra és emissió (bonus +300)
- Afegir detecció de períodes (`del X al Y`) i agafar la data final com emissió

**C. Desambiguació `dd/mm` vs `mm/dd`:**
- Default a `dd/mm/yyyy` (format espanyol)
- Si es detecta que el proveïdor és internacional (domini `.com`, text en anglés) → avaluar `mm/dd/yyyy`
- Validació: si el dia > 12, el format és inequívoc

### 2.2 Import + IVA — Millores al cross-validation

**A. Suport per IVA mixt:**
```javascript
// Detectar patrons com "IVA 21% ... 42,00 €" i "IVA 10% ... 5,00 €"
// en la mateixa factura. Sumar ambdós IVAs.
const ivaLineRegex = /iva\s*(\d{1,2})\s*%?\s*[:\s]*([\d.,]+)/gi;
let ivaLines = [];
let match;
while ((match = ivaLineRegex.exec(cleanText)) !== null) {
  ivaLines.push({ percent: parseInt(match[1]), amount: parseAmount(match[2]) });
}
if (ivaLines.length > 1) {
  // IVA mixt: sumar totes les línies
  const totalIva = ivaLines.reduce((sum, l) => sum + l.amount, 0);
  // Verificar que base + totalIva ≈ total
}
```

**B. Suport per IRPF retingut en factures de serveis:**
```javascript
// Patró: Base 1000 + IVA 21% (210) - IRPF 15% (-150) = Total 1060
// Detectar "retención", "IRPF", "retencion"
const irpfRegex = /(?:retenci[oó]n|irpf)\s*[\-:]?\s*(\d{1,2})\s*%?\s*[\-:]?\s*([\d.,]+)/i;
const irpfMatch = cleanText.match(irpfRegex);
if (irpfMatch) {
  const irpfPercent = parseInt(irpfMatch[1]);
  const irpfAmount = parseAmount(irpfMatch[2]);
  // Ajustar cross-validation: base + iva - irpf = total
}
```

**C. Suport per recàrrec d'equivalència:**
```javascript
// Detectar "recargo equivalencia", "R.E." seguit de percentatge
```

**D. Millor parseAmount per formats edge-case:**
```javascript
// "1.234,56 €" → 1234.56 ✓ (ja funciona)
// "1,234.56 EUR" → 1234.56 (format anglés)
// "€1234.56" → 1234.56
// "1234.56-" → -1234.56 (nota de crèdit)
```

### 2.3 Proveïdor — Millores al detector

**A. Filtrar el propi nom/empresa de l'usuari de forma més robusta:**
```javascript
// ACTUAL: filtra per NIF i nom simple
// NOU: filtrar també per:
// - IBAN de l'usuari
// - Email de l'usuari
// - Adreça de l'usuari (primers 20 chars)
// - Qualsevol paraula del nom de l'usuari amb >3 chars
```

**B. Detectar emissor vs receptor:**
```javascript
// Buscar patrons explícits:
// "Emisor:", "De:", "From:", "Vendedor:", "Proveedor:" → El que ve després és el proveïdor
// "Cliente:", "Para:", "To:", "Destinatario:", "Bill to:" → El que ve després eres TU
// Si detectem el nostre NIF a prop de "cliente" → el text a prop de "emisor" és el proveïdor
```

**C. Millorar matching per plataformes de pagament:**
```javascript
// Si detectem "Stripe", "PayPal", "Bizum" com a proveïdor,
// buscar el nom real del comerciant dins del text
// Patrons: "Comercio:", "Merchant:", "Vendedor:", "Establecimiento:"
```

---

## FASE 3: Confiança Visual i Validació a la UI

### 3.1 Badges de confiança per camp

**Fitxer:** `src/components/ExpensesView.jsx` (modal d'importació)

A la preview d'importació, cada camp mostra d'on ve el valor:

```
┌──────────────────────────────────────────────┐
│  📄 Factura_Iberdrola_Enero.pdf              │
│                                              │
│  Proveïdor:  Iberdrola S.A.     🟢 REGLA    │
│  CIF:        A48010615          🟢 REGLA    │
│  Data:       2025-01-15         🟡 AUTO     │
│  Total:      145,20 €           🟡 AUTO     │
│  Base:       120,00 €           🟢 VALIDAT  │
│  IVA:        21%  (25,20 €)     🟢 REGLA    │
│  Categoria:  Suministros        🟢 REGLA    │
│  Deduïble:   Sí (30%)          🟢 REGLA    │
│                                              │
│  ℹ️ Regla aplicada: "Iberdrola"              │
└──────────────────────────────────────────────┘
```

Llegenda:
- 🟢 **REGLA** — Valor forçat per regla d'usuari (100% fiable)
- 🟢 **VALIDAT** — Cross-validation base + IVA = total correcte
- 🟢 **MEMÒRIA** — Recordat de correccions anteriors (alta fiabilitat)
- 🟡 **AUTO** — Detecció automàtica (revisar si cal)
- 🔴 **DUBTE** — Baixa confiança, l'usuari hauria de verificar

### 3.2 Aprendre de cada correcció manual

Quan l'usuari corregeix un camp durant la importació:

```javascript
// Oferir crear regla automàticament
if (userChangedField && !ruleWasApplied) {
  toast.action(
    `Has corregit "${fieldName}". Vols crear una regla per a ${proveedor}?`,
    { label: 'Crear regla', onClick: () => openRuleCreatorPrefilled(detectedData) }
  );
}
```

### 3.3 Validacions automàtiques post-importació

Afegir validacions que marquen gastos sospitosos:

```javascript
const validateExpense = (expense) => {
  const warnings = [];

  // Data futura
  if (new Date(expense.fecha) > new Date()) {
    warnings.push({ field: 'fecha', message: 'La data és futura' });
  }

  // Data molt antiga (>6 mesos)
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  if (new Date(expense.fecha) < sixMonthsAgo) {
    warnings.push({ field: 'fecha', message: 'La data és de fa més de 6 mesos' });
  }

  // Total = 0 o negatiu
  if (expense.total <= 0) {
    warnings.push({ field: 'total', message: "L'import és zero o negatiu" });
  }

  // Base + IVA ≠ Total (tolerància 0.05)
  const expectedTotal = expense.baseImponible * (1 + expense.ivaPorcentaje / 100);
  if (Math.abs(expectedTotal - expense.total) > 0.05) {
    warnings.push({ field: 'total', message: 'Base + IVA no quadra amb Total' });
  }

  // Proveïdor desconegut
  if (expense.proveedor === 'Proveedor Desconocido') {
    warnings.push({ field: 'proveedor', message: 'No s\'ha pogut detectar el proveïdor' });
  }

  // Categoria = Otros
  if (expense.categoria === 'Otros') {
    warnings.push({ field: 'categoria', message: 'Categoria no detectada' });
  }

  // CIF buit
  if (!expense.cifProveedor) {
    warnings.push({ field: 'cif', message: 'CIF/NIF del proveïdor no detectat' });
  }

  return warnings;
};
```

---

## FASE 4: Matching per CIF/NIF (Sistema Anti-Ambigüitat)

### 4.1 CIF com a identificador primari

El CIF/NIF és l'identificador **únic i inequívoc** d'un proveïdor. Si detectem un CIF que ja coneixem, podem sobreescriure tot:

```javascript
// Al pipeline d'extracció, DESPRÉS de detectar el CIF:
const cifMatch = providerMemory.findByCif(detectedCifNif);
if (cifMatch) {
  // Tenim TOTAL CERTESA de qui és este proveïdor
  result.proveedor = cifMatch.originalName;
  result.categoria = cifMatch.categoria;
  result.ivaPorcentaje = cifMatch.ivaPorcentaje ?? result.ivaPorcentaje;
  result.categorySource = 'cif_match';
  result.confidence = 'high';
}
```

### 4.2 Afegir `matchField: 'cif'` a les regles

Permetre que les regles facen match pel CIF detectat al PDF:

```javascript
// Ex: Si el PDF conté CIF "A48010615" → és Iberdrola segur
{
  name: 'Iberdrola (per CIF)',
  conditions: { keywords: 'A48010615', matchField: 'cif', matchMode: 'any' },
  actions: { proveedor: 'Iberdrola S.A.', categoria: 'Suministros', ivaPorcentaje: 21 }
}
```

### 4.3 Índex de CIFs al providerMemory

```javascript
// Afegir al store:
cifIndex: {},  // { "A48010615": "iberdrola" } → apunta a la key del providers map

// Nou mètode:
findByCif: (cif) => {
  const { cifIndex, providers } = get();
  const cleanCif = cif?.replace(/[\s-]/g, '').toUpperCase();
  if (!cleanCif) return null;
  const providerKey = cifIndex[cleanCif];
  return providerKey ? providers[providerKey] : null;
},

// Actualitzar l'índex quan s'aprèn:
learnFromCorrection: (original, corrected) => {
  // ...existing code...
  if (corrected.cifProveedor) {
    cifIndex[corrected.cifProveedor.toUpperCase()] = key;
  }
  set({ providers, cifIndex });
}
```

---

## FASE 5: Suggeridor Intel·ligent de Regles

### 5.1 Detectar patrons repetitius

Després d'importar 3+ gastos del mateix proveïdor sense regla, suggerir:

```javascript
// Al importar un gasto:
const providerKey = normalizeKey(expense.proveedor);
const sameProviderCount = expenses.filter(e =>
  normalizeKey(e.proveedor) === providerKey
).length;

if (sameProviderCount >= 3 && !hasRuleForProvider(providerKey)) {
  const mostCommonCategory = getMostFrequentCategory(expenses, providerKey);
  toast.action(
    `Ja portes ${sameProviderCount} gastos de ${expense.proveedor}. Crear regla automàtica?`,
    {
      label: 'Crear',
      onClick: () => addCustomRule({
        name: expense.proveedor,
        conditions: { keywords: providerKey, matchField: 'any', matchMode: 'any' },
        actions: {
          proveedor: expense.proveedor,
          categoria: mostCommonCategory,
          ivaPorcentaje: expense.ivaPorcentaje,
          cifNif: expense.cifProveedor,
        }
      })
    }
  );
}
```

### 5.2 Dashboard de precisió

A la vista de gastos o settings, mostrar:

```
┌────────────────────────────────────────────┐
│  📊 Precisió d'importació                  │
│                                            │
│  Gastos amb regla:    78% (142 de 182)     │
│  Gastos amb memòria:  12% (22 de 182)      │
│  Gastos auto-detect:  10% (18 de 182)      │
│                                            │
│  Proveïdors sense regla: 5                 │
│  │  → Amazon EU (8 gastos) [Crear regla]   │
│  │  → Mapfre (4 gastos) [Crear regla]      │
│  │  → Repsol (3 gastos) [Crear regla]      │
│  │  → PCComponentes (2 gastos) [Crear]     │
│  │  → Freelancer X (1 gasto) [Crear]       │
│                                            │
│  Gastos amb warnings: 3                    │
│  │  → Base+IVA no quadra (2)               │
│  │  → Proveïdor desconegut (1)             │
└────────────────────────────────────────────┘
```

---

## Resum de Fitxers a Modificar

| Fitxer | Canvis |
|--------|--------|
| `src/services/providerMemory.js` | Nou model de regla, `applyAdvancedRules()`, `findByCif()`, `cifIndex`, migració regles antigues |
| `src/services/pdfScanner.js` | Integrar regles avançades, `applyDateStrategy()`, guardar `surroundingText` en dates, millorar scoring dates, suport IVA mixt, IRPF, millor detecció proveïdor |
| `src/components/RulesManager.jsx` | Formulari ampliat amb tots els camps d'acció, secció avançada per dates, toggle per cada camp, preview en temps real |
| `src/components/ExpensesView.jsx` | Badges de confiança per camp, suggeridor de regles, validacions post-importació, dashboard de precisió |
| `src/stores/store.js` | Migració del model de regles (si cal) |

---

## Ordre d'Execució Recomanat

1. **Fase 1.1** — Nou model de dades de regles + migració
2. **Fase 1.2** — Integrar `applyAdvancedRules` al pipeline
3. **Fase 1.4** — Actualitzar UI del RulesManager (formulari complet)
4. **Fase 1.5** — Regles d'exemple ampliades
5. **Fase 4** — Matching per CIF (molt valuós, poc esforç)
6. **Fase 3.1** — Badges de confiança a la preview
7. **Fase 3.3** — Validacions post-importació
8. **Fase 2.1** — Millores dates (surroundingText, scoring)
9. **Fase 2.2** — Millores import (IVA mixt, IRPF)
10. **Fase 2.3** — Millores proveïdor (emissor vs receptor)
11. **Fase 1.3** — `applyDateStrategy` (amb regles de data)
12. **Fase 3.2** — Suggerir crear regla en correccions
13. **Fase 5** — Suggeridor intel·ligent + dashboard precisió

---

## Resultat Esperat

| Camp | Abans | Després |
|------|-------|---------|
| Data d'emissió | ~75% precisió | ~95% (auto) / 100% (amb regla dateStrategy) |
| Import + IVA | ~80% precisió | ~95% (auto) / 100% (amb regla ivaPorcentaje) |
| Proveïdor | ~70% precisió | ~90% (auto) / 100% (amb regla proveedor o CIF) |
| Categoria | ~65% precisió | ~85% (auto) / 100% (amb regla categoria) |

**Amb regles configurades per als proveïdors habituals (10-20 regles), l'usuari pot arribar al 100% en pràcticament tots els gastos recurrents.** La detecció automàtica només actuarà per proveïdors nous o esporàdics.
