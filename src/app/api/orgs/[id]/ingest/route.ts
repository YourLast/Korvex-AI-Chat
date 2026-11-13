import { json } from '@/lib/api';
import { ingestOn, inboxByKey, ingestToOrg, acceptedToday, ORG_DAY_LIMIT } from '@/lib/orgIngest';
import { MAX_BYTES } from '@/lib/storeUpload';
import { readForm } from '@/lib/formData';

const MAX_KEY_BODY = 2 * MAX_BYTES + (1 << 20);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const no = (status: number, reason: string, error: string) => json({ error, reason }, status);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!ingestOn()) return no(503, 'off', 'Приём документов выключен');
  const { id } = await params;
  const key = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const box = key ? inboxByKey(key) : null;
  if (!box || box.folderId !== id) return no(401, 'key', 'Неверный ключ организации');
  const { form, tooBig } = await readForm(req, MAX_KEY_BODY);
  if (tooBig) return no(413, 'size', 'Запрос больше 200 МБ: отправьте файлы частями');
  const files = (form?.getAll('file') ?? []).filter((f): f is File => f instanceof File);
  if (!files.length) return no(400, 'file', 'Нет файла');
  if (acceptedToday(box.folderId) + files.length > ORG_DAY_LIMIT) return no(429, 'rate', `Больше ${ORG_DAY_LIMIT} файлов в сутки`);
  const ok: { file_id: string; doc_type: string; name: string }[] = [], errors: { name: string; error: string }[] = [];
  for (const f of files) {
    if (f.size > MAX_BYTES) { errors.push({ name: f.name, error: 'Файл больше 100 МБ' }); continue; }
    const r = await ingestToOrg({ userId: box.userId, folderId: box.folderId, name: f.name, buf: Buffer.from(await f.arrayBuffer()), mime: f.type, via: 'key' });
    if (r.status === 200 && r.body.id) ok.push({ file_id: r.body.id, doc_type: r.body.docType ?? 'other', name: f.name });
    else errors.push({ name: f.name, error: String(r.body.error ?? r.status) });
  }
  return json({ files: ok, errors }, ok.length ? 200 : 422);
}
