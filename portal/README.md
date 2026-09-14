# Portal de seguimiento de AFP Occidente

Primera versión funcional 0.1.0 para controlar el proyecto con ocho sprints. Aplicación independiente del portal de afiliaciones: no utiliza sus usuarios, cookies, tablas, correo, IA, S3 ni configuración de secretos. No contiene campos monetarios.

## Propuesta de funcionamiento

1. Coordinación confirma el calendario y asigna tareas a cada sprint.
2. MACAO registra responsables, fechas, criterios, dependencias y evidencia por enlace.
3. Cada tarea recorre Pendiente → En desarrollo → Pruebas MACAO → Validación AFP → Aceptado.
4. AFP acepta con observación y evidencia, o devuelve a pruebas indicando el motivo. La aceptación de tareas no sustituye la aceptación final contractual.
5. El dashboard calcula avance desde los datos guardados y distingue entregables aceptados, tareas en validación, bloqueos y vencimientos.

Los ocho entregables iniciales están pendientes y sin responsables ficticios. Las tareas adicionales pueden ser actividades o solicitudes de cambio. Las solicitudes no cuentan en el avance comprometido ni pueden aceptarse hasta que coordinación las incorpore al alcance mediante cambio de tipo.

El muro permite búsqueda, filtros de sprint y responsable, bloqueos, consulta de archivados y CSV. Cada tarjeta contiene comentarios e historial. Archivar conserva los datos; coordinación puede restaurar. No hay eliminación definitiva desde la interfaz.

## Perfiles

| Perfil | Permisos |
| --- | --- |
| Coordinación | Calendario, cuentas, tareas, asignación, estados, aceptación, reapertura, archivo y restauración |
| Equipo MACAO | Crear y editar tareas no aceptadas, evidencias, etapas previas a aceptación, comentarios y bloqueos |
| Validador AFP | Leer, comentar, registrar bloqueos, aceptar o devolver tareas en validación |
| Consulta | Leer tareas, calendario, comentarios, historial y exportar el listado |

Todas las tareas, evidencias por enlace y comentarios son compartidos con el equipo del proyecto. No se implementó visibilidad privada interna. Las evidencias deben alojarse en un repositorio autorizado: el portal no cambia sus permisos ni descarga su contenido.

## Ejecución local

Desde la raíz del repositorio, con las dependencias instaladas:

```bash
pnpm portal:dev
```

Abrir http://127.0.0.1:3012. Este modo muestra un selector de cuatro perfiles ficticios y guarda el proyecto en `server/data/project-portal-demo.json`, excluido de Git. Los cambios sobreviven a recargas y reinicios. El modo demo solo escucha en loopback: no debe publicarse mediante un proxy ni usarse para información real.

Se puede cambiar el puerto con `PORTAL_PORT` y la ubicación del archivo con `PORTAL_DATA_FILE`. El adaptador JSON admite un solo proceso; no se debe compartir el archivo entre instancias. No abre conexiones de red a servicios de afiliaciones o MySQL.

La aplicación web requiere su API: no funciona abriendo `portal/index.html` con doble clic. El frontend no necesita una compilación adicional. Los HTML de `Propuestas/PlanTrabajo` permanecen como documentos históricos; el nuevo portal genera su calendario desde el proyecto guardado.

## Colaboración visible con Claude

En la terminal integrada de Codex, desde este repositorio:

```bash
bash portal/revisar-con-claude.sh
```

Ejecuta Claude de forma interactiva y visible con la revisión preparada en modo solo lectura. La revisión inicial está resumida en `REVISION_CLAUDE.md`; no se presenta como una ejecución en vivo. El script no edita archivos ni utiliza credenciales del servidor.

## Calendario y feriados

- Sprints de lunes a domingo; revisiones presenciales los sábados.
- Reunión virtual de miércoles propuesta; otros horarios se acuerdan operativamente.
- Pausa Morazánica opcional del 5 al 11 de octubre de 2026, pendiente de acuerdo; el feriado legal del sector privado es del 7 al mediodía al 10 al mediodía. El aviso y su fuente están al final de las vistas de resumen y calendario.
- Si la pausa coincide, ocho sprints ocupan nueve semanas; no se agenda revisión el sábado 10.
- Si se desactiva la pausa completa, las reuniones que coinciden con el feriado aparecen marcadas para reprogramación; no se inventa recuperación de capacidad.
- Una fecha propia de tarea prevalece sobre la fecha del sprint y NO se desplaza automáticamente al modificar el calendario. Revisar esas fechas en cada ajuste.
- Los feriados precargados son únicamente de 2026. Los demás cierres deben acordarse y comprobarse.

## MySQL y despliegue posterior

El adaptador MySQL está implementado, pero no se conectó a RDS ni se desplegó esta versión. Requiere validación contra la instancia de pruebas antes de producción.

1. Preparar una base exclusiva y un usuario limitado a esa base. No utilizar las credenciales de afiliaciones. Configurar los valores de `portal/.env.example` en un archivo de entorno del servicio fuera del repositorio.
2. Permitir conexión desde el servidor y proporcionar la CA de MySQL. El adaptador exige TLS con verificación del certificado. `PORTAL_ORIGIN` debe coincidir exactamente con el origen HTTPS, sin ruta ni barra final.
3. Compilar con `pnpm --filter @occi/server build`. Ejecutar `pnpm portal:start` con el entorno configurado. El arranque crea de forma idempotente la tabla `macao_project_portal` en la base seleccionada y siembra los ocho entregables.
4. En el primer arranque, configurar las variables `PORTAL_ADMIN_*` para crear la cuenta de coordinación. Usar una contraseña real definida por el administrador y retirarla del archivo de entorno después. Si ya existen usuarios, el arranque no restablece sus contraseñas.
5. Usar un servicio systemd y subdominio propios. Proxy HTTPS hacia `127.0.0.1:3012`; no reutilizar el puerto 3001 ni las reglas de rutas del sistema de afiliaciones. Nginx debe reemplazar `X-Forwarded-For` con la IP del cliente o una cadena fiable. El servidor solo confía en proxy loopback.
6. Crear usuarios nominales desde Equipo y accesos, verificar sesiones y permisos en HTTPS y probar respaldo/restauración antes de usarlo operativamente.

### Persistencia inicial

La tabla InnoDB contiene un documento JSON de un proyecto con tareas, usuarios, sesiones con token hasheado, comentarios e historial. No es un conjunto de tablas normalizadas. Una transacción con `SELECT ... FOR UPDATE` confirma cada cambio junto con su evento; la versión de cada tarea rechaza ediciones concurrentes obsoletas con HTTP 409.

Esta elección permite mantener el mismo modelo entre el modo local y MySQL para un proyecto de tamaño pequeño. La primera versión limita el proyecto a 1000 tareas y 10000 comentarios. Antes de ampliar a muchos proyectos o un historial grande, normalizar tareas, usuarios, sesiones, comentarios y auditoría con índices y paginación. La API entrega los últimos 500 eventos; el registro completo permanece almacenado. Los hashes de contraseña y sesión nunca se devuelven en la API del proyecto ni en CSV.

El modo MySQL inicia un proyecto limpio: **no importa automáticamente los datos de demostración**. Si se decide conservar trabajo local, preparar una migración revisada que remapee autores y responsables a cuentas nominales, omita cuentas de demo y sesiones, y preserve referencias e historial. No copiar el JSON de demo directamente a producción.

### Seguridad y operación

Cookie propia HttpOnly, SameSite Strict y Secure en producción; sesión de ocho horas. Contraseñas con scrypt y sal individual; sesiones con SHA-256 del token. Los accesos se comprueban en cada operación y nuevamente dentro de cada transacción. Cambiar perfil, contraseña o desactivar un usuario revoca sus sesiones. El último administrador activo no puede desactivarse.

Las escrituras requieren un encabezado propio y rechazan orígenes ajenos. Los recursos estáticos se sirven por lista explícita, con CSP y sin exponer carpetas de datos. Las evidencias admiten solo HTTP/HTTPS sin credenciales embebidas. Los campos se escapan al mostrarse. El CSV protege celdas que podrían interpretarse como fórmulas.

Los movimientos de aceptación guardan autor, observación, criterio y enlace de evidencia de ese momento. El historial no se puede editar por API; administradores de base de datos conservan capacidad técnica de modificación, por lo que no constituye una bitácora criptográficamente inmutable.

La interfaz consulta cambios cada 30 segundos y al recuperar foco, excepto mientras hay formularios o detalles abiertos para conservar borradores. Una edición obsoleta muestra un conflicto y no sobrescribe el trabajo de otra persona. No hay notificaciones por correo, carga de archivos, WebSocket ni integración con el core en este MVP.

## Verificación

```bash
pnpm portal:test
pnpm build
pnpm test
```

Las pruebas de API usan archivos temporales aislados, incluyendo autenticación real y permisos sin conectar MySQL. Las pruebas del calendario cubren pausa, capacidad reducida, límites de fecha e inicio relativo. Las comprobaciones del adaptador MySQL no sustituyen una prueba de integración en una base de ensayo.
