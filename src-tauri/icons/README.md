# Iconos de la Aplicación

Para generar los iconos necesarios, usa el comando de Tauri:

```bash
npm run tauri icon public/icon.svg
```

O genera manualmente los siguientes archivos a partir del `icon.svg`:

- `32x32.png` - 32×32 píxeles
- `128x128.png` - 128×128 píxeles  
- `128x128@2x.png` - 256×256 píxeles
- `icon.ico` - Para Windows (incluye 16, 32, 48, 256)
- `icon.icns` - Para macOS

## Herramientas recomendadas

- [ImageMagick](https://imagemagick.org/) - Línea de comandos
- [RealFaviconGenerator](https://realfavicongenerator.net/) - Online
- [GIMP](https://www.gimp.org/) - Editor gráfico

## Comando ImageMagick

```bash
# PNG
convert icon.svg -resize 32x32 32x32.png
convert icon.svg -resize 128x128 128x128.png
convert icon.svg -resize 256x256 128x128@2x.png

# ICO (Windows)
convert icon.svg -define icon:auto-resize=256,128,64,48,32,16 icon.ico
```
