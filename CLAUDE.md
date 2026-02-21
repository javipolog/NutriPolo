# CLAUDE.md - Contabilidad Autónomo v6

## 📋 Descripció del Projecte

Aplicació d'escriptori per a Windows 11 que gestiona la comptabilitat d'autònoms espanyols. Desenvolupada amb **Tauri 1.5** (Rust + React), permet la gestió completa de factures, clients, despeses i càlcul automàtic de models fiscals trimestrals (303 IVA i 130 IRPF).

**Autor:** Javier Polo García  
**Llicència:** MIT  
**Versió:** 1.0.0

---

## 🛠️ Stack Tecnològic

### Frontend (React 18)
- **React 18.2** - Biblioteca d'UI
- **Zustand 4.4** - Gestió d'estat global
- **React Router DOM 6** - Navegació SPA
- **Tailwind CSS 3.3** - Estils utility-first
- **Lucide React** - Icones
- **Recharts 2.10** - Gràfics i visualitzacions
- **date-fns 2.30** - Manipulació de dates
- **pdfjs-dist 5.4** - Processament de PDFs

### Backend (Rust)
- **Tauri 1.5** - Framework d'apps d'escriptori
- **Serde / Serde JSON** - Serialització
- **printpdf 0.6** - Generació de PDFs
- **chrono 0.4** - Dates i temps
- **notify 6.1** - File system watcher

### Build Tools
- **Vite 5** - Bundler i dev server
- **PostCSS + Autoprefixer** - Processament CSS

---

## 📁 Estructura del Projecte

```
contabilidad-autonomo/
├── src/                          # Frontend React
│   ├── components/               # Components UI
│   │   ├── Dashboard.jsx         # Vista principal amb estadístiques
│   │   ├── DesignEditor.jsx      # Editor visual de plantilles PDF
│   │   ├── ExpensesView.jsx      # Gestió de despeses
│   │   ├── InvoiceModal.jsx      # Modal creació/edició factures
│   │   ├── InvoicePreview.jsx    # Previsualització de factures
│   │   ├── Invoices.jsx          # Llistat de factures
│   │   ├── NotionSync.jsx        # Sincronització amb Notion
│   │   ├── RulesManager.jsx      # Regles d'auto-categorització
│   │   ├── SendInvoiceModal.jsx  # Enviament de factures per email
│   │   └── UI.jsx                # Components base reutilitzables
│   │
│   ├── services/                 # Serveis de negoci
│   │   ├── emailService.js       # Enviament d'emails
│   │   ├── folderWatcher.js      # Monitorització de carpetes
│   │   ├── notionService.js      # API de Notion
│   │   ├── pdfScanner.js         # Escaneig i extracció de PDFs
│   │   └── providerMemory.js     # Memòria de proveïdors
│   │
│   ├── stores/                   # Estat global (Zustand)
│   │   ├── designStore.js        # Estat del disseny de factures
│   │   ├── notionStore.js        # Estat de sincronització Notion
│   │   └── store.js              # Estat principal de l'app
│   │
│   ├── App.jsx                   # Component arrel
│   ├── main.jsx                  # Punt d'entrada React
│   └── styles.css                # Estils globals Tailwind
│
├── src-tauri/                    # Backend Rust
│   ├── src/
│   │   └── main.rs               # Lògica backend + generació PDF
│   ├── icons/                    # Icones de l'aplicació
│   ├── Cargo.toml                # Dependències Rust
│   ├── build.rs                  # Script de compilació
│   └── tauri.conf.json           # Configuració Tauri
│
├── public/                       # Assets estàtics
│   ├── icon.svg                  # Icona SVG
│   └── pdf.worker.min.mjs        # Worker per pdfjs
│
├── docs/                         # Documentació
│   └── NOTION_SETUP.md           # Guia configuració Notion
│
├── scripts/                      # Scripts d'utilitat
│   └── install.ps1               # Script d'instal·lació PowerShell
│
├── package.json                  # Dependències Node.js
├── vite.config.js                # Configuració Vite
├── tailwind.config.js            # Configuració Tailwind
├── postcss.config.js             # Configuració PostCSS
└── README.md                     # Documentació principal
```

---

## 🚀 Comandes Principals

```bash
# Instal·lar dependències
npm install

# Desenvolupament amb hot-reload
npm run tauri:dev

# Només frontend (sense Tauri)
npm run dev

# Compilar frontend
npm run build

# Compilar aplicació completa (.exe)
npm run tauri:build

# Preview del build frontend
npm run preview
```

---

## 🗄️ Estructures de Dades Principals

### Store Principal (`stores/store.js`)

```javascript
{
  // Configuració de l'autònom
  config: {
    nombre: string,
    nif: string,
    direccion: string,
    email: string,
    telefono: string,
    web: string,
    iban: string,
    tipoIva: number,      // 21 per defecte
    tipoIrpf: number,     // 15 per defecte
    idiomaDefecto: string // 'es' | 'ca'
  },
  
  // Array de clients
  clients: [{
    id: string,
    codigo: string,       // Codi curt (ex: "ABC")
    nombre: string,
    cifNif: string,
    direccion: string,
    email?: string,
    telefono?: string
  }],
  
  // Array de factures
  invoices: [{
    id: string,
    numero: string,       // Format: 0YY_XXX_NNN
    clienteId: string,
    fecha: string,        // ISO date
    tipo: 'classic' | 'days',
    idioma: 'es' | 'ca',
    concepto: string,
    baseImponible?: number,
    jornadas?: number,
    tarifaDia?: number,
    subtotal: number,
    ivaPorcentaje: number,
    iva: number,
    irpfPorcentaje: number,
    irpf: number,
    total: number,
    estado: 'pendiente' | 'cobrada' | 'anulada'
  }],
  
  // Array de despeses
  expenses: [{
    id: string,
    fecha: string,
    proveedor: string,
    concepto: string,
    categoria: string,
    baseImponible: number,
    ivaPorcentaje: number,
    iva: number,
    total: number,
    deducible: boolean,
    facturaPDF?: string
  }]
}
```

### Design Store (`stores/designStore.js`)

```javascript
{
  design: {
    colors: {
      primary: string,     // Color principal
      secondary: string,   // Color secundari
      accent: string,      // Color d'accent
      text: string,        // Color de text
      background: string   // Color de fons
    },
    fonts: {
      heading: string,     // Font per títols
      body: string         // Font per text
    },
    logo: string | null,   // Base64 o null
    layout: string         // Tipus de layout
  }
}
```

---

## 📊 Models Fiscals

### Model 303 (IVA Trimestral)
```
IVA Repercutit = Σ IVA de factures emeses
IVA Suportat = Σ IVA de despeses deduïbles
Resultat = Repercutit - Suportat
```

### Model 130 (IRPF Trimestral)
```
Rendiment = Ingressos - Despeses
Pagament fraccionat = 20% × Rendiment - Retencions
```

### Trimestres
- **T1:** Gener - Març → Presentar abans 20 abril
- **T2:** Abril - Juny → Presentar abans 20 juliol
- **T3:** Juliol - Setembre → Presentar abans 20 octubre
- **T4:** Octubre - Desembre → Presentar abans 30 gener

---

## 🔧 Funcions Tauri (IPC)

### Comandes disponibles (Rust → JS)

```rust
// Desar dades al sistema de fitxers
#[tauri::command]
fn save_data(data: String) -> Result<(), String>

// Carregar dades del sistema de fitxers
#[tauri::command]
fn load_data() -> Result<String, String>

// Generar PDF de factura
#[tauri::command]
fn generate_pdf(invoice: Invoice, client: Client, config: AppConfig, design: Design, path: String) -> Result<(), String>

// Iniciar watcher de carpeta
#[tauri::command]
fn start_folder_watch(folder: String) -> Result<(), String>

// Aturar watcher
#[tauri::command]
fn stop_folder_watch() -> Result<(), String>
```

### Invocar des de React

```javascript
import { invoke } from '@tauri-apps/api/tauri';

// Exemple: Generar PDF
await invoke('generate_pdf', { 
  invoice, 
  client, 
  config,
  design,
  path: '/ruta/al/fitxer.pdf'
});
```

---

## 🎨 Patrons i Convencions

### Components React
- Components funcionals amb hooks
- Props destructurades
- `useMemo` i `useCallback` per optimitzacions
- Custom hooks per lògica reutilitzable

### Gestió d'Estat
- **Zustand** per estat global amb persistència
- Accions definides dins del store
- Selectors per evitar re-renders innecessaris

### Estils
- **Tailwind CSS** per estils inline
- Classes utilitàries sense CSS custom
- Responsive amb prefixos `sm:`, `md:`, `lg:`

### Nomenclatura
- **Components:** PascalCase (`InvoiceModal.jsx`)
- **Funcions:** camelCase (`generateInvoiceNumber`)
- **Constants:** SCREAMING_SNAKE_CASE (`DEFAULT_IVA`)
- **Fitxers:** camelCase per serveis, PascalCase per components

---

## 💾 Persistència de Dades

Les dades es guarden localment a:

```
Windows: C:\Users\<usuari>\AppData\Roaming\com.javipolo.contabilidad\
```

Fitxer principal: `contabilidad-storage.json`

La sincronització amb Notion és opcional i requereix configuració de token API.

---

## 🐛 Debugging

### Frontend
```bash
# Dev tools de Chrome/Edge
npm run tauri:dev
# Obrir DevTools: Ctrl+Shift+I
```

### Backend Rust
```bash
# Logs a la consola
RUST_LOG=debug npm run tauri:dev
```

### Errors comuns
- **Tauri no compila:** Verificar Visual Studio Build Tools
- **PDF no es genera:** Comprovar permisos d'escriptura
- **Fonts no carreguen:** Verificar connexió a Google Fonts

---

## 🧪 Testing

Actualment no hi ha suite de tests automatitzats. Es recomana:

1. Crear tests unitaris amb **Vitest** per al frontend
2. Crear tests d'integració amb **cargo test** per al backend
3. Tests E2E amb **Playwright** o **Cypress**

---

## 📝 TODO / Millores Futures

- [ ] Afegir tests automatitzats
- [ ] Implementar backup automàtic
- [ ] Afegir suport per múltiples comptes
- [ ] Integració amb certificat digital per signatura
- [ ] Mode fosc
- [ ] Export a Excel/CSV

---

## 🔐 Seguretat

- Dades guardades localment (no cloud per defecte)
- Token de Notion emmagatzemat al localStorage
- CSP configurat a `tauri.conf.json`
- Només dominis autoritzats per HTTP (`api.notion.com`)

---

## 📞 Contacte

**Desenvolupador:** Javier Polo García  
**Projecte:** Contabilidad Autónomo v6  
**Tecnologies:** Tauri + React + Rust
