import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DocumentPreviewCache } from '../src/documentPreview.js';

const validPng = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('vista-previa-sintetica'),
]);

describe('caché local de vistas previas', () => {
  test('renderiza una sola vez y reutiliza la imagen persistida', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'occi-preview-cache-test-'));
    const sourcePath = path.join(dataDir, 'solicitud.pdf');
    await writeFile(sourcePath, Buffer.from('%PDF-1.4\n%%EOF\n'));
    let renderCount = 0;
    const cache = new DocumentPreviewCache({
      cacheDir: path.join(dataDir, 'cache'),
      renderer: async () => {
        renderCount += 1;
        return validPng;
      },
    });
    try {
      const first = await cache.get(sourcePath, 'case-001/solicitud.pdf', 1);
      const second = await cache.get(sourcePath, 'case-001/solicitud.pdf', 1);
      assert.equal(first.cacheStatus, 'miss');
      assert.equal(second.cacheStatus, 'hit');
      assert.equal(first.etag, second.etag);
      assert.deepEqual(second.buffer, validPng);
      assert.equal(renderCount, 1);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  test('deduplica solicitudes concurrentes e invalida al cambiar el archivo fuente', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'occi-preview-cache-test-'));
    const sourcePath = path.join(dataDir, 'solicitud.pdf');
    await writeFile(sourcePath, Buffer.from('%PDF-1.4\n%%EOF\n'));
    let renderCount = 0;
    const cache = new DocumentPreviewCache({
      cacheDir: path.join(dataDir, 'cache'),
      renderer: async () => {
        renderCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return validPng;
      },
    });
    try {
      const [first, concurrent] = await Promise.all([
        cache.get(sourcePath, 'case-001/solicitud.pdf', 1),
        cache.get(sourcePath, 'case-001/solicitud.pdf', 1),
      ]);
      assert.deepEqual(
        [first.cacheStatus, concurrent.cacheStatus].sort(),
        ['hit', 'miss'],
      );
      assert.equal(renderCount, 1);

      await writeFile(sourcePath, Buffer.from('%PDF-1.4\ncontenido-cambiado\n%%EOF\n'));
      const future = new Date(Date.now() + 1_000);
      await utimes(sourcePath, future, future);
      const changed = await cache.get(sourcePath, 'case-001/solicitud.pdf', 1);
      assert.equal(changed.cacheStatus, 'miss');
      assert.notEqual(changed.etag, first.etag);
      assert.equal(renderCount, 2);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  test('renderiza y reutiliza documentos recibidos directamente desde S3', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'occi-preview-buffer-test-'));
    let renderCount = 0;
    const cache = new DocumentPreviewCache({
      cacheDir: path.join(dataDir, 'cache'),
      renderer: async () => {
        renderCount += 1;
        return validPng;
      },
    });
    const pdf = Buffer.from('%PDF-1.4\ncontenido-s3\n%%EOF\n');
    try {
      const first = await cache.getBuffer(pdf, 'generated/case-001/checksum', 1);
      const second = await cache.getBuffer(pdf, 'generated/case-001/checksum', 1);
      assert.equal(first.cacheStatus, 'miss');
      assert.equal(second.cacheStatus, 'hit');
      assert.equal(first.etag, second.etag);
      assert.equal(renderCount, 1);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
