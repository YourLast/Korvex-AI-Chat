'use client';
import { adm, admErr, admf } from '@/lib/i18n/adm';
import { useState } from 'react';
import type { PersonRow } from '@/lib/adminTypes';
import { Button, Field, Group, Row, Sheet, toast } from './Kit';
import { when } from './AdminBits';

type Act = 'ban' | 'pause' | 'unblock' | 'delete';
type P = Pick<PersonRow, 'id' | 'name' | 'email' | 'role' | 'disabled' | 'blockKind' | 'blockReason' | 'blockedAt'>;

async function moderate(id: string, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`/api/admin/users/${id}/moderate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    return { ok: r.ok, error: admErr(j.error) };
  } catch { return { ok: false, error: adm("Нет связи с сервером") }; }
}

const COPY = (): Record<Exclude<Act, 'unblock'>, { title: string; lead: string; effects: string[]; cta: string; done: string }> => ({
  pause: {
    title: adm("Забрать доступ"), cta: adm("Забрать доступ"), done: adm("Доступ забран"),
    lead: adm("Временная мера: человек не сможет войти, пока вы не вернёте доступ. Чаты и данные остаются."),
    effects: [adm("сразу закрываются все его сессии на всех устройствах"), adm("отзываются ключи API и удаляются подписки на уведомления"), adm("идущие ответы останавливаются"), adm("вернуть доступ можно в один клик")],
  },
  ban: {
    title: adm("Заблокировать"), cta: adm("Заблокировать"), done: adm("Заблокирован"),
    lead: adm("Человек не сможет войти. Чаты и данные остаются; блокировку можно снять."),
    effects: [adm("сразу закрываются все его сессии на всех устройствах"), adm("отзываются ключи API и удаляются подписки на уведомления"), adm("идущие ответы останавливаются"), adm("в списке людей он помечен «заблокирован», в журнале — причина")],
  },
  delete: {
    title: adm("Удалить аккаунт"), cta: adm("Удалить насовсем"), done: adm("Аккаунт удалён"),
    lead: adm("Это нельзя отменить."),
    effects: [adm("удаляются человек и все его чаты, сообщения, загруженные и созданные моделью файлы, оценки, ключи API, папки и память"), adm("ссылка, по которой он пришёл, и запись о регистрации остаются (имя — как было)"), adm("запись об удалении остаётся в журнале администраторов")],
  },
});

export function UserModeration({ user: u, meId, tz, onChanged }: { user: P; meId: string; tz: string; onChanged: () => void }) {
  const [act, setAct] = useState<Act | null>(null);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const self = u.id === meId;
  const name = u.name || u.email;
  const open = (a: Act) => { setAct(a); setReason(''); setTyped(''); setErr(''); };
  const close = () => { setAct(null); setBusy(false); };
  const ok = act === 'delete' ? typed.trim().toLowerCase() === name.trim().toLowerCase() || typed.trim().toLowerCase() === u.email.toLowerCase() : true;
  const go = async () => {
    if (!act || busy || !ok) return;
    setBusy(true); setErr('');
    const r = await moderate(u.id, { action: act, reason: reason.trim() || undefined, confirm: act === 'delete' ? typed.trim() : undefined });
    setBusy(false);
    if (!r.ok) { setErr(r.error || adm("Не получилось. Попробуйте ещё раз")); return; }
    const done = act === 'unblock' ? adm("Доступ возвращён") : COPY()[act].done;
    close(); toast(`${done}: ${name}`); onChanged();
  };

  const blocked = !!u.disabled;
  const kindText = u.blockKind === 'ban' ? adm("Заблокирован") : adm("Доступ забран (пауза)");
  const c = act && act !== 'unblock' ? COPY()[act] : null;
  return (
    <>
      <Group title={adm("Доступ и аккаунт")} testId="user-moderation"
        foot={self ? adm("Свой аккаунт заблокировать или удалить нельзя — это делает другой администратор. Последнего действующего администратора тоже нельзя.") : adm("Каждое действие пишется в журнал администраторов: кто, что, когда и почему.")}>
        {blocked && <Row title={kindText} tone="danger" testId="mod-status"
          sub={`${u.blockedAt ? when(u.blockedAt, tz) : ''}${u.blockReason ? admf(" · причина: {0}", u.blockReason) : ''}`.replace(/^ · /, '')} />}
        {blocked
          ? <Row icon="check" title={u.blockKind === 'ban' ? adm("Разблокировать") : adm("Вернуть доступ")} sub={adm("Человек сможет войти снова; ключи API и подписки на уведомления заводятся заново")} onClick={() => open('unblock')} disabled={self} testId="mod-unblock" />
          : <>
              <Row icon="lock" title={adm("Забрать доступ…")} sub={adm("На время: войти нельзя, данные сохранены")} onClick={() => open('pause')} disabled={self} testId="mod-pause" />
              <Row icon="alert" title={adm("Заблокировать…")} sub={adm("Вход закрыт, ключи и сессии сброшены, ответы остановлены")} onClick={() => open('ban')} disabled={self} testId="mod-ban" />
            </>}
        <Row icon="trash" tone="danger" title={adm("Удалить аккаунт…")} sub={adm("Насовсем: человек и все его чаты, файлы и память")} onClick={() => open('delete')} disabled={self} testId="mod-delete" />
      </Group>

      <Sheet open={act === 'unblock'} onClose={close} title={u.blockKind === 'ban' ? adm("Разблокировать") : adm("Вернуть доступ")} sub={name} testId="mod-sheet-unblock"
        foot={<Button kind="primary" size="lg" block busy={busy} onClick={() => void go()} testId="mod-submit">{u.blockKind === 'ban' ? adm("Разблокировать") : adm("Вернуть доступ")}</Button>}>
        <p className="k-sheet-p">{adm("Человек снова сможет войти по своей почте и паролю. Отозванные ключи API и подписки на уведомления не возвращаются — он заведёт их заново.")}</p>
        {err && <p className="k-neg" role="alert">{err}</p>}
      </Sheet>

      <Sheet open={!!c} onClose={close} title={c?.title ?? ''} sub={name} testId={`mod-sheet-${act ?? ''}`}
        foot={<Button kind={act === 'delete' ? 'danger' : 'primary'} size="lg" block busy={busy} disabled={!ok} onClick={() => void go()} testId="mod-submit">{c?.cta}</Button>}>
        {c && <>
          <p className="k-sheet-p">{c.lead}</p>
          <ul className="k-sheet-ul">{c.effects.map((e) => <li key={e}>{e}</li>)}</ul>
          <Group><Field label={adm("Причина (необязательно)")} value={reason} onChange={setReason} maxLength={500} placeholder={adm("Например, «спам» или «ошибочная регистрация»")} testId="mod-reason" /></Group>
          {act === 'delete' && <Group foot={<span>{adm("Чтобы подтвердить, введите имя:")} <b>{name}</b></span>}><Field label={adm("Имя человека")} value={typed} onChange={setTyped} placeholder={name} autoComplete="off" testId="mod-confirm-name" /></Group>}
          {err && <p className="k-neg" role="alert" data-testid="mod-error">{err}</p>}
        </>}
      </Sheet>
    </>
  );
}
