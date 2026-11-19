export const MARK_RE = /\[\[\s*intro\s*:([^\]\n]{0,200})\]\]/giu;
export const hasIntroMarks = (text: string | null | undefined): boolean => /\[\[\s*intro\s*:/i.test(text ?? '');
export function stripIntroMarks(text: string, streaming = false): string {
  let t = text.replace(MARK_RE, '');
  if (streaming) t = t.replace(/\[(\[(\s*i(n(t(r(o\s*:?[^\]\n]*\]?)?)?)?)?)?)?$/iu, '');
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}
