import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { resolveCorsOriginConfig } from '../src/config.js';

describe('configuración HTTP', () => {
  test('restringe CORS por defecto en producción', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalAllowed = process.env.OCCIDENTE_ALLOWED_ORIGINS;
    const originalCors = process.env.CORS_ALLOWED_ORIGINS;
    try {
      process.env.NODE_ENV = 'production';
      process.env.OCCIDENTE_ALLOWED_ORIGINS = '';
      process.env.CORS_ALLOWED_ORIGINS = '';

      assert.deepEqual(resolveCorsOriginConfig(), ['https://occidente.appsmacao.biz']);
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalAllowed === undefined) delete process.env.OCCIDENTE_ALLOWED_ORIGINS;
      else process.env.OCCIDENTE_ALLOWED_ORIGINS = originalAllowed;
      if (originalCors === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
      else process.env.CORS_ALLOWED_ORIGINS = originalCors;
    }
  });

  test('acepta una lista explícita de orígenes', () => {
    const originalAllowed = process.env.OCCIDENTE_ALLOWED_ORIGINS;
    try {
      process.env.OCCIDENTE_ALLOWED_ORIGINS = 'https://occidente.appsmacao.biz, http://127.0.0.1:5173';

      assert.deepEqual(resolveCorsOriginConfig(), [
        'https://occidente.appsmacao.biz',
        'http://127.0.0.1:5173',
      ]);
    } finally {
      if (originalAllowed === undefined) delete process.env.OCCIDENTE_ALLOWED_ORIGINS;
      else process.env.OCCIDENTE_ALLOWED_ORIGINS = originalAllowed;
    }
  });
});
