'use client';
import { adm, admErr, admf, admLocale } from '@/lib/i18n/adm';
import { useEffect, useState } from 'react';
import { Button, Field, Group, Notice, PickerRow, Row, Sheet, SwitchRow, toast, useConfirm } from './Kit';

type Tool = { name: string; title?: string; description?: string; annotations?: { readOnlyHint?: boolean } };
type Server = {
  id: string; name: string; url: string; on: boolean; ask: 'always' | 'write' | 'never'; off: string[]; tools: Tool[];
  header: { name: string; set: boolean } | null; checkedAt: number | null; error: string | null; info: { name?: string; version?: string } | null;
};
type Draft = { id?: string; name: string; url: string; headerName: string; headerValue: string; headerSet: boolean; on: boolean; ask: Server['ask'] };

const post = async (url: string, body?: unknown) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  return { ok: !!r?.ok, j: j as { error?: string; servers?: Server[]; server?: Server; id?: string } };
};

function status(s: Server): string {
  if (s.error) return admf("Ошибка: {0}", s.error);
  if (!s.checkedAt) return adm("Не проверен");
  const on = s.tools.filter((t) => !s.off.includes(t.name)).length;
  return admf("Инструментов: {0} из {1}", on, s.tools.length);
}

export function AdminMcp() {
  const [list, setList] = useState<Server[] | null>(null);
  const [err, setErr] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [cur, setCur] = useState<Server | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmUi, ask] = useConfirm();
  useEffect(() => { void fetch('/api/admin/mcp').then((r) => r.json()).then((j) => setList(j.servers ?? [])).catch(() => setErr(adm("Нет связи с сервером"))); }, []);
  const upd = (s: Server) => { setList((l) => (l ?? []).map((x) => (x.id === s.id ? s : x))); setCur((c) => (c?.id === s.id ? s : c)); };

  const check = async (id: string) => {
    setBusy(true);
    try {
      const { ok, j } = await post(`/api/admin/mcp/${id}/check`);
      if (j.server) upd(j.server);
      toast(ok ? adm("Сервер отвечает") : adm("Сервер не ответил"), ok ? 'ok' : 'error');
    } finally { setBusy(false); }
  };
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const body = { id: draft.id, name: draft.name, url: draft.url, on: draft.on, ask: draft.ask,
        ...(draft.headerValue.trim() ? { headerName: draft.headerName.trim() || 'Authorization', headerValue: draft.headerValue } : draft.headerSet ? { headerName: draft.headerName.trim() || 'Authorization' } : {}) };
      const { ok, j } = await post('/api/admin/mcp', body);
      if (!ok) { setErr(admErr(j.error) || adm("Не сохранилось")); return; }
      setErr(''); setList(j.servers ?? []); setDraft(null);
      const s = (j.servers ?? []).find((x) => x.id === j.id);
      if (s && (!draft.id || !s.checkedAt)) { setCur(s); void check(s.id); }
    } finally { setBusy(false); }
  };
  const dropSecret = async () => {
    if (!draft?.id) return;
    const { ok, j } = await post('/api/admin/mcp', { id: draft.id, headerValue: null });
    if (ok) { setList(j.servers ?? []); setDraft({ ...draft, headerSet: false, headerValue: '' }); }
  };
  const remove = async (s: Server) => {
    if (!(await ask({ title: admf("Убрать сервер «{0}»?", s.name), message: adm("Его инструменты пропадут из ходов. Настройки доступа сервера тоже удалятся."), action: adm("Убрать") }))) return;
    const r = await fetch(`/api/admin/mcp/${s.id}`, { method: 'DELETE' }).catch(() => null);
    if (!r?.ok) { toast(adm("Не получилось. Попробуйте ещё раз"), 'error'); return; }
    setList((l) => (l ?? []).filter((x) => x.id !== s.id)); setCur(null); setDraft(null);
  };
  const toggle = async (s: Server, patch: { on?: boolean; off?: string[] }) => {
    const { ok, j } = await post('/api/admin/mcp', { id: s.id, ...patch });
    if (!ok) { toast(admErr(j.error) || adm("Не сохранилось"), 'error'); return; }
    const n = (j.servers ?? []).find((x) => x.id === s.id);
    if (n) upd(n);
  };
  const edit = (s: Server | null) => setDraft(s
    ? { id: s.id, name: s.name, url: s.url, headerName: s.header?.name ?? 'Authorization', headerValue: '', headerSet: !!s.header?.set, on: s.on, ask: s.ask }
    : { name: '', url: '', headerName: 'Authorization', headerValue: '', headerSet: false, on: true, ask: 'write' });
  const ASK = () => [
    { value: 'write' as const, label: adm("Кроме «только чтение»"), hint: adm("Спрашивать, если сервер не пометил инструмент как только читающий") },
    { value: 'always' as const, label: adm("Всегда") },
    { value: 'never' as const, label: adm("Не спрашивать") },
  ];

  return (
    <>
      {confirmUi}
      {err && <Notice>{err}</Notice>}
      <Group title={adm("Серверы MCP")} aside={<Button onClick={() => edit(null)} icon="plus" testId="mcp-add">{adm("Добавить")}</Button>}
        foot={adm("Инструменты сервера модели получают в ходе с инструментами. Ответы сервера — чужие данные: после них действия, которые могут вынести ваши данные наружу, проверяются. Кому доступно — вкладка «Доступ», без настройки — только администраторам.")}
        testId="mcp-servers">
        {list && !list.length && <Row title={adm("Серверов пока нет")} sub={adm("Адрес сервера MCP (Streamable HTTP), например https://mcp.example.com/mcp")} tone="muted" />}
        {(list ?? []).map((s) => <Row key={s.id} title={s.name} sub={`${s.on ? '' : `${adm("Выключен")} · `}${status(s)}`} sub2={s.url} chevron onClick={() => setCur(s)} testId={`mcp-${s.id}`} />)}
      </Group>

      <Sheet open={!!cur && !draft} onClose={() => setCur(null)} title={cur?.name ?? ''} sub={cur?.url} testId="mcp-server"
        foot={cur && <>
          <Button onClick={() => edit(cur)} testId="mcp-edit">{adm("Изменить")}</Button>
          <Button kind="primary" onClick={() => void check(cur.id)} busy={busy} testId="mcp-check">{adm("Проверить")}</Button>
        </>}>
        {cur && <>
          {cur.error && <Notice testId="mcp-error">{admf("Сервер не ответил: {0}", cur.error)}</Notice>}
          <Group>
            <SwitchRow title={adm("Включён")} sub={adm("Выключенный сервер не предлагается моделям")} checked={cur.on} onChange={(on) => void toggle(cur, { on })} testId="mcp-on" />
            <Row title={adm("Проверен")} value={cur.checkedAt ? new Date(cur.checkedAt).toLocaleString(admLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : adm("ещё нет")} />
            {cur.info?.name && <Row title={adm("Сервер")} value={[cur.info.name, cur.info.version].filter(Boolean).join(' ')} />}
          </Group>
          <Group title={admf("Инструменты: {0}", cur.tools.length)} foot={cur.tools.length ? adm("Выключенный инструмент модель не видит.") : adm("Нажмите «Проверить», чтобы прочитать инструменты сервера.")} testId="mcp-tools">
            {cur.tools.map((t) => <SwitchRow key={t.name} title={t.title || t.name} sub={[t.annotations?.readOnlyHint ? adm("только чтение") : '', t.description ?? ''].filter(Boolean).join(' · ').slice(0, 200)}
              checked={!cur.off.includes(t.name)} onChange={(on) => void toggle(cur, { off: on ? cur.off.filter((x) => x !== t.name) : [...cur.off, t.name] })} testId={`mcp-tool-${t.name}`} />)}
          </Group>
        </>}
      </Sheet>

      <Sheet open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? adm("Сервер MCP") : adm("Новый сервер MCP")} testId="mcp-sheet"
        foot={draft && <>
          {draft.id && <Button kind="danger" onClick={() => { const s = (list ?? []).find((x) => x.id === draft.id); if (s) void remove(s); }} testId="mcp-delete">{adm("Убрать")}</Button>}
          <Button kind="primary" onClick={() => void save()} busy={busy} disabled={!draft.name.trim() || !draft.url.trim()} testId="mcp-save">{adm("Сохранить")}</Button>
        </>}>
        {draft && <>
          <Group>
            <Field label={adm("Название")} value={draft.name} onChange={(name) => setDraft({ ...draft, name })} maxLength={60} placeholder="GitHub" testId="mcp-name" />
            <Field label={adm("Адрес")} value={draft.url} onChange={(url) => setDraft({ ...draft, url })} inputMode="url" mono placeholder="https://mcp.example.com/mcp" testId="mcp-url" />
          </Group>
          <Group title={adm("Ключ доступа")} foot={adm("Заголовок запроса к серверу, обычно Authorization: Bearer … Хранится зашифрованным и не показывается.")}>
            <Field label={adm("Заголовок")} value={draft.headerName} onChange={(headerName) => setDraft({ ...draft, headerName })} mono testId="mcp-header-name" />
            <Field label={adm("Значение")} value={draft.headerValue} onChange={(headerValue) => setDraft({ ...draft, headerValue })} type="password" autoComplete="off" mono
              placeholder={draft.headerSet ? adm("задано — оставьте пустым, чтобы не менять") : 'Bearer …'} testId="mcp-header-value" />
            {draft.headerSet && <Row title={adm("Убрать ключ")} tone="danger" onClick={() => void dropSecret()} testId="mcp-header-drop" />}
          </Group>
          <Group>
            <PickerRow title={adm("Спрашивать перед вызовом")} value={draft.ask} options={ASK()} onChange={(a) => setDraft({ ...draft, ask: a })} testId="mcp-ask" />
            <SwitchRow title={adm("Включён")} checked={draft.on} onChange={(on) => setDraft({ ...draft, on })} testId="mcp-draft-on" />
          </Group>
        </>}
      </Sheet>
    </>
  );
}
