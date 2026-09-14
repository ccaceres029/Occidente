#!/usr/bin/env bash
set -euo pipefail
portal_repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$portal_repo"
exec claude --safe-mode --permission-mode plan --tools 'Read,Glob,Grep' -- 'Revisa en modo solo lectura la primera implementacion del portal de tareas AFP Occidente. Trabajas en colaboracion con Codex, quien implementa y ejecuta pruebas. Lee portal/REVISION_CLAUDE.md, portal/portal.js, calendar.js y server/src/projectPortal. Revisa permisos, sesiones propias, CSRF, concurrencia, validacion AFP, perdida de cambios en UI, persistencia JSON/MySQL y calendario de sprints. Todo es compartido con AFP; no hay areas privadas ni archivos adjuntos, solo evidencia por enlace. No leas .env, secretos ni archivos en server/data. No edites ni ejecutes comandos. Da hallazgos concretos con archivo y razon, diferenciando bugs de mejoras. Esta revision debe ser visible en esta terminal. No despliegues ni conectes MySQL.'
