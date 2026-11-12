'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { InviteStats, InviteStatus, PersonStats } from '@/lib/inviteStats';
import { fmtInt, fmtTok } from '@/lib/format';
import { modelLabel } from '@/lib/levels';
import { count, W } from '@/lib/plural';
import { relTime } from '@/lib/schedule';
import { Bars } from './AdminAnalytics';
import { RateCounts } from './AdminBits';
import { Button, DestructiveButton, Field, Group, KPage, Notice, Row, Sheet, SwitchRow, toast, useConfirm } from './Kit';
import { AuditLog } from './AdminPeople';
import { Icon } from './Icon';
import Link from 'next/link';
import '@/styles/invite-stats.css';
import { roleRu } from '@/lib/roles';

type ModelName = { id: string; name: string; levels: { id: string; label?: string }[]; variantOf?: string; variantName?: string };
type SortKey = 'name' | 'registeredAt' | 'lastAt' | 'messages' | 'chats' | 'tokens' | 'cost' | 'errors' | 'down';
const STATUS: Record<InviteStatus, string> = { active: 'действует', used_up: 'лимит исчерпан', expired: 'истекла', revoked: 'отозвана' };
const ROLE: Record<string, string> = { admin: roleRu('admin'), alpha: roleRu('alpha'), user: roleRu('user') };

export const usd = (v: number) => `$${v.toLocaleString('ru-RU', { minimumFractionDigits: v < 1 ? 3 : 2, maximumFractionDigits: v < 1 ? 3 : 2 })}`;
const dt = (ts: number | null | undefined, tz: string) => (ts ? new Date(ts).toLocaleString('ru-RU', { timeZone: tz, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const totalTok = (p: PersonStats) => p.tokens.input + p.tokens.cached + p.tokens.output;
const sortVal = (p: PersonStats, k: SortKey): number | string => {
  switch (k) {
    case 'name': return (p.name || p.email).toLowerCase();
    case 'registeredAt': return p.registeredAt;
    case 'lastAt': return p.lastAt ?? 0;
    case 'messages': return p.messages;
    case 'chats': return p.chats;
    case 'tokens': return totalTok(p);
    case 'cost': return p.costUsd;
    case 'errors': return p.errors;
    case 'down': return p.down;
  }
};

export function InviteStatsView({ initial, models }: { initial: InviteStats; models: ModelName[] }) {
  const [d, setD] = useState(initial);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'registeredAt', dir: -1 });
  const [bulk, setBulk] = useState(false);
  const [reason, setReason] = useState('');
  const [revoke, setRevoke] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkErr, setBulkErr] = useState('');
  const tz = d.tz;
  const load = useCallback(async () => {
    setBusy(true); setErr('');
    try {
      const r = await fetch(`/api/admin/invites/${initial.invite.id}/stats`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`код ${r.status}`);
      setD((await r.json()) as InviteStats);
    } catch (e) { setErr(`Не обновилось (${(e as Error).message}).`); } finally { setBusy(false); }
  }, [initial.invite.id]);
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30_000);
    return () => window.clearInterval(t);
  }, [load]);

  const inv = d.invite;
  const targets = d.people.filter((p) => !p.gone && p.role !== 'admin' && !p.blockKind).length;
  const blockAll = async () => {
    setBulkBusy(true); setBulkErr('');
    try {
      const r = await fetch(`/api/admin/invites/${inv.id}/bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ban', reason: reason.trim() || undefined, revoke }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string; blocked?: number; revoked?: boolean };
      if (!r.ok) { setBulkErr(j.error || 'Не получилось. Попробуйте ещё раз'); return; }
      setBulk(false); setReason(''); setRevoke(false);
      toast(`Заблокировано: ${j.blocked ?? 0}${j.revoked ? ' · ссылка отозвана' : ''}`);
      await load();
    } catch { setBulkErr('Нет связи с сервером'); } finally { setBulkBusy(false); }
  };
  const alphaTargets = d.people.filter((p) => !p.gone && p.role === 'user' && !p.blockKind).length;
  const [confirmUi, ask] = useConfirm();
  const alphaAll = async () => {
    if (!(await ask({ title: 'Выдать «Альфу» всем по ссылке?', message: `Роль «Альфа» получат: ${alphaTargets}. Им откроются облачные агенты, GitHub и автоматизации. Вернуть «Пользователя» можно каждому в списке людей.`, action: `Выдать ${alphaTargets}` }))) return;
    try {
      const r = await fetch(`/api/admin/invites/${inv.id}/bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'alpha' }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string; granted?: number };
      if (!r.ok) { toast(j.error || 'Не получилось. Попробуйте ещё раз', 'error'); return; }
      toast(`«Альфа» выдана: ${j.granted ?? 0}`);
      await load();
    } catch { toast('Нет связи с сервером', 'error'); }
  };
  const mName = (id: string) => modelLabel(models.map((m) => ({ ...m, defaultLevel: '', levels: m.levels.map((l) => ({ id: l.id, label: l.label ?? l.id })) })), id);
  const lName = (mid: string, lid: string) => models.find((m) => m.id === mid)?.levels.find((l) => l.id === lid)?.label ?? lid;
  const people = useMemo(() => [...d.people].sort((a, b) => {
    const x = sortVal(a, sort.key), y = sortVal(b, sort.key);
    return (typeof x === 'string' ? x.localeCompare(y as string, 'ru') : (x as number) - (y as number)) * sort.dir || a.registeredAt - b.registeredAt;
  }), [d.people, sort]);
  const pct = inv.maxUses ? Math.min(100, Math.round((inv.uses / inv.maxUses) * 100)) : 0;
  const title = `${inv.group ? 'Групповая ссылка' : 'Ссылка'} · ${inv.note || 'без заметки'}`;
  const th = (key: SortKey, label: string, num = false) => (
    <th className={num ? 'n' : undefined} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="ist-sort" data-on={sort.key === key || undefined} onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : (key === 'name' ? 1 : -1) }))} data-testid={`ist-sort-${key}`}>{label}{sort.key === key && <span aria-hidden="true">{sort.dir === 1 ? ' ↑' : ' ↓'}</span>}</button>
    </th>
  );
  const T = d.totals;
  const lvMax = Math.max(1, ...d.levels.map((l) => l.n));

  return (
    <KPage title={title} sub={STATUS[inv.status]} heading={title} testId="invite-stats"
      desc={`${ROLE[inv.role] ?? inv.role} · создана ${dt(inv.createdAt, tz)}, ${inv.createdBy} · ${inv.status === 'revoked' ? `отозвана ${dt(inv.revokedAt, tz)}` : `до ${dt(inv.expiresAt, tz)}`}`}
      topTools={<Button kind="plain" href="/admin" testId="ist-back">К приглашениям</Button>}>
      {err && <Notice action={<Button kind="plain" onClick={() => void load()}>Повторить</Button>}>{err}</Notice>}

      <div className="k-list" data-testid="ist-seats">
        <div className="ist-seats">
          <div className="ist-seats-h">
            <div><small>Регистрации</small><b className="tnum" data-testid="ist-seats-n">{inv.uses}<em> из {inv.maxUses}</em></b></div>
            <div className="ist-seats-r"><span className={`ist-st ist-st--${inv.status}`} data-testid="ist-status">{STATUS[inv.status]}</span><span>{inv.status === 'active' || inv.status === 'used_up' ? `осталось ${inv.left}` : `осталось ${inv.left} — ссылка закрыта`}</span></div>
          </div>
          <div className="ist-bar" role="progressbar" aria-valuemin={0} aria-valuemax={inv.maxUses} aria-valuenow={inv.uses} aria-label="Занято мест" data-testid="ist-bar"><i style={{ width: `${pct}%` }} /></div>
        </div>
      </div>

      <Group title="Люди по этой ссылке" testId="ist-actions" plain foot="Блокировка действует сразу: сессии закрыты, ключи API отозваны, идущие ответы остановлены. Администраторов, вас и уже заблокированных не трогаем. Всё пишется в журнал действий.">
        <div className="k-list">
          <Row icon="user" title="Показать в списке людей" sub="Те же люди с фильтром «откуда пришли»" href={`/admin?src=inv:${inv.id}`} chevron testId="ist-open-people" />
          <Row icon="alert" tone="danger" title={`Заблокировать всех по этой ссылке${targets ? ` (${targets})` : ''}…`} sub={targets ? 'Одним действием; каждый останется в списке с пометкой «заблокирован»' : 'Некого блокировать: все уже заблокированы или людей нет'} onClick={() => { setBulk(true); setBulkErr(''); }} disabled={!targets} testId="ist-bulk" />
          <Row icon="spark" title={`Выдать «Альфу» всем по этой ссылке${alphaTargets ? ` (${alphaTargets})` : ''}…`} sub={alphaTargets ? 'Облачные агенты, GitHub и автоматизации — одним действием' : 'Некому выдавать: все уже «Альфа», админы или заблокированы'}
            onClick={alphaTargets ? () => void alphaAll() : undefined} tone={alphaTargets ? undefined : 'muted'} testId="ist-alpha" />
          {inv.status === 'active' && <Row icon="lock" tone="danger" title="Отозвать саму ссылку" sub="По ней больше нельзя будет зарегистрироваться; уже созданные аккаунты остаются"
            right={<DestructiveButton iconOnly icon="trash" testId="ist-revoke" onConfirm={async () => { const r = await fetch(`/api/admin/invites/${inv.id}`, { method: 'DELETE' }); if (r.ok) { toast('Ссылка отозвана'); await load(); } else toast('Не получилось отозвать', 'error'); }}
              confirm={{ title: 'Отозвать ссылку?', message: 'По ссылке больше нельзя будет зарегистрироваться. Аккаунты, созданные по ней, остаются.', action: 'Отозвать' }}>Отозвать</DestructiveButton>} />}
        </div>
      </Group>

      {confirmUi}
      <Sheet open={bulk} onClose={() => setBulk(false)} title="Заблокировать всех по ссылке" sub={`${inv.note || 'без названия'} · ${targets}`} testId="ist-bulk-sheet"
        foot={<Button kind="danger" size="lg" block busy={bulkBusy} onClick={() => void blockAll()} testId="ist-bulk-submit">{`Заблокировать ${targets}`}</Button>}>
        <p className="k-sheet-p">Будет заблокировано человек: {targets}. Они сразу выйдут на всех устройствах, ключи API отзовутся, идущие ответы остановятся. Чаты и данные остаются; каждого можно разблокировать отдельно.</p>
        <Group><Field label="Причина (необязательно)" value={reason} onChange={setReason} maxLength={500} placeholder="Например, «спам по ссылке»" testId="ist-bulk-reason" /></Group>
        <Group><SwitchRow title="Заодно отозвать саму ссылку" sub="Новых регистраций по ней не будет" checked={revoke} onChange={setRevoke} testId="ist-bulk-revoke" /></Group>
        {bulkErr && <p className="k-neg" role="alert">{bulkErr}</p>}
      </Sheet>

      <div className="k-list" data-testid="ist-tiles">
        <div className="k-stats">
          <div className="k-stat"><small>Сообщения</small><b>{fmtInt(T.messages)}</b><span>{count(T.answers, W.answer)} · {count(T.chats, W.chat)}</span></div>
          <div className="k-stat"><small>Токены</small><b>{fmtTok(T.tokens.input + T.tokens.cached + T.tokens.output)}</b><span>вход {fmtTok(T.tokens.input)} · из кэша {fmtTok(T.tokens.cached)} · выход {fmtTok(T.tokens.output)}</span></div>
          <div className="k-stat"><small>Себестоимость</small><b data-testid="ist-cost">≈ {usd(T.costUsd)}</b><span>вход {d.prices.input} · кэш {d.prices.cached} · выход {d.prices.output} $/млн{T.claudeUsd ? ` · из них Claude ${usd(T.claudeUsd)} (прайс Claude API)` : ''}</span></div>
          <div className="k-stat"><small>Сейчас на сайте</small><b data-testid="ist-online">{d.online.now}<em> из {T.people}</em></b><span>{d.online.visible ? `вкладка открыта у ${d.online.visible}` : 'вкладок на экране нет'}{d.online.generating ? ` · пишет ответ: ${d.online.generating}` : ''}</span></div>
          <div className="k-stat"><small>Пик одновременно</small><b data-testid="ist-peak">{d.online.peak}</b><span>{d.online.peak ? `ответов разом · ${dt(d.online.peakAt, tz)}` : 'ответов ещё не было'}</span></div>
          <div className="k-stat"><small>Ошибки</small><b>{fmtInt(T.errors)}</b><span>{T.answers ? `${Math.round((T.errors / T.answers) * 100)} % ответов` : '—'}{T.stopped ? ` · остановлено ${T.stopped}` : ''}</span></div>
          <div className="k-stat"><small>Оценки</small><b className="an-rates">{T.up || T.down ? <RateCounts up={T.up} down={T.down} upFirst /> : '—'}</b><span>{T.up + T.down ? 'хорошо · плохо' : 'пока не ставили'}</span></div>
          <div className="k-stat"><small>Рассуждение</small><b>{fmtTok(T.tokens.reasoning)}</b><span>токенов размышления внутри выхода</span></div>
        </div>
      </div>

      <div className="k-grid2">
        <Group title={`Регистрации, ${d.series.regs.kind === 'hour' ? 'по часам' : 'по дням'}`} plain testId="ist-regs"><div className="k-list k-pad"><Bars series={d.series.regs.points} kind={d.series.regs.kind} tz={tz} pick={(p) => p.v} unit={(v) => count(v, W.person)} readLabel="за всё время" /></div></Group>
        <Group title="Сообщения, по часам (48 ч)" plain testId="ist-msgs"><div className="k-list k-pad"><Bars series={d.series.messages.points} kind="hour" tz={tz} pick={(p) => p.v} unit={(v) => count(v, W.message)} readLabel="за 48 часов" /></div></Group>
      </div>
      <Group title="Активные люди, по дням (14 дней)" plain testId="ist-active"><div className="k-list k-pad"><Bars series={d.series.active.points} kind="day" tz={tz} pick={(p) => p.v} unit={(v) => count(v, W.person)} readLabel="максимум за день" /></div></Group>

      <Group title={`Люди · ${people.length}`} testId="ist-people" plain foot="Токены: вход посчитанный / из кэша / выход. Стоимость — по прайсу себестоимости (30 % загрузки), не счёт человеку.">
        {people.length === 0 ? <div className="k-list"><Row title="По ссылке пока никто не зарегистрировался" tone="muted" /></div> : (
          <>
            <div className="k-list k-d"><table className="k-table ist-table">
              <thead><tr>{th('name', 'Человек')}{th('registeredAt', 'Регистрация')}{th('lastAt', 'Был(а)')}{th('messages', 'Сообщ.', true)}{th('chats', 'Чатов', true)}{th('tokens', 'Токены вх / кэш / вых', true)}{th('cost', '≈ $', true)}{th('errors', 'Ошибок', true)}{th('down', '👍 · 👎', true)}</tr></thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id} data-testid={`ist-person-${p.email || p.id}`}>
                    <td>{p.gone ? <span>{p.name} <small className="ist-mute">удалён</small></span> : <Link href={`/admin/users/${p.id}`} className="ist-name"><b>{p.name || p.email}</b>{p.online && <i className="ist-dot" title="на сайте" />}<small>{p.email}</small>{p.blockKind && <span className={`adm-st adm-st--${p.blockKind === 'ban' ? 'ban' : 'pause'}`}>{p.blockKind === 'ban' ? 'заблокирован' : 'доступ забран'}</span>}</Link>}</td>
                    <td>{dt(p.registeredAt, tz)}</td>
                    <td>{p.lastAt ? relTime(p.lastAt, tz) : '—'}</td>
                    <td className="n">{fmtInt(p.messages)}</td><td className="n">{fmtInt(p.chats)}</td>
                    <td className="n">{fmtTok(p.tokens.input)} / {fmtTok(p.tokens.cached)} / {fmtTok(p.tokens.output)}</td>
                    <td className="n">{usd(p.costUsd)}</td><td className="n">{p.errors || '—'}</td>
                    <td className="n">{p.up || p.down ? <RateCounts up={p.up} down={p.down} upFirst /> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <div className="k-list k-m">
              <div className="ist-sortbar">
                <label htmlFor="ist-sel">Сортировка</label>
                <select id="ist-sel" value={sort.key} onChange={(e) => setSort((s) => ({ key: e.target.value as SortKey, dir: e.target.value === 'name' ? 1 : -1 }))} data-testid="ist-sel">
                  <option value="registeredAt">по регистрации</option><option value="lastAt">по активности</option><option value="name">по имени</option><option value="messages">по сообщениям</option>
                  <option value="chats">по чатам</option><option value="tokens">по токенам</option><option value="cost">по стоимости</option><option value="errors">по ошибкам</option><option value="down">по плохим оценкам</option>
                </select>
                <button type="button" className="ist-dir" onClick={() => setSort((s) => ({ ...s, dir: s.dir === 1 ? -1 : 1 }))} aria-label="Направление сортировки" data-testid="ist-dir">{sort.dir === 1 ? '↑' : '↓'}</button>
              </div>
              {people.map((p) => (
                <Row key={p.id} href={p.gone ? undefined : `/admin/users/${p.id}`} className="ist-prow" testId={`ist-prow-${p.email || p.id}`}
                  title={<>{p.name || p.email}{p.online && <i className="ist-dot" title="на сайте" />}{p.gone && <small className="ist-mute"> удалён</small>}{p.blockKind && <span className={`adm-st adm-st--${p.blockKind === 'ban' ? 'ban' : 'pause'}`}>{p.blockKind === 'ban' ? 'заблокирован' : 'доступ забран'}</span>}</>}
                  value={usd(p.costUsd)}
                  sub={`${p.email || '—'} · регистрация ${dt(p.registeredAt, tz)} · был(а) ${p.lastAt ? relTime(p.lastAt, tz) : '—'}`}
                  sub2={<>{count(p.messages, W.message)} · {count(p.chats, W.chat)} · токены {fmtTok(p.tokens.input)} / {fmtTok(p.tokens.cached)} / {fmtTok(p.tokens.output)}{p.errors ? ` · ошибок ${p.errors}` : ''}{p.up || p.down ? <> · <RateCounts up={p.up} down={p.down} upFirst /></> : null}</>} />
              ))}
            </div>
          </>
        )}
      </Group>

      <Group title="Уровни рассуждения" testId="ist-levels" plain foot="Сколько ответов дано на каком уровне (модель · уровень).">
        <div className="k-list">
          {d.levels.length === 0 ? <Row title="Ответов ещё не было" tone="muted" /> : d.levels.map((l) => (
            <div className="ist-lv" key={l.model + l.level}>
              <span className="ist-lv-t"><b>{mName(l.model)}</b> · {lName(l.model, l.level)}</span>
              <span className="ist-lv-bar"><i style={{ width: `${Math.max(3, (l.n / lvMax) * 100)}%` }} /></span>
              <span className="ist-lv-n tnum">{l.n}</span>
            </div>
          ))}
        </div>
      </Group>

      <AuditLog tz={tz} inviteId={inv.id} />

      <Group title="Что считается и чего нет" testId="ist-gaps" plain>
        <div className="k-list k-pad"><ul className="ist-gaps">{d.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
          <div className="ist-foot"><Button kind="plain" icon="retry" busy={busy} onClick={() => void load()} testId="ist-refresh">Обновить</Button><span className="ist-mute">на {dt(d.now, tz)}</span><Icon n="check" sm className="ist-ok" /></div></div>
      </Group>
    </KPage>
  );
}
