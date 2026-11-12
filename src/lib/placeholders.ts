
const MARKERS = [
  /\[(?:page|slide)\s+\d+\]/g,
  /\[sheet\s+«[^»\]]*»(?:\s+rows\s+\d+-\d+)?\]/g,
  /\[section\s+«[^»\]]*»\]/g,
  /\[колонтитул:[^\]]*\]/g,
];
const PLACEHOLDER = /\[[^\[\]]*(?:не распознан|не прочитан|без текстового слоя|ожидает распознавания|рисунок не описан)[^\[\]]*\]/g;
const NOTES = [/\[распознано с низким качеством[^\]]*\]/g, /\[проверьте:[^\]]*\]/g, /\[текст обрезан[^\]]*\]/g];
const UNREADABLE = /^\s*\[Файл\s+«[\s\S]*?»\s+не прочитан:\s*([\s\S]*?)\]\s*$/;

export const MIN_MEANINGFUL = 20;

export function stripService(text: string): string {
  let t = text;
  for (const re of MARKERS) t = t.replace(re, ' ');
  t = t.replace(PLACEHOLDER, ' ');
  for (const re of NOTES) t = t.replace(re, ' ');
  return t;
}

export function meaningfulChars(text: string): number {
  const m = stripService(text).match(/[\p{L}\p{N}]/gu);
  return m ? m.length : 0;
}

export function countUnrecognized(text: string): number {
  return (text.match(PLACEHOLDER) ?? []).length;
}

export function unreadableReason(text: string): string | null {
  const m = UNREADABLE.exec(text);
  return m ? (m[1].trim() || 'причина не указана') : null;
}

export type Verdict =
  | { ok: true; unrecognized: number }
  | { ok: false; message: string };

export function judgeText(text: string, name: string, flaggedUnreadable = false): Verdict {
  const reason = unreadableReason(text);
  if (flaggedUnreadable || reason !== null) {
    return { ok: false, message: `Файл «${name}» не прочитан: ${reason ?? 'сервер не смог его открыть'}` };
  }
  const unrecognized = countUnrecognized(text);
  const real = meaningfulChars(text);
  if (real === 0) {
    return { ok: false, message: unrecognized ? `Файл «${name}» не прочитан: на страницах только сканы или рисунки, текст не распознан` : `В файле «${name}» не нашлось текста` };
  }
  if (unrecognized > 0 && real < MIN_MEANINGFUL) {
    return { ok: false, message: `Файл «${name}» не прочитан: на страницах только сканы или рисунки, текст не распознан` };
  }
  return { ok: true, unrecognized };
}
