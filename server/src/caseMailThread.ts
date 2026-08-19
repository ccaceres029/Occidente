export interface MissingDocumentDescriptor {
  requirementType: string;
  label: string;
}

export interface MissingDocumentsMessage {
  subject: string;
  text: string;
  html: string;
}

const CASE_CODE_PATTERN = /\bAFPC-\d{8}-\d{5,}\b/iu;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function extractCaseCode(subject: string): string | undefined {
  return subject.match(CASE_CODE_PATTERN)?.[0].toUpperCase();
}

export function parsedMailReferences(input: {
  inReplyTo?: string;
  references?: string[] | string;
}): string[] {
  const references = Array.isArray(input.references)
    ? input.references
    : input.references
      ? [input.references]
      : [];
  return [...new Set([input.inReplyTo, ...references].filter((value): value is string => Boolean(value)))]
    .map((value) => value.slice(0, 255));
}

export function buildMissingDocumentsMessage(
  caseCode: string,
  recipientName: string | undefined,
  missing: MissingDocumentDescriptor[],
): MissingDocumentsMessage {
  const labels = missing.map((item) => item.label);
  const subject = labels.length === 1
    ? `${caseCode} | Completar: ${labels[0]}`
    : `${caseCode} | Completar documentos pendientes`;
  const greeting = recipientName?.trim() ? `Estimado/a ${recipientName.trim()},` : 'Estimado/a afiliado/a,';
  const listText = labels.map((label) => `- ${label}`).join('\n');
  const listHtml = labels.map((label) => `<li>${escapeHtml(label)}</li>`).join('');
  return {
    subject,
    text: [
      greeting,
      '',
      `Al revisar la matriz documental del caso ${caseCode}, identificamos que falta completar:`,
      listText,
      '',
      'Responda a este mismo correo y adjunte el documento pendiente. Mantenga el código del caso en el asunto para incorporarlo automáticamente al expediente.',
      '',
      'Este aviso confirma únicamente la recepción de documentos; no valida su contenido ni autenticidad.',
      '',
      'AFPC Occidente',
    ].join('\n'),
    html: [
      `<p>${escapeHtml(greeting)}</p>`,
      `<p>Al revisar la matriz documental del caso <strong>${escapeHtml(caseCode)}</strong>, identificamos que falta completar:</p>`,
      `<ul>${listHtml}</ul>`,
      '<p>Responda a este mismo correo y adjunte el documento pendiente. Mantenga el código del caso en el asunto para incorporarlo automáticamente al expediente.</p>',
      '<p><small>Este aviso confirma únicamente la recepción de documentos; no valida su contenido ni autenticidad.</small></p>',
      '<p>AFPC Occidente</p>',
    ].join(''),
  };
}
