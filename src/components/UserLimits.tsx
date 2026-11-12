'use client';
import { useCallback, useEffect, useState } from 'react';
import { Group, Row, toast } from './Kit';

type Data = {
  seat: { events7: number; warns: number; pauses: number };
  week: { mode: string; limited: boolean; used: number; limit: number; hard: number; pct: number; phase: string; mult: number; resetMark: number | null };
};

export function UserLimits({ userId, admin }: { userId: string; admin?: boolean }) {
  const [d, setD] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const r = await fetch(`/api/admin/users/${userId}/limits`, { cache: 'no-store' }); if (r.ok) setD((await r.json()) as Data); } catch {  }
  }, [userId]);
  useEffect(() => { void load(); }, [load]);
  const act = async (body: Record<string, unknown>, done: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/users/${userId}/limits`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) { toast(((await r.json().catch(() => ({}))) as { error?: string }).error || 'Не получилось. Попробуйте ещё раз', 'error'); return; }
      setD((await r.json()) as Data); toast(done);
    } catch { toast('Нет связи с сервером', 'error'); } finally { setBusy(false); }
  };
  if (!d) return null;
  const { seat, week } = d;
  const h = (sec: number) => (sec / 3600).toFixed(1).replace('.', ',');
  const multText = week.mult === 0 ? 'без лимита' : week.mult === 1 ? 'обычный' : `×${week.mult}`;
  return (
    <>
      <Group title="Совместное использование" testId="user-seat"
        foot="Только технические признаки (смены сессий, ходы поверх чужого хода), без содержимого. Первое предупреждение — только окно «Понятно», второе — пауза на сутки, третье — до вашего решения.">
        <Row title={`За 7 дней событий: ${seat.events7} · предупреждений: ${seat.warns} · пауз: ${seat.pauses}`} testId="seat-stats" />
        <Row icon="check" title="Снять предупреждения" sub="Счёт начинается заново; доступ не возвращается (это отдельная кнопка выше)" onClick={() => void act({ action: 'seat_clear' }, 'Предупреждения сняты')} disabled={busy || admin} testId="seat-clear" />
      </Group>
      <Group title="Недельный лимит" testId="user-week"
        foot={week.limited ? 'Неделя — с понедельника 00:00 по часовому поясу человека. Считается цена завершённых ходов в времени карты (токены и браузер), в сравнении — обе модели; человек видит только проценты.' : week.mode === 'off' ? 'Лимит выключен для всех (KX_WEEK_MODE=off).' : 'Для этого человека лимита нет (администратор или «без лимита»).'}>
        <Row title={week.limited ? `Использовано ${h(week.used)} из ${h(week.limit)} ч карты (${week.pct}%)` : 'Не ограничен'} sub={`множитель: ${multText}`} testId="week-stats" />
        <Row title="Поднять лимит ×2" onClick={() => void act({ action: 'week_mult', mult: 2 }, 'Лимит ×2')} disabled={busy || admin} testId="week-x2" />
        <Row title="Поднять лимит ×5" onClick={() => void act({ action: 'week_mult', mult: 5 }, 'Лимит ×5')} disabled={busy || admin} testId="week-x5" />
        <Row title="Без лимита" onClick={() => void act({ action: 'week_mult', mult: 0 }, 'Лимит снят')} disabled={busy || admin} testId="week-none" />
        <Row title="Обычный лимит" onClick={() => void act({ action: 'week_mult', mult: 1 }, 'Обычный лимит')} disabled={busy || admin} testId="week-normal" />
        <Row title="Сбросить эту неделю" sub="Ходы до этого момента не считаются" onClick={() => void act({ action: 'week_reset' }, 'Неделя сброшена')} disabled={busy || admin} testId="week-reset" />
      </Group>
    </>
  );
}
