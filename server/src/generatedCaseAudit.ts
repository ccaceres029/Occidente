export type GeneratedCaseAuditActorType = 'PERSON' | 'SYSTEM' | 'EXTERNAL' | 'AI';
export type GeneratedCaseAuditStatus = 'COMPLETED' | 'PENDING' | 'ERROR' | 'INFO';

export interface GeneratedCaseAuditEvent {
  id: string;
  type: string;
  label: string;
  detail: string;
  actor: string;
  actorType: GeneratedCaseAuditActorType;
  status: GeneratedCaseAuditStatus;
  createdAt: string;
}

export interface GeneratedCaseAuditSource {
  id: string;
  code: string;
  subject: string;
  senderName?: string;
  senderEmail?: string;
  receivedAt: string;
  createdAt: string;
  sourceMovedAt?: string;
  documents: Array<{
    id: string;
    filename: string;
    sizeBytes: number;
    createdAt: string;
  }>;
  documentAnalysis?: {
    status: 'COMPLETE' | 'MISSING_DOCUMENTS';
    provider: 'gemini' | 'deterministic';
    model?: string;
    completenessPercent: number;
    expectedCount: number;
    receivedCount: number;
    missingCount: number;
    analyzedAt: string;
  };
  intelligence?: {
    status: 'ANALYZING' | 'COMPLETE' | 'ERROR';
    model?: string;
    analyzedAt?: string;
    updatedAt?: string;
    error?: string;
    riskLevel?: string;
    riskScore?: number;
  };
  mailEvents: Array<{
    id: string;
    direction: string;
    eventType: string;
    subject: string;
    counterpartyEmail?: string;
    status: string;
    error?: string;
    createdAt: string;
    sentAt?: string;
    updatedAt: string;
  }>;
  finalizedAt?: string;
  finalizedBy?: string;
}

function documentSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_024 / 1_024).toFixed(2)} MB`;
}

function mailStatus(status: string): GeneratedCaseAuditStatus {
  if (status === 'ERROR') return 'ERROR';
  if (status === 'PENDING') return 'PENDING';
  return 'COMPLETED';
}

export function buildGeneratedCaseAuditTrail(source: GeneratedCaseAuditSource): GeneratedCaseAuditEvent[] {
  const events: GeneratedCaseAuditEvent[] = [
    {
      id: `received-${source.id}`,
      type: 'EMAIL_RECEIVED',
      label: 'Correo recibido en la bandeja',
      detail: `Se recibió la solicitud “${source.subject}” y se inició su trazabilidad.`,
      actor: source.senderName || source.senderEmail || 'Remitente externo',
      actorType: 'EXTERNAL',
      status: 'COMPLETED',
      createdAt: source.receivedAt,
    },
    {
      id: `created-${source.id}`,
      type: 'CASE_CREATED',
      label: 'Caso generado automáticamente',
      detail: `El portal asignó el código ${source.code} y vinculó el correo original al expediente.`,
      actor: 'Automatización IMAP',
      actorType: 'SYSTEM',
      status: 'COMPLETED',
      createdAt: source.createdAt,
    },
  ];

  for (const document of source.documents) {
    events.push({
      id: `document-${document.id}`,
      type: 'DOCUMENT_STORED',
      label: 'Documento almacenado y relacionado',
      detail: `${document.filename} · ${documentSize(document.sizeBytes)} · Integridad SHA-256 registrada.`,
      actor: 'Almacenamiento S3',
      actorType: 'SYSTEM',
      status: 'COMPLETED',
      createdAt: document.createdAt,
    });
  }

  if (source.sourceMovedAt) {
    events.push({
      id: `source-moved-${source.id}`,
      type: 'SOURCE_EMAIL_MOVED',
      label: 'Correo original movido a Papelera',
      detail: 'SiteGround confirmó el movimiento después de guardar el expediente y sus documentos.',
      actor: 'Automatización IMAP',
      actorType: 'SYSTEM',
      status: 'COMPLETED',
      createdAt: source.sourceMovedAt,
    });
  }

  for (const mail of source.mailEvents) {
    if (mail.eventType === 'ORIGINAL_RECEIVED') continue;
    const outbound = mail.direction === 'OUTBOUND';
    const missingRequest = mail.eventType === 'MISSING_DOCUMENT_REQUEST';
    events.push({
      id: `mail-${mail.id}`,
      type: mail.eventType,
      label: missingRequest
        ? mail.status === 'ERROR' ? 'Error al solicitar documentos' : 'Solicitud de documentos enviada'
        : outbound ? 'Correo enviado desde el caso' : 'Respuesta incorporada al caso',
      detail: `${mail.subject}${mail.counterpartyEmail ? ` · ${outbound ? 'Destinatario' : 'Remitente'}: ${mail.counterpartyEmail}` : ''}${mail.error ? ` · ${mail.error}` : ''}`,
      actor: outbound ? 'Automatización SMTP' : mail.counterpartyEmail || 'Remitente externo',
      actorType: outbound ? 'SYSTEM' : 'EXTERNAL',
      status: mailStatus(mail.status),
      createdAt: mail.sentAt || mail.updatedAt || mail.createdAt,
    });
  }

  if (source.documentAnalysis) {
    const analysis = source.documentAnalysis;
    events.push({
      id: `document-analysis-${source.id}`,
      type: 'DOCUMENT_ANALYSIS',
      label: analysis.status === 'COMPLETE' ? 'Matriz documental completada' : 'Control documental ejecutado',
      detail: `${analysis.receivedCount} de ${analysis.expectedCount} documentos requeridos · ${analysis.completenessPercent}% completo${analysis.missingCount ? ` · ${analysis.missingCount} pendiente(s)` : ''}.`,
      actor: analysis.provider === 'gemini' ? `Gemini${analysis.model ? ` · ${analysis.model}` : ''}` : 'Motor documental determinístico',
      actorType: analysis.provider === 'gemini' ? 'AI' : 'SYSTEM',
      status: analysis.status === 'COMPLETE' ? 'COMPLETED' : 'INFO',
      createdAt: analysis.analyzedAt,
    });
  }

  if (source.intelligence) {
    const intelligence = source.intelligence;
    const createdAt = intelligence.analyzedAt || intelligence.updatedAt;
    if (createdAt) {
      events.push({
        id: `intelligence-${source.id}`,
        type: 'INTELLIGENCE_ANALYSIS',
        label: intelligence.status === 'COMPLETE'
          ? 'Análisis integral completado'
          : intelligence.status === 'ERROR' ? 'Análisis integral con incidencia' : 'Análisis integral iniciado',
        detail: intelligence.status === 'ERROR'
          ? intelligence.error || 'El motor informó una incidencia durante el análisis.'
          : `${intelligence.model || 'Motor de análisis'}${intelligence.riskLevel ? ` · Riesgo ${intelligence.riskLevel}${intelligence.riskScore !== undefined ? ` (${intelligence.riskScore})` : ''}` : ''}.`,
        actor: intelligence.model ? `Gemini · ${intelligence.model}` : 'Motor de análisis integral',
        actorType: 'AI',
        status: intelligence.status === 'ERROR' ? 'ERROR' : intelligence.status === 'ANALYZING' ? 'PENDING' : 'COMPLETED',
        createdAt,
      });
    }
  }

  if (source.finalizedAt) {
    events.push({
      id: `finalized-${source.id}`,
      type: 'CASE_FINALIZED',
      label: 'Caso aprobado y finalizado',
      detail: 'La decisión humana fue registrada y el expediente pasó a Casos finalizados.',
      actor: source.finalizedBy || 'Usuario autorizado',
      actorType: 'PERSON',
      status: 'COMPLETED',
      createdAt: source.finalizedAt,
    });
  }

  return events.sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
}
