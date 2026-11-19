import { sql } from 'drizzle-orm';
import { getDb } from './db';
import { publish } from './bus';
import { curatorBusy, curatorUrl, MODEL } from './curator';
import { bgActive, bgDown, isBg, modelFor } from './bgEngine';
import { liveTotal } from './jobs';
import { INTRO, addMemory, deleteMemory, isSecret, listMemory, memoryAllowed, memoryMeta, personalTopic, ruleConflict, sensitiveTopic, setMemoryMeta } from './memory';
import { userLang } from './userLang';

export const RULES_MAX = 15;
const IDLE_MS = () => Number(process.env.KX_RULES_IDLE_MS) || 60_000;
const TICK_MS = () => Number(process.env.KX_RULES_TICK_MS) || 15_000;
const TIMEOUT_MS = () => Number(process.env.KX_RULES_TIMEOUT_MS) || 180_000;
const CLIENT_DATA = /(ИНН|КПП|ОГРН|р\/с|расч[её]тн\S*\s+сч[её]т|(?<!\d)\d{10}(?!\d)|(?<!\d)\d{12}(?!\d)|ООО\s*[«"]|ИП\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ])/u;

type St = { on: boolean; running: boolean; cur: string | null; idleSince: number; timer: NodeJS.Timeout | null; ac: AbortController | null; stats: { runs: number; done: number; yielded: number; fail: number } };
const g = globalThis as unknown as { __kxRules?: St };
const S = (): St => (g.__kxRules ??= { on: false, running: false, cur: null, idleSince: 0, timer: null, ac: null, stats: { runs: 0, done: 0, yielded: 0, fail: 0 } });

export function queueRules(userId: string, now = Date.now()) {
  const r = memoryMeta(userId).rules ?? {};
  setMemoryMeta(userId, { rules: { ...r, pending: now } });
}

const SYSTEM_RU = [
  'Ты выводишь для ассистента Korvex короткие правила «как работать с этим человеком» — по его ответам в знакомстве, его первым сообщениям и записям памяти. Верни JSON {"rules": [...]}.',
  'Правил 5–15, каждое — одна короткая фраза до 15 слов, как указание ассистенту: «Считать НДС до копеек», «"Закрыть месяц" у него = сверка банка, НДС и зарплата», «Ставки и сроки сверять по nalog.gov.ru и Консультанту», «Сначала итог, потом расчёт».',
  'Что включать: его термины и сленг и что он под ними имеет в виду; какие проверки делать всегда; на какие источники опираться; как подавать ответ (порядок, формат, единицы, округление).',
  'Только то, что прямо следует из его слов. Ничего не выдумывай: данных мало — правил меньше (можно и 0).',
  'Не включай: чувствительное (здоровье, политика, религия, личные деньги, отношения); пароли и ключи; данные его клиентов (названия, ИНН, суммы); то, что уже дословно записано в памяти; то, что противоречит правилам Korvex.',
  'Правила меняют форму ответа, а не факты: нормы, ставки и цифры ассистент всё равно проверяет заново — не пиши правил вида «ставка всегда N %».',
].join('\n');
const SYSTEM_EN = [
  'You derive short rules for the Korvex assistant on "how to work with this person" from their answers in getting-to-know-each-other, their first messages and memory notes. Return JSON {"rules": [...]}.',
  'Give 5–15 rules, each one short phrase up to 15 words, as an instruction to the assistant.',
  'Include: their terms and slang and what they mean; checks to always do; sources to rely on; how to present answers (order, format, units, rounding).',
  'Only what directly follows from their words. Invent nothing: little data — fewer rules (even 0).',
  'Do not include: sensitive topics; passwords and keys; their clients\' data; what is already noted verbatim; anything against Korvex rules.',
  'Rules change the form of answers, not facts: norms, rates and numbers are always re-checked.',
].join('\n');
const SCHEMA = { type: 'object', properties: { rules: { type: 'array', maxItems: RULES_MAX, items: { type: 'string', maxLength: 160 } } }, required: ['rules'], additionalProperties: false };

export function rulesRequest(input: string, en: boolean, model: string) {
  return { model, stream: false, max_tokens: 700, temperature: 0, chat_template_kwargs: { enable_thinking: false },
    messages: [{ role: 'system', content: en ? SYSTEM_EN : SYSTEM_RU }, { role: 'user', content: input }],
    response_format: { type: 'json_schema', json_schema: { name: 'memory_rules', strict: true, schema: SCHEMA } } };
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);
export function rulesInput(userId: string): string {
  const db = getDb();
  const rows = listMemory(userId).filter((r) => r.sure !== 0 && !sensitiveTopic(r.text) && !isSecret(r.text));
  const intro = db.all<{ role: string; content: string; meta: string | null }>(sql`select m.role, m.content, m.meta from messages m join threads t on t.id = m.thread_id
    where t.user_id = ${userId} and t.temporary = ${INTRO} order by m.created_at limit 40`).filter((m) => !(m.meta && JSON.parse(m.meta)?.hidden));
  const first = db.all<{ content: string }>(sql`select m.content from messages m join threads t on t.id = m.thread_id
    where t.user_id = ${userId} and t.temporary = 0 and m.role = 'user' and t.id in (select id from threads where user_id = ${userId} and temporary = 0 order by created_at limit 3)
    order by m.created_at limit 12`);
  const out = ['Записи памяти:', ...(rows.length ? rows.map((r) => `- [${r.section}] ${r.text}`) : ['(пусто)'])];
  if (intro.length) out.push('', 'Знакомство:', ...intro.map((m) => `${m.role === 'user' ? 'Он' : 'Ассистент'}: ${clip(m.content.replace(/\s+/g, ' '), 400)}`));
  if (first.length) out.push('', 'Его первые сообщения в чатах:', ...first.map((m) => `- ${clip(m.content.replace(/\s+/g, ' '), 300)}`));
  out.push('', 'Правила (JSON):');
  return clip(out.join('\n'), 9000);
}

export function parseRules(raw: string, have: string[]): string[] {
  let j: { rules?: unknown };
  try { j = JSON.parse(raw.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').trim().replace(/^[^{]*/, '').replace(/[^}]*$/, '')); } catch { return []; }
  if (!Array.isArray(j.rules)) return [];
  const seen = new Set(have.map((x) => x.toLowerCase().trim()));
  const out: string[] = [];
  for (const x of j.rules) {
    const t = String(x ?? '').replace(/\s+/g, ' ').trim().replace(/^[-•\d.)\s]+/, '');
    if (t.length < 4 || t.length > 160) continue;
    if (isSecret(t) || personalTopic(t) || ruleConflict(t) || CLIENT_DATA.test(t)) continue;
    if (seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase()); out.push(t);
    if (out.length >= RULES_MAX) break;
  }
  return out;
}

export async function runRules(userId: string, o: { fetchImpl?: typeof fetch; now?: boolean } = {}): Promise<'done' | 'yield' | 'skip' | 'fail'> {
  const s = S();
  if (!memoryAllowed(userId, null)) { setMemoryMeta(userId, { rules: { ...(memoryMeta(userId).rules ?? {}), pending: undefined } }); return 'skip'; }
  const url = curatorUrl();
  if (!url) return 'skip';
  const onBg = isBg(url) || !!o.now;
  const body = rulesRequest(rulesInput(userId), userLang(userId) !== 'ru', modelFor(url, MODEL()));
  const ac = new AbortController(); s.ac = ac;
  let yielded = false;
  const watch = setInterval(() => { if (!onBg && liveTotal() > 0) { yielded = true; ac.abort(); } }, 500);
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS());
  const t0 = Date.now();
  try {
    const r = await (o.fetchImpl ?? fetch)(url + '/chat/completions', { method: 'POST', signal: ac.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { void r.body?.cancel(); console.log(`[rules] user=${userId.slice(0, 8)} HTTP ${r.status}`); if (r.status === 502) bgDown(url, 'правила'); return r.status >= 500 || r.status === 429 ? 'yield' : 'fail'; }
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    const meta = memoryMeta(userId).rules ?? {};
    const old = new Set(meta.ids ?? []);
    const keep = listMemory(userId).filter((x) => !old.has(x.id)).map((x) => x.text);
    const rules = parseRules(j.choices?.[0]?.message?.content ?? '', keep);
    if (old.size) deleteMemory(userId, [...old]);
    const ids: string[] = [];
    for (const t of rules) { const w = addMemory(userId, { section: 'rules', text: t, origin: 'auto', sure: true }); if (w.ok && w.action !== 'same') ids.push(w.row.id); }
    setMemoryMeta(userId, { rules: { done: Date.now(), n: ids.length, ids, seen: ids.length ? undefined : Date.now(), now: meta.now } });
    if (ids.length) publish(userId, { t: 'memory', action: 'rules', n: ids.length });
    console.log(`[rules] user=${userId.slice(0, 8)} ms=${Date.now() - t0} rules=${ids.length}`);
    return 'done';
  } catch (e) {
    if (yielded) { console.log(`[rules] user=${userId.slice(0, 8)} уступил ходу человека через ${Date.now() - t0} мс`); return 'yield'; }
    console.log(`[rules] user=${userId.slice(0, 8)} ошибка ${(e as Error).message.slice(0, 80)}`);
    if (!ac.signal.aborted && bgDown(url, 'правила')) return 'yield';
    if (!ac.signal.aborted && netDown(e)) return 'yield';
    return ac.signal.aborted ? 'yield' : 'fail';
  } finally { clearInterval(watch); clearTimeout(timer); s.ac = null; }
}

const NET_DOWN = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']);
function netDown(e: unknown): boolean {
  let x = e as { code?: string; cause?: unknown } | undefined;
  for (let i = 0; x && i < 4; i++) { if (x.code && NET_DOWN.has(x.code)) return true; x = x.cause as typeof x; }
  return (e as Error)?.message === 'fetch failed';
}

function nextPending(): string | null {
  const r = getDb().get<{ id: string }>(sql`select id from users where json_extract(memory_meta, '$.rules.pending') is not null order by json_extract(memory_meta, '$.rules.pending') limit 1`);
  return r?.id ?? null;
}

function nowQueue(): string[] {
  return getDb().all<{ id: string }>(sql`select id from users where json_extract(memory_meta, '$.rules.pending') is not null and json_extract(memory_meta, '$.rules.now') is not null
    order by json_extract(memory_meta, '$.rules.now')`).map((r) => r.id);
}

export async function rulesTick(now = Date.now()): Promise<string | null> {
  const s = S();
  if (s.running) return null;
  const urgent = rulesNowOn() && !curatorBusy() ? nowQueue()[0] : undefined;
  if (urgent) return runOne(urgent, true);
  if ((!bgActive(now) && liveTotal() > 0) || curatorBusy()) { s.idleSince = 0; return null; }
  if (!s.idleSince) { s.idleSince = now; return null; }
  if (now - s.idleSince < IDLE_MS()) return null;
  const userId = nextPending();
  if (!userId) return null;
  return runOne(userId, false);
}

async function runOne(userId: string, urgent: boolean): Promise<string | null> {
  const s = S();
  s.running = true; s.cur = userId; s.stats.runs++;
  let r: Awaited<ReturnType<typeof runRules>> = 'skip';
  try {
    r = await runRules(userId, { now: urgent });
    if (r === 'done') s.stats.done++;
    else if (r === 'yield') { s.stats.yielded++; s.idleSince = 0; return 'yield'; }
    else if (r === 'fail') { s.stats.fail++; const m = memoryMeta(userId).rules ?? {}; setMemoryMeta(userId, { rules: { ...m, pending: undefined, failed: Date.now() } }); }
    return r;
  } finally { s.running = false; s.cur = null; if (r !== 'yield' && nowQueue().length) kickRules(); }
}

export const rulesNowOn = () => process.env.KX_RULES_NOW !== '0' && process.env.KX_MEMORY_RULES !== '0' && process.env.KX_MEMORY_CURATOR !== '0' && !!curatorUrl();

export type RulesView = { state: 'none' | 'offer' | 'queued' | 'running' | 'done' | 'failed'; n: number; pos: number };
export function rulesView(userId: string): RulesView {
  const none: RulesView = { state: 'none', n: 0, pos: 0 };
  if (!rulesNowOn()) return none;
  const m = memoryMeta(userId), r = m.rules ?? {};
  if (!m.introEnd) return none;
  const s = S();
  if (s.cur === userId) return { state: 'running', n: 0, pos: 0 };
  if (r.pending) {
    if (r.now) { const q = nowQueue().filter((id) => id !== s.cur); const i = q.indexOf(userId); return { state: 'queued', n: 0, pos: (i < 0 ? q.length : i) + 1 + (s.running ? 1 : 0) }; }
    return r.later ? none : { state: 'offer', n: 0, pos: 0 };
  }
  if (r.now && r.failed && r.failed > (r.done ?? 0)) return { state: 'failed', n: 0, pos: 0 };
  if (r.now && r.done && !r.nowSeen) return { state: 'done', n: r.n ?? 0, pos: 0 };
  return none;
}

export function rulesAction(userId: string, action: 'now' | 'later' | 'seen', now = Date.now()): RulesView {
  const v = rulesView(userId);
  const r = memoryMeta(userId).rules ?? {};
  if (action === 'now' && (v.state === 'offer' || v.state === 'failed')) {
    setMemoryMeta(userId, { rules: { ...r, pending: r.pending ?? now, now, later: undefined, failed: undefined } });
    kickRules();
  } else if (action === 'later' && v.state === 'offer') setMemoryMeta(userId, { rules: { ...r, later: now } });
  else if (action === 'seen' && v.state === 'done') setMemoryMeta(userId, { rules: { ...r, nowSeen: now, seen: r.seen ?? now } });
  return rulesView(userId);
}

export function kickRules() {
  if (!S().on) return;
  setTimeout(() => { void rulesTick().catch((e) => console.error('[rules]', (e as Error).message)); }, 0);
}

export function registerRules() {
  const s = S();
  if (s.on || process.env.KX_MEMORY_RULES === '0' || process.env.KX_MEMORY_CURATOR === '0' || !curatorUrl()) return;
  s.on = true;
  s.timer = setInterval(() => { void rulesTick().catch((e) => console.error('[rules]', (e as Error).message)); }, TICK_MS());
  s.timer.unref?.();
}
export function rulesStats() { const s = S(); return { ...s.stats, running: s.running }; }

export function rulesNotice(userId: string): number {
  const r = memoryMeta(userId).rules;
  return r?.n && !r.seen ? r.n : 0;
}
export function rulesSeen(userId: string) {
  setMemoryMeta(userId, { rules: { ...(memoryMeta(userId).rules ?? {}), seen: Date.now() } });
}
