import { describe, expect, it } from 'vitest';
import { inferDocumentType, supportedDocument } from './documentClassification';

describe('clasificación inicial de documentos', () => {
  it('reconoce los nombres usados por los tres paquetes de demostración', () => {
    expect(inferDocumentType('1. Solicitud de Afiliación.pdf')).toBe('AFFILIATION_FORM');
    expect(inferDocumentType('3. DNI Cliente.pdf')).toBe('IDENTITY');
    expect(inferDocumentType('4. RTN Cliente.jpg')).toBe('RTN');
    expect(inferDocumentType('5. Comprobante de depósito.pdf')).toBe('CONTRIBUTION_RECEIPT');
    expect(inferDocumentType('8. Informe Lexis Nexis.pdf')).toBe('SCREENING');
    expect(inferDocumentType('9.3 Búsqueda de Cautela por nombre.TXT')).toBe('SCREENING');
  });

  it('admite PDF, imágenes y texto', () => {
    expect(supportedDocument(new File(['x'], 'identidad.jpg', { type: 'image/jpeg' }))).toBe(true);
    expect(supportedDocument(new File(['x'], 'consulta.TXT', { type: '' }))).toBe(true);
    expect(supportedDocument(new File(['x'], 'manual.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))).toBe(false);
  });
});
