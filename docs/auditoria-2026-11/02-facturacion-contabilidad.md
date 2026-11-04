# 02 — Facturación y contabilidad  (auditoría nov-2026, v1.18.1)

## Resumen

Los importes se calculan bien: el cálculo va en céntimos enteros (`computeInvoiceTotals`), con redondeo por línea y el IVA y el IRPF sobre la base total. La numeración por serie y año existe y no deja huecos al borrar. El fallo grave está en el **documento**. El NIF de la clienta no sale nunca en el PDF. Con 12–13 líneas, el TOTAL queda tapado por el pie. Los nombres y direcciones largos se salen de la página. Además, las facturas emitidas se pueden editar, borrar y "anular" sin rectificativa, y el PDF se vuelve a generar con los datos actuales. A eso se suma un deshacer que duplica números. Al gestor no se le puede dar nada: no hay exportación, ni libro de ingresos, ni gastos, ni trimestres. Tampoco hay nada de VeriFactu. Se puede enviar por email el plan como si fuera una factura, pero no la factura real.

`npm test`: 110 ficheros y 1899 tests en verde, aunque incluye los tests de `.claude/worktrees/*` (ver "Fuera de mi área"). No hay tests de `pdfInvoiceGenerator` ni de `InvoiceModal`. Todos los hallazgos marcados como "confirmado" se han reproducido con pruebas en el scratchpad: store real, PDF real generado con Onest y renderizado a PNG.

| Severidad | Nº |
|---|---|
| CRÍTICA | 1 |
| ALTA | 6 |
| MEDIA | 10 |
| BAJA | 5 |
| **Total** | **22** |

> Lo marcado con ⚖️ es interpretación legal o fiscal y **debe confirmarlo su gestor**. Ver la sección "Notas legales" al final.

---

## Hallazgos

### [CRÍTICA] El NIF de la clienta no aparece nunca en la factura
- **Ubicación:** `src/services/pdfInvoiceGenerator.js:382-384` (lee `client.cifNif`), frente a `src/components/ClientModal.jsx:44,139` y `src/components/ClientDetailView.jsx:209` (el campo se guarda como `client.nif`)
- **Qué pasa:** el generador dibuja `client.cifNif`, pero ese campo no existe en ninguna parte de la app (`grep cifNif` solo da esa línea). El NIF que Raquel escribe en la ficha está en `client.nif` y nunca llega al PDF.
- **Escenario concreto:** clienta con NIF `B12345678` → se genera la factura → en el PDF no aparece el NIF. Lo he comprobado capturando todos los `drawText`: `NIF cliente en PDF: false`.
- **Impacto para Raquel:** todas las facturas que ha emitido a clínicas o empresas (las que llevan IRPF) carecen de un dato obligatorio. La empresa no puede justificar el gasto ni la retención, y Hacienda puede tenerlas por facturas incorrectas ⚖️. Para particulares, ver la nota sobre factura simplificada.
- **Propuesta:** leer `client.nif` (con `client.cifNif` como alternativa por compatibilidad) y anteponer la etiqueta "NIF:". Añadir un test del generador que compruebe que el NIF aparece. Después, revisar las facturas ya emitidas a empresas y volver a enviar las que lo necesiten.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [ALTA] Con 12–13 líneas, el TOTAL (y a veces la base) queda tapado por el pie
- **Ubicación:** `src/services/pdfInvoiceGenerator.js:453-454` (`FOOTER_RESERVE`), `:530` (solo comprueba el salto de página para las filas), `:605-640` (detalles), `:642-702` (totales), `:808-812` (el pie se dibuja al final, con un rectángulo opaco)
- **Qué pasa:** el salto de página solo se calcula para las filas de conceptos. El bloque de detalles (forma de pago, notas) y el de totales (~110 pt) se dibujan donde termine la tabla, sin comprobar el espacio libre. Después se pinta el pie con fondo opaco encima.
- **Escenario concreto:** la factura mensual a una clínica con 12 sesiones (forma de pago: transferencia) deja el TOTAL en y=48 pt, con el pie hasta 54 pt. Con 13 sesiones, la base queda en y=82 y el TOTAL en y=17. Lo he visto en el PNG renderizado: la línea "TOTAL 408,00 €" está cortada y tapada. Unas notas largas adelantan el problema a menos líneas.
- **Impacto para Raquel:** factura sin importe total visible, justo en las facturas mensuales a clínicas, que son las de más importe.
- **Propuesta:** antes de dibujar los detalles y los totales, calcular su altura (incluidas las líneas de notas) y, si no caben por encima de `FOOTER_RESERVE`, abrir una página de continuación. Añadir un test que recorra de 1 a 40 líneas y compruebe que `TOTAL.y > FOOTER_H`.
- **Esfuerzo:** S–M
- **Confianza:** confirmado

### [ALTA] Deshacer el borrado de una factura crea números duplicados, y borrar reutiliza números ya emitidos
- **Ubicación:** `src/stores/store.js:1807-1816` (`deleteInvoice`), `:1867` (undo `delete_invoice`), `:1884` (redo), `:273-278` (`canDeleteInvoice`); `src/components/Invoices.jsx:49-57`
- **Qué pasa:**
  1. Solo se puede borrar la última factura de la serie, y su número queda libre. Pero `addInvoice` no toca `_history`, así que el deshacer del borrado sigue disponible después de crear otra factura con ese número. `undo()` reinserta la factura sin comprobar el número.
  2. Borrando siempre la última se pueden eliminar todas las facturas del año, una a una.
- **Escenario concreto (reproducido):** se crean NP-2026-001 y NP-2026-002 → se borra la 002 → se crea otra factura, que vuelve a ser NP-2026-002 → Ctrl+Z → el listado queda `['NP-2026-002','NP-2026-001','NP-2026-002']`: dos facturas distintas con el mismo número.
- **Impacto para Raquel:** dos facturas con el mismo número en su contabilidad. Y si la borrada ya se había enviado a una paciente, otra paciente recibe una factura con ese mismo número. Las dos cosas son irregulares ⚖️ y, con VeriFactu, imposibles.
- **Propuesta:** a corto plazo, que `undo`/`redo` de `delete_invoice` comprueben si el número está ocupado y, en ese caso, no restauren o restauren como borrador sin número. A medio plazo, solo se puede borrar una factura que sea **borrador** (nunca descargada ni enviada); una emitida se corrige con una rectificativa (ver el hallazgo siguiente).
- **Esfuerzo:** S (undo) / M (estado borrador)
- **Confianza:** confirmado

### [ALTA] Las facturas emitidas se pueden modificar sin límite y el PDF se regenera con los datos actuales
- **Ubicación:** `src/components/InvoiceModal.jsx:34-63,183-186`, `src/stores/store.js:1777-1803` (`updateInvoice` acepta cualquier campo), `src/components/Invoices.jsx:59-79` (descarga = regenerar), `src/services/pdfInvoiceGenerator.js:374-403` (lee `config` y `client` en vivo), `src/stores/store.js:898-920` (al borrar una clienta se conservan las facturas, pero sin sus datos)
- **Qué pasa:** la factura solo guarda `clienteId`. El nombre, NIF y dirección de la clienta, y los datos de Raquel (nombre, NIF, dirección, número de colegiada), se leen al generar el PDF. Cualquier factura (pagada, enviada o de hace un año) se puede editar entera: importes, fecha, clienta, número. No queda registro del cambio. El PDF no se archiva en ningún sitio: solo se guarda donde elija Raquel en el diálogo, y no en los documentos de la clienta.
- **Escenario concreto:**
  - (a) Una paciente se muda y Raquel actualiza su dirección. Al volver a descargar una factura de 2025, sale la dirección nueva, distinta de la que recibió la paciente.
  - (b) Raquel borra la ficha de una paciente. Sus facturas siguen en el listado, con "—" en la clienta, y el PDF sale con "CLIENTE ---".
  - (c) Raquel cambia de domicilio fiscal. Todas sus facturas antiguas cambian al reimprimirlas.
- **Impacto para Raquel:** la copia que conserva no coincide con la factura emitida, y la obligación de conservación es de 4 años ⚖️. Si una paciente o Hacienda pide un duplicado, no puede reproducir el original.
- **Propuesta:** al emitir, guardar una instantánea en la factura: `emisor {nombre, nif, direccion, numColegiada}` y `destinatario {nombre, nif, direccion}`. Que el PDF use la instantánea. Distinguir los estados `borrador` → `emitida` (la emitida queda bloqueada salvo el estado de cobro y la forma de pago) y guardar el PDF emitido en `documents/<clientId>/` mediante `save_bytes_to_documents`. Al borrar una clienta con facturas, avisar de que no se puede, o conservar la instantánea.
- **Esfuerzo:** M–L
- **Confianza:** confirmado

### [ALTA] No existen facturas rectificativas; "Anulada" es solo un estado editable ⚖️
- **Ubicación:** `src/components/InvoiceModal.jsx:311-315` (selector pendiente / pagada / anulada), `src/stores/store.js:1749-1803`; no hay serie `R` ni ningún campo `rectificaA`
- **Qué pasa:** para corregir un error, la app ofrece editar la factura (hallazgo anterior), marcarla como "anulada" (se puede volver a "pagada" cuando se quiera) o borrarla si es la última. No hay manera de emitir una rectificativa con su propia serie, la referencia a la factura rectificada, el motivo y los importes negativos o la diferencia.
- **Escenario concreto:** Raquel cobra 60 € en vez de 40 € en una factura ya enviada. Edita el importe (la paciente tiene la versión de 60 €) o la marca como anulada y hace otra. En los dos casos, en su contabilidad no queda la rectificativa que exige el art. 15 RD 1619/2012 ⚖️.
- **Impacto para Raquel:** correcciones sin soporte documental. Con VeriFactu, una anulación tiene que ser un registro de anulación o una rectificativa, nunca un cambio de estado.
- **Propuesta:** botón "Rectificar" en una factura emitida → crea una factura de la serie `R-YYYY-NNN` con `rectificaA: id`, el motivo, las líneas en negativo (anulación total) o la diferencia, y la mención "Factura rectificativa de NP-…" en el PDF. "Anulada" pasa a ser derivado ("rectificada totalmente") y deja de ser editable.
- **Esfuerzo:** M
- **Confianza:** confirmado (que falta la función); la forma exacta ⚖️

### [ALTA] Nada exportable para el gestor: sin libro de ingresos, gastos ni resumen trimestral
- **Ubicación:** no existe. En `src/` no hay CSV/XLSX, ni módulo de gastos, ni ninguna agrupación por trimestre. `src/components/Invoices.jsx:46-47` solo muestra totales del filtro (por año o estado).
- **Qué pasa:** para los modelos 130 (pago fraccionado del IRPF: ingresos y gastos acumulados del trimestre), 303/390 (si tiene operaciones no exentas ⚖️), 347 (terceros > 3.005,06 €/año, normalmente clínicas ⚖️) y el libro registro de ingresos que exige el IRPF en estimación directa, el gestor necesita, por trimestre: fecha, número, clienta, NIF, base, tipo y cuota de IVA, retención de IRPF y total. La app no da nada de eso. Tampoco hay ningún lugar donde apuntar gastos (alquiler de la consulta, cuota de autónomos, colegio, software, material).
- **Escenario concreto:** al cierre del trimestre, Raquel tiene que copiar a mano las facturas del listado (que solo muestra el total y el primer concepto) o descargar los PDF uno a uno.
- **Impacto para Raquel:** trabajo manual cada trimestre y riesgo de olvidos o errores al copiar.
- **Propuesta:**
  1. "Exportar libro de ingresos" (CSV con `;` y coma decimal, listo para Excel en español) por año o trimestre, con todas las columnas anteriores más el estado y la fecha de cobro.
  2. Resumen trimestral en Facturas (T1–T4: base, IVA, IRPF retenido, total), que excluya las anuladas o rectificadas.
  3. Módulo de gastos mínimo (fecha, proveedor, NIF, concepto, base, IVA soportado, deducible sí/no, archivo del ticket) con su propio CSV.
  4. Listado de terceros > 3.005,06 € para el 347.
- **Esfuerzo:** M (1–2) / L (3–4)
- **Confianza:** confirmado

### [ALTA] VeriFactu: la app no cumple ni está preparada; plazo vigente 1-jul-2027 (anunciado octubre de 2028) ⚖️
- **Ubicación:** todo el módulo de facturas (`store.js:1733-1828`, `pdfInvoiceGenerator.js`)
- **Estado normativo (consultado el 4-nov-2026):**
  - El **RD 1007/2023** (Reglamento de sistemas informáticos de facturación) se aplica a todos los empresarios y profesionales que emiten facturas con un programa. El RD-ley 15/2025 (BOE 3-dic-2025, convalidado el 11-dic-2025) fijó el **1-ene-2027 para sociedades y el 1-jul-2027 para autónomos**.
  - El **5-oct-2026** Hacienda anunció que lo aplazará a **octubre de 2028** para hacerlo coincidir con la factura electrónica obligatoria. Ese aplazamiento **no está publicado en el BOE**, y la disolución de las Cortes (elecciones del 29-nov) añade incertidumbre. Mientras no se publique, la fecha formal sigue siendo el 1-jul-2027.
  - Raquel tiene domicilio en Alicante, así que no está en el régimen foral, y no está en el SII: le aplica.
- **Qué le exigiría a NutriPolo (que es un "SIF" desarrollado a medida):**
  1. Un **registro de facturación de alta** por cada factura (completa, simplificada o rectificativa), con **huella SHA-256 encadenada** con el registro anterior y fecha-hora de generación.
  2. **Registro de anulación** en lugar de borrar. Inalterabilidad: no se puede editar ni borrar una factura emitida, que es justo lo contrario de lo que hacen hoy `updateInvoice` y `deleteInvoice`.
  3. **Código QR** en el PDF con la URL de cotejo de la AEAT (NIF del emisor, número, fecha, importe) y, en modalidad VERI\*FACTU, la leyenda "VERI\*FACTU".
  4. Remitir los registros a la AEAT por servicio web con certificado (modalidad VERI\*FACTU, la sencilla). La otra modalidad exige además un **registro de eventos** y firma electrónica de cada registro.
  5. Una **declaración responsable** del productor del software (aquí, el desarrollador) incluida en la propia app.
- **Impacto para Raquel:** a partir de la fecha que quede vigente, facturar con NutriPolo tal como está sería usar un sistema no conforme. Hay sanciones para el usuario y para el productor del software ⚖️. Ojo: según el art. 3.1.a RD 1619/2012, los servicios sanitarios exentos (art. 20.Uno.3º) a **particulares** podrían no requerir factura. Si se emite, VeriFactu la cubre ⚖️.
- **Propuesta:** decidir pronto entre dos caminos. **(a)** Integrar VeriFactu: es un proyecto propio, porque el modelo borrador → emitida, la instantánea y las rectificativas de los hallazgos anteriores son requisito previo. **(b)** Que la app deje de *emitir* facturas y las genere un servicio homologado (o se exporten a él), dejando en NutriPolo solo el control de cobros. Seguir el BOE por si se publica el aplazamiento a 2028.
- **Esfuerzo:** L
- **Confianza:** confirmado (que no cumple); fechas según fuentes de noviembre de 2026, a confirmar en el BOE

### [MEDIA] Nombres y direcciones largos se salen de la página o se montan sobre la otra columna
- **Ubicación:** `src/services/pdfInvoiceGenerator.js:374-375` (nombres sin ajuste de línea), `:397-403` (`drawMultiline` solo corta en `\n`), `:439-440` (lugar de atención)
- **Qué pasa:** el nombre de la clienta, su calle y la dirección de Raquel se dibujan en una sola línea sin medir el ancho. La columna de la clienta acaba en 563,8 pt y la de Raquel en 278 pt.
- **Escenario concreto (medido y renderizado):**
  - "Clínica de Fisioterapia y Nutrición Hermanos Fernández-Martínez S.L.P." acaba en x=642 pt: **más allá del borde de la hoja** (595 pt) y cortado.
  - Una calle de unos 70 caracteres acaba en 634 pt.
  - La dirección de Raquel "Calle Doctor Fleming esquina con Avenida de Chapí, número 12, bajo" llega a 333 pt y se monta sobre la dirección de la clienta.
- **Impacto para Raquel:** datos obligatorios ilegibles o cortados en la factura de clínicas con razón social larga.
- **Propuesta:** usar `wrapText` (que ya existe) en el nombre, la dirección y el lugar, con el ancho de cada columna. Cortar también las palabras más largas que la columna (emails). Reducir el cuerpo de letra solo como último recurso.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [MEDIA] La mención de exención es genérica y sale siempre que el IVA es 0 % ⚖️
- **Ubicación:** `src/services/pdfInvoiceGenerator.js:138,685-688`; `src/components/InvoiceModal.jsx:510-515`; `src/stores/store.js:1024` (`tipoIva: 0`, sin interfaz para cambiarlo)
- **Qué pasa:** con `ivaPct = 0` el PDF pone "Exento de IVA", sin el precepto legal. No hay ninguna manera de distinguir un servicio exento (consulta con finalidad terapéutica, art. 20.Uno.3º LIVA) de uno **no** exento (dieta con finalidad estética o de rendimiento, charla, taller, venta de producto ⚖️), que debería ir al 21 %. El 0 % se aplica a todo por defecto.
- **Escenario concreto:** una "dieta para la boda" o un taller de empresa se factura con "Exento de IVA" cuando probablemente lleva IVA ⚖️.
- **Impacto para Raquel:** riesgo de regularización de IVA si Hacienda entiende que algún servicio no era sanitario. Además, la mención no dice en qué se basa la exención.
- **Propuesta:** en cada servicio, un campo "Tratamiento de IVA": exento sanitario (art. 20.Uno.3º) o sujeto al 21 %. Copiarlo a la línea y, si se mezclan, partir la factura. En el PDF, texto completo: "Operación exenta de IVA según el art. 20.Uno.3º de la Ley 37/1992". Que el gestor confirme qué servicios de Raquel son exentos.
- **Esfuerzo:** M
- **Confianza:** confirmado (comportamiento); la calificación fiscal ⚖️

### [MEDIA] No se exigen los datos obligatorios: NIF del emisor, NIF y domicilio de la destinataria cuando es empresa ⚖️
- **Ubicación:** `src/components/InvoiceModal.jsx:140-151` (solo valida clienta, líneas, cantidades y precios); `src/stores/store.js:1007` (`nif: ''` por defecto); `src/services/pdfInvoiceGenerator.js:379-381` (si no hay NIF del emisor, simplemente no lo pinta)
- **Qué pasa:** se puede emitir una factura sin el NIF de Raquel. Se puede emitir con IRPF (es decir, a una empresa o profesional) sin NIF ni domicilio de la destinataria. La ficha de la clienta no indica si es particular o empresa.
- **Escenario concreto:** clínica sin NIF en la ficha + IRPF 15 % → la factura sale sin NIF de la destinataria. Ni siquiera con NIF saldría, por el hallazgo crítico.
- **Impacto para Raquel:** facturas incompletas a empresas, que deben ser completas (art. 6 RD 1619/2012 ⚖️). Para particulares, la factura actual puede valer como simplificada (≤ 400 €), pero ni lo dice ni se controla.
- **Propuesta:** `tipoCliente` (particular / empresa-profesional) en la ficha. Si es empresa: NIF y domicilio obligatorios e IRPF propuesto (15 %, o 7 % los tres primeros años de actividad ⚖️). Bloquear la emisión si falta el NIF de Raquel en Ajustes.
- **Esfuerzo:** S–M
- **Confianza:** confirmado

### [MEDIA] Facturas por transferencia sin número de cuenta: el IBAN no se puede configurar
- **Ubicación:** `src/services/pdfInvoiceGenerator.js:731-735` (pinta `config.iban`); en `src/components/SettingsView.jsx:1876-1906` (datos personales) no hay campo IBAN; `grep iban` no da ninguna otra coincidencia
- **Qué pasa:** el pie dibuja "DATOS BANCARIOS" solo si existe `config.iban`, pero nada lo establece.
- **Escenario concreto:** forma de pago "Transferencia bancaria" → la factura no dice adónde transferir (se ve en el PNG renderizado).
- **Impacto para Raquel:** la paciente o la clínica tiene que preguntar el número de cuenta, y el cobro se retrasa.
- **Propuesta:** campo IBAN (validando el dígito de control) en Ajustes → Datos personales.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [MEDIA] No se puede enviar una factura por email, y el modo "Factura" del selector adjunta otro PDF
- **Ubicación:** `src/components/SendEmailModal.jsx:13-18` (`MODES` incluye `invoice`), `:137-146`; lo abren `NutritionPlanEditor.jsx:609-615` (con los bytes del plan), `ConsultationModal.jsx:384` y `ClientDetailView.jsx:388`. Ningún componente de facturas lo abre.
- **Qué pasa:** `Invoices.jsx` e `InvoiceModal.jsx` no tienen la acción "Enviar". Pero el `SegmentedControl` de modos permite cambiar a "Factura" desde cualquier email. En ese modo se envía `pdfBytes` (el PDF del plan, si se ha abierto desde el plan) con el nombre `factura.pdf`, y la plantilla queda como "factura — por importe de —".
- **Escenario concreto:** Enviar plan → cambiar a "Factura" → la paciente recibe "Adjunto encontrarás la factura —" con su plan nutricional adjunto como `factura.pdf`. Si se abre desde un documento o un recordatorio, sale sin adjunto.
- **Impacto para Raquel:** no puede mandar facturas desde la app, y el modo que parece servir para eso manda un email confuso.
- **Propuesta:** botón "Enviar por email" en el listado y en el modal de la factura, que genere el PDF (o use el archivado) y abra `SendEmailModal mode="invoice" invoice={…} pdfBytes={…}`. Quitar "Factura" (y los modos sin datos) del selector cuando no venga `invoice`. Marcar la factura como enviada.
- **Esfuerzo:** S–M
- **Confianza:** confirmado

### [MEDIA] Al cambiar de clienta en el modal se quedan las consultas de la anterior
- **Ubicación:** `src/components/InvoiceModal.jsx:250` (`onChange` del selector solo cambia `clienteId`)
- **Qué pasa:** las líneas añadidas desde "Añadir consultas" llevan el `consultationId` de la clienta A. Si se cambia a la clienta B, las líneas siguen ahí.
- **Escenario concreto:** se abre la factura con la clienta equivocada → se añade "Seguimiento — 03/11/2026" → se corrige la clienta → se guarda. B recibe una factura por una consulta de A, y esa consulta de A desaparece de "sin facturar".
- **Impacto para Raquel:** factura a la persona equivocada, que además contiene una cita de otra paciente.
- **Propuesta:** al cambiar de clienta, quitar las líneas con `consultationId` (avisando) o bloquear el cambio si las hay. Validar al guardar que cada `consultationId` pertenece a `clienteId`.
- **Esfuerzo:** S
- **Confianza:** confirmado (por lectura de código y del flujo del store)

### [MEDIA] Una consulta de una factura anulada queda "facturada" para siempre
- **Ubicación:** `src/stores/store.js:1818-1828` (`getUnbilledConsultations` no mira `estado`), `src/components/Dashboard.jsx:635-644`
- **Qué pasa:** el conjunto `billedIds` incluye las líneas de facturas anuladas.
- **Escenario concreto (reproducido):** factura con la consulta c1 → se marca anulada → `getUnbilledConsultations` devuelve 0. Para volver a facturarla hay que escribir la línea a mano, sin vínculo.
- **Impacto para Raquel:** la consulta no aparece en "sin facturar" y se puede quedar sin cobrar.
- **Propuesta:** excluir las facturas anuladas o rectificadas en su totalidad al calcular `billedIds`, en el store y en el Dashboard, con una función común.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [MEDIA] La fecha no se controla: número de una serie con fecha de otro año, y fechas fuera de orden ⚖️
- **Ubicación:** `src/components/InvoiceModal.jsx:265-271` (solo renumera en una factura nueva y si no se ha tocado el número), `src/stores/store.js:1739-1747,1777-1803`
- **Qué pasa:**
  1. Al editar, la fecha puede cambiar de año y el número se queda (reproducido: `NP-2026-001` con fecha `2025-12-31`; la serie 2025 sigue empezando en 001).
  2. Una factura nueva puede llevar fecha anterior a la última de la serie (NP-2026-002 del 01/11 detrás de NP-2026-001 del 20/11).
- **Impacto para Raquel:** numeración no correlativa en el tiempo dentro de la serie, que es lo primero que mira una inspección ⚖️. Una factura de 2025 aparece filtrada en 2025 con número de 2026.
- **Propuesta:** con la factura emitida, fecha bloqueada (ver el hallazgo de modificaciones). Al crear, avisar si la fecha es anterior a la de la última factura de la serie o si el año no coincide con el del número.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [MEDIA] "Ingresos cobrados" del Dashboard no son los ingresos fiscales, y no hay vista trimestral
- **Ubicación:** `src/components/Dashboard.jsx:671-679` (gráfico), `:402` (título "Ingresos cobrados"), `:613-620`
- **Qué pasa:** suma `total` (descontado el IRPF y con IVA incluido) de las facturas `pagada`, por **fecha de factura**. No existe la fecha de cobro. Solo muestra los últimos 6 meses, sin trimestres ni año.
- **Escenario concreto:** factura a una clínica de 400 € con IRPF del 15 % → el gráfico suma 340 €. El ingreso computable para el modelo 130 es 400 €; los 60 € los ingresa la clínica por ella ⚖️. Una factura de octubre cobrada en noviembre cuenta en octubre.
- **Impacto para Raquel:** con lo que ve en la app cree que ha ganado menos de lo que declara, o no le cuadra con el gestor.
- **Propuesta:** dos cifras: "Facturado (base)" para la parte fiscal y "Cobrado (líquido)" para la tesorería. Añadir `fechaCobro` al marcar como pagada. Selector por trimestre y año que coincida con el resumen trimestral del hallazgo de exportación.
- **Esfuerzo:** S–M
- **Confianza:** confirmado

### [MEDIA] Bonos y packs no se vinculan a consultas: riesgo de cobrar dos veces y contador inflado
- **Ubicación:** `src/stores/store.js:289-295` (servicios "Pack 4/10 sesiones"), `:1818-1828`; `src/components/Dashboard.jsx:635-644`
- **Qué pasa:** al facturar un pack no se marca ninguna consulta. Las 4 o 10 sesiones del pack siguen saliendo como "sin facturar" y se ofrecen en "Añadir consultas". Además, el contador del Dashboard incluye consultas completadas **sin paciente asignado** (importadas de los calendarios de las clínicas), que el modal nunca deja facturar.
- **Escenario concreto:** Raquel factura "Pack 4 sesiones" (140 €). Después ve "3 consultas sin facturar" de esa paciente, las añade a la factura siguiente y le cobra dos veces.
- **Impacto para Raquel:** cobro doble a una paciente, o un contador que nunca llega a 0 y en el que deja de confiar.
- **Propuesta:** guardar los bonos vendidos (`sesionesRestantes`) e imputar las consultas al bono: marcarlas como "cubiertas por bono NP-…". En el contador, contar solo consultas con `clienteId`. Opcional: excluir las ubicaciones donde factura la clínica (ajuste por ubicación).
- **Esfuerzo:** M
- **Confianza:** confirmado (que no hay vínculo); que hoy esté generando cobros dobles: probable (falta ver datos reales)

### [BAJA] Número de factura libre: huecos, formatos ajenos y cambios silenciosos
- **Ubicación:** `src/components/InvoiceModal.jsx:238-244`, `src/stores/store.js:1750-1756,1783-1790`
- **Qué pasa:**
  - Escribir `NP-2026-010` cuando toca la 002 deja un hueco del 003 al 009, y la siguiente será la 011 (reproducido).
  - Un número fuera del formato `NP-YYYY-NNN` crea una serie paralela, sin protección contra el borrado (`canDeleteInvoice` → true).
  - Un número duplicado se cambia o se descarta en silencio (solo `console.warn`): el toast dice "Factura creada" con otro número.
- **Propuesta:** número de solo lectura (o editable solo con confirmación y validando que sea el siguiente). Si hay que regenerarlo, decírselo en el toast.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [BAJA] Notas con saltos de línea: interlineado irregular y altura mal calculada
- **Ubicación:** `src/services/pdfInvoiceGenerator.js:52-67` (`wrapText` solo corta por espacios), `:628-637`
- **Qué pasa:** el `Textarea` de notas admite Enter. Esos `\n` llegan dentro de una "palabra" a `drawText`, que los parte con su interlineado por defecto. El cálculo de `y` solo descuenta una línea, así que lo que viene detrás se puede montar (visto en el PNG: líneas muy separadas).
- **Propuesta:** `wrapText` debe partir antes por `\n` y luego por palabras. Medir la altura real para el salto de página del hallazgo del TOTAL.
- **Esfuerzo:** S
- **Confianza:** confirmado

### [BAJA] Validaciones de importes y porcentajes demasiado laxas
- **Ubicación:** `src/components/InvoiceModal.jsx:140-151,459-480`, `src/stores/store.js:240-247`
- **Qué pasa:**
  - Se aceptan IRPF/IVA negativos o mayores de 100 si se teclean (`min` del input no bloquea): con IRPF −15 % sobre 100 € sale un total de 115 €.
  - Precios con tres decimales: 1,005 € → base 1,00 € por la coma flotante (`1.005*100 = 100.4999…`).
  - Las líneas con precio negativo se aceptan sin marcarlas como descuento.
- **Propuesta:** limitar los porcentajes a 0–100 (IRPF a 0/7/15/19). Redondear el precio a 2 decimales al escribirlo (`Math.round(Number(x.toFixed(4))*100)` o parseo decimal). Opción explícita de "Descuento".
- **Esfuerzo:** S
- **Confianza:** confirmado

### [BAJA] "Añadir consultas" no pone precio si el tipo no se llama exactamente igual que el servicio
- **Ubicación:** `src/components/InvoiceModal.jsx:103-118`; tipos por defecto en `src/stores/store.js:1015` frente a los servicios en `:289-295`
- **Qué pasa:** busca un servicio activo con `nombre === consultation.tipo`. El tipo "Seguimiento" no coincide con el servicio "Seguimiento mensual", y el precio queda vacío (la validación lo exige a mano).
- **Propuesta:** asociar el tipo de consulta a un servicio en Ajustes, o buscar por prefijo o con el `fuzzyMatcher` ya existente.
- **Esfuerzo:** S
- **Confianza:** confirmado

---

## Pendientes de la auditoría de oct-2026

- **#46** `Invoices.jsx:37,163`: `clients.find` dentro de `filter` y `map` (O(n·m)) en cada pulsación del buscador. Pendiente (impacto bajo con su volumen).
- **Lógica duplicada "guardado de PDF de factura (2)"**: `Invoices.jsx:59-79` e `InvoiceModal.jsx:191-212` siguen siendo copias. Pendiente. Conviene unificarlas al archivar el PDF (hallazgo de modificaciones).
- **Fechas `es-ES` fijas, `InvoiceModal.jsx:137`**: sigue con `'es-ES'` fijo. Pendiente (i18n).
- **Textos fijos en `InvoiceModal`**: "Añadir línea" (`:398`) y "Añadir consultas" (`:420`). Pendiente (i18n).

Corregidos y verificados: #53 (los totales excluyen las anuladas), #64 (doble clic → `savingRef`), #82 (precio 0 válido), #88 (`split/join` en plantillas).

## Lo que está bien (no tocar)

- `computeInvoiceTotals` (`store.js:234-255`): cálculo en céntimos enteros, redondeo por línea, IVA e IRPF sobre la base total y total = base + IVA − IRPF. Con 3 × 33,33 € al 21 %/15 % sale 99,99 / 21,00 / 15,00 / 105,99, correcto. Las sumas en coma flotante del listado y el Dashboard solo producen errores < 1e-10 que el formateo absorbe.
- `updateInvoice` vuelve a calcular los totales desde las líneas: un total guardado no puede desincronizarse de sus líneas.
- Numeración derivada de las facturas existentes (sin contador persistente), por año de la fecha, y renumeración automática en una factura nueva al cambiar la fecha de año.
- Doble clic al guardar protegido con `savingRef`. Los importes en el PDF salen en formato español ("40,00 €"), con Onest (acentos correctos) y salto de página para las líneas.
- Los precios se copian del servicio a la línea, así que cambiar la tarifa no altera las facturas pasadas.
- Al borrar una clienta, sus facturas se conservan (`store.js:898`). Falta la instantánea de sus datos (ver el hallazgo de modificaciones).

## Fuera de mi área (notas para otras sesiones)

- **Código/tests:** `npm test` ejecuta también los tests de `.claude/worktrees/*` (110 ficheros de test frente a 13 en `src/`). Un fallo en una worktree abandonada puede romper la suite principal o esconder lo que pasa en `main`. Conviene `exclude: ['.claude/**']` en la configuración de vitest.
- **Rendimiento/UI:** `ClientDetailView.jsx:360-379`: la pestaña de pagos lista las facturas sin ninguna acción (ni abrir, ni descargar, ni marcar como pagada).
- **Datos:** el aviso de integridad "facturas referencian servicios eliminados" (`store.js:1920-1924`) es ruido: la factura no necesita el servicio porque copia descripción y precio. Se podría quitar.

---

## Notas legales ⚖️ (para revisar con su gestor)

1. **Exención de IVA (art. 20.Uno.3º LIVA).** Cubre la asistencia a personas físicas por profesionales sanitarios cuando tiene finalidad de diagnóstico, prevención o tratamiento. Para dietistas-nutricionistas hay consultas vinculantes de la DGT (p. ej. V2276-24) y respuestas de la AEAT al Consejo General de Dietistas-Nutricionistas. Las dietas sin finalidad terapéutica (estética, rendimiento), los talleres, las charlas y la venta de productos tributarían al 21 % (o al tipo del producto). Hay que confirmar qué servicios de Raquel son exentos.
2. **¿Hay que facturar?** El art. 3.1.a RD 1619/2012 excluye de la obligación de facturar las operaciones exentas del art. 20.Uno (el 3º no está entre las excepciones), salvo lo previsto en el art. 2.2 (destinataria empresaria o profesional). Hay que confirmar si a los particulares le basta con un justificante o una factura simplificada. A clínicas y empresas, factura completa siempre.
3. **Factura completa frente a simplificada.** La completa (art. 6) lleva número y serie, fecha, nombre y NIF de las dos partes, domicilio (el de la destinataria persona física no empresaria no es obligatorio), descripción, base, tipo, cuota o mención de exención con su precepto, y fecha de la operación si es distinta. La simplificada (art. 7) se admite hasta 400 € (IVA incluido).
4. **IRPF.** Retención del 15 % (7 % el año de inicio y los dos siguientes) cuando la pagadora es empresa o profesional. Las operaciones con retención se declaran en el modelo 190 del pagador y, por lo general, quedan fuera del 347.
5. **Rectificativas (art. 15 RD 1619/2012).** Toda corrección de una factura emitida se hace con una rectificativa en serie propia, con referencia a la original.
6. **Modelos.** 130 trimestral (ingresos − gastos acumulados × 20 % − retenciones). 303/390 solo si tiene operaciones no exentas. 347 por terceros > 3.005,06 €. Libro registro de ingresos y gastos (estimación directa).

## Fuentes

- RD 1619/2012, Reglamento de facturación: <https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696>
- Ley 37/1992 del IVA (art. 20.Uno.3º): <https://www.boe.es/buscar/act.php?id=BOE-A-1992-28740>
- RD 1007/2023 (sistemas informáticos de facturación / VeriFactu): <https://www.boe.es/buscar/act.php?id=BOE-A-2023-24840>
- AEAT, sistemas informáticos de facturación y VERI\*FACTU: <https://sede.agenciatributaria.gob.es/Sede/procedimientos/IZ86.shtml>
- Calendario 2027 (RD-ley 15/2025): [guiafiscal.es](https://guiafiscal.es/autonomos/verifactu-guia/), [verifactu.com](https://www.verifactu.com/el-nuevo-calendario-de-verifactu-guia-tras-el-aplazamiento-a-2027/), [xolo.io](https://blog.xolo.io/es/hacienda-retrasa-verifactu-hasta-2027-lo-que-los-aut%C3%B3nomos-deben-saber)
- Anuncio de aplazamiento a octubre de 2028 (5-oct-2026, no publicado en el BOE): [facturadirecta.com](https://www.facturadirecta.com/blog/verifactu-aplazamiento-octubre-2028/), [supercontable.com](https://www.supercontable.com/boletin/H/articulos/Verifactu_se_aplaza_octubre_2028_incertidumbre_anuncio_sin_norma_con_elecciones.html), [diaridetarragona.com](https://www.diaridetarragona.com/economia/hacienda/272398/hacienda-aplaza-verifactu-2028-alinearlo-factura-electronica.html)
- IVA de dietistas-nutricionistas: [Consulta vinculante V2276-24 (CGDN)](https://www.consejodietistasnutricionistas.com/wp-content/uploads/2024/11/4.-Resolucion_V2276_24_Consulta-Vinculante-IVA.pdf), [Respuesta AEAT al CGDN](https://consejodietistasnutricionistas.com/wp-content/uploads/2025/02/Respuesta-IVA2_AEAT.pdf)
