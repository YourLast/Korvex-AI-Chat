'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/react';
import '@/styles/user-memory.css';

type Guess = { id: string; text: string };
const low = (s: string) => (/^\p{Lu}\p{Ll}/u.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
  const r = await fetch(`/api/memory/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  return !!r && (r.ok || r.status === 404);
}
async function drop(id: string): Promise<boolean> {
  const r = await fetch(`/api/memory/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);
  return !!r && (r.ok || r.status === 404);
}

export function GuessLine({ items }: { items: Guess[] }) {
  const t = useT();
  const [st, setSt] = useState<'ask' | 'edit' | 'done'>('ask');
  const [vals, setVals] = useState<string[]>(() => items.map((g) => g.text));
  const [busy, setBusy] = useState(false);
  const yes = async () => {
    setBusy(true);
    try { const ok = (await Promise.all(items.map((g) => patch(g.id, { sure: true })))).every(Boolean); if (ok) setSt('done'); } finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true);
    try {
      const ok = (await Promise.all(items.map((g, i) => {
        const v = vals[i].trim();
        return !v ? drop(g.id) : v === g.text ? patch(g.id, { sure: true }) : patch(g.id, { text: v, sure: true });
      }))).every(Boolean);
      if (ok) setSt('done');
    } finally { setBusy(false); }
  };
  if (st === 'done') return <div className="ans-line" role="status" data-testid="guess-done">{t('msg.guessSaved')}</div>;
  if (st === 'edit') return (
    <form className="ans-line ans-line--edit" data-testid="guess-edit" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      {items.map((g, i) => (
        <input key={g.id} className="ans-line-in" value={vals[i]} maxLength={200} aria-label={t('msg.guessEdit')} autoFocus={i === 0}
          onChange={(e) => setVals((v) => v.map((x, k) => (k === i ? e.target.value : x)))} data-testid="guess-input" />
      ))}
      <span className="ans-line-acts">
        <button type="submit" className="ans-link" disabled={busy} data-testid="guess-save">{t('msg.guessSave')}</button>
        <span aria-hidden="true"> · </span>
        <button type="button" className="ans-link" onClick={() => { setVals(items.map((g) => g.text)); setSt('ask'); }} data-testid="guess-cancel">{t('msg.guessCancel')}</button>
      </span>
    </form>
  );
  return (
    <div className="ans-line" data-testid="guess-line">
      <span>{t('msg.guess', { a: items.map((g) => low(g.text)).join(', ') })}</span>{' '}
      <button type="button" className="ans-link" disabled={busy} onClick={() => void yes()} data-testid="guess-yes">{t('msg.guessYes')}</button>
      <span aria-hidden="true"> · </span>
      <button type="button" className="ans-link" disabled={busy} onClick={() => setSt('edit')} data-testid="guess-fix">{t('msg.guessFix')}</button>
    </div>
  );
}

export function InviteLine({ messageId }: { messageId: string }) {
  const t = useT();
  const router = useRouter();
  const [on, setOn] = useState(false);
  const [ty, setTy] = useState(false);
  useEffect(() => {
    let gone = false;
    void fetch(`/api/memory/invite?msg=${encodeURIComponent(messageId)}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null))
      .then((j: { line?: boolean; ty?: boolean } | null) => { if (!gone) { setOn(!!j?.line); setTy(!!j?.ty); } }).catch(() => {});
    return () => { gone = true; };
  }, [messageId]);
  if (!on) return null;
  const later = () => { setOn(false); void fetch('/api/memory/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'later' }) }).catch(() => {}); };
  return (
    <div className="ans-line" data-testid="invite-line">
      <span>{t(ty ? 'msg.inviteTy' : 'msg.invite')}</span>{' '}
      <button type="button" className="ans-link" onClick={() => { setOn(false); router.push('/settings/memory#intro'); }} data-testid="invite-go">{t('msg.inviteGo')}</button>
      <span aria-hidden="true"> · </span>
      <button type="button" className="ans-link" onClick={later} data-testid="invite-later">{t('msg.inviteLater')}</button>
    </div>
  );
}

