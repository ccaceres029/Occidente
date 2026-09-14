# Revisión de Claude Code

Estado: consulta de arquitectura terminada. Este archivo resume su respuesta; no es un registro de ejecución en vivo.

Claude Code 2.1.269 fue consultado desde la terminal en modo de solo lectura sobre los HTML del plan y la arquitectura de la aplicación actual. Codex realiza la implementación y las pruebas.

## Recomendaciones principales

- Crear una aplicación de seguimiento separada del sistema de afiliaciones, con cuentas y cookie de sesión propias. Agregar usuarios externos al sistema actual podría darles acceso a rutas operativas.
- Reutilizar patrones técnicos, sin importar la lógica de expedientes ni sus secretos.
- Usar una implementación local aislada para desarrollo y un adaptador MySQL para el despliegue posterior.
- Registrar responsable, criterio de aceptación, comentarios, evidencia e historial de cambios por tarea.
- Calcular fechas de sprints con fechas civiles y aritmética UTC, para evitar desplazamientos por zona horaria.
- Mantener explícita la diferencia entre validación de una tarea y aceptación final contractual.
- Probar permisos, concurrencia, persistencia, calendario, evidencia y aislamiento.

## Decisiones de esta primera implementación

- Servicio independiente, puerto local 3012, con frontend propio y sesiones diferentes del sistema de afiliaciones.
- Perfiles Coordinación, MACAO, AFP y Consulta.
- Todas las tareas, comentarios y evidencias son compartidos con el equipo del proyecto. No se ofrece todavía un área privada interna; la interfaz lo indicará.
- Evidencias por enlace HTTP o HTTPS. La carga de archivos queda para una extensión con controles y almacenamiento privado.
- MySQL almacena inicialmente un documento de proyecto en una tabla propia de InnoDB. Cada modificación y su historial se confirman juntos bajo bloqueo de fila. Es una decisión de alcance para un proyecto pequeño; la propuesta de Claude de tablas normalizadas queda como evolución para mayor volumen.
- Sin precios ni campos monetarios. Los datos del prototipo estático permanecen como referencia histórica.
- La pausa de Semana Morazánica 2026 se conserva como opción de planificación, pendiente de acuerdo con AFP.

## Límites de esta colaboración

Claude revisó y propuso la arquitectura. No modificó archivos, no ejecutó pruebas y no accedió a MySQL ni al servidor. La autoría de la implementación y su verificación corresponde a Codex.
