import { json } from '@/lib/api';
import { ingestOn, inboxByTag, collectorOk, viaProxy, senderAllowed, bareAddress, mailDuplicate, ingestToOrg, acceptedToday, ORG_DAY_LIMIT } from '@/lib/orgIngest';
import { MAX_BYTES } from '@/lib/storeUpload';
import { readForm } from '@/lib/formData';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const no = (status: number, reason: string, error: string) => json({ error, reason }, status);

export async function POST(req: Request) {
  if (!ingestOn()) return no(503, 'off', 'Приём документов выключен');
  if (viaProxy(req.headers)) return no(401, 'proxy', 'Запрос через прокси');
  if (!collectorOk(req.headers.get('x-collector-key'))) return no(401, 'key', 'Неверный ключ сборщика');
  const { form, tooBig } = await readForm(req);
  if (tooBig) return no(413, 'size', 'Файл больше 100 МБ');
  const s = (k: string) => { const v = form?.get(k); return typeof v === 'string' ? v.trim() : ''; };
  const file = form?.get('file');
  const tag = s('tag'), sender = s('sender'), auth = s('auth').toLowerCase(), messageId = s('message_id'), aligned = s('aligned_domain').toLowerCase();
  if (!(file instanceof File) || !tag || !sender || !messageId) return no(400, 'fields', 'Нужны tag, file, sender, message_id');
  const box = inboxByTag(tag);
  if (!box) return no(404, 'tag', 'Нет организации с такой меткой');
  if (auth !== 'pass') return no(403, 'auth', 'Письмо не прошло SPF/DKIM');
  const from = bareAddress(sender);
  if (!from) return no(403, 'sender', 'Адрес отправителя — не голый local@domain');
  if (!aligned || aligned !== from.domain) return no(403, 'auth', 'Домен отправителя не подтверждён выравниванием DMARC');
  if (!senderAllowed(box.senders, from.addr)) return no(403, 'sender', 'Отправитель не в списке организации');
  const name = (file.name.split(/[\\/]/).pop() || 'document').slice(0, 200);
  const dup = mailDuplicate(box.folderId, messageId, name);
  if (dup) return json({ file_id: dup.id, doc_type: dup.docType, duplicate: true });
  if (acceptedToday(box.folderId) >= ORG_DAY_LIMIT) return no(429, 'rate', `Больше ${ORG_DAY_LIMIT} файлов в сутки`);
  if (file.size > MAX_BYTES) return no(413, 'size', 'Файл больше 100 МБ');
  const r = await ingestToOrg({ userId: box.userId, folderId: box.folderId, name, buf: Buffer.from(await file.arrayBuffer()), mime: file.type, via: 'mail', mail: { messageId, sender: from.addr } });
  if (r.status !== 200 || !r.body.id) return json({ error: String(r.body.error ?? 'Файл не принят'), reason: 'file' }, r.status === 200 ? 422 : r.status);
  return json({ file_id: r.body.id, doc_type: r.body.docType ?? 'other' });
}
