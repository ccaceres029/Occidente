import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import mysql, { type Pool, type PoolConnection, type RowDataPacket } from 'mysql2/promise';
import type { BootstrapUserConfig, DatabaseConfig } from './config.js';
import { createSeedDatabase } from './seed.js';
import type { AuditInput, CaseStore } from './store.js';
import type { AfpcCase, AuditEvent, DemoDatabase } from './types.js';

const scrypt = promisify(scryptCallback);

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
  autoRefreshIncoming: boolean;
  autoAnalyzeCompleteCases: boolean;
}

export interface UserPreferences {
  autoRefreshIncoming: boolean;
  autoAnalyzeCompleteCases: boolean;
}

export interface ManagedUser extends AuthUser {
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateManagedUserInput {
  username: string;
  displayName: string;
  role: string;
  password: string;
}

export interface UpdateManagedUserInput {
  username: string;
  displayName: string;
  role: string;
  active: boolean;
  password?: string;
}

export class UserManagementError extends Error {
  readonly code: 'LAST_ACTIVE_ADMIN';

  constructor(message: string) {
    super(message);
    this.name = 'UserManagementError';
    this.code = 'LAST_ACTIVE_ADMIN';
  }
}

interface UserRow extends RowDataPacket {
  id: string;
  username: string;
  display_name: string;
  role: string;
  password_salt: string;
  password_hash: string;
  active: number | boolean;
  auto_refresh_incoming: number | boolean;
  auto_analyze_complete_cases: number | boolean;
  created_at: Date;
  updated_at: Date;
}

interface PayloadRow extends RowDataPacket {
  payload: string | AfpcCase;
}

interface AuditRow extends RowDataPacket {
  id: string;
  case_id: string;
  action: string;
  label: string;
  actor: string;
  note: string | null;
  from_status: AuditEvent['fromStatus'] | null;
  to_status: AuditEvent['toStatus'] | null;
  created_at: Date;
}

function parsePayload<T>(value: string | T): T {
  return typeof value === 'string' ? (JSON.parse(value) as T) : value;
}

function asAudit(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    caseId: row.case_id,
    action: row.action,
    label: row.label,
    actor: row.actor,
    ...(row.note ? { note: row.note } : {}),
    ...(row.from_status ? { fromStatus: row.from_status } : {}),
    ...(row.to_status ? { toStatus: row.to_status } : {}),
    createdAt: row.created_at.toISOString(),
  };
}

async function passwordHash(password: string, salt: string): Promise<string> {
  return Buffer.from(await scrypt(password, salt, 64) as ArrayBuffer).toString('hex');
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class MysqlStore implements CaseStore {
  readonly dataDir: string;
  readonly uploadsDir: string;
  readonly storageMode = 'mysql' as const;
  readonly databaseName: string;
  private readonly pool: Pool;
  private readonly bootstrapUser?: BootstrapUserConfig;
  private state: DemoDatabase = { version: 3, cases: [], auditEvents: [] };
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(config: DatabaseConfig, dataDir: string, bootstrapUser?: BootstrapUserConfig) {
    this.dataDir = dataDir;
    this.uploadsDir = path.join(dataDir, 'uploads');
    this.databaseName = config.database;
    this.bootstrapUser = bootstrapUser;
    this.pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      connectionLimit: config.connectionLimit,
      charset: 'utf8mb4',
      timezone: 'Z',
      dateStrings: false,
      ssl: config.sslCaPath
        ? { ca: requireCa(config.sslCaPath), minVersion: 'TLSv1.2', rejectUnauthorized: true }
        : undefined,
    });
  }

  async initialize(): Promise<void> {
    await this.createSchema();
    await this.loadOrMigrateCases();
    await this.ensureBootstrapUser();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  databasePool(): Pool {
    return this.pool;
  }

  private async createSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS afpc_cases (
        id VARCHAR(64) PRIMARY KEY,
        reference VARCHAR(64) NOT NULL UNIQUE,
        status VARCHAR(40) NOT NULL,
        client_name VARCHAR(255) NOT NULL,
        agency VARCHAR(255) NOT NULL,
        advisor VARCHAR(255) NOT NULL,
        assignee VARCHAR(255) NOT NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        payload JSON NOT NULL,
        INDEX idx_cases_status_updated (status, updated_at),
        INDEX idx_cases_client_name (client_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id CHAR(36) PRIMARY KEY,
        case_id VARCHAR(64) NOT NULL,
        action VARCHAR(100) NOT NULL,
        label VARCHAR(255) NOT NULL,
        actor VARCHAR(255) NOT NULL,
        note TEXT NULL,
        from_status VARCHAR(40) NULL,
        to_status VARCHAR(40) NULL,
        created_at DATETIME(3) NOT NULL,
        INDEX idx_audit_case_created (case_id, created_at),
        CONSTRAINT fk_audit_case FOREIGN KEY (case_id) REFERENCES afpc_cases(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id CHAR(36) PRIMARY KEY,
        username VARCHAR(191) NOT NULL UNIQUE,
        display_name VARCHAR(255) NOT NULL,
        role VARCHAR(80) NOT NULL,
        password_salt CHAR(32) NOT NULL,
        password_hash CHAR(128) NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        auto_refresh_incoming BOOLEAN NOT NULL DEFAULT FALSE,
        auto_analyze_complete_cases BOOLEAN NOT NULL DEFAULT FALSE,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        INDEX idx_users_active (active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        token_hash CHAR(64) PRIMARY KEY,
        user_id CHAR(36) NOT NULL,
        remember_device BOOLEAN NOT NULL DEFAULT FALSE,
        created_at DATETIME(3) NOT NULL,
        last_seen_at DATETIME(3) NOT NULL,
        expires_at DATETIME(3) NOT NULL,
        INDEX idx_sessions_user (user_id),
        INDEX idx_sessions_expiry (expires_at),
        CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS email_settings (
        id TINYINT UNSIGNED PRIMARY KEY,
        email_address VARCHAR(255) NOT NULL,
        username VARCHAR(255) NOT NULL,
        incoming_host VARCHAR(255) NOT NULL,
        incoming_port SMALLINT UNSIGNED NOT NULL,
        incoming_secure BOOLEAN NOT NULL DEFAULT TRUE,
        outgoing_host VARCHAR(255) NOT NULL,
        outgoing_port SMALLINT UNSIGNED NOT NULL,
        outgoing_secure BOOLEAN NOT NULL DEFAULT TRUE,
        encrypted_password TEXT NULL,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        move_processed_to_trash BOOLEAN NOT NULL DEFAULT TRUE,
        last_sync_at DATETIME(3) NULL,
        last_imap_status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
        last_smtp_status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
        last_error TEXT NULL,
        updated_by VARCHAR(255) NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        CONSTRAINT chk_email_settings_singleton CHECK (id = 1)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS incoming_requests (
        id CHAR(36) PRIMARY KEY,
        message_id VARCHAR(255) NOT NULL UNIQUE,
        mailbox_uid BIGINT UNSIGNED NOT NULL,
        subject VARCHAR(998) NOT NULL,
        sender_name VARCHAR(255) NULL,
        sender_email VARCHAR(255) NULL,
        received_at DATETIME(3) NOT NULL,
        snippet TEXT NULL,
        has_attachments BOOLEAN NOT NULL DEFAULT FALSE,
        attachment_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        status VARCHAR(30) NOT NULL DEFAULT 'NEW',
        source_moved_at DATETIME(3) NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        INDEX idx_incoming_received (received_at),
        INDEX idx_incoming_status_received (status, received_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS daily_case_sequences (
        case_date DATE PRIMARY KEY,
        sequence_value INT UNSIGNED NOT NULL,
        updated_at DATETIME(3) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS generated_cases (
        id CHAR(36) PRIMARY KEY,
        code VARCHAR(64) NOT NULL UNIQUE,
        incoming_request_id CHAR(36) NOT NULL UNIQUE,
        status VARCHAR(30) NOT NULL DEFAULT 'RECEIVED',
        subject VARCHAR(998) NOT NULL,
        sender_name VARCHAR(255) NULL,
        sender_email VARCHAR(255) NULL,
        received_at DATETIME(3) NOT NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        INDEX idx_generated_received (received_at),
        INDEX idx_generated_status_received (status, received_at),
        CONSTRAINT fk_generated_incoming FOREIGN KEY (incoming_request_id)
          REFERENCES incoming_requests(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS generated_case_documents (
        id CHAR(36) PRIMARY KEY,
        case_id CHAR(36) NOT NULL,
        filename VARCHAR(512) NOT NULL,
        content_type VARCHAR(191) NOT NULL,
        size_bytes BIGINT UNSIGNED NOT NULL,
        checksum_sha256 CHAR(64) NOT NULL,
        s3_bucket VARCHAR(255) NOT NULL,
        s3_key VARCHAR(512) NOT NULL UNIQUE,
        created_at DATETIME(3) NOT NULL,
        INDEX idx_generated_documents_case (case_id),
        CONSTRAINT fk_generated_document_case FOREIGN KEY (case_id)
          REFERENCES generated_cases(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS generated_case_document_analyses (
        case_id CHAR(36) PRIMARY KEY,
        status VARCHAR(30) NOT NULL,
        provider VARCHAR(30) NOT NULL,
        gemini_configured BOOLEAN NOT NULL DEFAULT FALSE,
        completeness_percent TINYINT UNSIGNED NOT NULL,
        expected_count SMALLINT UNSIGNED NOT NULL,
        received_count SMALLINT UNSIGNED NOT NULL,
        missing_count SMALLINT UNSIGNED NOT NULL,
        unclassified_count SMALLINT UNSIGNED NOT NULL,
        summary VARCHAR(1000) NOT NULL,
        model VARCHAR(100) NULL,
        analysis_version VARCHAR(64) NOT NULL,
        analyzed_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        CONSTRAINT fk_generated_analysis_case FOREIGN KEY (case_id)
          REFERENCES generated_cases(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS generated_case_document_analysis_items (
        id CHAR(36) PRIMARY KEY,
        case_id CHAR(36) NOT NULL,
        requirement_type VARCHAR(64) NOT NULL,
        label VARCHAR(191) NOT NULL,
        status VARCHAR(20) NOT NULL,
        matched_document_id CHAR(36) NULL,
        confidence DECIMAL(5,4) NOT NULL,
        reason VARCHAR(500) NOT NULL,
        policy_ref VARCHAR(191) NOT NULL,
        created_at DATETIME(3) NOT NULL,
        UNIQUE KEY uq_generated_analysis_requirement (case_id, requirement_type),
        INDEX idx_generated_analysis_status (case_id, status),
        CONSTRAINT fk_generated_analysis_item_case FOREIGN KEY (case_id)
          REFERENCES generated_cases(id) ON DELETE CASCADE,
        CONSTRAINT fk_generated_analysis_item_document FOREIGN KEY (matched_document_id)
          REFERENCES generated_case_documents(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS generated_case_intelligence (
        case_id CHAR(36) PRIMARY KEY,
        status VARCHAR(20) NOT NULL,
        provider VARCHAR(30) NULL,
        model VARCHAR(100) NULL,
        fingerprint CHAR(64) NOT NULL,
        engine_version VARCHAR(64) NOT NULL,
        risk_level VARCHAR(12) NULL,
        risk_score TINYINT UNSIGNED NULL,
        risk_route VARCHAR(40) NULL,
        recommendation VARCHAR(40) NULL,
        result_json JSON NULL,
        error_message VARCHAR(1000) NULL,
        analyzed_at DATETIME(3) NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        INDEX idx_generated_intelligence_status (status, updated_at),
        INDEX idx_generated_intelligence_risk (risk_level, risk_score),
        CONSTRAINT fk_generated_intelligence_case FOREIGN KEY (case_id)
          REFERENCES generated_cases(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS generated_case_mail_events (
        id CHAR(36) PRIMARY KEY,
        case_id CHAR(36) NOT NULL,
        incoming_request_id CHAR(36) NULL,
        direction VARCHAR(12) NOT NULL,
        event_type VARCHAR(40) NOT NULL,
        message_id VARCHAR(255) NULL,
        trigger_message_id VARCHAR(255) NULL,
        in_reply_to VARCHAR(255) NULL,
        subject VARCHAR(998) NOT NULL,
        counterparty_email VARCHAR(255) NULL,
        missing_document_types TEXT NULL,
        status VARCHAR(20) NOT NULL,
        error_message VARCHAR(800) NULL,
        created_at DATETIME(3) NOT NULL,
        sent_at DATETIME(3) NULL,
        updated_at DATETIME(3) NOT NULL,
        UNIQUE KEY uq_case_mail_message (message_id),
        UNIQUE KEY uq_case_mail_trigger (case_id, trigger_message_id, event_type),
        INDEX idx_case_mail_events (case_id, created_at),
        INDEX idx_case_mail_status (event_type, status, created_at),
        CONSTRAINT fk_case_mail_event_case FOREIGN KEY (case_id)
          REFERENCES generated_cases(id) ON DELETE CASCADE,
        CONSTRAINT fk_case_mail_event_incoming FOREIGN KEY (incoming_request_id)
          REFERENCES incoming_requests(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await this.ensureUserPreferenceColumns();
    await this.ensureMailIntakeColumns();
    await this.pool.query(
      `INSERT INTO email_settings
        (id, email_address, username, incoming_host, incoming_port, incoming_secure,
         outgoing_host, outgoing_port, outgoing_secure, enabled, created_at, updated_at)
       VALUES (1, 'demo@macaosolutions.com', 'demo@macaosolutions.com',
         'mail.macaosolutions.com', 993, TRUE, 'mail.macaosolutions.com', 465, TRUE,
         TRUE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE id=id`,
    );
    await this.pool.query('DELETE FROM user_sessions WHERE expires_at <= UTC_TIMESTAMP(3)');
  }

  private async ensureUserPreferenceColumns(): Promise<void> {
    const columns = [
      ['auto_refresh_incoming', 'ALTER TABLE users ADD COLUMN auto_refresh_incoming BOOLEAN NOT NULL DEFAULT FALSE AFTER active'],
      ['auto_analyze_complete_cases', 'ALTER TABLE users ADD COLUMN auto_analyze_complete_cases BOOLEAN NOT NULL DEFAULT FALSE AFTER auto_refresh_incoming'],
    ] as const;
    for (const [columnName, statement] of columns) {
      const [rows] = await this.pool.query<RowDataPacket[]>(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME=? LIMIT 1`,
        [columnName],
      );
      if (!rows[0]) await this.pool.query(statement);
    }
  }

  private async ensureMailIntakeColumns(): Promise<void> {
    const [emailColumns] = await this.pool.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='email_settings'
         AND COLUMN_NAME='move_processed_to_trash' LIMIT 1`,
    );
    if (!emailColumns[0]) {
      await this.pool.query(
        'ALTER TABLE email_settings ADD COLUMN move_processed_to_trash BOOLEAN NOT NULL DEFAULT TRUE AFTER enabled',
      );
    }

    const [incomingColumns] = await this.pool.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='incoming_requests'
         AND COLUMN_NAME='source_moved_at' LIMIT 1`,
    );
    if (!incomingColumns[0]) {
      await this.pool.query(
        'ALTER TABLE incoming_requests ADD COLUMN source_moved_at DATETIME(3) NULL AFTER status',
      );
      await this.pool.query(
        'UPDATE incoming_requests SET source_moved_at=UTC_TIMESTAMP(3) WHERE source_moved_at IS NULL',
      );
    }
  }

  private async loadOrMigrateCases(): Promise<void> {
    const [caseRows] = await this.pool.query<PayloadRow[]>('SELECT payload FROM afpc_cases ORDER BY created_at');
    if (caseRows.length === 0) {
      const legacy = await this.readLegacyDatabase();
      await this.replaceCases(legacy);
    }
    await this.reloadState();
  }

  private async readLegacyDatabase(): Promise<DemoDatabase> {
    try {
      const raw = await readFile(path.join(this.dataDir, 'demo-db.json'), 'utf8');
      const parsed = JSON.parse(raw) as DemoDatabase;
      return parsed.version === 3 ? parsed : createSeedDatabase();
    } catch {
      return createSeedDatabase();
    }
  }

  private async reloadState(): Promise<void> {
    const [caseRows] = await this.pool.query<PayloadRow[]>('SELECT payload FROM afpc_cases ORDER BY created_at');
    const [auditRows] = await this.pool.query<AuditRow[]>(
      'SELECT id, case_id, action, label, actor, note, from_status, to_status, created_at FROM audit_events ORDER BY created_at',
    );
    this.state = {
      version: 3,
      cases: caseRows.map((row) => parsePayload<AfpcCase>(row.payload)),
      auditEvents: auditRows.map(asAudit),
    };
  }

  private async replaceCases(database: DemoDatabase): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query('DELETE FROM audit_events');
      await connection.query('DELETE FROM afpc_cases');
      for (const afpcCase of database.cases) await this.upsertCase(connection, afpcCase);
      for (const event of database.auditEvents) await this.insertAudit(connection, event);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private async upsertCase(connection: Pool | PoolConnection, afpcCase: AfpcCase): Promise<void> {
    await connection.query(
      `INSERT INTO afpc_cases
        (id, reference, status, client_name, agency, advisor, assignee, created_at, updated_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))
       ON DUPLICATE KEY UPDATE reference=VALUES(reference), status=VALUES(status),
         client_name=VALUES(client_name), agency=VALUES(agency), advisor=VALUES(advisor),
         assignee=VALUES(assignee), created_at=VALUES(created_at), updated_at=VALUES(updated_at),
         payload=VALUES(payload)`,
      [
        afpcCase.id,
        afpcCase.reference,
        afpcCase.status,
        afpcCase.client.fullName,
        afpcCase.agency,
        afpcCase.advisor,
        afpcCase.assignee,
        new Date(afpcCase.createdAt),
        new Date(afpcCase.updatedAt),
        JSON.stringify(afpcCase),
      ],
    );
  }

  private async insertAudit(connection: Pool | PoolConnection, event: AuditEvent): Promise<void> {
    await connection.query(
      `INSERT INTO audit_events
        (id, case_id, action, label, actor, note, from_status, to_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [event.id, event.caseId, event.action, event.label, event.actor, event.note ?? null,
        event.fromStatus ?? null, event.toStatus ?? null, new Date(event.createdAt)],
    );
  }

  listCases(): AfpcCase[] {
    return structuredClone(this.state.cases);
  }

  findCase(caseId: string): AfpcCase | undefined {
    const found = this.state.cases.find((item) => item.id === caseId);
    return found ? structuredClone(found) : undefined;
  }

  listAudit(caseId: string): AuditEvent[] {
    return structuredClone(
      this.state.auditEvents
        .filter((event) => event.caseId === caseId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }

  async saveCase(afpcCase: AfpcCase): Promise<AfpcCase> {
    await this.upsertCase(this.pool, afpcCase);
    const index = this.state.cases.findIndex((item) => item.id === afpcCase.id);
    if (index === -1) this.state.cases.push(structuredClone(afpcCase));
    else this.state.cases[index] = structuredClone(afpcCase);
    return structuredClone(afpcCase);
  }

  async addAudit(event: AuditInput): Promise<AuditEvent> {
    const complete: AuditEvent = {
      ...event,
      id: event.id ?? randomUUID(),
      createdAt: event.createdAt ?? new Date().toISOString(),
    };
    await this.insertAudit(this.pool, complete);
    this.state.auditEvents.push(structuredClone(complete));
    return structuredClone(complete);
  }

  async saveCaseAndAudit(
    afpcCase: AfpcCase,
    event: Omit<AuditEvent, 'id' | 'createdAt'>,
  ): Promise<AuditEvent> {
    const complete: AuditEvent = { ...event, id: randomUUID(), createdAt: new Date().toISOString() };
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await this.upsertCase(connection, afpcCase);
      await this.insertAudit(connection, complete);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    const index = this.state.cases.findIndex((item) => item.id === afpcCase.id);
    if (index === -1) this.state.cases.push(structuredClone(afpcCase));
    else this.state.cases[index] = structuredClone(afpcCase);
    this.state.auditEvents.push(structuredClone(complete));
    return structuredClone(complete);
  }

  async mutateCaseAndAudit(
    caseId: string,
    mutate: (current: AfpcCase) => AfpcCase,
    event: (current: AfpcCase, updated: AfpcCase) => Omit<AuditEvent, 'id' | 'createdAt'>,
  ): Promise<{ afpcCase: AfpcCase; auditEvent: AuditEvent }> {
    let result: { afpcCase: AfpcCase; auditEvent: AuditEvent } | undefined;
    const operation = this.mutationQueue.then(async () => {
      const current = this.findCase(caseId);
      if (!current) throw new Error(`No se encontró el caso ${caseId}.`);
      const updated = mutate(current);
      const auditEvent = await this.saveCaseAndAudit(updated, event(current, updated));
      result = { afpcCase: structuredClone(updated), auditEvent };
    });
    this.mutationQueue = operation.catch(() => undefined);
    await operation;
    if (!result) throw new Error('No fue posible actualizar el expediente.');
    return result;
  }

  async reset(): Promise<void> {
    const seed = createSeedDatabase();
    await this.replaceCases(seed);
    this.state = structuredClone(seed);
  }

  private async ensureBootstrapUser(): Promise<void> {
    const [rows] = await this.pool.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM users');
    if (Number(rows[0]?.total ?? 0) > 0 || !this.bootstrapUser) return;
    await this.createManagedUser(this.bootstrapUser);
  }

  async listUsers(): Promise<ManagedUser[]> {
    const [rows] = await this.pool.query<UserRow[]>(
      `SELECT id, username, display_name, role, password_salt, password_hash, active,
        auto_refresh_incoming, auto_analyze_complete_cases, created_at, updated_at
       FROM users ORDER BY active DESC, display_name ASC, username ASC`,
    );
    return rows.map((row) => this.managedUser(row));
  }

  async createManagedUser(user: CreateManagedUserInput): Promise<ManagedUser> {
    const username = user.username.trim().toLocaleLowerCase('es-HN');
    if (user.password.length < 12) throw new Error('La contraseña inicial debe tener al menos 12 caracteres.');
    const salt = randomBytes(16).toString('hex');
    const hash = await passwordHash(user.password, salt);
    const id = randomUUID();
    const now = new Date();
    await this.pool.query(
      `INSERT INTO users
        (id, username, display_name, role, password_salt, password_hash, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, TRUE, ?, ?)
      `,
      [id, username, user.displayName, user.role, salt, hash, now, now],
    );
    const [rows] = await this.pool.query<UserRow[]>(
      `SELECT id, username, display_name, role, password_salt, password_hash, active,
        auto_refresh_incoming, auto_analyze_complete_cases, created_at, updated_at
       FROM users WHERE id=?`,
      [id],
    );
    return this.managedUser(rows[0]);
  }

  async updateManagedUser(id: string, user: UpdateManagedUserInput): Promise<ManagedUser | undefined> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [existingRows] = await connection.query<UserRow[]>(
        `SELECT id, username, display_name, role, password_salt, password_hash, active,
          auto_refresh_incoming, auto_analyze_complete_cases, created_at, updated_at
         FROM users WHERE id=? FOR UPDATE`,
        [id],
      );
      const existing = existingRows[0];
      if (!existing) {
        await connection.rollback();
        return undefined;
      }

      if (existing.active && existing.role === 'ADMIN' && (!user.active || user.role !== 'ADMIN')) {
        const [adminRows] = await connection.query<RowDataPacket[]>(
          `SELECT id FROM users WHERE active=TRUE AND role='ADMIN' FOR UPDATE`,
        );
        if (adminRows.length <= 1) throw new UserManagementError('Debe conservar al menos un administrador activo.');
      }

      const username = user.username.trim().toLocaleLowerCase('es-HN');
      const salt = user.password ? randomBytes(16).toString('hex') : existing.password_salt;
      const hash = user.password ? await passwordHash(user.password, salt) : existing.password_hash;
      await connection.query(
        `UPDATE users SET username=?, display_name=?, role=?, active=?, password_salt=?, password_hash=?, updated_at=?
         WHERE id=?`,
        [username, user.displayName, user.role, user.active, salt, hash, new Date(), id],
      );
      if (user.password || !user.active) {
        await connection.query('DELETE FROM user_sessions WHERE user_id=?', [id]);
      }
      const [updatedRows] = await connection.query<UserRow[]>(
        `SELECT id, username, display_name, role, password_salt, password_hash, active,
          auto_refresh_incoming, auto_analyze_complete_cases, created_at, updated_at
         FROM users WHERE id=?`,
        [id],
      );
      await connection.commit();
      return this.managedUser(updatedRows[0]);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async deactivateManagedUser(id: string): Promise<ManagedUser | undefined> {
    const [rows] = await this.pool.query<UserRow[]>(
      `SELECT id, username, display_name, role, password_salt, password_hash, active,
        auto_refresh_incoming, auto_analyze_complete_cases, created_at, updated_at
       FROM users WHERE id=?`,
      [id],
    );
    const existing = rows[0];
    if (!existing) return undefined;
    return this.updateManagedUser(id, {
      username: existing.username,
      displayName: existing.display_name,
      role: existing.role,
      active: false,
    });
  }

  async authenticate(usernameInput: string, password: string): Promise<AuthUser | undefined> {
    const username = usernameInput.trim().toLocaleLowerCase('es-HN');
    const [rows] = await this.pool.query<UserRow[]>(
      `SELECT id, username, display_name, role, password_salt, password_hash,
        auto_refresh_incoming, auto_analyze_complete_cases
       FROM users WHERE username=? AND active=TRUE LIMIT 1`,
      [username],
    );
    const row = rows[0];
    if (!row) {
      await passwordHash(password || 'invalid-password', '00000000000000000000000000000000');
      return undefined;
    }
    const provided = Buffer.from(await passwordHash(password, row.password_salt), 'hex');
    const expected = Buffer.from(row.password_hash, 'hex');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return undefined;
    return this.publicUser(row);
  }

  async createSession(userId: string, rememberDevice: boolean): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (rememberDevice ? 30 : 0.5) * 24 * 60 * 60 * 1000);
    await this.pool.query(
      `INSERT INTO user_sessions
        (token_hash, user_id, remember_device, created_at, last_seen_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [tokenHash(token), userId, rememberDevice, now, now, expiresAt],
    );
    return { token, expiresAt };
  }

  async resolveSession(token: string | undefined): Promise<AuthUser | undefined> {
    if (!token) return undefined;
    const [rows] = await this.pool.query<UserRow[]>(
      `SELECT u.id, u.username, u.display_name, u.role, u.password_salt, u.password_hash,
        u.auto_refresh_incoming, u.auto_analyze_complete_cases
       FROM user_sessions s JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP(3) AND u.active=TRUE LIMIT 1`,
      [tokenHash(token)],
    );
    if (!rows[0]) return undefined;
    await this.pool.query('UPDATE user_sessions SET last_seen_at=UTC_TIMESTAMP(3) WHERE token_hash=?', [tokenHash(token)]);
    return this.publicUser(rows[0]);
  }

  async deleteSession(token: string | undefined): Promise<void> {
    if (token) await this.pool.query('DELETE FROM user_sessions WHERE token_hash=?', [tokenHash(token)]);
  }

  async updateUserPreferences(id: string, preferences: UserPreferences): Promise<AuthUser | undefined> {
    await this.pool.query(
      `UPDATE users SET auto_refresh_incoming=?, auto_analyze_complete_cases=?, updated_at=UTC_TIMESTAMP(3)
       WHERE id=? AND active=TRUE`,
      [preferences.autoRefreshIncoming, preferences.autoAnalyzeCompleteCases, id],
    );
    const [rows] = await this.pool.query<UserRow[]>(
      `SELECT id, username, display_name, role, password_salt, password_hash,
        auto_refresh_incoming, auto_analyze_complete_cases
       FROM users WHERE id=? AND active=TRUE LIMIT 1`,
      [id],
    );
    return rows[0] ? this.publicUser(rows[0]) : undefined;
  }

  async hasAutomaticAnalysisEnabled(): Promise<boolean> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT id FROM users
       WHERE active=TRUE AND auto_analyze_complete_cases=TRUE LIMIT 1`,
    );
    return Boolean(rows[0]);
  }

  private publicUser(row: UserRow | undefined): AuthUser {
    if (!row) throw new Error('No fue posible recuperar el usuario.');
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      autoRefreshIncoming: Boolean(row.auto_refresh_incoming),
      autoAnalyzeCompleteCases: Boolean(row.auto_analyze_complete_cases),
    };
  }

  private managedUser(row: UserRow | undefined): ManagedUser {
    if (!row) throw new Error('No fue posible recuperar el usuario.');
    return {
      ...this.publicUser(row),
      active: Boolean(row.active),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}

function requireCa(filePath: string): string {
  try {
    return requireCaFile(filePath);
  } catch (error) {
    throw new Error(`No fue posible leer el certificado CA de MySQL en ${filePath}.`, { cause: error });
  }
}

function requireCaFile(filePath: string): string {
  // mysql2 needs the PEM contents while pool creation remains synchronous.
  return readFileSync(filePath, 'utf8');
}
