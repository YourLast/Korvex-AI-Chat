'use client';
import { WeekLine } from './SeatNotices';
import { Fragment, forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { isImage, type FileChip } from '@/lib/types';
import { useT } from '@/lib/i18n/react';
import { errText } from '@/lib/i18n/errors';
import { prepImage } from '@/lib/imgprep';
import { Batch, collectDropped, fromFileList, filterPicked, planBatches, type Picked, type SkipRec } from '@/lib/upload/queue';
import { archiveKind, dirName, rootOf } from '@/lib/upload/paths';
import { Icon } from './Icon';
import { useVoice } from './useVoice';
import { VoiceStrip } from './VoiceStrip';
import { WordReveal } from './WordReveal';
import { REVEAL_MAX_WORDS, REVEAL_MAX_WORDS_TOUCH, holdProgress, joinText, readAutoSend, revealFrom, revealPlan } from '@/lib/voiceLogic';
import { thumbSrc } from './OutImage';
import { UpRow, type Up } from './UpRow';
import { UploadCard } from './UploadCard';
import { holdState, heldFiles, failedNote, fileErrKind, type FileErrKind, type Hold } from '@/lib/sendHold';
import type { HeldView } from './HeldTurn';
import { useFeatures } from './FeaturesCtx';
import { FootNote } from './FootNote';
import { newPid, pollProgress } from '@/lib/upload/progress';

export type ComposerHandle = { focus: () => void; setText: (t: string) => void;  cancelHold: (id: string) => void;
   addFiles: (chips: FileChip[]) => void;
   pick: () => void };
export type ComposerEdit = { id: string; text: string; files: FileChip[] };

export function editLine(e: ComposerEdit): string {
  const t = e.text.replace(/\s+/g, ' ').trim();
  return t || e.files.map((f) => f.name).join(', ');
}
const editUp = (f: FileChip): Up => ({ tmp: `e-${f.id}`, name: f.name, size: f.size, status: 'ready', chip: f, edit: true, img: isImage(f), preview: isImage(f) ? thumbSrc(`/api/files/${f.id}`, 480) : undefined });
const dropPreview = (u: Up) => { if (u.preview?.startsWith('blob:')) URL.revokeObjectURL(u.preview); };

const LINE = 24;

export const Composer = forwardRef<ComposerHandle, {
  busy: boolean; placeholder: string; modelSlot: ReactNode; onStop: () => void;
  docsSlot?: ReactNode;
  onSend: (text: string, files: FileChip[], opts?: { holdId?: string }) => void | boolean | Promise<boolean | void>; footNote?: string; acceptImages?: boolean;
  modelId?: string;
  overlay?: ReactNode;
  onSteer?: (text: string) => Promise<boolean>;
  edit?: ComposerEdit | null;
  onEditCancel?: () => void;
  attach?: boolean;
  label?: string;
  onHolds?: (h: HeldView[]) => void;
}>(function Composer({ busy, placeholder, modelSlot, docsSlot, onStop, onSend, footNote, acceptImages = true, modelId, overlay, onSteer, edit = null, onEditCancel, attach = true, label, onHolds }, ref) {
  const feat = useFeatures();
  const canAttach = attach && feat.files;
  const tx = useT();
  const [text, setText] = useState('');
  const [ups, setUps] = useState<Up[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [tick, setTick] = useState(0);
  const [holds, setHolds] = useState<Hold[]>([]);
  const [err, setErr] = useState('');
  const [reveal, setReveal] = useState<{ full: string; from: number; reduced: boolean; max: number } | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const folderIn = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const editing = !!edit;
  const editR = useRef(editing); editR.current = editing;

  useImperativeHandle(ref, () => ({ focus: () => ta.current?.focus(), setText, pick: () => fileIn.current?.click(), cancelHold: (id) => cancelHoldR.current(id),
    addFiles: (chips) => setUps((u) => [...u, ...chips.filter((c) => !u.some((x) => x.chip?.id === c.id)).map((c): Up => ({ tmp: `doc-${c.id}`, name: c.name, size: c.size, status: 'ready', chip: c, img: isImage(c) }))]) }), []);

  const saved = useRef<string | null>(null);
  const [caret, setCaret] = useState(0);
  const editKey = edit?.id ?? null;
  useLayoutEffect(() => {
    if (edit) {
      if (saved.current === null) saved.current = text;
      setText(edit.text); setReveal(null); setErr('');
      setUps((u) => { u.filter((x) => x.edit).forEach(dropPreview); return [...u.filter((x) => !x.edit), ...edit.files.map(editUp)]; });
      setCaret((c) => c + 1);
    } else if (saved.current !== null) {
      const d = saved.current;
      saved.current = null;
      setText(d); setReveal(null); setErr('');
      setUps((u) => { u.filter((x) => x.edit).forEach(dropPreview); return u.filter((x) => !x.edit); });
    }
  }, [editKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = ta.current;
    if (!caret || !el) return;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
    el.scrollTop = el.scrollHeight;
  }, [caret]);
  const cancelR = useRef(onEditCancel); cancelR.current = onEditCancel;

  const dock = useRef<HTMLDivElement>(null);
  const fit = useCallback(() => {
    const el = ta.current, d = dock.current;
    if (!el || !d) return;
    const atEnd = document.activeElement === el && el.scrollHeight > el.clientHeight && el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
    el.style.height = 'auto';
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const rest = d.offsetHeight - el.offsetHeight;
    const cs = editR.current ? getComputedStyle(el) : null;
    const floor = cs ? LINE * 2 + (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) : LINE * 2;
    const cap = Math.max(floor, Math.floor(vh * 0.4) - rest);
    el.style.height = Math.min(el.scrollHeight, cap) + 'px';
    if (atEnd) el.scrollTop = el.scrollHeight;
  }, []);
  const noteN = ups.filter((u) => u.img && u.status === 'error' && !!u.edit === editing).length;
  useLayoutEffect(fit, [fit, text, ups.length, err, editing, noteN]);
  useEffect(() => {
    const vv = window.visualViewport;
    window.addEventListener('resize', fit); vv?.addEventListener('resize', fit);
    return () => { window.removeEventListener('resize', fit); vv?.removeEventListener('resize', fit); };
  }, [fit]);

  useEffect(() => {
    const off = [...batches, ...holds.flatMap((h) => h.batches)].map((b) => b.subscribe(() => setTick((t) => t + 1)));
    return () => off.forEach((f) => f());
  }, [batches, holds]);

  const mkBatch = useCallback((kind: 'folder' | 'files' | 'zip', label: string) => {
    const b = new Batch(kind, label, { fetch: (...a) => fetch(...a), modelId, errText: (e) => errText(tx.lang, e) });
    setBatches((x) => [...x, b]);
    return b;
  }, [modelId, tx.lang]);

  const patchUp = useCallback((tmp: string, f: (x: Up) => Up) => {
    const m = (list: Up[]) => (list.some((x) => x.tmp === tmp) ? list.map((x) => (x.tmp === tmp ? f(x) : x)) : list);
    setUps(m);
    setHolds((hs) => (hs.some((h) => h.ups.some((x) => x.tmp === tmp)) ? hs.map((h) => ({ ...h, ups: m(h.ups) })) : hs));
  }, []);

  const upload = useCallback(async (list: FileList | File[] | Picked[]) => {
    setErr('');
    const raw: Picked[] = Array.from(list as ArrayLike<File | Picked>).map((x) => ('file' in x && 'path' in x ? x : fromFileList([x as File])[0]));
    const { archives, folders, loose } = planBatches(raw);
    const { keep: keepAll, skipped } = filterPicked([...archives, ...[...folders.values()].flat(), ...(loose.length > 12 ? loose : [])]);
    const keepSet = new Set(keepAll.map((k) => k.file));
    const skipBy = (root: string | null): SkipRec[] => skipped.filter((k) => rootOf(k.path) === root);
    for (const a of archives) { if (keepSet.has(a.file)) void mkBatch('zip', a.file.name).unpack(a.file); }
    for (const [root, items] of folders) {
      const ok = items.filter((x) => keepSet.has(x.file)).map((x) => ({ ...x, path: keepAll.find((k) => k.file === x.file)?.path ?? x.path }));
      if (!ok.length && !skipBy(root).length) continue;
      const b = mkBatch('folder', root);
      const inner = ok.filter((x) => archiveKind(x.file.name));
      b.addPicked(ok.filter((x) => !archiveKind(x.file.name)), skipBy(root));
      void b.start();
      for (const a of inner) void b.unpack(a.file, dirName(a.path));
    }
    let single = loose;
    if (loose.length > 12) {
      const b = mkBatch('files', '');
      b.addPicked(keepAll.filter((k) => loose.some((l) => l.file === k.file)), skipBy(null));
      void b.start();
      single = [];
    }
    const items = single.map((x) => ({ f0: x.file, tmp: Math.random().toString(36).slice(2), isImg: x.file.type.startsWith('image/') })).filter((x) => {
      if (x.isImg && !acceptImages) { setErr(tx('comp.noImages')); return false; }
      return true;
    });
    if (items.length) setUps((u) => [...u, ...items.map((x) => ({ tmp: x.tmp, name: x.f0.name || 'image', size: x.f0.size, status: 'uploading' as const, started: false, img: x.isImg, edit: editR.current || undefined }))]);
    for (const { f0, tmp, isImg } of items) {
      patchUp(tmp, (x) => ({ ...x, started: true }));
      try {
        const fd = new FormData();
        let preview: string | undefined;
        if (isImg) {
          const p = await prepImage(f0);
          preview = URL.createObjectURL(p.blob);
          fd.append('file', p.blob, p.name); fd.append('w', String(p.w)); fd.append('h', String(p.h));
          patchUp(tmp, (x) => ({ ...x, name: p.name, size: p.blob.size, preview, w: p.w, h: p.h }));
        } else { fd.append('file', f0); if (modelId) fd.append('model', modelId); }
        let stopProg: (() => void) | null = null;
        if (!isImg) { const pid = newPid(); fd.append('pid', pid); stopProg = pollProgress(pid, (p) => patchUp(tmp, (x) => (x.status === 'uploading' ? { ...x, prog: p } : x))); }
        let kind: FileErrKind = 'net';
        try {
          const r = await fetch('/api/files', { method: 'POST', body: fd }).catch((e) => { stopProg?.(); throw e; });
          const j = await r.json().catch(() => ({} as { error?: string })).finally(() => stopProg?.());
          if (!r.ok || j.error) { kind = fileErrKind(r.status, String(j.error ?? '')); throw new Error(j.error ? errText(tx.lang, j.error) : `HTTP ${r.status}`); }
          patchUp(tmp, (x) => ({ ...x, status: 'ready', chip: { id: j.id, name: j.name, size: j.size, mime: j.mime, tokens: j.tokens, info: j.info } }));
        } catch (e) {
          patchUp(tmp, (x) => ({ ...x, status: 'error', error: (e as Error).message, errKind: kind }));
        }
      } catch (e) {
        patchUp(tmp, (x) => ({ ...x, status: 'error', error: (e as Error).message, errKind: 'other' }));
      }
    }
  }, [acceptImages, modelId, tx, mkBatch, patchUp]);

  const [drag, setDrag] = useState(false);
  useEffect(() => {
    if (!canAttach) return;
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depth++; setDrag(true); } };
    const leave = (e: DragEvent) => { if (hasFiles(e) && --depth <= 0) { depth = 0; setDrag(false); } };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; setDrag(false);
      if (e.dataTransfer) void collectDropped(e.dataTransfer).then((l) => { if (l.length) void upload(l); });
    };
    window.addEventListener('dragenter', enter); window.addEventListener('dragleave', leave); window.addEventListener('dragover', over); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragleave', leave); window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
  }, [upload, canAttach]);

  const shown = ups.filter((u) => !!u.edit === editing);
  const shownBatches = editing ? [] : batches;
  const ready = [...shown.filter((u) => u.status === 'ready').map((u) => u.chip!), ...shownBatches.flatMap((b) => b.chips())];
  const uploading = shown.some((u) => u.status === 'uploading') || shownBatches.some((b) => b.busy);

  const st = useRef({ text, ready, busy, uploading, editing }); st.current = { text, ready, busy, uploading, editing };
  const landed = useRef(false);
  const onHeard = useCallback((heard: string) => {
    const { text: t0, ready: r0, busy: b0, uploading: u0, editing: e0 } = st.current;
    const full = joinText(t0, heard);
    let auto = false;
    try { auto = readAutoSend((k) => localStorage.getItem(k)); } catch {  }
    if (auto && !b0 && !u0 && !e0) { onSend(full, r0); setText(''); setUps([]); setBatches([]); return; }
    setText(full);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches, from = revealFrom(full, t0);
    const max = window.matchMedia('(pointer: coarse)').matches ? REVEAL_MAX_WORDS_TOUCH : REVEAL_MAX_WORDS;
    if (revealPlan(full, from, reduced, max).count > 0) setReveal({ full, from, reduced, max });
    landed.current = true;
  }, [onSend]);
  const v = useVoice({ onHeard, getHeight: () => box.current?.offsetHeight ?? 0 });
  const audioIn = useRef<HTMLInputElement>(null);
  const voice = v.phase !== 'idle';
  const revealing = !!reveal && reveal.full === text && !voice;
  useEffect(() => { if (voice) setReveal(null); }, [voice]);
  const tap = voice && v.mode === 'tap';
  const held = voice && v.mode !== 'tap' && v.phase !== 'stt';
  const voiceR = useRef(voice); voiceR.current = voice;
  useEffect(() => {
    if (!editing) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || voiceR.current) return;
      if (document.querySelector('.pop, .sheet, .scrim, .dlg-scrim, .iv, .k-dlg, .k-alert')) return;
      e.preventDefault();
      cancelR.current?.();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [editing]);

  const canSend = !busy && (!uploading || !editing) && !voice && (text.trim().length > 0 || ready.length > 0 || (uploading && !editing));
  const steering = busy && !!onSteer && !voice && !editing;
  const canSteer = steering && !uploading && text.trim().length > 0 && ready.length === 0;
  const [steerBusy, setSteerBusy] = useState(false);

  const prevPhase = useRef(v.phase);
  useEffect(() => {
    const p0 = prevPhase.current; prevPhase.current = v.phase;
    const a = document.activeElement, lost = !a || a === document.body;
    if (v.phase === 'rec' && v.mode === 'tap' && v.byKey) box.current?.querySelector<HTMLElement>('[data-testid=rec-done]')?.focus();
    else if (v.phase === 'idle' && p0 !== 'idle' && lost && !window.matchMedia('(pointer: coarse)').matches) box.current?.querySelector<HTMLElement>('[data-testid=mic]')?.focus();
  }, [v.phase, v.mode, v.byKey]);
  useLayoutEffect(() => { if (!voice) fit(); }, [voice, fit]);
  useLayoutEffect(() => {
    if (!landed.current || voice) return;
    const el = ta.current;
    if (!el) return;
    landed.current = false;
    if (!window.matchMedia('(pointer: coarse)').matches) el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.scrollTop = el.scrollHeight;
  }, [text, voice]);

  const gate = useRef(false);
  const cancelHoldR = useRef<(id: string) => void>(() => {});
  cancelHoldR.current = (id) => {
    const h = holds.find((x) => x.id === id);
    if (!h) return;
    setHolds((hs) => hs.filter((x) => x.id !== id));
    setText((cur) => (cur.trim() && h.text.trim() ? `${h.text}\n${cur}` : cur.trim() ? cur : h.text));
    setUps((cur) => [...h.ups, ...cur]);
    setBatches((cur) => [...h.batches, ...cur]);
  };
  useEffect(() => {
    const h = holds[0];
    if (!h || h.sending || busy || editing || gate.current) return;
    const st = holdState(h);
    if (!st.settled) return;
    const note = failedNote(st.failed, tx('hold.failedHead'), (n) => tx('hold.failedMore', { n }));
    if (!st.chips.length && !h.text.trim()) {
      setHolds((hs) => hs.filter((x) => x.id !== h.id));
      if (note) setErr(note.replace(tx('hold.failedHead'), tx('hold.allFailed')));
      return;
    }
    const body = note ? (h.text.trim() ? `${h.text}\n\n${note}` : note) : h.text;
    gate.current = true;
    setHolds((hs) => hs.map((x) => (x.id === h.id ? { ...x, sending: true } : x)));
    void Promise.resolve(onSend(body, st.chips, { holdId: h.id })).then((ok) => {
      if (ok === false) { setText((cur) => cur || h.text); setUps((cur) => [...h.ups, ...cur]); setBatches((cur) => [...h.batches, ...cur]); }
    }).finally(() => { setHolds((hs) => hs.filter((x) => x.id !== h.id)); gate.current = false; setTick((t) => t + 1); });
  }, [holds, busy, editing, tick, onSend, tx]);
  useEffect(() => {
    onHolds?.(holds.map((h) => { const st = holdState(h); return { id: h.id, text: h.text, done: st.ready, total: st.total, failed: st.failed.length, unpacking: st.unpacking, files: heldFiles(h), at: h.at, sending: h.sending }; }));
  }, [holds, tick, onHolds]);
  useEffect(() => () => { onHolds?.([]); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (canSteer && !steerBusy) {
      const t = text;
      setSteerBusy(true); setText(''); setReveal(null);
      void onSteer!(t).then((ok) => { if (!ok) setText((cur) => cur || t); }).finally(() => setSteerBusy(false));
      return;
    }
    if (!canSend) return;
    if (editing) {
      void onSend(text, ready);
      return;
    }
    if (uploading) {
      setHolds((hs) => [...hs, { id: Math.random().toString(36).slice(2), text, ups: ups.filter((u) => !u.edit), batches, at: Date.now() }]);
      setText(''); setReveal(null); setUps((cur) => cur.filter((u) => u.edit)); setBatches([]);
      return;
    }
    const t0 = text, u0 = ups, b0 = batches;
    const r = onSend(text, ready);
    setText(''); setReveal(null);
    setUps([]); setBatches([]);
    void Promise.resolve(r).then((ok) => { if (ok === false) { setText((cur) => cur || t0); setUps((cur) => (cur.length ? cur : u0)); setBatches((cur) => (cur.length ? cur : b0)); } });
  };

  return (
    <div className="dock" ref={dock} data-testid="dock" data-editing={editing || undefined}>
      {overlay}
      {drag && <div className="drop-zone" data-testid="drop-zone"><Icon n="clip" /><span>{tx('files.dropAll')}</span></div>}
      {v.err && (
        <div className="err-box vx-err" role="alert" data-testid="voice-err" data-kind={v.err.kind}>
          <Icon n="alert" sm />
          <span className="vx-err-t"><b>{v.err.title}</b>{v.err.hint && <small>{v.err.hint}</small>}</span>
          {v.err.action === 'file' ? (
            <button type="button" className="btn vx-err-act" data-testid="voice-file" onClick={() => audioIn.current?.click()}>
              <Icon n="clip" sm />{tx('comp.voiceFile')}
            </button>
          ) : v.err.action && (
            <button type="button" className="btn vx-err-act" data-testid="voice-retry" onClick={() => { const a = v.err!.action as 'record' | 'resend'; v.retry(a); }}>
              <Icon n={v.err.action === 'resend' ? 'retry' : 'mic'} sm />{v.err.action === 'resend' ? tx('comp.resend') : tx('comp.rerecord')}
            </button>
          )}
          {}
          {v.err.action === 'file' && <input ref={audioIn} type="file" hidden accept="audio/*,.mp3,.m4a,.ogg,.opus,.oga,.wav,.webm,.flac,.aac,.amr" data-testid="voice-file-input" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) v.sendFile(f); }} />}
          <button type="button" className="icon-btn vx-err-x" aria-label={tx('common.close')} onClick={() => v.setErr(null)}><Icon n="x" sm /></button>
        </div>
      )}
      {editing && (
        <div className="edit-plate" data-testid="edit-plate">
          <Icon n="edit" sm />
          <span className="edit-plate-t"><b>{tx('comp.editing')}</b><span className="edit-plate-src" data-testid="edit-src">{editLine(edit!)}</span></span>
          <button type="button" className="icon-btn edit-plate-x" aria-label={tx('comp.editCancel')} data-testid="edit-cancel" onClick={() => onEditCancel?.()}><Icon n="x" sm /></button>
        </div>
      )}
      {shownBatches.length > 0 && (
        <div className="ucard-stack" data-testid="upload-cards">
          {shownBatches.map((b) => <UploadCard key={b.id} batch={b} onRemove={() => { b.dispose(); setBatches((x) => x.filter((y) => y !== b)); }} />)}
        </div>
      )}
      <UpRow items={shown} onRemove={(u) => { dropPreview(u); setUps((x) => x.filter((y) => y.tmp !== u.tmp)); }} />
      {err && <div className="err-box" role="alert"><Icon n="alert" sm /><span>{err}</span></div>}
      <WeekLine />
      <div className={`composer${voice ? ' composer--voice' : ''}`} ref={box} style={voice && v.lockH ? { height: v.lockH } : undefined}>
        {voice ? <VoiceStrip v={v} /> : (
          <div className="ta-wrap">
          <textarea
            ref={ta}
            rows={1}
            value={text}
            placeholder={steering ? tx('comp.steerPh') : placeholder}
            aria-label={editing ? tx('msg.editMsg') : label ?? tx('comp.message')}
            data-testid="composer-input"
            className={revealing ? 'is-reveal' : undefined}
            onChange={(e) => { setText(e.target.value); setReveal(null); landed.current = false; }}
            onPaste={(e) => { if (canAttach && e.clipboardData.files.length) { e.preventDefault(); void upload(e.clipboardData.files); } }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); submit(); }
            }}
          />
          {revealing && reveal && <WordReveal full={reveal.full} from={reveal.from} reduced={reveal.reduced} max={reveal.max} ta={ta} onDone={() => setReveal(null)} />}
          </div>
        )}
        <div className="composer-bar">
          {canAttach && <input key="file" ref={fileIn} type="file" hidden multiple data-testid="file-input" onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); e.target.value = ''; }} />}
          {canAttach && <input key="folder" ref={folderIn} type="file" hidden multiple {...({ webkitdirectory: '', directory: '' } as object)} data-testid="folder-input" onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); e.target.value = ''; }} />}
          {canAttach && !voice && <button key="clip" type="button" className="icon-btn" aria-label={tx('comp.attach')} onClick={() => fileIn.current?.click()}><Icon n="clip" /></button>}
          {canAttach && !voice && <button key="folder-btn" type="button" className="icon-btn up-folder-btn" aria-label={tx('files.pickFolder')} title={tx('files.pickFolder')} data-testid="pick-folder" onClick={() => folderIn.current?.click()}><Icon n="folder" /></button>}
          {canAttach && !voice && docsSlot && <Fragment key="docs">{docsSlot}</Fragment>}
          {!voice && <Fragment key="chip">{modelSlot}</Fragment>}
          {(tap || v.phase === 'stt') && (
            <button key="cancel" type="button" className="btn btn--ghost vx-btn vx-cancel" data-testid="rec-cancel" onClick={() => v.cancel()}><Icon n="x" sm />{tx('common.cancel')}</button>
          )}
          {held && v.mode === 'hold' && (
            <span key="slide" className="vx-slide" data-testid="rec-slide" style={{ transform: `translateX(${Math.round(v.dx * 0.6)}px)`, opacity: 1 - holdProgress(v.dx) * 0.75 }}>
              <Icon n="chev-right" sm className="vx-back" />{tx('comp.slideCancel')}
            </span>
          )}
          <span key="grow" className="grow" />
          {feat.voice && (!voice || held) && (
            <button key="mic" type="button" className={`icon-btn mic${held ? ' is-held' : ''}`} aria-label={held ? tx('comp.micRelease') : tx('comp.mic')}
              data-testid="mic" {...v.micProps}><Icon n="mic" /></button>
          )}
          {!voice && canSteer ? (
            <button key="steer" type="button" className="send" aria-label={tx('comp.sendAgent')} data-testid="steer-send" disabled={steerBusy} onClick={submit}><Icon n="arrow-up" /></button>
          ) : !voice && (busy ? (
            <button key="stop" type="button" className="send" aria-label={tx('comp.stop')} data-testid="stop" onClick={onStop}><Icon n="stop" /></button>
          ) : (
            <button key="send" type="button" className="send" aria-label={editing ? tx('comp.editSend') : tx('comp.send')} data-testid="send" data-edit={editing || undefined} disabled={!canSend} onClick={submit}><Icon n="arrow-up" /></button>
          ))}
          {tap && v.phase !== 'stt' && (
            <button key="done" type="button" className="btn btn--primary vx-btn vx-done" data-testid="rec-done" disabled={v.phase !== 'rec'} onClick={() => void v.finish()}><Icon n="check" sm />{tx('common.done')}</button>
          )}
        </div>
      </div>
      {footNote && <FootNote text={footNote} />}
    </div>
  );
});
