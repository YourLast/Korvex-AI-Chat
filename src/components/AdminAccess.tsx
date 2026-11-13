'use client';
import { adm, admErr, admf } from '@/lib/i18n/adm';
import { useEffect, useMemo, useState } from 'react';
import { Button, Field, Group, Notice, Row, Sheet, SwitchRow } from './Kit';

type Rule = { roles: string[]; users: string[]; invites: string[] };
type View = {
  models: { id: string; name: string; roles: string[] | null; rule: Rule | null }[];
  features: { id: string; rule: Rule | null }[];
  mcp?: { id: string; name: string; rule: Rule | null }[];
  users: { id: string; name: string; email: string; role: string }[];
  invites: { id: string; note: string; role: string; uses: number }[];
};
const FEATURE_NAME = (): Record<string, string> => ({ voice: adm("Голосовой ввод"), files: adm("Файлы"), memory: adm("Память о человеке"), automations: adm("Автоматизации"), webSearch: adm("Поиск в интернете"), compare: adm("Сравнение моделей"), push: adm("Уведомления"), code: adm("Режим кода") });
const ROLE_NAME = (): Record<string, string> => ({ user: adm("Пользователь"), alpha: adm("Альфа"), admin: adm("Администратор") });

function summary(rule: Rule | null, roles: string[] | null, adminsOnly = false): string {
  if (!rule) return roles ? admf("По конфигурации: {0}", roles.map((r) => ROLE_NAME()[r] ?? r).join(', ')) : adminsOnly ? adm("Только администраторам") : adm("Всем");
  const parts = [rule.roles.length ? rule.roles.map((r) => ROLE_NAME()[r] ?? r).join(', ') : '', rule.users.length ? admf("людей: {0}", rule.users.length) : '', rule.invites.length ? admf("по ссылкам: {0}", rule.invites.length) : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : adm("Только администраторам");
}

export function AdminAccess() {
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState<{ kind: 'model' | 'feature' | 'mcp'; id: string; title: string; rule: Rule } | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void fetch('/api/admin/access').then((r) => r.json()).then(setV).catch(() => setErr(adm("Нет связи с сервером"))); }, []);
  const save = async (rule: Rule | null) => {
    if (!edit) return;
    setBusy(true);
    try {
      const r = await fetch('/api/admin/access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: edit.kind, id: edit.id, rule }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(admErr(j.error) || adm("Не сохранилось")); return; }
      setErr(''); setV(j); setEdit(null);
    } finally { setBusy(false); }
  };
  const toggle = (list: 'roles' | 'users' | 'invites', id: string, on: boolean) => edit && setEdit({ ...edit, rule: { ...edit.rule, [list]: on ? [...edit.rule[list], id] : edit.rule[list].filter((x) => x !== id) } });
  const people = useMemo(() => (v?.users ?? []).filter((u) => u.role !== 'admin' && (!q.trim() || `${u.name} ${u.email}`.toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 50), [v, q]);
  const open = (kind: 'model' | 'feature' | 'mcp', id: string, title: string, rule: Rule | null, roles: string[] | null = null) =>
    { setQ(''); setEdit({ kind, id, title, rule: rule ?? { roles: roles ?? (kind === 'mcp' ? ['admin'] : ['user', 'alpha', 'admin']), users: [], invites: [] } }); };

  return (
    <>
      {err && <Notice>{err}</Notice>}
      <Group title={adm("Модели")} foot={adm("Закрытая модель не видна в выборе и не отвечает на ходы и запросы API.")} testId="access-models">
        {(v?.models ?? []).map((m) => <Row key={m.id} title={m.name} sub={summary(m.rule, m.roles)} chevron onClick={() => open('model', m.id, m.name, m.rule, m.roles)} testId={`access-model-${m.id}`} />)}
      </Group>
      <Group title={adm("Функции")} foot={adm("Выключить функцию для всех — во вкладке «Функции»; здесь — кому она доступна, пока включена.")} testId="access-features">
        {(v?.features ?? []).map((f) => <Row key={f.id} title={FEATURE_NAME()[f.id] ?? f.id} sub={summary(f.rule, null)} chevron onClick={() => open('feature', f.id, FEATURE_NAME()[f.id] ?? f.id, f.rule)} testId={`access-feature-${f.id}`} />)}
      </Group>
      {(v?.mcp ?? []).length > 0 && <Group title={adm("Серверы MCP")} foot={adm("Без настройки инструменты сервера доступны только администраторам.")} testId="access-mcp">
        {(v?.mcp ?? []).map((s) => <Row key={s.id} title={s.name} sub={summary(s.rule, null, true)} chevron onClick={() => open('mcp', s.id, s.name, s.rule)} testId={`access-mcp-${s.id}`} />)}
      </Group>}
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit ? admf("Доступ: {0}", edit.title) : ''} testId="access-sheet"
        foot={<>
          <Button onClick={() => void save(null)} busy={busy} testId="access-reset">{adm("Как без настройки")}</Button>
          <Button kind="primary" onClick={() => edit && void save(edit.rule)} busy={busy} testId="access-save">{adm("Сохранить")}</Button>
        </>}>
        {edit && v && <>
          <Group title={adm("Роли")}>
            {['user', 'alpha'].map((r) => <SwitchRow key={r} title={ROLE_NAME()[r]} checked={edit.rule.roles.includes(r)} onChange={(on) => toggle('roles', r, on)} testId={`access-role-${r}`} />)}
            <SwitchRow title={ROLE_NAME().admin} sub={adm("Администратору доступно всегда")} checked disabled onChange={() => {}} />
          </Group>
          {v.invites.length > 0 && <Group title={adm("По ссылке-приглашению")} foot={adm("Все, кто пришёл по ссылке, — как группа.")}>
            {v.invites.map((i) => <SwitchRow key={i.id} title={i.note || admf("Ссылка · {0}", ROLE_NAME()[i.role] ?? i.role)} sub={admf("пришли: {0}", i.uses)} checked={edit.rule.invites.includes(i.id)} onChange={(on) => toggle('invites', i.id, on)} testId={`access-invite-${i.id}`} />)}
          </Group>}
          <Group title={adm("Люди")}>
            <Field label={adm("Поиск")} value={q} onChange={setQ} placeholder={adm("имя или почта")} testId="access-q" />
            {people.map((u) => <SwitchRow key={u.id} title={u.name || u.email} sub={u.email} checked={edit.rule.users.includes(u.id)} onChange={(on) => toggle('users', u.id, on)} testId={`access-user-${u.id}`} />)}
          </Group>
        </>}
      </Sheet>
    </>
  );
}
