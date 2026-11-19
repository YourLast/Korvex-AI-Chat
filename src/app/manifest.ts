import type { MetadataRoute } from 'next';
import { cookies, headers } from 'next/headers';
import { pickTheme, schemeOf, SCHEME_COOKIE, THEME_COLOR, THEME_COOKIE } from '@/lib/theme';
import { fromAcceptLanguage, tr } from '@/lib/i18n/core';
import { brand, logoUrl } from '@/lib/brand';

export const dynamic = 'force-dynamic';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const lang = fromAcceptLanguage((await headers()).get('accept-language'));
  const c = await cookies();
  const bg = THEME_COLOR[schemeOf(pickTheme({ cookie: c.get(THEME_COOKIE)?.value }), c.get(SCHEME_COOKIE)?.value)];
  const b = brand();
  const logo = logoUrl(b);
  return {
    name: b.name,
    short_name: b.short,
    description: tr(lang, 'pwa.desc'),
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'portrait',
    dir: 'ltr',
    categories: ['productivity', 'business'],
    prefer_related_applications: false,
    lang: lang === 'sr' ? 'sr-Latn' : lang,
    background_color: bg,
    theme_color: bg,
    icons: logo ? [{ src: logo, sizes: 'any', purpose: 'any' }] : [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
