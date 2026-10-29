# Catálogo de alimentos

Genera la base de datos de alimentos para el generador de dietas a partir de la
tienda online de Mercadona (productos Hacendado y frescos sin marca), con los
valores nutricionales de Open Food Facts.

## Uso

```powershell
node scripts/catalog/import-mercadona.mjs
```

Solo necesita Node; no hay que instalar nada más.

### Qué entra

Por defecto, solo la lista corta de `basics.json`: unos 290 alimentos básicos
agrupados (cereales, legumbres, verduras, fruta, carne, pescado, lácteos…). Cada
uno lleva el `id` de un producto concreto de la tienda (el número de su URL) y
el nombre genérico (`basico`) con el que aparecerá en la app. Para añadir o
cambiar uno, busca el producto en tienda.mercadona.es y copia su id.

Para importar subcategorías enteras de la tienda en lugar de la lista:

```powershell
node scripts/catalog/import-mercadona.mjs --selection                # lo que diga selection.json
node scripts/catalog/import-mercadona.mjs --subcategories 118,121    # solo estas
node scripts/catalog/import-mercadona.mjs --list                     # todas las subcategorías con su id
```

`selection.json` tiene las subcategorías útiles para dietas (fuera refrescos,
dulces, bollería, platos preparados…) y palabras que descartan un producto
(`"sabor "`, `"relleno"`…). En ese modo se guarda un solo formato por producto
(el envase suelto antes que el pack de 6); `--all-formats` los guarda todos y
`--all-brands` incluye otras marcas además de Hacendado.

## Resultado

En `public/catalog/` (fuera de git), desde donde la app lo empaqueta y lo
muestra en la vista **Alimentos**. Sin este paso la vista sale vacía, con un
aviso de cómo generarlo:

- `foods.json`: un registro por producto con `basico`, `por100g` (kcal, proteínas,
  hidratos, azúcares, grasas, saturadas, fibra, sal), ingredientes, alérgenos,
  formato y precio.
- `images/<id>.jpg`: la foto original de la tienda, tal cual (600×600, foto de
  estudio sobre fondo blanco).

### De dónde sale la nutrición

1. **Open Food Facts**, por el código de barras: los datos de la etiqueta.
2. **BEDCA** (Base de Datos Española de Composición de Alimentos), cuando lo
   anterior no existe o no cuadra: casi todos los frescos (fruta, verdura, carne
   y pescado al corte), porque sus códigos de barras son internos de Mercadona.
   Cada básico indica su alimento genérico en `basics.json` (`"bedca": "<id>"`);
   `"aprox": true` marca los que usan un equivalente cercano (corvina → lubina,
   cebolleta → cebolla…). Para buscar otro id: https://www.bedca.net/bdpub/.

   BEDCA no siempre da la energía: entonces se calcula con los factores de
   Atwater (4·P + 4·HC + 9·G + 2·fibra). La sal sale del sodio (× 2,5); si
   BEDCA no tiene el sodio, la sal queda vacía. Solo se usan fichas públicas.

En `foods.json`, `nutricion.fuente` dice cuál se usó (`openfoodfacts` o
`bedca`) y `nutricion.control` si los números son coherentes:

| Valor        | Significado                                                        |
|--------------|--------------------------------------------------------------------|
| `ok`         | Las kcal cuadran con las macros                                    |
| `revisar`    | Las kcal no cuadran con 4·P + 4·HC + 9·G (dato probablemente mal)  |
| `incompleto` | Falta alguna macro                                                 |
| `sin_datos`  | Ni Open Food Facts ni un genérico de BEDCA                         |

Las respuestas de las APIs se guardan en `.cache/` y las fotos ya descargadas no
se vuelven a pedir, así que repetir la ejecución solo descarga lo nuevo. Borra
`.cache/` para refrescar precios o productos.

## Fuentes y licencias

- Productos y fotos: tienda.mercadona.es (API no oficial). Las fotos y la marca
  son de Mercadona: uso interno de la consulta.
- Nutrición: [Open Food Facts](https://world.openfoodfacts.org), licencia ODbL
  (hay que citar la fuente si se redistribuye la base de datos).
- Nutrición genérica: [BEDCA](https://www.bedca.net), Base de Datos Española de
  Composición de Alimentos (AESAN). Hay que citarla como fuente.
