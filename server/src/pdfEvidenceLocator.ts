import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type {
  AfpcCase,
  DocumentIntelligenceInsight,
  ExtractedDocumentField,
  NormalizedBoundingBox,
} from './types.js';

const execFileAsync = promisify(execFile);

export const PDF_EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
export const PDF_EVIDENCE_MAX_PAGES = 20;
export const PDF_EVIDENCE_TIMEOUT_MS = 5_000;
export const PDF_EVIDENCE_OCR_TIMEOUT_MS = 8_000;
const PDF_EVIDENCE_MAX_XML_BYTES = 8 * 1024 * 1024;
const PDF_EVIDENCE_OCR_MAX_BYTES = 8 * 1024 * 1024;
const PDF_EVIDENCE_OCR_DPI = 130;
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

interface PdfWord {
  text: string;
  normalized: string;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  line: number;
}

interface PdfPageText {
  page: number;
  width: number;
  height: number;
  words: PdfWord[];
}

export interface VerifiedPdfEvidence {
  page: number;
  boundingBox: NormalizedBoundingBox;
}

interface PdfEvidenceLocatorOptions {
  binaryPath?: string;
  rendererPath?: string;
  ocrBinaryPath?: string;
  ocrCacheDir?: string;
  ocrRunner?: (pdfPath: string, pages: number[]) => Promise<PdfPageText[]>;
}

interface OcrPayload {
  width: number;
  height: number;
  words: Array<Omit<PdfWord, 'normalized'>>;
}

const executableCandidates = () => [
  process.env.PDFTOTEXT_PATH,
  path.join(
    homedir(),
    '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/poppler/bin/pdftotext',
  ),
  '/opt/homebrew/bin/pdftotext',
  '/usr/local/bin/pdftotext',
  '/usr/bin/pdftotext',
  'pdftotext',
].filter((candidate): candidate is string => Boolean(candidate));

const rendererCandidates = () => [
  process.env.PDFTOPPM_PATH,
  path.join(
    homedir(),
    '.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/pdftoppm',
  ),
  '/opt/homebrew/bin/pdftoppm',
  '/usr/local/bin/pdftoppm',
  '/usr/bin/pdftoppm',
  'pdftoppm',
].filter((candidate): candidate is string => Boolean(candidate));

const normalizeWord = (value: string) =>
  value
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036f]/gu, '')
    .replaceAll(/[^a-zA-Z0-9]/gu, '')
    .toLocaleLowerCase('es-HN');

const decodeXml = (value: string) =>
  value
    .replaceAll(/<[^>]+>/gu, '')
    .replaceAll(/&#x([0-9a-f]+);/giu, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replaceAll(/&#([0-9]+);/gu, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");

const numericAttribute = (tag: string, name: string) => {
  const match = tag.match(new RegExp(`${name}="([0-9.]+)"`, 'u'));
  return match ? Number(match[1]) : Number.NaN;
};

export function parsePdftotextBoundingBoxes(xml: string): PdfPageText[] {
  const pages: PdfPageText[] = [];
  const pagePattern = /<page\s+([^>]+)>([\s\S]*?)<\/page>/gu;
  let pageMatch: RegExpExecArray | null;
  while ((pageMatch = pagePattern.exec(xml))) {
    const width = numericAttribute(pageMatch[1], 'width');
    const height = numericAttribute(pageMatch[1], 'height');
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) continue;
    const words: PdfWord[] = [];
    const linePattern = /<line\s[^>]*>([\s\S]*?)<\/line>/gu;
    let lineMatch: RegExpExecArray | null;
    let line = 0;
    while ((lineMatch = linePattern.exec(pageMatch[2]))) {
      const wordPattern = /<word\s+([^>]+)>([\s\S]*?)<\/word>/gu;
      let wordMatch: RegExpExecArray | null;
      while ((wordMatch = wordPattern.exec(lineMatch[1]))) {
        const text = decodeXml(wordMatch[2]).trim();
        const normalized = normalizeWord(text);
        const xMin = numericAttribute(wordMatch[1], 'xMin');
        const yMin = numericAttribute(wordMatch[1], 'yMin');
        const xMax = numericAttribute(wordMatch[1], 'xMax');
        const yMax = numericAttribute(wordMatch[1], 'yMax');
        if (!normalized || ![xMin, yMin, xMax, yMax].every(Number.isFinite)) continue;
        words.push({ text, normalized, xMin, yMin, xMax, yMax, line });
      }
      line += 1;
    }
    pages.push({ page: pages.length + 1, width, height, words });
  }
  return pages;
}

const normalizedTokens = (value: string) =>
  value
    .split(/\s+/u)
    .map(normalizeWord)
    .filter(Boolean);

interface FieldSearchTarget {
  tokens: string[];
  match: 'exact' | 'suffix';
}

const fieldSearchValues = (field: ExtractedDocumentField): FieldSearchTarget[] => {
  if (field.value === null || typeof field.value === 'boolean') return [];
  if (typeof field.value === 'string') {
    if (field.value.includes('*')) {
      const visibleTail = normalizeWord(field.value).slice(-4);
      return visibleTail.length === 4 ? [{ tokens: [visibleTail], match: 'suffix' }] : [];
    }
    const tokens = normalizedTokens(field.value);
    return tokens.length > 0 ? [{ tokens, match: 'exact' }] : [];
  }
  if (typeof field.value === 'number' && Number.isFinite(field.value)) {
    const variants = [String(field.value), field.value.toFixed(2)]
      .map(normalizedTokens)
      .filter((tokens) => tokens.length > 0);
    return variants.filter(
      (tokens, index) => variants.findIndex((candidate) => candidate.join('|') === tokens.join('|')) === index,
    ).map((tokens) => ({ tokens, match: 'suffix' }));
  }
  return [];
};

const clamp = (value: number) => Math.min(1, Math.max(0, value));

function findFieldOnPages(
  pages: PdfPageText[],
  field: ExtractedDocumentField,
): VerifiedPdfEvidence | undefined {
  const targets = fieldSearchValues(field);
  if (targets.length === 0) return undefined;
  const labelTokens = new Set(normalizedTokens(field.label));
  let best:
    | { score: number; page: PdfPageText; words: PdfWord[] }
    | undefined;

  for (const page of pages) {
    for (const target of targets) {
      for (let index = 0; index <= page.words.length - target.tokens.length; index += 1) {
        const matched = page.words.slice(index, index + target.tokens.length);
        if (!matched.every((word, offset) =>
          target.match === 'suffix'
            ? word.normalized.endsWith(target.tokens[offset])
            : word.normalized === target.tokens[offset],
        )) continue;
        if (!matched.every((word) => word.line === matched[0].line)) continue;
        const lineWords = page.words.filter((word) => word.line === matched[0].line);
        const labelMatches = lineWords.filter((word) => labelTokens.has(word.normalized)).length;
        const score = labelMatches * 5 + (page.page === field.page ? 2 : 0) - index / 100_000;
        if (!best || score > best.score) best = { score, page, words: matched };
      }
    }
  }
  if (!best) return undefined;
  const padding = 2;
  const xMin = Math.min(...best.words.map((word) => word.xMin)) - padding;
  const yMin = Math.min(...best.words.map((word) => word.yMin)) - padding;
  const xMax = Math.max(...best.words.map((word) => word.xMax)) + padding;
  const yMax = Math.max(...best.words.map((word) => word.yMax)) + padding;
  const x = clamp(xMin / best.page.width);
  const y = clamp(yMin / best.page.height);
  return {
    page: best.page.page,
    boundingBox: {
      x,
      y,
      width: clamp(xMax / best.page.width) - x,
      height: clamp(yMax / best.page.height) - y,
    },
  };
}

async function resolvePdftotext(explicitPath?: string): Promise<string | undefined> {
  return resolveExecutable(explicitPath ? [explicitPath] : executableCandidates());
}

async function resolveExecutable(candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (!candidate.includes(path.sep)) return candidate;
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Continue with the next local installation candidate.
    }
  }
  return undefined;
}

async function compileVisionOcr(cacheDir: string, explicitPath?: string): Promise<string | undefined> {
  if (process.platform !== 'darwin') return undefined;
  if (explicitPath) return resolveExecutable([explicitPath]);
  const sourcePath = path.resolve(moduleDir, '../native/VisionOcr.swift');
  try {
    await access(sourcePath, fsConstants.R_OK);
    await mkdir(cacheDir, { recursive: true });
    const binaryPath = path.join(cacheDir, 'vision-ocr');
    const [source, binary] = await Promise.all([
      stat(sourcePath),
      stat(binaryPath).catch(() => undefined),
    ]);
    if (!binary || binary.mtimeMs < source.mtimeMs) {
      await execFileAsync('/usr/bin/swiftc', ['-O', sourcePath, '-o', binaryPath], {
        timeout: 25_000,
        maxBuffer: 1_000_000,
        windowsHide: true,
      });
    }
    return binaryPath;
  } catch {
    return undefined;
  }
}

export class PdfEvidenceLocator {
  private readonly binaryPath?: string;
  private readonly rendererPath?: string;
  private readonly ocrBinaryPath?: string;
  private readonly ocrCacheDir: string;
  private readonly ocrRunner?: (pdfPath: string, pages: number[]) => Promise<PdfPageText[]>;
  private readonly cache = new Map<string, Promise<PdfPageText[] | undefined>>();
  private ocrExecutable?: Promise<string | undefined>;

  constructor(options: PdfEvidenceLocatorOptions = {}) {
    this.binaryPath = options.binaryPath;
    this.rendererPath = options.rendererPath;
    this.ocrBinaryPath = options.ocrBinaryPath;
    this.ocrCacheDir = options.ocrCacheDir ?? path.join(homedir(), '.cache', 'afpc-occidente-demo', 'ocr');
    this.ocrRunner = options.ocrRunner;
  }

  private async runLocalOcr(pdfPath: string, pages: number[]): Promise<PdfPageText[]> {
    if (this.ocrRunner) return this.ocrRunner(pdfPath, pages);
    if (pages.length === 0 || process.platform !== 'darwin') return [];
    const renderer = await resolveExecutable(this.rendererPath ? [this.rendererPath] : rendererCandidates());
    this.ocrExecutable ??= compileVisionOcr(this.ocrCacheDir, this.ocrBinaryPath);
    const ocr = await this.ocrExecutable;
    if (!renderer || !ocr) return [];
    const temporaryDir = await mkdtemp(path.join(this.ocrCacheDir, 'run-'));
    try {
      const results: PdfPageText[] = [];
      for (const page of pages) {
        const outputPrefix = path.join(temporaryDir, `page-${page}`);
        await execFileAsync(
          renderer,
          ['-f', String(page), '-l', String(page), '-singlefile', '-jpeg', '-jpegopt', 'quality=82', '-r', String(PDF_EVIDENCE_OCR_DPI), pdfPath, outputPrefix],
          { timeout: PDF_EVIDENCE_OCR_TIMEOUT_MS, maxBuffer: 1_000_000, windowsHide: true },
        );
        const { stdout } = await execFileAsync(ocr, [`${outputPrefix}.jpg`], {
          encoding: 'utf8',
          timeout: PDF_EVIDENCE_OCR_TIMEOUT_MS,
          maxBuffer: PDF_EVIDENCE_OCR_MAX_BYTES,
          windowsHide: true,
        });
        const payload = JSON.parse(stdout) as OcrPayload;
        if (!Number.isFinite(payload.width) || !Number.isFinite(payload.height) || !Array.isArray(payload.words)) continue;
        results.push({
          page,
          width: payload.width,
          height: payload.height,
          words: payload.words
            .filter((word) => word.text && [word.xMin, word.yMin, word.xMax, word.yMax, word.line].every(Number.isFinite))
            .map((word) => ({ ...word, normalized: normalizeWord(word.text) }))
            .filter((word) => word.normalized),
        });
      }
      return results;
    } catch {
      return [];
    } finally {
      await rm(temporaryDir, { recursive: true, force: true });
    }
  }

  private async readPages(
    pdfPath: string,
    fields: ExtractedDocumentField[],
  ): Promise<PdfPageText[] | undefined> {
    let metadata;
    try {
      metadata = await stat(pdfPath);
    } catch {
      return undefined;
    }
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > PDF_EVIDENCE_MAX_BYTES) return undefined;
    const relevantPages = Array.from(
      new Set(
        fields
          .map((field) => field.page)
          .filter((page) => Number.isInteger(page) && page >= 1 && page <= PDF_EVIDENCE_MAX_PAGES),
      ),
    ).sort((a, b) => a - b);
    const cacheKey = `${pdfPath}:${metadata.size}:${metadata.mtimeMs}:${relevantPages.join(',')}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const pending = (async () => {
      const executable = await resolvePdftotext(this.binaryPath);
      const requestedPages = relevantPages.length > 0 ? relevantPages : [1];
      if (!executable) return this.runLocalOcr(pdfPath, requestedPages);
      try {
        const { stdout } = await execFileAsync(
          executable,
          ['-f', '1', '-l', String(PDF_EVIDENCE_MAX_PAGES), '-bbox-layout', pdfPath, '-'],
          {
            encoding: 'utf8',
            timeout: PDF_EVIDENCE_TIMEOUT_MS,
            maxBuffer: PDF_EVIDENCE_MAX_XML_BYTES,
            windowsHide: true,
          },
        );
        const pages = parsePdftotextBoundingBoxes(stdout);
        const missingPages = requestedPages.filter(
          (page) => !pages.some((candidate) => candidate.page === page && candidate.words.length > 0),
        );
        if (missingPages.length === 0) return pages;
        const ocrPages = await this.runLocalOcr(pdfPath, missingPages);
        if (ocrPages.length === 0) return pages;
        const byPage = new Map(pages.map((page) => [page.page, page]));
        for (const page of ocrPages) byPage.set(page.page, page);
        return [...byPage.values()].sort((left, right) => left.page - right.page);
      } catch {
        return this.runLocalOcr(pdfPath, requestedPages);
      }
    })();
    this.cache.set(cacheKey, pending);
    return pending;
  }

  async locate(pdfPath: string, fields: ExtractedDocumentField[]): Promise<Map<string, VerifiedPdfEvidence>> {
    const pages = await this.readPages(pdfPath, fields);
    const locations = new Map<string, VerifiedPdfEvidence>();
    if (!pages?.length) return locations;
    for (const field of fields) {
      const found = findFieldOnPages(pages, field);
      if (found) locations.set(field.id, found);
    }
    return locations;
  }

  clear(): void {
    this.cache.clear();
    this.ocrExecutable = undefined;
  }
}

export async function applyVerifiedPdfEvidence(
  insight: DocumentIntelligenceInsight,
  afpcCase: AfpcCase,
  uploadsDir: string,
  locator: PdfEvidenceLocator,
): Promise<DocumentIntelligenceInsight> {
  const uploadsRoot = path.resolve(uploadsDir);
  const uploadedPdfs = afpcCase.documents.filter(
    (document) => document.mimeType === 'application/pdf' && document.storageKey,
  );
  const fieldLocations = new Map<string, VerifiedPdfEvidence>();

  await Promise.all(
    uploadedPdfs.map(async (document) => {
      const sourcePath = path.resolve(uploadsRoot, document.storageKey!);
      if (!sourcePath.startsWith(`${uploadsRoot}${path.sep}`)) return;
      const fields = insight.extractedFields.filter((field) => field.documentId === document.id);
      const locations = await locator.locate(sourcePath, fields);
      for (const [fieldId, location] of locations) fieldLocations.set(fieldId, location);
    }),
  );

  return {
    ...insight,
    extractedFields: insight.extractedFields.map((field) => {
      const location = fieldLocations.get(field.id);
      if (!location) {
        const { boundingBox: _syntheticBox, ...withoutBox } = field;
        return { ...withoutBox, evidenceLocation: 'unavailable' };
      }
      return {
        ...field,
        page: location.page,
        boundingBox: location.boundingBox,
        evidenceLocation: 'verified-pdf-text',
      };
    }),
  };
}
