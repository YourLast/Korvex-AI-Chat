export const DOC_EXTENSIONS = [
  '.xlsx', '.xlsm', '.xls', '.ods', '.csv', '.tsv',
  '.pdf',
  '.docx', '.docm', '.dotx', '.doc', '.odt', '.rtf',
  '.pptx', '.ppt', '.odp',
  '.txt', '.md', '.json', '.xml', '.html', '.htm',
  '.eml', '.msg', '.epub', '.yaml', '.yml', '.ini', '.log',
] as const;
export const OK_EXT: ReadonlySet<string> = new Set(DOC_EXTENSIONS);

export function unparsedCard(name: string, size: number, ext: string): string {
  const kb = size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(size / 1024))} КБ`;
  return `[Файл «${name}» сохранён без разбора: формат ${ext ? '.' + ext : 'без расширения'} не читается (${kb}). Содержимое недоступно; оригинал можно скачать.]`;
}
export const DOC_ACCEPT = DOC_EXTENSIONS.join(',');
