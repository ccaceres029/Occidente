# AFPC Occidente - Mesa de Control de Afiliaciones

Demostración local y sintética para recorrer una afiliación individual desde su ingreso en sucursal hasta la preparación del registro para el sistema central.

## Alcance de la demostración

- Bandeja operativa y tablero con métricas.
- Formulario guiado para crear casos sintéticos.
- Expediente 360 con documentos, datos, reglas y auditoría.
- Validaciones determinísticas de completitud, FATCA, firma, consistencia y procedencia.
- Reproceso con corrección y conservación del historial.
- Escalamiento a Cumplimiento y aprobación humana.
- Vista previa de los datos preparados para el sistema central.
- Contrato PDF generado desde los datos canónicos.
- Resumen asistido por Gemini cuando la llave local está disponible.
- Solicitud automática por SMTP cuando la matriz documental detecta faltantes.
- Vinculación de respuestas por código AFPC y encabezados del hilo para incorporar adjuntos y reanalizar el caso.

> La demostración no contiene ni debe recibir información real de clientes. Los casos incluidos son ficticios.

## Requisitos

- Node.js 24 o compatible.
- pnpm 11.
- El archivo local de MACAOIT puede aportar `GEMINI_API_KEY` y `GEMINI_MODEL`. La llave nunca se copia al repositorio ni se devuelve al navegador.

## Ejecutar

```bash
pnpm install
pnpm dev
```

Luego abrir:

- Aplicación: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:3001/api`
- Salud: `http://127.0.0.1:3001/api/health`

## Validar

```bash
pnpm test
pnpm build
```

## Recorridos recomendados

1. Abrir el caso con constancia incompleta, revisar el bloqueo y seleccionar **Aplicar corrección de demostración**.
2. Reprocesar las reglas y marcar el expediente como listo para el sistema central.
3. Abrir el caso FATCA, escalarlo a Cumplimiento y aprobarlo como usuario autorizado.
4. Descargar el contrato generado y revisar los datos preparados para el sistema central.

## Seguridad de la demostración

- Toda la información precargada es sintética.
- Gemini recibe únicamente un resumen estructurado del caso sintético, nunca los archivos reales del expediente usado como referencia.
- Los identificadores sensibles se muestran enmascarados.
- Las decisiones quedan registradas en una bitácora local.
- En producción, la autenticación, las sesiones, los expedientes, la auditoría y la bandeja de solicitudes usan MySQL `dbOccidente`.
- La cuenta de correo se conecta por IMAP TLS para entrada y SMTP TLS para salida; su contraseña se almacena cifrada.
- Los documentos de solicitudes y respuestas permanecen en S3 privado bajo la carpeta del caso; MySQL conserva su metadata y trazabilidad.
- Los correos automáticos se registran por caso y mensaje de origen para impedir envíos duplicados durante la sincronización IMAP.
- El resumen operativo usa solicitudes entrantes, casos generados, documentos y etapas de análisis almacenados en MySQL.
- Cuando la opción está activa, un correo se mueve de INBOX a la Papelera IMAP únicamente después de persistir su solicitud, caso y documentos; no se elimina de forma permanente.
