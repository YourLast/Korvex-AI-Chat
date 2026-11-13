'use client';
import { useFT, useOrgMode } from './orgMode';
import { OrgInbox } from './OrgInbox';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { Popover, useIsMobile } from './Popover';
import { Button, toast } from './Kit';
import { useLive } from '@/lib/live';
import { tr, type Key } from '@/lib/i18n/core';
import { docLang, useT } from '@/lib/i18n/react';
import { errText } from '@/lib/i18n/errors';
import { haptic } from '@/lib/haptic';
import type { FolderView, ThreadLite } from '@/lib/types';
import '@/styles/folders.css';

export function useFolders() {
  const [folders, setFolders] = useState<FolderView[]>([]);
  const load = useCallback(async () => {
    try { const r = await fetch('/api/folders', { cache: 'no-store' }); if (r.ok) setFolders(((await r.json()) as { folders: FolderView[] }).folders); } catch {  }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useLive((e) => { if (e.t === 'folders' || e.t === 'sync') void load(); });
  return { folders, setFolders, load };
}

export async function moveThreads(ids: string[], folderId: string | null): Promise<boolean> {
  const r = await fetch('/api/threads/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, folderId }) }).catch(() => null);
  if (!r?.ok) toast(tr(docLang(), 'fld.errMove'), 'error');
  return !!r?.ok;
}

async function createFolder(name: string, instruction = '', color = ''): Promise<FolderView | null> {
  const r = await fetch('/api/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, instruction, color }) }).catch(() => null);
  if (!r?.ok) { const j = await r?.json().catch(() => null) as { error?: string } | null; toast(j?.error ? errText(docLang(), j.error) : tr(docLang(), 'fld.errCreate'), 'error'); return null; }
  return ((await r.json()) as { folder: FolderView }).folder;
}

const DRAG = 'application/x-korvex-thread';

export const PROJECT_COLORS: { id: string; name: Key }[] = [
  { id: '', name: 'fld.c.gray' }, { id: 'blue', name: 'fld.c.blue' }, { id: 'violet', name: 'fld.c.violet' },
  { id: 'green', name: 'fld.c.green' }, { id: 'yellow', name: 'fld.c.yellow' }, { id: 'coral', name: 'fld.c.coral' },
];
export const colorClass = (c?: string) => `pj-c-${c || 'gray'}`;
function emptyHint(t: ReturnType<typeof useT>, fine: boolean) {
  const [a, b] = t('fld.empty', { icon: '\u0000', drag: fine ? t('fld.emptyDrag') : '' }).split('\u0000');
  return <>{a}<Icon n="folder" sm />{b}</>;
}

export function FolderSection({ folders, threads, row, onChanged, setFolders }: {
  folders: FolderView[]; threads: ThreadLite[]; row: (t: ThreadLite) => ReactNode; onChanged: () => void; setFolders: (f: FolderView[]) => void;
}) {
  const t = useFT();
  const [edit, setEdit] = useState<FolderView | 'new' | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [delAsk, setDelAsk] = useState<FolderView | null>(null);
  const [pm, setPm] = useState<FolderView | null>(null);
  const none = folders.length === 0;
  const [card, setCard] = useState<'on' | 'leaving' | 'off'>(none ? 'on' : 'off');
  useEffect(() => {
    if (none) { setCard('on'); return; }
    setCard((c) => (c === 'on' ? 'leaving' : c));
    const id = window.setTimeout(() => setCard('off'), 300);
    return () => window.clearTimeout(id);
  }, [none]);
  const toggle = (f: FolderView) => {
    setFolders(folders.map((x) => (x.id === f.id ? { ...x, collapsed: !x.collapsed } : x)));
    void fetch(`/api/folders/${f.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collapsed: !f.collapsed }) }).catch(() => {});
  };
  const del = async (f: FolderView) => {
    const r = await fetch(`/api/folders/${f.id}`, { method: 'DELETE' }).catch(() => null);
    if (!r?.ok) toast(t('fld.errDelete'), 'error');
    setDelAsk(null);
    onChanged();
  };
  const drop = async (e: React.DragEvent, f: FolderView) => {
    e.preventDefault(); setOver(null);
    const id = e.dataTransfer.getData(DRAG);
    if (id && await moveThreads([id], f.id)) onChanged();
  };
  return (
    <section className="fld" aria-label={t('fld.projects')} data-testid="folders">
      <div className="grp fld-grp"><span>{t('fld.projects')}</span>
        <button type="button" className="icon-btn fld-add" aria-label={t('fld.new')} title={t('fld.new')} onClick={() => setEdit('new')} data-testid="folder-new"><Icon n="plus" sm /></button>
      </div>
      {card !== 'off' && (
        <div className={`fld-card${card === 'leaving' ? ' is-leaving' : ''}`} data-testid="folders-empty" aria-hidden={card === 'leaving' ? true : undefined}>
          <div className="fld-card-in"><div className="fld-card-box">
            <div className="fld-card-row">
              {}
              <svg className="fld-art" viewBox="0 0 40 40" width="40" height="40" aria-hidden="true" focusable="false">
                <rect className="fa-b" x="4.5" y="4.5" width="22" height="22" rx="5.5" />
                <rect className="fa-a" x="13.5" y="13.5" width="22" height="22" rx="5.5" />
              </svg>
              <p className="fld-card-t">{t('fld.card')}</p>
            </div>
            <button type="button" className="fld-card-btn" onClick={() => setEdit('new')} tabIndex={card === 'leaving' ? -1 : undefined} data-testid="folder-new-card"><Icon n="plus" sm /><span>{t('fld.new')}</span></button>
          </div></div>
        </div>
      )}
      {folders.map((f) => {
        const items = threads.filter((t) => t.folderId === f.id);
        const busy = items.some((t) => t.busy), unread = items.some((t) => t.unread);
        return (
          <div key={f.id} className={`fld-item${f.collapsed ? '' : ' is-open'}${over === f.id ? ' is-over' : ''}`} data-testid="folder"
            onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG)) { e.preventDefault(); setOver(f.id); } }} onDragLeave={() => setOver((o) => (o === f.id ? null : o))} onDrop={(e) => void drop(e, f)}>
            <div className="nav-row">
              <button type="button" className="nav fld-head" aria-expanded={!f.collapsed} onClick={() => toggle(f)} data-testid="folder-head">
                <Icon n="folder" sm className={`fld-ic ${colorClass(f.color)}`} /><span className="nav-t">{f.name}</span>
                {f.collapsed && busy ? <i className="nav-busy" aria-label={t('shell.busy')} /> : f.collapsed && unread ? <i className="nav-dot" aria-label={t('shell.unread')} /> : <span className="fld-n tnum">{items.length || f.count || ''}</span>}
                <Icon n="chev-right" sm className="fld-chev" />
              </button>
              <span className="nav-acts">
                <button type="button" className="icon-btn"  aria-label={t('fld.configNamed', { name: f.name })} title={t('fld.config')} onClick={() => setEdit(f)} data-testid="folder-edit"><Icon n="edit" sm /></button>
                <button type="button" className="icon-btn"  aria-label={t('fld.delNamed', { name: f.name })} title={t('fld.delTitle')} onClick={() => setDelAsk(f)} data-testid="folder-del"><Icon n="trash" sm /></button>
              </span>
              <button type="button" className="icon-btn nav-more" aria-label={t('fld.actionsNamed', { name: f.name })} aria-haspopup="dialog" onClick={() => { haptic(); setPm(f); }} data-testid="folder-more"><Icon n="more" /></button>
            </div>
            {!f.collapsed && (
              <div className="fld-body">
                {items.length ? items.map((t) => row(t)) : <p className="fld-none">{emptyHint(t, typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches)}</p>}
              </div>
            )}
          </div>
        );
      })}
      <ProjectDialog edit={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onChanged(); }} />
      <ProjectShell open={!!pm} onClose={() => setPm(null)} label={pm?.name ?? ''} testId="folder-menu">
        {pm && (<>
          <h2 className="pj-eyebrow ca-head" id="pj-label"><span className="ca-t">{pm.name}</span></h2>
          <div className="ca-list" role="menu">
            <button type="button" role="menuitem" className="ca-item" onClick={() => { const f = pm; setPm(null); setEdit(f); }} data-testid="folder-act-config"><Icon n="edit" /><span>{t('fld.config')}</span></button>
            <button type="button" role="menuitem" className="ca-item ca-danger" onClick={() => { const f = pm; setPm(null); setDelAsk(f); }} data-testid="folder-act-del"><Icon n="trash" /><span>{t('fld.delTitle')}</span></button>
          </div>
        </>)}
      </ProjectShell>
      <ProjectShell open={!!delAsk} onClose={() => setDelAsk(null)} label={delAsk ? t('fld.delAsk', { name: delAsk.name }) : ''} testId="folder-del-dlg"
        foot={<><Button kind="plain" onClick={() => setDelAsk(null)} testId="folder-del-cancel">{t('common.cancel')}</Button>
          <button type="button" className="k-btn k-btn--primary pj-danger" onClick={() => delAsk && void del(delAsk)} data-testid="folder-del-ok" data-autofocus=""><span>{t('fld.delTitle')}</span></button></>}>
        {delAsk && (<>
          <h2 className="pj-eyebrow" id="pj-label">{t('fld.delAsk', { name: delAsk.name })}</h2>
          <div className="pj-name" aria-hidden="true"><span className={`pj-dot is-static ${colorClass(delAsk.color)}`}><i /></span><span className="pj-title pj-title--ro">{delAsk.name}</span></div>
          <p className="pj-text">{t('fld.delText')}</p>
        </>)}
      </ProjectShell>
    </section>
  );
}

export function ProjectShell({ open, onClose, label, children, foot, testId, onEsc }: { open: boolean; onClose: () => void; label: string; children: ReactNode; foot?: ReactNode; testId?: string; onEsc?: () => boolean }) {
  const mobile = useIsMobile();
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const escRef = useRef(onEsc); escRef.current = onEsc;
  useEffect(() => {
    if (!open) return;
    const back = document.activeElement as HTMLElement | null;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); if (!escRef.current?.()) closeRef.current(); return; }
      if (e.key === 'Tab' && box.current) {
        const f = [...box.current.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, [tabindex="0"]')].filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        const i = f.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', key);
    const id = requestAnimationFrame(() => (box.current?.querySelector<HTMLElement>('[data-autofocus]') ?? box.current?.querySelector<HTMLElement>('.pj-f button:last-child'))?.focus({ preventScroll: true }));
    return () => { document.removeEventListener('keydown', key); cancelAnimationFrame(id); if (back && document.contains(back)) back.focus({ preventScroll: true }); };
  }, [open]);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className={`pj-scrim${mobile ? ' is-sheet' : ''}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pj" role="dialog" aria-modal="true" aria-labelledby="pj-label" ref={box} data-testid={testId}>
        {mobile && <i className="pj-grab" aria-hidden="true" />}
        <div className={`pj-b${foot ? '' : ' pj-b--bare'}`}>{children}</div>
        {foot && <div className="pj-f">{foot}</div>}
      </div>
    </div>,
    document.body,
  );
}

function AutoArea({ value, onChange, placeholder, testId, autoFocus, maxLength }: { value: string; onChange: (v: string) => void; placeholder: string; testId?: string; autoFocus?: boolean; maxLength?: number }) {
  const t = useFT();
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { const el = ref.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${Math.min(240, el.scrollHeight)}px`; }, [value]);
  useEffect(() => { if (autoFocus) ref.current?.focus({ preventScroll: true }); }, [autoFocus]);
  return <textarea ref={ref} className="pj-area" rows={2} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} maxLength={maxLength} data-testid={testId} aria-label={t('fld.instr')} />;
}

export function ProjectDialog({ edit, onClose, onSaved, onCreated }: { edit: FolderView | 'new' | null; onClose: () => void; onSaved: () => void; onCreated?: (f: FolderView) => void }) {
  const t = useFT();
  const orgMode = useOrgMode();
  const [name, setName] = useState('');
  const [instr, setInstr] = useState('');
  const [color, setColor] = useState('');
  const [palette, setPalette] = useState(false);
  const [showInstr, setShowInstr] = useState(false);
  const [why, setWhy] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!edit) return;
    const f = edit === 'new' ? null : edit;
    setName(f?.name ?? ''); setInstr(f?.instruction ?? ''); setColor(f?.color ?? ''); setPalette(false); setWhy(false); setShowInstr(!!f?.instruction);
  }, [edit]);
  const isNew = edit === 'new';
  const save = async () => {
    if (!name.trim() || !edit || busy) return;
    setBusy(true);
    try {
      if (edit === 'new') { const f = await createFolder(name.trim(), instr, color); if (f) { onCreated?.(f); onSaved(); } }
      else {
        const r = await fetch(`/api/folders/${edit.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), instruction: instr, color }) }).catch(() => null);
        if (!r?.ok) { const j = await r?.json().catch(() => null) as { error?: string } | null; toast(j?.error ? errText(t.lang, j.error) : t('fld.errSave'), 'error'); } else onSaved();
      }
    } finally { setBusy(false); }
  };
  const label = isNew ? t('fld.new') : t('fld.config');
  const dot = useRef<HTMLButtonElement>(null);
  return (
    <ProjectShell open={!!edit} onClose={onClose} label={label} testId="folder-sheet" onEsc={() => { if (!palette) return false; setPalette(false); dot.current?.focus(); return true; }}
      foot={<><Button kind="plain" onClick={onClose} testId="folder-cancel">{t('common.cancel')}</Button>
        <Button kind="primary" onClick={() => void save()} disabled={!name.trim()} busy={busy} testId="folder-save" label={!name.trim() ? t('fld.typeName', { action: isNew ? t('fld.create') : t('common.save') }) : undefined}>{isNew ? t('fld.create') : t('common.save')}</Button></>}>
      <h2 className="pj-eyebrow" id="pj-label">{label}</h2>
      <div className="pj-name">
        <button type="button" ref={dot} className={`pj-dot ${colorClass(color)}`} aria-label={t('fld.colorNamed', { name: t(PROJECT_COLORS.find((c) => c.id === color)?.name ?? 'fld.c.gray') })} aria-expanded={palette}
          onClick={() => setPalette((v) => !v)} data-testid="folder-color"><i /></button>
        <input className="pj-title" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('fld.name')} maxLength={80} aria-label={t('fld.name')} data-autofocus=""
          enterKeyHint={isNew ? 'done' : 'done'} data-testid="folder-name" onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void save(); } }} />
      </div>
      {palette && (
        <div className="pj-pal" role="radiogroup" aria-label={t('fld.color')} data-testid="folder-palette">
          {PROJECT_COLORS.map((c) => (
            <button key={c.id || 'gray'} type="button" role="radio" aria-checked={color === c.id} aria-label={t(c.name)} title={t(c.name)} className={`pj-sw ${colorClass(c.id)}${color === c.id ? ' is-on' : ''}`}
              onClick={() => { setColor(c.id); setPalette(false); requestAnimationFrame(() => dot.current?.focus({ preventScroll: true })); }}><i /></button>
          ))}
        </div>
      )}
      {showInstr ? (
        <div className="pj-field"><span className="pj-lab" aria-hidden="true">{t('fld.instr')}</span>
          <AutoArea value={instr} onChange={setInstr} placeholder={t('fld.instrPh')} maxLength={8000} testId="folder-instr" autoFocus={!instr} /></div>
      ) : (
        <button type="button" className="pj-more" onClick={() => setShowInstr(true)} data-testid="folder-instr-open"><Icon n="plus" sm />{t('fld.instr')}</button>
      )}
      {orgMode && edit && edit !== 'new' && <OrgInbox folderId={edit.id} />}
      <div className="pj-note">
        <button type="button" className="pj-info" aria-expanded={why} onClick={() => setWhy((v) => !v)} data-testid="folder-why"
          title={t('fld.visibleWhy')}>
          <span className="pj-i" aria-hidden="true">i</span>{t('fld.visible')}</button>
        {why && <p className="pj-why">{t('fld.visibleWhy')}</p>}
      </div>
    </ProjectShell>
  );
}

export function MoveButton({ t, folders, onMoved }: { t: ThreadLite; folders: FolderView[]; onMoved: () => void }) {
  const tx = useFT();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const go = async (id: string | null) => { setOpen(false); if (await moveThreads([t.id], id)) onMoved(); };
  return (
    <>
      <button ref={btn} type="button" className="icon-btn" aria-label={tx('fld.move')} title={tx('fld.move')} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} data-testid="move-btn"><Icon n="folder" sm /></button>
      <Popover anchor={btn.current} open={open} onClose={() => setOpen(false)} side="bottom" align="right" title={tx('fld.move')} sub={t.title} className="fld-pop" testId="move-pop">
        <div className="fld-menu">
          {folders.map((f) => (
            <button key={f.id} type="button" aria-pressed={t.folderId === f.id} className="fld-mi" onClick={() => void go(f.id)} disabled={t.folderId === f.id} data-testid="move-to">
              <Icon n="folder" sm className={`fld-ic ${colorClass(f.color)}`} /><span>{f.name}</span>{t.folderId === f.id && <Icon n="check" sm className="fld-mi-on" />}
            </button>
          ))}
          <button type="button" className="fld-mi" onClick={() => { setOpen(false); setCreating(true); }} data-testid="move-new"><Icon n="plus" sm /><span>{tx('fld.newDots')}</span></button>
          {t.folderId && <button type="button" className="fld-mi" onClick={() => void go(null)} data-testid="move-out"><Icon n="x" sm /><span>{tx('fld.moveOut')}</span></button>}
        </div>
      </Popover>
      <ProjectDialog edit={creating ? 'new' : null} onClose={() => setCreating(false)} onSaved={() => setCreating(false)} onCreated={(f) => void moveThreads([t.id], f.id).then((ok) => ok && onMoved())} />
    </>
  );
}

export const dragThread = (e: React.DragEvent, id: string) => { e.dataTransfer.setData(DRAG, id); e.dataTransfer.effectAllowed = 'move'; };
