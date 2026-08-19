import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import type { Pool, RowDataPacket } from 'mysql2/promise';

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
  };
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

  constructor(private readonly pool: Pool, private readonly credentialsKey?: Buffer) {}

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
      `SELECT id, message_id, mailbox_uid, subject, sender_name, sender_email, received_at,
        snippet, has_attachments, attachment_count, status
       FROM incoming_requests ORDER BY received_at DESC LIMIT ?`,
      [safeLimit],
    );
    return rows.map(publicIncoming);
  }

  async syncIncoming(limit = 50): Promise<{ imported: number; total: number }> {
    if (this.syncing) return { imported: 0, total: (await this.listIncoming(250)).length };
    this.syncing = true;
    let client: ImapFlow | undefined;
    try {
      const account = await this.privateSettings();
      if (!account.enabled) return { imported: 0, total: (await this.listIncoming(250)).length };
      client = this.imapClient(account);
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      let imported = 0;
      try {
        const count = client.mailbox && typeof client.mailbox !== 'boolean' ? client.mailbox.exists : 0;
        if (count > 0) {
          const start = Math.max(1, count - Math.max(1, Math.min(100, limit)) + 1);
          for await (const message of client.fetch(`${start}:*`, { uid: true, envelope: true, source: true })) {
            if (!message.source) continue;
            const parsed = await simpleParser(message.source);
            const from = parsed.from?.value[0];
            const messageId = (parsed.messageId || message.envelope?.messageId || `${account.username}:${message.uid}`).slice(0, 255);
            const [result] = await this.pool.query(
              `INSERT IGNORE INTO incoming_requests
                (id, message_id, mailbox_uid, subject, sender_name, sender_email, received_at,
                 snippet, has_attachments, attachment_count, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
              [randomUUID(), messageId, message.uid, (parsed.subject || '(Sin asunto)').slice(0, 998),
                from?.name?.slice(0, 255) || null, from?.address?.slice(0, 255) || null,
                parsed.date || message.envelope?.date || new Date(),
                parsed.text?.replaceAll(/\s+/gu, ' ').trim().slice(0, 800) || null,
                parsed.attachments.length > 0, parsed.attachments.length],
            );
            if ('affectedRows' in result) imported += Number(result.affectedRows);
          }
        }
      } finally {
        lock.release();
      }
      await this.pool.query(
        `UPDATE email_settings SET last_sync_at=UTC_TIMESTAMP(3), last_imap_status='OK',
         last_error=NULL WHERE id=1`,
      );
      return { imported, total: (await this.listIncoming(250)).length };
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
    });
    await transport.verify();
    transport.close();
  }

  private safeMailError(error: unknown): string {
    const message = error instanceof Error ? error.message : 'Error desconocido de correo.';
    return message.replaceAll(/(pass(?:word)?|auth(?:entication)?)\s*[=:]\s*\S+/giu, '$1=[protegido]').slice(0, 800);
  }
}
