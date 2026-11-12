import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { fromAcceptLanguage, tr } from '@/lib/i18n/core';
import { brand, logoUrl } from '@/lib/brand';

export const dynamic = 'force-dynamic';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const lang = fromAcceptLanguage((await headers()).get('accept-language'));
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
    background_color: '#000000',
    theme_color: '#000000',
    icons: logo ? [{ src: logo, sizes: 'any', purpose: 'any' }] : [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
