import fs from 'node:fs';
import { authed, fail, json } from '@/lib/api';
import { cfg } from '@/lib/cfg';
import { FEATURE_OFF, featureFor } from '@/lib/features';
import { readForm } from '@/lib/formData';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STT_URL = cfg('STT_URL', 'http://127.0.0.1:8000/v1');
const MAX_BYTES = 40 * 1024 * 1024;

const err = (status: number, code: string, message: string) => json({ error: message, code }, status);
const log = (s: string) => console.log(`[stt] ${s}`);

export async function POST(req: Request) {
  const a = await authed(req, true);
  if ('res' in a) return a.res;
  if (!featureFor('voice', a.user.id)) return fail(403, FEATURE_OFF);
  const { form, tooBig } = await readForm(req);
  if (tooBig) return fail(413, 'Запись слишком большая');
  const f = form?.get('audio');
  if (!(f instanceof Blob) || f.size === 0) return fail(400, 'Нет записи');
  if (f.size > MAX_BYTES) return fail(413, 'Запись слишком большая');
  const headers: Record<string, string> = {};
  const keyFile = process.env.STT_KEY_FILE;
  if (keyFile) {
    try {
      headers.Authorization = `Bearer ${fs.readFileSync(keyFile, 'utf8').trim()}`;
    } catch {
      log('key file unreadable');
      return err(503, 'stt_down', 'Сервис распознавания недоступен');
    }
  }
  const fd = new FormData();
  const ext = f.type.includes('mp4') ? 'm4a' : f.type.includes('ogg') ? 'ogg' : 'webm';
  fd.append('file', f, `voice.${ext}`);
  fd.append('model', cfg('STT_MODEL', 'whisper-1'));
  const lang = cfg('STT_LANGUAGE');
  if (lang) fd.append('language', lang);
  fd.append('response_format', 'json');
  const t0 = Date.now();
  try {
    const r = await fetch(`${STT_URL}/audio/transcriptions`, { method: 'POST', headers, body: fd, signal: AbortSignal.timeout(120_000) });
    if (!r.ok) {
      log(`upstream ${r.status} (${ext}, ${Math.round(f.size / 1024)} KB, ${Date.now() - t0} ms)`);
      if (r.status === 400 || r.status === 413) return err(422, 'stt_bad_audio', 'Запись не прочиталась');
      return err(503, 'stt_down', 'Сервис распознавания недоступен');
    }
    const j = (await r.json()) as { text?: string };
    const text = j.text ?? '';
    log(`ok (${ext}, ${Math.round(f.size / 1024)} KB, ${text ? 'text' : 'empty'}, ${Date.now() - t0} ms)`);
    return json({ text });
  } catch (e) {
    log(`unreachable: ${(e as Error).name} (${Date.now() - t0} ms)`);
    return err(503, 'stt_down', 'Сервис распознавания недоступен');
  }
}
