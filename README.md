# 📊 Contabilidad Autónomo

Aplicación de escritorio para Windows 11 que gestiona la contabilidad de autónomos.

## ✨ Características

- **Dashboard** - Resumen visual de ingresos, gastos y beneficio
- **Facturas** - Gestión completa con dos tipos (importe fijo / por jornadas)
- **Clientes** - Base de datos de clientes con historial
- **Gastos** - Registro de gastos deducibles por categorías
- **Impuestos** - Cálculo automático de Modelo 303 (IVA) y Modelo 130 (IRPF)
- **PDF** - Generación de facturas en PDF con tu diseño personalizado
- **Bilingüe** - Soporte para castellano y català

## 🚀 Instalación Rápida

### Requisitos previos

1. **Node.js** (v18 o superior)
   - Descarga: https://nodejs.org/

2. **Rust** (última versión estable)
   - Descarga: https://rustup.rs/
   - En PowerShell: `winget install Rustlang.Rustup`

3. **Visual Studio Build Tools** (para Windows)
   - Descarga: https://visualstudio.microsoft.com/visual-cpp-build-tools/
   - Selecciona "Desktop development with C++"

### Pasos de instalación

```powershell
# 1. Clonar/descomprimir el proyecto
cd contabilidad-autonomo

# 2. Instalar dependencias de Node.js
npm install

# 3. Ejecutar en modo desarrollo
npm run tauri:dev

# 4. Compilar para producción
npm run tauri:build
```

El ejecutable estará en: `src-tauri/target/release/contabilidad-autonomo.exe`

## 📁 Estructura del Proyecto

```
contabilidad-autonomo/
├── src/                    # Frontend React
│   ├── components/         # Componentes UI
│   ├── stores/             # Estado global (Zustand)
│   ├── App.jsx             # Aplicación principal
│   ├── main.jsx            # Punto de entrada
│   └── styles.css          # Estilos Tailwind
│
├── src-tauri/              # Backend Rust
│   ├── src/
│   │   └── main.rs         # Lógica de backend + PDF
│   ├── Cargo.toml          # Dependencias Rust
│   └── tauri.conf.json     # Configuración Tauri
│
├── package.json            # Dependencias Node.js
├── vite.config.js          # Configuración Vite
└── tailwind.config.js      # Configuración Tailwind
```

## 🔧 Configuración

La aplicación viene preconfigurada con tus datos:

- **Nombre:** Javier Polo García
- **NIF:** 46088365E
- **Dirección:** Carrer Gandia 17, baix dreta, 46007 (VALÈNCIA)
- **IBAN:** ES75 0182 3033 1102 0152 4582

Puedes cambiar estos datos en **Configuración** dentro de la app.

## 📄 Formato de Facturas

Las facturas se generan con el formato exacto de tu template Excel:

- **Classic** - Importe fijo con concepto único
- **Days** - Por jornadas (días × tarifa)

Ambos tipos incluyen:
- IVA 21% (configurable)
- IRPF 15% (configurable)
- Numeración automática: `0YY_XXX_NNN`

## 💾 Almacenamiento de Datos

Los datos se guardan localmente en:
```
Windows: C:\Users\<tu_usuario>\AppData\Roaming\com.javipolo.contabilidad\
```

Archivos:
- `contabilidad-storage.json` - Todos los datos (config, clientes, facturas, gastos)

## 🛠️ Desarrollo

```powershell
# Modo desarrollo con hot-reload
npm run tauri:dev

# Solo frontend (sin Tauri)
npm run dev

# Compilar frontend
npm run build

# Compilar aplicación completa
npm run tauri:build
```

## 📊 Modelos Trimestrales

La app calcula automáticamente:

### Modelo 303 (IVA)
- IVA Repercutido = Suma de IVA de facturas
- IVA Soportado = Suma de IVA de gastos deducibles
- Resultado = Repercutido - Soportado

### Modelo 130 (IRPF)
- Rendimiento = Ingresos - Gastos
- Pago fraccionado = 20% del rendimiento - Retenciones

### Fechas de presentación
- T1: 20 de abril
- T2: 20 de julio
- T3: 20 de octubre
- T4: 30 de enero (año siguiente)

## 📝 Licencia

MIT License - Uso personal y comercial permitido.

---

Desarrollado con ❤️ usando Tauri + React + Rust
