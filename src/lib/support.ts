import { tr, type Lang } from './i18n/core';
import { cfg } from './cfg';

export const supportTg = () => cfg('KX_SUPPORT_TG');
export const supportEmail = () => cfg('KX_SUPPORT_EMAIL');
export const supportHandle = () => '@' + (supportTg().replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() ?? '').replace(/^@/, '');
export const supportInfo = () => ({ tg: supportTg(), handle: supportHandle(), email: supportEmail() });

export const supportLine = (lang: Lang) => tr(lang, 'support.line', { tg: supportHandle(), email: supportEmail() });
export const withSupport = (lang: Lang, text: string) => (supportTg() || supportEmail() ? `${text}\n\n${supportLine(lang)}` : text);
