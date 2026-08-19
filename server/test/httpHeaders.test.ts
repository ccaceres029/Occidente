import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { inlineContentDisposition } from '../src/httpHeaders.js';

describe('encabezados de documentos', () => {
  test('genera un fallback ASCII y conserva el nombre Unicode codificado', () => {
    const filename = '6. Constancia De Educación Financiera.pdf';
    const header = inlineContentDisposition(filename);

    assert.match(header, /^inline; filename="6\. Constancia De Educacion Financiera\.pdf";/u);
    assert.match(header, /filename\*=UTF-8''6\.%20Constancia%20De%20Educacio%CC%81n%20Financiera\.pdf$/u);
    assert.equal([...header].every((character) => character.charCodeAt(0) <= 127), true);
  });
});
