'use client';
import { adm, admErr, admf } from '@/lib/i18n/adm';
import { useEffect, useState } from 'react';
import { Button, Field, Group, Notice, PickerRow, SwitchRow, useConfirm } from './Kit';

type F = { id: string; on: boolean; default: boolean; warn?: string };
const TEXT = (): Record<string, { title: string; sub: string }> => ({
  voice: { title: adm("Голосовой ввод"), sub: adm("Микрофон в поле ввода (распознавание речи на сервере).") },
  files: { title: adm("Файлы"), sub: adm("Загрузка файлов и папок в чат.") },
  memory: { title: adm("Память о человеке"), sub: adm("Модель запоминает факты о человеке и учитывает их в ответах.") },
  automations: { title: adm("Автоматизации"), sub: adm("Задачи по расписанию.") },
  webSearch: { title: adm("Поиск в интернете"), sub: adm("Инструмент веб-поиска для моделей (поисковик — ниже).") },
  compare: { title: adm("Сравнение моделей"), sub: adm("Два ответа рядом в одном чате.") },
  push: { title: adm("Уведомления"), sub: adm("Web Push о готовом ответе.") },
  code: { title: adm("Режим кода"), sub: adm("Агент работает с репозиторием GitHub и запускает команды в песочнице.") },
  signup: { title: adm("Регистрация без приглашения"), sub: adm("Любой может создать аккаунт на странице входа.") },
});

export function AdminFeatures() {
  const [list, setList] = useState<F[] | null>(null);
  const [err, setErr] = useState('');
  const [confirmUi, ask] = useConfirm();
  useEffect(() => { void fetch('/api/admin/features').then((r) => r.json()).then((j) => setList(j.features)).catch(() => setErr(adm("Нет связи с сервером"))); }, []);
  const set = async (f: F, on: boolean) => {
    if (on && f.warn === 'code' && !(await ask({ title: adm("Включить режим кода?"), message: adm("Агент будет выполнять команды в контейнере на этом сервере. Включайте только на изолированной машине, где Docker отделён от ваших данных."), action: adm("Включить") }))) return;
    const r = await fetch('/api/admin/features', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: f.id, on }) }).catch(() => null);
    if (!r?.ok) { setErr(adm("Не сохранилось")); return; }
    setErr(''); setList((await r.json()).features);
  };
  return (
    <>
      {confirmUi}
      {err && <Notice>{err}</Notice>}
      <Group title={adm("Функции")} foot={adm("Выключенная функция пропадает у всех и закрыта на сервере. Изменения — сразу, без перезапуска.")} testId="admin-features">
        {(list ?? []).map((f) => (
          <SwitchRow key={f.id} title={TEXT()[f.id]?.title ?? f.id} sub={TEXT()[f.id]?.sub} checked={f.on} onChange={(v) => void set(f, v)} testId={`feature-${f.id}`} />
        ))}
      </Group>
      <SearchBackend />
    </>
  );
}

type Kind = 'searxng' | 'brave' | 'tavily';
type SV = { kind: Kind; url: string; active: boolean; from: 'admin' | 'env' | null; keys: Record<'brave' | 'tavily', boolean>; labels: Record<Kind, string> };
const SEARCH_HINT = (): Record<Kind, string> => ({
  searxng: adm("Свой поисковик, без ключа. В docker compose он уже запущен рядом с приложением."),
  brave: adm("Ключ — на api-dashboard.search.brave.com (есть бесплатный тариф)."),
  tavily: adm("Ключ — на app.tavily.com (есть бесплатный тариф)."),
});

function SearchBackend() {
  const [v, setV] = useState<SV | null>(null);
  const [form, setForm] = useState<{ kind: Kind; url: string; key: string }>({ kind: 'searxng', url: '', key: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fill = (x: SV) => { setV(x); setForm({ kind: x.kind, url: x.url, key: '' }); };
  useEffect(() => { void fetch('/api/admin/websearch').then((r) => r.json()).then(fill).catch(() => setMsg({ ok: false, text: adm("Нет связи с сервером") })); }, []);
  const body = () => ({ kind: form.kind, ...(form.kind === 'searxng' ? { url: form.url } : form.key ? { key: form.key } : {}) });
  const post = async (url: string) => {
    setBusy(true);
    try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body()) }); return { ok: r.ok, j: await r.json().catch(() => ({})) }; }
    catch { return { ok: false, j: { error: adm("Нет связи с сервером") } }; } finally { setBusy(false); }
  };
  const test = async () => { const { j } = await post('/api/admin/websearch/test'); setMsg(j.ok ? { ok: true, text: admf("Работает: результатов — {0}.", j.results) } : { ok: false, text: admf("Не работает: {0}", j.error ?? adm("ошибка")) }); };
  const save = async () => { const { ok, j } = await post('/api/admin/websearch'); if (!ok) { setMsg({ ok: false, text: admErr(j.error) || adm("Не сохранилось") }); return; } fill(j); setMsg({ ok: true, text: adm("Сохранено.") }); };
  if (!v) return null;
  const keyed = form.kind !== 'searxng';
  const hasKey = keyed && v.keys[form.kind as 'brave' | 'tavily'];
  return (
    <>
      {msg && <Notice tone={msg.ok ? 'ok' : 'error'}>{msg.text}</Notice>}
      <Group title={adm("Поисковик")} foot={`${SEARCH_HINT()[form.kind]}${v.active ? '' : adm(" Сейчас поиск не настроен.")}`} testId="admin-websearch">
        <PickerRow title={adm("Вид")} value={form.kind} options={(Object.keys(v.labels) as Kind[]).map((k) => ({ value: k, label: v.labels[k] }))} onChange={(k) => { setMsg(null); setForm({ ...form, kind: k, key: '' }); }} testId="ws-kind" />
        {keyed
          ? <Field label={hasKey ? adm("Ключ API (задан — оставьте пустым, чтобы не менять)") : adm("Ключ API")} value={form.key} onChange={(x) => setForm({ ...form, key: x })} type="password" autoComplete="off" mono testId="ws-key" />
          : <Field label={adm("Адрес SearXNG")} value={form.url} onChange={(x) => setForm({ ...form, url: x })} placeholder="http://search:8080" mono testId="ws-url" />}
      </Group>
      <div className="k-acts">
        <Button onClick={() => void test()} busy={busy} testId="ws-test">{adm("Проверить")}</Button>
        <Button kind="primary" onClick={() => void save()} busy={busy} testId="ws-save">{adm("Сохранить")}</Button>
      </div>
    </>
  );
}
