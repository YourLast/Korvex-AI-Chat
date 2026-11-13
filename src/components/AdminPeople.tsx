'use client';
import { adm, admAny, admCount, admf } from '@/lib/i18n/adm';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { PersonRow, ViewLogItem } from '@/lib/adminTypes';
import { AUDIT_LABEL, type AuditAction, type AuditItem, type Source, type SourceRow } from '@/lib/moderationTypes';
import { VIEW_KIND } from '@/lib/adminTypes';
import { W } from '@/lib/plural';
import { Icon } from './Icon';
import { RateCounts, when } from './AdminBits';
import { Button, Field, Group, Row, Seg } from './Kit';
import { roleRu } from '@/lib/roles';

const ROLE = (): Record<string, string> => ({ admin: adm(roleRu('admin')), alpha: adm(roleRu('alpha')), user: adm(roleRu('user')) });

export const statsLine = (p: Pick<PersonRow, 'chats' | 'messages' | 'files'>) => [admCount(p.chats, W.chat), admCount(p.messages, W.message), p.files ? admCount(p.files, W.file) : ''].filter(Boolean).join(' · ');

export function matchPerson(p: Pick<PersonRow, 'name' | 'email'>, q: string): boolean {
  const s = q.trim().toLocaleLowerCase('ru');
  return !s || p.name.toLocaleLowerCase('ru').includes(s) || p.email.toLocaleLowerCase('ru').includes(s);
}

export function sourcesOf(users: Pick<PersonRow, 'source' | 'disabled'>[]): SourceRow[] {
  const m = new Map<string, SourceRow>();
  for (const u of users) {
    let r = m.get(u.source.key);
    if (!r) m.set(u.source.key, (r = { ...u.source, n: 0, blocked: 0 }));
    r.n++; if (u.disabled) r.blocked++;
  }
  const rank = (r: Source) => (r.kind === 'invite' ? 0 : r.kind === 'admin' ? 1 : 2);
  return [...m.values()].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, 'ru'));
}

export function PersonBadges({ p }: { p: Pick<PersonRow, 'source' | 'disabled' | 'blockKind'> }) {
  return (
    <span className="adm-badges">
      <span className={`adm-src adm-src--${p.source.kind}`} title={adm("Откуда пришёл человек")} data-testid="user-source">{admAny(p.source.label)}</span>
      {p.disabled && <span className={`adm-st adm-st--${p.blockKind === 'ban' ? 'ban' : 'pause'}`} data-testid="user-block">{p.blockKind === 'ban' ? adm("заблокирован") : adm("доступ забран")}</span>}
    </span>
  );
}

export function AdminPeople({ users, meId, tz, onSettings, initialSource = 'all' }: { users: PersonRow[]; meId: string; tz: string; onSettings: (id: string) => void; initialSource?: string }) {
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<'all' | 'down' | 'blocked'>('all');
  const [src, setSrc] = useState(initialSource);
  const [group, setGroup] = useState<'list' | 'src'>('list');
  useEffect(() => { const v = new URLSearchParams(window.location.search).get('src'); if (v) setSrc(v); }, []);
  const sources = useMemo(() => sourcesOf(users), [users]);
  const rows = useMemo(() => users.filter((u) => matchPerson(u, q) && (only === 'all' || (only === 'down' ? u.down > 0 : u.disabled)) && (src === 'all' || u.source.key === src)), [users, q, only, src]);
  const withDown = users.filter((u) => u.down > 0).length;
  const blocked = users.filter((u) => u.disabled).length;
  const filtered = !!q || only !== 'all' || src !== 'all';
  const row = (x: PersonRow) => (
    <div className="adm-urow" key={x.id}>
      <Link href={`/admin/users/${x.id}`} className={`k-row adm-ulink${x.disabled ? ' k-row--muted' : ' k-row--strong'}`} data-testid={`user-${x.email}`}>
        <span className="k-row-m">
          <span className="k-row-t">{x.name || x.email}{x.id === meId && <span className="k-row-s"> {adm("· это вы")}</span>}</span>
          <span className="k-row-s">{x.email} · {ROLE()[x.role]}</span>
          <span className="k-row-s"><PersonBadges p={x} /></span>
          <span className="k-row-s" data-testid="user-stats">{statsLine(x)}</span>
          <span className="k-row-s">{x.lastAt ? admf("был(а) {0}", when(x.lastAt, tz)) : adm("ещё ничего не писал(а)")}</span>
        </span>
        <RateCounts up={x.up} down={x.down} />
        <Icon n="chev-right" sm className="k-chev" />
      </Link>
      <button type="button" className="adm-ugear" aria-label={admf("Роль и доступ: {0}", x.name || x.email)} title={adm("Роль и доступ")} onClick={() => onSettings(x.id)} data-testid={`user-gear-${x.email}`}><Icon n="sliders" sm /></button>
    </div>
  );
  return (
    <div className="k-stack" data-testid="people">
      <Group title={adm("Люди")} aside={filtered ? admf("{0} из {1}", rows.length, admCount(users.length, W.user)) : admCount(users.length, W.user)} testId="users-table"
        foot={adm("Откройте человека, чтобы прочитать его чаты, посмотреть файлы и оценки или закрыть доступ. Просмотр — только чтение; каждый просмотр и каждое действие пишутся в журналы ниже.")}>
        <Field label={adm("Поиск по имени или почте")} value={q} onChange={setQ} placeholder={adm("Анна, ivanov@…")} autoComplete="off" testId="people-search" />
        <div className="adm-filter adm-filter--src">
          <label htmlFor="people-source">{adm("Откуда пришли")}</label>
          <select id="people-source" value={src} onChange={(e) => setSrc(e.target.value)} data-testid="people-source">
            <option value="all">{adm("Все ·")} {users.length}</option>
            {sources.map((s) => <option key={s.key} value={s.key}>{admAny(s.label)} · {s.n}{s.blocked ? admf(" (заблокировано {0})", s.blocked) : ''}</option>)}
          </select>
        </div>
        <div className="adm-filter"><Seg block label={adm("Показать")} value={only} onChange={setOnly} testId="people-filter"
          options={[{ value: 'all', label: adm("Все") }, { value: 'down', label: admf("С плохими оценками · {0}", withDown) }, { value: 'blocked', label: admf("Закрыт доступ · {0}", blocked), testId: 'people-blocked' }]} /></div>
        <div className="adm-filter"><Seg block label={adm("Вид списка")} value={group} onChange={setGroup} testId="people-group"
          options={[{ value: 'list', label: adm("Списком") }, { value: 'src', label: adm("По источникам"), testId: 'people-by-source' }]} /></div>
        {rows.length === 0 && <Row title={adm("Никого не нашли")} tone="muted" sub={adm("Измените запрос или фильтр")} />}
        {group === 'src'
          ? sources.map((s) => {
              const part = rows.filter((x) => x.source.key === s.key);
              if (!part.length) return null;
              return (<div key={s.key} data-testid="people-group-block"><div className="adm-ghead"><b>{admAny(s.label)}</b><span>{part.length}{s.blocked ? admf(" · заблокировано {0}", s.blocked) : ''}</span></div>{part.map(row)}</div>);
            })
          : rows.map(row)}
      </Group>
    </div>
  );
}

export function AuditLog({ tz, userId, inviteId }: { tz: string; userId?: string; inviteId?: string }) {
  const [items, setItems] = useState<AuditItem[] | null>(null);
  const [limit, setLimit] = useState(10);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    setErr(false);
    const qs = `limit=${limit}${userId ? `&user=${encodeURIComponent(userId)}` : ''}${inviteId ? `&invite=${encodeURIComponent(inviteId)}` : ''}`;
    fetch(`/api/admin/audit?${qs}`, { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<{ items: AuditItem[] }>; })
      .then((d) => { if (live) setItems(d.items); }).catch(() => { if (live) setErr(true); });
    return () => { live = false; };
  }, [limit, userId, inviteId]);
  return (
    <Group title={adm("Действия администраторов")} testId="audit-log" aside={items ? String(items.length) : undefined}
      foot={adm("Кто из администраторов что сделал с людьми и ссылками и когда; причина — если её указали. Записи не удаляются.")}>
      {err && <Row title={adm("Журнал не загрузился")} tone="muted" />}
      {!err && items === null && <Row title={adm("Загружаю…")} tone="muted" />}
      {items?.length === 0 && <Row title={adm("Пока ничего не делали")} tone="muted" />}
      {items?.map((a) => (
        <Row key={a.id} testId="audit-row" title={<><b>{a.adminName || adm("Администратор")}</b> — {adm(AUDIT_LABEL[a.action as AuditAction] ?? a.action)}{a.targetName || a.targetEmail ? <> · {a.targetName || a.targetEmail}</> : null}</>}
          sub={`${when(a.at, tz)}${a.reason ? admf(" · причина: {0}", a.reason) : ''}`} sub2={a.detail || undefined} />
      ))}
      {items && items.length >= limit && limit < 100 && <Row title={adm("Показать больше")} tone="muted" onClick={() => setLimit((l) => Math.min(100, l + 20))} testId="audit-more" />}
    </Group>
  );
}

export function ViewLog({ tz, ownerId }: { tz: string; ownerId?: string }) {
  const [items, setItems] = useState<ViewLogItem[] | null>(null);
  const [limit, setLimit] = useState(12);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    setErr(false);
    fetch(`/api/admin/views?limit=${limit}${ownerId ? `&user=${encodeURIComponent(ownerId)}` : ''}`, { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<{ items: ViewLogItem[] }>; })
      .then((d) => { if (live) setItems(d.items); }).catch(() => { if (live) setErr(true); });
    return () => { live = false; };
  }, [limit, ownerId]);
  return (
    <Group title={adm("Журнал просмотров")} testId="view-log" aside={items ? admCount(items.length, W.view) : undefined}
      foot={adm("Кто из администраторов открывал чужие чаты, файлы и карточки людей. Одно и то же за 5 минут записывается один раз.")}>
      {err && <Row title={adm("Журнал не загрузился")} tone="muted" />}
      {!err && items === null && <Row title={adm("Загружаю…")} tone="muted" />}
      {items?.length === 0 && <Row title={adm("Пока никто ничего не открывал")} tone="muted" />}
      {items?.map((v) => (
        <Row key={v.id} title={<>{v.adminName} <span className="k-row-s">→</span> {v.ownerName}</>} testId="view-log-row"
          sub={`${adm(VIEW_KIND[v.kind] ?? v.kind)}${v.threadTitle ? ` «${v.threadTitle}»` : ''} · ${when(v.at, tz)}`}
          href={v.kind === 'chat' && v.threadId && v.threadTitle ? `/admin/chat/${v.threadId}` : undefined} chevron={v.kind === 'chat' && !!v.threadId && !!v.threadTitle} />
      ))}
      {items && items.length >= limit && limit < 100 && <div className="adm-more"><Button kind="plain" onClick={() => setLimit(100)}>{adm("Показать больше")}</Button></div>}
    </Group>
  );
}
