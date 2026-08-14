import PDFDocument from 'pdfkit';
import {
  CONTRACT_METADATA,
  CONTRACT_SECTIONS,
  CONTRACT_TITLE,
} from './contractContent.js';
import type { AfpcCase } from './types.js';

const BRAND_ORANGE = '#E97924';
const BRAND_GREEN = '#71943B';
const INK = '#29323A';

export async function generateSyntheticContract(afpcCase: AfpcCase): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: 'LETTER',
      margins: { top: 62, bottom: 62, left: 58, right: 58 },
      bufferPages: true,
      info: {
        Title: `${CONTRACT_TITLE} - ${afpcCase.reference}`,
        Author: CONTRACT_METADATA.issuer,
        Subject: 'Contrato sintético para demostración local',
      },
    });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('error', reject);
    document.on('end', () => resolve(Buffer.concat(chunks)));

    const addPageHeader = () => {
      document
        .save()
        .rect(0, 0, document.page.width, 12)
        .fill(BRAND_ORANGE)
        .rect(0, 12, document.page.width, 5)
        .fill(BRAND_GREEN)
        .restore();
    };
    addPageHeader();
    document.on('pageAdded', addPageHeader);

    document
      .fillColor(BRAND_GREEN)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text('AFPC OCCIDENTE', { align: 'right' });
    document
      .moveDown(0.4)
      .fillColor(INK)
      .fontSize(16)
      .text(CONTRACT_TITLE, { align: 'center' });
    document
      .moveDown(0.35)
      .fillColor(BRAND_ORANGE)
      .fontSize(9)
      .text('DOCUMENTO SINTÉTICO · DEMO LOCAL · SIN VALIDEZ LEGAL', { align: 'center' });

    document.moveDown(1.2);
    const summaryTop = document.y;
    document
      .roundedRect(58, summaryTop, 496, 86, 6)
      .lineWidth(0.8)
      .strokeColor('#D7DCE0')
      .stroke();
    document
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('Referencia', 72, summaryTop + 14)
      .font('Helvetica')
      .text(afpcCase.reference, 155, summaryTop + 14)
      .font('Helvetica-Bold')
      .text('Afiliado', 72, summaryTop + 34)
      .font('Helvetica')
      .text(afpcCase.client.fullName, 155, summaryTop + 34)
      .font('Helvetica-Bold')
      .text('Identificación', 72, summaryTop + 54)
      .font('Helvetica')
      .text(afpcCase.client.idNumberMasked, 155, summaryTop + 54)
      .font('Helvetica-Bold')
      .text('Aporte', 340, summaryTop + 14)
      .font('Helvetica')
      .text(
        `${afpcCase.product.currency} ${afpcCase.product.contributionAmount.toLocaleString('es-HN')}`,
        405,
        summaryTop + 14,
      )
      .font('Helvetica-Bold')
      .text('Frecuencia', 340, summaryTop + 34)
      .font('Helvetica')
      .text(afpcCase.product.frequency, 405, summaryTop + 34)
      .font('Helvetica-Bold')
      .text('Plan', 340, summaryTop + 54)
      .font('Helvetica')
      .text('Individual', 405, summaryTop + 54);
    document.y = summaryTop + 104;

    document
      .font('Helvetica')
      .fontSize(9.5)
      .fillColor(INK)
      .text(CONTRACT_METADATA.preamble, 58, document.y, {
        width: 496,
        align: 'justify',
        lineGap: 2,
      });

    for (const section of CONTRACT_SECTIONS) {
      const estimatedHeight = document.heightOfString(section.body, {
        width: 496,
        align: 'justify',
        lineGap: 2,
      });
      if (document.y + estimatedHeight + 48 > 705) document.addPage();
      document
        .moveDown(0.9)
        .fillColor(BRAND_GREEN)
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(section.title);
      document
        .moveDown(0.25)
        .fillColor(INK)
        .font('Helvetica')
        .fontSize(9.2)
        .text(section.body, { align: 'justify', lineGap: 2 });
    }

    if (document.y > 610) document.addPage();
    document
      .moveDown(1.5)
      .fillColor(BRAND_ORANGE)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text('ACEPTACIÓN PARA DEMOSTRACIÓN');
    document
      .moveDown(0.4)
      .fillColor(INK)
      .font('Helvetica')
      .fontSize(9)
      .text(
        'Las firmas siguientes son espacios ilustrativos. Este PDF no sustituye el contrato oficial, la firma del afiliado ni la aprobación de la Administradora.',
      );
    const signatureY = document.y + 52;
    document
      .moveTo(80, signatureY)
      .lineTo(280, signatureY)
      .moveTo(334, signatureY)
      .lineTo(534, signatureY)
      .strokeColor(INK)
      .stroke();
    document
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('Firma del afiliado', 80, signatureY + 8, { width: 200, align: 'center' })
      .text('Representante AFPC', 334, signatureY + 8, { width: 200, align: 'center' });

    const pages = document.bufferedPageRange();
    for (let pageIndex = 0; pageIndex < pages.count; pageIndex += 1) {
      document.switchToPage(pageIndex);
      document
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor('#737B82')
        .text(
          `Demo local · ${afpcCase.reference} · Página ${pageIndex + 1} de ${pages.count}`,
          58,
          718,
          { width: 496, align: 'center', lineBreak: false },
        );
    }
    document.end();
  });
}
