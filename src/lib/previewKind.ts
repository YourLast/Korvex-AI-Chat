
export type PreviewKind = 'slides' | 'pages';
const SLIDES = new Set(['pptx', 'ppt', 'pps', 'ppsx', 'odp']);
const PAGES = new Set(['docx', 'doc', 'odt', 'rtf', 'pdf']);

export const PREVIEW_W = [1600, 1080, 320] as const;
export type PreviewW = (typeof PREVIEW_W)[number];

export const extOf = (name: string) => (/\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1] ?? '').toLowerCase();

export function previewKind(name: string): PreviewKind | null {
  const e = extOf(name);
  return SLIDES.has(e) ? 'slides' : PAGES.has(e) ? 'pages' : null;
}

export const pageUrl = (href: string, v: string, n: number, w: PreviewW) => `${href}?preview=1&page=${n}&w=${w}&v=${encodeURIComponent(v)}`;
