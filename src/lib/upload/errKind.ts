export type FileErrKind = 'big' | 'empty' | 'scan' | 'type' | 'slow' | 'net' | 'other';
export function fileErrKind(status: number, raw: string): FileErrKind {
  const m = raw.toLowerCase();
  if (status === 413 || /больше \d+ [мк]б|больше предела/.test(m)) return 'big';
  if (/только сканы|не распознан/.test(m)) return 'scan';
  if (/пуст(ой|ые|ая|ое)|не нашлось текста/.test(m)) return 'empty';
  if (status === 415 || /не поддерживается|служебный файл/.test(m)) return 'type';
  if (/слишком долго|timeout|тайм-аут/.test(m)) return 'slow';
  if (status === 0 || status >= 500 || /failed to fetch|networkerror|load failed/.test(m)) return 'net';
  return 'other';
}
