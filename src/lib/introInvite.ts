import { eq } from 'drizzle-orm';
import { getDb, schema } from './db';
import { featureFor } from './features';
import { lateIntroEnd, memoryMeta, memoryPrefs, setMemoryMeta } from './memory';
import { userLang } from './userLang';
import type { MemoryMeta } from './db/schema';

const DAY = 864e5;
export const LATER_MAX = 2;
export const USEFUL_MIN = 200;
export const SHOWN_MAX = 5;

export function dayKey(ts: number, tz: string): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ts); }
  catch { return new Date(ts).toISOString().slice(0, 10); }
}
type Inv = NonNullable<MemoryMeta['invite']>;
function patch(userId: string, p: Partial<Inv>) {
  setMemoryMeta(userId, { invite: { ...(memoryMeta(userId).invite ?? {}), ...p } });
}

export type InviteWhy = 'ok' | 'no-user' | 'memory-off' | 'done' | 'never' | 'later-max' | 'later' | 'shown-max' | 'today';
export function inviteWhy(userId: string, now = Date.now()): InviteWhy {
  const u = getDb().select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!u) return 'no-user';
  if (!featureFor('memory', userId) || !memoryPrefs(userId).on) return 'memory-off';
  const meta = memoryMeta(userId);
  if (meta.introDone || meta.introEnd) return 'done';
  const inv = meta.invite ?? {};
  if (inv.never) return 'never';
  if ((inv.laterN ?? 0) >= LATER_MAX) return 'later-max';
  if (inv.laterAt && now - inv.laterAt < DAY) return 'later';
  if (inv.at && now - inv.at < DAY) return 'today';
  if ((inv.shown ?? 0) >= SHOWN_MAX) return 'shown-max';
  return 'ok';
}

export function inviteUnder(userId: string, messageId: string, answer: string, now = Date.now()): boolean {
  if (answer.trim().length < USEFUL_MIN) return false;
  if (inviteWhy(userId, now) !== 'ok') return false;
  const inv = memoryMeta(userId).invite ?? {};
  patch(userId, { msg: messageId, at: now, shown: (inv.shown ?? 0) + 1 });
  console.log(`[invite] line user=${userId.slice(0, 8)} shown=${(inv.shown ?? 0) + 1}`);
  return true;
}

export function inviteLineOn(userId: string, messageId: string): boolean {
  const meta = memoryMeta(userId), inv = meta.invite ?? {};
  if (meta.introDone || meta.introEnd || inv.never || inv.msg !== messageId) return false;
  if (!featureFor('memory', userId) || !memoryPrefs(userId).on) return false;
  return !(inv.laterAt && inv.at && inv.laterAt >= inv.at);
}

export function inviteLater(userId: string, now = Date.now()) {
  const inv = memoryMeta(userId).invite ?? {};
  patch(userId, { laterN: (inv.laterN ?? 0) + 1, laterAt: now });
}
export function inviteNever(userId: string, now = Date.now()) {
  patch(userId, { never: now });
}

export function inviteReply(text: string): 'never' | null {
  const t = text.trim().toLowerCase();
  return /не\s+(предлагай|предлагайте|зови|зовите|надо|нужно|хочу)\S*\s+(мне\s+)?(больше\s+)?(со\s+мной\s+)?(по)?знаком/iu.test(t) ? 'never' : null;
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
  void prevAnswer; void levelId;
  if (!userMsg) return [];
  lateIntroEnd(userId, now);
  const lang = userLang(userId) === 'ru' ? 'ru' : 'en';
  const text = userMsg.content ?? '';
  const out: string[] = [];
  const st = styleRequest(text);
  if (st) out.push(styleNote(st, lang));
  if (asksToConfirm(text)) out.push(confirmNote(lang));
  if (inviteReply(text) === 'never') inviteNever(userId, now);
  return out;
}
