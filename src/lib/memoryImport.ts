import { addMemory, cleanText, isSecret, listMemory, personalTopic, ruleConflict, sensitiveTopic, similarity, SAME, MAX_TEXT, workData, type Section } from './memory';

export const IMPORT_MAX_CHARS = 20_000;
export const IMPORT_MAX_ITEMS = 40;

export const IMPORT_PROMPT_RU = [
  'Перечисли всё, что ты знаешь обо мне из нашей переписки и своей памяти, — только то, что относится к работе:',
  '- чем я занимаюсь, мой участок и роль;',
  '- режимы налогообложения, программы и форматы, с которыми я работаю;',
  '- как мне удобнее получать ответы: длина, формат, на «ты» или на «вы»;',
  '- мои постоянные правила и просьбы к ответам;',
  '- что я поправлял или просил переделать в твоих ответах.',
  'Каждый факт — отдельной строкой, начиная с «- », коротко. Не пиши пароли и ключи, данные моих клиентов (ИНН, ФИО, суммы, названия их компаний), здоровье, личные деньги и отношения. Ничего не придумывай и не добавляй от себя. Если в факте не уверен, начни строку с «возможно». Не больше 30 строк.',
].join('\n');
export const IMPORT_PROMPT_EN = [
  'List everything you know about me from our conversations and your memory, only what relates to my work:',
  '- what I do, my area and role;',
  '- the tax regimes, software and formats I work with;',
  '- how I prefer answers: length, format, formal or informal;',
  '- my standing rules and requests for answers;',
  '- what I corrected or asked you to redo in your answers.',
  'One fact per line, starting with "- ", briefly. Do not include passwords or keys, my clients\' data (tax IDs, names, amounts, their company names), health, personal money or relationships. Do not invent or add anything. If you are not sure about a fact, start the line with "maybe". No more than 30 lines.',
].join('\n');

export type ImportSkip = 'secret' | 'rules' | 'client' | 'sensitive' | 'dup';
export type ImportItem = { text: string; section: Section; skip?: ImportSkip; unsure?: boolean };
const UNSURE = /^(возможно|вероятно|похоже|кажется|maybe|probably|perhaps|possibly)[,:\s—-]+/iu;

const CLIENT_DATA = /(ИНН|КПП|ОГРН|р\/с|расч[её]тн\S*\s+сч[её]т|(?<!\d)\d{10}(?!\d)|(?<!\d)\d{12}(?!\d)|ООО\s*[«"]|ИП\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ])/u;
const BULLET = /^\s*(?:[-*•·–—]|\d{1,2}[.)])\s+/u;
const HEADER = /:\s*$/u;
const CHATTER = /^(вот|конечно|разумеется|хорошо|итак|here|sure|certainly|of course|ok|okay|надеюсь|если\s+нужно|если\s+хотите|let me know|hope)(?![\p{L}])/iu;

export function sectionOf(text: string): Section {
  if (/(всегда|никогда|не\s+(пиши|используй|предлагай|начинай|добавляй)|обязательно|always|never|do\s+not|don['’]t)/iu.test(text)) return 'rules';
  if (/(коротк|кратк|подробн|развёрнут|развернут|формат\s+ответ|таблиц|списк|на\s+«?ты|на\s+«?вы|тон\b|эмодзи|итог\S*\s+(в\s+)?(перв|сначала|сверху)|short|brief|detailed|bullet|table|formal|informal|tone|emoji)/iu.test(text)) return 'style';
  if (/(работа|работаю|работает|бухгалт|главбух|юрист|экономист|финансист|аутсорс|ведёт|веду|ведет|УСН|ОСНО|АУСН|патент|НДС|1С|1C|Excel|Контур|СБИС|компани|клиент|должност|роль|занима|программ|отчётн|отчетн|work|accountant|lawyer|role|clients?|software|company)/iu.test(text)) return 'work';
  if (/(зовут|меня\s+зовут|живу|город|родной\s+язык|my\s+name|i\s+live)/iu.test(text)) return 'who';
  return 'facts';
}

export function skipOf(text: string): ImportSkip | null {
  if (isSecret(text)) return 'secret';
  if (ruleConflict(text)) return 'rules';
  if (CLIENT_DATA.test(text) || workData(text)) return 'client';
  if (sensitiveTopic(text) || personalTopic(text)) return 'sensitive';
  return null;
}

export function parseImport(raw: string, existing: { text: string }[] = []): ImportItem[] {
  const out: ImportItem[] = [];
  const seen: string[] = [];
  for (const line0 of raw.slice(0, IMPORT_MAX_CHARS).split(/\r?\n/)) {
    const bullet = BULLET.test(line0);
    let line = line0.replace(BULLET, '').replace(/\*\*|__|`/g, '').replace(/^#+\s*/, '').trim();
    if (!line || line.length < 3) continue;
    if (HEADER.test(line) && line.length < 80) continue;
    if (!bullet && CHATTER.test(line)) continue;
    const unsure = UNSURE.test(line);
    if (unsure) { line = line.replace(UNSURE, ''); line = line.charAt(0).toUpperCase() + line.slice(1); }
    line = cleanText(line);
    if (line.length < 3) continue;
    if (line.length > MAX_TEXT) line = line.slice(0, MAX_TEXT - 1).replace(/\s+\S*$/u, '') + '…';
    if (seen.some((s) => similarity(s, line) >= SAME)) continue;
    seen.push(line);
    const skip = skipOf(line) ?? (existing.some((r) => similarity(r.text, line) >= SAME) ? 'dup' : null);
    out.push({ text: skip === 'secret' ? '' : line, section: sectionOf(line), ...(skip ? { skip } : {}), ...(unsure && !skip ? { unsure: true } : {}) });
    if (out.length >= IMPORT_MAX_ITEMS) break;
  }
  return out;
}

export const parseImportFor = (userId: string, raw: string) => parseImport(raw, listMemory(userId));

export function saveImport(userId: string, items: { text: string; section: Section }[]): { added: number; same: number; refused: number } {
  let added = 0, same = 0, refused = 0;
  for (const it of items.slice(0, IMPORT_MAX_ITEMS)) {
    const text = cleanText(it.text).slice(0, MAX_TEXT);
    if (!text || skipOf(text)) { refused++; continue; }
    const r = addMemory(userId, { section: it.section, text, origin: 'manual', sure: true });
    if (!r.ok) refused++; else if (r.action === 'same') same++; else added++;
  }
  console.log(`[memory] import user=${userId.slice(0, 8)} added=${added} same=${same} refused=${refused}`);
  return { added, same, refused };
}
