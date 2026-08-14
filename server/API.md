# API local del demo AFPC

Base URL: `http://127.0.0.1:3001/api`

Todo el contenido seed es sintético. El análisis general de expedientes no envía
archivos a Gemini: ubica evidencia primero en la capa de texto del PDF y, para
escaneos, utiliza reconocimiento óptico local con Vision en macOS. La ruta específica de
prellenado sí puede enviar el PDF sintético a Gemini cuando existe autorización
explícita; nunca persiste el archivo ni registra su contenido.

## Endpoints principales

| Método | Ruta | Resultado |
| --- | --- | --- |
| `GET` | `/health` | Salud del servicio y disponibilidad de Gemini. |
| `GET` | `/dashboard` | Métricas, estados y volumen sintético. |
| `GET` | `/demo/application-prefill-sample` | Descarga una solicitud PDF sintética de dos páginas. |
| `POST` | `/application-prefill` | Extrae campos de una solicitud PDF para prellenar el formulario. |
| `GET` | `/cases` | Bandeja filtrable por `status` y `search`. |
| `POST` | `/cases` | Crea un caso sintético. |
| `GET` / `PATCH` | `/cases/:id` | Consulta o actualiza datos canónicos. |
| `POST` | `/cases/:id/actions` | Ejecuta `return`, `correct`, `escalate`, `approve`, `ready-core` o `archive`. |
| `POST` | `/cases/:id/revalidate` | Ejecuta nuevamente las reglas determinísticas. |
| `POST` | `/cases/:id/demo-correction` | Corrige el año faltante del escenario demo. |
| `GET` | `/cases/:id/core-payload` | Prepara un payload en modo simulación. |
| `GET` | `/cases/:id/contract` | Genera el contrato sintético en PDF. |
| `POST` | `/cases/:id/ai-summary` | Genera un resumen orientativo con Gemini o fallback. |
| `POST` | `/cases/:id/documents` | Carga un documento local declarado como sintético. |
| `GET` | `/cases/:id/documents/:documentId/content` | Genera un PDF seed sintético o devuelve un archivo sintético cargado. |

Para `approve`, el body general es `{ action, actor, note?, role? }`. Cuando el
caso está en `ESCALADO_CUMPLIMIENTO`, la API exige `role: "CUMPLIMIENTO"` y una
`note` no vacía. Un usuario de Afiliaciones o un request sin rol recibe `403`.

## Prellenado de una nueva solicitud

`POST /application-prefill` recibe `multipart/form-data` con:

- `file`: un PDF de hasta 8 MB y 20 páginas;
- `synthetic=true`: declaración obligatoria de que no contiene datos reales;
- `allowAiProcessing=true`: autorización para enviar a Gemini un PDF que no sea
  la muestra oficial conocida.

Se validan MIME, firma `%PDF-`, cierre del documento, páginas reconocibles y
ausencia de cifrado. El archivo se procesa únicamente en memoria. La respuesta
incluye `provider: "gemini" | "local"`, metadatos SHA-256, 15 campos con
confianza, página y evidencia, `formPatch`, alertas y el indicador obligatorio
`requiresHumanReview: true`.

Si Gemini no está configurado o no responde, la muestra oficial se resuelve con
un extractor local determinístico. Para cualquier PDF desconocido el respaldo
local deja los campos vacíos; nunca reutiliza ni inventa valores de la muestra.
Los valores de `formPatch` respetan las opciones canónicas del formulario,
mientras las etiquetas y valores de presentación se mantienen en español.

## Document Intelligence

### Vista previa idempotente

```http
GET /api/cases/case-001/ai-insights
```

Devuelve el resultado persistido cuando la huella del caso coincide. Si no hay
resultado persistido, genera una vista previa determinística local sin mutar el
caso. El header `x-ai-cache` indica `hit` o `miss`.

### Generar y persistir

```http
POST /api/cases/case-001/ai-insights
POST /api/cases/case-001/ai-insights/reanalyze
```

Ambas rutas comparten comportamiento idempotente. Si documentos, datos, reglas
y estado no cambiaron, devuelven la misma `analysis.id` y no duplican el evento
de auditoría. Ante una nueva huella, ejecutan Gemini estructurado cuando está
configurado; cualquier error o ausencia de clave cae al análisis local completo.

### Contrato de respuesta

```ts
interface DocumentIntelligenceResponse {
  analysis: {
    id: string;
    fingerprint: string;
    engineVersion: string;
    generatedAt: string;
    provider: 'gemini' | 'local-fallback';
    configured: boolean;
    cached: boolean;
    syntheticOnly: true;
    mode: 'document-pipeline-demo';
    dataOrigin: 'synthetic-canonical-snapshot';
    extractionMethod: 'template-mapped-canonical-data';
    notOcrNotice: string;
    confidenceNotice: string;
  };
  pipeline: Array<{
    id: string;
    label: string;
    status: 'completed';
    durationMs: number;
    itemsProcessed: number;
  }>;
  metrics: {
    documentsProcessed: number;
    fieldsExtracted: number;
    averageConfidence: number;       // 0..1
    consistencyRate: number;         // 0..1
    anomaliesDetected: number;
    estimatedManualMinutes: number;  // hipótesis sintética
    estimatedAutomatedSeconds: number;
    estimatedMinutesSaved: number;
  };
  executiveSummary: string;
  documents: Array<{
    documentId: string;
    name: string;
    predictedType: string;
    label: string;
    confidence: number;
    method: 'synthetic-template' | 'metadata-inference';
    source: 'seed-synthetic-metadata' | 'uploaded-synthetic-metadata';
    contentUrl: string;
    pages: number;
    quality: {
      readability: number;
      completeness: number;
      orientation: 'upright' | 'rotated' | 'unknown';
    };
  }>;
  extractedFields: Array<{
    id: string;
    documentId: string;
    documentType: string;
    field: string;
    label: string;
    value: string | number | boolean | null;
    confidence: number;
    page: number;
    evidence: string;
    boundingBox?: { x: number; y: number; width: number; height: number };
    evidenceLocation: 'verified-pdf-text' | 'unavailable';
    status: 'EXTRACTED' | 'MISSING' | 'LOW_CONFIDENCE' | 'CONFLICT';
    origin: 'synthetic-canonical-template';
  }>;
  consistency: Array<{
    field: string;
    label: string;
    verdict: 'MATCH' | 'MISMATCH' | 'MISSING' | 'REVIEW';
    confidence: number;
    explanation: string;
    sources: Array<{
      documentType: string;
      documentId: string;
      value: string | number | boolean | null;
      confidence: number;
    }>;
  }>;
  anomalies: Array<{
    id: string;
    severity: 'low' | 'medium' | 'high';
    category: string;
    title: string;
    explanation: string;
    evidenceRefs: string[];
    suggestedAction: string;
    ruleCode: string;
  }>;
  sourceOfFunds: {
    declaredSource: string;
    normalizedCategory: string;
    amount: number;
    currency: string;
    alignment: 'CONSISTENT' | 'REVIEW' | 'INSUFFICIENT';
    confidence: number;
    evidenceDocuments: string[];
    checks: Array<{
      code: string;
      label: string;
      status: 'PASS' | 'REVIEW' | 'FAIL';
      reason: string;
    }>;
    explanation: string;
    policyRef: string;
  };
  recommendation: {
    decision: 'CONTINUE' | 'SUBSANATE' | 'ESCALATE_COMPLIANCE' | 'HUMAN_REVIEW';
    label: string;
    confidence: number;
    humanDecisionRequired: true;
    rationale: string[];
    nextSteps: Array<{
      order: number;
      owner: string;
      action: string;
      reason: string;
    }>;
  };
  limitations: string[];
}
```

Las coordenadas están normalizadas en el rango `0..1`. `confidence` representa
confianza de extracción simulada y nunca equivale a cumplimiento, autenticidad,
aprobación o recomendación vinculante.

## Escenarios seed

- `case-001`: alta confianza general, pero falta el año en educación financiera;
  recomienda subsanar y enlaza el bloqueo con su evidencia y coordenadas.
- `case-002`: FATCA positiva y domicilio divergente; mantiene ruta de
  Cumplimiento aunque el aporte sea bajo.

## Privacidad y límites

- En el análisis general del expediente, Gemini recibe únicamente categorías,
  montos, códigos de regla, métricas y resultados sintéticos desidentificados.
- En el prellenado, Gemini recibe el PDF en memoria solo después de confirmar que
  es sintético y autorizar su procesamiento; la muestra oficial también está
  identificada por su huella SHA-256.
- Ningún PDF del prellenado se persiste o se incluye en registros. Solo se guarda
  posteriormente cuando el usuario crea el caso y decide adjuntarlo como fuente.
- Los PDFs seed son generados; el análisis local no afirma haberlos leído.
- Un comprobante demuestra un movimiento, no la procedencia de fondos.
- La decisión final siempre corresponde a una persona autorizada.
