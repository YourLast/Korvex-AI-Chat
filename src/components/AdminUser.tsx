'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminMemory, AdminMemoryItem, ChatRow, OutItem, PersonRow, UploadItem } from '@/lib/adminTypes';
import { fmtBytes, fmtInt } from '@/lib/format';
import { modelLabel } from '@/lib/levels';
import { count, W } from '@/lib/plural';
import { isImage } from '@/lib/types';
import { AdminRatings } from './AdminRatings';
import { AuditLog, PersonBadges, ViewLog } from './AdminPeople';
import { UserModeration } from './UserModeration';
import { UserLimits } from './UserLimits';
import { ExtButton, ExtRow, RateCounts, when } from './AdminBits';
import { Button, Field, Group, KPage, Notice, ReadField, Row, Seg, Sheet, SkeletonList } from './Kit';
import { roleRu } from '@/lib/roles';

type ModelName = { id: string; name: string; levels: { id: string; label?: string }[]; variantOf?: string; variantName?: string };
type Tab = 'chats' | 'files' | 'memory' | 'ratings';
type Filter = 'all' | 'down' | 'up';
type FileInfo = { id: string; name: string; mime: string; size: number; createdAt: number; threadId: string | null; threadTitle: string | null; tokens: number; text: string; truncated: boolean };

const tabOf = (h: string): Tab => (h === '#files' ? 'files' : h === '#memory' ? 'memory' : h === '#ratings' ? 'ratings' : 'chats');
const ROLE: Record<string, string> = { admin: roleRu('admin'), alpha: roleRu('alpha'), user: roleRu('user') };

export function AdminUser({ person, models, tz, initial, isMe, meId }: { person: PersonRow; models: ModelName[]; tz: string; initial: { rows: ChatRow[]; total: number }; isMe: boolean; meId: string }) {
  const [tab, setTab] = useState<Tab>('chats');
  useEffect(() => { setTab(tabOf(window.location.hash)); }, []);
  const go = (t: Tab) => { setTab(t); window.history.replaceState(window.history.state, '', t === 'chats' ? window.location.pathname : `#${t}`); };
  const mName = (id: string) => modelLabel(models.map((m) => ({ ...m, defaultLevel: '', levels: m.levels.map((l) => ({ id: l.id, label: l.label ?? l.id })) })), id);
  const name = person.name || person.email;
  const router = useRouter();

  return (
    <KPage title={name} sub={person.email} heading={name} testId="admin-user"
      desc={`${person.email} · ${ROLE[person.role]}${person.disabled ? (person.blockKind === 'ban' ? ' · заблокирован' : ' · доступ забран') : ''}${isMe ? ' · это вы' : ''}. Чаты, файлы, память и оценки — только чтение: от его имени ничего не отправляется, просмотр пишется в журнал. Доступ и аккаунт — ниже.`}
      topTools={<Button kind="plain" href="/admin">К людям</Button>}>
      <div className="k-list" data-testid="user-tiles">
        <div className="k-stats">
          <div className="k-stat"><small>Чатов</small><b>{fmtInt(person.chats)}</b><span>{count(person.messages, W.message)} от него</span></div>
          <div className="k-stat"><small>Файлов</small><b>{fmtInt(person.files)}</b><span>загруженных и созданных моделью</span></div>
          <div className="k-stat"><small>Оценки</small><b className="an-rates"><RateCounts up={person.up} down={person.down} />{!person.up && !person.down && '—'}</b><span>{person.up + person.down ? 'плохих и хороших' : 'оценок нет'}</span></div>
          <div className="k-stat"><small>Был(а)</small><b className="adm-when">{person.lastAt ? when(person.lastAt, tz) : '—'}</b><span>в Korvex с {new Date(person.createdAt).toLocaleDateString('ru-RU', { timeZone: tz, day: 'numeric', month: 'long', year: 'numeric' })}</span></div>
        </div>
      </div>

      <div className="adm-ubadges"><PersonBadges p={person} /></div>
      <UserModeration user={person} meId={meId} tz={tz} onChanged={() => router.refresh()} />
      <UserLimits userId={person.id} admin={person.role === 'admin'} />

      <Seg block label="Раздел человека" value={tab} onChange={go} testId="user-tabs" options={[
        { value: 'chats', label: 'Чаты', testId: 'ut-chats' }, { value: 'files', label: 'Файлы', testId: 'ut-files' }, { value: 'memory', label: 'Память', testId: 'ut-memory' },
        { value: 'ratings', label: 'Оценки', testId: 'ut-ratings' },
      ]} />

      {tab === 'chats' && <Chats userId={person.id} initial={initial} tz={tz} mName={mName} />}
      {tab === 'files' && <Files userId={person.id} tz={tz} />}
      {tab === 'memory' && <Memory userId={person.id} tz={tz} />}
      {tab === 'ratings' && <AdminRatings models={models} tz={tz} userId={person.id} userName={name} />}
      <AuditLog tz={tz} userId={person.id} />
      <ViewLog tz={tz} ownerId={person.id} />
    </KPage>
  );
}

function Chats({ userId, initial, tz, mName }: { userId: string; initial: { rows: ChatRow[]; total: number }; tz: string; mName: (id: string) => string }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [rows, setRows] = useState(initial.rows);
  const [total, setTotal] = useState(initial.total);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const first = useRef(true);
  const seq = useRef(0);
  const fetchRows = useCallback(async (offset: number) => {
    const n = ++seq.current;
    setBusy(true); setErr('');
    try {
      const r = await fetch(`/api/admin/people/${userId}/chats?${new URLSearchParams({ q, filter, offset: String(offset) })}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`код ${r.status}`);
      const d = (await r.json()) as { rows: ChatRow[]; total: number };
      if (n !== seq.current) return;
      setRows((old) => (offset ? [...old, ...d.rows] : d.rows)); setTotal(d.total);
    } catch (e) { if (n === seq.current) setErr(`Чаты не загрузились (${(e as Error).message}).`); } finally { if (n === seq.current) setBusy(false); }
  }, [userId, q, filter]);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => void fetchRows(0), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [fetchRows, q]);
  return (
    <>
      <Group title="Чаты" testId="user-chats" aside={q || filter !== 'all' ? `${total} из ${count(initial.total, W.chat)}` : count(total, W.chat)}>
        <Field label="Поиск по названию" value={q} onChange={setQ} placeholder="Название чата" autoComplete="off" testId="chats-search" />
        <div className="adm-filter"><Seg block label="Чаты" value={filter} onChange={setFilter} testId="chats-filter"
          options={[{ value: 'all', label: 'Все' }, { value: 'down', label: 'С плохими оценками' }, { value: 'up', label: 'С хорошими' }]} /></div>
        {err && <Row title={err} tone="danger" />}
        {!err && rows.length === 0 && <Row title={busy ? 'Загружаю…' : q || filter !== 'all' ? 'Ничего не нашли' : 'Чатов пока нет'} tone="muted" />}
        {rows.map((c) => (
          <Row key={c.id} href={`/admin/chat/${c.id}`} chevron tone="strong" testId="chat-row" title={c.title}
            sub={`${mName(c.modelId)} · ${count(c.messages, W.message)} · ${when(c.updatedAt, tz)}`}
            sub2={[c.folder ? `папка «${c.folder}»` : '', c.compare ? 'сравнение' : '', c.temporary ? 'временный' : ''].filter(Boolean).join(' · ') || undefined}
            right={<RateCounts up={c.up} down={c.down} />} />
        ))}
        {rows.length < total && <div className="adm-more"><Button kind="secondary" busy={busy} onClick={() => void fetchRows(rows.length)} testId="chats-more">Показать ещё</Button></div>}
      </Group>
    </>
  );
}

function Files({ userId, tz }: { userId: string; tz: string }) {
  const [d, setD] = useState<{ uploads: UploadItem[]; outs: OutItem[] } | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<UploadItem | null>(null);
  const [info, setInfo] = useState<FileInfo | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/admin/people/${userId}/files`, { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error(`код ${r.status}`); return r.json() as Promise<{ uploads: UploadItem[]; outs: OutItem[] }>; })
      .then((x) => { if (live) setD(x); }).catch((e: Error) => { if (live) setErr(`Файлы не загрузились (${e.message}).`); });
    return () => { live = false; };
  }, [userId]);
  useEffect(() => {
    setInfo(null);
    if (!open || isImage(open)) return;
    let live = true;
    fetch(`/api/admin/files/${open.id}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((x: FileInfo | null) => { if (live) setInfo(x); }).catch(() => {});
    return () => { live = false; };
  }, [open]);
  if (err) return <Notice>{err}</Notice>;
  if (!d) return <SkeletonList rows={3} title />;
  return (
    <>
      <Group title="Загружено в чаты" testId="user-uploads" aside={count(d.uploads.length, W.file)}
        foot="Нажмите на файл — текст, который видит модель, и ссылка на оригинал.">
        {d.uploads.length === 0 && <Row title="Файлов не загружал(а)" tone="muted" />}
        {d.uploads.map((f) => (
          <Row key={f.id} icon={isImage(f) ? 'file' : 'file-text'} title={f.name} tone="strong" onClick={() => setOpen(f)} chevron testId="upload-row"
            sub={`${fmtBytes(f.size)}${isImage(f) ? '' : ` · ≈ ${fmtInt(f.tokens)} ток.`} · ${when(f.createdAt, tz)}`} sub2={f.threadTitle ? `в чате «${f.threadTitle}»` : undefined} />
        ))}
      </Group>
      <Group title="Создано моделью" testId="user-outs" aside={count(d.outs.length, W.file)} foot="Картинки, таблицы и документы, которые Korvex сделал в ответах. Открываются в новой вкладке.">
        {d.outs.length === 0 && <Row title="Файлов от модели нет" tone="muted" />}
        {d.outs.map((f) => (
          <ExtRow key={`${f.token}/${f.name}`} icon="file-text" title={f.name} href={f.url} testId="out-row"
            sub={`${fmtBytes(f.size)} · ${when(f.createdAt, tz)}`} sub2={f.threadTitle ? `в чате «${f.threadTitle}»` : undefined} />
        ))}
      </Group>

      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ''} sub={open ? `${fmtBytes(open.size)} · ${when(open.createdAt, tz)}` : undefined} testId="file-sheet"
        foot={open ? <div className="k-acts">
          <ExtButton kind="primary" href={`/api/files/${open.id}`} testId="file-orig">{isImage(open) ? 'Открыть оригинал' : 'Скачать оригинал'}</ExtButton>
          {open.threadId && open.threadTitle && <Button kind="secondary" href={`/admin/chat/${open.threadId}`}>Открыть чат</Button>}
        </div> : undefined}>
        {open && isImage(open) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="adm-file-img" src={`/api/files/${open.id}?w=960`} alt={open.name} loading="lazy" />
        )}
        {open && !isImage(open) && (
          <>
            <Group><ReadField label="Тип" value={open.mime} /></Group>
            {!info && <SkeletonList rows={2} />}
            {info && (info.text
              ? <pre className="adm-file-text" data-testid="file-text">{info.text}{info.truncated ? '\n…' : ''}</pre>
              : <Notice tone="info">У файла нет извлечённого текста — скачайте оригинал.</Notice>)}
          </>
        )}
      </Sheet>
    </>
  );
}

const MEM_SECTIONS: [string, string][] = [['who', 'Кто'], ['work', 'Работа и проекты'], ['interests', 'Интересы'], ['style', 'Как общаться'], ['facts', 'Другое']];

function memSource(it: AdminMemoryItem, tz: string): string {
  const at = when(it.updatedAt, tz);
  if (it.origin === 'manual') return `добавил(а) сам(а) · ${at}`;
  if (it.key === 'writes') return `посчитано по его сообщениям · ${at}`;
  const chat = it.chat ? (it.chat.intro ? 'в знакомстве' : `в чате «${it.chat.title}»`) : 'в удалённом чате';
  return `${it.origin === 'asked' ? 'попросил(а) запомнить' : 'из разговора'} ${chat} · ${at}`;
}

function Memory({ userId, tz }: { userId: string; tz: string }) {
  const [d, setD] = useState<AdminMemory | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    fetch(`/api/admin/people/${userId}/memory`, { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error(`код ${r.status}`); return r.json() as Promise<AdminMemory>; })
      .then((x) => { if (live) setD(x); }).catch((e: Error) => { if (live) setErr(`Память не загрузилась (${e.message}).`); });
    return () => { live = false; };
  }, [userId]);
  if (err) return <Notice>{err}</Notice>;
  if (!d) return <SkeletonList rows={3} title />;
  const row = (it: AdminMemoryItem) => (
    <Row key={it.id} title={it.text} sub={memSource(it, tz)} testId="umem-item" className={it.blocked ? 'k-row--blocked' : undefined}
      sub2={it.blocked ? <span className="k-row-warn">Не применяется: противоречит правилам системы</span> : undefined}
      href={it.chat ? `/admin/chat/${it.chat.id}` : undefined} chevron={!!it.chat} />
  );
  const maybe = d.items.filter((x) => !x.sure);
  const p = d.prompt;
  return (
    <>
      <Group title="Состояние" testId="umem-state" foot="Только просмотр: здесь ничего не меняется. Правит память сам человек в Настройках → Память или просьбой в чате.">
        <ReadField label="Память" value={d.on ? (d.auto ? 'включена, запоминает сама' : 'включена, только по просьбе') : 'выключена — модель о нём ничего не знает'} testId="umem-on" />
        <ReadField label="Как обращаться" value={d.callName.value ? `${d.callName.value}${d.callName.fromProfile ? ' (из профиля аккаунта, сам не называл)' : ''}` : 'не знает'} testId="umem-name" />
        <ReadField label="Знакомство" value={d.introDone ? 'было' : d.introAt ? `начато ${when(d.introAt, tz)}` : 'не было'} />
        {!d.callName.value || d.callName.fromProfile ? <ReadField label="Имя спрашивала" value={d.askedName ? when(d.askedName, tz) : 'ещё нет'} /> : null}
        {p && <ReadField label="Уходит модели" testId="umem-prompt"
          value={`${count(p.used, W.record)}${p.dropped ? `, ещё ${p.dropped} не влезли в бюджет` : ''}${p.blocked ? `, ${p.blocked} не применяются` : ''} · ≈ ${fmtInt(p.tokens)} ток. с правилами`} />}
      </Group>

      {d.items.length === 0 && <Group><Row title="В памяти пока ничего нет" tone="muted" testId="umem-empty" /></Group>}
      {MEM_SECTIONS.map(([id, title]) => {
        const items = d.items.filter((x) => x.section === id && x.sure);
        return items.length ? <Group key={id} title={title} aside={items.length} testId={`umem-sec-${id}`}>{items.map(row)}</Group> : null;
      })}
      {maybe.length > 0 && (
        <Group title="Возможно" aside={maybe.length} testId="umem-sec-maybe"
          foot="Догадки по его сообщениям: модель их не утверждает. Подтвердятся повтором в другом чате или им самим, без повтора за 60 дней уходят.">{maybe.map(row)}</Group>
      )}
      {p && p.body && (
        <Group title="Как это видит модель" testId="umem-body" foot="Часть системного сообщения о человеке в обычном чате — без общих правил Korvex, которые одинаковы у всех.">
          <pre className="adm-file-text adm-mem-body" data-testid="umem-body-text">{p.body}</pre>
        </Group>
      )}
    </>
  );
}
