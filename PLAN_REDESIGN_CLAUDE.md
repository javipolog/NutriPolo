# PLAN: Rediseño Visual Inspirado en Claude/Anthropic

## Visió General

Transformar PoloTrack d'un disseny "dark tech" genèric (slate/blue, glassmorphism) a una estètica **càlida, sofisticada i premium** inspirada en el llenguatge visual de Claude by Anthropic. L'objectiu és una app de comptabilitat que transmeta **confiança, calidesa i professionalitat** — no fredor tecnològica.

### Principis de Disseny
1. **Calidesa sobre fredor** — Tons crema i terracota vs blaus freds i slate
2. **Espai generós** — Breathing room, no densitat
3. **Tipografia amb personalitat** — Serif per títols, sans-serif net per cos
4. **Subtilesa** — Bordes fins, ombres suaus, transicions discretes
5. **Coherència** — Cada element parla el mateix idioma visual

### Paleta Objectiu (Claude DNA)
```
Accent:      #C15F3C (Crail — terracota càlid)
Accent hover: #A84E30
Accent light: #D4845F
Background:  #FAF9F6 (crema molt suau)
Surface:     #F4F3EE (Pampas — crema)
Surface alt: #EDEAE3 (crema mig)
Border:      #E8E5DD (beige border)
Border dark: #D4D0C8
Neutral:     #B0AEA5 (Cloudy)
Text:        #1A1915 (quasi-negre càlid)
Text sec:    #65635B (gris càlid)
Text muted:  #9C9A91 (gris suau)
White:       #FFFFFF
Success:     #2D7A4F (verd fosc natural)
Warning:     #B8860B (daurat fosc)
Danger:      #C13B3B (vermell càlid)
Info:        #4A7FB5 (blau temperat)
```

### Paleta Dark Mode (càlid, no fred)
```
Background:  #1C1B18 (quasi-negre càlid)
Surface:     #2A2923 (marró molt fosc)
Surface alt: #353430
Border:      #3D3C36
Text:        #F0EDE6
Text sec:    #A09D94
Accent:      #D4845F (terracota clar en dark)
```

---

## FASE 1: Fonaments (Theme + Components Base)

### 1.1 — `tailwind.config.js`

Afegir la paleta sencera com a sistema de colors personalitzat:

```js
theme: {
  extend: {
    fontFamily: {
      sans: ['Inter', 'system-ui', 'sans-serif'],
      serif: ['"Playfair Display"', 'Georgia', 'ui-serif', 'serif'],
      mono: ['"JetBrains Mono"', 'monospace'],
    },
    colors: {
      // Claude-inspired warm palette
      sand: {
        50:  '#FAF9F6',  // bg principal
        100: '#F4F3EE',  // surface (Pampas)
        200: '#EDEAE3',  // surface alt
        300: '#E8E5DD',  // border light
        400: '#D4D0C8',  // border
        500: '#B0AEA5',  // neutral (Cloudy)
        600: '#9C9A91',  // text muted
        700: '#65635B',  // text secondary
        800: '#3D3B35',  // dark surface border
        900: '#2A2923',  // dark surface
        950: '#1C1B18',  // dark bg
      },
      terra: {
        50:  '#FDF4EF',
        100: '#FADCC9',
        200: '#F0BFA0',
        300: '#D4845F',  // accent light
        400: '#C15F3C',  // accent principal (Crail)
        500: '#A84E30',  // accent hover
        600: '#8F4028',
        700: '#6B301E',
        800: '#4A2115',
        900: '#2D140D',
      },
      // Semàntics
      success: { DEFAULT: '#2D7A4F', light: '#E8F5EC', dark: '#1A5C38' },
      warning: { DEFAULT: '#B8860B', light: '#FFF8E1', dark: '#8B6508' },
      danger:  { DEFAULT: '#C13B3B', light: '#FDECEC', dark: '#9A2F2F' },
      info:    { DEFAULT: '#4A7FB5', light: '#EBF3FA', dark: '#3A6591' },
    },
    borderRadius: {
      'soft': '8px',      // cards, modals
      'button': '6px',    // buttons, inputs
      'badge': '4px',     // badges, pills
      'full': '9999px',   // avatars, dots
    },
    boxShadow: {
      'card': '0 1px 3px rgba(26,25,21,0.04), 0 1px 2px rgba(26,25,21,0.06)',
      'card-hover': '0 4px 12px rgba(26,25,21,0.08), 0 2px 4px rgba(26,25,21,0.04)',
      'modal': '0 20px 60px rgba(26,25,21,0.15), 0 4px 16px rgba(26,25,21,0.08)',
      'toast': '0 4px 16px rgba(26,25,21,0.12)',
      'sidebar': '1px 0 0 0 #E8E5DD',
    },
    fontSize: {
      'display': ['2rem', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '700' }],
      'heading': ['1.5rem', { lineHeight: '1.3', letterSpacing: '-0.01em', fontWeight: '600' }],
      'subheading': ['1.125rem', { lineHeight: '1.4', fontWeight: '600' }],
    },
  },
}
```

### 1.2 — `index.html`
Afegir font Playfair Display (ja està carregada al link de Google Fonts existent, només confirmar).

### 1.3 — `src/styles.css`
Substituir completament les variables i overrides:

**Canvis clau:**
- Eliminar el sistema `[data-theme="light"]` amb overrides class-a-class (frèvol)
- Implementar CSS custom properties com a sistema base
- Nou scrollbar styling (càlid)
- Nou select dropdown styling
- Actualitzar keyframes perquè siguin més subtils
- Afegir noves animacions: `fadeInUp`, `scaleIn` (per modals)

**Noves CSS custom properties:**
```css
:root {
  --bg: #FAF9F6;
  --surface: #F4F3EE;
  --surface-alt: #EDEAE3;
  --border: #E8E5DD;
  --border-strong: #D4D0C8;
  --text: #1A1915;
  --text-secondary: #65635B;
  --text-muted: #9C9A91;
  --accent: #C15F3C;
  --accent-hover: #A84E30;
  --accent-light: #FDF4EF;
}

[data-theme="dark"] {
  --bg: #1C1B18;
  --surface: #2A2923;
  --surface-alt: #353430;
  --border: #3D3C36;
  --border-strong: #4A4840;
  --text: #F0EDE6;
  --text-secondary: #A09D94;
  --text-muted: #6B6960;
  --accent: #D4845F;
  --accent-hover: #C15F3C;
  --accent-light: #352520;
}
```

### 1.4 — `src/components/UI.jsx` (Redisseny complet dels base components)

#### Button
- **Primary:** `bg-terra-400 hover:bg-terra-500 text-white rounded-button shadow-sm`
- **Secondary:** `bg-sand-200 hover:bg-sand-300 text-sand-700 rounded-button border border-sand-300`
- **Ghost:** `bg-transparent hover:bg-sand-100 text-sand-700 rounded-button`
- **Danger:** `bg-danger hover:bg-danger-dark text-white rounded-button`
- **Success:** `bg-success hover:bg-success-dark text-white rounded-button`
- Transicions: `transition-colors duration-150` (més subtil)
- Eliminar shadow-lg agressius dels botons

#### Input
- `bg-white border border-sand-300 rounded-button text-sand-950 placeholder-sand-500`
- Focus: `focus:border-terra-400 focus:ring-2 focus:ring-terra-400/10`
- Label: `text-sm font-medium text-sand-700 mb-1.5` (no uppercase, no tracking-wider)

#### Select
- Mateixa base que Input
- Dropdown arrow SVG actualitzat amb color `#9C9A91`

#### Card
- **Default:** `bg-white border border-sand-300 rounded-soft shadow-card`
- **Glass:** Eliminar — no és part de l'estètica Claude
- **Gradient:** Eliminar — massa tech
- **Hover:** `hover:shadow-card-hover hover:border-sand-400 transition-all duration-200`
- Border-radius reduït de `rounded-2xl` → `rounded-soft` (8px)

#### Modal
- Backdrop: `bg-black/40 backdrop-blur-[2px]` (menys agressiu)
- Container: `bg-white border border-sand-300 rounded-soft shadow-modal`
- Header: border-b substancial, títol amb `font-serif text-heading`
- Close button: `hover:bg-sand-100 rounded-button`

#### StatCard
- Eliminar gradient backgrounds
- Nou disseny: fons blanc, border suau, icona en cercle amb `bg-terra-50 text-terra-400`
- Valor numèric: `font-mono text-display text-sand-950`
- Etiqueta: `text-sm text-sand-600 font-medium`
- Trend: `text-success` o `text-danger` amb fons suau

#### StatusBadge
- Disseny pill suau amb borde:
  - `borrador`: `bg-sand-100 text-sand-600 border border-sand-300`
  - `emitida`: `bg-warning-light text-warning border border-warning/20`
  - `pagada`: `bg-success-light text-success border border-success/20`
  - `anulada`: `bg-danger-light text-danger border border-danger/20`
  - `parcial`: `bg-info-light text-info border border-info/20`
  - `presupuesto`: `bg-purple-50 text-purple-700 border border-purple-200`
  - `rectificativa`: `bg-orange-50 text-orange-700 border border-orange-200`
- `rounded-badge` (4px) en lloc de `rounded-full`
- `text-xs font-medium px-2 py-0.5`

#### Toast
- Disseny més subtil: fons blanc amb borde lateral de color
- `bg-white border border-sand-300 shadow-toast rounded-soft`
- Barra lateral de 3px a l'esquerra amb el color del tipus
- Icona i text en colors semàntics, no text blanc sobre fons de color

#### Spinner
- Color: `border-terra-400 border-t-transparent`

#### EmptyState
- Icona: `text-sand-400` (més suau)
- Títol: `font-serif text-lg text-sand-800`
- Descripció: `text-sand-600`

#### ErrorBoundary
- Adaptar als nous colors càlids

---

## FASE 2: Layout (App Shell + Sidebar)

### 2.1 — `src/App.jsx` — Sidebar

**Estètica objectiu:** Sidebar elegant com la de Claude — fons lleugerament diferent del body, separació subtil, tipografia neta.

**Canvis:**
- Background: `bg-sand-100` (crema vs blanc del main)
- Border: `border-r border-sand-300` (subtil, no slate-800)
- Collapsed: mantenir pattern actual, adaptar colors

**Logo area:**
- Eliminar gradient blue del logo
- Nou: Icona € dins cercle `bg-terra-400 text-white` (terracota)
- Títol: `font-serif text-lg font-semibold text-sand-900`

**Nav items:**
- Active: `bg-terra-400 text-white rounded-button` (terracota sòlid, NO blue-600)
- Inactive: `text-sand-600 hover:bg-sand-200 hover:text-sand-900 rounded-button`
- Eliminar shadow-lg del ítem actiu
- Kbd shortcuts: `bg-sand-200 text-sand-500 rounded border border-sand-300`

**Footer (info autònom):**
- `bg-sand-50 border border-sand-300 rounded-soft`
- Search bar: `text-sand-500 hover:bg-sand-200`
- Kbd: `bg-sand-200 border border-sand-300`

### 2.2 — Loading screen
- `bg-sand-50` fons
- Spinner terra
- Text `text-sand-600`

### 2.3 — IntegrityWarningBanner
- `bg-warning-light border-b border-warning/20`
- Text: `text-warning` / `text-warning-dark`

### 2.4 — Main content area
- `bg-sand-50 p-8` (el blanc crema com a fons principal)

---

## FASE 3: Vistes (View per View)

### 3.1 — `Dashboard.jsx`

**Stat Cards:**
- Fons blanc, border `sand-300`, shadow `card`
- Icona dins cercle de color suau (no gradient)
- Colors per tipus:
  - Ingressos: `bg-success-light text-success`
  - Despeses: `bg-danger-light text-danger`
  - Benefici: `bg-terra-50 text-terra-400`
  - Pendents: `bg-warning-light text-warning`

**Charts (Recharts):**
- Grid: `stroke="#E8E5DD"` (border sand)
- Axis text: `fill="#9C9A91"` (text muted)
- Colors gràfics:
  - Ingressos: `#C15F3C` (terra)
  - Despeses: `#9C9A91` (sand muted)
  - Benefici: `#2D7A4F` (success)
- Tooltip: `bg-white border border-sand-300 rounded-soft shadow-modal`
- Cursor: `stroke="#C15F3C" strokeDasharray="4 4"`

**ChartModeTab:**
- Active: `bg-terra-50 text-terra-400 border border-terra-200`
- Inactive: `text-sand-500 hover:bg-sand-100`

**Seccions:**
- Títols de secció: `font-serif text-heading text-sand-900`
- Subtítols: `text-sm text-sand-600`

### 3.2 — `Invoices.jsx`

**Taula:**
- Header: `bg-sand-100 border-b border-sand-300`
- Header text: `text-xs font-semibold text-sand-500 uppercase tracking-wide`
- Rows: `hover:bg-sand-50 border-b border-sand-200`
- Alternating: no — mantenir net amb hover
- Selected: `bg-terra-50 border-l-2 border-l-terra-400`

**Toolbar / Filters:**
- Search: `bg-white border border-sand-300 rounded-button`
- Filter selects: mateixa base
- Botons d'acció: Button component actualitzat

**Tabs (Factures/Pressupostos):**
- Active: `border-b-2 border-terra-400 text-terra-400 font-medium`
- Inactive: `text-sand-500 hover:text-sand-700`

### 3.3 — `InvoiceModal.jsx`
- Adaptar als nous Modal + Input + Select + Button
- Seccions amb `font-serif` per títols de secció
- Separadors: `border-b border-sand-200 my-6`

### 3.4 — `ExpensesView.jsx`
- Mateixa adaptació de taula que Invoices
- Watchfolder panel: `bg-sand-100 border border-sand-300 rounded-soft`
- PrecisionDashboard: adaptar progress bars a paleta terra
- RuleSuggestionsBanner: `bg-terra-50 border border-terra-200`

### 3.5 — `ClientsView.jsx` + `ClientModal.jsx`
- Cards de clients: `bg-white border border-sand-300 rounded-soft shadow-card`
- Avatar/inicials: `bg-terra-100 text-terra-500 rounded-full`
- Hover: `shadow-card-hover`

### 3.6 — `TaxesView.jsx`
- Cards de trimestre: `bg-white border border-sand-300`
- Gràfics: colors terra palette
- Toggle Trimestral/Anual: mateixa estètica que ChartModeTab

### 3.7 — `SettingsView.jsx`
- Seccions amb títol `font-serif`
- Inputs i labels amb nova estètica
- Toggle tema: mantenir però amb nous colors

### 3.8 — `DesignEditor.jsx`
- Adaptar UI chrome, NO el preview de factura (que és independent)

### 3.9 — `CommandPalette.jsx`
- Backdrop: `bg-black/40 backdrop-blur-[2px]`
- Container: `bg-white border border-sand-300 rounded-soft shadow-modal`
- Input search: gran, sense border inferior
- Results: `hover:bg-sand-100`
- Active item: `bg-terra-50 text-terra-500`
- Group labels: `text-xs font-semibold text-sand-400 uppercase`

---

## FASE 4: Micro-interaccions i Polish

### 4.1 — Transicions
- Reduir durades: `200ms` → `150ms` (més àgil)
- Eliminar `hover:-translate-y-0.5` de cards (massa tech)
- Mantenir `transition-colors` i `transition-shadow`

### 4.2 — Focus States
- Ring: `focus-visible:ring-2 focus-visible:ring-terra-400/20 focus-visible:ring-offset-1`
- Usar `focus-visible` en lloc de `focus` (millor UX)

### 4.3 — Loading states
- Skeleton loaders amb `bg-sand-200 animate-pulse` (opcional)

### 4.4 — Dark mode
- Canviar default de `dark` → `light` (sand theme per defecte)
- Dark mode: tons càlids (marrons foscos, no slates freds)
- El `[data-theme="dark"]` usarà les CSS custom properties definides a la Fase 1

### 4.5 — Responsive
- Mantenir breakpoints existents
- Assegurar sidebar funciona igual

### 4.6 — Scrollbar
- Track: `#F4F3EE`
- Thumb: `#D4D0C8`
- Thumb hover: `#B0AEA5`

---

## Ordre d'Implementació

| Pas | Fitxer(s) | Descripció |
|-----|-----------|------------|
| 1 | `tailwind.config.js` | Nova paleta + fonts + shadows + border-radius |
| 2 | `index.html` | Confirmar fonts Google |
| 3 | `src/styles.css` | CSS custom props + scrollbar + select + animations |
| 4 | `src/components/UI.jsx` | Tots els base components |
| 5 | `src/App.jsx` | Sidebar + layout + loading + theme default |
| 6 | `src/components/Dashboard.jsx` | Stat cards + charts |
| 7 | `src/components/Invoices.jsx` | Taula + toolbar + tabs |
| 8 | `src/components/InvoiceModal.jsx` | Modal + form |
| 9 | `src/components/ExpensesView.jsx` | Taula + panels |
| 10 | `src/components/ClientsView.jsx` + `ClientModal.jsx` | Cards + modal |
| 11 | `src/components/TaxesView.jsx` | Trimestres + gràfics |
| 12 | `src/components/SettingsView.jsx` | Formulari settings |
| 13 | `src/components/DesignEditor.jsx` | Editor chrome |
| 14 | `src/components/CommandPalette.jsx` | Palette |
| 15 | Polish final | Revisar consistència, dark mode, responsive |

---

## ⚠️ Restriccions

- **NO tocar** stores (store.js, designStore.js, notionStore.js)
- **NO tocar** serveis (pdfScanner, emailService, folderWatcher, etc.)
- **NO tocar** lògica de negoci (càlculs fiscals, generació factures)
- **NO tocar** InvoicePreviewModern (és per PDF, independent)
- **NO canviar** Tauri config ni Rust backend
- **Mantenir** totes les funcionalitats existents intactes
- **Mantenir** el patró sidebar collapsable
- **Mantenir** undo/redo, command palette, shortcuts
