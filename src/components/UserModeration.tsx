'use client';
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
    return { ok: r.ok, error: j.error };
  } catch { return { ok: false, error: 'Нет связи с сервером' }; }
}

const COPY: Record<Exclude<Act, 'unblock'>, { title: string; lead: string; effects: string[]; cta: string; done: string }> = {
  pause: {
    title: 'Забрать доступ', cta: 'Забрать доступ', done: 'Доступ забран',
    lead: 'Временная мера: человек не сможет войти, пока вы не вернёте доступ. Чаты и данные остаются.',
    effects: ['сразу закрываются все его сессии на всех устройствах', 'отзываются ключи API и удаляются подписки на уведомления', 'идущие ответы останавливаются', 'вернуть доступ можно в один клик'],
  },
  ban: {
    title: 'Заблокировать', cta: 'Заблокировать', done: 'Заблокирован',
    lead: 'Человек не сможет войти. Чаты и данные остаются; блокировку можно снять.',
    effects: ['сразу закрываются все его сессии на всех устройствах', 'отзываются ключи API и удаляются подписки на уведомления', 'идущие ответы останавливаются', 'в списке людей он помечен «заблокирован», в журнале — причина'],
  },
  delete: {
    title: 'Удалить аккаунт', cta: 'Удалить насовсем', done: 'Аккаунт удалён',
    lead: 'Это нельзя отменить.',
    effects: ['удаляются человек и все его чаты, сообщения, загруженные и созданные моделью файлы, оценки, ключи API, папки и память', 'ссылка, по которой он пришёл, и запись о регистрации остаются (имя — как было)', 'запись об удалении остаётся в журнале администраторов'],
  },
};

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
    if (!r.ok) { setErr(r.error || 'Не получилось. Попробуйте ещё раз'); return; }
    const done = act === 'unblock' ? 'Доступ возвращён' : COPY[act].done;
    close(); toast(`${done}: ${name}`); onChanged();
  };

  const blocked = !!u.disabled;
  const kindText = u.blockKind === 'ban' ? 'Заблокирован' : 'Доступ забран (пауза)';
  const c = act && act !== 'unblock' ? COPY[act] : null;
  return (
    <>
      <Group title="Доступ и аккаунт" testId="user-moderation"
        foot={self ? 'Свой аккаунт заблокировать или удалить нельзя — это делает другой администратор. Последнего действующего администратора тоже нельзя.' : 'Каждое действие пишется в журнал администраторов: кто, что, когда и почему.'}>
        {blocked && <Row title={kindText} tone="danger" testId="mod-status"
          sub={`${u.blockedAt ? when(u.blockedAt, tz) : ''}${u.blockReason ? ` · причина: ${u.blockReason}` : ''}`.replace(/^ · /, '')} />}
        {blocked
          ? <Row icon="check" title={u.blockKind === 'ban' ? 'Разблокировать' : 'Вернуть доступ'} sub="Человек сможет войти снова; ключи API и подписки на уведомления заводятся заново" onClick={() => open('unblock')} disabled={self} testId="mod-unblock" />
          : <>
              <Row icon="lock" title="Забрать доступ…" sub="На время: войти нельзя, данные сохранены" onClick={() => open('pause')} disabled={self} testId="mod-pause" />
              <Row icon="alert" title="Заблокировать…" sub="Вход закрыт, ключи и сессии сброшены, ответы остановлены" onClick={() => open('ban')} disabled={self} testId="mod-ban" />
            </>}
        <Row icon="trash" tone="danger" title="Удалить аккаунт…" sub="Насовсем: человек и все его чаты, файлы и память" onClick={() => open('delete')} disabled={self} testId="mod-delete" />
      </Group>

      <Sheet open={act === 'unblock'} onClose={close} title={u.blockKind === 'ban' ? 'Разблокировать' : 'Вернуть доступ'} sub={name} testId="mod-sheet-unblock"
        foot={<Button kind="primary" size="lg" block busy={busy} onClick={() => void go()} testId="mod-submit">{u.blockKind === 'ban' ? 'Разблокировать' : 'Вернуть доступ'}</Button>}>
        <p className="k-sheet-p">Человек снова сможет войти по своей почте и паролю. Отозванные ключи API и подписки на уведомления не возвращаются — он заведёт их заново.</p>
        {err && <p className="k-neg" role="alert">{err}</p>}
      </Sheet>

      <Sheet open={!!c} onClose={close} title={c?.title ?? ''} sub={name} testId={`mod-sheet-${act ?? ''}`}
        foot={<Button kind={act === 'delete' ? 'danger' : 'primary'} size="lg" block busy={busy} disabled={!ok} onClick={() => void go()} testId="mod-submit">{c?.cta}</Button>}>
        {c && <>
          <p className="k-sheet-p">{c.lead}</p>
          <ul className="k-sheet-ul">{c.effects.map((e) => <li key={e}>{e}</li>)}</ul>
          <Group><Field label="Причина (необязательно)" value={reason} onChange={setReason} maxLength={500} placeholder="Например, «спам» или «ошибочная регистрация»" testId="mod-reason" /></Group>
          {act === 'delete' && <Group foot={<span>Чтобы подтвердить, введите имя: <b>{name}</b></span>}><Field label="Имя человека" value={typed} onChange={setTyped} placeholder={name} autoComplete="off" testId="mod-confirm-name" /></Group>}
          {err && <p className="k-neg" role="alert" data-testid="mod-error">{err}</p>}
        </>}
      </Sheet>
    </>
  );
}
