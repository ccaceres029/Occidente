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

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  sslCaPath?: string;
  connectionLimit: number;
}

export interface BootstrapUserConfig {
  username: string;
  password: string;
  displayName: string;
  role: string;
}

export interface MailRuntimeConfig {
  credentialsKey?: Buffer;
  syncIntervalSeconds: number;
}

function combinedEnvironment(): Record<string, string | undefined> {
  const configuredPath = process.env.MACAOIT_SECRETS_PATH?.trim() || CENTRAL_MACAOIT_ENV;
  return { ...parseEnvFile(configuredPath), ...process.env };
}

export function resolveDatabaseConfig(): DatabaseConfig | undefined {
  const env = combinedEnvironment();
  const host = env.DB_HOST?.trim() || env.RDS_HOST?.trim();
  const user = env.DB_USER?.trim() || env.RDS_USER?.trim();
  const password = env.DB_PASSWORD || env.RDS_PASSWORD;
  if (!host || !user || !password) return undefined;

  return {
    host,
    port: Number(env.DB_PORT || env.RDS_PORT || 3306),
    user,
    password,
    database: env.DB_NAME?.trim() || 'dbOccidente',
    sslCaPath: env.DB_SSL_CA?.trim() || undefined,
    connectionLimit: Number(env.DB_CONNECTION_LIMIT || 8),
  };
}

export function resolveBootstrapUser(): BootstrapUserConfig | undefined {
  const env = combinedEnvironment();
  const username = env.OCCIDENTE_BOOTSTRAP_USERNAME?.trim();
  const password = env.OCCIDENTE_BOOTSTRAP_PASSWORD;
  if (!username || !password) return undefined;
  return {
    username,
    password,
    displayName: env.OCCIDENTE_BOOTSTRAP_DISPLAY_NAME?.trim() || 'Administrador Occidente',
    role: env.OCCIDENTE_BOOTSTRAP_ROLE?.trim() || 'ADMIN',
  };
}

export function resolveMailRuntimeConfig(): MailRuntimeConfig {
  const env = combinedEnvironment();
  const encodedKey = env.MAIL_CREDENTIALS_KEY?.trim();
  let credentialsKey: Buffer | undefined;
  if (encodedKey) {
    const decoded = Buffer.from(encodedKey, 'base64');
    if (decoded.length !== 32) {
      throw new Error('MAIL_CREDENTIALS_KEY debe contener exactamente 32 bytes codificados en base64.');
    }
    credentialsKey = decoded;
  }
  return {
    credentialsKey,
    syncIntervalSeconds: Math.max(30, Number(env.MAIL_SYNC_INTERVAL_SECONDS || 60)),
  };
}

export function resolveGeminiConfig(): GeminiConfig {
  const central = parseEnvFile(process.env.MACAOIT_SECRETS_PATH?.trim() || CENTRAL_MACAOIT_ENV);
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
