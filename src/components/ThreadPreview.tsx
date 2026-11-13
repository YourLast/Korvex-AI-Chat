'use client';
import { usePathname } from 'next/navigation';
import { startTransition, useEffect, useState } from 'react';
import { useEntry } from '@/lib/tcache';
import { useT } from '@/lib/i18n/react';
import { ChatClient } from './ChatClient';
import { CompareClient } from './CompareClient';
import { Topbar, useShell } from './Shell';
import { Icon } from './Icon';
import { FootNote } from './FootNote';

export function ThreadPreview({ href }: { href: string }) {
  const { models, threads } = useShell();
  const e = useEntry(href);
  const [full, setFull] = useState(false);
  useEffect(() => {
    setFull(false);
    let t = 0;
    const r = requestAnimationFrame(() => { t = window.setTimeout(() => startTransition(() => setFull(true)), 0); });
    return () => { cancelAnimationFrame(r); window.clearTimeout(t); };
  }, [href]);
  if (!full) {
    const id0 = href.split('/')[2] ?? '';
    const t0 = threads.find((x) => x.id === id0 || x.groupId === id0);
    return <ThreadSkeleton title={t0?.title ?? (e?.kind === 'c' ? e.title : e?.kind === 'g' ? e.init.a.title : '')} />;
  }
  if (e?.kind === 'c') {
    return <ChatClient key={`pv-${e.id}`} preview models={models} thread={{ id: e.id, title: e.title, modelId: e.modelId, effort: e.effort, compare: e.compare ?? null }} initial={e.messages} hasMore={e.hasMore} fileNames={e.fileNames} />;
  }
  if (e?.kind === 'g') return <CompareClient key={`pv-${e.init.groupId}`} preview models={models} init={e.init} />;
  const id = href.split('/')[2] ?? '';
  const t = threads.find((x) => x.id === id || x.groupId === id);
  return <ThreadSkeleton title={t?.title ?? ''} />;
}

export function ThreadSkeleton({ title }: { title: string }) {
  const tx = useT();
  return (
    <>
      <Topbar title={title || ' '} sub=" " />
      <div className="thread" data-testid="thread-skeleton" aria-busy="true">
        <div className="thread-in">
          {[0, 1].map((i) => (
            <div key={i} className="sk-turn">
              <div className="sk sk--bubble" />
              <div className="sk sk--line" style={{ width: '92%' }} />
              <div className="sk sk--line" style={{ width: '78%' }} />
              <div className="sk sk--line" style={{ width: '64%' }} />
            </div>
          ))}
        </div>
      </div>
      {}
      <div className="dock" aria-hidden="true">
        <div className="composer">
          <textarea rows={1} disabled placeholder={tx('shell.writeMsg')} tabIndex={-1} />
          <div className="composer-bar">
            <span className="icon-btn"><Icon n="clip" /></span>
            <span className="sk sk--chip" />
            <span className="grow" />
            <span className="icon-btn"><Icon n="mic" /></span>
            <button type="button" className="send" disabled tabIndex={-1}><Icon n="arrow-up" /></button>
          </div>
        </div>
        <FootNote text={tx('shell.footNote')} />
      </div>
    </>
  );
}

export function RoutePreview() {
  const path = usePathname();
  return <ThreadPreview href={path} />;
}
