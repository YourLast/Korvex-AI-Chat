'use client';
import { useState } from 'react';
import { Icon } from './Icon';
import { openImage } from './iv';
import { prefetch, saveImage } from '@/lib/imageActions';
import { useT } from '@/lib/i18n/react';
import { OUT_PREFIX } from '@/ext/client';

const nameOf = (src: string) => { if (src.startsWith('data:')) return ''; try { return decodeURIComponent(src.split('?')[0].split('/').pop() ?? ''); } catch { return ''; } };

export function thumbSrc(src: string, w: 160 | 480 | 960 | 1440): string {
  if (!(src.startsWith('/api/files/') || src.startsWith(OUT_PREFIX)) || /\.gif(\?|$)/i.test(src)) return src;
  return `${src}${src.includes('?') ? '&' : '?'}w=${w}`;
}
export function thumbSet(src: string, ws: (480 | 960 | 1440)[]): string | undefined {
  const a = ws.map((w) => thumbSrc(src, w));
  return a[0] === src ? undefined : a.map((u, i) => `${u} ${ws[i]}w`).join(', ');
}

export function thumbClick(e: React.MouseEvent<HTMLElement>, src: string) {
  if (e.metaKey || e.ctrlKey || e.shiftKey) { window.open(src, '_blank', 'noopener'); return; }
  openImage(e.currentTarget);
}

export function OutImage({ src, name, size, bare }: { src: string; name: string; size?: string | null; bare?: boolean }) {
  const t = useT();
  const [state, setState] = useState<'load' | 'ok' | 'err'>('load');
  const [attempt, setAttempt] = useState(0);
  const [dl, setDl] = useState<string | null>(null);
  const label = name || nameOf(src);
  if (state === 'err') return <span className="t-cap md-img-miss">{t(label ? 'work.img.missNamed' : 'work.img.miss', { name: label })}</span>;
  const small = thumbSrc(src, 960);
  const retry = (u: string) => (attempt && !src.startsWith('data:') ? `${u}${u.includes('?') ? '&' : '?'}r=${attempt}` : u);
  const shown = retry(small);
  const set = small === src ? undefined : ([480, 960, 1440] as const).map((w) => `${retry(thumbSrc(src, w))} ${w}w`).join(', ');
  const onErr = () => {
    if (attempt < 1 && !src.startsWith('data:')) setTimeout(() => setAttempt(1), 1500);
    else setState('err');
  };
  const save = () => {
    void saveImage({ src, name: label }, t.lang).then((o) => { if (o.note) { setDl(o.note); setTimeout(() => setDl(null), 2600); } });
  };
  return (
    <figure className={`md-fig${state === 'load' ? ' is-load' : ''}`}>
      <button type="button" className="md-fig-img iv-thumb" data-iv="" data-iv-src={src} data-iv-name={label} data-iv-size={size ?? undefined}
        aria-label={t(label ? 'work.img.openNamed' : 'work.img.open', { name: label })} data-testid="out-image" onClick={(e) => thumbClick(e, src)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={shown} srcSet={set} sizes="(max-width: 760px) 100vw, 720px" alt={label} loading="lazy" decoding="async" className="md-img" onLoad={() => setState('ok')} onError={onErr} />
      </button>
      {!bare && (
        <figcaption>
          <span className="md-fig-name">{label}{size ? ` · ${size}` : ''}</span>
          <button type="button" className="md-fig-dl" data-testid="out-image-dl" onPointerDown={() => prefetch({ src, name: label })} onClick={save}>
            <Icon n="download" />{dl ?? t('work.img.save')}
          </button>
        </figcaption>
      )}
    </figure>
  );
}
