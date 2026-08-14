import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createSeedDatabase } from './seed.js';
import type { AfpcCase, AuditEvent, DemoDatabase } from './types.js';

export class JsonStore {
  readonly dataDir: string;
  readonly databasePath: string;
  readonly uploadsDir: string;
  private state: DemoDatabase | undefined;
  private writeQueue: Promise<void> = Promise.resolve();
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.databasePath = path.join(dataDir, 'demo-db.json');
    this.uploadsDir = path.join(dataDir, 'uploads');
  }

  async initialize(): Promise<void> {
    await mkdir(this.uploadsDir, { recursive: true });
    try {
      const raw = await readFile(this.databasePath, 'utf8');
      const parsed = JSON.parse(raw) as DemoDatabase;
      this.state = parsed.version === 3 ? parsed : createSeedDatabase();
      if (parsed.version !== 3) await this.persist();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;
      this.state = createSeedDatabase();
      await this.persist();
    }
  }

  private database(): DemoDatabase {
    if (!this.state) throw new Error('La base local aún no fue inicializada.');
    return this.state;
  }

  private async persist(): Promise<void> {
    const payload = `${JSON.stringify(this.database(), null, 2)}\n`;
    this.writeQueue = this.writeQueue.then(async () => {
      const temporaryPath = `${this.databasePath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, payload, 'utf8');
      await rename(temporaryPath, this.databasePath);
    });
    await this.writeQueue;
  }

  listCases(): AfpcCase[] {
    return structuredClone(this.database().cases);
  }

  findCase(caseId: string): AfpcCase | undefined {
    const found = this.database().cases.find((item) => item.id === caseId);
    return found ? structuredClone(found) : undefined;
  }

  listAudit(caseId: string): AuditEvent[] {
    return structuredClone(
      this.database().auditEvents
        .filter((event) => event.caseId === caseId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }

  async saveCase(afpcCase: AfpcCase): Promise<AfpcCase> {
    const database = this.database();
    const index = database.cases.findIndex((item) => item.id === afpcCase.id);
    if (index === -1) database.cases.push(structuredClone(afpcCase));
    else database.cases[index] = structuredClone(afpcCase);
    await this.persist();
    return structuredClone(afpcCase);
  }

  async addAudit(event: Omit<AuditEvent, 'id' | 'createdAt'> & Partial<Pick<AuditEvent, 'id' | 'createdAt'>>): Promise<AuditEvent> {
    const complete: AuditEvent = {
      ...event,
      id: event.id ?? randomUUID(),
      createdAt: event.createdAt ?? new Date().toISOString(),
    };
    this.database().auditEvents.push(complete);
    await this.persist();
    return structuredClone(complete);
  }

  async saveCaseAndAudit(
    afpcCase: AfpcCase,
    event: Omit<AuditEvent, 'id' | 'createdAt'>,
  ): Promise<AuditEvent> {
    const database = this.database();
    const index = database.cases.findIndex((item) => item.id === afpcCase.id);
    if (index === -1) database.cases.push(structuredClone(afpcCase));
    else database.cases[index] = structuredClone(afpcCase);
    const complete: AuditEvent = {
      ...event,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    database.auditEvents.push(complete);
    await this.persist();
    return structuredClone(complete);
  }

  async mutateCaseAndAudit(
    caseId: string,
    mutate: (current: AfpcCase) => AfpcCase,
    event: (current: AfpcCase, updated: AfpcCase) => Omit<AuditEvent, 'id' | 'createdAt'>,
  ): Promise<{ afpcCase: AfpcCase; auditEvent: AuditEvent }> {
    let result: { afpcCase: AfpcCase; auditEvent: AuditEvent } | undefined;
    const operation = this.mutationQueue.then(async () => {
      const database = this.database();
      const index = database.cases.findIndex((item) => item.id === caseId);
      if (index === -1) throw new Error(`No se encontró el caso ${caseId}.`);
      const current = structuredClone(database.cases[index]);
      const updated = mutate(current);
      const complete: AuditEvent = {
        ...event(current, updated),
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      };
      database.cases[index] = structuredClone(updated);
      database.auditEvents.push(complete);
      await this.persist();
      result = { afpcCase: structuredClone(updated), auditEvent: structuredClone(complete) };
    });
    this.mutationQueue = operation.catch(() => undefined);
    await operation;
    if (!result) throw new Error('No fue posible actualizar el expediente.');
    return result;
  }

  async reset(): Promise<void> {
    this.state = createSeedDatabase();
    await this.persist();
  }
}
