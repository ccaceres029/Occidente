import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import type { DocumentIntelligenceInsight, ExtractedDocumentField } from './types.js';

export interface FinalizedCaseExportSource {
  code: string;
  senderEmail?: string;
  receivedAt: Date;
  finalizedAt: Date;
  documentIntelligence?: DocumentIntelligenceInsight;
}

export const AFFILIATE_HEADERS = [
  'NRO_CERTIFICADO', 'FEC_SUSCRIPCION', 'CTA_COLECTIVA', 'TIPO_ID', 'NRO_ID',
  'PRIMER_APELLIDO', 'SEGUNDO_APELLIDO', 'PRIMER_NOMBRE', 'SEGUNDO_NOMBRE', 'NACIONALIDAD',
  'FEC_NACIMIENTO', 'SEXO', 'ESTADO_CIVIL', 'ENVIO', 'DIR_DOMICILIO', 'NRO_DOMICILIO',
  'NRO_EDIFICIO', 'COD_PAIS', 'COD_PROVINCIA', 'COD_REGION', 'COD_CIUDAD', 'COD_SECTOR',
  'TEL_RECIDENCIA', 'TEL_CELULAR', 'E-MAIL', 'APLICA_SEGURO', 'IBC', 'PRODUCTO',
  'SUBPRODUCTO', 'PERIODICIDAD', 'FORMA_PAGO', 'CUENTA_PAGO', 'ENTE_PAGA', 'TIPO_APORTE',
  'MONTO_APORTE', 'MONTO_APORTE_NETO', 'OCUPACION', 'PROMOTOR', 'NOM_PROMOTOR', 'RTN_EMPL',
  'RAZON_SOCIAL_EMP', 'NOMBRE_EMP', 'TELEFONO_EMP', 'EXTENCION_EMP', 'FAX_EMP', 'DIR_EMP',
  'E_MAL_EMP', 'TIPO_SOLICITUD', 'FECHA INICIO DE LABORES', 'ESTA_EN_PEP', 'ESTA_EN_FATCA',
  'COD_ACTIVIDAD', 'ORIGEN_FONDO', 'PROPOSITO_F', 'NIVEL_ESTUDIO', 'OCUPACION', 'PAIS_NAC',
  'DEPTO_NAC', 'MUN_NAC', 'INGRESOS', 'PUESTO', 'GIRO_EMPRESA', 'GIRO_NEGOCIO',
] as const;

export const BENEFICIARY_HEADERS = [
  'NRO_CERTIFICADO', 'TIPO_ID', 'NRO_ID', 'TIPO_ID_BENEF', 'NRO_ID_BENEF', 'TIPO', 'SEXO',
  'PORC_DISTRIBUCION', 'PRIMER_NOMBRE', 'SEGUNDO_NOMBRE', 'PRIMER_APELLIDO', 'SEGUNDO_APELLIDO',
  'PARENTEZCO', 'GRADO', 'FECHA_NACIMIENTO',
] as const;

const AFFILIATE_ROLES: Array<Array<string | number | null>> = [
  ['NOM_CAMPO', 'DESCRIPCIÓN', 'ORDEN', 'LARGO', 'TIPO_DATO'],
  ['NRO_CERTIFICADO', 'Numero de Formulario', 10, 15, 'N'],
  ['FEC_SUSCRIPCION', 'Fecha de Afiliación', 20, 10, 'C'],
  ['CTA_COLECTIVA', 'Numero de Cuenta Colectiva', 30, 15, 'C'],
  ['TIPO_ID', 'Tipo de Identificación', 40, 5, 'C'],
  ['NRO_ID', 'Número de Identificación', 50, 30, 'C'],
  ['PRIMER_APELLIDO', 'Primer Apellido', 60, 40, 'C'],
  ['SEGUNDO_APELLIDO', 'Segundo Apellido', 70, 40, 'C'],
  ['PRIMER_NOMBRE', 'Primer Nombre', 80, 25, 'C'],
  ['SEGUNDO_NOMBRE', 'Segundo Nombre', 90, 25, 'C'],
  ['NACIONALIDAD', 'Nacionalidad', 100, 20, 'C'],
  ['FEC_NACIMIENTO', 'Fecha de Nacimiento', 110, 10, 'C'],
  ['SEXO', 'Sexo', 120, 1, 'C'],
  ['ESTADO_CIVIL', 'Estado Civil', 130, 1, 'C'],
  ['ENVIO', 'Dirección de Envío', 140, 1, 'C'],
  ['DIR_DOMICILIO', 'Dirección', 150, 120, 'C'],
  ['NRO_DOMICILIO', 'Numero de Casa', 160, 12, 'C'],
  ['NRO_EDIFICIO', 'Número de Edificio', 170, 25, 'C'],
  ['COD_PAIS', 'País Honduras', 180, 5, 'C'],
  ['COD_REGION', 'Municipio', 190, 5, 'C'],
  ['COD_PROVINCIA', 'Departamento', 200, 5, 'C'],
  ['COD_CIUDAD', 'Ciudad', 210, 5, 'C'],
  ['COD_SECTOR', 'Caserío', 220, 5, 'C'],
  ['TEL_RESIDENCIA', 'Teléfono de la Casa', 230, 10, 'C'],
  ['TEL_CELULAR', 'Teléfono Celular', 235, 10, 'C'],
  ['E-MAIL', 'Correo Electrónico', 240, 80, 'C'],
  ['APLICA_SEGURO', 'Aplica Seguro', 250, 1, 'C'],
  ['IBC', 'Salario', 260, 25, 'N'],
  ['PRODUCTO', 'Código de Producto', 270, 4, 'C'],
  ['SUBPRODUCTO', 'Código de Subproducto', 280, 5, 'C'],
  ['PERIODICIDAD', 'Periodicidad de Pago', 290, 1, 'C'],
  ['FORMA_PAGO', 'Forma de Pago', 300, 2, 'C'],
  ['CUENTA_PAGO', 'Cuenta de Pago', 310, 30, 'C'],
  ['ENTE_PAGA', 'Ente de Paga', 320, 5, 'C'],
  ['TIPO_APORTE', 'Tipo de Aporte', 330, 1, 'C'],
  ['MONTO_APORTE', 'Monto de Aporte', 340, 21, 'N'],
  ['MONTO_APORTE_NETO', 'Monto de Aporte Neto', 350, 21, 'N'],
  ['OCUPACION', 'Ocupación', 360, 5, 'C'],
  ['PROMOTOR', 'Promotor', 370, 10, 'C'],
  ['NOM_PROMOTOR', 'Nombre del Promotor', 380, 60, 'C'],
  ['RTN_EMPL', 'RTN del Empleador', 390, 30, 'C'],
  ['RAZON_SOCIAL_EMP', 'Razón Social del Empleador', 400, 120, 'C'],
  ['NOMBRE_EMP', 'Nombre del Empleador', 410, 120, 'C'],
  ['TELEFONO_EMP', 'Teléfono del Empleador', 420, 50, 'C'],
  ['EXTENCION_EMP', 'Numero de extensión en la Empresa', 430, 5, 'C'],
  ['FAX_EMP', 'Numero de Fax del Empleador', 440, 10, 'C'],
  ['DIR_EMP', 'Dirección del Empleador', 450, 120, 'C'],
  ['E_MAL_EMP', 'Correo Electrónico del Empleador', 460, 80, 'C'],
  ['TIPO_SOLICITUD', 'Tipo de Solicitud', 470, 1, 'C'],
  ['FECHA INICIO DE LABORES', 'Fecha de ingreso a laborar', null, 8, null],
  ['ESTA_EN_PEP', null, null, 1, 'C'],
  ['ESTA_EN_FATCA', null, null, 1, 'C'],
];

const BENEFICIARY_ROLES: Array<Array<string | number | null>> = [
  ['NOM_CAMPO', 'DESCRIPCIÓN', 'ORDEN', 'LARGO', 'FORMATO', 'TIPO_DATO'],
  ['NRO_CERTIFICADO', 'Numero de Formulario', 10, 15, null, 'N'],
  ['TIPO_ID', 'Tipo Identificación del Cliente', 20, 5, null, 'C'],
  ['NRO_ID', 'Número Identificación del Cliente', 30, 30, null, 'C'],
  ['TIPO_ID_BENEF', 'Tipo Identificación del Beneficiario', 40, 5, null, 'C'],
  ['NRO_ID_BENEF', 'Número Identificación del Beneficiario', 50, 30, null, 'C'],
  ['TIPO', 'Directo o Contingente', 60, 1, null, 'C'],
  ['SEXO', 'Genero', 70, 1, null, 'C'],
  ['PORC_DISTRIBUCION', 'Porcentaje de Beneficio', 80, 7, '9999999', 'N'],
  ['PRIMER_NOMBRE', 'Primer Nombre', 90, 25, null, 'C'],
  ['SEGUNDO_NOMBRE', 'Segundo Nombre', 100, 25, null, 'C'],
  ['PRIMER_APELLIDO', 'Primer Nombre', 110, 40, null, 'C'],
  ['SEGUNDO_APELLIDO', 'Segundo Nombre', 120, 40, null, 'C'],
  ['PARENTEZCO', 'Parentesco', 130, 4, null, 'N'],
  ['GRADO', 'Grado de afinidad o Consanguineidad', 140, 4, null, 'N'],
  ['FECHA_NACIMIENTO', 'Fecha de Nacimiento', 150, 10, null, 'C'],
];

type ExportValue = string | number | boolean | null;

function dateValue(value: Date | string | number | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Tegucigalpa', day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || '';
  return `${part('day')}/${part('month')}/${part('year')}`;
}

function normalizedText(value: ExportValue | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value).replaceAll(/\s+/gu, ' ').trim();
}

function numericValue(value: ExportValue | undefined): number | '' {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const compact = normalizedText(value).replaceAll(/[^0-9.,-]/gu, '');
  if (!compact) return '';
  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  const normalized = lastComma > lastDot
    ? compact.replaceAll('.', '').replace(',', '.')
    : compact.replaceAll(',', '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : '';
}

function yesNo(value: ExportValue | undefined): string {
  if (typeof value === 'boolean') return value ? 'S' : 'N';
  const normalized = normalizedText(value).normalize('NFD').replaceAll(/[\u0300-\u036f]/gu, '').toLowerCase();
  if (['si', 'sí', 's', 'true', 'positivo'].includes(normalized)) return 'S';
  if (['no', 'n', 'false', 'negativo'].includes(normalized)) return 'N';
  return '';
}

function fieldMap(insight?: DocumentIntelligenceInsight): Map<string, ExportValue> {
  const selected = new Map<string, ExtractedDocumentField>();
  for (const field of insight?.extractedFields || []) {
    if (field.status !== 'EXTRACTED' || field.value === null || field.value === '') continue;
    const current = selected.get(field.field);
    if (!current || field.confidence > current.confidence) selected.set(field.field, field);
  }
  return new Map([...selected].map(([key, field]) => [key, field.value]));
}

function splitName(value: ExportValue | undefined) {
  const tokens = normalizedText(value).split(' ').filter(Boolean);
  if (tokens.length >= 4) {
    return {
      firstName: tokens[0], secondName: tokens.slice(1, -2).join(' '),
      firstSurname: tokens.at(-2) || '', secondSurname: tokens.at(-1) || '',
    };
  }
  if (tokens.length === 3) return { firstName: tokens[0], secondName: tokens[1], firstSurname: tokens[2], secondSurname: '' };
  if (tokens.length === 2) return { firstName: tokens[0], secondName: '', firstSurname: tokens[1], secondSurname: '' };
  return { firstName: tokens[0] || '', secondName: '', firstSurname: '', secondSurname: '' };
}

function certificateNumber(code: string): number | string {
  const digits = code.replaceAll(/\D/gu, '').slice(-15);
  const parsed = Number(digits);
  return digits && Number.isSafeInteger(parsed) ? parsed : digits || code.slice(0, 15);
}

export function affiliateRows(cases: FinalizedCaseExportSource[]): ExportValue[][] {
  return cases.map((item) => {
    const fields = fieldMap(item.documentIntelligence);
    const name = splitName(fields.get('fullName'));
    const occupation = normalizedText(fields.get('occupation'));
    return [
      certificateNumber(item.code), dateValue(item.receivedAt), '', normalizedText(fields.get('idType')),
      normalizedText(fields.get('idNumber')), name.firstSurname, name.secondSurname, name.firstName,
      name.secondName, normalizedText(fields.get('nationality')), dateValue(fields.get('birthDate') as string),
      normalizedText(fields.get('sex')), normalizedText(fields.get('civilStatus')), '',
      normalizedText(fields.get('address')), '', '', normalizedText(fields.get('residenceCountry')),
      normalizedText(fields.get('department')), normalizedText(fields.get('municipality')),
      normalizedText(fields.get('city')), normalizedText(fields.get('sector')),
      normalizedText(fields.get('homePhone')), normalizedText(fields.get('mobilePhone')),
      normalizedText(fields.get('email')) || item.senderEmail || '', '', numericValue(fields.get('monthlyIncome')),
      normalizedText(fields.get('plan')), '', normalizedText(fields.get('contributionFrequency')),
      normalizedText(fields.get('paymentMethod')), normalizedText(fields.get('paymentAccount')), '', '',
      numericValue(fields.get('contributionAmount')), numericValue(fields.get('contributionAmount')), occupation,
      '', '', normalizedText(fields.get('employerTaxId')), normalizedText(fields.get('employerLegalName')),
      normalizedText(fields.get('employer')), normalizedText(fields.get('employerPhone')), '', '',
      normalizedText(fields.get('employerAddress')), normalizedText(fields.get('employerEmail')), '',
      dateValue(fields.get('employmentStartDate') as string), yesNo(fields.get('pepDeclared')),
      yesNo(fields.get('fatcaPositive')), normalizedText(fields.get('activityCode')),
      normalizedText(fields.get('sourceOfFunds')), normalizedText(fields.get('purpose')),
      normalizedText(fields.get('educationLevel')), occupation, normalizedText(fields.get('birthCountry')),
      normalizedText(fields.get('birthDepartment')), normalizedText(fields.get('birthMunicipality')),
      numericValue(fields.get('monthlyIncome')), normalizedText(fields.get('position')),
      normalizedText(fields.get('employerBusiness')), normalizedText(fields.get('businessActivity')),
    ];
  });
}

export function beneficiaryRows(cases: FinalizedCaseExportSource[]): ExportValue[][] {
  return cases.flatMap((item) => {
    const fields = fieldMap(item.documentIntelligence);
    const rows: ExportValue[][] = [];
    for (let index = 1; index <= 5; index += 1) {
      const prefix = `beneficiary${index}`;
      const beneficiaryName = fields.get(`${prefix}FullName`)
        || (index === 1 ? fields.get('beneficiaryFullName') || fields.get('beneficiaryName') : undefined);
      const beneficiaryId = fields.get(`${prefix}IdNumber`)
        || (index === 1 ? fields.get('beneficiaryIdNumber') : undefined);
      const beneficiaryPercent = fields.get(`${prefix}Percentage`)
        || (index === 1 ? fields.get('beneficiaryPercentage') || fields.get('beneficiaryPercent') : undefined);
      if (!normalizedText(beneficiaryName) && !normalizedText(beneficiaryId) && numericValue(beneficiaryPercent) === '') continue;
      const name = splitName(beneficiaryName);
      rows.push([
        certificateNumber(item.code), normalizedText(fields.get('idType')), normalizedText(fields.get('idNumber')),
        normalizedText(fields.get(`${prefix}IdType`) || (index === 1 ? fields.get('beneficiaryIdType') : undefined)),
        normalizedText(beneficiaryId),
        normalizedText(fields.get(`${prefix}Type`) || (index === 1 ? fields.get('beneficiaryType') : undefined)),
        normalizedText(fields.get(`${prefix}Sex`) || (index === 1 ? fields.get('beneficiarySex') : undefined)),
        numericValue(beneficiaryPercent), name.firstName, name.secondName, name.firstSurname, name.secondSurname,
        numericValue(fields.get(`${prefix}Relationship`) || (index === 1 ? fields.get('beneficiaryRelationship') : undefined)),
        numericValue(fields.get(`${prefix}Degree`) || (index === 1 ? fields.get('beneficiaryDegree') : undefined)),
        dateValue((fields.get(`${prefix}BirthDate`) || (index === 1 ? fields.get('beneficiaryBirthDate') : undefined)) as string),
      ]);
    }
    return rows;
  });
}

function workbookBuffer(
  headers: readonly string[],
  dataRows: ExportValue[][],
  roles: Array<Array<string | number | null>>,
): Buffer {
  const workbook = XLSX.utils.book_new();
  const rolesSheet = XLSX.utils.aoa_to_sheet(roles);
  rolesSheet['!cols'] = [{ wch: 28 }, { wch: 42 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }];
  const dataSheet = XLSX.utils.aoa_to_sheet([[...headers], ...dataRows]);
  dataSheet['!cols'] = headers.map((header, index) => ({
    wch: index === 0 ? 20 : Math.max(12, Math.min(28, header.length + 2)),
  }));
  for (let row = 1; row <= dataRows.length; row += 1) {
    const certificateCell = dataSheet[XLSX.utils.encode_cell({ r: row, c: 0 })];
    if (certificateCell?.t === 'n') certificateCell.z = '0';
  }
  XLSX.utils.book_append_sheet(workbook, rolesSheet, 'Roles');
  XLSX.utils.book_append_sheet(workbook, dataSheet, 'Hoja1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'biff8', compression: true }) as Buffer;
}

export async function buildFinalizedCasesArchive(cases: FinalizedCaseExportSource[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('Archivo_Afiliados.xls', workbookBuffer(AFFILIATE_HEADERS, affiliateRows(cases), AFFILIATE_ROLES));
  zip.file('Archivo_Beneficiario.xls', workbookBuffer(BENEFICIARY_HEADERS, beneficiaryRows(cases), BENEFICIARY_ROLES));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
