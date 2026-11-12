import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { tmpData } from './helpers';

const dir = tmpData();
let srv: https.Server, host = '';
const got: { headers: http.IncomingHttpHeaders; body: Buffer; path: string }[] = [];
let respond = 201;

type Db = ReturnType<typeof import('@/lib/db').getDb>;
let db: Db, schema: typeof import('@/lib/db').schema;
let P: typeof import('@/lib/push'), N: typeof import('@/lib/notify'), B: typeof import('@/lib/bus');

beforeAll(async () => {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
    '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem')], { stdio: 'ignore' });
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  srv = https.createServer({ key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { got.push({ headers: req.headers, body: Buffer.concat(chunks), path: req.url ?? '' }); res.writeHead(respond); res.end(); });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  host = `127.0.0.1:${(srv.address() as AddressInfo).port}`;
  process.env.KX_PUSH_ALLOW_HOSTS = host;
  const d = await import('@/lib/db');
  db = d.getDb(); schema = d.schema;
  db.insert(schema.users).values({ id: 'u', email: 'u@t', name: 'U', passwordHash: 'x', role: 'user', createdAt: 1 }).run();
  P = await import('@/lib/push'); N = await import('@/lib/notify'); B = await import('@/lib/bus');
});
afterAll(() => new Promise<void>((r) => srv.close(() => r())));

const pres = (device: string, visible: boolean, threads: string[]) => ({ userId: 'u', device, visible, threads, since: 0, seen: 0 });
const sub = (id: string, device: string) => ({ id, device, endpoint: `https://fcm.googleapis.com/x/${id}`, p256dh: 'k', auth: 'a', fails: 0 });
const J = { threadId: 't1', groupId: null, kind: 'chat' as const, status: 'done' as const };

describe('ключи VAPID', () => {
  it('создаются один раз в data/vapid.json с правами 0600 и не меняются', () => {
    const a = P.vapid();
    const file = path.join(dir, 'vapid.json');
    expect((fs.statSync(file).mode & 0o777).toString(8)).toBe('600');
    (globalThis as { __kxVapid?: unknown }).__kxVapid = undefined;
    expect(P.vapid().publicKey).toBe(a.publicKey);
    expect(a.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
  });
  it('адрес подписки — только службы push (не произвольный сервер)', () => {
    expect(P.endpointOk('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(P.endpointOk('https://web.push.apple.com/QF8xyz')).toBe(true);
    expect(P.endpointOk('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(P.endpointOk('http://fcm.googleapis.com/x')).toBe(false);
    expect(P.endpointOk('https://127.0.0.1:3101/api/x')).toBe(false);
    expect(P.endpointOk('https://evil.example/fcm.googleapis.com')).toBe(false);
  });
});

describe('правило уведомлений', () => {
  const now = 1_800_000_000_000;
  const slow = { ...J, createdAt: now - 60_000 }, fast = { ...J, createdAt: now - 5_000 };
  const ctx = (presence: ReturnType<typeof pres>[], extra: Partial<{ muted: boolean; quiet: boolean; chat: string[] }> = {}) => ({ presence, chat: ['t1'], muted: false, quiet: false, now, ...extra });
  it('чат на экране любого устройства — ничего', () => {
    expect(N.decide(slow, ctx([pres('phone', true, ['t1'])]))).toBe('none');
  });
  it('приложение открыто в другом чате: долгий ответ — тост, быстрый (< 20 с) — тихая отметка; ошибка — тост', () => {
    expect(N.decide(slow, ctx([pres('desk', true, ['t9'])]))).toBe('toast');
    expect(N.decide(fast, ctx([pres('desk', true, ['t9'])]))).toBe('quiet');
    expect(N.decide({ ...fast, status: 'error' }, ctx([pres('desk', true, ['t9'])]))).toBe('toast');
  });
  it('приложение свёрнуто или закрыто — push; вкладка с чатом скрыта — тоже push', () => {
    expect(N.decide(fast, ctx([]))).toBe('push');
    expect(N.decide(slow, ctx([pres('desk', false, ['t1'])]))).toBe('push');
  });
  it('«Не уведомлять» и тихие часы — только отметка', () => {
    expect(N.decide(slow, ctx([], { muted: true }))).toBe('quiet');
    expect(N.decide(slow, ctx([], { quiet: true }))).toBe('quiet');
  });
  it('сравнение: открыта другая колонка той же группы — ничего; API и «стоп» — ничего', () => {
    expect(N.decide(slow, ctx([pres('desk', true, ['t2'])], { chat: ['t1', 't2'] }))).toBe('none');
    expect(N.decide({ ...slow, kind: 'api' }, ctx([]))).toBe('none');
    expect(N.decide({ ...slow, status: 'cancelled' }, ctx([]))).toBe('none');
  });
  it('push — одному устройству, последнему активному', () => {
    const subs = [{ ...sub('s1', 'desk'), lastActiveAt: 100, createdAt: 1 }, { ...sub('s2', 'phone'), lastActiveAt: 500, createdAt: 2 }, { ...sub('s3', 'tab'), lastActiveAt: null, createdAt: 9 }];
    expect(N.pickDevice(subs)!.id).toBe('s2');
    expect(N.pickDevice([])).toBeNull();
  });
  it('тихие часы в часовом поясе пользователя, через полночь', () => {
    const at = (h: number, m = 0) => Date.UTC(2026, 9, 28, h - 3, m);
    expect(N.inQuiet('23:00-08:00', 'Europe/Moscow', at(23, 30))).toBe(true);
    expect(N.inQuiet('23:00-08:00', 'Europe/Moscow', at(7, 59))).toBe(true);
    expect(N.inQuiet('23:00-08:00', 'Europe/Moscow', at(8, 0))).toBe(false);
    expect(N.inQuiet('23:00-08:00', 'Europe/Moscow', at(14))).toBe(false);
    expect(N.inQuiet('13:00-15:00', 'Europe/Moscow', at(14))).toBe(true);
    expect(N.inQuiet(null, 'Europe/Moscow', at(23, 30))).toBe(false);
  });
  it('текст: модель, чат, выжимка; ссылка на ответ (#m-…); ошибка; автоматизация', () => {
    expect(N.payloadOf({ modelId: 'alpha', title: 'Квартальный отчёт', preview: 'Выручка выросла на 12 %', status: 'done', threadId: 't1', groupId: null, messageId: 'm1' }, 3))
      .toEqual({ title: 'Alpha ответила в чате «Квартальный отчёт»', body: 'Выручка выросла на 12 %', url: '/c/t1#m-m1', tag: 't1', badge: 3 });
    expect(N.payloadOf({ modelId: 'beta', title: 'X', preview: '', status: 'error', threadId: 't1', groupId: 'g1', messageId: 'm' })).toMatchObject({ title: 'Не удалось ответить в чате «X»', url: '/g/g1', tag: 'g1' });
    expect(N.payloadOf({ modelId: 'alpha', title: 'X', preview: 'Курс 95', status: 'done', threadId: 't1', groupId: null, messageId: 'm', autoName: 'Курсы на утро' })).toMatchObject({ title: 'Автоматизация «Курсы на утро» выполнена', body: 'Alpha: Курс 95' });
  });
});

describe('выжимка ответа', () => {
  it('первая содержательная фраза без Markdown, кода и таблиц, ≤ 100 символов', async () => {
    const { summarize } = await import('@/lib/summary');
    expect(summarize('## Итог\n\n**Выручка** выросла на 12 %, а `маржа` — нет. Дальше детали.')).toBe('Выручка выросла на 12 %, а маржа — нет.');
    expect(summarize('## Только заголовок')).toBe('Только заголовок');
    expect(summarize('```python\nprint(1)\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nСумма по таблице — [42](https://x.y) тыс. Подробнее ниже.')).toBe('Сумма по таблице — 42 тыс.');
    expect(summarize('- Первый пункт списка: проверено.\n- Второй')).toBe('Первый пункт списка: проверено.');
    const long = summarize('Очень ' + 'длинная фраза без точки '.repeat(10));
    expect(long.length).toBeLessThanOrEqual(100);
    expect(long.endsWith('…')).toBe(true);
    expect(summarize('Готово.\n\n📎 [отчёт.xlsx](/out/abc/отчёт.xlsx) (12 КБ)')).toBe('Готов файл «отчёт.xlsx»');
  });
});

describe('отправка', () => {
  it('настоящий web-push: служба получает зашифрованное (aes128gcm) с подписью VAPID; расшифровывается ключом подписки', async () => {
    // @ts-expect-error у http_ece нет типов (идёт вместе с web-push)
    const ece = (await import('http_ece')) as unknown as { decrypt: (b: Buffer, p: Record<string, unknown>) => Buffer };
    const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
    const auth = crypto.randomBytes(16).toString('base64url');
    P.saveSub('u', 'dev1', { endpoint: `https://${host}/push/abc`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth } }, 'test');
    const s = P.subsOf('u').find((x) => x.device === 'dev1')!;
    got.length = 0; respond = 201;
    expect(await P.sendPush(s, { title: 'Alpha ответила в чате «Т»', body: 'первые слова', url: '/c/t1', tag: 't1' })).toBe('ok');
    const r = got[0];
    expect(r.path).toBe('/push/abc');
    expect(r.headers['content-encoding']).toBe('aes128gcm');
    expect(String(r.headers.authorization)).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(r.headers.ttl).toBe('3600');
    const plain = JSON.parse(ece.decrypt(r.body, { version: 'aes128gcm', privateKey: ecdh, authSecret: auth }).toString('utf8'));
    expect(plain).toEqual({ title: 'Alpha ответила в чате «Т»', body: 'первые слова', url: '/c/t1', tag: 't1' });
    expect(P.subsOf('u').find((x) => x.device === 'dev1')!.lastOkAt).toBeGreaterThan(0);
  });
  it('служба ответила 410 (подписка отозвана) — подписка удаляется', async () => {
    const s = P.subsOf('u').find((x) => x.device === 'dev1')!;
    respond = 410;
    expect(await P.sendPush(s, { title: 't', body: 'b', url: '/' })).toBe('gone');
    expect(P.subsOf('u').some((x) => x.device === 'dev1')).toBe(false);
    respond = 201;
  });
  it('завершение задачи (notice=push): уведомление уходит одному — последнему активному устройству', async () => {
    const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
    const keys = { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') };
    P.saveSub('u', 'desk', { endpoint: `https://${host}/push/desk`, keys }, 'd');
    P.saveSub('u', 'phone', { endpoint: `https://${host}/push/phone`, keys }, 'p');
    (P as unknown as { touchDevice: (u: string, d: string) => void }).touchDevice('u', 'phone');
    got.length = 0;
    const fin = { id: 'j', userId: 'u', threadId: 't1', groupId: null, kind: 'chat' as const, messageId: 'm', modelId: 'alpha', levelId: 'low', status: 'done' as const, title: 'Т', preview: 'ок', error: null, createdAt: 0, autoName: null };
    expect(await N.notifyFinished({ ...fin, notice: 'push' })).toEqual(['ok']);
    expect(got.map((g) => g.path)).toEqual(['/push/phone']);
    got.length = 0;
    expect(await N.notifyFinished({ ...fin, notice: 'toast' })).toEqual([]);
    expect(await N.notifyFinished({ ...fin, notice: 'quiet' })).toEqual([]);
    expect(got).toHaveLength(0);
  });
});
