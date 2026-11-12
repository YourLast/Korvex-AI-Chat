'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { count, W } from '@/lib/plural';
import { relTime } from '@/lib/schedule';
import type { PersonRow } from '@/lib/adminTypes';
import { Icon } from './Icon';
import '@/styles/invite-stats.css';
import { AdminAnalytics } from './AdminAnalytics';
import { AdminPeople, AuditLog, ViewLog, statsLine } from './AdminPeople';
import { UserModeration } from './UserModeration';
import { AdminRatings } from './AdminRatings';
import { AdminNotices, type NoticesSnap } from './AdminNotices';
import { inviteLive, type InviteRow } from '@/lib/inviteTypes';
import { Button, CopyButton, DestructiveButton, Field, Group, KPage, Notice, Row, Seg, Sheet, toast, useConfirm } from './Kit';
import { roleRu, type Role } from '@/lib/roles';
import { ADMIN_LINKS } from '@/ext/client';
import { AdminFeatures } from './AdminFeatures';
import { AdminModels } from './AdminModels';
import { AdminAccess } from './AdminAccess';
import { AdminBrand } from './AdminBrand';
import { AdminUpdate } from './AdminUpdate';

type U = PersonRow;
type Inv = InviteRow;
type M = { id: string; name: string; fullName: string; upstreamModel: string; baseUrl: string; maxConcurrent: number; images: boolean; defaultLevel: string; variantOf?: string; variantName?: string; levels: { id: string; effort: string | null; hint: string }[] };
type Tab = 'users' | 'ratings' | 'analytics' | 'state' | 'features' | 'models' | 'access' | 'brand';

const ROLE: Record<string, string> = { admin: roleRu('admin'), alpha: roleRu('alpha'), user: roleRu('user') };
const ROLE_OPTS: { value: Role; label: string; testId: string }[] = (['user', 'alpha', 'admin'] as const).map((r) => ({ value: r, label: ROLE[r], testId: `role-opt-${r}` }));
const date = (ts: number) => new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const tabOf = (hash: string): Tab => (hash === '#brand' ? 'brand' : hash === '#access' ? 'access' : hash === '#providers' ? 'models' : hash === '#features' ? 'features' : hash === '#analytics' ? 'analytics' : hash === '#ratings' ? 'ratings' : ['#notices', '#state', '#models'].includes(hash) ? 'state' : 'users');

async function api(path: string, method: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { ok: r.ok, data: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  } catch { return { ok: false, data: { error: 'Нет связи с сервером' } }; }
}

export function AdminClient({ meId, users, invites, models, notices, tz }: { meId: string; users: U[]; invites: Inv[]; models: M[]; notices?: NoticesSnap; tz: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('users');
  useEffect(() => { setTab(tabOf(window.location.hash)); }, []);
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
    if (r.ok) { router.refresh(); if (ok) toast(ok); } else toast(String(r.data.error ?? 'Не получилось. Попробуйте ещё раз'), 'error');
    return r;
  };
  const [confirmUi, ask] = useConfirm();
  const setRole = async (x: U, v: Role) => {
    const self = x.id === meId && x.role === 'admin' && v !== 'admin';
    if (self && !(await ask({ title: 'Понизить свою роль?', message: `Вы станете «${ROLE[v]}» и сразу потеряете администрирование. Вернуть роль сможет только другой администратор.`, action: 'Понизить' }))) return;
    const r = await act(api(`/api/admin/users/${x.id}`, 'PATCH', { role: v, ...(self ? { confirmSelf: true } : {}) }), `Роль: ${ROLE[v].toLowerCase()}`);
    if (r.ok && self) router.push('/');
  };
  const createInvite = async () => {
    setBusy(true); setErr('');
    const r = await api('/api/admin/invites', 'POST', { role: inv.role, note: inv.note, days: inv.days, maxUses: inv.group ? Math.min(200, Math.max(2, Math.round(inv.maxUses) || 2)) : 1 });
    setBusy(false);
    if (!r.ok) { setErr(String(r.data.error ?? 'Ссылка не создана. Попробуйте ещё раз')); return; }
    setLink(`${location.origin}${r.data.path as string}`); router.refresh();
  };
  const createUser = async () => {
    setBusy(true); setErr('');
    const r = await api('/api/admin/users', 'POST', nu);
    setBusy(false);
    if (!r.ok) { setErr(String(r.data.error ?? 'Не добавлен. Попробуйте ещё раз')); return; }
    setSheet(null); toast(`${nu.name || nu.email} добавлен`); setNu({ email: '', name: '', password: '', role: 'user' }); router.refresh();
  };
  const closeSheet = () => { setSheet(null); setLink(''); setErr(''); };
  const invRow = (i: Inv) => {
    const group = i.maxUses > 1;
    const alive = inviteLive(i);
    const used = group ? `использовано ${i.uses} из ${i.maxUses}` : i.uses ? `использовано ${i.usedAt ? relTime(i.usedAt, tz) : ''}`.trim() : '';
    const st = i.revokedAt ? `отозвана ${relTime(i.revokedAt, tz)}` : i.uses >= i.maxUses ? (group ? `${used} — лимит исчерпан` : used) : i.expiresAt <= Date.now() ? (group ? `${used} · истекло` : 'истекло') : `${used ? used + ' · ' : ''}действует до ${relTime(i.expiresAt, tz)}`;
    const names = i.people.map((p) => p.name || '—');
    const shown = names.length > 8 ? `${names.slice(0, 8).join(', ')} и ещё ${names.length - 8}` : names.join(', ');
    return (
      <Row key={i.id} title={<Link href={`/admin/invites/${i.id}`} className="ist-tlink" data-testid={`invite-open-${i.id}`}>{`${group ? 'Групповая ссылка · ' : ''}${i.note || 'Без заметки'}`}</Link>} tone={alive ? undefined : 'muted'} sub={`${ROLE[i.role]} · ${st}`} sub2={names.length ? <span title={names.join(', ')} data-testid={`invite-people-${i.id}`}>Зарегистрировались: {shown}</span> : undefined} testId={`invite-${i.id}`}
        right={<>{<Link href={`/admin/invites/${i.id}`} className="k-icon-btn ist-open" aria-label="Статистика по ссылке" title="Статистика по ссылке" data-testid={`invite-stats-${i.id}`}><Icon n="chev-right" sm /></Link>}{alive || !i.revokedAt ? <DestructiveButton iconOnly icon="trash" testId={`invite-del-${i.id}`} onConfirm={() => act(api(`/api/admin/invites/${i.id}`, 'DELETE'), alive ? 'Ссылка отозвана' : 'Приглашение убрано')}
          confirm={{ title: alive ? 'Отозвать приглашение?' : 'Убрать приглашение из списка?', message: alive ? (i.uses ? 'По ссылке больше нельзя будет зарегистрироваться. Уже созданные аккаунты останутся, запись с именами сохранится.' : 'Ссылка перестанет работать.') : 'Аккаунты, созданные по ней, останутся.', action: alive ? 'Отозвать' : 'Убрать' }}>{alive ? 'Отозвать' : 'Убрать'}</DestructiveButton> : undefined}</>} />
    );
  };

  return (
    <KPage title="Администрирование" sub={`${count(users.length, W.user)} · ${count(models.length, W.model)}`} testId="admin"
      desc="Люди и доступ, аналитика работы, объявления и состояние моделей.">
      <Seg block label="Раздел" value={tab} onChange={go} testId="admin-tabs" options={[
        { value: 'users', label: 'Люди', testId: 'tab-users' }, { value: 'ratings', label: 'Оценки', testId: 'tab-ratings' }, { value: 'analytics', label: 'Аналитика', testId: 'tab-analytics' }, { value: 'models', label: 'Модели', testId: 'tab-models' }, { value: 'features', label: 'Функции', testId: 'tab-features' }, { value: 'access', label: 'Доступ', testId: 'tab-access' }, { value: 'brand', label: 'Бренд', testId: 'tab-brand' }, { value: 'state', label: 'Состояние', testId: 'tab-state' },
      ]} />

      {}
      {ADMIN_LINKS.length > 0 && <Group testId="site-admin">{ADMIN_LINKS.map((l) => <Row key={l.testId} icon="memory" title={l.title} sub={l.sub} chevron onClick={() => { window.location.href = l.href; }} testId={l.testId} />)}</Group>}

      <AdminUpdate />
      {tab === 'users' && (
        <>
          <div className="k-acts k-acts--stack" ref={invBtn}><Button kind="primary" icon="plus" onClick={() => { setInv({ role: 'user', note: '', days: 7, group: false, maxUses: 30 }); setSheet('invite'); }} testId="invite-new">Пригласить по ссылке</Button></div>
          <AdminPeople users={users} meId={meId} tz={tz} onSettings={setOpenU} />
          <Group testId="user-add"><Row icon="plus" title="Добавить с паролем" sub="Если человеку удобнее получить готовый вход" onClick={() => { setErr(''); setSheet('user'); }} testId="user-new" /></Group>
          <Group title="Приглашения" aside={live.length ? `${live.length} ${live.length === 1 ? 'действует' : 'действуют'}` : undefined} testId="invites"
            foot={live.length ? 'Ссылку показываем один раз — при создании. У групповой видно, сколько мест занято и кто зарегистрировался.' : 'Активных приглашений нет. Пригласите по ссылке — человек сам задаст почту и пароль.'}>
            {live.map(invRow)}
            {old.length > 0 && <Row title={`Использованные и истёкшие · ${old.length}`} tone="muted" onClick={() => setOldInv((o) => !o)} right={<span className="k-row-s">{oldInv ? 'Скрыть' : 'Показать'}</span>} testId="invites-old" />}
            {oldInv && old.map(invRow)}
            {!live.length && !old.length && <Row title="Пока ни одного" tone="muted" />}
          </Group>
          <AuditLog tz={tz} />
          <ViewLog tz={tz} />
        </>
      )}

      {tab === 'ratings' && <AdminRatings models={models} tz={tz} />}
      {tab === 'analytics' && <AdminAnalytics models={models} />}
      {tab === 'features' && <AdminFeatures />}
      {tab === 'models' && <AdminModels />}
      {tab === 'access' && <AdminAccess />}
      {tab === 'brand' && <AdminBrand />}
      {tab === 'state' && notices && <AdminNotices snap={notices} models={models} />}

      {}
      <Sheet open={sheet === 'invite'} onClose={closeSheet} title={link ? 'Ссылка готова' : 'Приглашение'} anchor={invBtn.current} testId="invite-sheet" focusFirst={link ? '[data-testid=invite-copy]' : '[data-testid=invite-note]'}
        foot={link ? <Button kind="secondary" size="lg" block onClick={closeSheet}>Готово</Button> : <Button kind="primary" size="lg" block busy={busy} onClick={createInvite} testId="invite-create">Создать ссылку</Button>}>
        {link ? (
          <div className="k-secret" data-testid="invite-link">
            <code>{link}</code>
            <p>Отправьте ссылку человеку — по ней он задаст почту и пароль. Ссылка видна только сейчас: у нас остаётся лишь её отпечаток.</p>
            <CopyButton text={link} kind="primary" size="lg" block testId="invite-copy" onCopied={() => toast('Ссылка скопирована')} />
          </div>
        ) : (
          <>
            <Group><Field label="Для кого — заметка для себя" value={inv.note} maxLength={100} placeholder="Например, «Анна, бухгалтерия»" onChange={(v) => setInv({ ...inv, note: v })} testId="invite-note" /></Group>
            <Group title="Роль" plain><Seg block label="Роль" value={inv.role} onChange={(v) => setInv({ ...inv, role: v })} options={ROLE_OPTS} /></Group>
            <Group title="Для кого ссылка" plain testId="invite-kind"><Seg block label="Для кого ссылка" value={inv.group ? 'group' : 'one'} onChange={(v) => setInv({ ...inv, group: v === 'group' })} testId="invite-kind-seg"
              options={[{ value: 'one', label: 'Одному человеку', testId: 'invite-kind-one' }, { value: 'group', label: 'Группе', testId: 'invite-kind-group' }]} /></Group>
            {inv.group && <Group testId="invite-group" foot="Одна ссылка на всю группу: каждый регистрируется сам. Когда места закончатся, ссылка перестанет работать; её можно отозвать раньше."><Field label="Сколько человек могут зарегистрироваться (2–200)" type="number" inputMode="numeric" min={2} max={200} value={String(inv.maxUses)} onChange={(v) => setInv({ ...inv, maxUses: Number(v.replace(/\D/g, '')) || 0 })} testId="invite-max" /></Group>}
            <Group title="Ссылка действует" plain><Seg block label="Срок" value={inv.days} onChange={(v) => setInv({ ...inv, days: v })} options={[{ value: 1, label: '1 день' }, { value: 7, label: '7 дней' }, { value: 14, label: '14 дней' }, { value: 30, label: '30 дней' }]} /></Group>
            {err && <Notice>{err}</Notice>}
          </>
        )}
      </Sheet>

      {}
      <Sheet open={sheet === 'user'} onClose={closeSheet} title="Новый пользователь" testId="user-sheet" focusFirst="[data-testid=nu-email]"
        foot={<Button kind="primary" size="lg" block busy={busy} disabled={!nu.email.includes('@') || nu.password.length < 8} onClick={createUser} testId="nu-create">Добавить</Button>}>
        <Group foot={nu.password && nu.password.length < 8 ? <span className="k-neg">Пароль — не короче 8 символов</span> : 'Пароль передайте человеку лично; сменить его он сможет у администратора.'}>
          <Field label="Почта" type="email" inputMode="email" autoComplete="off" value={nu.email} placeholder="name@company.ru" onChange={(v) => setNu({ ...nu, email: v })} testId="nu-email" />
          <Field label="Имя" value={nu.name} autoComplete="off" placeholder="Алексей Морозов" onChange={(v) => setNu({ ...nu, name: v })} />
          <Field label="Пароль" type="password" autoComplete="new-password" value={nu.password} placeholder="не короче 8 символов" onChange={(v) => setNu({ ...nu, password: v })} testId="nu-password" invalid={!!nu.password && nu.password.length < 8} />
        </Group>
        <Group title="Роль" plain><Seg block label="Роль" value={nu.role} onChange={(v) => setNu({ ...nu, role: v })} options={ROLE_OPTS} /></Group>
        {err && <Notice>{err}</Notice>}
      </Sheet>

      {}
      <Sheet open={!!u} onClose={() => setOpenU(null)} title={u?.name || u?.email || ''} sub={u?.id === meId ? 'это вы' : undefined} testId="user-detail">
        {u && (
          <>
            <Group>
              <Row title="Почта" value={u.email} />
              <Row title="В Korvex с" value={date(u.createdAt)} />
            </Group>
            <Group foot="Чаты и переписка с агентом, файлы и документы, оценки. Только чтение; просмотр пишется в журнал.">
              <Row icon="chat" title="Чаты, файлы и оценки" sub={statsLine(u)} href={`/admin/users/${u.id}`} chevron testId="user-open-card" />
            </Group>
            <Group title="Роль" plain foot={u.id === meId ? 'Понизить свою роль можно только с подтверждением; последнего администратора понизить нельзя. Доступ себе меняет другой администратор.' : 'Альфа — облачные агенты, GitHub и автоматизации. Админ — ещё аналитика, все ключи API и управление людьми; уровень Max — только админу.'}>
              <Seg block label={`Роль ${u.email}`} value={u.role} testId={`role-${u.email}`} onChange={(v) => void setRole(u, v)} options={ROLE_OPTS} />
            </Group>
            <UserModeration user={u} meId={meId} tz={tz} onChanged={() => { setOpenU(null); router.refresh(); }} />
          </>
        )}
      </Sheet>
      {confirmUi}
    </KPage>
  );
}
