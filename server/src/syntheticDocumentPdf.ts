import PDFDocument from 'pdfkit';
import { generateSyntheticContract } from './contractPdf.js';
import { buildLocalDocumentIntelligence } from './documentIntelligence.js';
import type { AfpcCase, CaseDocument } from './types.js';

const ORANGE = '#F17F21';
const GREEN = '#0D9A49';
const INK = '#25313B';

export async function generateSyntheticDocumentPdf(
  afpcCase: AfpcCase,
  sourceDocument: CaseDocument,
): Promise<Buffer> {
  if (sourceDocument.type === 'CONTRACT') return generateSyntheticContract(afpcCase);

  const insight = buildLocalDocumentIntelligence(afpcCase);
  const fields = insight.extractedFields.filter((field) => field.documentId === sourceDocument.id);
  const pageCount = Math.max(1, Math.min(sourceDocument.pages ?? 1, 3));
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'LETTER', margins: { top: 70, bottom: 60, left: 58, right: 58 } });
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('error', reject);
    pdf.on('end', () => resolve(Buffer.concat(chunks)));

    for (let page = 1; page <= pageCount; page += 1) {
      if (page > 1) pdf.addPage();
      pdf.rect(0, 0, pdf.page.width, 11).fill(ORANGE);
      pdf.rect(0, 11, pdf.page.width, 5).fill(GREEN);
      pdf
        .fillColor(GREEN)
        .font('Helvetica-Bold')
        .fontSize(12)
        .text('BANCO DE OCCIDENTE · AFPC', { align: 'right' });
      pdf
        .moveDown(0.5)
        .fillColor(INK)
        .fontSize(17)
        .text(insight.documents.find((item) => item.documentId === sourceDocument.id)?.label ?? sourceDocument.type, {
          align: 'center',
        });
      pdf
        .moveDown(0.25)
        .fillColor(ORANGE)
        .fontSize(8.5)
        .text('PDF SINTÉTICO · GENERADO PARA DEMO LOCAL · SIN VALIDEZ', { align: 'center' });
      pdf.moveDown(1.2);
      const metaTop = pdf.y;
      pdf
        .roundedRect(58, metaTop, 496, 45, 5)
        .fillAndStroke('#F6F8F8', '#D7DDDF');
      pdf
        .fillColor(INK)
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .text('Referencia', 72, metaTop + 14)
        .font('Helvetica')
        .text(afpcCase.reference, 142, metaTop + 14)
        .font('Helvetica-Bold')
        .text('Documento', 324, metaTop + 14)
        .font('Helvetica')
        .text(sourceDocument.id, 390, metaTop + 14);
      pdf.y = metaTop + 60;

      const pageFields = fields.filter((field) => field.page === page || (page === 1 && field.page > pageCount));
      if (pageFields.length === 0) {
        pdf
          .fillColor('#66717A')
          .font('Helvetica-Oblique')
          .fontSize(10)
          .text('Página sintética de condiciones y constancias del documento demo.', { align: 'center' });
      }
      for (const field of pageFields) {
        if (pdf.y > 675) break;
        const top = pdf.y;
        pdf
          .roundedRect(58, top, 496, 52, 4)
          .lineWidth(0.6)
          .strokeColor(field.status === 'MISSING' ? ORANGE : '#CCD4D7')
          .stroke();
        pdf
          .fillColor('#5B666E')
          .font('Helvetica-Bold')
          .fontSize(8)
          .text(field.label.toUpperCase(), 70, top + 9, { width: 180 })
          .fillColor(INK)
          .font('Helvetica')
          .fontSize(10)
          .text(field.value === null ? 'PENDIENTE' : String(field.value), 70, top + 24, { width: 270 })
          .fillColor('#69757D')
          .fontSize(7.5)
          .text(`Confianza demo: ${Math.round(field.confidence * 100)}%`, 390, top + 18, { width: 145, align: 'right' });
        pdf.y = top + 62;
      }
      pdf
        .fillColor('#7A838A')
        .font('Helvetica')
        .fontSize(7.5)
        .text(
          `Origen: plantilla sintética y datos canónicos del demo · Página ${page} de ${pageCount}`,
          58,
          716,
          { width: 496, align: 'center', lineBreak: false },
        );
    }
    pdf.end();
  });
}
