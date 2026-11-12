'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Icon } from './Icon';
import { Button, toast } from './Kit';
import { ProjectDialog, ProjectShell, colorClass, moveThreads } from './Folders';
import { useT } from '@/lib/i18n/react';
import { errText } from '@/lib/i18n/errors';
import { haptic } from '@/lib/haptic';
import type { FolderView } from '@/lib/types';

export type ChatRef = { id: string; groupId?: string | null; title: string; muted?: boolean; folderId?: string | null; temporary?: boolean };
export type ChatView = 'menu' | 'rename' | 'delete' | 'move';

const hrefOf = (c: ChatRef) => (c.groupId ? `/g/${c.groupId}` : `/c/${c.id}`);

export function ChatSheet({ target, view, onView, onClose, folders, refresh, reloadFolders, guardMs = 400 }: {
  target: ChatRef | null; view: ChatView; onView: (v: ChatView) => void; onClose: () => void; folders: FolderView[]; refresh: () => Promise<void> | void; reloadFolders: () => Promise<void> | void; guardMs?: number;
}) {
  const t = useT();
  const router = useRouter();
  const path = usePathname();
  const c = target;
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const last = useRef<ChatRef | null>(null);
  const armed = useRef(false);
  const openKey = c ? `${c.id}|${c.groupId ?? ''}` : '';
  useEffect(() => {
    armed.current = guardMs <= 0;
    if (!openKey || guardMs <= 0) return;
    const id = window.setTimeout(() => { armed.current = true; }, guardMs);
    return () => window.clearTimeout(id);
  }, [openKey, guardMs]);
  if (c) last.current = c;
  useEffect(() => { if (c) { setName(c.title); setBusy(false); } }, [c?.id, c?.groupId, view]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (c) haptic(6); }, [c?.id, c?.groupId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (view !== 'delete' || !c) return;
    const id = requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid=chat-delete-cancel]')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, [view, c]);
  if (!c && !creating) return null;
  const ch = (c ?? last.current)!;
  const key = ch.groupId ?? ch.id;
  const api = `/api/threads/${key}`;
  const json = { 'Content-Type': 'application/json' };

  const rename = async () => {
    const title = name.trim();
    if (!title || busy) return;
    if (title === ch.title.trim()) { onClose(); return; }
    setBusy(true);
    const r = await fetch(api, { method: 'PATCH', headers: json, body: JSON.stringify({ title }) }).catch(() => null);
    setBusy(false);
    if (!r?.ok) { toast(t('shell.errRename'), 'error'); return; }
    onClose();
    await refresh();
  };
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    const r = await fetch(api, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (!r?.ok) {
      const j = await r?.json().catch(() => null) as { error?: string } | null;
      toast(j?.error ? errText(t.lang, j.error) : t('shell.errDelete'), 'error');
      return;
    }
    onClose();
    await refresh();
    if (path === hrefOf(ch)) router.push('/');
  };
  const mute = async () => {
    const v = !ch.muted;
    onClose();
    const r = await fetch(api, { method: 'PATCH', headers: json, body: JSON.stringify({ muted: v }) }).catch(() => null);
    if (!r?.ok) { toast(t('shell.errMute'), 'error'); return; }
    toast(t(v ? 'shell.act.muted' : 'shell.act.unmuted'));
    await refresh();
  };
  const moveTo = async (folderId: string | null) => {
    onClose();
    if (await moveThreads([ch.id], folderId)) { await refresh(); await reloadFolders(); }
  };
  const enter = (e: React.KeyboardEvent, go: () => void) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); go(); } };

  return (
    <>
      <ProjectShell open={!!c && !creating} onClose={() => { if (armed.current) onClose(); }} label={ch.title} testId="chat-sheet"
        foot={view === 'rename'
          ? <><Button kind="plain" onClick={onClose} testId="chat-rename-cancel">{t('common.cancel')}</Button>
              <Button kind="primary" onClick={() => void rename()} disabled={!name.trim()} busy={busy} testId="chat-rename-save">{t('common.save')}</Button></>
          : view === 'delete'
            ? <><button type="button" className="k-btn k-btn--plain" onClick={onClose} data-autofocus="" data-testid="chat-delete-cancel"><span>{t('common.cancel')}</span></button>
                <button type="button" className="k-btn k-btn--primary pj-danger" onClick={() => { haptic([10, 30, 10]); void remove(); }} disabled={busy} data-testid="chat-delete-ok">{busy && <span className="k-spin" aria-hidden="true" />}<span>{t('common.delete')}</span></button></>
            : undefined}>
        <div className="ca-guard" onClickCapture={(e) => { if (!armed.current) { e.preventDefault(); e.stopPropagation(); } }}>
        {view === 'menu' && (<>
          <h2 className="pj-eyebrow ca-head" id="pj-label"><span className="ca-t" data-testid="chat-sheet-title">{ch.title}</span></h2>
          <div className="ca-list" role="menu">
            <button type="button" role="menuitem" className="ca-item" onClick={() => onView('rename')} data-testid="chat-act-rename"><Icon n="edit" /><span>{t('shell.rename')}</span></button>
            {!ch.groupId && !ch.temporary && (
              <button type="button" role="menuitem" className="ca-item" onClick={() => onView('move')} data-testid="chat-act-move"><Icon n="folder" /><span>{t('shell.act.move')}</span><Icon n="chev-right" sm className="ca-go" /></button>
            )}
            {!ch.temporary && (
              <button type="button" role="menuitem" className="ca-item" onClick={() => void mute()} data-testid="chat-act-mute"><Icon n={ch.muted ? 'bell' : 'bell-off'} /><span>{t(ch.muted ? 'shell.act.unmute' : 'shell.act.mute')}</span></button>
            )}
            <button type="button" role="menuitem" className="ca-item ca-danger" onClick={() => onView('delete')} data-testid="chat-act-delete"><Icon n="trash" /><span>{t('common.delete')}</span></button>
          </div>
        </>)}
        {view === 'rename' && (<>
          <h2 className="pj-eyebrow" id="pj-label">{t('shell.renameTitle')}</h2>
          <div className="pj-name ca-field">
            <input ref={field} className="pj-title" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('shell.renamePrompt')} maxLength={120} aria-label={t('shell.renamePrompt')}
              autoFocus data-autofocus="" enterKeyHint="done" onFocus={(e) => e.currentTarget.select()} onKeyDown={(e) => enter(e, () => void rename())} data-testid="chat-rename-input" />
          </div>
        </>)}
        {view === 'delete' && (<>
          <h2 className="pj-eyebrow" id="pj-label">{t('shell.deleteTitle')}</h2>
          <div className="pj-name" aria-hidden="true"><span className="pj-title pj-title--ro" data-testid="chat-delete-title">{ch.title}</span></div>
          <p className="pj-text">{t(ch.groupId ? 'shell.deleteCmpText' : 'shell.deleteText')}</p>
        </>)}
        {view === 'move' && (<>
          <h2 className="pj-eyebrow" id="pj-label">{t('shell.act.move')}</h2>
          <div className="ca-list" role="menu">
            {folders.map((f) => (
              <button key={f.id} type="button" role="menuitem" className="ca-item" disabled={ch.folderId === f.id} onClick={() => void moveTo(f.id)} data-testid="chat-move-to">
                <Icon n="folder" className={`fld-ic ${colorClass(f.color)}`} /><span>{f.name}</span>{ch.folderId === f.id && <Icon n="check" sm className="ca-go" />}
              </button>
            ))}
            <button type="button" role="menuitem" className="ca-item" onClick={() => setCreating(true)} data-testid="chat-move-new"><Icon n="plus" /><span>{t('fld.newDots')}</span></button>
            {ch.folderId && <button type="button" role="menuitem" className="ca-item" onClick={() => void moveTo(null)} data-testid="chat-move-out"><Icon n="x" /><span>{t('fld.moveOut')}</span></button>}
          </div>
        </>)}
        </div>
      </ProjectShell>
      <ProjectDialog edit={creating ? 'new' : null} onClose={() => { setCreating(false); onClose(); }} onSaved={() => setCreating(false)}
        onCreated={(f) => { onClose(); void moveThreads([ch.id], f.id).then(async (ok) => { if (ok) { await refresh(); await reloadFolders(); } }); }} />
    </>
  );
}
