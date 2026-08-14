const normalizedName = (name: string) =>
  name.normalize('NFD').replaceAll(/[\u0300-\u036f]/gu, '').toLocaleLowerCase('es-HN');

export const supportedDocument = (file: File) => {
  const name = normalizedName(file.name);
  return ['application/pdf', 'image/png', 'image/jpeg', 'text/plain'].includes(file.type)
    || /\.(pdf|png|jpe?g|txt)$/u.test(name);
};

export const inferDocumentType = (filename: string) => {
  const name = normalizedName(filename);
  if (/solicitud|afiliacion/u.test(name)) return 'AFFILIATION_FORM';
  if (/identidad|\bdni\b/u.test(name)) return 'IDENTITY';
  if (/\brtn\b/u.test(name)) return 'RTN';
  if (/comprobante|deposito/u.test(name)) return 'CONTRIBUTION_RECEIPT';
  if (/educacion financiera|constancia.*financiera/u.test(name)) return 'FINANCIAL_EDUCATION';
  if (/fatca|autocertificacion/u.test(name)) return 'FATCA';
  if (/contrato/u.test(name)) return 'CONTRACT';
  if (/procedencia.*fondos|fuente.*fondos/u.test(name)) return 'SOURCE_OF_FUNDS';
  if (/lexis|cautela|lista|busqueda|consulta/u.test(name)) return 'SCREENING';
  if (/correo|email/u.test(name)) return 'EMAIL_CHECKLIST';
  return 'OTHER';
};

export const documentFormatLabel = (file: File) => {
  const extension = file.name.split('.').pop()?.toLocaleUpperCase('es-HN');
  return extension && extension.length <= 5 ? extension : 'Archivo';
};
