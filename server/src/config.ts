import { readFileSync } from 'node:fs';

const CENTRAL_MACAOIT_ENV =
  '/Users/arturocaceres/Documents/MACAO Solutions DEV/MACAO Tecnico/MACAOIT_LOCAL_SECRETS.env';

function parseEnvFile(filePath: string): Record<string, string> {
  try {
    const parsed: Record<string, string> = {};
    for (const sourceLine of readFileSync(filePath, 'utf8').split(/\r?\n/u)) {
      const line = sourceLine.trim();
      if (!line || line.startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      const value = line
        .slice(separator + 1)
        .trim()
        .replace(/^(['"])(.*)\1$/u, '$2');
      parsed[key] = value;
    }
    return parsed;
  } catch {
    return {};
  }
}

export interface GeminiConfig {
  apiKey?: string;
  model: string;
  configured: boolean;
  source: 'process' | 'macaoit' | 'none';
}

export function resolveGeminiConfig(): GeminiConfig {
  const central = parseEnvFile(CENTRAL_MACAOIT_ENV);
  const processKey = process.env.GEMINI_API_KEY?.trim();
  const centralKey = central.GEMINI_API_KEY?.trim();
  const apiKey = processKey || centralKey || undefined;
  const model =
    process.env.GEMINI_MODEL?.trim() || central.GEMINI_MODEL?.trim() || 'gemini-2.5-flash-lite';

  return {
    apiKey,
    model,
    configured: Boolean(apiKey),
    source: processKey ? 'process' : centralKey ? 'macaoit' : 'none',
  };
}
