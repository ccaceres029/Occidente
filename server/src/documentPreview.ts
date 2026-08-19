import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CACHE_VERSION = 'pdf-preview-v3-sips-pdftoppm';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const DOCUMENT_PREVIEW_MAX_PAGE = 50;

export interface DocumentPreviewResult {
  buffer: Buffer;
  cacheStatus: 'hit' | 'miss';
  etag: string;
}

type PreviewRenderer = (sourcePath: string, page: number) => Promise<Buffer>;

export interface DocumentPreviewCacheOptions {
  cacheDir: string;
  renderer?: PreviewRenderer;
  maxFiles?: number;
}

async function renderWithPdftoppm(sourcePath: string, page: number, outputPath: string): Promise<void> {
  const outputPrefix = outputPath.slice(0, -4);
  await execFileAsync(
    'pdftoppm',
    ['-f', String(page), '-l', String(page), '-singlefile', '-png', '-scale-to', '1200', sourcePath, outputPrefix],
    { timeout: 12_000, maxBuffer: 2 * 1024 * 1024 },
  );
}

async function renderPdfPage(sourcePath: string, page: number): Promise<Buffer> {
  const renderDir = await mkdtemp(path.join(tmpdir(), 'occi-document-preview-'));
  const outputPath = path.join(renderDir, 'page.png');
  try {
    if (process.platform === 'darwin' && page === 1) {
      try {
        await execFileAsync(
          'sips',
          ['-s', 'format', 'png', sourcePath, '--out', outputPath],
          { timeout: 5_000, maxBuffer: 2 * 1024 * 1024 },
        );
      } catch {
        await renderWithPdftoppm(sourcePath, page, outputPath);
      }
    } else {
      await renderWithPdftoppm(sourcePath, page, outputPath);
    }
    return await readFile(outputPath);
  } finally {
    await rm(renderDir, { recursive: true, force: true });
  }
}

function isPng(buffer: Buffer): boolean {
  return buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

export class DocumentPreviewCache {
  private readonly cacheDir: string;
  private readonly renderer: PreviewRenderer;
  private readonly maxFiles: number;
  private readonly inFlight = new Map<string, Promise<Buffer>>();

  constructor(options: DocumentPreviewCacheOptions) {
    this.cacheDir = options.cacheDir;
    this.renderer = options.renderer ?? renderPdfPage;
    this.maxFiles = options.maxFiles ?? 200;
  }

  async get(sourcePath: string, storageKey: string, page: number): Promise<DocumentPreviewResult> {
    const source = await stat(sourcePath);
    if (!source.isFile() || source.size === 0) {
      throw new Error('El archivo fuente no está disponible o está vacío.');
    }
    const fingerprint = createHash('sha256')
      .update(CACHE_VERSION)
      .update('\0')
      .update(storageKey)
      .update('\0')
      .update(String(source.size))
      .update('\0')
      .update(String(source.mtimeMs))
      .update('\0')
      .update(String(page))
      .digest('hex');
    const cachePath = path.join(this.cacheDir, `${fingerprint}.png`);
    const etag = `"preview-${fingerprint}"`;

    const cached = await this.readCached(cachePath);
    if (cached) return { buffer: cached, cacheStatus: 'hit', etag };

    const activeRender = this.inFlight.get(cachePath);
    if (activeRender) return { buffer: await activeRender, cacheStatus: 'hit', etag };

    const render = this.renderAndPersist(sourcePath, page, cachePath);
    this.inFlight.set(cachePath, render);
    try {
      return { buffer: await render, cacheStatus: 'miss', etag };
    } finally {
      this.inFlight.delete(cachePath);
    }
  }

  async getBuffer(source: Buffer, storageKey: string, page: number): Promise<DocumentPreviewResult> {
    if (source.length === 0) throw new Error('El archivo fuente está vacío.');
    const fingerprint = createHash('sha256')
      .update(CACHE_VERSION)
      .update('\0buffer\0')
      .update(storageKey)
      .update('\0')
      .update(createHash('sha256').update(source).digest())
      .update('\0')
      .update(String(page))
      .digest('hex');
    const cachePath = path.join(this.cacheDir, `${fingerprint}.png`);
    const etag = `"preview-${fingerprint}"`;

    const cached = await this.readCached(cachePath);
    if (cached) return { buffer: cached, cacheStatus: 'hit', etag };

    const activeRender = this.inFlight.get(cachePath);
    if (activeRender) return { buffer: await activeRender, cacheStatus: 'hit', etag };

    const render = this.renderBufferAndPersist(source, page, cachePath);
    this.inFlight.set(cachePath, render);
    try {
      return { buffer: await render, cacheStatus: 'miss', etag };
    } finally {
      this.inFlight.delete(cachePath);
    }
  }

  async clear(): Promise<void> {
    await rm(this.cacheDir, { recursive: true, force: true });
    await mkdir(this.cacheDir, { recursive: true });
  }

  private async readCached(cachePath: string): Promise<Buffer | undefined> {
    try {
      const cached = await readFile(cachePath);
      if (isPng(cached)) return cached;
      await rm(cachePath, { force: true });
      return undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private async renderAndPersist(sourcePath: string, page: number, cachePath: string): Promise<Buffer> {
    const rendered = await this.renderer(sourcePath, page);
    if (!isPng(rendered)) throw new Error('El motor local no produjo una imagen PNG válida.');
    if (rendered.length > 15 * 1024 * 1024) {
      throw new Error('La vista previa generada supera el límite permitido.');
    }
    await mkdir(this.cacheDir, { recursive: true });
    const temporaryPath = `${cachePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, rendered);
      await rename(temporaryPath, cachePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
    void this.prune().catch(() => undefined);
    return rendered;
  }

  private async renderBufferAndPersist(source: Buffer, page: number, cachePath: string): Promise<Buffer> {
    const sourceDir = await mkdtemp(path.join(tmpdir(), 'occi-document-source-'));
    const sourcePath = path.join(sourceDir, 'document.pdf');
    try {
      await writeFile(sourcePath, source);
      return await this.renderAndPersist(sourcePath, page, cachePath);
    } finally {
      await rm(sourceDir, { recursive: true, force: true });
    }
  }

  private async prune(): Promise<void> {
    const entries = (await readdir(this.cacheDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.png'));
    if (entries.length <= this.maxFiles) return;
    const dated = await Promise.all(entries.map(async (entry) => {
      const filePath = path.join(this.cacheDir, entry.name);
      return { filePath, mtimeMs: (await stat(filePath)).mtimeMs };
    }));
    dated.sort((left, right) => left.mtimeMs - right.mtimeMs);
    await Promise.all(dated.slice(0, dated.length - this.maxFiles).map(({ filePath }) => rm(filePath, { force: true })));
  }
}
