'use client';
import Link from 'next/link';
import { useState } from 'react';
import { tr, type Lang } from '@/lib/i18n/core';
import { useT } from '@/lib/i18n/react';
import { Icon } from './Icon';
import '@/styles/user-memory.css';

export type MemUpdItem = { op: string; text: string; id?: string; maybe?: boolean; fix?: boolean; section?: string; prev?: { text: string; section: string; sure: number; key?: string | null; origin?: string } | null; undone?: boolean };
export const canUndo = (it: MemUpdItem) => !it.undone && ((it.op === 'add' && !!it.id) || (it.op === 'update' && !!it.id && !!it.prev) || (it.op === 'delete' && !!it.prev?.text));

export function memUpdText(items: MemUpdItem[], lang: Lang = 'ru'): string {
  const live = items.filter((x) => !x.undone);
  if (!live.length) return tr(lang, 'msg.memUndone');
  const low = (t: string) => (/^[А-ЯЁ][а-яё]+(\s|$|,)/.test(t) ? t[0].toLocaleLowerCase('ru-RU') + t.slice(1) : t);
  const add = live.filter((x) => x.op !== 'delete' && !x.maybe), del = live.filter((x) => x.op === 'delete');
  const maybe = live.filter((x) => x.op !== 'delete' && x.maybe);
  const part = (xs: { text: string }[]) => (xs.every((x) => !x.text) ? tr(lang, 'msg.memPersonal') : xs.filter((x) => x.text).map((x) => low(x.text)).join(', '));
  let s: string;
  if (live.some((x) => x.fix)) {
    const now = live.filter((x) => x.op !== 'delete');
    s = now.length ? tr(lang, 'msg.memFix', { a: part(now) }) : tr(lang, 'msg.memFixDel', { d: part(del) });
  } else if (add.length) s = del.length ? tr(lang, 'msg.memAddDel', { a: part(add), d: part(del) }) : tr(lang, 'msg.memAdd', { a: part(add) });
  else if (maybe.length) s = tr(lang, maybe.every((x) => x.section === 'interests') ? 'msg.memMaybe' : 'msg.memMaybeFact', { a: part(maybe) });
  else s = tr(lang, 'msg.memDel', { d: part(del) });
  return s.length > 44 ? s.slice(0, 42).replace(/[\s,;:]+\S*$/, '') + '…' : s;
}

export function MemUpdated({ items: items0, messageId }: { items: MemUpdItem[]; messageId?: string }) {
  const tx = useT();
  const [items, setItems] = useState(items0);
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState(items0);
  if (seen !== items0) { setSeen(items0); setItems(items0); }
  const id = items.find((x) => x.op !== 'delete' && x.id && !x.undone)?.id;
  const full = items.filter((x) => !x.undone).map((x) => tx(x.fix ? (x.op === 'delete' ? 'msg.memFixDel' : 'msg.memFix') : x.op === 'delete' ? 'msg.memDel' : x.maybe ? 'msg.memMaybeFact' : 'msg.memAdd', { a: x.text || tx('msg.memPersonal'), d: x.text || tx('msg.memPersonal') })).join('\n') || tx('msg.memUndone');
  const undoable = !!messageId && items.some(canUndo);
  const allUndone = items.every((x) => x.undone);
  const undo = async () => {
    if (!messageId || busy) return;
    setBusy(true);
    try {
      const r = await fetch('/api/memory/undo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId }) }).catch(() => null);
      if (r?.ok) { const j = (await r.json()) as { items: MemUpdItem[] }; setItems(j.items); }
    } finally { setBusy(false); }
  };
  return (
    <div className="mem-upd-row" data-testid="mem-upd-row">
      {allUndone
        ? <span className="mem-upd mem-upd--undone" data-testid="mem-upd"><Icon n="memory" sm /><span>{tx('msg.memUndone')}</span></span>
        : (
          <Link href={id ? `/settings/memory#m-${id}` : '/settings/memory'} className="mem-upd" title={full} aria-label={tx('msg.memOpen', { full })} data-testid="mem-upd">
            <Icon n="memory" sm /><span>{memUpdText(items, tx.lang)}</span>
          </Link>
        )}
      {undoable && <button type="button" className="mem-undo" onClick={() => void undo()} disabled={busy} data-testid="mem-undo">{tx('msg.memUndo')}</button>}
    </div>
  );
}
