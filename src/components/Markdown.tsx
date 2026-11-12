'use client';
import { Suspense, memo, use, type ReactElement } from 'react';
import dynamic from 'next/dynamic';

export { OutImage, thumbClick } from './OutImage';

type Body = (p: { text: string; live?: boolean }) => ReactElement;
let body: Body | null = null;
let pending: Promise<Body> | null = null;
export function provideMarkdown(b: Body) { body = b; }
export function loadMarkdown(): Promise<Body> {
  if (body) return Promise.resolve(body);
  return (pending ??= import('./MarkdownBody').then((m) => (body = m.MarkdownBody)));
}

if (typeof window === 'undefined') void loadMarkdown().catch(() => {});
else if (document.querySelector('.prose.md')) void loadMarkdown().catch(() => {});
else {
  const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number };
  const go = () => void loadMarkdown().catch(() => {});
  if (w.requestIdleCallback) w.requestIdleCallback(go, { timeout: 5000 }); else window.setTimeout(go, 2500);
}

const Assets = dynamic(() => import('./MarkdownBody'), { ssr: true });

function Inner(p: { text: string; live?: boolean }) {
  const B = body ?? use(loadMarkdown());
  return <B {...p} />;
}

function Fallback({ text, live }: { text: string; live?: boolean }) {
  const B = body;
  return B ? <B text={text} live={live} /> : <div className="md-plain">{text}</div>;
}

export const Markdown = memo(function Markdown({ text, live }: { text: string; live?: boolean }) {
  return (
    <div className="prose md">
      <Suspense fallback={<Fallback text={text} live={live} />}>
        <Assets />
        <Inner text={text} live={live} />
      </Suspense>
    </div>
  );
});
