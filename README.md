# NutriPolo

Aplicacion de escritorio para Windows 11 para la gestion de consultas de nutricionistas. Desarrollada con **Tauri 1.5** (Rust + React).

**Usuaria:** Raquel Polo Garcia
**Desarrollador:** Javier Polo Garcia
**Version:** 1.0.0

## Caracteristicas

- **Dashboard** — Resumen visual con estadisticas de clientes, consultas e ingresos
- **Clientes** — Gestion completa con ficha detallada, medidas corporales, documentos y graficos de evolucion
- **Consultas** — Registro de visitas con sincronizacion bidireccional con Google Calendar
- **Planes nutricionales** — Editor completo con generacion de PDF
- **Facturacion** — Creacion de facturas con presets de diseno y generacion de PDF
- **Documentos** — Gestion de archivos por cliente (subida, apertura, metadatos)
- **Calendario** — Vista semanal y mensual integrada
- **Servicios** — Gestion de tarifas y tipos de servicio
- **Email** — Envio de correos con adjuntos via SMTP
- **Paleta de comandos** — Acceso rapido con Ctrl+K
- **Bilingue** — Soporte para castellano y catala
- **Dark mode** — Tema oscuro completo

## Stack tecnologico

| Capa | Tecnologia |
|------|------------|
| UI | React 18.2, Tailwind CSS 3.3, Lucide React |
| Estado | Zustand 4.4 con persistencia al filesystem |
| Graficos | Recharts 2.10 |
| PDF | pdf-lib + fontkit |
| Desktop | Tauri 1.5 (Rust) |
| Email | lettre 0.11 (SMTP) |
| HTTP | reqwest 0.12 (Google Calendar OAuth) |
| Build | Vite 5, PostCSS, Autoprefixer |

## Requisitos previos

1. **Node.js** (v18 o superior) — https://nodejs.org/
2. **Rust** (ultima version estable) — https://rustup.rs/
3. **Visual Studio Build Tools** — Seleccionar "Desktop development with C++"

## Instalacion y uso

```bash
# Instalar dependencias
npm install

# Desarrollo con hot-reload
npm run tauri:dev

# Solo frontend (sin Tauri)
npm run dev

# Compilar frontend
npm run build

# Compilar aplicacion completa (.msi)
npm run tauri:build
```

El instalador se genera en `src-tauri/target/release/bundle/msi/`.

## Estructura del proyecto

```
nutripolo-app/
├── src/                              # Frontend React
│   ├── components/                   # Componentes UI
│   │   ├── CalendarView.jsx          # Vista calendario (semana/mes)
│   │   ├── ClientDetailView.jsx      # Ficha completa del cliente (tabs)
│   │   ├── ClientDocuments.jsx       # Gestion de documentos por cliente
│   │   ├── ClientModal.jsx           # Modal creacion/edicion clientes
│   │   ├── ClientsView.jsx           # Listado de clientes
│   │   ├── CommandPalette.jsx        # Paleta de comandos (Ctrl+K)
│   │   ├── ConsultationModal.jsx     # Modal consultas + Google Calendar
│   │   ├── ConsultationsView.jsx     # Listado de consultas
│   │   ├── Dashboard.jsx             # Vista principal con estadisticas
│   │   ├── DocumentMetadataModal.jsx # Modal metadatos de documentos
│   │   ├── InvoiceModal.jsx          # Modal creacion/edicion facturas
│   │   ├── Invoices.jsx              # Listado de facturas
│   │   ├── MeasurementChart.jsx      # Grafico de evolucion de medidas
│   │   ├── NutritionPlanEditor.jsx   # Editor de planes nutricionales + PDF
│   │   ├── SendEmailModal.jsx        # Modal envio de emails con adjuntos
│   │   ├── ServicesView.jsx          # Gestion de servicios/tarifas
│   │   ├── SettingsView.jsx          # Configuracion de la app
│   │   └── UI.jsx                    # Componentes base reutilizables
│   │
│   ├── services/                     # Servicios de negocio
│   │   ├── documentService.js        # Upload/open/delete documentos via Tauri
│   │   ├── emailService.js           # Envio de emails via SMTP
│   │   ├── googleCalendarService.js  # Sync bidireccional con Google Calendar
│   │   ├── invoiceDesignPresets.js   # Presets de diseno para facturas
│   │   ├── pdfInvoiceGenerator.js    # Generacion PDF facturas (pdf-lib)
│   │   ├── pdfPlanGenerator.js       # Generacion PDF planes nutricionales
│   │   └── whatsappService.js        # Integracion WhatsApp
│   │
│   ├── stores/
│   │   └── store.js                  # Store Zustand (todas las entidades)
│   │
│   ├── App.jsx                       # Componente raiz + navegacion
│   ├── i18n.js                       # Traducciones ES/CA
│   ├── main.jsx                      # Punto de entrada React
│   └── styles.css                    # Estilos globales Tailwind
│
├── src-tauri/                        # Backend Rust
│   ├── src/
│   │   ├── main.rs                   # Comandos IPC: datos, email, documentos
│   │   └── google_calendar.rs        # OAuth2 + API Google Calendar
│   ├── icons/                        # Iconos de la aplicacion
│   ├── Cargo.toml                    # Dependencias Rust
│   └── tauri.conf.json               # Configuracion Tauri + CSP + bundle
│
├── public/                           # Assets estaticos
├── package.json                      # Dependencias Node.js
├── vite.config.js                    # Configuracion Vite
├── tailwind.config.js                # Configuracion Tailwind
└── postcss.config.js                 # Configuracion PostCSS
```

## Almacenamiento de datos

Los datos se guardan localmente en:

```
C:\Users\<usuario>\AppData\Roaming\com.nutripolo.app\
```

Cada entidad se guarda como archivo JSON separado (`clients.json`, `consultations.json`, etc.).
Los documentos de cada cliente se almacenan en `documents/<clientId>/`.

## Licencia

MIT License

---

Desarrollado por Javier Polo Garcia — Tauri 1.5 + React 18 + Rust
