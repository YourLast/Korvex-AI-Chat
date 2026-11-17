'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { adm, admf } from '@/lib/i18n/adm';
import { Button } from './Kit';
import '@/styles/admin-tour.css';

export type TourTab = 'users' | 'features' | 'state';
type Step = { id: string; tab: TourTab; target: string; title: string; text: string };

const STEPS = (): Step[] => [
  { id: 'people', tab: 'users', target: '[data-testid=users-table]', title: adm("Люди"), text: adm("Все, кто зарегистрировался. Нажмите на человека: роль, блокировка, его чаты и файлы (только чтение, просмотр пишется в журнал).") },
  { id: 'invites', tab: 'users', target: '[data-testid=invites]', title: adm("Приглашения"), text: adm("Ссылки для регистрации: общая — для всех сотрудников, одноразовая — для одного человека. Ссылку можно отозвать; уже созданные аккаунты останутся.") },
  { id: 'memory', tab: 'features', target: '[data-testid=feature-memory]', title: adm("Память"), text: adm("Модель запоминает факты о каждом человеке отдельно и учитывает их в ответах. Здесь память выключается для всех; свою человек видит и правит сам: Настройки → Память.") },
  { id: 'model', tab: 'state', target: '[data-testid=load-table]', title: adm("Модель"), text: adm("Отвечает ли модель и как она нагружена. Отсюда же можно предупредить всех о работах: флаг «медленно» или «недоступна» и объявление.") },
  { id: 'journal', tab: 'users', target: '[data-testid=audit-log]', title: adm("Журнал"), text: adm("Что меняли администраторы: роли, блокировки, ссылки, функции. Ниже — журнал просмотров чужих чатов.") },
];

export function AdminTour({ open, onTab, onClose }: { open: boolean; onTab: (t: TourTab) => void; onClose: () => void }) {
  const steps = STEPS();
  const [i, setI] = useState(0);
  const card = useRef<HTMLDivElement>(null);
  const s = steps[Math.min(i, steps.length - 1)];
  const finish = useCallback(() => {
    void fetch('/api/admin/tour', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: true }) }).catch(() => {});
    document.querySelectorAll('.k-tour-on').forEach((el) => el.classList.remove('k-tour-on'));
    onClose();
  }, [onClose]);
  useEffect(() => { if (open) setI(0); }, [open]);
  useEffect(() => {
    if (!open) return;
    onTab(s.tab);
    let tries = 0, el: Element | null = null, timer = 0;
    const find = () => {
      el = document.querySelector(s.target);
      if (!el && tries++ < 40) { timer = window.setTimeout(find, 50); return; }
      document.querySelectorAll('.k-tour-on').forEach((x) => x.classList.remove('k-tour-on'));
      if (el) { el.classList.add('k-tour-on'); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    };
    find();
    return () => { window.clearTimeout(timer); document.querySelectorAll('.k-tour-on').forEach((x) => x.classList.remove('k-tour-on')); };
  }, [open, s.tab, s.target, onTab]);
  useEffect(() => { if (open) card.current?.querySelector<HTMLElement>('[data-testid=tour-next]')?.focus({ preventScroll: true }); }, [open, i]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); finish(); } };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [open, finish]);
  if (!open) return null;
  const last = i >= steps.length - 1;
  return (
    <div ref={card} className="k-tour" role="dialog" aria-modal="false" aria-labelledby="k-tour-t" data-testid="admin-tour" data-step={s.id}>
      <div className="k-tour-n">{admf("Шаг {0} из {1}", i + 1, steps.length)}</div>
      <h2 id="k-tour-t" className="k-tour-t">{s.title}</h2>
      <p className="k-tour-p">{s.text}</p>
      <div className="k-tour-acts">
        <Button kind="plain" onClick={finish} testId="tour-skip">{adm("Пропустить")}</Button>
        <span className="k-tour-sp" />
        {i > 0 && <Button kind="secondary" onClick={() => setI(i - 1)} testId="tour-back">{adm("Назад")}</Button>}
        <Button kind="primary" onClick={() => (last ? finish() : setI(i + 1))} testId="tour-next">{last ? adm("Готово") : adm("Далее")}</Button>
      </div>
    </div>
  );
}
