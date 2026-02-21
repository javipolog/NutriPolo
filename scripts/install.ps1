# Contabilidad Autónomo - Script de Instalación para Windows
# Ejecutar en PowerShell como Administrador

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Instalador de Contabilidad Autónomo" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Verificar Node.js
Write-Host "Verificando Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version
    Write-Host "✓ Node.js instalado: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ Node.js no encontrado. Instalando..." -ForegroundColor Red
    winget install OpenJS.NodeJS.LTS
    Write-Host "Por favor, reinicia PowerShell y ejecuta este script de nuevo." -ForegroundColor Yellow
    exit
}

# Verificar Rust
Write-Host "Verificando Rust..." -ForegroundColor Yellow
try {
    $rustVersion = rustc --version
    Write-Host "✓ Rust instalado: $rustVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ Rust no encontrado. Instalando..." -ForegroundColor Red
    Write-Host "Descargando rustup-init.exe..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile "$env:TEMP\rustup-init.exe"
    Start-Process -FilePath "$env:TEMP\rustup-init.exe" -ArgumentList "-y" -Wait
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    Write-Host "✓ Rust instalado correctamente" -ForegroundColor Green
}

# Verificar Visual Studio Build Tools
Write-Host "Verificando Visual Studio Build Tools..." -ForegroundColor Yellow
$vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vsWhere) {
    Write-Host "✓ Visual Studio Build Tools disponible" -ForegroundColor Green
} else {
    Write-Host "✗ Visual Studio Build Tools no encontrado." -ForegroundColor Red
    Write-Host "Por favor, instala 'Desktop development with C++' desde:" -ForegroundColor Yellow
    Write-Host "https://visualstudio.microsoft.com/visual-cpp-build-tools/" -ForegroundColor Cyan
    Write-Host ""
    Read-Host "Presiona Enter cuando hayas instalado Build Tools"
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Instalando dependencias del proyecto" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Instalar dependencias npm
Write-Host "Instalando dependencias de Node.js..." -ForegroundColor Yellow
npm install

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Dependencias de Node.js instaladas" -ForegroundColor Green
} else {
    Write-Host "✗ Error instalando dependencias de Node.js" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  ¡Instalación completada!" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Comandos disponibles:" -ForegroundColor White
Write-Host "  npm run tauri:dev   - Ejecutar en modo desarrollo" -ForegroundColor Gray
Write-Host "  npm run tauri:build - Compilar para producción" -ForegroundColor Gray
Write-Host ""
Write-Host "¿Deseas ejecutar la aplicación en modo desarrollo? (S/N)" -ForegroundColor Yellow
$response = Read-Host

if ($response -eq "S" -or $response -eq "s") {
    Write-Host "Iniciando aplicación..." -ForegroundColor Cyan
    npm run tauri:dev
}
