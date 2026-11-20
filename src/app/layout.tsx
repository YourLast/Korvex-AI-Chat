import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import fs from 'node:fs';
import path from 'node:path';
import '../../node_modules/rehype-katex/node_modules/katex/dist/katex.min.css';
import '@/styles/design-tokens.css';
import '@/styles/theme.css';
import '@/styles/design-app.css';
import '@/styles/design-patches.css';
import '@/styles/app.css';
import { PwaRegister } from '@/components/PwaRegister';
import { currentUser } from '@/lib/auth';
import { I18nProvider } from '@/lib/i18n/react';
import { htmlLang, pageLang } from '@/lib/i18n/server';
import { BIP_SNIPPET } from '@/lib/installPrompt';
import { tr } from '@/lib/i18n/core';
import { ImageViewerSlot } from '@/components/iv';
import { FileViewerSlot } from '@/components/FileViewerSlot';
import { SB_SNIPPET } from '@/lib/sbSnippet';
import '@/styles/viewer.css';
import { brand, logoUrl } from '@/lib/brand';
import { BrandProvider } from '@/components/BrandCtx';
import { cookies } from 'next/headers';
import { pickTheme, schemeOf, SCHEME_COOKIE, THEME_COLOR, THEME_COOKIE, type Theme } from '@/lib/theme';
import { ThemeSync } from '@/components/ThemeSync';

const inter = Inter({ subsets: ['latin', 'latin-ext', 'cyrillic'], display: 'swap', variable: '--font-inter' });

async function themeOf(user?: { theme?: string | null } | null): Promise<{ theme: Theme; scheme: 'light' | 'dark' }> {
  const c = await cookies();
  const theme = pickTheme({ user: user?.theme, cookie: c.get(THEME_COOKIE)?.value });
  return { theme, scheme: schemeOf(theme, c.get(SCHEME_COOKIE)?.value) };
}

export async function generateMetadata(): Promise<Metadata> {
  const b = brand();
  const { scheme } = await themeOf(await currentUser());
  return {
  title: { default: b.name, template: `%s · ${b.name}` },
  applicationName: b.name,
  description: tr(await pageLang(await currentUser()), 'meta.desc'),
  robots: { index: false, follow: false },
  icons: logoUrl(b) ? { icon: [{ url: logoUrl(b)! }], apple: [{ url: logoUrl(b)! }] } : { icon: [{ url: '/favicon.ico' }, { url: '/icon-192.png', sizes: '192x192', type: 'image/png' }], apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }] },
  appleWebApp: { capable: true, title: b.name, statusBarStyle: scheme === 'light' ? 'default' : 'black' },
  formatDetection: { telephone: false },
  other: { 'apple-mobile-web-app-capable': 'yes' },
  };
}
export async function generateViewport(): Promise<Viewport> {
  const { theme } = await themeOf(await currentUser());
  const base = { width: 'device-width', initialScale: 1, viewportFit: 'cover' } as const;
  if (theme !== 'system') return { ...base, themeColor: THEME_COLOR[theme], colorScheme: theme };
  return { ...base, colorScheme: 'light dark', themeColor: [{ media: '(prefers-color-scheme: light)', color: THEME_COLOR.light }, { media: '(prefers-color-scheme: dark)', color: THEME_COLOR.dark }] };
}

const sprite = fs.readFileSync(path.join(process.cwd(), 'src/styles/sprite.svg'), 'utf8') + fs.readFileSync(path.join(process.cwd(), 'src/styles/sprite-app.svg'), 'utf8');

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const lang = await pageLang(user);
  const b = brand();
  const { theme } = await themeOf(user);
  const brandCss = [logoUrl(b) ? `html .mark{-webkit-mask:none!important;mask:none!important;background:url(${logoUrl(b)}) center/contain no-repeat!important;width:var(--mark,24px)!important}` : '', b.accent ? `:root{--accent:${b.accent}}` : ''].join('');
  return (
    <html lang={htmlLang(lang)} className={inter.variable} data-theme={theme === 'system' ? undefined : theme} data-theme-pick={theme} data-kx-install={process.env.KX_INSTALL_AUTO === '0' ? 'off' : undefined} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BIP_SNIPPET }} />
        {}
        <script dangerouslySetInnerHTML={{ __html: SB_SNIPPET }} />
        {brandCss && <style dangerouslySetInnerHTML={{ __html: brandCss }} />}
      </head>
      <body>
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: sprite }} />
        <BrandProvider value={{ name: b.name, short: b.short, footer: b.footer, logoUrl: logoUrl(b) }}>
        <I18nProvider lang={lang} signedIn={!!user}>
          {children}
          {}
          <ImageViewerSlot />
          <FileViewerSlot />
        </I18nProvider>
        </BrandProvider>
        <PwaRegister />
        <ThemeSync theme={theme} signedIn={!!user} />
      </body>
    </html>
  );
}
