# Auditoría NutriPolo v1.18.1 — instrucciones comunes (noviembre 2026)

Este bloque lo comparten las 8 sesiones de auditoría. Cada sesión cubre un área y escribe **un solo informe** en `auditoria/NN-area.md`.

## Contexto de producto
- Una sola usuaria: **Raquel**, dietista-nutricionista autónoma en España, no técnica, en Windows 11. NutriPolo es su herramienta de trabajo diaria: fichas de clientes, citas (sincronizadas con Google Calendar, también calendarios de clínicas), recordatorios por email y WhatsApp, facturación/contabilidad, mediciones, entrevistas, dietas semanales (planificaciones en PDF) y documentos.
- Datos de salud = categoría especial del RGPD. Volumen pequeño (cientos de clientes, miles de consultas): no optimices para escala web, optimiza para fiabilidad, cero pérdida de datos y cero tiempo perdido.
- Prioriza lo que pueda: (1) perder o corromper datos, (2) generar facturas o importes erróneos, (3) mandar algo equivocado a un paciente (recordatorio a otra persona, cita cancelada, PDF de otro cliente), (4) filtrar datos de salud, (5) hacerle perder tiempo o confundirla.

## Reglas (obligatorias)
1. Lee primero `CLAUDE.md` (convenciones y arquitectura) y `docs/AUDITORIA-2026-10.md` (auditoría anterior, v1.9.0). No repitas hallazgos que ya están arreglados; si uno de esa auditoría **sigue abierto**, márcalo como "Pendiente de la auditoría de oct-2026".
2. **Solo lectura.** No edites código, no hagas commits, no cambies de rama, no instales ni actualices dependencias, no borres nada. El único fichero que creas es tu informe en `auditoria/`. Otras sesiones trabajan en la misma carpeta a la vez.
3. **No abras los datos reales** de `%APPDATA%\com.nutripolo.app\` ni documentos de pacientes. No copies nombres ni datos personales al informe.
4. Puedes ejecutar `npm test` (vitest). Los comandos extra solo si tu brief los permite.
5. **Verifica cada hallazgo** leyendo el código real (y, si puedes, con un test rápido en el scratchpad, nunca en el repo). Nada especulativo: si no lo has comprobado del todo, ponle confianza "probable" y explica qué faltaría comprobar.
6. Cita siempre `ruta:línea`.

## Formato del informe
```
# NN — <Área>  (auditoría nov-2026, v1.18.1)
## Resumen
3–6 líneas + tabla: nº de hallazgos por severidad.
## Hallazgos
### [CRÍTICA|ALTA|MEDIA|BAJA] Título corto
- **Ubicación:** `src/...:123`
- **Qué pasa:** descripción técnica.
- **Escenario concreto:** pasos/entrada → resultado incorrecto.
- **Impacto para Raquel:** en lenguaje llano.
- **Propuesta:** cómo arreglarlo (concreta, sin escribir el parche entero).
- **Esfuerzo:** S (<1 h) / M (medio día) / L (>1 día)
- **Confianza:** confirmado / probable
## Pendientes de la auditoría de oct-2026
## Lo que está bien (breve, para no tocarlo)
## Fuera de mi área (notas para otras sesiones)
```
Severidad: **CRÍTICA** = pérdida/corrupción de datos, datos fiscales erróneos, fuga de datos de salud, envío a la persona equivocada. **ALTA** = fallo funcional frecuente o error que confunde. **MEDIA** = fallo poco frecuente o deuda que va a dar problemas. **BAJA** = mejora o limpieza.

Ordena los hallazgos de más a menos grave. Al terminar, el mensaje final debe dar: la ruta del informe, el top 5 y cuántos hallazgos hay por severidad.
