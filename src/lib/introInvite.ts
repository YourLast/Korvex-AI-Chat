import { eq } from 'drizzle-orm';
import { getDb, schema } from './db';
import { featureFor } from './features';
import { listMemory, memoryMeta, memoryPrefs, setMemoryMeta } from './memory';
import { userLang } from './userLang';
import type { MemoryMeta } from './db/schema';

export const INVITE_DAYS = 7;
export const INVITE_MAX = 7;
const DAY = 864e5;

export function dayKey(ts: number, tz: string): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ts); }
  catch { return new Date(ts).toISOString().slice(0, 10); }
}
function userOf(userId: string) {
  return getDb().select({ at: schema.users.createdAt, tz: schema.users.lastTz, tz2: schema.users.timezone }).from(schema.users).where(eq(schema.users.id, userId)).get();
}
type Inv = NonNullable<MemoryMeta['invite']>;

export type InviteState = { eligible: boolean; widget: boolean; modelDue: boolean; why: string; day: string; inv: Inv };
export function inviteState(userId: string, now = Date.now()): InviteState {
  const u = userOf(userId);
  const meta = memoryMeta(userId);
  let inv: Inv = { ...(meta.invite ?? {}) };
  const day = dayKey(now, u?.tz || u?.tz2 || 'UTC');
  const no = (why: string): InviteState => ({ eligible: false, widget: false, modelDue: false, why, day, inv });
  if (!u) return no('no-user');
  if (!featureFor('memory', userId) || !memoryPrefs(userId).on) return no('memory-off');
  if (meta.introDone || meta.introEnd) return no('done');
  if (inv.never) return no('never');
  if (!inv.start) { inv = { ...inv, start: now - u.at < INVITE_DAYS * DAY ? u.at : now }; setMemoryMeta(userId, { invite: inv }); }
  if (now - inv.start! >= INVITE_DAYS * DAY) return no('expired');
  if ((inv.shown ?? 0) >= INVITE_MAX) return no('shown-max');
  const later = inv.later === day;
  return { eligible: true, widget: !later, modelDue: !later && inv.day !== day, why: later ? 'later' : 'ok', day, inv };
}
function patch(userId: string, p: Partial<Inv>) {
  setMemoryMeta(userId, { invite: { ...(memoryMeta(userId).invite ?? {}), ...p } });
}
export function markInvited(userId: string, day: string) {
  const inv = memoryMeta(userId).invite ?? {};
  patch(userId, { day, shown: (inv.shown ?? 0) + 1 });
}
export function inviteLater(userId: string, now = Date.now()) {
  const u = userOf(userId);
  patch(userId, { later: dayKey(now, u?.tz || u?.tz2 || 'UTC') });
}
export function inviteNever(userId: string, now = Date.now()) {
  patch(userId, { never: now });
}

export function inviteReply(text: string, prevAnswer: string | null | undefined): 'never' | 'later' | null {
  const t = text.trim().toLowerCase();
  if (/не\s+(предлагай|предлагайте|зови|зовите|надо|нужно|хочу)\S*\s+(мне\s+)?(больше\s+)?(со\s+мной\s+)?(по)?знаком/iu.test(t)) return 'never';
  if (!prevAnswer || !prevAnswer.includes('/settings/memory#intro')) return null;
  if (/^(не\s+сейчас|потом|позже|later|not\s+now)(?![\p{L}])/iu.test(t)) return 'later';
  if (/^(нет|неа|не\s+(хочу|надо|нужно|буду|интересно)|no|nope)(?![\p{L}])/iu.test(t) && t.length < 120) return 'never';
  return null;
}

const VY_CUE = /(?<![\p{L}])(вы|вас|вам|ваш\S*|подскажите|скажите|помогите|посчитайте|рассчитайте|пересчитайте|проверьте|сделайте|напишите|объясните|выделите|переведите|прикиньте|составьте|покажите|дайте|найдите|сравните|распишите|оформите|начислите|разберите|заполните|сформируйте)(?![\p{L}])/iu;
const TY_CUE = /(?<![\p{L}])(ты|тебя|тебе|твой|тво[ияеё]\S*|подскажи|скажи|помоги|посчитай|рассчитай|пересчитай|проверь|сделай|напиши|объясни|глянь|выдели|переведи|прикинь|составь|покажи|дай|найди|сравни|распиши|оформи|начисли|разбери|заполни|сформируй|набросай)(?![\p{L}])/iu;
const TY_HELLO = /^\s*(привет\S*|прив|здоров[оа]|хай|салют|ку)(?![\p{L}])/iu;
const VY_HELLO = /^\s*(добр(ый|ое|ого)\s+(день|утро|вечер|утра|дня|вечера)|здравствуйте)(?![\p{L}])/iu;
export function mannerOf(userId: string, text: string): string {
  const rows = listMemory(userId);
  const parts: string[] = [];
  const w = rows.find((r) => r.key === 'writes')?.text;
  if (w) parts.push(w.replace(/^Пишет:\s*/u, 'пишет '));
  const adr = rows.find((r) => r.key === 'address' && r.sure !== 0)?.text;
  if (adr) parts.push(`обращение: ${adr}`);
  else if (VY_CUE.test(text)) parts.push('в этом сообщении — на «вы»');
  else if (TY_CUE.test(text)) parts.push('в этом сообщении — на «ты»');
  else if (TY_HELLO.test(text)) parts.push('в этом сообщении — неформально («привет»): на «ты»');
  else if (VY_HELLO.test(text)) parts.push('в этом сообщении — «Добрый день» / «Здравствуйте»: на «вы»');
  return parts.join('; ');
}
function inviteExamples(manner: string): string {
  const L = '/settings/memory#intro';
  if (/на\s*«?ты/u.test(manner)) return `бухгалтеру после вопроса по НДС — «Кстати, если расскажешь, на каких режимах твои клиенты и что ты обычно проверяешь, буду сразу считать под это — это [пара минут](${L})»; после вопроса про расход топлива — «Кстати, если расскажешь, для чего считаешь расход — свои поездки, автопарк или доставка, — буду сразу считать под это: [пара минут](${L})»`;
  if (/на\s*«?вы/u.test(manner)) return `бухгалтеру после вопроса по НДС — «Кстати, если расскажете, на каких режимах ваши клиенты и что вы обычно проверяете, буду сразу считать под это — это [пара минут](${L})»; после вопроса про расход топлива — «Кстати, если расскажете, для чего считаете расход — свои поездки, автопарк или доставка, — буду сразу считать под это: [пара минут](${L})»`;
  return `бухгалтеру после вопроса по НДС — «Кстати, пара слов о режимах клиентов и о том, что обычно проверяется, — и буду сразу считать под это: [знакомство на пару минут](${L})»; после вопроса про расход топлива — «Кстати, пара слов о том, для чего нужен такой расчёт — свои поездки, автопарк или доставка, — и буду сразу считать под это: [знакомство на пару минут](${L})»`;
}
export function inviteNote(lang: 'ru' | 'en', manner = ''): string {
  return lang === 'en'
    ? `[Korvex service note, not the person's words: first answer their message fully. Then, at the very end, in one or two plain sentences, offer to get to know each other, tied to what they are doing right now: say that if they tell you a bit about their work and how they like answers, you will answer the way they need from the start. Make a few words of it a link to /settings/memory#intro. Match their manner${manner ? ` (${manner})` : ''}: formal and dry with a formal writer, simpler with a casual one, never overly familiar. No advertising, no list of benefits, no exclamation marks, nothing about yourself. Do not ask them anything about themselves here and do not mention this note.]`
    : `[Служебная заметка Korvex, не слова человека: сначала полностью ответь на его сообщение. Потом в самом конце одним-двумя обычными предложениями предложи познакомиться — по теме его вопроса: назови эту тему словом из вопроса (спросил про расход топлива — «расход и поездки», про НДС — «режимы клиентов») и скажи, что если он расскажет, для какой работы это считает и как ему удобнее, будешь сразу отвечать под это. Не «чем занимаешься» вообще — именно про его тему. Пара слов — ссылка на /settings/memory#intro, например [пара минут](/settings/memory#intro). Примеры: ${inviteExamples(manner)}. Пиши в его манере${manner ? ` (${manner})` : ''}: с тем, кто пишет на «вы» и сухо, — на «вы» и сухо; с неформальным — проще, но без панибратства. ${/на\s*«?ты/u.test(manner) ? 'Обращение — на «ты» во всей этой строке: «расскажешь», «твои», «у тебя»; ни одного «вы», «ваш», «расскажете».' : /на\s*«?вы/u.test(manner) ? 'Обращение — на «вы» во всей этой строке: «расскажете», «ваши», «у вас»; ни одного «ты», «твой».' : 'Как он обращается, неизвестно — в этой строке ни «ты», ни «вы» ни в какой форме («расскажешь» и «расскажете», «твои» и «ваши», «у тебя» и «у вас») — безлично, как в примерах.'} Без рекламы, без списка плюсов, без восклицаний и «уникальной возможности», без рассказа о себе. Здесь сам о нём не расспрашивай и эту заметку не упоминай.]`;
}

const STYLE_WORDS = String.raw`(?:по)?короче|кратко|коротко|кратче|подробнее|подробно|развёрнуто|развернуто|проще|попроще|без\s+воды|по\s+делу|на\s+«?ты»?|на\s+«?вы»?|таблиц\S*|списком|пунктами|без\s+эмодзи|без\s+смайл\S*|по-русски|по-английски|строже|серьёзнее|серьезнее|с\s+юмором|без\s+вступлений|без\s+лишнего`;
const FILL = String.raw`[\s,]+(?:(?:мне|теперь|дальше|впредь|всегда|пожалуйста|плиз|все\s+ответы)[\s,]+)*`;
const STYLE_REQ = new RegExp(String.raw`(?:^|[\s,.!;:—-])((?:пиши|пишите|отвечай|отвечайте|говори|говорите|объясняй|объясняйте|формулируй|оформляй|будь)${FILL}(?:${STYLE_WORDS}))`, 'iu');
const STYLE_TY = new RegExp(String.raw`(?:^|[\s,.!;:—-])((?:давай|давайте|можно|можешь|лучше|перейдём|перейдем)${FILL}(?:на\s+«?ты»?|на\s+«?вы»?))`, 'iu');
const STYLE_ALONE = /^\s*((?:без\s+воды|на\s+«?ты»?|на\s+«?вы»?|короче\s+пиши|без\s+эмодзи)(?:\s+(?:пожалуйста|плиз))?)\s*[.!]?\s*$/iu;
const STYLE_EN = /\b((?:please\s+)?(?:be\s+(?:more\s+)?(?:brief|concise)|(?:write|answer|reply)\s+(?:shorter|briefly|in\s+(?:a\s+)?table|in\s+bullet\s+points|without\s+fluff|more\s+simply)|shorter\s+answers|no\s+emojis))\b/iu;
export function styleRequest(text: string): string | null {
  const t = text.trim();
  if (!t || t.length > 600) return null;
  const m = t.match(STYLE_REQ) ?? t.match(STYLE_TY) ?? t.match(STYLE_ALONE) ?? t.match(STYLE_EN);
  if (!m) return null;
  if (/^(как|почему|зачем|how|why)(?![\p{L}])/iu.test(t)) return null;
  return m[1].trim().slice(0, 80);
}
export function styleNote(phrase: string, lang: 'ru' | 'en'): string {
  return lang === 'en'
    ? `[Korvex service note, not the person's words: they ask you to answer differently ("${phrase}"). Start your reply with a short "Got it, will do." and answer that way right away, in this reply and further in this chat.]`
    : `[Служебная заметка Korvex, не слова человека: он просит отвечать иначе («${phrase}»). Начни ответ коротко: «Понял, буду так.» — и сразу так и отвечай: в этом ответе и дальше в этом чате.]`;
}

const CONFIRM = /(правильно|верно|так\s+ведь|так\s+же|я\s+прав|не\s+ошиб\S*|сходится|ок|да)\s*\?|(правильно|верно)\s+ли|подтверди\S*|am\s+i\s+right|is\s+(that|it|this)\s+(right|correct)|correct\s*\?|right\s*\?/iu;
const FIGURE = /\d|ставк|норм|лимит|порог|срок|мрот|ндс|ндфл|усн|rate|limit|deadline/iu;
export const asksToConfirm = (text: string): boolean => text.length <= 1500 && CONFIRM.test(text) && FIGURE.test(text);
export function confirmNote(lang: 'ru' | 'en'): string {
  return lang === 'en'
    ? '[Korvex service note, not the person\'s words: they ask you to confirm a figure or rule. Check it yourself on the merits, exactly as you would without memory; if it is wrong or outdated, say so plainly and give the correct value. Their profile changes only the form of the answer. Do not mention this note.]'
    : '[Служебная заметка Korvex, не слова человека: он просит подтвердить цифру или норму. Проверь её сам по существу — так же, как без памяти; неверная или устаревшая — прямо скажи и дай верное значение. Его профиль меняет только форму ответа. Заметку не упоминай.]';
}

export function turnNotes(userId: string, userMsg: { content: string; meta?: unknown } | null, prevAnswer: string | null, levelId: string, now = Date.now()): string[] {
  if (!userMsg) return [];
  const lang = userLang(userId) === 'ru' ? 'ru' : 'en';
  const text = userMsg.content ?? '';
  const out: string[] = [];
  const st = styleRequest(text);
  if (st) out.push(styleNote(st, lang));
  if (asksToConfirm(text)) out.push(confirmNote(lang));
  const reply = inviteReply(text, prevAnswer);
  if (reply === 'never') { inviteNever(userId, now); return out; }
  if (reply === 'later') { inviteLater(userId, now); return out; }
  const files = ((userMsg.meta as { fileIds?: unknown[] } | null)?.fileIds ?? []).length;
  const heavy = levelId === 'xhigh' || levelId === 'max' || files > 0;
  if (!heavy) {
    const s = inviteState(userId, now);
    if (s.modelDue) { out.push(inviteNote(lang, mannerOf(userId, text))); markInvited(userId, s.day); console.log(`[invite] user=${userId.slice(0, 8)} day=${s.day} shown=${(s.inv.shown ?? 0) + 1}`); }
  }
  return out;
}
