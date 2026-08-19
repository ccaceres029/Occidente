import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser, type Attachment, type ParsedMail } from 'mailparser';
import nodemailer from 'nodemailer';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { ObjectStorage } from './objectStorage.js';

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
}

export interface GeneratedCaseDetail extends GeneratedCaseSummary {
  incomingRequestId: string;
  documents: GeneratedCaseDocument[];
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
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    subject: row.subject,
    ...(row.sender_name ? { senderName: row.sender_name } : {}),
    ...(row.sender_email ? { senderEmail: row.sender_email } : {}),
    receivedAt: row.received_at.toISOString(),
    documentCount: Number(row.document_count),
    createdAt: row.created_at.toISOString(),
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

  constructor(
    private readonly pool: Pool,
    private readonly credentialsKey?: Buffer,
    private readonly objectStorage?: ObjectStorage,
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
        outgoing_host=?, outgoing_port=?, outgoing_secure=?, enabled=?,
        encrypted_password=COALESCE(?, encrypted_password), updated_by=?, updated_at=UTC_TIMESTAMP(3),
        last_imap_status='PENDING', last_smtp_status='PENDING', last_error=NULL
       WHERE id=1`,
      [input.emailAddress.trim(), input.username.trim(), input.incomingHost.trim(), input.incomingPort,
        input.incomingSecure, input.outgoingHost.trim(), input.outgoingPort, input.outgoingSecure,
        input.enabled, encryptedPassword ?? null, actor],
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
        gc.id AS case_id, gc.code AS case_code
       FROM incoming_requests incoming
       LEFT JOIN generated_cases gc ON gc.incoming_request_id=incoming.id
       ORDER BY incoming.received_at DESC LIMIT ?`,
      [safeLimit],
    );
    return rows.map(publicIncoming);
  }

  async listGeneratedCases(limit = 250): Promise<GeneratedCaseSummary[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const [rows] = await this.pool.query<GeneratedCaseRow[]>(
      `SELECT gc.id, gc.code, gc.incoming_request_id, gc.status,
        gc.subject, gc.sender_name, gc.sender_email, gc.received_at,
        gc.created_at, COUNT(documents.id) AS document_count
       FROM generated_cases gc
       LEFT JOIN generated_case_documents documents ON documents.case_id=gc.id
       GROUP BY gc.id
       ORDER BY gc.received_at DESC, gc.code DESC LIMIT ?`,
      [safeLimit],
    );
    return rows.map(publicGeneratedCase);
  }

  async getGeneratedCase(id: string): Promise<GeneratedCaseDetail | undefined> {
    const [caseRows] = await this.pool.query<GeneratedCaseRow[]>(
      `SELECT gc.id, gc.code, gc.incoming_request_id, gc.status,
        gc.subject, gc.sender_name, gc.sender_email, gc.received_at,
        gc.created_at, COUNT(documents.id) AS document_count
       FROM generated_cases gc
       LEFT JOIN generated_case_documents documents ON documents.case_id=gc.id
       WHERE gc.id=? GROUP BY gc.id`,
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
    return {
      ...publicGeneratedCase(row),
      incomingRequestId: row.incoming_request_id,
      documents: documentRows.map(publicGeneratedDocument),
    };
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
      const [rows] = await connection.query<(RowDataPacket & { id: string; case_code: string | null })[]>(
        `SELECT incoming.id, gc.code AS case_code
         FROM incoming_requests incoming
         LEFT JOIN generated_cases gc ON gc.incoming_request_id=incoming.id
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
      }
      await connection.query('DELETE FROM incoming_requests WHERE id=?', [row.id]);
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

  async syncIncoming(limit = 50): Promise<{ imported: number; generated: number; documents: number; total: number }> {
    if (this.syncing) return { imported: 0, generated: 0, documents: 0, total: (await this.listIncoming(250)).length };
    this.syncing = true;
    let client: ImapFlow | undefined;
    try {
      const account = await this.privateSettings();
      if (!account.enabled) return { imported: 0, generated: 0, documents: 0, total: (await this.listIncoming(250)).length };
      let generated = await this.backfillStoredRequestsWithoutAttachments();
      client = this.imapClient(account);
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      let imported = 0;
      let documents = 0;
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
          }
        }
      } finally {
        lock.release();
      }
      await this.pool.query(
        `UPDATE email_settings SET last_sync_at=UTC_TIMESTAMP(3), last_imap_status='OK',
         last_error=NULL WHERE id=1`,
      );
      return { imported, generated, documents, total: (await this.listIncoming(250)).length };
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
      subject: string;
      sender_name: string | null;
      sender_email: string | null;
      received_at: Date;
    })[]>(
      `SELECT incoming.id, incoming.subject, incoming.sender_name, incoming.sender_email, incoming.received_at
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
        await connection.query(
          `INSERT INTO generated_cases
            (id, code, incoming_request_id, status, subject, sender_name, sender_email,
             received_at, created_at, updated_at)
           VALUES (?, ?, ?, 'RECEIVED', ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [randomUUID(), code, row.id, row.subject, row.sender_name, row.sender_email, row.received_at],
        );
        await connection.query(
          `UPDATE incoming_requests SET status='CASE_CREATED', updated_at=UTC_TIMESTAMP(3) WHERE id=?`,
          [row.id],
        );
        await connection.commit();
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
  }): Promise<{ imported: number; generated: number; documents: number }> {
    if (input.parsed.attachments.length && !this.objectStorage) {
      throw new Error('El correo contiene adjuntos, pero el almacenamiento S3 no está configurado.');
    }
    const connection = await this.pool.getConnection();
    let caseCode: string | undefined;
    try {
      await connection.beginTransaction();
      const [incomingRows] = await connection.query<RowDataPacket[]>(
        'SELECT id FROM incoming_requests WHERE message_id=? FOR UPDATE',
        [input.messageId],
      );
      let incomingId = typeof incomingRows[0]?.id === 'string' ? incomingRows[0].id : '';
      let imported = 0;
      if (!incomingId) {
        incomingId = randomUUID();
        await connection.query(
          `INSERT INTO incoming_requests
            (id, message_id, mailbox_uid, subject, sender_name, sender_email, received_at,
             snippet, has_attachments, attachment_count, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [incomingId, input.messageId, input.mailboxUid, input.subject, input.senderName || null,
            input.senderEmail || null, input.receivedAt, input.snippet || null,
            input.parsed.attachments.length > 0, input.parsed.attachments.length],
        );
        imported = 1;
      }

      const [existingCases] = await connection.query<RowDataPacket[]>(
        'SELECT id FROM generated_cases WHERE incoming_request_id=? FOR UPDATE',
        [incomingId],
      );
      if (existingCases[0]) {
        await connection.commit();
        return { imported, generated: 0, documents: 0 };
      }

      const date = caseDate(input.receivedAt);
      const sequence = await this.nextDailySequence(connection, date);
      caseCode = `AFPC-${date.replaceAll('-', '')}-${String(sequence).padStart(5, '0')}`;
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
      await connection.commit();
      return { imported, generated: 1, documents: input.parsed.attachments.length };
    } catch (error) {
      await connection.rollback();
      if (caseCode && this.objectStorage) await this.objectStorage.deleteCase(caseCode).catch(() => undefined);
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

  private async verifyImap(account: MailSettings & { password: string }): Promise<void> {
    const client = this.imapClient(account);
    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      lock.release();
    } finally {
      if (client.usable) await client.logout().catch(() => undefined);
    }
  }

  private async verifySmtp(account: MailSettings & { password: string }): Promise<void> {
    const transport = nodemailer.createTransport({
      host: account.outgoingHost,
      port: account.outgoingPort,
      secure: account.outgoingSecure,
      auth: { user: account.username, pass: account.password },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    try {
      await transport.verify();
    } finally {
      transport.close();
    }
  }

  private safeMailError(error: unknown): string {
    const message = error instanceof Error ? error.message : 'Error desconocido de correo.';
    return message.replaceAll(/(pass(?:word)?|auth(?:entication)?)\s*[=:]\s*\S+/giu, '$1=[protegido]').slice(0, 800);
  }
}
