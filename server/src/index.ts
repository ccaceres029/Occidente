import { buildApp } from './app.js';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST?.trim() || '127.0.0.1';
const app = await buildApp({ logger: true });

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
