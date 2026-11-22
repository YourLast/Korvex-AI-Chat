export const MARK_RE = /\[\[\s*intro\s*:([^\n]{0,200}?)\]\]\]?/giu;
export const hasIntroMarks = (text: string | null | undefined): boolean => /\[\[\s*intro\s*:/i.test(text ?? '');
export function stripIntroMarks(text: string, streaming = false): string {
  let t = text.replace(MARK_RE, '');
  if (streaming) t = t.replace(/\[(\[(\s*i(n(t(r(o\s*:?[^\]\n]*\]?)?)?)?)?)?)?$/iu, '');
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

const PRAISE_LEAD = /^(?:Отлично|Супер|Здорово|Прекрасно|Класс|Замечательно|Круто|Great|Perfect|Awesome)(?:[,!.…—–-]+\s*|\s+—\s*)/u;
const PRAISE_SENT = /(?:классик|прямое попадание|всё сходится|все сходится|отличный выбор|хороший выбор|мощный стек|правильный выбор)/iu;
const FEM: [RegExp, string][] = [
  [/(?<![\p{L}])([Пп])онял(?![\p{L}])/gu, '$1оняла'], [/(?<![\p{L}])([Зз])аписал(?![\p{L}])/gu, '$1аписала'], [/(?<![\p{L}])([Зз])апомнил(?![\p{L}])/gu, '$1апомнила'],
  [/(?<![\p{L}])([Уу])ч[её]л(?![\p{L}])/gu, '$1чла'], [/(?<![\p{L}])([Уу])точнил(?![\p{L}])/gu, '$1точнила'], [/(?<![\p{L}])([Оо])тметил(?![\p{L}])/gu, '$1тметила'],
  [/(?<![\p{L}])([Рр])азобрался(?![\p{L}])/gu, '$1азобралась'], [/(?<![\p{L}])([Рр])ад(?![\p{L}])/gu, '$1ада'], [/(?<![\p{L}])([Уу])видел(?![\p{L}])/gu, '$1видела'],
];
export function introVoice(text: string): string {
  let t = text;
  const m = PRAISE_LEAD.exec(t);
  if (m && t.length > m[0].length) { t = t.slice(m[0].length); t = t.charAt(0).toUpperCase() + t.slice(1); }
  const [first, ...rest] = t.split(/\n\n/);
  const sents = first.split(/(?<=[.!?…])\s+/);
  if (sents.length > 1) { const keep = sents.filter((x) => !PRAISE_SENT.test(x)); if (keep.length && keep.length < sents.length) t = [keep.join(' '), ...rest].join('\n\n'); }
  t = t.split(/(«[^»\n]*»|"[^"\n]*"|“[^”\n]*”|„[^“”\n]*[“”])/u).map((part, i) => (i % 2 ? part : FEM.reduce((x, [re, to]) => x.replace(re, to), part))).join('');
  return t;
}
