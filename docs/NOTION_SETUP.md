# 🔄 Integración con Notion - Contabilidad Autónomo

Esta guía te ayudará a configurar la sincronización bidireccional entre tu aplicación de contabilidad y una base de datos de Notion.

## 📋 Requisitos Previos

1. Una cuenta de Notion
2. Una base de datos de Notion para las facturas

## 🚀 Configuración Paso a Paso

### 1. Crear una Integración en Notion

1. Ve a [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Haz clic en **"+ New integration"**
3. Configura la integración:
   - **Name**: "Contabilidad Autónomo" (o el nombre que prefieras)
   - **Associated workspace**: Selecciona tu workspace
   - **Content Capabilities**: Marca todas las opciones (Read, Update, Insert)
4. Haz clic en **"Submit"**
5. **Copia el "Internal Integration Token"** (empieza por `secret_...`)

### 2. Configurar la Base de Datos de Notion

Tu base de datos de Notion debe tener las siguientes propiedades:

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `Número` | Title | Número de factura (campo obligatorio) |
| `Concepto` | Text | Descripción del servicio |
| `Cliente` | Text | Nombre del cliente |
| `Fecha` | Date | Fecha de la factura |
| `Base Imponible` | Number | Importe base (€) |
| `IVA` | Number | Importe IVA (€) |
| `IRPF` | Number | Importe IRPF (€) |
| `Total` | Number | Total factura (€) |
| `Estado` | Select | Opciones: Borrador, Emitida, Pagada, Anulada |
| `ID Local` | Text | ID interno (para sincronización) |

> **💡 Tip**: Si tu base de datos ya existe con nombres diferentes, puedes modificar el archivo `src/services/notionService.js` para ajustar el mapeo de campos.

### 3. Conectar la Integración a tu Base de Datos

1. Abre tu base de datos de Notion
2. Haz clic en el botón **"..."** (tres puntos) en la esquina superior derecha
3. Selecciona **"Add connections"**
4. Busca y selecciona tu integración "Contabilidad Autónomo"
5. Haz clic en **"Confirm"**

### 4. Obtener el ID de la Base de Datos

El ID de tu base de datos está en la URL de Notion:

```
https://www.notion.so/556517bbc95945aca9f4c3a3f92d922c?v=...
                     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                     Este es el Database ID
```

Tu Database ID es: `556517bbc95945aca9f4c3a3f92d922c`

### 5. Configurar en la Aplicación

1. Abre la aplicación de Contabilidad
2. Ve a **Configuración** (icono de engranaje)
3. En la sección "Integración con Notion", haz clic en el icono de configuración
4. Introduce:
   - **API Key**: El token que copiaste (empieza por `secret_...`)
   - **Database ID**: `556517bbc95945aca9f4c3a3f92d922c`
5. Haz clic en **"Probar conexión"**
6. Si la conexión es exitosa, haz clic en **"Guardar"**

## 🔄 Cómo Funciona la Sincronización

### Sincronización Manual

- **"Enviar a Notion"**: Envía todas las facturas locales a Notion
- **"Traer de Notion"**: Descarga las facturas de Notion
- **"Sincronizar Todo"**: Sincronización bidireccional completa

### Sincronización Automática

Activa el toggle "Sincronización automática al guardar" para que:
- Cada vez que crees o edites una factura, se sincronice automáticamente
- Cuando cambies el estado de una factura a "Pagada", se actualice en Notion
- Las facturas eliminadas se archiven en Notion

## ⚠️ Notas Importantes

1. **Primera sincronización**: La primera vez, usa "Sincronizar Todo" para establecer el mapeo entre facturas locales y de Notion.

2. **Conflictos**: Si editas la misma factura en ambos lugares, la última modificación prevalece. Recomendamos usar la app como fuente principal.

3. **Clientes**: Por ahora, solo se sincroniza el nombre del cliente como texto. La relación con la tabla de clientes se mantiene solo en local.

4. **Límites de API**: Notion tiene un límite de ~3 peticiones por segundo. Para muchas facturas, la sincronización puede tardar unos segundos.

## 🔧 Personalización

### Cambiar los nombres de las propiedades

Si tu base de datos usa nombres diferentes, edita el archivo `src/services/notionService.js` y modifica la función `invoiceToNotionProperties()`:

```javascript
invoiceToNotionProperties(invoice, client) {
  return {
    // Cambia 'Número' por el nombre de tu columna de título
    'Mi Columna Número': {
      title: [{ text: { content: invoice.numero || '' } }]
    },
    // ... etc
  };
}
```

### Añadir más campos

Puedes añadir campos adicionales tanto en Notion como en el mapeo del servicio.

## 📝 Registro de Actividad

Haz clic en el icono del reloj junto al botón de configuración para ver el historial de sincronizaciones, incluyendo errores y operaciones exitosas.

## ❓ Solución de Problemas

| Error | Solución |
|-------|----------|
| "Notion no está configurado" | Verifica que has guardado el API Key y Database ID |
| "Error 401 Unauthorized" | El API Key es incorrecto o ha expirado |
| "Error 404 Not Found" | El Database ID es incorrecto o la integración no tiene acceso |
| "Error de conexión" | Verifica tu conexión a internet |

## 🔗 Enlaces Útiles

- [Documentación API de Notion](https://developers.notion.com/)
- [Panel de Integraciones](https://www.notion.so/my-integrations)
- [Tu Base de Datos](https://www.notion.so/556517bbc95945aca9f4c3a3f92d922c)
