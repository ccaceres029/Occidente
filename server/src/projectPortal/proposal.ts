// Base documental: Propuesta_Motor_Analisis_Portal_APEX_Occidente_v2.0.docx
export const proposal = {
  "version": "2.0",
  "model": "Gemini 3.5 Flash-Lite",
  "modelId": "gemini-3.5-flash-lite",
  "responsibilities": [
    [
      "Formularios y bandeja APEX",
      "Apoya contrato de datos",
      "Desarrolla y mantiene",
      "Define y valida operación"
    ],
    [
      "Integración al sistema central",
      "Entrega resultados a APEX",
      "Desarrolla y opera",
      "Valida registro final"
    ],
    [
      "Motor de análisis",
      "Desarrolla y prueba",
      "Facilita ambiente",
      "Valida resultados esperados"
    ],
    [
      "Portal administrativo",
      "Diseña y desarrolla pantallas y servicios",
      "Facilita accesos y red",
      "Designa administradores y valida uso"
    ],
    [
      "Reglas y matriz documental",
      "Implementa capacidad y configuración inicial",
      "Apoya integración",
      "Operaciones y Cumplimiento definen y aprueban"
    ],
    [
      "Cambios de reglas en operación",
      "Entrega herramientas y capacitación",
      "Apoya soporte técnico",
      "Administra y autoriza publicación"
    ],
    [
      "API e intercambio documental",
      "Implementa extremo del motor",
      "Implementa extremo APEX y acceso a documentos",
      "Valida recorrido y datos"
    ],
    [
      "Servidores y base de datos",
      "Define necesidades y despliega aplicación",
      "Provisiona, administra y respalda",
      "Coordina disponibilidad"
    ],
    [
      "Gemini y tratamiento de datos",
      "Integra y controla ejecución",
      "Habilita proyecto, cuotas y credenciales; mantiene vigente el modelo",
      "Autoriza con Seguridad los usos y datos"
    ],
    [
      "Auditoría",
      "Registra análisis y cambios del motor",
      "Registra acciones de APEX y resguarda registros",
      "Define retención y consulta"
    ],
    [
      "Pruebas integrales",
      "Prueba y corrige su componente",
      "Prueba y corrige su componente",
      "Ejecuta UAT y acepta funcionalmente"
    ],
    [
      "Puesta en producción",
      "Instala y verifica solución MACAO",
      "Autoriza y ejecuta controles del ambiente",
      "Autoriza inicio operativo"
    ],
    [
      "Incidentes y continuidad",
      "Atiende defectos cubiertos y soporte contratado",
      "Atiende APEX, red, base y respaldos",
      "Reporta impacto y prioriza"
    ]
  ],
  "infrastructure": [
    [
      "Servidor de producción",
      "VM aislada, preferiblemente Linux compatible; referencia inicial de 8 vCPU, 16 GB RAM y 150 GB SSD para aplicación, temporales y registros."
    ],
    [
      "Pruebas y UAT",
      "Ambiente separado; referencia de 4 vCPU, 8 GB RAM y 80 GB de disco. Accesos disponibles al iniciar la semana 2."
    ],
    [
      "Base de datos",
      "Servicio administrado por el banco y esquema o acceso por servicios para configuración, trabajos, resultados y auditoría. Motor, versión y mecanismo se acuerdan en semana 1."
    ],
    [
      "Documentos",
      "Repositorio privado del banco con acceso autenticado. Capacidad adicional según volumen y retención; limpieza de temporales definida."
    ],
    [
      "Red y acceso",
      "HTTPS entre APEX y el motor, DNS y certificado del portal, salida HTTPS hacia Gemini y acceso técnico por VPN o mecanismo autorizado."
    ],
    [
      "Operación",
      "Cuentas de servicio con permisos mínimos, gestión de secretos, monitoreo, respaldos y restauración. Políticas de retención y recuperación documentadas."
    ]
  ],
  "acceptance": [
    [
      "Recorrido integrado",
      "APEX envía un expediente, el motor lo analiza y APEX muestra resultados de la versión correcta."
    ],
    [
      "Análisis documental",
      "Contraste de campos, faltantes, reglas y evidencia con el conjunto de referencia aprobado; documentos ilegibles o inciertos requieren revisión."
    ],
    [
      "Autoadministración",
      "Un usuario autorizado modifica una regla, la prueba y publica desde el portal; un nuevo análisis la aplica y el anterior conserva su versión."
    ],
    [
      "Permisos y auditoría",
      "Se bloquean acciones sin permiso y se registran edición, publicación y reproceso con usuario y fecha."
    ],
    [
      "Errores y recuperación",
      "Duplicados, caída de Gemini, archivos inválidos y reintentos no producen aprobación implícita ni resultados asociados a otro expediente."
    ],
    [
      "Operación",
      "Instalación verificada, documentación entregada y prueba conjunta de respaldo y recuperación conforme al acta técnica."
    ]
  ],
  "scope": [
    "Motor de clasificación, extracción, completitud y consistencia documental.",
    "Portal administrativo propio desarrollado por MACAO: reglas, matrices, parámetros, permisos y auditoría.",
    "Borradores, pruebas, publicación y recuperación de versiones de reglas.",
    "API APEX para análisis, estados, resultados y reanálisis con trazabilidad.",
    "Instalación en el banco, documentación, dos capacitaciones y garantía correctiva de 30 días."
  ],
  "bankScope": [
    "Formularios, captura documental y bandeja de calidad en APEX.",
    "Decisión humana, flujo operativo e integración con el sistema central.",
    "Servidores, base de datos, repositorio documental, red y respaldos.",
    "Proyecto, credenciales, cuotas y consumo de Gemini."
  ],
  "modelContinuity": "El banco será responsable de monitorear los avisos de deprecación o retiro del modelo por Google y mantener un modelo vigente, habilitando y coordinando su sustitución antes de la fecha de retiro. El reemplazo deberá validarse con el motor antes de producción. Las adaptaciones de software o pruebas adicionales que requieran intervención de MACAO se evaluarán y acordarán por escrito bajo soporte o control de cambios."
} as const;
