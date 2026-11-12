import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { dataDir, getDb, schema } from './db';
import { publish } from './bus';
import { cancelUserJobs } from './jobs';
import { isToken, outRoot } from './outfiles';
import { revokeInvite } from './invites';
import { syncIndex } from './search';
import { ext } from '@/ext';
import { isSystemActor, SRC_ADMIN, SRC_NONE, srcKeyOfInvite, type AuditAction, type AuditItem, type BlockKind, type Source, type SourceRow } from './moderationTypes';

export type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
const REASON_MAX = 500;
const clean = (s: unknown) => (typeof s === 'string' ? s.trim().slice(0, REASON_MAX) : '');


export function sourceMap(): Map<string, Source> {
  const db = getDb();
  const out = new Map<string, Source>();
  for (const r of db.all<{ uid: string; iid: string; note: string }>(sql`select iu.user_id uid, i.id iid, i.note note from invite_uses iu join invites i on i.id = iu.invite_id`)) {
    out.set(r.uid, { key: srcKeyOfInvite(r.iid), kind: 'invite', label: r.note.trim() || 'Ссылка без названия', inviteId: r.iid });
  }
  for (const u of db.select({ id: schema.users.id, source: schema.users.source }).from(schema.users).all()) {
    if (!out.has(u.id)) out.set(u.id, u.source === 'admin' ? SRC_ADMIN : SRC_NONE);
  }
  return out;
}

export function sourcesList(): SourceRow[] {
  const map = sourceMap();
  const rows = new Map<string, SourceRow>();
  for (const u of getDb().select({ id: schema.users.id, disabled: schema.users.disabled }).from(schema.users).all()) {
    const s = map.get(u.id) ?? SRC_NONE;
    let r = rows.get(s.key);
    if (!r) rows.set(s.key, (r = { ...s, n: 0, blocked: 0 }));
    r.n++; if (u.disabled) r.blocked++;
  }
  const rank = (r: SourceRow) => (r.kind === 'invite' ? 0 : r.kind === 'admin' ? 1 : 2);
  return [...rows.values()].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, 'ru'));
}


type Person = { id: string; name: string; email: string };
export function logAudit(p: { adminId: string; action: AuditAction; target?: Person | null; inviteId?: string | null; reason?: string; detail?: string }, now = Date.now()): string {
  const db = getDb();
  const adm = isSystemActor(p.adminId) ? { name: 'Система', email: '' } : db.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, p.adminId)).get();
  const id = randomUUID();
  db.insert(schema.adminAudit).values({
    id, at: now, adminId: p.adminId, adminName: adm?.name || adm?.email || '', action: p.action, targetId: p.target?.id ?? null, targetName: p.target?.name ?? '', targetEmail: p.target?.email ?? '',
    inviteId: p.inviteId ?? null, reason: clean(p.reason), detail: p.detail ?? '',
  }).run();
  return id;
}

export function auditLog(o: { limit?: number; offset?: number; userId?: string | null; inviteId?: string | null } = {}): AuditItem[] {
  const db = getDb();
  const lim = Math.min(200, Math.max(1, o.limit ?? 30)), off = Math.max(0, o.offset ?? 0);
  const where = o.userId ? sql`where target_id = ${o.userId}` : o.inviteId ? sql`where invite_id = ${o.inviteId}` : sql``;
  return db.all<{ id: string; at: number; admin_id: string; admin_name: string; action: string; target_id: string | null; target_name: string; target_email: string; invite_id: string | null; reason: string; detail: string }>(
    sql`select * from admin_audit ${where} order by at desc, rowid desc limit ${lim} offset ${off}`)
    .map((r) => ({ id: r.id, at: Number(r.at), adminId: r.admin_id, adminName: r.admin_name, action: r.action, targetId: r.target_id, targetName: r.target_name, targetEmail: r.target_email, inviteId: r.invite_id, reason: r.reason, detail: r.detail }));
}


type UserRow = typeof schema.users.$inferSelect;
const userOf = (id: string): UserRow | undefined => getDb().select().from(schema.users).where(eq(schema.users.id, id)).get();
const person = (u: UserRow): Person => ({ id: u.id, name: u.name, email: u.email });
const otherActiveAdmins = (exceptId: string) => getDb().select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.role, 'admin'), eq(schema.users.disabled, 0), ne(schema.users.id, exceptId))).all().length;

function guard(adminId: string, u: UserRow, verb: string): Fail | null {
  if (u.id === adminId) return fail(409, `Нельзя ${verb} самого себя`);
  if (u.role === 'admin' && !u.disabled && !otherActiveAdmins(u.id)) return fail(409, 'Должен остаться хотя бы один действующий администратор');
  return null;
}

export type Cut = { sessions: number; apiKeys: number; pushSubs: number; jobs: number };
export function cutOff(userId: string, now = Date.now(), logout: Record<string, unknown> = {}): Cut {
  const db = getDb();
  const cut: Cut = {
    sessions: db.delete(schema.sessions).where(eq(schema.sessions.userId, userId)).run().changes,
    apiKeys: db.update(schema.apiKeys).set({ revokedAt: now }).where(and(eq(schema.apiKeys.userId, userId), isNull(schema.apiKeys.revokedAt))).run().changes,
    pushSubs: db.delete(schema.pushSubs).where(eq(schema.pushSubs.userId, userId)).run().changes,
    jobs: cancelUserJobs(userId),
  };
  publish(userId, { t: 'logout', ...logout });
  return cut;
}

export const SEAT_REASON = 'auto:seat-sharing';

export function blockUser(adminId: string, userId: string, o: { kind: 'ban' | 'pause'; reason?: string; inviteId?: string | null; logout?: Record<string, unknown> }, now = Date.now()): { ok: true; changed: boolean; cut: Cut | null } | Fail {
  const u = userOf(userId);
  if (!u) return fail(404, 'Человек не найден');
  const g = guard(adminId, u, o.kind === 'ban' ? 'заблокировать' : 'забрать доступ у');
  if (g) return g;
  if (u.disabled && u.blockKind === o.kind && !(isSystemActor(u.blockedBy) && !isSystemActor(adminId))) return { ok: true, changed: false, cut: null };
  const reason = clean(o.reason);
  getDb().update(schema.users).set({ disabled: 1, blockKind: o.kind, blockReason: reason, blockedAt: now, blockedBy: adminId }).where(eq(schema.users.id, userId)).run();
  const cut = cutOff(userId, now, o.logout);
  logAudit({ adminId, action: o.kind, target: person(u), inviteId: o.inviteId ?? null, reason, detail: `сессий ${cut.sessions}, ключей API ${cut.apiKeys}, push ${cut.pushSubs}, остановлено ответов ${cut.jobs}` }, now);
  return { ok: true, changed: true, cut };
}

export function unblockUser(adminId: string, userId: string, now = Date.now()): { ok: true; changed: boolean } | Fail {
  const u = userOf(userId);
  if (!u) return fail(404, 'Человек не найден');
  if (!u.disabled) return { ok: true, changed: false };
  getDb().update(schema.users).set({ disabled: 0, blockKind: '', blockReason: '', blockedAt: null, blockedBy: null }).where(eq(schema.users.id, userId)).run();
  logAudit({ adminId, action: 'unblock', target: person(u), detail: u.blockKind === 'ban' ? 'была блокировка' : 'была пауза', reason: u.blockReason }, now);
  return { ok: true, changed: true };
}

export function blockByInvite(adminId: string, inviteId: string, o: { reason?: string; revoke?: boolean } = {}, now = Date.now()): { ok: true; blocked: number; skipped: number; revoked: boolean } | Fail {
  const db = getDb();
  const inv = db.select({ id: schema.invites.id, note: schema.invites.note }).from(schema.invites).where(eq(schema.invites.id, inviteId)).get();
  if (!inv) return fail(404, 'Ссылка не найдена');
  const ids = db.select({ uid: schema.inviteUses.userId }).from(schema.inviteUses).where(eq(schema.inviteUses.inviteId, inviteId)).all().map((r) => r.uid);
  let blocked = 0, skipped = 0;
  for (const uid of ids) {
    const u = userOf(uid);
    if (!u || u.role === 'admin' || u.id === adminId || u.disabled) { skipped++; continue; }
    const r = blockUser(adminId, uid, { kind: 'ban', reason: o.reason, inviteId }, now);
    if (r.ok && r.changed) blocked++; else skipped++;
  }
  logAudit({ adminId, action: 'bulk_ban', inviteId, reason: o.reason, detail: `по ссылке «${inv.note || 'без названия'}»: заблокировано ${blocked}, пропущено ${skipped}` }, now);
  let revoked = false;
  if (o.revoke) { revoked = revokeInvite(inviteId, now) !== 'none'; if (revoked) logAudit({ adminId, action: 'invite_revoke', inviteId, detail: `ссылка «${inv.note || 'без названия'}»` }, now); }
  return { ok: true, blocked, skipped, revoked };
}

export function alphaByInvite(adminId: string, inviteId: string, now = Date.now()): { ok: true; granted: number; skipped: number } | Fail {
  const db = getDb();
  const inv = db.select({ id: schema.invites.id, note: schema.invites.note }).from(schema.invites).where(eq(schema.invites.id, inviteId)).get();
  if (!inv) return fail(404, 'Ссылка не найдена');
  const ids = db.select({ uid: schema.inviteUses.userId }).from(schema.inviteUses).where(eq(schema.inviteUses.inviteId, inviteId)).all().map((r) => r.uid);
  let granted = 0, skipped = 0;
  for (const uid of ids) {
    const u = userOf(uid);
    if (!u || u.role !== 'user' || u.disabled) { skipped++; continue; }
    db.update(schema.users).set({ role: 'alpha' }).where(and(eq(schema.users.id, uid), eq(schema.users.role, 'user'))).run();
    logAudit({ adminId, action: 'role', target: person(u), inviteId, detail: 'Пользователь → Альфа (всем по ссылке)' }, now);
    granted++;
  }
  logAudit({ adminId, action: 'bulk_alpha', inviteId, detail: `по ссылке «${inv.note || 'без названия'}»: выдано ${granted}, пропущено ${skipped}` }, now);
  return { ok: true, granted, skipped };
}


const rm = (p: string) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch {  } };

export function deleteUser(adminId: string, userId: string, o: { confirm: string; reason?: string }, now = Date.now()): { ok: true; chats: number; files: number } | Fail {
  const db = getDb();
  const u = userOf(userId);
  if (!u) return fail(404, 'Человек не найден');
  const g = guard(adminId, u, 'удалить');
  if (g) return g;
  const want = (u.name || u.email).trim().toLowerCase(), got = o.confirm.trim().toLowerCase();
  if (!got || (got !== want && got !== u.email.toLowerCase())) return fail(400, 'Имя введено неверно — аккаунт не удалён');
  cancelUserJobs(userId);
  const threadIds = db.select({ id: schema.threads.id }).from(schema.threads).where(eq(schema.threads.userId, userId)).all().map((t) => t.id);
  const fileIds = db.select({ id: schema.files.id }).from(schema.files).where(eq(schema.files.userId, userId)).all().map((f) => f.id);
  const tokens = db.select({ token: schema.outFiles.token }).from(schema.outFiles).where(eq(schema.outFiles.userId, userId)).all().map((r) => r.token).filter(isToken);
  logAudit({ adminId, action: 'delete', target: person(u), reason: o.reason, detail: `чатов ${threadIds.length}, файлов ${fileIds.length + tokens.length}` }, now);
  ext.beforeThreadsGone?.(threadIds);
  db.transaction((tx) => {
    tx.update(schema.invites).set({ createdBy: adminId }).where(eq(schema.invites.createdBy, userId)).run();
    tx.delete(schema.adminViews).where(eq(schema.adminViews.ownerId, userId)).run();
    tx.delete(schema.users).where(eq(schema.users.id, userId)).run();
  });
  for (const f of fileIds) rm(path.join(dataDir(), 'files', f));
  for (const tk of tokens) { rm(path.join(outRoot(), tk)); rm(path.join(dataDir(), 'thumbs', tk)); }
  ext.afterThreadsGone?.(userId, threadIds);
  try { syncIndex(); } catch {  }
  publish(userId, { t: 'logout' });
  return { ok: true, chats: threadIds.length, files: fileIds.length + tokens.length };
}
