'use client';
import { useEffect, useMemo, useState } from 'react';
import { Button, Field, Group, Notice, Row, Sheet, SwitchRow } from './Kit';

type Rule = { roles: string[]; users: string[]; invites: string[] };
type View = {
  models: { id: string; name: string; roles: string[] | null; rule: Rule | null }[];
  features: { id: string; rule: Rule | null }[];
  users: { id: string; name: string; email: string; role: string }[];
  invites: { id: string; note: string; role: string; uses: number }[];
};
const FEATURE_NAME: Record<string, string> = { voice: 'Голосовой ввод', files: 'Файлы', memory: 'Память о человеке', automations: 'Автоматизации', webSearch: 'Поиск в интернете', compare: 'Сравнение моделей', push: 'Уведомления', code: 'Режим кода' };
const ROLE_NAME: Record<string, string> = { user: 'Пользователь', alpha: 'Альфа', admin: 'Администратор' };

function summary(rule: Rule | null, roles: string[] | null): string {
  if (!rule) return roles ? `По конфигурации: ${roles.map((r) => ROLE_NAME[r] ?? r).join(', ')}` : 'Всем';
  const parts = [rule.roles.length ? rule.roles.map((r) => ROLE_NAME[r] ?? r).join(', ') : '', rule.users.length ? `людей: ${rule.users.length}` : '', rule.invites.length ? `по ссылкам: ${rule.invites.length}` : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Только администраторам';
}

export function AdminAccess() {
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState<{ kind: 'model' | 'feature'; id: string; title: string; rule: Rule } | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void fetch('/api/admin/access').then((r) => r.json()).then(setV).catch(() => setErr('Нет связи с сервером')); }, []);
  const save = async (rule: Rule | null) => {
    if (!edit) return;
    setBusy(true);
    try {
      const r = await fetch('/api/admin/access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: edit.kind, id: edit.id, rule }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error || 'Не сохранилось'); return; }
      setErr(''); setV(j); setEdit(null);
    } finally { setBusy(false); }
  };
  const toggle = (list: 'roles' | 'users' | 'invites', id: string, on: boolean) => edit && setEdit({ ...edit, rule: { ...edit.rule, [list]: on ? [...edit.rule[list], id] : edit.rule[list].filter((x) => x !== id) } });
  const people = useMemo(() => (v?.users ?? []).filter((u) => u.role !== 'admin' && (!q.trim() || `${u.name} ${u.email}`.toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 50), [v, q]);
  const open = (kind: 'model' | 'feature', id: string, title: string, rule: Rule | null, roles: string[] | null = null) =>
    { setQ(''); setEdit({ kind, id, title, rule: rule ?? { roles: roles ?? ['user', 'alpha', 'admin'], users: [], invites: [] } }); };

  return (
    <>
      {err && <Notice>{err}</Notice>}
      <Group title="Модели" foot="Закрытая модель не видна в выборе и не отвечает на ходы и запросы API." testId="access-models">
        {(v?.models ?? []).map((m) => <Row key={m.id} title={m.name} sub={summary(m.rule, m.roles)} chevron onClick={() => open('model', m.id, m.name, m.rule, m.roles)} testId={`access-model-${m.id}`} />)}
      </Group>
      <Group title="Функции" foot="Выключить функцию для всех — во вкладке «Функции»; здесь — кому она доступна, пока включена." testId="access-features">
        {(v?.features ?? []).map((f) => <Row key={f.id} title={FEATURE_NAME[f.id] ?? f.id} sub={summary(f.rule, null)} chevron onClick={() => open('feature', f.id, FEATURE_NAME[f.id] ?? f.id, f.rule)} testId={`access-feature-${f.id}`} />)}
      </Group>
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit ? `Доступ: ${edit.title}` : ''} testId="access-sheet"
        foot={<>
          <Button onClick={() => void save(null)} busy={busy} testId="access-reset">Как без настройки</Button>
          <Button kind="primary" onClick={() => edit && void save(edit.rule)} busy={busy} testId="access-save">Сохранить</Button>
        </>}>
        {edit && v && <>
          <Group title="Роли">
            {['user', 'alpha'].map((r) => <SwitchRow key={r} title={ROLE_NAME[r]} checked={edit.rule.roles.includes(r)} onChange={(on) => toggle('roles', r, on)} testId={`access-role-${r}`} />)}
            <SwitchRow title={ROLE_NAME.admin} sub="Администратору доступно всегда" checked disabled onChange={() => {}} />
          </Group>
          {v.invites.length > 0 && <Group title="По ссылке-приглашению" foot="Все, кто пришёл по ссылке, — как группа.">
            {v.invites.map((i) => <SwitchRow key={i.id} title={i.note || `Ссылка · ${ROLE_NAME[i.role] ?? i.role}`} sub={`пришли: ${i.uses}`} checked={edit.rule.invites.includes(i.id)} onChange={(on) => toggle('invites', i.id, on)} testId={`access-invite-${i.id}`} />)}
          </Group>}
          <Group title="Люди">
            <Field label="Поиск" value={q} onChange={setQ} placeholder="имя или почта" testId="access-q" />
            {people.map((u) => <SwitchRow key={u.id} title={u.name || u.email} sub={u.email} checked={edit.rule.users.includes(u.id)} onChange={(on) => toggle('users', u.id, on)} testId={`access-user-${u.id}`} />)}
          </Group>
        </>}
      </Sheet>
    </>
  );
}
