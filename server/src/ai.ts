import type { AfpcCase, AiSummary } from './types.js';
import type { GeminiConfig } from './config.js';

function localSummary(afpcCase: AfpcCase, configured: boolean): AiSummary {
  const errors = afpcCase.validations.filter((item) => item.severity === 'error');
  const warnings = afpcCase.validations.filter((item) => item.severity === 'warning');
  const decision =
    errors.length > 0
      ? `El expediente requiere subsanar ${errors.length} ${errors.length === 1 ? 'validación obligatoria' : 'validaciones obligatorias'}.`
      : afpcCase.risk.route === 'CUMPLIMIENTO'
        ? 'El expediente está documentalmente completo y requiere decisión de Cumplimiento.'
        : 'El expediente puede continuar a decisión humana de aprobación.';
  const attention = [...errors, ...warnings]
    .slice(0, 3)
    .map((item) => item.title.toLowerCase())
    .join(', ');

  return {
    provider: 'local-fallback',
    configured,
    summary: `${decision} Riesgo ${afpcCase.risk.level.toLowerCase()} (${afpcCase.risk.score}/100), ruta ${afpcCase.risk.route.toLowerCase().replaceAll('_', ' ')}.${attention ? ` Puntos de atención: ${attention}.` : ''} La decisión final corresponde a un analista autorizado.`,
    generatedAt: new Date().toISOString(),
  };
}

interface GeminiResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

function looksComplete(summary: string, finishReason?: string): boolean {
  if (finishReason && finishReason !== 'STOP') return false;
  return summary.length >= 80 && /[.!?…]["')\]]?$/u.test(summary);
}

function limitSummary(text: string, maximumWords = 100): string {
  const normalized = text.replaceAll('**', '').replaceAll(/\s+/gu, ' ').trim();
  const words = normalized.split(' ');
  if (words.length <= maximumWords) return words.join(' ');
  const prefix = words.slice(0, maximumWords).join(' ');
  const finalSentence = Math.max(
    prefix.lastIndexOf('.'),
    prefix.lastIndexOf('!'),
    prefix.lastIndexOf('?'),
  );
  if (finalSentence >= Math.floor(prefix.length * 0.6)) {
    return prefix.slice(0, finalSentence + 1);
  }
  return `${words.slice(0, maximumWords - 7).join(' ')}… La decisión final siempre es humana.`;
}

const containsEnglishOperationalTerms = (value: string) =>
  /\b(?:workflow|pipeline|fallback|snapshot|checklist|screening|review|missing|match|mismatch|source|funds|compliance|approved|rejected|score|risk|high|medium|low|warning|customer|case|document|field|ready|standard)\b/iu.test(value);

export async function summarizeCase(
  afpcCase: AfpcCase,
  config: GeminiConfig,
): Promise<AiSummary> {
  if (!config.apiKey) return localSummary(afpcCase, false);

  const safeSnapshot = {
    aviso: 'Todos los datos son sintéticos y pertenecen a un demo local.',
    referencia: afpcCase.reference,
    estado: afpcCase.statusLabel,
    producto: afpcCase.product.plan,
    monto: `${afpcCase.product.currency} ${afpcCase.product.contributionAmount}`,
    procedencia: afpcCase.product.sourceOfFunds,
    riesgo: afpcCase.risk,
    alertas: afpcCase.validations.map(({ severity, title, message }) => ({
      severidad: severity,
      titulo: title,
      mensaje: message,
    })),
  };
  const prompt = [
    'Resume este expediente SINTÉTICO de afiliación AFPC en máximo 90 palabras.',
    'Explica completitud, riesgo, ruta sugerida y siguiente acción.',
    'No apruebes ni rechaces; la decisión siempre es humana. Responde únicamente en español profesional de Honduras, traduce los códigos internos y no uses términos operativos en inglés.',
    JSON.stringify(safeSnapshot),
  ].join('\n');

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': config.apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 512,
            ...(config.model.startsWith('gemini-2.5')
              ? { thinkingConfig: { thinkingBudget: 0 } }
              : {}),
          },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) return localSummary(afpcCase, true);
    const payload = (await response.json()) as GeminiResponse;
    const candidate = payload.candidates?.[0];
    const summary = candidate?.content?.parts
      ?.map((part) => part.text ?? '')
      .join(' ')
      .trim();
    if (!summary || !looksComplete(summary, candidate?.finishReason) || containsEnglishOperationalTerms(summary)) {
      return localSummary(afpcCase, true);
    }
    return {
      provider: 'gemini',
      configured: true,
      summary: limitSummary(summary),
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return localSummary(afpcCase, true);
  }
}
