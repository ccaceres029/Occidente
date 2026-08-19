# Datos locales del demo

En producción, MySQL `dbOccidente` conserva los casos, la auditoría, los
usuarios, las sesiones, la configuración de correo y la bandeja de solicitudes.
Si las tablas están vacías durante la primera puesta en marcha, el servidor
importa automáticamente el contenido existente de `demo-db.json`.

El archivo JSON se mantiene únicamente como compatibilidad para pruebas locales
y como origen de la migración inicial.

Los archivos en `uploads/` deben ser exclusivamente insumos sintéticos del
demo. Ningún documento se envía a Gemini ni a otro servicio externo.
