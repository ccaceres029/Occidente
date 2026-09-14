import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { buildProjectPortal } from './app.js';
import { ProjectStore } from './store.js';

// Explicit portal settings only. Never read the affiliation application's secrets.
const env = process.env;
const demo = env.PORTAL_MODE === 'demo';
const host = env.PORTAL_HOST || '127.0.0.1';
const port = Number(env.PORTAL_PORT || 3012);
if (demo && !['127.0.0.1', '::1'].includes(host)) throw new Error('La demostración solo puede escuchar en loopback.');
if (!demo && (!env.PORTAL_DB_HOST || !env.PORTAL_DB_USER || !env.PORTAL_DB_PASSWORD || !env.PORTAL_DB_NAME || !env.PORTAL_ORIGIN?.startsWith('https://') || !env.PORTAL_DB_SSL_CA)) {
  throw new Error('Configura PORTAL_DB_HOST, USER, PASSWORD, NAME, SSL_CA y PORTAL_ORIGIN HTTPS, o usa PORTAL_MODE=demo local.');
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pool = demo ? undefined : mysql.createPool({ host: env.PORTAL_DB_HOST, port: Number(env.PORTAL_DB_PORT || 3306),
  user: env.PORTAL_DB_USER, password: env.PORTAL_DB_PASSWORD, database: env.PORTAL_DB_NAME, connectionLimit: 5,
  charset: 'utf8mb4', ssl: { ca: readFileSync(env.PORTAL_DB_SSL_CA!), rejectUnauthorized: true, minVersion: 'TLSv1.2' } });
const store = new ProjectStore(path.resolve(env.PORTAL_DATA_FILE || path.join(root, 'data/project-portal-demo.json')), pool);
const app = await buildProjectPortal({ store, demo, staticDir: path.resolve(root, '../portal'), origin: demo ? `http://127.0.0.1:${port}` : env.PORTAL_ORIGIN!,
  bootstrap: !demo && env.PORTAL_ADMIN_PASSWORD ? { username: env.PORTAL_ADMIN_USERNAME || 'admin', name: env.PORTAL_ADMIN_NAME || 'Coordinación MACAO', password: env.PORTAL_ADMIN_PASSWORD } : undefined });
await app.listen({ host, port });
console.log(`Portal de proyecto: ${demo ? 'DEMO LOCAL' : 'MYSQL'} · http://${host}:${port}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void app.close().then(() => process.exit(0)); });
