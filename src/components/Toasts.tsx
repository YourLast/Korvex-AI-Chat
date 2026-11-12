'use client';
import { useEffect } from 'react';
import { tr, type Lang } from '@/lib/i18n/core';
import { useT } from '@/lib/i18n/react';
import { Icon } from './Icon';

export type Toast = { id: string; href: string; model: string; title: string; preview: string; error?: boolean; auto?: string | null;
  both?: { model: string; status: string }[];
  check?: string };
export function bothTitle(b: { status: string }[]): 'both' | 'one' | 'none' {
  const ok = b.filter((x) => x.status === 'done').length;
  return ok === b.length ? 'both' : ok ? 'one' : 'none';
}

export function toastParts(t: Toast, lang: Lang): { b: string; rest: string } {
  const inChat = tr(lang, 'shell.n.inChat', { title: t.title });
  if (t.check) return { b: tr(lang, 'shell.n.check'), rest: inChat };
  if (t.both) { const k = bothTitle(t.both); return { b: tr(lang, k === 'both' ? 'shell.n.both' : k === 'one' ? 'shell.n.one' : 'shell.n.fail'), rest: inChat }; }
  if (t.error) return { b: tr(lang, 'shell.n.fail'), rest: inChat };
  if (t.auto) return { b: tr(lang, 'shell.n.auto', { name: t.auto }), rest: tr(lang, 'shell.n.autoDone') };
  return { b: tr(lang, 'shell.n.answered', { model: t.model }), rest: inChat };
}
export function toastBody(t: Toast, lang: Lang): string {
  if (t.both) return `${t.both.map((x) => x.model).join(tr(lang, 'shell.n.and'))}${t.preview ? ` · ${t.preview}` : ''}`;
  return t.error ? tr(lang, 'shell.n.reopen', { model: t.model }) : t.preview;
}

export function Toasts({ items, onOpen, onClose }: { items: Toast[]; onOpen: (t: Toast) => void; onClose: (id: string) => void }) {
  const tx = useT();
  useEffect(() => {
    if (!items.length) return;
    const timers = items.map((t) => window.setTimeout(() => onClose(t.id), 8000));
    return () => timers.forEach((x) => window.clearTimeout(x));
  }, [items, onClose]);
  if (!items.length) return null;
  return (
    <div className="toasts" role="region" aria-label={tx('shell.notifications')} aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="toast" data-testid="toast">
          <button type="button" className="toast-main" onClick={() => onOpen(t)}>
            <span className="toast-title">{(() => { const p = toastParts(t, tx.lang); return <><b>{p.b}</b>{p.rest}</>; })()}</span>
            {t.both ? <span className="toast-body">{toastBody(t, tx.lang)}</span> : !t.error && t.preview && <span className="toast-body">{t.preview}</span>}
          </button>
          <button type="button" className="icon-btn toast-x" aria-label={tx('common.close')} onClick={() => onClose(t.id)}><Icon n="x" sm /></button>
        </div>
      ))}
    </div>
  );
}
