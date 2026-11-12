import { cookies, headers } from 'next/headers';
import { cookieValue, LANG_COOKIE, pickLang, type Lang } from './core';

export async function pageLang(user?: { lang?: string | null } | null): Promise<Lang> {
  const [c, h] = await Promise.all([cookies(), headers()]);
  return pickLang({ user: user?.lang, cookie: c.get(LANG_COOKIE)?.value, accept: h.get('accept-language') });
}

export function reqLang(req: Request, userLang?: string | null): Lang {
  return pickLang({ user: userLang, cookie: cookieValue(req.headers.get('cookie'), LANG_COOKIE), accept: req.headers.get('accept-language') });
}

export const htmlLang = (l: Lang) => (l === 'sr' ? 'sr-Latn' : l);
