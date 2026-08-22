import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser, type Attachment, type ParsedMail } from 'mailparser';
import nodemailer from 'nodemailer';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import {
  buildMissingDocumentsMessage,
  extractCaseCode,
  parsedMailReferences,
} from './caseMailThread.js';
import type { GeminiConfig } from './config.js';
import {
  analyzeDocumentCompleteness,
  DOCUMENT_COMPLETENESS_VERSION,
  type DocumentCompletenessAnalysis,
  type DocumentCompletenessItem,
} from './documentCompleteness.js';
import {
  analyzeGeneratedCaseIntelligence,
  GENERATED_CASE_INTELLIGENCE_VERSION,
  generatedCaseIntelligenceFingerprint,
} from './generatedCaseIntelligence.js';
import { buildFinalizedCasesArchive } from './finalizedCaseExports.js';
import { buildGeneratedCaseAuditTrail, type GeneratedCaseAuditEvent } from './generatedCaseAudit.js';
import { ObjectStorage } from './objectStorage.js';
import { applyVerifiedBufferedPdfEvidence } from './pdfEvidenceLocator.js';
import type { DocumentIntelligenceInsight, RiskAssessment } from './types.js';

export interface MailSettings {
  emailAddress: string;
  username: string;
  incomingHost: string;
  incomingPort: number;
  incomingSecure: boolean;
  outgoingHost: string;
  outgoingPort: number;
  outgoingSecure: boolean;
  enabled: boolean;
  moveProcessedToTrash: boolean;
  hasPassword: boolean;
  lastSyncAt?: string;
  lastImapStatus: string;
  lastSmtpStatus: string;
  lastError?: string;
  updatedAt: string;
}

export interface MailSettingsInput {
  emailAddress: string;
  username: string;
  password?: string;
  incomingHost: string;
  incomingPort: number;
  incomingSecure: boolean;
  outgoingHost: string;
  outgoingPort: number;
  outgoingSecure: boolean;
  enabled: boolean;
  moveProcessedToTrash: boolean;
}

export interface IncomingRequest {
  id: string;
  messageId: string;
  mailboxUid: number;
  subject: string;
  senderName?: string;
  senderEmail?: string;
  receivedAt: string;
  snippet?: string;
  hasAttachments: boolean;
  attachmentCount: number;
  status: string;
  caseId?: string;
  caseCode?: string;
}

export interface GeneratedCaseDocument {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  checksumSha256: string;
  createdAt: string;
}

export interface GeneratedCaseSummary {
  id: string;
  code: string;
  status: string;
  subject: string;
  senderName?: string;
  senderEmail?: string;
  receivedAt: string;
  documentCount: number;
  createdAt: string;
  finalizedAt?: string;
  finalizedBy?: string;
  documentAnalysis?: DocumentCompletenessAnalysis;
  workflow: GeneratedCaseWorkflow;
  risk?: RiskAssessment;
}

export interface GeneratedCaseDetail extends GeneratedCaseSummary {
  incomingRequestId: string;
  documents: GeneratedCaseDocument[];
  auditTrail: GeneratedCaseAuditEvent[];
  missingDocumentRequest?: MissingDocumentRequestStatus;
  documentIntelligence?: DocumentIntelligenceInsight;
  intelligenceStatus?: GeneratedIntelligenceStatus;
}

export interface MailOperationalDashboard {
  source: 'mail-intake';
  synthetic: false;
  dataNotice: string;
  metrics: {
    total: number;
    inReview: number;
    returned: number;
    compliance: number;
    readyForCore: number;
    reprocessRate: number;
    avgCycleHours: number;
    estimatedHoursSaved: number;
    incomingTotal: number;
    generatedTotal: number;
    documentTotal: number;
    incomplete: number;
    analyzing: number;
    decisionPending: number;
    pendingGeneration: number;
  };
  byStatus: Array<{ status: string; label: string; count: number }>;
  volumeByDay: Array<{ date: string; label: string; count: number }>;
  recentCases: [];
  recentIncoming: IncomingRequest[];
  recentGeneratedCases: GeneratedCaseSummary[];
  alerts: Array<{ level: string; message: string; count: number }>;
}

export interface GeneratedCaseWorkflow {
  stage: 'DOCUMENT_INCOMPLETE' | 'READY_FOR_ANALYSIS' | 'ANALYZING' | 'DECISION_PENDING' | 'ANALYSIS_ERROR' | 'FINALIZED';
  label: string;
  progress: number;
}

export interface GeneratedIntelligenceStatus {
  status: 'ANALYZING' | 'COMPLETE' | 'ERROR';
  model?: string;
  analyzedAt?: string;
  error?: string;
}

export interface MissingDocumentRequestStatus {
  status: 'PENDING' | 'SENT' | 'ERROR';
  subject: string;
  recipientEmail?: string;
  sentAt?: string;
  error?: string;
}

interface SettingsRow extends RowDataPacket {
  email_address: string;
  username: string;
  incoming_host: string;
  incoming_port: number;
  incoming_secure: number;
  outgoing_host: string;
  outgoing_port: number;
  outgoing_secure: number;
  encrypted_password: string | null;
  enabled: number;
  move_processed_to_trash: number;
  last_sync_at: Date | null;
  last_imap_status: string;
  last_smtp_status: string;
  last_error: string | null;
  updated_at: Date;
}

interface IncomingRow extends RowDataPacket {
  id: string;
  message_id: string;
  mailbox_uid: number;
  subject: string;
  sender_name: string | null;
  sender_email: string | null;
  received_at: Date;
  snippet: string | null;
  has_attachments: number;
  attachment_count: number;
  status: string;
  case_id: string | null;
  case_code: string | null;
}

interface GeneratedCaseRow extends RowDataPacket {
  id: string;
  code: string;
  incoming_request_id: string;
  status: string;
  subject: string;
  sender_name: string | null;
  sender_email: string | null;
  received_at: Date;
  document_count: number;
  created_at: Date;
  finalized_at: Date | null;
  finalized_by: string | null;
  analysis_status: DocumentCompletenessAnalysis['status'] | null;
  analysis_provider: DocumentCompletenessAnalysis['provider'] | null;
  gemini_configured: number | null;
  completeness_percent: number | null;
  expected_count: number | null;
  received_count: number | null;
  missing_count: number | null;
  unclassified_count: number | null;
  analysis_summary: string | null;
  analysis_model: string | null;
  analysis_version: string | null;
  analyzed_at: Date | null;
  intelligence_status: GeneratedIntelligenceStatus['status'] | null;
  intelligence_model: string | null;
  intelligence_engine_version: string | null;
  intelligence_result: DocumentIntelligenceInsight | string | null;
  intelligence_error: string | null;
  intelligence_analyzed_at: Date | null;
  intelligence_updated_at: Date | null;
  risk_level: RiskAssessment['level'] | null;
  risk_score: number | null;
  risk_route: RiskAssessment['route'] | null;
}

interface GeneratedDocumentRow extends RowDataPacket {
  id: string;
  case_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  checksum_sha256: string;
  s3_bucket: string;
  s3_key: string;
  created_at: Date;
}

interface AnalysisItemRow extends RowDataPacket {
  requirement_type: string;
  label: string;
  status: DocumentCompletenessItem['status'];
  matched_document_id: string | null;
  confidence: string | number;
  reason: string;
  policy_ref: string;
}

interface StoredAnalysisRow extends RowDataPacket {
  status: DocumentCompletenessAnalysis['status'];
  provider: DocumentCompletenessAnalysis['provider'];
  gemini_configured: number;
  completeness_percent: number;
  expected_count: number;
  received_count: number;
  missing_count: number;
  unclassified_count: number;
  summary: string;
  model: string | null;
  analysis_version: string;
  analyzed_at: Date;
}

interface LinkedCaseRow extends RowDataPacket {
  id: string;
  code: string;
  sender_name: string | null;
  sender_email: string | null;
}

interface NotificationCaseRow extends LinkedCaseRow {
  trigger_message_id: string;
}

interface MailEventRow extends RowDataPacket {
  id: string;
  case_id: string;
  status: MissingDocumentRequestStatus['status'];
  subject: string;
  counterparty_email: string | null;
  sent_at: Date | null;
  error_message: string | null;
}

interface AuditMailEventRow extends RowDataPacket {
  id: string;
  direction: string;
  event_type: string;
  subject: string;
  counterparty_email: string | null;
  status: string;
  error_message: string | null;
  created_at: Date;
  sent_at: Date | null;
  updated_at: Date;
}

interface IncomingAuditSourceRow extends RowDataPacket {
  source_moved_at: Date | null;
}

interface StoredIntelligenceRow extends RowDataPacket {
  status: GeneratedIntelligenceStatus['status'];
  model: string | null;
  fingerprint: string;
  engine_version: string;
  result_json: DocumentIntelligenceInsight | string | null;
  error_message: string | null;
  analyzed_at: Date | null;
  risk_level: RiskAssessment['level'] | null;
  risk_score: number | null;
  risk_route: RiskAssessment['route'] | null;
}

interface OperationalSummaryRow extends RowDataPacket {
  incoming_total: number | string;
  generated_total: number | string;
  document_total: number | string;
  pending_generation: number | string;
  incomplete: number | string | null;
  ready_for_analysis: number | string | null;
  analyzing: number | string | null;
  decision_pending: number | string | null;
  analysis_error: number | string | null;
  compliance: number | string | null;
}

interface OperationalVolumeRow extends RowDataPacket {
  date: string | Date;
  count: number | string;
}

function publicSettings(row: SettingsRow): MailSettings {
  return {
    emailAddress: row.email_address,
    username: row.username,
    incomingHost: row.incoming_host,
    incomingPort: Number(row.incoming_port),
    incomingSecure: Boolean(row.incoming_secure),
    outgoingHost: row.outgoing_host,
    outgoingPort: Number(row.outgoing_port),
    outgoingSecure: Boolean(row.outgoing_secure),
    enabled: Boolean(row.enabled),
    moveProcessedToTrash: Boolean(row.move_processed_to_trash),
    hasPassword: Boolean(row.encrypted_password),
    ...(row.last_sync_at ? { lastSyncAt: row.last_sync_at.toISOString() } : {}),
    lastImapStatus: row.last_imap_status,
    lastSmtpStatus: row.last_smtp_status,
    ...(row.last_error ? { lastError: row.last_error } : {}),
    updatedAt: row.updated_at.toISOString(),
  };
}

function publicIncoming(row: IncomingRow): IncomingRequest {
  return {
    id: row.id,
    messageId: row.message_id,
    mailboxUid: Number(row.mailbox_uid),
    subject: row.subject,
    ...(row.sender_name ? { senderName: row.sender_name } : {}),
    ...(row.sender_email ? { senderEmail: row.sender_email } : {}),
    receivedAt: row.received_at.toISOString(),
    ...(row.snippet ? { snippet: row.snippet } : {}),
    hasAttachments: Boolean(row.has_attachments),
    attachmentCount: Number(row.attachment_count),
    status: row.status,
    ...(row.case_id ? { caseId: row.case_id } : {}),
    ...(row.case_code ? { caseCode: row.case_code } : {}),
  };
}

function publicGeneratedCase(row: GeneratedCaseRow): GeneratedCaseSummary {
  const workflow: GeneratedCaseWorkflow = row.finalized_at
    ? { stage: 'FINALIZED', label: 'Caso finalizado', progress: 100 }
    : row.analysis_status !== 'COMPLETE'
    ? { stage: 'DOCUMENT_INCOMPLETE', label: 'Control documental', progress: 33 }
    : row.intelligence_status === 'ANALYZING'
      ? { stage: 'ANALYZING', label: 'Análisis en curso', progress: 68 }
      : row.intelligence_status === 'COMPLETE'
        ? { stage: 'DECISION_PENDING', label: 'Decisión pendiente', progress: 90 }
        : row.intelligence_status === 'ERROR'
          ? { stage: 'ANALYSIS_ERROR', label: 'Revisar análisis', progress: 55 }
          : { stage: 'READY_FOR_ANALYSIS', label: 'Listo para analizar', progress: 45 };
  const generatedCase: GeneratedCaseSummary = {
    id: row.id,
    code: row.code,
    status: row.status,
    subject: row.subject,
    ...(row.sender_name ? { senderName: row.sender_name } : {}),
    ...(row.sender_email ? { senderEmail: row.sender_email } : {}),
    receivedAt: row.received_at.toISOString(),
    documentCount: Number(row.document_count),
    createdAt: row.created_at.toISOString(),
    ...(row.finalized_at ? { finalizedAt: row.finalized_at.toISOString() } : {}),
    ...(row.finalized_by ? { finalizedBy: row.finalized_by } : {}),
    workflow,
  };
  if (row.risk_level && row.risk_route && row.risk_score !== null) {
    generatedCase.risk = {
      level: row.risk_level,
      score: Number(row.risk_score),
      route: row.risk_route,
      reasons: [],
    };
  }
  if (row.analysis_status && row.analysis_provider && row.analyzed_at) {
    generatedCase.documentAnalysis = {
      status: row.analysis_status,
      provider: row.analysis_provider,
      geminiConfigured: Boolean(row.gemini_configured),
      completenessPercent: Number(row.completeness_percent),
      expectedCount: Number(row.expected_count),
      receivedCount: Number(row.received_count),
      missingCount: Number(row.missing_count),
      unclassifiedCount: Number(row.unclassified_count),
      summary: row.analysis_summary || '',
      ...(row.analysis_model ? { model: row.analysis_model } : {}),
      version: row.analysis_version || DOCUMENT_COMPLETENESS_VERSION,
      analyzedAt: row.analyzed_at.toISOString(),
      items: [],
    };
  }
  return generatedCase;
}

function numberValue(value: number | string | null | undefined): number {
  return Number(value || 0);
}

export function shouldRunAutomaticAnalysis(
  enabled: boolean,
  analysis?: Pick<DocumentCompletenessAnalysis, 'status' | 'completenessPercent'>,
): boolean {
  return enabled && analysis?.status === 'COMPLETE' && analysis.completenessPercent === 100;
}

export function findTrashMailboxPath(
  mailboxes: Array<{ path: string; specialUse?: string }>,
): string | undefined {
  return mailboxes.find((mailbox) => mailbox.specialUse === '\\Trash')?.path;
}

export function buildMailOperationalDashboard(
  summary: OperationalSummaryRow,
  volumeRows: OperationalVolumeRow[],
  recentIncoming: IncomingRequest[],
  recentGeneratedCases: GeneratedCaseSummary[],
  now = new Date(),
): MailOperationalDashboard {
  const incomingTotal = numberValue(summary.incoming_total);
  const generatedTotal = numberValue(summary.generated_total);
  const documentTotal = numberValue(summary.document_total);
  const pendingGeneration = numberValue(summary.pending_generation);
  const incomplete = numberValue(summary.incomplete);
  const readyForAnalysis = numberValue(summary.ready_for_analysis);
  const analyzing = numberValue(summary.analyzing);
  const decisionPending = numberValue(summary.decision_pending);
  const analysisError = numberValue(summary.analysis_error);
  const compliance = numberValue(summary.compliance);
  const countsByDate = new Map(
    volumeRows.map((row) => [
      row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date).slice(0, 10),
      numberValue(row.count),
    ]),
  );
  const daysToShow = 14;
  const volumeByDay = Array.from({ length: daysToShow }, (_unused, index) => {
    const day = new Date(now);
    day.setUTCHours(12, 0, 0, 0);
    day.setUTCDate(day.getUTCDate() - (daysToShow - 1 - index));
    const date = day.toISOString().slice(0, 10);
    return {
      date,
      label: day.toLocaleDateString('es-HN', { day: '2-digit', month: 'short', timeZone: 'UTC' }).replace('.', ''),
      count: countsByDate.get(date) || 0,
    };
  });

  return {
    source: 'mail-intake',
    synthetic: false,
    dataNotice: 'Indicadores calculados desde solicitudes entrantes y casos generados.',
    metrics: {
      total: incomingTotal,
      inReview: readyForAnalysis + analyzing,
      returned: incomplete,
      compliance,
      readyForCore: decisionPending,
      reprocessRate: generatedTotal ? Math.round((incomplete / generatedTotal) * 1_000) / 10 : 0,
      avgCycleHours: 0,
      estimatedHoursSaved: Math.round((documentTotal * 4.5 / 60) * 10) / 10,
      incomingTotal,
      generatedTotal,
      documentTotal,
      incomplete,
      analyzing,
      decisionPending,
      pendingGeneration,
    },
    byStatus: [
      { status: 'DOCUMENT_INCOMPLETE', label: 'Control documental', count: incomplete },
      { status: 'READY_FOR_ANALYSIS', label: 'Listos para analizar', count: readyForAnalysis },
      { status: 'ANALYZING', label: 'Análisis en curso', count: analyzing },
      { status: 'DECISION_PENDING', label: 'Decisión pendiente', count: decisionPending },
      { status: 'ANALYSIS_ERROR', label: 'Revisar análisis', count: analysisError },
    ],
    volumeByDay,
    recentCases: [],
    recentIncoming,
    recentGeneratedCases,
    alerts: [
      { level: 'warning', message: 'Casos con documentación incompleta', count: incomplete },
      { level: 'danger', message: 'Casos que requieren revisar el análisis', count: analysisError },
      { level: 'info', message: 'Casos dirigidos a Cumplimiento', count: compliance },
    ],
  };
}

function publicGeneratedDocument(row: GeneratedDocumentRow): GeneratedCaseDocument {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    checksumSha256: row.checksum_sha256,
    createdAt: row.created_at.toISOString(),
  };
}

function parseIntelligence(value: GeneratedCaseRow['intelligence_result']): DocumentIntelligenceInsight | undefined {
  if (!value) return undefined;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value) as DocumentIntelligenceInsight;
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function caseDate(receivedAt: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Tegucigalpa',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(receivedAt);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function safeAttachmentName(attachment: Attachment, index: number): string {
  const source = attachment.filename?.trim() || `adjunto-${index + 1}`;
  const normalized = source.normalize('NFD').replaceAll(/[\u0300-\u036f]/gu, '');
  const safe = normalized.replaceAll(/[^a-zA-Z0-9._-]+/gu, '-').replaceAll(/^-+|-+$/gu, '').slice(0, 180);
  return `${String(index + 1).padStart(3, '0')}-${safe || `adjunto-${index + 1}`}`;
}

function encryptSecret(value: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}

function decryptSecret(value: string, key: Buffer): string {
  const [iv, tag, encrypted] = value.split('.').map((part) => Buffer.from(part, 'base64url'));
  if (!iv || !tag || !encrypted) throw new Error('La credencial de correo cifrada no es válida.');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export class MailService {
  private syncing = false;
  private readonly intelligenceRuns = new Map<string, Promise<void>>();

  constructor(
    private readonly pool: Pool,
    private readonly credentialsKey?: Buffer,
    private readonly objectStorage?: ObjectStorage,
    private readonly geminiConfig: GeminiConfig = { model: 'gemini-2.5-flash-lite', configured: false, source: 'none' },
  ) {}

  get storageConfigured(): boolean {
    return Boolean(this.objectStorage);
  }

  async getSettings(): Promise<MailSettings> {
    return publicSettings(await this.settingsRow());
  }

  async updateSettings(input: MailSettingsInput, actor: string): Promise<MailSettings> {
    const password = input.password?.trim();
    if (password && !this.credentialsKey) {
      throw new Error('El servidor no tiene configurada la llave para cifrar credenciales de correo.');
    }
    const encryptedPassword = password ? encryptSecret(password, this.credentialsKey as Buffer) : undefined;
    await this.pool.query(
      `UPDATE email_settings SET
        email_address=?, username=?, incoming_host=?, incoming_port=?, incoming_secure=?,
        outgoing_host=?, outgoing_port=?, outgoing_secure=?, enabled=?, move_processed_to_trash=?,
        encrypted_password=COALESCE(?, encrypted_password), updated_by=?, updated_at=UTC_TIMESTAMP(3),
        last_imap_status='PENDING', last_smtp_status='PENDING', last_error=NULL
       WHERE id=1`,
      [input.emailAddress.trim(), input.username.trim(), input.incomingHost.trim(), input.incomingPort,
        input.incomingSecure, input.outgoingHost.trim(), input.outgoingPort, input.outgoingSecure,
        input.enabled, input.moveProcessedToTrash !== false, encryptedPassword ?? null, actor],
    );
    return this.getSettings();
  }

  async testConnections(): Promise<{ imap: 'OK'; smtp: 'OK' }> {
    const account = await this.privateSettings();
    const results = await Promise.allSettled([this.verifyImap(account), this.verifySmtp(account)]);
    const imapOk = results[0].status === 'fulfilled';
    const smtpOk = results[1].status === 'fulfilled';
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => this.safeMailError(result.reason));
    await this.pool.query(
      `UPDATE email_settings SET last_imap_status=?, last_smtp_status=?, last_error=?, updated_at=UTC_TIMESTAMP(3)
       WHERE id=1`,
      [imapOk ? 'OK' : 'ERROR', smtpOk ? 'OK' : 'ERROR', errors.join(' | ') || null],
    );
    if (!imapOk || !smtpOk) throw new Error(errors.join(' | ') || 'No fue posible verificar el correo.');
    return { imap: 'OK', smtp: 'OK' };
  }

  async listIncoming(limit = 100): Promise<IncomingRequest[]> {
    const safeLimit = Math.max(1, Math.min(250, Math.trunc(limit)));
    const [rows] = await this.pool.query<IncomingRow[]>(
      `SELECT incoming.id, incoming.message_id, incoming.mailbox_uid, incoming.subject,
        incoming.sender_name, incoming.sender_email, incoming.received_at, incoming.snippet,
        incoming.has_attachments, incoming.attachment_count, incoming.status,
        COALESCE(gc.id, linked_case.id) AS case_id,
        COALESCE(gc.code, linked_case.code) AS case_code
       FROM incoming_requests incoming
       LEFT JOIN generated_cases gc ON gc.incoming_request_id=incoming.id
       LEFT JOIN generated_case_mail_events linked_event
         ON linked_event.incoming_request_id=incoming.id AND linked_event.direction='INBOUND'
       LEFT JOIN generated_cases linked_case ON linked_case.id=linked_event.case_id
       ORDER BY incoming.received_at DESC LIMIT ?`,
      [safeLimit],
    );
    return rows.map(publicIncoming);
  }

  async listGeneratedCases(limit = 250, autoAnalyzeComplete = false): Promise<GeneratedCaseSummary[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const [rows] = await this.pool.query<GeneratedCaseRow[]>(
      `SELECT gc.id, gc.code, gc.incoming_request_id, gc.status,
        gc.subject, gc.sender_name, gc.sender_email, gc.received_at,
        gc.created_at, gc.finalized_at, gc.finalized_by,
        (SELECT COUNT(*) FROM generated_case_documents documents WHERE documents.case_id=gc.id) AS document_count,
        analysis.status AS analysis_status, analysis.provider AS analysis_provider,
        analysis.gemini_configured, analysis.completeness_percent, analysis.expected_count,
        analysis.received_count, analysis.missing_count, analysis.unclassified_count,
        analysis.summary AS analysis_summary, analysis.model AS analysis_model,
        analysis.analysis_version, analysis.analyzed_at,
        intelligence.status AS intelligence_status, intelligence.model AS intelligence_model,
        intelligence.engine_version AS intelligence_engine_version,
        NULL AS intelligence_result, intelligence.error_message AS intelligence_error,
        intelligence.analyzed_at AS intelligence_analyzed_at,
        intelligence.updated_at AS intelligence_updated_at,
        intelligence.risk_level, intelligence.risk_score, intelligence.risk_route
       FROM generated_cases gc
       LEFT JOIN generated_case_document_analyses analysis ON analysis.case_id=gc.id
       LEFT JOIN generated_case_intelligence intelligence ON intelligence.case_id=gc.id
       WHERE gc.finalized_at IS NULL
       ORDER BY gc.received_at DESC, gc.code DESC LIMIT ?`,
      [safeLimit],
    );
    const generatedCases = rows.map(publicGeneratedCase);
    for (const row of rows.filter((item) => shouldRunAutomaticAnalysis(autoAnalyzeComplete, {
      status: item.analysis_status || 'MISSING_DOCUMENTS',
      completenessPercent: Number(item.completeness_percent),
    }) &&
      (!item.intelligence_status || item.intelligence_status === 'ANALYZING' ||
        item.intelligence_engine_version !== GENERATED_CASE_INTELLIGENCE_VERSION)).slice(0, 3)) {
      void this.ensureGeneratedCaseIntelligence(row.id, false).catch(() => undefined);
    }
    return generatedCases;
  }

  async listFinalizedCases(limit = 250): Promise<GeneratedCaseSummary[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const [rows] = await this.pool.query<GeneratedCaseRow[]>(
      `SELECT gc.id, gc.code, gc.incoming_request_id, gc.status,
        gc.subject, gc.sender_name, gc.sender_email, gc.received_at,
        gc.created_at, gc.finalized_at, gc.finalized_by,
        (SELECT COUNT(*) FROM generated_case_documents documents WHERE documents.case_id=gc.id) AS document_count,
        analysis.status AS analysis_status, analysis.provider AS analysis_provider,
        analysis.gemini_configured, analysis.completeness_percent, analysis.expected_count,
        analysis.received_count, analysis.missing_count, analysis.unclassified_count,
        analysis.summary AS analysis_summary, analysis.model AS analysis_model,
        analysis.analysis_version, analysis.analyzed_at,
        intelligence.status AS intelligence_status, intelligence.model AS intelligence_model,
        intelligence.engine_version AS intelligence_engine_version,
        NULL AS intelligence_result, intelligence.error_message AS intelligence_error,
        intelligence.analyzed_at AS intelligence_analyzed_at,
        intelligence.risk_level, intelligence.risk_score, intelligence.risk_route
       FROM generated_cases gc
       LEFT JOIN generated_case_document_analyses analysis ON analysis.case_id=gc.id
       LEFT JOIN generated_case_intelligence intelligence ON intelligence.case_id=gc.id
       WHERE gc.finalized_at IS NOT NULL
       ORDER BY gc.finalized_at DESC, gc.code DESC LIMIT ?`,
      [safeLimit],
    );
    return rows.map(publicGeneratedCase);
  }

  async finalizeGeneratedCase(id: string, actor: string): Promise<GeneratedCaseDetail | undefined> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE generated_cases
       SET status='FINALIZED', finalized_at=COALESCE(finalized_at, UTC_TIMESTAMP(3)),
         finalized_by=COALESCE(finalized_by, ?), updated_at=UTC_TIMESTAMP(3)
       WHERE id=?`,
      [actor, id],
    );
    if (!result.affectedRows) return undefined;
    return this.getGeneratedCase(id, false);
  }

  async exportFinalizedCases(ids: string[]): Promise<{ archive: Buffer; count: number } | undefined> {
    const uniqueIds = [...new Set(ids)].slice(0, 100);
    if (!uniqueIds.length) return undefined;
    const placeholders = uniqueIds.map(() => '?').join(',');
    const [rows] = await this.pool.query<(RowDataPacket & {
      id: string;
      code: string;
      sender_email: string | null;
      received_at: Date;
      finalized_at: Date;
      intelligence_result: DocumentIntelligenceInsight | string | null;
    })[]>(
      `SELECT gc.id, gc.code, gc.sender_email, gc.received_at, gc.finalized_at,
        intelligence.result_json AS intelligence_result
       FROM generated_cases gc
       LEFT JOIN generated_case_intelligence intelligence ON intelligence.case_id=gc.id
       WHERE gc.finalized_at IS NOT NULL AND gc.id IN (${placeholders})
       ORDER BY gc.finalized_at, gc.code`,
      uniqueIds,
    );
    if (rows.length !== uniqueIds.length) return undefined;
    const archive = await buildFinalizedCasesArchive(rows.map((row) => ({
      code: row.code,
      ...(row.sender_email ? { senderEmail: row.sender_email } : {}),
      receivedAt: row.received_at,
      finalizedAt: row.finalized_at,
      documentIntelligence: parseIntelligence(row.intelligence_result),
    })));
    return { archive, count: rows.length };
  }

  async startReadyCaseAnalysis(limit = 3): Promise<number> {
    const safeLimit = Math.max(1, Math.min(10, Math.trunc(limit)));
    const [rows] = await this.pool.query<(RowDataPacket & { id: string })[]>(
      `SELECT gc.id
       FROM generated_cases gc
       INNER JOIN generated_case_document_analyses analysis ON analysis.case_id=gc.id
       LEFT JOIN generated_case_intelligence intelligence ON intelligence.case_id=gc.id
       WHERE analysis.status='COMPLETE' AND analysis.completeness_percent=100
         AND gc.finalized_at IS NULL
         AND (intelligence.case_id IS NULL OR intelligence.status='ANALYZING'
           OR intelligence.engine_version<>?)
       ORDER BY analysis.updated_at, gc.received_at
       LIMIT ?`,
      [GENERATED_CASE_INTELLIGENCE_VERSION, safeLimit],
    );
    for (const row of rows) void this.ensureGeneratedCaseIntelligence(row.id, false).catch(() => undefined);
    return rows.length;
  }

  async getOperationalDashboard(autoAnalyzeComplete = false): Promise<MailOperationalDashboard> {
    const [summaryResult, volumeResult, recentIncoming, recentGeneratedCases] = await Promise.all([
      this.pool.query<OperationalSummaryRow[]>(
        `SELECT
          (SELECT COUNT(*) FROM incoming_requests) AS incoming_total,
          (SELECT COUNT(*) FROM generated_cases) AS generated_total,
          (SELECT COUNT(*) FROM generated_case_documents) AS document_total,
          (SELECT COUNT(*) FROM incoming_requests WHERE status='NEW') AS pending_generation,
          COALESCE(SUM(CASE WHEN gc.finalized_at IS NULL AND (analysis.status IS NULL OR analysis.status<>'COMPLETE') THEN 1 ELSE 0 END), 0) AS incomplete,
          COALESCE(SUM(CASE WHEN gc.finalized_at IS NULL AND analysis.status='COMPLETE' AND
            (intelligence.status IS NULL OR intelligence.status NOT IN ('ANALYZING', 'COMPLETE', 'ERROR'))
            THEN 1 ELSE 0 END), 0) AS ready_for_analysis,
          COALESCE(SUM(CASE WHEN gc.finalized_at IS NULL AND intelligence.status='ANALYZING' THEN 1 ELSE 0 END), 0) AS analyzing,
          COALESCE(SUM(CASE WHEN gc.finalized_at IS NULL AND intelligence.status='COMPLETE' THEN 1 ELSE 0 END), 0) AS decision_pending,
          COALESCE(SUM(CASE WHEN gc.finalized_at IS NULL AND intelligence.status='ERROR' THEN 1 ELSE 0 END), 0) AS analysis_error,
          COALESCE(SUM(CASE WHEN gc.finalized_at IS NULL AND intelligence.risk_route='CUMPLIMIENTO' THEN 1 ELSE 0 END), 0) AS compliance
         FROM generated_cases gc
         LEFT JOIN generated_case_document_analyses analysis ON analysis.case_id=gc.id
         LEFT JOIN generated_case_intelligence intelligence ON intelligence.case_id=gc.id`,
      ),
      this.pool.query<OperationalVolumeRow[]>(
        `SELECT DATE_FORMAT(received_at, '%Y-%m-%d') AS date, COUNT(*) AS count
         FROM incoming_requests
         WHERE received_at >= UTC_DATE() - INTERVAL 13 DAY
         GROUP BY DATE(received_at)
         ORDER BY DATE(received_at)`,
      ),
      this.listIncoming(5),
      this.listGeneratedCases(5, autoAnalyzeComplete),
    ]);
    const [summaryRows] = summaryResult;
    const [volumeRows] = volumeResult;
    return buildMailOperationalDashboard(
      summaryRows[0] || ({} as OperationalSummaryRow),
      volumeRows,
      recentIncoming,
      recentGeneratedCases,
    );
  }

  async getGeneratedCase(id: string, autoAnalyzeComplete = false): Promise<GeneratedCaseDetail | undefined> {
    await this.analyzeGeneratedCase(id, false, autoAnalyzeComplete);
    const [caseRows] = await this.pool.query<GeneratedCaseRow[]>(
      `SELECT gc.id, gc.code, gc.incoming_request_id, gc.status,
        gc.subject, gc.sender_name, gc.sender_email, gc.received_at,
        gc.created_at, gc.finalized_at, gc.finalized_by,
        (SELECT COUNT(*) FROM generated_case_documents documents WHERE documents.case_id=gc.id) AS document_count,
        analysis.status AS analysis_status, analysis.provider AS analysis_provider,
        analysis.gemini_configured, analysis.completeness_percent, analysis.expected_count,
        analysis.received_count, analysis.missing_count, analysis.unclassified_count,
        analysis.summary AS analysis_summary, analysis.model AS analysis_model,
        analysis.analysis_version, analysis.analyzed_at,
        intelligence.status AS intelligence_status, intelligence.model AS intelligence_model,
        intelligence.engine_version AS intelligence_engine_version,
        intelligence.result_json AS intelligence_result, intelligence.error_message AS intelligence_error,
        intelligence.analyzed_at AS intelligence_analyzed_at,
        intelligence.updated_at AS intelligence_updated_at,
        intelligence.risk_level, intelligence.risk_score, intelligence.risk_route
       FROM generated_cases gc
       LEFT JOIN generated_case_document_analyses analysis ON analysis.case_id=gc.id
       LEFT JOIN generated_case_intelligence intelligence ON intelligence.case_id=gc.id
       WHERE gc.id=? LIMIT 1`,
      [id],
    );
    const row = caseRows[0];
    if (!row) return undefined;
    const [documentRows] = await this.pool.query<GeneratedDocumentRow[]>(
      `SELECT id, case_id, filename, content_type, size_bytes, checksum_sha256,
        s3_bucket, s3_key, created_at
       FROM generated_case_documents WHERE case_id=? ORDER BY created_at, filename`,
      [id],
    );
    const [analysisItemRows] = await this.pool.query<AnalysisItemRow[]>(
      `SELECT requirement_type, label, status, matched_document_id, confidence, reason, policy_ref
       FROM generated_case_document_analysis_items
       WHERE case_id=? ORDER BY created_at, requirement_type`,
      [id],
    );
    const generatedCase = publicGeneratedCase(row);
    if (generatedCase.documentAnalysis) {
      generatedCase.documentAnalysis.items = analysisItemRows.map((item) => ({
        requirementType: item.requirement_type,
        label: item.label,
        status: item.status,
        ...(item.matched_document_id ? { matchedDocumentId: item.matched_document_id } : {}),
        confidence: Number(item.confidence),
        reason: item.reason,
        policyRef: item.policy_ref,
      }));
    }
    const [mailRows] = await this.pool.query<MailEventRow[]>(
      `SELECT id, case_id, status, subject, counterparty_email, sent_at, error_message
       FROM generated_case_mail_events
       WHERE case_id=? AND event_type='MISSING_DOCUMENT_REQUEST'
       ORDER BY created_at DESC LIMIT 1`,
      [id],
    );
    const latestRequest = mailRows[0];
    const [[sourceRows], [auditMailRows]] = await Promise.all([
      this.pool.query<IncomingAuditSourceRow[]>(
        'SELECT source_moved_at FROM incoming_requests WHERE id=? LIMIT 1',
        [row.incoming_request_id],
      ),
      this.pool.query<AuditMailEventRow[]>(
        `SELECT id, direction, event_type, subject, counterparty_email, status,
          error_message, created_at, sent_at, updated_at
         FROM generated_case_mail_events WHERE case_id=? ORDER BY created_at, id`,
        [id],
      ),
    ]);
    const intelligence = parseIntelligence(row.intelligence_result);
    if (intelligence) intelligence.analysis.cached = true;
    if (generatedCase.risk && intelligence) generatedCase.risk.reasons = intelligence.recommendation.rationale;
    const documents = documentRows.map(publicGeneratedDocument);
    const auditTrail = buildGeneratedCaseAuditTrail({
      id: generatedCase.id,
      code: generatedCase.code,
      subject: generatedCase.subject,
      ...(generatedCase.senderName ? { senderName: generatedCase.senderName } : {}),
      ...(generatedCase.senderEmail ? { senderEmail: generatedCase.senderEmail } : {}),
      receivedAt: generatedCase.receivedAt,
      createdAt: generatedCase.createdAt,
      ...(sourceRows[0]?.source_moved_at ? { sourceMovedAt: sourceRows[0].source_moved_at.toISOString() } : {}),
      documents,
      ...(generatedCase.documentAnalysis ? { documentAnalysis: generatedCase.documentAnalysis } : {}),
      ...(row.intelligence_status ? {
        intelligence: {
          status: row.intelligence_status,
          ...(row.intelligence_model ? { model: row.intelligence_model } : {}),
          ...(row.intelligence_analyzed_at ? { analyzedAt: row.intelligence_analyzed_at.toISOString() } : {}),
          ...(row.intelligence_updated_at ? { updatedAt: row.intelligence_updated_at.toISOString() } : {}),
          ...(row.intelligence_error ? { error: row.intelligence_error } : {}),
          ...(row.risk_level ? { riskLevel: row.risk_level } : {}),
          ...(row.risk_score !== null ? { riskScore: Number(row.risk_score) } : {}),
        },
      } : {}),
      mailEvents: auditMailRows.map((event) => ({
        id: event.id,
        direction: event.direction,
        eventType: event.event_type,
        subject: event.subject,
        ...(event.counterparty_email ? { counterpartyEmail: event.counterparty_email } : {}),
        status: event.status,
        ...(event.error_message ? { error: event.error_message } : {}),
        createdAt: event.created_at.toISOString(),
        ...(event.sent_at ? { sentAt: event.sent_at.toISOString() } : {}),
        updatedAt: event.updated_at.toISOString(),
      })),
      ...(generatedCase.finalizedAt ? { finalizedAt: generatedCase.finalizedAt } : {}),
      ...(generatedCase.finalizedBy ? { finalizedBy: generatedCase.finalizedBy } : {}),
    });
    return {
      ...generatedCase,
      incomingRequestId: row.incoming_request_id,
      documents,
      auditTrail,
      ...(latestRequest ? { missingDocumentRequest: this.publicMissingDocumentRequest(latestRequest) } : {}),
      ...(intelligence ? { documentIntelligence: intelligence } : {}),
      ...(row.intelligence_status ? {
        intelligenceStatus: {
          status: row.intelligence_status,
          ...(row.intelligence_model ? { model: row.intelligence_model } : {}),
          ...(row.intelligence_analyzed_at ? { analyzedAt: row.intelligence_analyzed_at.toISOString() } : {}),
          ...(row.intelligence_error ? { error: row.intelligence_error } : {}),
        },
      } : {}),
    };
  }

  async analyzeGeneratedCase(
    id: string,
    force = true,
    autoAnalyzeComplete = true,
  ): Promise<DocumentCompletenessAnalysis | undefined> {
    if (!force) {
      const stored = await this.storedDocumentAnalysis(id);
      if (stored?.version === DOCUMENT_COMPLETENESS_VERSION) {
        if (await this.shouldRunAutomaticAnalysis(autoAnalyzeComplete, stored)) {
          void this.ensureGeneratedCaseIntelligence(id, false).catch(() => undefined);
        }
        return stored;
      }
    }
    const [caseRows] = await this.pool.query<RowDataPacket[]>('SELECT id FROM generated_cases WHERE id=? LIMIT 1', [id]);
    if (!caseRows[0]) return undefined;
    const [documentRows] = await this.pool.query<GeneratedDocumentRow[]>(
      `SELECT id, case_id, filename, content_type, size_bytes, checksum_sha256,
        s3_bucket, s3_key, created_at
       FROM generated_case_documents WHERE case_id=? ORDER BY created_at, filename`,
      [id],
    );
    const analysis = await analyzeDocumentCompleteness(
      documentRows.map((document) => ({
        id: document.id,
        filename: document.filename,
        contentType: document.content_type,
        sizeBytes: Number(document.size_bytes),
      })),
      this.geminiConfig,
    );
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        `INSERT INTO generated_case_document_analyses
          (case_id, status, provider, gemini_configured, completeness_percent, expected_count,
           received_count, missing_count, unclassified_count, summary, model, analysis_version,
           analyzed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE status=VALUES(status), provider=VALUES(provider),
           gemini_configured=VALUES(gemini_configured), completeness_percent=VALUES(completeness_percent),
           expected_count=VALUES(expected_count), received_count=VALUES(received_count),
           missing_count=VALUES(missing_count), unclassified_count=VALUES(unclassified_count),
           summary=VALUES(summary), model=VALUES(model), analysis_version=VALUES(analysis_version),
           analyzed_at=VALUES(analyzed_at), updated_at=UTC_TIMESTAMP(3)`,
        [id, analysis.status, analysis.provider, analysis.geminiConfigured,
          analysis.completenessPercent, analysis.expectedCount, analysis.receivedCount,
          analysis.missingCount, analysis.unclassifiedCount, analysis.summary,
          analysis.model || null, analysis.version, new Date(analysis.analyzedAt)],
      );
      await connection.query('DELETE FROM generated_case_document_analysis_items WHERE case_id=?', [id]);
      for (const item of analysis.items) {
        await connection.query(
          `INSERT INTO generated_case_document_analysis_items
            (id, case_id, requirement_type, label, status, matched_document_id,
             confidence, reason, policy_ref, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
          [randomUUID(), id, item.requirementType, item.label, item.status,
            item.matchedDocumentId || null, item.confidence, item.reason, item.policyRef],
        );
      }
      await connection.query(
        'UPDATE generated_cases SET status=IF(finalized_at IS NULL, ?, status), updated_at=UTC_TIMESTAMP(3) WHERE id=?',
        [analysis.status === 'COMPLETE' ? 'ANALYSIS_PENDING' : 'DOCUMENT_INCOMPLETE', id],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    if (await this.shouldRunAutomaticAnalysis(autoAnalyzeComplete, analysis)) {
      void this.ensureGeneratedCaseIntelligence(id, force).catch(() => undefined);
    } else if (analysis.status !== 'COMPLETE') {
      await this.pool.query('DELETE FROM generated_case_intelligence WHERE case_id=?', [id]);
    }
    return analysis;
  }

  private async shouldRunAutomaticAnalysis(
    autoAnalyzeComplete: boolean,
    analysis?: Pick<DocumentCompletenessAnalysis, 'status' | 'completenessPercent'>,
  ): Promise<boolean> {
    if (shouldRunAutomaticAnalysis(autoAnalyzeComplete, analysis)) return true;
    if (!shouldRunAutomaticAnalysis(true, analysis)) return false;
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT id FROM users
       WHERE active=TRUE AND auto_analyze_complete_cases=TRUE LIMIT 1`,
    );
    return Boolean(rows[0]);
  }

  async analyzeGeneratedCaseIntelligence(id: string, force = true): Promise<void> {
    await this.ensureGeneratedCaseIntelligence(id, force);
  }

  private async ensureGeneratedCaseIntelligence(id: string, force: boolean): Promise<void> {
    const active = this.intelligenceRuns.get(id);
    if (active) return active;
    const run = this.performGeneratedCaseIntelligence(id, force)
      .finally(() => this.intelligenceRuns.delete(id));
    this.intelligenceRuns.set(id, run);
    return run;
  }

  private async performGeneratedCaseIntelligence(id: string, force: boolean): Promise<void> {
    const [documentRows] = await this.pool.query<GeneratedDocumentRow[]>(
      `SELECT id, case_id, filename, content_type, size_bytes, checksum_sha256,
        s3_bucket, s3_key, created_at
       FROM generated_case_documents WHERE case_id=? ORDER BY created_at, filename`,
      [id],
    );
    if (!documentRows.length) return;
    const currentFingerprint = generatedCaseIntelligenceFingerprint(documentRows.map((document) => ({
      id: document.id,
      checksumSha256: document.checksum_sha256,
    })));
    const stored = await this.storedIntelligence(id);
    if (!force && stored?.status === 'COMPLETE' && stored.fingerprint === currentFingerprint &&
      stored.engine_version === GENERATED_CASE_INTELLIGENCE_VERSION && stored.result_json) return;
    if (!force && stored?.status === 'ERROR' && stored.fingerprint === currentFingerprint &&
      stored.engine_version === GENERATED_CASE_INTELLIGENCE_VERSION) return;

    await this.pool.query(
      `INSERT INTO generated_case_intelligence
        (case_id, status, provider, model, fingerprint, engine_version, result_json,
         error_message, analyzed_at, created_at, updated_at)
       VALUES (?, 'ANALYZING', 'gemini', ?, ?, ?, NULL, NULL, NULL, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE status='ANALYZING', provider='gemini', model=VALUES(model),
         fingerprint=VALUES(fingerprint), engine_version=VALUES(engine_version), result_json=NULL,
         risk_level=NULL, risk_score=NULL, risk_route=NULL, recommendation=NULL,
         error_message=NULL, analyzed_at=NULL, updated_at=UTC_TIMESTAMP(3)`,
      [id, this.geminiConfig.model, currentFingerprint, GENERATED_CASE_INTELLIGENCE_VERSION],
    );
    await this.pool.query(
      "UPDATE generated_cases SET status=IF(finalized_at IS NULL, 'ANALYZING', status), updated_at=UTC_TIMESTAMP(3) WHERE id=?",
      [id],
    );

    try {
      if (!this.objectStorage) throw new Error('El almacenamiento privado S3 no está configurado.');
      const documents = await Promise.all(documentRows.map(async (document) => ({
        id: document.id,
        filename: document.filename,
        contentType: document.content_type,
        checksumSha256: document.checksum_sha256,
        content: await this.objectStorage!.getObject(document.s3_key),
      })));
      const result = await analyzeGeneratedCaseIntelligence(id, documents, this.geminiConfig);
      result.insight = await applyVerifiedBufferedPdfEvidence(result.insight, documents);
      await this.pool.query(
        `UPDATE generated_case_intelligence SET status='COMPLETE', provider='gemini', model=?,
           fingerprint=?, engine_version=?, risk_level=?, risk_score=?, risk_route=?,
           recommendation=?, result_json=?, error_message=NULL, analyzed_at=?, updated_at=UTC_TIMESTAMP(3)
         WHERE case_id=?`,
        [this.geminiConfig.model, currentFingerprint, GENERATED_CASE_INTELLIGENCE_VERSION,
          result.risk.level, result.risk.score, result.risk.route,
          result.insight.recommendation.decision, JSON.stringify(result.insight),
          new Date(result.insight.analysis.generatedAt), id],
      );
      await this.pool.query(
        "UPDATE generated_cases SET status=IF(finalized_at IS NULL, 'DECISION_PENDING', status), updated_at=UTC_TIMESTAMP(3) WHERE id=?",
        [id],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1000) : 'Error no identificado durante el análisis.';
      await this.pool.query(
        `UPDATE generated_case_intelligence SET status='ERROR', error_message=?,
           risk_level=NULL, risk_score=NULL, risk_route=NULL, recommendation=NULL,
           result_json=NULL, analyzed_at=UTC_TIMESTAMP(3), updated_at=UTC_TIMESTAMP(3)
         WHERE case_id=?`,
        [message, id],
      );
      await this.pool.query(
        "UPDATE generated_cases SET status=IF(finalized_at IS NULL, 'ANALYSIS_ERROR', status), updated_at=UTC_TIMESTAMP(3) WHERE id=?",
        [id],
      );
    }
  }

  private async storedIntelligence(id: string): Promise<StoredIntelligenceRow | undefined> {
    const [rows] = await this.pool.query<StoredIntelligenceRow[]>(
      `SELECT status, model, fingerprint, engine_version, result_json, error_message,
        analyzed_at, risk_level, risk_score, risk_route
       FROM generated_case_intelligence WHERE case_id=? LIMIT 1`,
      [id],
    );
    return rows[0];
  }

  async notifyPendingMissingDocumentRequests(limit = 25): Promise<number> {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const [rows] = await this.pool.query<NotificationCaseRow[]>(
      `SELECT gc.id, gc.code, gc.sender_name, gc.sender_email,
        incoming.message_id AS trigger_message_id
       FROM generated_cases gc
       JOIN incoming_requests incoming ON incoming.id=gc.incoming_request_id
       JOIN generated_case_document_analyses analysis ON analysis.case_id=gc.id
       WHERE analysis.missing_count > 0
         AND gc.sender_email IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM generated_case_mail_events event
           WHERE event.case_id=gc.id
             AND event.event_type='MISSING_DOCUMENT_REQUEST'
             AND event.status='SENT'
         )
       ORDER BY gc.created_at LIMIT ?`,
      [safeLimit],
    );
    let sent = 0;
    for (const row of rows) {
      const result = await this.requestMissingDocuments(row.id, row.trigger_message_id).catch(() => undefined);
      if (result?.status === 'SENT') sent += 1;
    }
    return sent;
  }

  async requestMissingDocuments(
    caseId: string,
    triggerMessageId: string,
  ): Promise<MissingDocumentRequestStatus | undefined> {
    const analysis = await this.storedDocumentAnalysis(caseId);
    const missing = analysis?.items
      .filter((item) => item.status === 'MISSING')
      .map((item) => ({ requirementType: item.requirementType, label: item.label })) || [];
    if (!missing.length) return undefined;

    const [caseRows] = await this.pool.query<LinkedCaseRow[]>(
      `SELECT id, code, sender_name, sender_email FROM generated_cases WHERE id=? LIMIT 1`,
      [caseId],
    );
    const generatedCase = caseRows[0];
    if (!generatedCase?.sender_email) return undefined;
    const account = await this.privateSettings();
    if (generatedCase.sender_email.toLocaleLowerCase('en-US') === account.emailAddress.toLocaleLowerCase('en-US')) {
      return undefined;
    }

    const [existingRows] = await this.pool.query<MailEventRow[]>(
      `SELECT id, case_id, status, subject, counterparty_email, sent_at, error_message
       FROM generated_case_mail_events
       WHERE case_id=? AND trigger_message_id=? AND event_type='MISSING_DOCUMENT_REQUEST'
       LIMIT 1`,
      [caseId, triggerMessageId],
    );
    const existing = existingRows[0];
    if (existing?.status === 'SENT') return this.publicMissingDocumentRequest(existing);

    const message = buildMissingDocumentsMessage(generatedCase.code, generatedCase.sender_name || undefined, missing);
    const eventId = existing?.id || randomUUID();
    if (existing) {
      await this.pool.query(
        `UPDATE generated_case_mail_events SET status='PENDING', subject=?, counterparty_email=?,
          missing_document_types=?, error_message=NULL, updated_at=UTC_TIMESTAMP(3) WHERE id=?`,
        [message.subject, generatedCase.sender_email, JSON.stringify(missing.map((item) => item.requirementType)), eventId],
      );
    } else {
      await this.pool.query(
        `INSERT INTO generated_case_mail_events
          (id, case_id, direction, event_type, trigger_message_id, in_reply_to, subject,
           counterparty_email, missing_document_types, status, created_at, updated_at)
         VALUES (?, ?, 'OUTBOUND', 'MISSING_DOCUMENT_REQUEST', ?, ?, ?, ?, ?,
           'PENDING', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [eventId, caseId, triggerMessageId, triggerMessageId, message.subject,
          generatedCase.sender_email, JSON.stringify(missing.map((item) => item.requirementType))],
      );
    }

    const transport = this.smtpTransport(account);
    try {
      const sent = await transport.sendMail({
        from: { name: 'AFPC Occidente', address: account.emailAddress },
        to: generatedCase.sender_email,
        replyTo: account.emailAddress,
        subject: message.subject,
        text: message.text,
        html: message.html,
        inReplyTo: triggerMessageId,
        references: triggerMessageId,
        headers: {
          'Auto-Submitted': 'auto-generated',
          'X-AFPC-Case-Code': generatedCase.code,
        },
      });
      await this.pool.query(
        `UPDATE generated_case_mail_events SET status='SENT', message_id=?, sent_at=UTC_TIMESTAMP(3),
          error_message=NULL, updated_at=UTC_TIMESTAMP(3) WHERE id=?`,
        [sent.messageId.slice(0, 255), eventId],
      );
      await this.pool.query(
        `UPDATE email_settings SET last_smtp_status='OK', last_error=NULL WHERE id=1`,
      );
      return {
        status: 'SENT',
        subject: message.subject,
        recipientEmail: generatedCase.sender_email,
        sentAt: new Date().toISOString(),
      };
    } catch (error) {
      const safeError = this.safeMailError(error);
      await this.pool.query(
        `UPDATE generated_case_mail_events SET status='ERROR', error_message=?,
          updated_at=UTC_TIMESTAMP(3) WHERE id=?`,
        [safeError, eventId],
      );
      await this.pool.query(
        `UPDATE email_settings SET last_smtp_status='ERROR', last_error=? WHERE id=1`,
        [safeError],
      );
      return {
        status: 'ERROR',
        subject: message.subject,
        recipientEmail: generatedCase.sender_email,
        error: safeError,
      };
    } finally {
      transport.close();
    }
  }

  async getGeneratedDocument(caseId: string, documentId: string): Promise<{ document: GeneratedCaseDocument; content: Buffer } | undefined> {
    if (!this.objectStorage) throw new Error('El almacenamiento S3 no está configurado.');
    const [rows] = await this.pool.query<GeneratedDocumentRow[]>(
      `SELECT id, case_id, filename, content_type, size_bytes, checksum_sha256,
        s3_bucket, s3_key, created_at
       FROM generated_case_documents WHERE id=? AND case_id=? LIMIT 1`,
      [documentId, caseId],
    );
    const row = rows[0];
    if (!row) return undefined;
    return { document: publicGeneratedDocument(row), content: await this.objectStorage.getObject(row.s3_key) };
  }

  async deleteGeneratedCase(id: string): Promise<{ code: string; deletedObjects: number } | undefined> {
    if (!this.objectStorage) throw new Error('El almacenamiento S3 no está configurado.');
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<GeneratedCaseRow[]>(
        `SELECT gc.id, gc.code, gc.incoming_request_id, gc.status,
          gc.subject, gc.sender_name, gc.sender_email, gc.received_at,
          gc.created_at, 0 AS document_count
         FROM generated_cases gc WHERE gc.id=? LIMIT 1 FOR UPDATE`,
        [id],
      );
      const row = rows[0];
      if (!row) {
        await connection.rollback();
        return undefined;
      }
      const deletedObjects = await this.objectStorage.deleteCase(row.code);
      const [linkedRows] = await connection.query<(RowDataPacket & { incoming_request_id: string })[]>(
        `SELECT incoming_request_id FROM generated_case_mail_events
         WHERE case_id=? AND incoming_request_id IS NOT NULL AND incoming_request_id<>?`,
        [row.id, row.incoming_request_id],
      );
      if (linkedRows.length) {
        const placeholders = linkedRows.map(() => '?').join(', ');
        await connection.query(
          `DELETE FROM incoming_requests WHERE id IN (${placeholders})`,
          linkedRows.map((item) => item.incoming_request_id),
        );
      }
      await connection.query('DELETE FROM incoming_requests WHERE id=?', [row.incoming_request_id]);
      await connection.commit();
      return { code: row.code, deletedObjects };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async deleteIncomingRequest(id: string): Promise<{ caseCode?: string; deletedObjects: number } | undefined> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<(RowDataPacket & {
        id: string;
        case_id: string | null;
        case_code: string | null;
        root_incoming_request_id: string | null;
      })[]>(
        `SELECT incoming.id,
          COALESCE(gc.id, linked_case.id) AS case_id,
          COALESCE(gc.code, linked_case.code) AS case_code,
          COALESCE(gc.incoming_request_id, linked_case.incoming_request_id) AS root_incoming_request_id
         FROM incoming_requests incoming
         LEFT JOIN generated_cases gc ON gc.incoming_request_id=incoming.id
         LEFT JOIN generated_case_mail_events linked_event
           ON linked_event.incoming_request_id=incoming.id AND linked_event.direction='INBOUND'
         LEFT JOIN generated_cases linked_case ON linked_case.id=linked_event.case_id
         WHERE incoming.id=? LIMIT 1 FOR UPDATE`,
        [id],
      );
      const row = rows[0];
      if (!row) {
        await connection.rollback();
        return undefined;
      }
      let deletedObjects = 0;
      if (row.case_code) {
        if (!this.objectStorage) throw new Error('El almacenamiento S3 no está configurado.');
        deletedObjects = await this.objectStorage.deleteCase(row.case_code);
        const [linkedRows] = await connection.query<(RowDataPacket & { incoming_request_id: string })[]>(
          `SELECT incoming_request_id FROM generated_case_mail_events
           WHERE case_id=? AND incoming_request_id IS NOT NULL AND incoming_request_id<>?`,
          [row.case_id, row.root_incoming_request_id],
        );
        if (linkedRows.length) {
          const placeholders = linkedRows.map(() => '?').join(', ');
          await connection.query(
            `DELETE FROM incoming_requests WHERE id IN (${placeholders})`,
            linkedRows.map((item) => item.incoming_request_id),
          );
        }
      }
      await connection.query('DELETE FROM incoming_requests WHERE id=?', [row.root_incoming_request_id || row.id]);
      await connection.commit();
      return {
        ...(row.case_code ? { caseCode: row.case_code } : {}),
        deletedObjects,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async syncIncoming(limit = 50): Promise<{ imported: number; generated: number; documents: number; movedToTrash: number; total: number }> {
    if (this.syncing) return { imported: 0, generated: 0, documents: 0, movedToTrash: 0, total: (await this.listIncoming(250)).length };
    this.syncing = true;
    let client: ImapFlow | undefined;
    try {
      const account = await this.privateSettings();
      if (!account.enabled) return { imported: 0, generated: 0, documents: 0, movedToTrash: 0, total: (await this.listIncoming(250)).length };
      let generated = await this.backfillStoredRequestsWithoutAttachments();
      client = this.imapClient(account);
      await client.connect();
      const trashMailbox = account.moveProcessedToTrash ? await this.trashMailboxPath(client) : undefined;
      const lock = await client.getMailboxLock('INBOX');
      let imported = 0;
      let documents = 0;
      let movedToTrash = 0;
      const pendingMoves: Array<{ uid: number; incomingId: string }> = [];
      try {
        const count = client.mailbox && typeof client.mailbox !== 'boolean' ? client.mailbox.exists : 0;
        if (count > 0) {
          const start = Math.max(1, count - Math.max(1, Math.min(100, limit)) + 1);
          for await (const message of client.fetch(`${start}:*`, { uid: true, envelope: true, source: true })) {
            if (!message.source) continue;
            const parsed = await simpleParser(message.source);
            const from = parsed.from?.value[0];
            const messageId = (parsed.messageId || message.envelope?.messageId || `${account.username}:${message.uid}`).slice(0, 255);
            const result = await this.createCaseFromMessage({
              messageId,
              mailboxUid: message.uid,
              subject: (parsed.subject || '(Sin asunto)').slice(0, 998),
              senderName: from?.name?.slice(0, 255),
              senderEmail: from?.address?.slice(0, 255),
              receivedAt: parsed.date || message.envelope?.date || new Date(),
              snippet: parsed.text?.replaceAll(/\s+/gu, ' ').trim().slice(0, 800),
              parsed,
            });
            imported += result.imported;
            generated += result.generated;
            documents += result.documents;
            if (trashMailbox && result.shouldMove) {
              pendingMoves.push({ uid: message.uid, incomingId: result.incomingId });
            }
          }
        }
        for (const pending of pendingMoves) {
          const moved = await client.messageMove([pending.uid], trashMailbox as string, { uid: true });
          if (!moved) throw new Error('SiteGround no confirmó el movimiento del correo procesado a Papelera.');
          await this.pool.query(
            'UPDATE incoming_requests SET source_moved_at=UTC_TIMESTAMP(3), updated_at=UTC_TIMESTAMP(3) WHERE id=?',
            [pending.incomingId],
          );
          movedToTrash += 1;
        }
      } finally {
        lock.release();
      }
      await this.pool.query(
        `UPDATE email_settings SET last_sync_at=UTC_TIMESTAMP(3), last_imap_status='OK',
         last_error=NULL WHERE id=1`,
      );
      return { imported, generated, documents, movedToTrash, total: (await this.listIncoming(250)).length };
    } catch (error) {
      const safeError = this.safeMailError(error);
      await this.pool.query(
        `UPDATE email_settings SET last_imap_status='ERROR', last_error=? WHERE id=1`,
        [safeError],
      );
      throw new Error(safeError);
    } finally {
      this.syncing = false;
      if (client?.usable) await client.logout().catch(() => undefined);
    }
  }

  private async backfillStoredRequestsWithoutAttachments(): Promise<number> {
    const [rows] = await this.pool.query<(RowDataPacket & {
      id: string;
      message_id: string;
      subject: string;
      sender_name: string | null;
      sender_email: string | null;
      received_at: Date;
    })[]>(
      `SELECT incoming.id, incoming.message_id, incoming.subject, incoming.sender_name,
        incoming.sender_email, incoming.received_at
       FROM incoming_requests incoming
       LEFT JOIN generated_cases gc ON gc.incoming_request_id=incoming.id
       WHERE gc.id IS NULL AND incoming.attachment_count=0
       ORDER BY incoming.received_at, incoming.id LIMIT 250`,
    );
    let generated = 0;
    for (const row of rows) {
      const connection = await this.pool.getConnection();
      try {
        await connection.beginTransaction();
        const [existing] = await connection.query<RowDataPacket[]>(
          'SELECT id FROM generated_cases WHERE incoming_request_id=? FOR UPDATE',
          [row.id],
        );
        if (existing[0]) {
          await connection.commit();
          continue;
        }
        const date = caseDate(row.received_at);
        const sequence = await this.nextDailySequence(connection, date);
        const code = `AFPC-${date.replaceAll('-', '')}-${String(sequence).padStart(5, '0')}`;
        const generatedId = randomUUID();
        await connection.query(
          `INSERT INTO generated_cases
            (id, code, incoming_request_id, status, subject, sender_name, sender_email,
             received_at, created_at, updated_at)
           VALUES (?, ?, ?, 'RECEIVED', ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [generatedId, code, row.id, row.subject, row.sender_name, row.sender_email, row.received_at],
        );
        await connection.query(
          `UPDATE incoming_requests SET status='CASE_CREATED', updated_at=UTC_TIMESTAMP(3) WHERE id=?`,
          [row.id],
        );
        await connection.query(
          `INSERT INTO generated_case_mail_events
            (id, case_id, incoming_request_id, direction, event_type, message_id,
             subject, counterparty_email, status, created_at, updated_at)
           VALUES (?, ?, ?, 'INBOUND', 'ORIGINAL_RECEIVED', ?, ?, ?, 'RECEIVED',
             UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [randomUUID(), generatedId, row.id, row.message_id, row.subject, row.sender_email],
        );
        await connection.commit();
        const analysis = await this.analyzeGeneratedCase(generatedId, true, false).catch(() => undefined);
        if (analysis?.missingCount) {
          await this.requestMissingDocuments(generatedId, row.message_id).catch(() => undefined);
        }
        generated += 1;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
    return generated;
  }

  private async createCaseFromMessage(input: {
    messageId: string;
    mailboxUid: number;
    subject: string;
    senderName?: string;
    senderEmail?: string;
    receivedAt: Date;
    snippet?: string;
    parsed: ParsedMail;
  }): Promise<{ imported: number; generated: number; documents: number; incomingId: string; shouldMove: boolean }> {
    if (input.parsed.attachments.length && !this.objectStorage) {
      throw new Error('El correo contiene adjuntos, pero el almacenamiento S3 no está configurado.');
    }
    const connection = await this.pool.getConnection();
    const uploadedKeys: string[] = [];
    try {
      await connection.beginTransaction();
      const [incomingRows] = await connection.query<(RowDataPacket & { id: string; source_moved_at: Date | null })[]>(
        'SELECT id, source_moved_at FROM incoming_requests WHERE message_id=? FOR UPDATE',
        [input.messageId],
      );
      if (incomingRows[0]) {
        await connection.commit();
        return {
          imported: 0,
          generated: 0,
          documents: 0,
          incomingId: incomingRows[0].id,
          shouldMove: !incomingRows[0].source_moved_at,
        };
      }

      const references = parsedMailReferences(input.parsed);
      const linkedCase = await this.findLinkedCase(connection, input.subject, input.senderEmail, references);
      const incomingId = randomUUID();
      await connection.query(
        `INSERT INTO incoming_requests
          (id, message_id, mailbox_uid, subject, sender_name, sender_email, received_at,
           snippet, has_attachments, attachment_count, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [incomingId, input.messageId, input.mailboxUid, input.subject, input.senderName || null,
          input.senderEmail || null, input.receivedAt, input.snippet || null,
          input.parsed.attachments.length > 0, input.parsed.attachments.length,
          linkedCase ? 'CASE_FOLLOWUP' : 'NEW'],
      );

      if (linkedCase) {
        let documentsAdded = 0;
        for (const [index, attachment] of input.parsed.attachments.entries()) {
          const checksum = createHash('sha256').update(attachment.content).digest('hex');
          const [duplicates] = await connection.query<RowDataPacket[]>(
            `SELECT id FROM generated_case_documents
             WHERE case_id=? AND checksum_sha256=? LIMIT 1`,
            [linkedCase.id, checksum],
          );
          if (duplicates[0]) continue;
          const filename = `respuesta-${input.mailboxUid}-${safeAttachmentName(attachment, index)}`;
          const stored = await this.objectStorage?.putCaseDocument(
            linkedCase.code,
            filename,
            attachment.contentType,
            attachment.content,
          );
          if (!stored) throw new Error('No fue posible guardar el documento de respuesta en S3.');
          uploadedKeys.push(stored.key);
          await connection.query(
            `INSERT INTO generated_case_documents
              (id, case_id, filename, content_type, size_bytes, checksum_sha256,
               s3_bucket, s3_key, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
            [randomUUID(), linkedCase.id, attachment.filename?.slice(0, 512) || filename,
              attachment.contentType || 'application/octet-stream', attachment.size,
              checksum, stored.bucket, stored.key],
          );
          documentsAdded += 1;
        }
        await connection.query(
          `INSERT INTO generated_case_mail_events
            (id, case_id, incoming_request_id, direction, event_type, message_id,
             subject, counterparty_email, status, created_at, updated_at)
           VALUES (?, ?, ?, 'INBOUND', 'FOLLOWUP_RECEIVED', ?, ?, ?, 'RECEIVED',
             UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [randomUUID(), linkedCase.id, incomingId, input.messageId, input.subject, input.senderEmail || null],
        );
        await connection.query(
          `UPDATE incoming_requests SET status='CASE_LINKED', updated_at=UTC_TIMESTAMP(3) WHERE id=?`,
          [incomingId],
        );
        await connection.query(
          `UPDATE generated_cases SET status=IF(finalized_at IS NULL, 'DOCUMENTS_UPDATED', status), updated_at=UTC_TIMESTAMP(3) WHERE id=?`,
          [linkedCase.id],
        );
        await connection.commit();
        const analysis = await this.analyzeGeneratedCase(linkedCase.id, true, false).catch(() => undefined);
        if (analysis?.missingCount) {
          await this.requestMissingDocuments(linkedCase.id, input.messageId).catch(() => undefined);
        }
        return { imported: 1, generated: 0, documents: documentsAdded, incomingId, shouldMove: true };
      }

      const date = caseDate(input.receivedAt);
      const sequence = await this.nextDailySequence(connection, date);
      const caseCode = `AFPC-${date.replaceAll('-', '')}-${String(sequence).padStart(5, '0')}`;
      const generatedId = randomUUID();
      await connection.query(
        `INSERT INTO generated_cases
          (id, code, incoming_request_id, status, subject, sender_name, sender_email,
           received_at, created_at, updated_at)
         VALUES (?, ?, ?, 'RECEIVED', ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [generatedId, caseCode, incomingId, input.subject, input.senderName || null,
          input.senderEmail || null, input.receivedAt],
      );

      for (const [index, attachment] of input.parsed.attachments.entries()) {
        const filename = safeAttachmentName(attachment, index);
        const stored = await this.objectStorage?.putCaseDocument(
          caseCode,
          filename,
          attachment.contentType,
          attachment.content,
        );
        if (!stored) throw new Error('No fue posible guardar el documento en S3.');
        uploadedKeys.push(stored.key);
        await connection.query(
          `INSERT INTO generated_case_documents
            (id, case_id, filename, content_type, size_bytes, checksum_sha256,
             s3_bucket, s3_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
          [randomUUID(), generatedId, attachment.filename?.slice(0, 512) || filename,
            attachment.contentType || 'application/octet-stream', attachment.size,
            createHash('sha256').update(attachment.content).digest('hex'), stored.bucket, stored.key],
        );
      }
      await connection.query(
        `UPDATE incoming_requests SET status='CASE_CREATED', updated_at=UTC_TIMESTAMP(3) WHERE id=?`,
        [incomingId],
      );
      await connection.query(
        `INSERT INTO generated_case_mail_events
          (id, case_id, incoming_request_id, direction, event_type, message_id,
           subject, counterparty_email, status, created_at, updated_at)
         VALUES (?, ?, ?, 'INBOUND', 'ORIGINAL_RECEIVED', ?, ?, ?, 'RECEIVED',
           UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [randomUUID(), generatedId, incomingId, input.messageId, input.subject, input.senderEmail || null],
      );
      await connection.commit();
      const analysis = await this.analyzeGeneratedCase(generatedId, true, false).catch(() => undefined);
      if (analysis?.missingCount) {
        await this.requestMissingDocuments(generatedId, input.messageId).catch(() => undefined);
      }
      return {
        imported: 1,
        generated: 1,
        documents: input.parsed.attachments.length,
        incomingId,
        shouldMove: true,
      };
    } catch (error) {
      await connection.rollback();
      if (uploadedKeys.length && this.objectStorage) {
        await this.objectStorage.deleteObjects(uploadedKeys).catch(() => undefined);
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  private async nextDailySequence(connection: PoolConnection, date: string): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT sequence_value FROM daily_case_sequences WHERE case_date=? FOR UPDATE',
      [date],
    );
    const next = rows[0] ? Number(rows[0].sequence_value) + 1 : 1;
    if (rows[0]) {
      await connection.query(
        'UPDATE daily_case_sequences SET sequence_value=?, updated_at=UTC_TIMESTAMP(3) WHERE case_date=?',
        [next, date],
      );
    } else {
      await connection.query(
        'INSERT INTO daily_case_sequences (case_date, sequence_value, updated_at) VALUES (?, ?, UTC_TIMESTAMP(3))',
        [date, next],
      );
    }
    return next;
  }

  private async findLinkedCase(
    connection: PoolConnection,
    subject: string,
    senderEmail: string | undefined,
    references: string[],
  ): Promise<LinkedCaseRow | undefined> {
    if (!senderEmail) return undefined;
    const code = extractCaseCode(subject);
    if (code) {
      const [rows] = await connection.query<LinkedCaseRow[]>(
        `SELECT id, code, sender_name, sender_email
         FROM generated_cases WHERE code=? AND sender_email=? LIMIT 1 FOR UPDATE`,
        [code, senderEmail],
      );
      if (rows[0]) return rows[0];
    }
    if (!references.length) return undefined;
    const placeholders = references.map(() => '?').join(', ');
    const [rows] = await connection.query<LinkedCaseRow[]>(
      `SELECT gc.id, gc.code, gc.sender_name, gc.sender_email
       FROM generated_case_mail_events event
       JOIN generated_cases gc ON gc.id=event.case_id
       WHERE event.direction='OUTBOUND' AND event.message_id IN (${placeholders})
         AND gc.sender_email=?
       ORDER BY event.created_at DESC LIMIT 1 FOR UPDATE`,
      [...references, senderEmail],
    );
    return rows[0];
  }

  private async storedDocumentAnalysis(id: string): Promise<DocumentCompletenessAnalysis | undefined> {
    const [rows] = await this.pool.query<StoredAnalysisRow[]>(
      `SELECT status, provider, gemini_configured, completeness_percent, expected_count,
        received_count, missing_count, unclassified_count, summary, model,
        analysis_version, analyzed_at
       FROM generated_case_document_analyses WHERE case_id=? LIMIT 1`,
      [id],
    );
    const row = rows[0];
    if (!row) return undefined;
    const [itemRows] = await this.pool.query<AnalysisItemRow[]>(
      `SELECT requirement_type, label, status, matched_document_id, confidence, reason, policy_ref
       FROM generated_case_document_analysis_items
       WHERE case_id=? ORDER BY created_at, requirement_type`,
      [id],
    );
    return {
      status: row.status,
      provider: row.provider,
      geminiConfigured: Boolean(row.gemini_configured),
      completenessPercent: Number(row.completeness_percent),
      expectedCount: Number(row.expected_count),
      receivedCount: Number(row.received_count),
      missingCount: Number(row.missing_count),
      unclassifiedCount: Number(row.unclassified_count),
      summary: row.summary,
      ...(row.model ? { model: row.model } : {}),
      version: row.analysis_version,
      analyzedAt: row.analyzed_at.toISOString(),
      items: itemRows.map((item) => ({
        requirementType: item.requirement_type,
        label: item.label,
        status: item.status,
        ...(item.matched_document_id ? { matchedDocumentId: item.matched_document_id } : {}),
        confidence: Number(item.confidence),
        reason: item.reason,
        policyRef: item.policy_ref,
      })),
    };
  }

  private async settingsRow(): Promise<SettingsRow> {
    const [rows] = await this.pool.query<SettingsRow[]>('SELECT * FROM email_settings WHERE id=1');
    if (!rows[0]) throw new Error('No existe la configuración de correo.');
    return rows[0];
  }

  private async privateSettings(): Promise<MailSettings & { password: string }> {
    const row = await this.settingsRow();
    if (!row.encrypted_password || !this.credentialsKey) {
      throw new Error('Debe registrar la contraseña del buzón antes de conectar IMAP y SMTP.');
    }
    return { ...publicSettings(row), password: decryptSecret(row.encrypted_password, this.credentialsKey) };
  }

  private imapClient(account: MailSettings & { password: string }): ImapFlow {
    return new ImapFlow({
      host: account.incomingHost,
      port: account.incomingPort,
      secure: account.incomingSecure,
      auth: { user: account.username, pass: account.password },
      logger: false,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
  }

  private async trashMailboxPath(client: ImapFlow): Promise<string> {
    const mailboxes = await client.list();
    const trashPath = findTrashMailboxPath(mailboxes);
    if (!trashPath) {
      throw new Error('SiteGround no expone una carpeta de Papelera identificable por IMAP.');
    }
    return trashPath;
  }

  private smtpTransport(account: MailSettings & { password: string }) {
    return nodemailer.createTransport({
      host: account.outgoingHost,
      port: account.outgoingPort,
      secure: account.outgoingSecure,
      auth: { user: account.username, pass: account.password },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
  }

  private async verifyImap(account: MailSettings & { password: string }): Promise<void> {
    const client = this.imapClient(account);
    try {
      await client.connect();
      if (account.moveProcessedToTrash) await this.trashMailboxPath(client);
      const lock = await client.getMailboxLock('INBOX');
      lock.release();
    } finally {
      if (client.usable) await client.logout().catch(() => undefined);
    }
  }

  private async verifySmtp(account: MailSettings & { password: string }): Promise<void> {
    const transport = this.smtpTransport(account);
    try {
      await transport.verify();
    } finally {
      transport.close();
    }
  }

  private publicMissingDocumentRequest(row: MailEventRow): MissingDocumentRequestStatus {
    return {
      status: row.status,
      subject: row.subject,
      ...(row.counterparty_email ? { recipientEmail: row.counterparty_email } : {}),
      ...(row.sent_at ? { sentAt: row.sent_at.toISOString() } : {}),
      ...(row.error_message ? { error: row.error_message } : {}),
    };
  }

  private safeMailError(error: unknown): string {
    const message = error instanceof Error ? error.message : 'Error desconocido de correo.';
    return message.replaceAll(/(pass(?:word)?|auth(?:entication)?)\s*[=:]\s*\S+/giu, '$1=[protegido]').slice(0, 800);
  }
}
