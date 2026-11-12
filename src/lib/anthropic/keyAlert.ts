import { and, eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir, getDb, schema } from '../db';
import { sendPush, subsOf, type PushPayload } from '../push';

export async function alertAdmins(from: number, to: number): Promise<number> {
  const admins = getDb().select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.role, 'admin'), eq(schema.users.disabled, 0))).all();
  const payload: PushPayload = {
    title: 'Ключ Anthropic: деньги кончились',
    body: `Ключ ${from + 1}: деньги кончились, переключился на ${to === 0 ? 'основной' : 'запасной'} (ключ ${to + 1}). Модели Claude работают.`,
    url: '/admin#analytics', tag: 'ops-claude-key',
  };
  const sink = process.env.KX_PUSH_SINK ? path.join(dataDir(), 'push-sink.jsonl') : null;
  let sent = 0;
  for (const a of admins) for (const sub of subsOf(a.id)) {
    if (sink) { fs.appendFileSync(sink, JSON.stringify({ at: Date.now(), userId: a.id, device: (sub as { device?: string }).device, payload }) + '\n', { mode: 0o600 }); sent++; continue; }
    if ((await sendPush(sub, payload).catch(() => 'error')) === 'ok') sent++;
  }
  console.log(`[claude] push о смене ключа: ${sent}`);
  return sent;
}
