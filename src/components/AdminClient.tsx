'use client';
import { adm, admCount, admErr, admLang, admLocale, admf } from '@/lib/i18n/adm';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { W } from '@/lib/plural';
import { relTime } from '@/lib/schedule';
import type { PersonRow } from '@/lib/adminTypes';
import { Icon } from './Icon';
import '@/styles/invite-stats.css';
import { AdminAnalytics } from './AdminAnalytics';
import { AdminPeople, AuditLog, ViewLog, statsLine } from './AdminPeople';
import { UserModeration } from './UserModeration';
import { AdminRatings } from './AdminRatings';
import { AdminNotices, type NoticesSnap } from './AdminNotices';
import { inviteLive, isForever, isUnlimited, type InviteRow } from '@/lib/inviteTypes';
import { Button, CopyButton, DestructiveButton, Field, Group, KPage, Notice, Row, Seg, Sheet, toast, useConfirm } from './Kit';
import { roleRu, type Role } from '@/lib/roles';
import { ADMIN_LINKS } from '@/ext/client';
import { AdminFeatures } from './AdminFeatures';
import { AdminModels } from './AdminModels';
import { AdminAccess } from './AdminAccess';
import { AdminMcp } from './AdminMcp';
import { AdminBrand } from './AdminBrand';
import { AdminUpdate } from './AdminUpdate';
import { AdminTour, type TourTab } from './AdminTour';

type U = PersonRow;
type Inv = InviteRow;
type M = { id: string; name: string; fullName: string; upstreamModel: string; baseUrl: string; maxConcurrent: number; images: boolean; defaultLevel: string; variantOf?: string; variantName?: string; levels: { id: string; effort: string | null; hint: string }[] };
type Tab = 'users' | 'ratings' | 'analytics' | 'state' | 'features' | 'models' | 'mcp' | 'access' | 'brand';

const ROLE = (): Record<string, string> => ({ admin: adm(roleRu('admin')), alpha: adm(roleRu('alpha')), user: adm(roleRu('user')) });
const ROLE_OPTS: { value: Role; label: string; testId: string }[] = (['user', 'alpha', 'admin'] as const).map((r) => ({ value: r, label: ROLE()[r], testId: `role-opt-${r}` }));
const date = (ts: number) => new Date(ts).toLocaleDateString(admLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
const tabOf = (hash: string): Tab => (hash === '#mcp' ? 'mcp' : hash === '#brand' ? 'brand' : hash === '#access' ? 'access' : hash === '#providers' ? 'models' : hash === '#features' ? 'features' : hash === '#analytics' ? 'analytics' : hash === '#ratings' ? 'ratings' : ['#notices', '#state', '#models'].includes(hash) ? 'state' : 'users');

async function api(path: string, method: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { ok: r.ok, data: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  } catch { return { ok: false, data: { error: adm("Нет связи с сервером") } }; }
}

export function AdminClient({ meId, users, invites, models, notices, tz, tour = false }: { meId: string; users: U[]; invites: Inv[]; models: M[]; notices?: NoticesSnap; tz: string; tour?: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('users');
  useEffect(() => { setTab(tabOf(window.location.hash)); }, []);
  const [touring, setTouring] = useState(false);
  const again = useSearchParams().get('tour') === '1';
  useEffect(() => { if (tour) setTouring(true); }, [tour]);
  useEffect(() => {
    if (!again) return;
    setTouring(true);
    router.replace(window.location.pathname + window.location.hash, { scroll: false });
  }, [again, router]);
  const tourTab = useCallback((t: TourTab) => setTab(t), []);
  const tourEnd = useCallback(() => setTouring(false), []);
  const go = (t: Tab) => { setTab(t); window.history.replaceState(window.history.state, '', t === 'users' ? window.location.pathname : `#${t === 'state' ? 'state' : t === 'models' ? 'providers' : t}`); };
  const [sheet, setSheet] = useState<'invite' | 'user' | null>(null);
  const [inv, setInv] = useState({ role: 'user' as Role, note: '', days: 7, group: false, maxUses: 30 });
  const [link, setLink] = useState('');
  const [nu, setNu] = useState({ email: '', name: '', password: '', role: 'user' as Role });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [openU, setOpenU] = useState<string | null>(null);
  const [oldInv, setOldInv] = useState(false);
  const invBtn = useRef<HTMLDivElement>(null);
  const u = users.find((x) => x.id === openU) ?? null;
  const live = invites.filter((i) => inviteLive(i));
  const old = invites.filter((i) => !inviteLive(i));

  const act = async (p: Promise<{ ok: boolean; data: Record<string, unknown> }>, ok?: string) => {
    const r = await p;
    if (r.ok) { router.refresh(); if (ok) toast(ok); } else toast(String(admErr(r.data.error as string | undefined) ?? adm("Не получилось. Попробуйте ещё раз")), 'error');
    return r;
  };
  const [confirmUi, ask] = useConfirm();
  const setRole = async (x: U, v: Role) => {
    const self = x.id === meId && x.role === 'admin' && v !== 'admin';
    if (self && !(await ask({ title: adm("Понизить свою роль?"), message: admf("Вы станете «{0}» и сразу потеряете администрирование. Вернуть роль сможет только другой администратор.", ROLE()[v]), action: adm("Понизить") }))) return;
    const r = await act(api(`/api/admin/users/${x.id}`, 'PATCH', { role: v, ...(self ? { confirmSelf: true } : {}) }), admf("Роль: {0}", ROLE()[v].toLowerCase()));
    if (r.ok && self) router.push('/');
  };
  const createInvite = async () => {
    setBusy(true); setErr('');
    const r = await api('/api/admin/invites', 'POST', { role: inv.role, note: inv.note, days: inv.days, maxUses: inv.group ? Math.min(200, Math.max(2, Math.round(inv.maxUses) || 2)) : 1 });
    setBusy(false);
    if (!r.ok) { setErr(String(admErr(r.data.error as string | undefined) ?? adm("Ссылка не создана. Попробуйте ещё раз"))); return; }
    setLink(`${location.origin}${r.data.path as string}`); router.refresh();
  };
  const createUser = async () => {
    setBusy(true); setErr('');
    const r = await api('/api/admin/users', 'POST', nu);
    setBusy(false);
    if (!r.ok) { setErr(String(admErr(r.data.error as string | undefined) ?? adm("Не добавлен. Попробуйте ещё раз"))); return; }
    setSheet(null); toast(admf("{0} добавлен", nu.name || nu.email)); setNu({ email: '', name: '', password: '', role: 'user' }); router.refresh();
  };
  const closeSheet = () => { setSheet(null); setLink(''); setErr(''); };
  const invRow = (i: Inv) => {
    const group = i.maxUses > 1;
    const alive = inviteLive(i);
    const used = isUnlimited(i) ? admf("использовано {0} · без лимита", i.uses) : group ? admf("использовано {0} из {1}", i.uses, i.maxUses) : i.uses ? admf("использовано {0}", i.usedAt ? relTime(i.usedAt, tz, Date.now(), admLang()) : '').trim() : '';
    const st = i.revokedAt ? admf("отозвана {0}", relTime(i.revokedAt, tz, Date.now(), admLang())) : i.uses >= i.maxUses ? (group ? admf("{0} — лимит исчерпан", used) : used) : i.expiresAt <= Date.now() ? (group ? admf("{0} · истекло", used) : adm("истекло")) : isForever(i) ? admf("{0}бессрочно", used ? used + ' · ' : '') : admf("{0}действует до {1}", used ? used + ' · ' : '', relTime(i.expiresAt, tz, Date.now(), admLang()));
    const names = i.people.map((p) => p.name || '—');
    const shown = names.length > 8 ? admf("{0} и ещё {1}", names.slice(0, 8).join(', '), names.length - 8) : names.join(', ');
    return (
      <Row key={i.id} title={<Link href={`/admin/invites/${i.id}`} className="ist-tlink" data-testid={`invite-open-${i.id}`}>{`${group ? adm("Групповая ссылка · ") : ''}${i.note || adm("Без заметки")}${i.email ? ` · ${i.email}` : ''}`}</Link>} tone={alive ? undefined : 'muted'} sub={`${ROLE()[i.role]} · ${st}`} sub2={names.length ? <span title={names.join(', ')} data-testid={`invite-people-${i.id}`}>{adm("Зарегистрировались:")} {shown}</span> : undefined} testId={`invite-${i.id}`}
        right={<>{<Link href={`/admin/invites/${i.id}`} className="k-icon-btn ist-open" aria-label={adm("Статистика по ссылке")} title={adm("Статистика по ссылке")} data-testid={`invite-stats-${i.id}`}><Icon n="chev-right" sm /></Link>}{alive || !i.revokedAt ? <DestructiveButton iconOnly icon="trash" testId={`invite-del-${i.id}`} onConfirm={() => act(api(`/api/admin/invites/${i.id}`, 'DELETE'), alive ? adm("Ссылка отозвана") : adm("Приглашение убрано"))}
          confirm={{ title: alive ? adm("Отозвать приглашение?") : adm("Убрать приглашение из списка?"), message: alive ? (i.uses ? adm("По ссылке больше нельзя будет зарегистрироваться. Уже созданные аккаунты останутся, запись с именами сохранится.") : adm("Ссылка перестанет работать.")) : adm("Аккаунты, созданные по ней, останутся."), action: alive ? adm("Отозвать") : adm("Убрать") }}>{alive ? adm("Отозвать") : adm("Убрать")}</DestructiveButton> : undefined}</>} />
    );
  };

  return (
    <KPage title={adm("Администрирование")} sub={`${admCount(users.length, W.user)} · ${admCount(models.length, W.model)}`} testId="admin"
      desc={adm("Люди и доступ, аналитика работы, объявления и состояние моделей.")}
      topTools={<Button kind="plain" icon="play" onClick={() => setTouring(true)} testId="tour-start">{adm("Тур по админке")}</Button>}>
      <Seg block label={adm("Раздел")} value={tab} onChange={go} testId="admin-tabs" options={[
        { value: 'users', label: adm("Люди"), testId: 'tab-users' }, { value: 'ratings', label: adm("Оценки"), testId: 'tab-ratings' }, { value: 'analytics', label: adm("Аналитика"), testId: 'tab-analytics' }, { value: 'models', label: adm("Модели"), testId: 'tab-models' }, { value: 'features', label: adm("Функции"), testId: 'tab-features' }, { value: 'mcp', label: 'MCP', testId: 'tab-mcp' }, { value: 'access', label: adm("Доступ"), testId: 'tab-access' }, { value: 'brand', label: adm("Бренд"), testId: 'tab-brand' }, { value: 'state', label: adm("Состояние"), testId: 'tab-state' },
      ]} />

      {}
      {ADMIN_LINKS.length > 0 && <Group testId="site-admin">{ADMIN_LINKS.map((l) => <Row key={l.testId} icon="memory" title={l.title} sub={l.sub} chevron onClick={() => { window.location.href = l.href; }} testId={l.testId} />)}</Group>}

      <AdminUpdate />
      {tab === 'users' && (
        <>
          <div className="k-acts k-acts--stack" ref={invBtn}><Button kind="primary" icon="plus" onClick={() => { setInv({ role: 'user', note: '', days: 7, group: false, maxUses: 30 }); setSheet('invite'); }} testId="invite-new">{adm("Пригласить по ссылке")}</Button></div>
          <AdminPeople users={users} meId={meId} tz={tz} onSettings={setOpenU} />
          <Group testId="user-add"><Row icon="plus" title={adm("Добавить с паролем")} sub={adm("Если человеку удобнее получить готовый вход")} onClick={() => { setErr(''); setSheet('user'); }} testId="user-new" /></Group>
          <Group title={adm("Приглашения")} aside={live.length ? `${live.length} ${live.length === 1 ? adm("действует") : adm("действуют")}` : undefined} testId="invites"
            foot={live.length ? adm("Ссылку показываем один раз — при создании. У групповой видно, сколько мест занято и кто зарегистрировался.") : adm("Активных приглашений нет. Пригласите по ссылке — человек сам задаст почту и пароль.")}>
            {live.map(invRow)}
            {old.length > 0 && <Row title={admf("Использованные и истёкшие · {0}", old.length)} tone="muted" onClick={() => setOldInv((o) => !o)} right={<span className="k-row-s">{oldInv ? adm("Скрыть") : adm("Показать")}</span>} testId="invites-old" />}
            {oldInv && old.map(invRow)}
            {!live.length && !old.length && <Row title={adm("Пока ни одного")} tone="muted" />}
          </Group>
          <AuditLog tz={tz} />
          <ViewLog tz={tz} />
        </>
      )}

      {tab === 'ratings' && <AdminRatings models={models} tz={tz} />}
      {tab === 'analytics' && <AdminAnalytics models={models} />}
      {tab === 'features' && <AdminFeatures />}
      {tab === 'models' && <AdminModels />}
      {tab === 'mcp' && <AdminMcp />}
      {tab === 'access' && <AdminAccess />}
      {tab === 'brand' && <AdminBrand />}
      {tab === 'state' && notices && <AdminNotices snap={notices} models={models} />}

      {}
      <Sheet open={sheet === 'invite'} onClose={closeSheet} title={link ? adm("Ссылка готова") : adm("Приглашение")} anchor={invBtn.current} testId="invite-sheet" focusFirst={link ? '[data-testid=invite-copy]' : '[data-testid=invite-note]'}
        foot={link ? <Button kind="secondary" size="lg" block onClick={closeSheet}>{adm("Готово")}</Button> : <Button kind="primary" size="lg" block busy={busy} onClick={createInvite} testId="invite-create">{adm("Создать ссылку")}</Button>}>
        {link ? (
          <div className="k-secret" data-testid="invite-link">
            <code>{link}</code>
            <p>{adm("Отправьте ссылку человеку — по ней он задаст почту и пароль. Ссылка видна только сейчас: у нас остаётся лишь её отпечаток.")}</p>
            <CopyButton text={link} kind="primary" size="lg" block testId="invite-copy" onCopied={() => toast(adm("Ссылка скопирована"))} />
          </div>
        ) : (
          <>
            <Group><Field label={adm("Для кого — заметка для себя")} value={inv.note} maxLength={100} placeholder={adm("Например, «Анна, бухгалтерия»")} onChange={(v) => setInv({ ...inv, note: v })} testId="invite-note" /></Group>
            <Group title={adm("Роль")} plain><Seg block label={adm("Роль")} value={inv.role} onChange={(v) => setInv({ ...inv, role: v })} options={ROLE_OPTS} /></Group>
            <Group title={adm("Для кого ссылка")} plain testId="invite-kind"><Seg block label={adm("Для кого ссылка")} value={inv.group ? 'group' : 'one'} onChange={(v) => setInv({ ...inv, group: v === 'group' })} testId="invite-kind-seg"
              options={[{ value: 'one', label: adm("Одному человеку"), testId: 'invite-kind-one' }, { value: 'group', label: adm("Группе"), testId: 'invite-kind-group' }]} /></Group>
            {inv.group && <Group testId="invite-group" foot={adm("Одна ссылка на всю группу: каждый регистрируется сам. Когда места закончатся, ссылка перестанет работать; её можно отозвать раньше.")}><Field label={adm("Сколько человек могут зарегистрироваться (2–200)")} type="number" inputMode="numeric" min={2} max={200} value={String(inv.maxUses)} onChange={(v) => setInv({ ...inv, maxUses: Number(v.replace(/\D/g, '')) || 0 })} testId="invite-max" /></Group>}
            <Group title={adm("Ссылка действует")} plain><Seg block label={adm("Срок")} value={inv.days} onChange={(v) => setInv({ ...inv, days: v })} options={[{ value: 1, label: adm("1 день") }, { value: 7, label: adm("7 дней") }, { value: 14, label: adm("14 дней") }, { value: 30, label: adm("30 дней") }]} /></Group>
            {err && <Notice>{err}</Notice>}
          </>
        )}
      </Sheet>

      {}
      <Sheet open={sheet === 'user'} onClose={closeSheet} title={adm("Новый пользователь")} testId="user-sheet" focusFirst="[data-testid=nu-email]"
        foot={<Button kind="primary" size="lg" block busy={busy} disabled={!nu.email.includes('@') || nu.password.length < 8} onClick={createUser} testId="nu-create">{adm("Добавить")}</Button>}>
        <Group foot={nu.password && nu.password.length < 8 ? <span className="k-neg">{adm("Пароль — не короче 8 символов")}</span> : adm("Пароль передайте человеку лично; сменить его он сможет у администратора.")}>
          <Field label={adm("Почта")} type="email" inputMode="email" autoComplete="off" value={nu.email} placeholder="name@company.ru" onChange={(v) => setNu({ ...nu, email: v })} testId="nu-email" />
          <Field label={adm("Имя")} value={nu.name} autoComplete="off" placeholder={adm("Алексей Морозов")} onChange={(v) => setNu({ ...nu, name: v })} />
          <Field label={adm("Пароль")} type="password" autoComplete="new-password" value={nu.password} placeholder={adm("не короче 8 символов")} onChange={(v) => setNu({ ...nu, password: v })} testId="nu-password" invalid={!!nu.password && nu.password.length < 8} />
        </Group>
        <Group title={adm("Роль")} plain><Seg block label={adm("Роль")} value={nu.role} onChange={(v) => setNu({ ...nu, role: v })} options={ROLE_OPTS} /></Group>
        {err && <Notice>{err}</Notice>}
      </Sheet>

      {}
      <Sheet open={!!u} onClose={() => setOpenU(null)} title={u?.name || u?.email || ''} sub={u?.id === meId ? adm("это вы") : undefined} testId="user-detail">
        {u && (
          <>
            <Group>
              <Row title={adm("Почта")} value={u.email} />
              <Row title={adm("В Korvex с")} value={date(u.createdAt)} />
            </Group>
            <Group foot={adm("Чаты и переписка с агентом, файлы и документы, оценки. Только чтение; просмотр пишется в журнал.")}>
              <Row icon="chat" title={adm("Чаты, файлы и оценки")} sub={statsLine(u)} href={`/admin/users/${u.id}`} chevron testId="user-open-card" />
            </Group>
            <Group title={adm("Роль")} plain foot={u.id === meId ? adm("Понизить свою роль можно только с подтверждением; последнего администратора понизить нельзя. Доступ себе меняет другой администратор.") : adm("Альфа — облачные агенты, GitHub и автоматизации. Админ — ещё аналитика, все ключи API и управление людьми; уровень Max — только админу.")}>
              <Seg block label={admf("Роль {0}", u.email)} value={u.role} testId={`role-${u.email}`} onChange={(v) => void setRole(u, v)} options={ROLE_OPTS} />
            </Group>
            <UserModeration user={u} meId={meId} tz={tz} onChanged={() => { setOpenU(null); router.refresh(); }} />
          </>
        )}
      </Sheet>
      {confirmUi}
      <AdminTour open={touring} onTab={tourTab} onClose={tourEnd} />
    </KPage>
  );
}
