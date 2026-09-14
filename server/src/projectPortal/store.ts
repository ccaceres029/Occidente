import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { seedProject, type Project } from './model.js';

// One project aggregate, atomically committed with its audit trail. MySQL row locking
// prevents lost writes across processes; local JSON is single-process development only.
export class ProjectStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private file: string, private pool?: Pool) {}
  async initialize() {
    if (this.pool) {
      await this.pool.query(`CREATE TABLE IF NOT EXISTS macao_project_portal (
        id VARCHAR(64) PRIMARY KEY, payload JSON NOT NULL, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await this.pool.execute('INSERT IGNORE INTO macao_project_portal (id,payload) VALUES (?,?)', ['afp-occidente', JSON.stringify(seedProject())]);
    } else {
      await mkdir(path.dirname(this.file), { recursive: true });
      try { await this.read(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await this.persist(seedProject()); }
    }
  }
  async read(): Promise<Project> {
    let p: Project;
    if (this.pool) {
      const [rows] = await this.pool.execute<RowDataPacket[]>('SELECT payload FROM macao_project_portal WHERE id=?', ['afp-occidente']);
      p = typeof rows[0]?.payload === 'string' ? JSON.parse(rows[0].payload) : rows[0]?.payload;
    } else p = JSON.parse(await readFile(this.file, 'utf8'));
    if (p?.schema !== 1 || !Array.isArray(p.tasks) || !Array.isArray(p.members)) throw new Error('Formato de proyecto no compatible.');
    return p;
  }
  private async persist(p: Project) {
    const temp = `${this.file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(p, null, 2), { mode: 0o600 });
    await rename(temp, this.file);
  }
  async mutate<T>(fn: (p: Project) => T | Promise<T>): Promise<T> {
    if (this.pool) {
      const c = await this.pool.getConnection();
      try {
        await c.beginTransaction();
        const [rows] = await c.execute<RowDataPacket[]>('SELECT payload FROM macao_project_portal WHERE id=? FOR UPDATE', ['afp-occidente']);
        const p: Project = typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
        const result = await fn(p);
        await c.execute('UPDATE macao_project_portal SET payload=? WHERE id=?', [JSON.stringify(p), 'afp-occidente']);
        await c.commit(); return result;
      } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
    }
    const result = this.queue.then(async () => { const p = await this.read(); const value = await fn(p); await this.persist(p); return value; });
    this.queue = result.catch(() => undefined); return result;
  }
  async close() { await this.queue; await this.pool?.end(); }
}
