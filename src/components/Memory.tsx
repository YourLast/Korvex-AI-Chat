'use client';
import { useRef, useState } from 'react';
import type { MemoryInfo } from '@/lib/types';
import { fmtInt, fmtTokLang } from '@/lib/format';
import { fmtNum, type Lang } from '@/lib/i18n/core';
import { useT } from '@/lib/i18n/react';
import { Icon } from './Icon';
import { Popover } from './Popover';
import { useIsAdmin } from './Shell';
import { EXTRA_KEY } from '@/ext/client';

export const fmtIntL = (lang: Lang, n: number): string => (lang === 'ru' ? fmtInt(n) : fmtNum(lang, Math.round(n)));
export const fmtTokL = fmtTokLang;

export function filesCount(m: MemoryInfo) {
  return (m.files || 0) + (m.inline_files || 0) + (m.images || 0);
}

export function memoryLines(t: ReturnType<typeof useT>, m: MemoryInfo, usage?: Record<string, unknown> | null): string[] {
  const L = t.lang;
  const u0 = (usage ?? {}) as Record<string, unknown>;
  const u = { ...u0, ...((u0[EXTRA_KEY] as object | undefined) ?? {}) } as { prompt_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  const out = [t(filesCount(m) > 0 ? 'tools.mem.lineChatFiles' : 'tools.mem.lineChat', { n: fmtIntL(L, m.total_tokens ?? 0) })];
  if (typeof u.prompt_tokens === 'number') {
    const c = u.prompt_tokens_details?.cached_tokens;
    out.push(c ? t('tools.mem.lineReadCached', { n: fmtIntL(L, u.prompt_tokens), c: fmtIntL(L, c) }) : t('tools.mem.lineRead', { n: fmtIntL(L, u.prompt_tokens) }));
  }
  return out;
}

export function MemoryLine({ memory, usage, fileNames }: { memory: MemoryInfo; usage?: Record<string, unknown> | null; fileNames?: string[] }) {
  const t = useT();
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const total = memory.total_tokens ?? 0;
  const limit = memory.limit_tokens || 1;
  const n = total > 0 ? Math.max(1, Math.ceil((total / limit) * 28)) : 0;
  const nf = filesCount(memory);
  const lines = memoryLines(t, memory, usage);
  return (
    <>
      <button ref={btn} type="button" className="mem" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={lines.join('\n')} data-testid="mem-line">
        <Icon n="layers" sm />
        <span>
          {t('tools.mem.chip')} <span style={{ color: 'var(--text-4)' }}>·</span> <b>{t('tools.mem.ofShort', { a: fmtTokL(t.lang, total), b: fmtTokL(t.lang, limit) })}</b>
          {nf > 0 && <span className="mem-files"> · {t('tools.files', { n: nf })}</span>}
        </span>
        <span className={`ruler${n ? '' : ' ruler--empty'}`} style={{ ['--n' as string]: n || 1 }} role="img" aria-label={t('tools.mem.used', { a: fmtTokL(t.lang, total), b: fmtTokL(t.lang, limit) })} />
        <Icon n="chev-up" sm className="chev" />
      </button>
      <Popover anchor={btn.current} open={open} onClose={() => setOpen(false)} title={t('tools.mem.chip')} icon="layers" sub={t('tools.mem.thisChat')} side="top">
        <MemoryBody memory={memory} usage={usage} fileNames={fileNames} />
      </Popover>
    </>
  );
}

const FILE_SHOWN = 5;
const TOK_PER_PAGE = 600;
const fileIcon = (name: string) => (/\.(xlsx|xlsm|xls|ods|csv|tsv)$/i.test(name) ? 'table' : 'file-text');
const pct = (lang: Lang, a: number, b: number) => {
  const sp = lang === 'ru' ? '\u00a0' : '', dot = lang === 'en' ? '.' : ',';
  if (!b) return `0${sp}%`;
  const p = (a / b) * 100;
  if (p > 0 && p < 0.01) return `<0${dot}01${sp}%`;
  return `${p.toFixed(p < 1 ? 2 : 1).replace('.', dot)}${sp}%`;
};

export function MemoryBody({ memory: m, usage, fileNames }: { memory: MemoryInfo; usage?: Record<string, unknown> | null; fileNames?: string[] }) {
  const t = useT();
  const L = t.lang;
  const admin = useIsAdmin();
  const [all, setAll] = useState(false);
  const total = m.total_tokens ?? 0;
  const limit = m.limit_tokens || 1;
  const imgTok = m.images_tokens || 0;
  const filesTok = (m.files_tokens || 0) + (m.inline_tokens || 0) + imgTok;
  const other = m.other_tokens || 0;
  const rows = [
    { k: 'files', cls: 'c-files', name: t('tools.mem.files'), v: filesTok },
    { k: 'chat', cls: 'c-chat', name: t('tools.mem.chat'), v: m.chat_tokens || 0 },
    { k: 'web', cls: 'c-web', name: t('tools.mem.web'), v: m.web_tokens || 0 },
    ...(other > 0 ? [{ k: 'other', cls: 'c-web', name: t('tools.mem.other'), v: other }] : []),
  ];
  const sum = Math.max(1, rows.reduce((s, r) => s + r.v, 0));
  const ux = (usage ?? {}) as Record<string, unknown>;
  const u = { ...ux, ...((ux[EXTRA_KEY] as object | undefined) ?? {}) } as { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number }; prompt_tokens_details?: { cached_tokens?: number }; calls?: number; rounds?: number };
  const listed: { name: string; tokens: number | undefined; image?: boolean }[] = m.file_list?.length
    ? m.file_list.map((f) => ({ name: f.name || t('tools.mem.file'), tokens: f.tokens }))
    : (fileNames ?? []).map((name) => ({ name, tokens: undefined as number | undefined }));
  if (m.images) listed.push({ name: t('tools.mem.images', { n: m.images }), tokens: imgTok, image: true });
  if (m.inline_files && !m.file_list?.length && !fileNames?.length) listed.push({ name: t('tools.mem.inline', { n: m.inline_files }), tokens: m.inline_tokens });
  const shown = all ? listed : listed.slice(0, FILE_SHOWN);
  const rest = listed.slice(FILE_SHOWN);
  const restTok = rest.reduce((s, f) => s + (f.tokens || 0), 0);
  const n90 = total > 0 ? Math.max(1, Math.ceil((total / limit) * 90)) : 0;
  const pages = Math.max(1, Math.round(total / TOK_PER_PAGE));
  return (
    <div data-testid="mem-pop">
      <div className="mem-hero"><span className="num">{fmtIntL(L, total)}</span><span className="unit">{t('tools.mem.tok')}</span><span className="pct">{pct(L, total, limit)}</span></div>
      <div style={{ marginTop: 16 }}><span className={`ruler ruler--lg${n90 ? '' : ' ruler--empty'}`} style={{ ['--n' as string]: n90 || 1 }} role="img" aria-label={t('tools.mem.usedPct', { p: pct(L, total, limit) })} /></div>
      <div className="ruler-axis"><span>0</span><span>{fmtTokL(L, limit)}</span></div>
      <div className="stats"><div><small>{t('tools.mem.limit')}</small><b>{t('tools.mem.nTok', { num: fmtIntL(L, limit) })}</b></div><div><small>{t('tools.mem.free')}</small><b>{t('tools.mem.nTok', { num: fmtIntL(L, m.remaining_tokens) })}</b></div></div>
      <div className="mem-lines" data-testid="mem-lines">{memoryLines(t, m, usage).map((x) => <p key={x}>{x}</p>)}</div>
      {admin ? (
        <>
          <div className="sec-label"><span>{t('tools.mem.comp')}</span><span className="tnum">{t('tools.mem.nTok', { num: fmtIntL(L, total) })}</span></div>
          <div className="stack" aria-hidden="true">
            {rows.filter((r) => r.v > 0).map((r) => <i key={r.k} className={r.cls} style={{ flex: r.v }} />)}
          </div>
          <div className="src">
            {rows.map((r) => (
              <div key={r.k}>
                <div className="src-row"><i className={`sw ${r.cls}`} /><span>{r.name}{r.k === 'chat' && m.chat_turns ? <span className="t-cap"> · {t('tools.mem.turns', { n: m.chat_turns })}</span> : null}</span><span className="v">{fmtIntL(L, r.v)}</span><span className="p">{Math.round((r.v / sum) * 100)} %</span></div>
                {r.k === 'files' && shown.map((f, i) => (
                  <div className="src-row src-row--f" key={i}><Icon n={f.image ? 'layers' : fileIcon(f.name)} sm /><span className="nm">{f.name}</span><span className="v">{f.tokens != null ? fmtIntL(L, f.tokens) : ''}</span><span className="p" /></div>
                ))}
                {r.k === 'files' && !all && rest.length > 0 && (
                  <div className="src-row src-row--f src-more" role="button" tabIndex={0} onClick={() => setAll(true)} onKeyDown={(e) => e.key === 'Enter' && setAll(true)}>
                    <Icon n="chev-down" sm /><span className="nm">{t('tools.mem.more', { n: rest.length })}</span><span className="v">{restTok ? fmtIntL(L, restTok) : ''}</span><span className="p" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      ) : listed.length > 0 && (
        <>
          <div className="sec-label"><span>{t('tools.mem.chatFiles')}</span><span className="tnum">{listed.length}</span></div>
          <div className="src" data-testid="mem-files">
            {shown.map((f, i) => (
              <div className="src-row src-row--f src-row--plain" key={i}><Icon n={f.image ? 'layers' : fileIcon(f.name)} sm /><span className="nm">{f.name}</span></div>
            ))}
            {!all && rest.length > 0 && (
              <div className="src-row src-row--f src-row--plain src-more" role="button" tabIndex={0} onClick={() => setAll(true)} onKeyDown={(e) => e.key === 'Enter' && setAll(true)}>
                <Icon n="chev-down" sm /><span className="nm">{t('tools.mem.more', { n: rest.length })}</span>
              </div>
            )}
          </div>
        </>
      )}
      {(u.prompt_tokens != null || u.completion_tokens != null) && (
        <>
          <div className="sec-label"><span>{t('tools.mem.thisAnswer')}</span>{admin && <span>{m.exact ? t('tools.mem.exact') : t('tools.mem.estimate')}</span>}</div>
          <div className={admin ? 'stats' : 'stats stats--one'} style={{ marginTop: 0 }}>
            {admin && <div><small>{t('tools.mem.read')}</small><b>{t('tools.mem.nTok', { num: fmtIntL(L, u.prompt_tokens ?? 0) })}</b>
              {(u.calls || u.prompt_tokens_details?.cached_tokens) ? <small>{u.calls ? t('tools.mem.passes', { n: u.calls }) : ''}{u.calls && u.prompt_tokens_details?.cached_tokens ? ' · ' : ''}{u.prompt_tokens_details?.cached_tokens ? t('tools.mem.cached', { num: fmtIntL(L, u.prompt_tokens_details.cached_tokens) }) : ''}</small> : null}</div>}
            <div><small>{t('tools.mem.answer')}</small><b>{t('tools.mem.nTok', { num: fmtIntL(L, u.completion_tokens ?? 0) })}</b>{!!u.completion_tokens_details?.reasoning_tokens && <small>{t('tools.mem.reasoning', { num: fmtIntL(L, u.completion_tokens_details.reasoning_tokens) })}</small>}</div>
          </div>
        </>
      )}
      {(m.full || m.warn) && <p className="mem-note" style={{ color: 'var(--warn)' }}>{m.full ? t('tools.mem.full') : t('tools.mem.warn')}</p>}
      <p className="mem-note">{t('tools.mem.pages', { n: pages, lim: Math.round(limit / TOK_PER_PAGE / 100) * 100 })}</p>
    </div>
  );
}
