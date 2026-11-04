# Auditoría NutriPolo v1.18.1 — resumen (noviembre 2026)

8 auditorías en paralelo, todas en solo lectura. Cada hallazgo está comprobado contra el código (muchos, con pruebas en un scratchpad o con PDFs renderizados). `npm test` pasa. Los informes completos, con ubicación, escenario, propuesta y esfuerzo de cada hallazgo:

| # | Área | Crít. | Alta | Media | Baja | Total |
|---|------|:---:|:---:|:---:|:---:|:---:|
| [01](01-datos-integridad.md) | Datos, persistencia e integridad | 3 | 8 | 7 | 4 | 22 |
| [02](02-facturacion-contabilidad.md) | Facturación y contabilidad | 1 | 6 | 10 | 5 | 22 |
| [03](03-citas-calendar-recordatorios.md) | Citas, Google Calendar y recordatorios | 2 | 5 | 10 | 4 | 21 |
| [04](04-seguridad-rust.md) | Seguridad, privacidad y Rust | 1 | 2 | 9 | 6 | 18 |
| [05](05-rendimiento.md) | Rendimiento | 0 | 2 | 5 | 6 | 13 |
| [06](06-ui-ux.md) | Diseño, UI/UX y accesibilidad | 0 | 7 | 13 | 7 | 27 |
| [07](07-codigo-muerto-calidad.md) | Código muerto y buenas prácticas | 0 | 2 | 7 | 7 | 16 |
| [08](08-dietas-recetas-mediciones.md) | Dietas, recetas y mediciones | 0 | 3 | 7 | 8 | 18 |
| | **Total** (con solapes entre áreas) | **7** | **35** | **68** | **47** | **157** |

Quitando los solapes, quedan unos 140 problemas distintos. Abajo están agrupados por tema y en el orden en que conviene atacarlos.

---

## Lo más grave, en una frase cada uno

1. **El NIF de la clienta no sale nunca en la factura.** El PDF lee `client.cifNif`, pero la ficha lo guarda en `client.nif` (`pdfInvoiceGenerator.js:382`). Afecta a todas las facturas emitidas a clínicas y empresas. *(02)*
2. **Deshacer el borrado de una factura crea dos facturas con el mismo número.** Basta borrar la última, crear otra (que reutiliza el número) y pulsar Ctrl+Z. *(01, 02)*
3. **Las facturas no guardan los datos de la clienta.** Si se edita o se borra la ficha, la factura ya emitida cambia o se queda sin destinataria. *(01)*
4. **Restaurar o importar una copia de seguridad no valida nada y no guarda antes el estado actual.** Una copia vieja o dañada pisa todos los datos buenos. Además reutiliza números de factura ya emitidos y vuelve a mandar recordatorios. *(01)*
5. **Cambiar la contraseña del cifrado no es transaccional.** Un fallo a medias, o un guardado que coincide con el cambio, deja ficheros cifrados con una clave perdida, y un reintento borra la copia de seguridad. *(01, 04)*
6. **Hay citas que se asignan solas al paciente equivocado.** Pasa cuando la descripción trae el teléfono o el correo de otra persona, o cuando la palabra del tipo de cita junta pacientes distintos en una sola sugerencia. Es riesgo de mandar un recordatorio o una reseña a quien no toca. *(03)*

## Temas transversales

### A. Facturación y obligaciones fiscales ⚖️ *(02, 01, 06)*
- El NIF de la destinataria no sale (crítico). Las facturas emitidas se pueden editar sin límite y el PDF se regenera con los datos actuales.
- No hay facturas rectificativas: "Anulada" es solo un estado editable.
- Con 12–13 líneas, el pie del PDF tapa el TOTAL. Los nombres y direcciones largos se salen de la página.
- No hay nada que exportar para el gestor (libro de ingresos, resumen trimestral con base / IVA / IRPF), ni filtro trimestral.
- No se exigen los datos obligatorios (NIF del emisor; NIF y domicilio de la destinataria cuando es empresa). El IBAN no se puede configurar. La mención de exención es genérica.
- Las facturas no se pueden enviar por email, y el modo "Factura" del modal adjunta otro PDF.
- **VeriFactu:** la app no está preparada. Según el informe 02, el plazo vigente es el 1-jul-2027 y hay anunciado un aplazamiento a octubre de 2028. Conviene confirmarlo con su gestor antes de planificar.

### B. Trabajo que se pierde sin aviso *(06, 08, 01)*
- Los atajos globales (Ctrl+1…7, Ctrl+K, Ctrl+Z) funcionan aunque haya un modal o el editor de planificación abierto, y tiran el trabajo.
- Un clic fuera del modal o la tecla Escape cierran los formularios sin preguntar.
- Una planificación sin guardar se pierde con el bloqueo automático, al salir, con F5 o al actualizar.
- Ctrl+Z, con el cursor fuera de un campo, después de crear un cliente borra la ficha, y Ctrl+Y la devuelve incompleta.
- Las confirmaciones de borrado dejan enfocado el botón de borrar: un Enter borra.

### C. Copias de seguridad *(01, 07)*
- La copia automática solo se hace al arrancar; con la app en la bandeja pueden pasar días sin copia. Sus fallos son silenciosos, y un `backup-manifest` dañado las para para siempre.
- La app dice "Backup exportado correctamente" aunque se cancele el diálogo o falle la escritura.
- Importar un ZIP no avisa de los documentos que no ha podido restaurar.
- En la pantalla de error de carga, si la restauración falla, "Reintentar" arranca la app vacía.
- Las migraciones sobrescriben el fichero sin guardar antes la versión anterior. La escritura atómica no hace `fsync`, así que un corte de luz puede dejar un fichero vacío.

### D. Cifrado *(04, 01)*
- El cambio de contraseña no es transaccional (crítico).
- Si falta `encryption.json`, la app arranca vacía sin avisar.
- Si la activación del cifrado falla a medias, quedan documentos en claro.
- Si Raquel olvida la contraseña, no hay forma de recuperar los datos. Hay que decidirlo conscientemente: clave de recuperación impresa, o al menos un aviso claro.

### E. Citas y recordatorios *(03, 06)*
- Emparejamiento erróneo de pacientes (2 críticos). Además, el correo de la propia cuenta de Google de Raquel puede quedar como email de un paciente.
- Los recordatorios automáticos salen con datos viejos si el sync falla.
- El opt-out y "ya pedida" no frenan los reintentos automáticos.
- Puede haber doble envío por email: el lote no vuelve a mirar el estado antes de enviar.
- Las citas importadas no tienen ubicación, así que los mensajes dicen "en —".
- En calendarios de solo lectura, las citas canceladas vuelven a "programada". La agenda pinta las canceladas como si no lo estuvieran.
- Los fallos del sync en segundo plano y el bloqueo automático paran todo sin decir nada.

### F. Privacidad de datos de salud (RGPD) *(04, 08, 01)*
- Las "Notas para el cliente" se suben a Google Calendar (también a los calendarios de la clínica) sin avisar.
- Las notas de las opciones de una planificación pasan a "Mis recetas" y se autocompletan en el PDF de otros pacientes.
- Borrar un paciente no lo borra todo, por ejemplo las notas en Google, y no hay exportación por paciente (derechos de supresión y de acceso).
- Hay un `client_id` con `:` que permite salir de la carpeta `documents/`. Además, `envPrefix: 'TAURI_'` podría acabar metiendo la clave privada del actualizador en el instalador.

### G. Rendimiento *(05)*
- Cada cambio reescribe y cifra el store entero (unos 22 MB en el escenario sintético) con un comando síncrono. Pasa también al navegar y cada 5 minutos con la app en la bandeja. Las fotos en data URL dentro del JSON doblan ese tamaño.
- La vista previa de la planificación regenera el PDF entero en el hilo principal a cada pausa de 700 ms.
- El primer sync de un calendario congela la app varios segundos.

### H. Calidad y proceso *(07)*
- Las releases se publican sin pasar tests ni una compilación de comprobación.
- Lo más crítico no tiene tests: migraciones, importes, plantillas de email, cifrado y copias.
- `npm test` también ejecuta las copias que hay en `.claude/worktrees` (8 veces más trabajo y resultados engañosos).
- En producción no queda ningún rastro de los errores.
- No hay ESLint. Hay seis ficheros enormes, lógica duplicada, unas 115 claves de i18n sin usar y restos de otro proyecto (PoloTrack) en la raíz.

---

## Plan propuesto

**Fase 0 — Arreglos rápidos (S, en un día)** — ✅ hecha (rama `claude/auditoria-fase0`)
1. NIF en la factura (`client.nif`) y un test. Después, revisar y volver a enviar las facturas a empresas que lo necesiten.
2. Deshacer: no permitir deshacer el borrado de una factura, ni la creación de un cliente si después se ha tocado su ficha.
3. Atajos globales y Escape / clic fuera: bloquearlos con un modal o un editor abierto; preguntar antes de descartar cambios.
4. Confirmaciones de borrado con el foco en "Cancelar".
5. Mensaje de copia de seguridad veraz. Excluir `.claude/worktrees` en vitest.
6. Los recordatorios automáticos respetan el opt-out y vuelven a leer el estado justo antes de enviar.

**Fase 1 — Que no se pierdan datos (M–L)** — ✅ hecha (rama `claude/auditoria-fase1`)
- Copias de seguridad: periódicas también con la app en la bandeja, avisando si fallan; copia previa antes de restaurar, migrar o importar; validación de versión y formato.
- Cambio de contraseña transaccional, `fsync`, aviso si falla el guardado al salir, protección de los editores sin guardar.

**Fase 2 — Facturación legal (M–L)** ⚖️ *Validar con su gestor.*
- Guardar una copia de los datos de la clienta y del emisor en cada factura; bloquear la edición de las emitidas; facturas rectificativas.
- Exportación trimestral para el gestor (CSV/PDF con base, IVA e IRPF).
- Datos obligatorios, IBAN, mención de exención, PDF sin desbordes, envío de la factura por email.
- Plan para VeriFactu según la fecha confirmada.

**Fase 3 — Citas y privacidad (M)**
- Emparejador: prioridad del nombre del título frente al contacto de la descripción, ignorar la cuenta propia y no agrupar por la palabra del tipo de cita.
- Ubicación de las citas importadas y estado cancelado en calendarios de solo lectura.
- Aviso antes de subir notas a Google; no guardar las notas de las opciones en "Mis recetas"; borrado y exportación completos por paciente.

**Fase 4 — Rendimiento (M)**
- Guardar cada entidad por separado en lugar del store entero; sacar las fotos del JSON a ficheros; vista previa del PDF en un worker, con debounce más largo; sync por lotes.

**Fase 5 — UX y mantenimiento (continuo)**
- Las 10 mejoras de más impacto por esfuerzo del informe 06: acceso directo a la ficha desde la agenda, modo oscuro, búsqueda sin acentos, WhatsApp "abierto" en vez de "enviado"…
- CI con tests antes de cada release, ESLint, partir los ficheros grandes, limpiar el código muerto, poner al día `CLAUDE.md` y `README.md`.
