'use client';
import { adm, admAny, admCount, admErr, admLang, admLocale, admf } from '@/lib/i18n/adm';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { InviteStats, InviteStatus, PersonStats } from '@/lib/inviteStats';
import { fmtInt, fmtTok } from '@/lib/format';
import { modelLabel } from '@/lib/levels';
import { W } from '@/lib/plural';
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
const STATUS = (): Record<InviteStatus, string> => ({ active: adm("действует"), used_up: adm("лимит исчерпан"), expired: adm("истекла"), revoked: adm("отозвана") });
const ROLE = (): Record<string, string> => ({ admin: adm(roleRu('admin')), alpha: adm(roleRu('alpha')), user: adm(roleRu('user')) });

export const usd = (v: number) => `$${v.toLocaleString(admLocale(), { minimumFractionDigits: v < 1 ? 3 : 2, maximumFractionDigits: v < 1 ? 3 : 2 })}`;
const dt = (ts: number | null | undefined, tz: string) => (ts ? new Date(ts).toLocaleString(admLocale(), { timeZone: tz, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
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
      if (!r.ok) throw new Error(admf("код {0}", r.status));
      setD((await r.json()) as InviteStats);
    } catch (e) { setErr(admf("Не обновилось ({0}).", (e as Error).message)); } finally { setBusy(false); }
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
      if (!r.ok) { setBulkErr(admErr(j.error) || adm("Не получилось. Попробуйте ещё раз")); return; }
      setBulk(false); setReason(''); setRevoke(false);
      toast(admf("Заблокировано: {0}{1}", j.blocked ?? 0, j.revoked ? adm(" · ссылка отозвана") : ''));
      await load();
    } catch { setBulkErr(adm("Нет связи с сервером")); } finally { setBulkBusy(false); }
  };
  const alphaTargets = d.people.filter((p) => !p.gone && p.role === 'user' && !p.blockKind).length;
  const [confirmUi, ask] = useConfirm();
  const alphaAll = async () => {
    if (!(await ask({ title: adm("Выдать «Альфу» всем по ссылке?"), message: admf("Роль «Альфа» получат: {0}. Им откроются облачные агенты, GitHub и автоматизации. Вернуть «Пользователя» можно каждому в списке людей.", alphaTargets), action: admf("Выдать {0}", alphaTargets) }))) return;
    try {
      const r = await fetch(`/api/admin/invites/${inv.id}/bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'alpha' }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string; granted?: number };
      if (!r.ok) { toast(admErr(j.error) || adm("Не получилось. Попробуйте ещё раз"), 'error'); return; }
      toast(admf("«Альфа» выдана: {0}", j.granted ?? 0));
      await load();
    } catch { toast(adm("Нет связи с сервером"), 'error'); }
  };
  const mName = (id: string) => modelLabel(models.map((m) => ({ ...m, defaultLevel: '', levels: m.levels.map((l) => ({ id: l.id, label: l.label ?? l.id })) })), id);
  const lName = (mid: string, lid: string) => models.find((m) => m.id === mid)?.levels.find((l) => l.id === lid)?.label ?? lid;
  const people = useMemo(() => [...d.people].sort((a, b) => {
    const x = sortVal(a, sort.key), y = sortVal(b, sort.key);
    return (typeof x === 'string' ? x.localeCompare(y as string, 'ru') : (x as number) - (y as number)) * sort.dir || a.registeredAt - b.registeredAt;
  }), [d.people, sort]);
  const pct = inv.maxUses ? Math.min(100, Math.round((inv.uses / inv.maxUses) * 100)) : 0;
  const title = `${inv.group ? adm("Групповая ссылка") : adm("Ссылка")} · ${inv.note || adm("без заметки")}`;
  const th = (key: SortKey, label: string, num = false) => (
    <th className={num ? 'n' : undefined} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="ist-sort" data-on={sort.key === key || undefined} onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : (key === 'name' ? 1 : -1) }))} data-testid={`ist-sort-${key}`}>{label}{sort.key === key && <span aria-hidden="true">{sort.dir === 1 ? ' ↑' : ' ↓'}</span>}</button>
    </th>
  );
  const T = d.totals;
  const lvMax = Math.max(1, ...d.levels.map((l) => l.n));

  return (
    <KPage title={title} sub={STATUS()[inv.status]} heading={title} testId="invite-stats"
      desc={admf("{0} · создана {1}, {2} · {3}", ROLE()[inv.role] ?? inv.role, dt(inv.createdAt, tz), inv.createdBy, inv.status === 'revoked' ? admf("отозвана {0}", dt(inv.revokedAt, tz)) : admf("до {0}", dt(inv.expiresAt, tz)))}
      topTools={<Button kind="plain" href="/admin" testId="ist-back">{adm("К приглашениям")}</Button>}>
      {err && <Notice action={<Button kind="plain" onClick={() => void load()}>{adm("Повторить")}</Button>}>{err}</Notice>}

      <div className="k-list" data-testid="ist-seats">
        <div className="ist-seats">
          <div className="ist-seats-h">
            <div><small>{adm("Регистрации")}</small><b className="tnum" data-testid="ist-seats-n">{inv.uses}<em> {adm("из")} {inv.maxUses}</em></b></div>
            <div className="ist-seats-r"><span className={`ist-st ist-st--${inv.status}`} data-testid="ist-status">{STATUS()[inv.status]}</span><span>{inv.status === 'active' || inv.status === 'used_up' ? admf("осталось {0}", inv.left) : admf("осталось {0} — ссылка закрыта", inv.left)}</span></div>
          </div>
          <div className="ist-bar" role="progressbar" aria-valuemin={0} aria-valuemax={inv.maxUses} aria-valuenow={inv.uses} aria-label={adm("Занято мест")} data-testid="ist-bar"><i style={{ width: `${pct}%` }} /></div>
        </div>
      </div>

      <GroupFlags inviteId={inv.id} />

      <Group title={adm("Люди по этой ссылке")} testId="ist-actions" plain foot={adm("Блокировка действует сразу: сессии закрыты, ключи API отозваны, идущие ответы остановлены. Администраторов, вас и уже заблокированных не трогаем. Всё пишется в журнал действий.")}>
        <div className="k-list">
          <Row icon="user" title={adm("Показать в списке людей")} sub={adm("Те же люди с фильтром «откуда пришли»")} href={`/admin?src=inv:${inv.id}`} chevron testId="ist-open-people" />
          <Row icon="alert" tone="danger" title={admf("Заблокировать всех по этой ссылке{0}…", targets ? ` (${targets})` : '')} sub={targets ? adm("Одним действием; каждый останется в списке с пометкой «заблокирован»") : adm("Некого блокировать: все уже заблокированы или людей нет")} onClick={() => { setBulk(true); setBulkErr(''); }} disabled={!targets} testId="ist-bulk" />
          <Row icon="spark" title={admf("Выдать «Альфу» всем по этой ссылке{0}…", alphaTargets ? ` (${alphaTargets})` : '')} sub={alphaTargets ? adm("Облачные агенты, GitHub и автоматизации — одним действием") : adm("Некому выдавать: все уже «Альфа», админы или заблокированы")}
            onClick={alphaTargets ? () => void alphaAll() : undefined} tone={alphaTargets ? undefined : 'muted'} testId="ist-alpha" />
          {inv.status === 'active' && <Row icon="lock" tone="danger" title={adm("Отозвать саму ссылку")} sub={adm("По ней больше нельзя будет зарегистрироваться; уже созданные аккаунты остаются")}
            right={<DestructiveButton iconOnly icon="trash" testId="ist-revoke" onConfirm={async () => { const r = await fetch(`/api/admin/invites/${inv.id}`, { method: 'DELETE' }); if (r.ok) { toast(adm("Ссылка отозвана")); await load(); } else toast(adm("Не получилось отозвать"), 'error'); }}
              confirm={{ title: adm("Отозвать ссылку?"), message: adm("По ссылке больше нельзя будет зарегистрироваться. Аккаунты, созданные по ней, остаются."), action: adm("Отозвать") }}>{adm("Отозвать")}</DestructiveButton>} />}
        </div>
      </Group>

      {confirmUi}
      <Sheet open={bulk} onClose={() => setBulk(false)} title={adm("Заблокировать всех по ссылке")} sub={`${inv.note || adm("без названия")} · ${targets}`} testId="ist-bulk-sheet"
        foot={<Button kind="danger" size="lg" block busy={bulkBusy} onClick={() => void blockAll()} testId="ist-bulk-submit">{admf("Заблокировать {0}", targets)}</Button>}>
        <p className="k-sheet-p">{adm("Будет заблокировано человек:")} {targets}{adm(". Они сразу выйдут на всех устройствах, ключи API отзовутся, идущие ответы остановятся. Чаты и данные остаются; каждого можно разблокировать отдельно.")}</p>
        <Group><Field label={adm("Причина (необязательно)")} value={reason} onChange={setReason} maxLength={500} placeholder={adm("Например, «спам по ссылке»")} testId="ist-bulk-reason" /></Group>
        <Group><SwitchRow title={adm("Заодно отозвать саму ссылку")} sub={adm("Новых регистраций по ней не будет")} checked={revoke} onChange={setRevoke} testId="ist-bulk-revoke" /></Group>
        {bulkErr && <p className="k-neg" role="alert">{bulkErr}</p>}
      </Sheet>

      <div className="k-list" data-testid="ist-tiles">
        <div className="k-stats">
          <div className="k-stat"><small>{adm("Сообщения")}</small><b>{fmtInt(T.messages)}</b><span>{admCount(T.answers, W.answer)} · {admCount(T.chats, W.chat)}</span></div>
          <div className="k-stat"><small>{adm("Токены")}</small><b>{fmtTok(T.tokens.input + T.tokens.cached + T.tokens.output)}</b><span>{adm("вход")} {fmtTok(T.tokens.input)} {adm("· из кэша")} {fmtTok(T.tokens.cached)} {adm("· выход")} {fmtTok(T.tokens.output)}</span></div>
          <div className="k-stat"><small>{adm("Себестоимость")}</small><b data-testid="ist-cost">≈ {usd(T.costUsd)}</b><span>{adm("вход")} {d.prices.input} {adm("· кэш")} {d.prices.cached} {adm("· выход")} {d.prices.output} {adm("$/млн")}{T.claudeUsd ? admf(" · из них Claude {0} (прайс Claude API)", usd(T.claudeUsd)) : ''}</span></div>
          <div className="k-stat"><small>{adm("Сейчас на сайте")}</small><b data-testid="ist-online">{d.online.now}<em> {adm("из")} {T.people}</em></b><span>{d.online.visible ? admf("вкладка открыта у {0}", d.online.visible) : adm("вкладок на экране нет")}{d.online.generating ? admf(" · пишет ответ: {0}", d.online.generating) : ''}</span></div>
          <div className="k-stat"><small>{adm("Пик одновременно")}</small><b data-testid="ist-peak">{d.online.peak}</b><span>{d.online.peak ? admf("ответов разом · {0}", dt(d.online.peakAt, tz)) : adm("ответов ещё не было")}</span></div>
          <div className="k-stat"><small>{adm("Ошибки")}</small><b>{fmtInt(T.errors)}</b><span>{T.answers ? admf("{0} % ответов", Math.round((T.errors / T.answers) * 100)) : '—'}{T.stopped ? admf(" · остановлено {0}", T.stopped) : ''}</span></div>
          <div className="k-stat"><small>{adm("Оценки")}</small><b className="an-rates">{T.up || T.down ? <RateCounts up={T.up} down={T.down} upFirst /> : '—'}</b><span>{T.up + T.down ? adm("хорошо · плохо") : adm("пока не ставили")}</span></div>
          <div className="k-stat"><small>{adm("Рассуждение")}</small><b>{fmtTok(T.tokens.reasoning)}</b><span>{adm("токенов размышления внутри выхода")}</span></div>
        </div>
      </div>

      <div className="k-grid2">
        <Group title={admf("Регистрации, {0}", d.series.regs.kind === 'hour' ? adm("по часам") : adm("по дням"))} plain testId="ist-regs"><div className="k-list k-pad"><Bars series={d.series.regs.points} kind={d.series.regs.kind} tz={tz} pick={(p) => p.v} unit={(v) => admCount(v, W.person)} readLabel={adm("за всё время")} /></div></Group>
        <Group title={adm("Сообщения, по часам (48 ч)")} plain testId="ist-msgs"><div className="k-list k-pad"><Bars series={d.series.messages.points} kind="hour" tz={tz} pick={(p) => p.v} unit={(v) => admCount(v, W.message)} readLabel={adm("за 48 часов")} /></div></Group>
      </div>
      <Group title={adm("Активные люди, по дням (14 дней)")} plain testId="ist-active"><div className="k-list k-pad"><Bars series={d.series.active.points} kind="day" tz={tz} pick={(p) => p.v} unit={(v) => admCount(v, W.person)} readLabel={adm("максимум за день")} /></div></Group>

      <Group title={admf("Люди · {0}", people.length)} testId="ist-people" plain foot={adm("Токены: вход посчитанный / из кэша / выход. Стоимость — по прайсу себестоимости (30 % загрузки), не счёт человеку.")}>
        {people.length === 0 ? <div className="k-list"><Row title={adm("По ссылке пока никто не зарегистрировался")} tone="muted" /></div> : (
          <>
            <div className="k-list k-d"><table className="k-table ist-table">
              <thead><tr>{th('name', adm("Человек"))}{th('registeredAt', adm("Регистрация"))}{th('lastAt', adm("Был(а)"))}{th('messages', adm("Сообщ."), true)}{th('chats', adm("Чатов"), true)}{th('tokens', adm("Токены вх / кэш / вых"), true)}{th('cost', '≈ $', true)}{th('errors', adm("Ошибок"), true)}{th('down', '👍 · 👎', true)}</tr></thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id} data-testid={`ist-person-${p.email || p.id}`}>
                    <td>{p.gone ? <span>{p.name} <small className="ist-mute">{adm("удалён")}</small></span> : <Link href={`/admin/users/${p.id}`} className="ist-name"><b>{p.name || p.email}</b>{p.online && <i className="ist-dot" title={adm("на сайте")} />}<small>{p.email}</small>{p.blockKind && <span className={`adm-st adm-st--${p.blockKind === 'ban' ? 'ban' : 'pause'}`}>{p.blockKind === 'ban' ? adm("заблокирован") : adm("доступ забран")}</span>}</Link>}</td>
                    <td>{dt(p.registeredAt, tz)}</td>
                    <td>{p.lastAt ? relTime(p.lastAt, tz, Date.now(), admLang()) : '—'}</td>
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
                <label htmlFor="ist-sel">{adm("Сортировка")}</label>
                <select id="ist-sel" value={sort.key} onChange={(e) => setSort((s) => ({ key: e.target.value as SortKey, dir: e.target.value === 'name' ? 1 : -1 }))} data-testid="ist-sel">
                  <option value="registeredAt">{adm("по регистрации")}</option><option value="lastAt">{adm("по активности")}</option><option value="name">{adm("по имени")}</option><option value="messages">{adm("по сообщениям")}</option>
                  <option value="chats">{adm("по чатам")}</option><option value="tokens">{adm("по токенам")}</option><option value="cost">{adm("по стоимости")}</option><option value="errors">{adm("по ошибкам")}</option><option value="down">{adm("по плохим оценкам")}</option>
                </select>
                <button type="button" className="ist-dir" onClick={() => setSort((s) => ({ ...s, dir: s.dir === 1 ? -1 : 1 }))} aria-label={adm("Направление сортировки")} data-testid="ist-dir">{sort.dir === 1 ? '↑' : '↓'}</button>
              </div>
              {people.map((p) => (
                <Row key={p.id} href={p.gone ? undefined : `/admin/users/${p.id}`} className="ist-prow" testId={`ist-prow-${p.email || p.id}`}
                  title={<>{p.name || p.email}{p.online && <i className="ist-dot" title={adm("на сайте")} />}{p.gone && <small className="ist-mute"> {adm("удалён")}</small>}{p.blockKind && <span className={`adm-st adm-st--${p.blockKind === 'ban' ? 'ban' : 'pause'}`}>{p.blockKind === 'ban' ? adm("заблокирован") : adm("доступ забран")}</span>}</>}
                  value={usd(p.costUsd)}
                  sub={admf("{0} · регистрация {1} · был(а) {2}", p.email || '—', dt(p.registeredAt, tz), p.lastAt ? relTime(p.lastAt, tz, Date.now(), admLang()) : '—')}
                  sub2={<>{admCount(p.messages, W.message)} · {admCount(p.chats, W.chat)} {adm("· токены")} {fmtTok(p.tokens.input)} / {fmtTok(p.tokens.cached)} / {fmtTok(p.tokens.output)}{p.errors ? admf(" · ошибок {0}", p.errors) : ''}{p.up || p.down ? <> · <RateCounts up={p.up} down={p.down} upFirst /></> : null}</>} />
              ))}
            </div>
          </>
        )}
      </Group>

      <Group title={adm("Уровни рассуждения")} testId="ist-levels" plain foot={adm("Сколько ответов дано на каком уровне (модель · уровень).")}>
        <div className="k-list">
          {d.levels.length === 0 ? <Row title={adm("Ответов ещё не было")} tone="muted" /> : d.levels.map((l) => (
            <div className="ist-lv" key={l.model + l.level}>
              <span className="ist-lv-t"><b>{mName(l.model)}</b> · {lName(l.model, l.level)}</span>
              <span className="ist-lv-bar"><i style={{ width: `${Math.max(3, (l.n / lvMax) * 100)}%` }} /></span>
              <span className="ist-lv-n tnum">{l.n}</span>
            </div>
          ))}
        </div>
      </Group>

      <AuditLog tz={tz} inviteId={inv.id} />

      <Group title={adm("Что считается и чего нет")} testId="ist-gaps" plain>
        <div className="k-list k-pad"><ul className="ist-gaps">{d.gaps.map((g) => <li key={g}>{admAny(g)}</li>)}</ul>
          <div className="ist-foot"><Button kind="plain" icon="retry" busy={busy} onClick={() => void load()} testId="ist-refresh">{adm("Обновить")}</Button><span className="ist-mute">{adm("на")} {dt(d.now, tz)}</span><Icon n="check" sm className="ist-ok" /></div></div>
      </Group>
    </KPage>
  );
}

type Flags = { max?: boolean; weekMult?: number | null; orgs?: boolean };
const WEEK_OPTS = (): { v: number | null; label: string }[] => ([{ v: null, label: adm("Как у всех") }, { v: 2, label: '×2' }, { v: 5, label: '×5' }, { v: 10, label: '×10' }, { v: 0, label: adm("Без лимита") }]);
function GroupFlags({ inviteId }: { inviteId: string }) {
  const [f, setF] = useState<Flags | null>(null);
  useEffect(() => { void fetch(`/api/admin/invites/${inviteId}/flags`).then((r) => r.json()).then((j: { flags: Flags }) => setF(j.flags)).catch(() => setF({})); }, [inviteId]);
  const save = async (p: Flags) => {
    const r = await fetch(`/api/admin/invites/${inviteId}/flags`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).catch(() => null);
    const j = await r?.json().catch(() => null) as { flags?: Flags; error?: string } | null;
    if (!r?.ok || !j?.flags) { toast(j?.error || adm("Не сохранилось"), 'error'); return; }
    setF(j.flags); toast(adm("Сохранено"));
  };
  if (!f) return null;
  return (
    <Group title={adm("Настройки группы")} testId="ist-flags" foot={adm("Действует сразу на всех, кто зарегистрировался по этой ссылке. Роль остаётся «Пользователь»: модели только для «Альфы», режим кода, облачные агенты и автоматизации закрыты.")}>
      <SwitchRow title={adm("Уровень Max")} sub={adm("Самый глубокий уровень размышления. Без роли «Альфа»: модели только для «Альфы» (платные по API) группе не открываются.")} checked={!!f.max} onChange={(v) => void save({ max: v })} testId="ist-flag-max" />
      <Row title={adm("Недельный лимит")} sub={adm("Личный множитель человека (если задан) главнее группового")} right={
        <span className="ist-week" role="radiogroup" aria-label={adm("Недельный лимит")}>
          {WEEK_OPTS().map((o) => <button key={String(o.v)} type="button" role="radio" aria-checked={(f.weekMult ?? null) === o.v} className={(f.weekMult ?? null) === o.v ? 'is-on' : ''} onClick={() => void save({ weekMult: o.v })} data-testid={`ist-week-${o.v ?? 'default'}`}>{o.label}</button>)}
        </span>} testId="ist-flag-week" />
      <SwitchRow title={adm("«Организации» вместо «Проектов»")} sub={adm("Для бухфирм: проект — организация-клиент, у неё свои документы")} checked={!!f.orgs} onChange={(v) => void save({ orgs: v })} testId="ist-flag-orgs" />
    </Group>
  );
}

