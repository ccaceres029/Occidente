import type { GeminiConfig } from './config.js';
import { REQUIRED_DOCUMENTS } from './rules.js';

export const DOCUMENT_COMPLETENESS_VERSION = 'document-completeness-1.0.0';

export interface CompletenessDocument {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export interface DocumentCompletenessItem {
  requirementType: string;
  label: string;
  status: 'PRESENT' | 'MISSING';
  matchedDocumentId?: string;
  confidence: number;
  reason: string;
  policyRef: string;
}

export interface DocumentCompletenessAnalysis {
  status: 'COMPLETE' | 'MISSING_DOCUMENTS';
  provider: 'gemini' | 'deterministic';
  geminiConfigured: boolean;
  completenessPercent: number;
  expectedCount: number;
  receivedCount: number;
  missingCount: number;
  unclassifiedCount: number;
  summary: string;
  model?: string;
  version: string;
  analyzedAt: string;
  items: DocumentCompletenessItem[];
}

const normalizedName = (filename: string) => filename
  .normalize('NFD')
  .replaceAll(/[\u0300-\u036f]/gu, '')
  .toLocaleLowerCase('es-HN');

export function inferReceivedDocumentType(filename: string): string | undefined {
  const name = normalizedName(filename);
  if (/solicitud|afiliacion|afilicion/u.test(name)) return 'AFFILIATION_FORM';
  if (/identidad|\bdni\b/u.test(name)) return 'IDENTITY';
  if (/\brtn\b|registro tributario/u.test(name)) return 'RTN';
  if (/comprobante.*aporte|aporte.*comprobante|deposito/u.test(name)) return 'CONTRIBUTION_RECEIPT';
  if (/educacion financiera|constancia.*financiera/u.test(name)) return 'FINANCIAL_EDUCATION';
  if (/fatca|autocertificacion/u.test(name)) return 'FATCA';
  if (/contrato/u.test(name)) return 'CONTRACT';
  return undefined;
}

function deterministicSummary(items: DocumentCompletenessItem[], receivedCount: number): string {
  const missing = items.filter((item) => item.status === 'MISSING').map((item) => item.label);
  if (!missing.length) {
    return `Se recibieron los ${receivedCount} tipos documentales requeridos por la matriz vigente. Este control confirma recepción, no contenido ni autenticidad.`;
  }
  return `Se recibieron ${receivedCount} de ${items.length} tipos documentales requeridos. Pendiente: ${missing.join(', ')}. Debe completarse el paquete antes de continuar.`;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

function geminiText(payload: GeminiResponse): string | undefined {
  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join(' ')
    .replaceAll('**', '')
    .replaceAll(/\s+/gu, ' ')
    .trim();
  if (!text || text.length < 40 || text.length > 600) return undefined;
  return text;
}

export async function analyzeDocumentCompleteness(
  documents: CompletenessDocument[],
  config: GeminiConfig,
): Promise<DocumentCompletenessAnalysis> {
  const classified = documents.map((document) => ({
    document,
    type: inferReceivedDocumentType(document.filename),
  }));
  const items: DocumentCompletenessItem[] = REQUIRED_DOCUMENTS.map((requirement) => {
    const match = classified.find((candidate) => candidate.type === requirement.type);
    return {
      requirementType: requirement.type,
      label: requirement.label,
      status: match ? 'PRESENT' : 'MISSING',
      ...(match ? { matchedDocumentId: match.document.id } : {}),
      confidence: match ? 0.99 : 1,
      reason: match
        ? `Se identificó un archivo recibido como ${requirement.label.toLowerCase()}.`
        : `No se identificó ${requirement.label.toLowerCase()} entre los adjuntos.`,
      policyRef: 'Matriz documental demo v0.1',
    };
  });
  const receivedCount = items.filter((item) => item.status === 'PRESENT').length;
  const missingCount = items.length - receivedCount;
  const base: DocumentCompletenessAnalysis = {
    status: missingCount ? 'MISSING_DOCUMENTS' : 'COMPLETE',
    provider: 'deterministic',
    geminiConfigured: config.configured,
    completenessPercent: Math.round((receivedCount / items.length) * 100),
    expectedCount: items.length,
    receivedCount,
    missingCount,
    unclassifiedCount: classified.filter((item) => !item.type).length,
    summary: deterministicSummary(items, receivedCount),
    version: DOCUMENT_COMPLETENESS_VERSION,
    analyzedAt: new Date().toISOString(),
    items,
  };
  if (!config.apiKey) return base;

  const safeSnapshot = {
    aviso: 'Solo se incluyen tipos documentales anonimizados; no hay nombres, contenido ni identificadores.',
    matriz: items.map(({ requirementType, label, status }) => ({ requirementType, label, status })),
    tiposClasificados: classified.map((item, index) => ({
      archivo: index + 1,
      tipo: item.type || 'NO_CLASIFICADO',
    })),
    resultadoDeterministico: {
      porcentaje: base.completenessPercent,
      recibidos: base.receivedCount,
      esperados: base.expectedCount,
      faltantes: items.filter((item) => item.status === 'MISSING').map((item) => item.label),
    },
  };
  const prompt = [
    'Redacta en español profesional de Honduras un resumen breve del control de recepción documental AFPC.',
    'No cambies el porcentaje ni la lista de faltantes calculados. No evalúes autenticidad, calidad, firmas ni contenido.',
    'Indica claramente que es una comparación contra la matriz documental y que cualquier faltante requiere completar el paquete.',
    'Responde solo con un párrafo de máximo 70 palabras.',
    JSON.stringify(safeSnapshot),
  ].join('\n');

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 300 },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) return base;
    const summary = geminiText((await response.json()) as GeminiResponse);
    if (!summary) return base;
    return { ...base, provider: 'gemini', summary, model: config.model };
  } catch {
    return base;
  }
}
