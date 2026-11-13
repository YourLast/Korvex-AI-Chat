'use client';
import Link from 'next/link';
import { genTokens } from '@/lib/genspeed';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isImage, type FileChip, type MsgView } from '@/lib/types';
import type { PublicModel } from '@/lib/models';
import { decimal, fmtBytes, fmtSec, hasMarker, stripMarker } from '@/lib/format';
import { tr, type Lang } from '@/lib/i18n/core';
import { errText } from '@/lib/i18n/errors';
import { useT } from '@/lib/i18n/react';
import { Icon } from './Icon';
import { useOrgMode } from './orgMode';
import { SaveLink } from './SaveLink';
import { Markdown, OutImage, thumbClick } from './Markdown';
import { thumbSet, thumbSrc } from './OutImage';
import { MemoryLine } from './Memory';
import { MemUpdated, type MemUpdItem } from './MemUpd';
import '@/styles/user-memory.css';
import type { ReactNode } from 'react';
import { ModelName, levelLabel } from './ModelPicker';
import { ModelMark } from './ModelMark';
import { Rate } from './Rate';
import { WorkFeed } from './WorkFeed';
import { HeadMark } from './HeadMark';
import { useWork } from './WorkCtx';
import { serverNow } from '@/lib/clock';
import { useIsAdmin } from './Shell';
import { QueueCard, ServeQueueCard } from './QueueCard';
import { FolderCard } from './FolderCard';
import { SrcCtx, SrcList } from './SrcChip';
import { sourcesOf, stripMarkers } from '@/lib/srcmark';
import { stripWebMarks, turnUrls } from '@/lib/webmark';
import { openFile } from '@/lib/fileView';
import { tokText, useFileTok } from '@/lib/fileTokens';
import { baseName, dirName, groupByFolder } from '@/lib/upload/paths';
import { BRAND_WORDS, OUT_PREFIX } from '@/ext/client';

export function userError(e: string, lang: Lang = 'ru'): string {
  if (/^\d{3}:/.test(e) || /[a-z]{4,}/i.test(e.replace(BRAND_WORDS, ''))) return tr(lang, 'msg.noReply');
  return errText(lang, e);
}

function useThrottled(v: string, ms: number, on: boolean) {
  const [t, setT] = useState(v);
  const last = useRef(0);
  useEffect(() => {
    if (!on) { setT(v); return; }
    const id = setTimeout(() => { last.current = Date.now(); setT(v); }, Math.max(0, ms - (Date.now() - last.current)));
    return () => clearTimeout(id);
  }, [v, on, ms]);
  return t;
}

export function speedText(m: Pick<MsgView, 'streaming' | 'liveGen' | 'meta'> & { steps?: MsgView['steps'] }, lang: Lang = 'ru'): string | null {
  const unit = tr(lang, 'unit.tokPerSec');
  const tps = !m.streaming ? (m.meta?.gen?.tps ?? null) : null;
  if (typeof tps === 'number' && tps > 0) return `${tps >= 10 ? Math.round(tps) : decimal(tps.toFixed(1), lang)} ${unit}`;
  if (m.steps?.some((s) => s.kind !== 'steer')) return null;
  const g = m.streaming ? m.liveGen : m.meta?.gen;
  if (!g || !(g.ms >= 800)) return null;
  const { n, exact } = genTokens(g, !m.streaming ? (m.meta?.gen?.tokens ?? null) : null);
  if (!(n >= 8)) return null;
  const v = n / (g.ms / 1000);
  return `${exact ? '' : '≈ '}${v >= 10 ? Math.round(v) : decimal(v.toFixed(1), lang)} ${unit}`;
}

function Live({ since }: { since: number }) {
  const lang = useT().lang;
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => { const t = setInterval(() => setNow(serverNow()), 500); return () => clearInterval(t); }, []);
  return <span className="tnum">{fmtSec(now - since, lang)}</span>;
}

export function FileCard({ f }: { f: FileChip }) {
  const tx = useT();
  const fmt = (f.info?.format as string | undefined) ?? '';
  const dir = dirName(f.name);
  const tok = useFileTok(f);
  const sub = [dir, fmtBytes(f.size, tx.lang), f.info?.pages ? tx(fmt === 'xlsx' ? 'msg.pagesSheets' : 'msg.pagesPages', { n: Number(f.info.pages) }) : '', tok ? tokText(tx.lang, tok) : ''].filter(Boolean).join(' · ');
  return (
    <button type="button" className="attach attach--open" title={f.name} aria-label={tx('files.openFile', { name: f.name })} data-testid="sent-file" onClick={() => openFile({ id: f.id, name: f.name })}>
      <span className="ficon"><Icon n={fmt === 'xlsx' || fmt === 'csv' ? 'table' : 'file-text'} /></span>
      <span className="fmeta"><b>{baseName(f.name)}</b><small>{sub}</small></span>
    </button>
  );
}

export function Versions({ s, onSwitch }: { s?: { ids: string[]; index: number }; onSwitch: (id: string) => void }) {
  const tx = useT();
  if (!s || s.ids.length < 2) return null;
  return (
    <span className="ver" data-testid="versions">
      <button type="button" className="icon-btn" aria-label={tx('msg.prevVer')} disabled={s.index === 0} onClick={() => onSwitch(s.ids[s.index - 1])}><Icon n="chev-right" sm className="flip" /></button>
      <span className="tnum">{s.index + 1}/{s.ids.length}</span>
      <button type="button" className="icon-btn" aria-label={tx('msg.nextVer')} disabled={s.index === s.ids.length - 1} onClick={() => onSwitch(s.ids[s.index + 1])}><Icon n="chev-right" sm /></button>
    </span>
  );
}

const LONG_CHARS = 3000;
const LONG_LINES = 40;

export function UserTurn({ m, busy, onEdit, onSwitch, onEditStart, marked }: { m: MsgView; busy?: boolean; onEdit?: (text: string) => void; onSwitch?: (id: string) => void; onEditStart?: () => void; marked?: boolean }) {
  const tx = useT();
  const text = stripMarker(m.content);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [copied, setCopied] = useState(false);
  const long = text.length > LONG_CHARS || text.split('\n').length > LONG_LINES;
  const [full, setFull] = useState(false);
  const real = !m.id.startsWith('u-');
  const fileLayout = useMemo(() => groupByFolder(m.files ?? []), [m.files]);
  return (
    <div className={`turn-user${marked ? ' is-edit-src' : ''}`} data-testid="user-msg" data-editing={marked || undefined} id={real ? `m-${m.id}` : undefined}>
      {m.auto && <span className="auto-tag" data-testid="auto-tag"><Icon n="repeat" sm />{tx('msg.auto', { name: m.auto.name })}</span>}
      {m.from && (
        <a className="auto-tag from-tag" href={`/c/${m.from.threadId}`} data-testid="from-tag">
          <Icon n="agents" sm />{tx(m.from.kind === 'agent' ? 'msg.fromAgent' : m.from.kind === 'reply' ? 'msg.fromReply' : 'msg.fromWritten', { title: m.from.title })}
        </a>
      )}
      {fileLayout.rest.some(isImage) && (
        <div className="img-row">
          {fileLayout.rest.filter(isImage).map((f) => (
            <button key={f.id} type="button" className="img-btn iv-thumb" data-iv="" data-iv-src={`/api/files/${f.id}`} data-iv-name={f.name} data-iv-size={fmtBytes(f.size, tx.lang)}
              data-iv-w={Number(f.info?.w) || undefined} data-iv-h={Number(f.info?.h) || undefined}
              aria-label={tx('msg.openImage', { name: f.name })} onClick={(e) => thumbClick(e, `/api/files/${f.id}`)}>
              {}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="img-thumb" src={thumbSrc(`/api/files/${f.id}`, 480)} srcSet={thumbSet(`/api/files/${f.id}`, [480, 960])} sizes="320px" alt={f.name} loading="lazy" decoding="async" data-testid="msg-image" />
            </button>
          ))}
        </div>
      )}
      {fileLayout.groups.map((g) => <FolderCard key={g.root} g={g} />)}
      {fileLayout.rest.filter((f) => !isImage(f)).map((f) => <FileCard key={f.id} f={f} />)}
      {editing ? (
        <div className="edit-box" data-testid="edit-box">
          <textarea value={draft} rows={Math.min(10, Math.max(2, draft.split('\n').length))} autoFocus aria-label={tx('msg.editMsg')} data-testid="edit-input" onChange={(e) => setDraft(e.target.value)} />
          <div className="edit-bar">
            <button type="button" className="btn" onClick={() => { setEditing(false); setDraft(text); }}>{tx('common.cancel')}</button>
            <button type="button" className="btn btn--primary" disabled={!draft.trim() || busy} data-testid="edit-send" onClick={() => { setEditing(false); onEdit?.(draft); }}>{tx('comp.send')}</button>
          </div>
        </div>
      ) : (
        text.trim() && (
          <>
            <div className={`bubble${long && !full ? ' is-clamped' : ''}`} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {hasMarker(m.content) && <Icon n="mic" sm className="voice-ic" />}{text}
            </div>
            {long && (
              <button type="button" className="bubble-more" data-testid="user-more" aria-expanded={full} onClick={() => setFull((x) => !x)}>
                {full ? tx('msg.collapse') : tx('msg.showFull', { n: text.length })}
              </button>
            )}
          </>
        )
      )}
      {!editing && real && (
        <div className="u-acts">
          {onSwitch && <Versions s={m.siblings} onSwitch={onSwitch} />}
          <button type="button" className="icon-btn" aria-label={tx('msg.copy')} onClick={() => { navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }); }}><Icon n={copied ? 'check' : 'copy'} sm /></button>
          {onEdit && <button type="button" className="icon-btn" aria-label={tx('msg.edit')} disabled={busy} data-testid="edit" onClick={() => { if (onEditStart) { onEditStart(); return; } setDraft(text); setEditing(true); }}><Icon n="edit" sm /></button>}
        </div>
      )}
    </div>
  );
}

export function sharedShots(m: Pick<MsgView, 'steps' | 'content'>): { url: string; name: string; size: string | null }[] {
  const out: { url: string; name: string; size: string | null }[] = [];
  for (const s of m.steps ?? []) for (const a of s.attachments ?? []) {
    if (a.kind !== 'image' || !a.url.startsWith(OUT_PREFIX) || (m.content ?? '').includes(a.url) || out.some((x) => x.url === a.url)) continue;
    out.push({ url: a.url, name: a.name, size: a.w && a.h ? `${a.w}×${a.h}` : null });
  }
  return out;
}
export function resultFiles(content: string): { url: string; name: string }[] {
  const esc = OUT_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const out: { url: string; name: string }[] = [];
  for (const m of content.matchAll(new RegExp(`${esc}[0-9a-f]{32}/[^\\s)\\]"'<>]+`, 'g'))) {
    const url = m[0].replace(/[.,;:!?]+$/, '');
    if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(url) || out.some((x) => x.url === url)) continue;
    let name = url.split('/').pop() ?? url;
    try { name = decodeURIComponent(name); } catch {  }
    out.push({ url, name });
  }
  return out;
}
function Results({ m }: { m: MsgView }) {
  const tx = useT();
  const org = useOrgMode();
  const list = useMemo(() => (org && !m.streaming ? resultFiles(m.content ?? '') : []), [org, m.streaming, m.content]);
  if (!list.length) return null;
  return (
    <div className="ans-results" data-testid="results">
      <small>{tx('org.results')}</small>
      {list.map((x) => <SaveLink key={x.url} href={x.url} name={x.name} label={`${tx('org.download')} ${x.name}`} testid="result-file"><Icon n="download" sm /><span>{x.name}</span></SaveLink>)}
    </div>
  );
}

function SharedShots({ m }: { m: MsgView }) {
  const list = useMemo(() => sharedShots(m), [m.steps, m.content]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!list.length) return null;
  return <div className="ans-shots" data-testid="shared-shots">{list.map((x) => <OutImage key={x.url} src={x.url} name={x.name} size={x.size} />)}</div>;
}

function Work({ m }: { m: MsgView }) {
  const w = useWork();
  const job = m.jobId ?? m.meta?.jobId;
  return <WorkFeed m={m} onLive={w?.openLive} onDecide={w && job ? (s, allow) => { void w.decide(job, s, allow); } : undefined} askInBar={!!w && w.barFor === m.id} />;
}

export { memUpdText } from './MemUpd';

export function AssistantMsg({ m, models, col, headSlot, footSlot, markSlot, last, onRegenerate, onContinue, onSwitch, onAlt, fileNames, canRegen, readOnly, bare }: {
  m: MsgView; models: PublicModel[]; col?: 'a' | 'b'; headSlot?: ReactNode; last?: boolean; onRegenerate?: () => void; onContinue?: () => void; onSwitch?: (id: string) => void;
  footSlot?: ReactNode;
  onAlt?: (alt: { id: string; name: string }) => void;
  fileNames?: string[]; canRegen?: boolean;
  readOnly?: boolean;
  markSlot?: ReactNode;
  bare?: boolean;
}) {
  const tx = useT();
  const [copied, setCopied] = useState(false);
  const admin = useIsAdmin();
  const meta = m.meta ?? {};
  const lab = levelLabel(models, { modelId: meta.modelId ?? '', levelId: meta.levelId ?? '' }), level = lab.level;
  const dur = meta.durationMs;
  const waiting = m.streaming && !m.content && !m.reasoning;
  const sq = m.streaming && m.phase !== 'queued' ? m.squeue : null;
  const shown = useThrottled(m.content, 140, !!m.streaming);
  const speed = speedText(m, tx.lang);
  const sources = useMemo(() => sourcesOf(meta.usage), [meta.usage]);
  const urlList = useMemo(() => turnUrls([m.content, m.reasoning, ...(m.steps ?? []).map((x) => x.detail)]), [m.content, m.reasoning, m.steps]);
  const urlKey = urlList.join('\n');
  const urls = useMemo(() => urlList, [urlKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const srcCtx = useMemo(() => ({ sources, live: !!m.streaming, urls }), [sources, m.streaming, urls]);
  return (
    <div className={`ans${col ? ` ans-${col}` : ''}`} data-testid="assistant-msg" id={`m-${m.id}`} data-rated={readOnly && m.rating ? (m.rating.value < 0 ? 'down' : 'up') : undefined}>
      <header className="ans-head">
        {headSlot ?? (<><ModelMark id={meta.modelId ?? ''} models={models} /><b><ModelName name={lab.name} suffix={lab.suffix} /></b><span className="sep" /><span>{level}</span><span className="sep" /></>)}
        {!bare && <span className="ans-full">{models.find((x) => x.id === meta.modelId)?.fullName}</span>}
        <span className="grow" />
        {dur ? <span className="tnum">{fmtSec(dur, tx.lang)}</span> : m.streaming && m.startedAt ? <Live since={m.startedAt} /> : null}
        {speed && <><span className="sep" /><span className="tnum ans-speed" data-testid="speed" title={tx('msg.speedTitle')}>{speed}</span></>}
      </header>
      {markSlot}
      <Work m={m} />
      {}
      {m.phase === 'queued' && (readOnly ? <p className="t-cap" data-testid="queued">{tx('msg.queuedAdmin')}</p> : <QueueCard ahead={m.ahead ?? 0} eta={m.eta} />)}
      {}
      {sq && (readOnly ? <p className="t-cap" data-testid="squeued">{tx('squeue.admin')}</p> : <ServeQueueCard ahead={sq.ahead} eta={sq.eta} />)}
      {}
      {waiting && m.phase !== 'queued' && !sq && <p className="t-cap ans-wait"><span className="ans-wait-ic" aria-hidden="true"><HeadMark live /></span><span className="shimmer">{tx('msg.thinking')}</span></p>}
      {shown && <SrcCtx.Provider value={srcCtx}><Markdown text={shown} live={!!m.streaming} /></SrcCtx.Provider>}
      <SrcList sources={sources} live={!!m.streaming} />
      <SharedShots m={m} />
      <Results m={m} />
      {m.streaming && m.content && <span className="caret" aria-hidden="true" />}
      {meta.stopped && !m.content && <p className="t-cap">{tx('msg.stopped')}</p>}
      {(meta.errorUser || meta.error) && (
        <div className="err-box" role="alert" data-testid="err-box">
          <Icon n="alert" sm />
          <span>
            {meta.errorUser ? errText(tx.lang, meta.errorUser) : (admin ? meta.error : userError(meta.error ?? '', tx.lang))}
            {admin && meta.errorUser && meta.error && <small className="err-tech" data-testid="err-tech">{tx('msg.reason', { text: meta.error })}</small>}
            {meta.altModel && onAlt && (
              <span className="err-alt" style={{ display: 'block' }}>
                <button type="button" className="btn" data-testid="alt-model" onClick={() => onAlt(meta.altModel!)}>{tx('msg.switchTo', { name: meta.altModel.name })}</button>
              </span>
            )}
          </span>
        </div>
      )}
      {!m.streaming && meta.memUpd?.length ? <MemUpdated items={meta.memUpd as MemUpdItem[]} messageId={m.id} /> : null}
      {!m.streaming && (
        <div className="ans-foot">
          {meta.memory && !bare ? <MemoryLine memory={meta.memory} usage={meta.usage} fileNames={fileNames} /> : <span />}
          <div className="acts">
            {!readOnly && last && canRegen && onContinue && !!m.content.trim() && (meta.finish === 'length' || meta.stopped) && (
              <button type="button" className="btn btn--ghost" data-testid="continue" onClick={onContinue}>{tx('msg.continue')}</button>
            )}
            {onSwitch && <Versions s={m.siblings} onSwitch={onSwitch} />}
            <button type="button" className="icon-btn" aria-label={tx('msg.copy')} onClick={() => { navigator.clipboard?.writeText(stripWebMarks(stripMarkers(m.content, 'plain', tx.lang))).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }); }}>
              <Icon n={copied ? 'check' : 'copy'} sm />
            </button>
            {!readOnly && last && canRegen && <button type="button" className="icon-btn" aria-label={tx('msg.regen')} onClick={onRegenerate} data-testid="regen"><Icon n="retry" sm /></button>}
            {!readOnly && !bare && !m.id.startsWith('a-') && (m.content.trim() || meta.error) && <Rate m={m} />}
          </div>
        </div>
      )}
      {!m.streaming && footSlot && <div className="ans-pick">{footSlot}</div>}
    </div>
  );
}
