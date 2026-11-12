'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RatingItem, RatingsPage } from '@/lib/adminTypes';
import { fmtSec } from '@/lib/format';
import { modelLabel } from '@/lib/levels';
import { count, W } from '@/lib/plural';
import { ReasonTags, when } from './AdminBits';
import { Button, Group, Notice, Row, SelectRow, Seg, SkeletonList } from './Kit';

type ModelName = { id: string; name: string; levels: { id: string; label?: string }[]; variantOf?: string; variantName?: string };
type Val = 'all' | 'down' | 'up';
const KEY = 'kx.adm.ratings';
const DAYS = [{ value: '0', label: 'За всё время' }, { value: '1', label: 'Сутки' }, { value: '7', label: '7 дней' }, { value: '30', label: '30 дней' }];

export function AdminRatings({ models, tz, userId, userName }: { models: ModelName[]; tz: string; userId?: string; userName?: string }) {
  const [val, setVal] = useState<Val>('down');
  const [user, setUser] = useState('');
  const [model, setModel] = useState('');
  const [days, setDays] = useState('0');
  const [page, setPage] = useState<RatingsPage | null>(null);
  const [rows, setRows] = useState<RatingItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ready, setReady] = useState(!!userId);
  const seq = useRef(0);
  useEffect(() => {
    if (userId) return;
    try {
      const v = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as { val?: Val; user?: string; model?: string; days?: string } | null;
      if (v?.val === 'all' || v?.val === 'up' || v?.val === 'down') setVal(v.val);
      if (typeof v?.user === 'string') setUser(v.user);
      if (typeof v?.model === 'string') setModel(v.model);
      if (typeof v?.days === 'string' && DAYS.some((d) => d.value === v.days)) setDays(v.days);
    } catch {  }
    setReady(true);
  }, [userId]);
  useEffect(() => {
    if (userId || !ready) return;
    try { sessionStorage.setItem(KEY, JSON.stringify({ val, user, model, days })); } catch {  }
  }, [userId, ready, val, user, model, days]);

  const url = useCallback((before?: string | null) => {
    const q = new URLSearchParams();
    if (val !== 'all') q.set('value', val);
    if (userId || user) q.set('user', userId ?? user);
    if (model) q.set('model', model);
    if (days !== '0') q.set('days', days);
    if (before) q.set('before', before);
    return `/api/admin/ratings?${q}`;
  }, [val, user, model, days, userId]);

  const load = useCallback(async (more: boolean, before?: string | null) => {
    const n = ++seq.current;
    setBusy(true); setErr('');
    try {
      const r = await fetch(url(before), { cache: 'no-store' });
      if (!r.ok) throw new Error(`код ${r.status}`);
      const d = (await r.json()) as RatingsPage;
      if (n !== seq.current) return;
      setPage(d); setRows((old) => (more ? [...old, ...d.rows] : d.rows));
    } catch (e) { if (n === seq.current) setErr(`Оценки не загрузились (${(e as Error).message}).`); } finally { if (n === seq.current) setBusy(false); }
  }, [url]);
  useEffect(() => { if (ready) void load(false); }, [load, ready]);

  const mName = (id: string | null) => (id ? modelLabel(models.map((m) => ({ ...m, defaultLevel: '', levels: m.levels.map((l) => ({ id: l.id, label: l.label ?? l.id })) })), id) : '—');
  const lName = (mid: string | null, lid: string | null) => models.find((m) => m.id === mid)?.levels.find((l) => l.id === lid)?.label ?? lid ?? '—';

  return (
    <div className="k-stack" data-testid="ratings">
      <Group title={userId ? `Оценки: ${userName ?? ''}` : 'Оценки ответов'} testId="ratings-filters"
        aside={page ? `плохих ${page.down} · хороших ${page.up}` : undefined}
        foot="Нажмите на оценку — откроется чат на этом ответе; там видно, где стоят остальные оценки человека, и можно ходить по ним кнопками «Пред.» и «След.».">
        <div className="adm-filter"><Seg block label="Какие оценки" value={val} onChange={setVal} testId="ratings-val"
          options={[
            { value: 'down', label: `Плохие${page ? ` · ${page.down}` : ''}`, testId: 'rv-down' },
            { value: 'up', label: `Хорошие${page ? ` · ${page.up}` : ''}`, testId: 'rv-up' },
            { value: 'all', label: 'Все', testId: 'rv-all' },
          ]} /></div>
        {!userId && page && <SelectRow title="Человек" value={user} onChange={setUser} testId="ratings-user"
          options={[{ value: '', label: 'Все' }, ...page.users.map((u) => ({ value: u.id, label: `${u.name} · ${u.n}` }))]} />}
        {page && <SelectRow title="Модель" value={model} onChange={setModel} testId="ratings-model"
          options={[{ value: '', label: 'Все' }, ...page.models.map((m) => ({ value: m.id, label: `${mName(m.id)} · ${m.n}` }))]} />}
        <SelectRow title="Период" value={days} onChange={setDays} options={DAYS} testId="ratings-days" />
      </Group>

      {err && <Notice action={<Button kind="plain" onClick={() => void load(false)}>Повторить</Button>}>{err}</Notice>}
      {!page && !err && <SkeletonList rows={4} />}
      {page && (
        <Group testId="ratings-list" aside={rows.length ? count(rows.length, W.rating) + (page.next ? ' и больше' : '') : undefined}>
          {rows.length === 0 && <Row title={busy ? 'Загружаю…' : 'Оценок по такому отбору нет'} tone="muted" />}
          {rows.map((x) => (
            <Row key={x.id} icon="thumb" className={`adm-r adm-r--${x.value < 0 ? 'down k-row--down' : 'up'}`} tone="strong" testId="rating-row"
              href={x.exists ? `/admin/chat/${x.threadId}?m=${x.messageId}` : undefined} chevron={x.exists}
              title={<>{userId ? '' : `${x.userName} · `}{x.threadTitle ?? 'чат удалён'}</>}
              sub={`${x.value < 0 ? 'Плохо' : 'Хорошо'} · ${mName(x.modelId)} · ${lName(x.modelId, x.levelId)}${x.durationMs ? ` · ${fmtSec(x.durationMs)}` : ''} · ${when(x.at, tz)}${x.exists ? '' : ' · ответ удалён'}`}
              sub2={<>
                <ReasonTags reasons={x.reasons} comment={x.comment} />
              </>} />
          ))}
          {page.next && <div className="adm-more"><Button kind="secondary" busy={busy} onClick={() => void load(true, page.next)} testId="ratings-more">Показать ещё</Button></div>}
        </Group>
      )}
    </div>
  );
}
