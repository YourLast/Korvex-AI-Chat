import { tr, type Lang } from './i18n/core';
import { errText } from './i18n/errors';
import { deviceId } from './live';

export type PushEnv = { supported: boolean; ios: boolean; standalone: boolean; iosOld: boolean; permission: NotificationPermission | 'unsupported' };
export function pushEnv(): PushEnv {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  const m = /OS (\d+)_(\d+)/.exec(ua);
  const iosOld = ios && !!m && (Number(m[1]) < 16 || (Number(m[1]) === 16 && Number(m[2]) < 4));
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return { supported, ios, standalone, iosOld, permission: 'Notification' in window ? Notification.permission : 'unsupported' };
}

const b64 = (s: string) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
async function reg() {
  const r = await navigator.serviceWorker.getRegistration();
  return r ?? navigator.serviceWorker.register('/sw.js');
}

export async function pushOn(): Promise<boolean> {
  if (!pushEnv().supported) return false;
  try {
    const sub = await (await reg()).pushManager.getSubscription();
    if (!sub) return false;
    const r = await fetch(`/api/push?device=${encodeURIComponent(deviceId())}`, { cache: 'no-store' });
    return r.ok && ((await r.json()) as { on: boolean }).on;
  } catch { return false; }
}

export async function enablePush(lang: Lang = 'ru'): Promise<{ ok: boolean; error?: string }> {
  const env = pushEnv();
  if (!env.supported) return { ok: false, error: env.ios && !env.standalone ? tr(lang, 'tools.push.iosOnly') : tr(lang, 'tools.push.unsupported') };
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, error: perm === 'denied' ? tr(lang, 'tools.push.denied') : tr(lang, 'tools.push.noPerm') };
  try {
    const keyR = await fetch('/api/push', { cache: 'no-store' });
    const { publicKey } = (await keyR.json()) as { publicKey: string };
    await reg();
    const r = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(tr(lang, 'tools.push.swFail'))), 10000)),
    ]);
    let sub = await r.pushManager.getSubscription();
    if (sub && sub.options.applicationServerKey) {
      const cur = new Uint8Array(sub.options.applicationServerKey);
      const want = b64(publicKey);
      if (cur.length !== want.length || cur.some((x, i) => x !== want[i])) { await sub.unsubscribe(); sub = null; }
    }
    sub ??= await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(publicKey) });
    const res = await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device: deviceId(), subscription: sub.toJSON() }) });
    if (!res.ok) { const er = ((await res.json().catch(() => ({}))) as { error?: string }).error; return { ok: false, error: er ? errText(lang, er) : `HTTP ${res.status}` }; }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: tr(lang, 'tools.push.subFail', { msg: (e as Error).message }) };
  }
}

export async function disablePush(): Promise<void> {
  try {
    if (pushEnv().supported) {
      const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
      if (sub) await sub.unsubscribe().catch(() => false);
    }
  } catch {  }
  await fetch('/api/push', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device: deviceId() }) }).catch(() => {});
}

export async function testPush(lang: Lang = 'ru'): Promise<{ ok: boolean; error?: string }> {
  const r = await fetch('/api/push/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device: deviceId() }) });
  if (r.ok) return { ok: true };
  const er = ((await r.json().catch(() => ({}))) as { error?: string }).error;
  return { ok: false, error: er ? errText(lang, er) : `HTTP ${r.status}` };
}

export async function hasLocalSub(): Promise<boolean> {
  try { return !!(await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription()); } catch { return false; }
}
