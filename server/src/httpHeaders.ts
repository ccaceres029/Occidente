function encodedFilename(filename: string): string {
  return encodeURIComponent(filename).replaceAll(/[!'()*]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function inlineContentDisposition(filename: string): string {
  const ascii = filename
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036f]/gu, '')
    .replaceAll(/[^\x20-\x7E]/gu, '_')
    .replaceAll(/[\\"\r\n]/gu, '_')
    .slice(0, 180) || 'documento';
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodedFilename(filename)}`;
}
