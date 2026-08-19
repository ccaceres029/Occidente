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
}

interface UserRow extends RowDataPacket {
  id: string;
  username: string;
  display_name: string;
  role: string;
  password_salt: string;
  password_hash: string;
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
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        INDEX idx_incoming_received (received_at),
        INDEX idx_incoming_status_received (status, received_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
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
    await this.createUser(this.bootstrapUser);
  }

  async createUser(user: BootstrapUserConfig): Promise<AuthUser> {
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
       ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), role=VALUES(role),
         password_salt=VALUES(password_salt), password_hash=VALUES(password_hash), active=TRUE,
         updated_at=VALUES(updated_at)`,
      [id, username, user.displayName, user.role, salt, hash, now, now],
    );
    const [rows] = await this.pool.query<UserRow[]>(
      'SELECT id, username, display_name, role, password_salt, password_hash FROM users WHERE username=?',
      [username],
    );
    return this.publicUser(rows[0]);
  }

  async authenticate(usernameInput: string, password: string): Promise<AuthUser | undefined> {
    const username = usernameInput.trim().toLocaleLowerCase('es-HN');
    const [rows] = await this.pool.query<UserRow[]>(
      `SELECT id, username, display_name, role, password_salt, password_hash
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
      `SELECT u.id, u.username, u.display_name, u.role, u.password_salt, u.password_hash
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

  private publicUser(row: UserRow | undefined): AuthUser {
    if (!row) throw new Error('No fue posible recuperar el usuario.');
    return { id: row.id, username: row.username, displayName: row.display_name, role: row.role };
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
