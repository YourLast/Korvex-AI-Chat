
export const INSTALL_KEY = 'kx.install';
export const SNOOZE_DAYS = 7;
export const MAX_SHOWN = 3;
export const COUNTDOWN_S = 3;

export type InstallState = { shown: number; lastDismiss: number; installed: boolean };
export const EMPTY_INSTALL: InstallState = { shown: 0, lastDismiss: 0, installed: false };

export function readInstall(raw: string | null): InstallState {
  if (!raw) return { ...EMPTY_INSTALL };
  try {
    const j = JSON.parse(raw) as Partial<InstallState>;
    return {
      shown: Number.isFinite(j.shown) ? Math.max(0, Math.floor(Number(j.shown))) : 0,
      lastDismiss: Number.isFinite(j.lastDismiss) ? Number(j.lastDismiss) : 0,
      installed: j.installed === true,
    };
  } catch { return { ...EMPTY_INSTALL }; }
}
export const markShown = (st: InstallState): InstallState => ({ ...st, shown: st.shown + 1 });
export const markDismissed = (st: InstallState, now: number): InstallState => ({ ...st, lastDismiss: now });
export const markInstalled = (st: InstallState): InstallState => ({ ...st, installed: true });

export type Platform = 'ios' | 'android' | 'desktop';
export type Browser = 'safari' | 'chrome-ios' | 'firefox-ios' | 'edge-ios' | 'opera-ios' | 'yandex-ios' | 'other-ios' | 'inapp'
  | 'android-chrome' | 'samsung' | 'firefox' | 'opera' | 'edge' | 'yandex' | 'other';
export type App = 'instagram' | 'facebook' | 'tiktok' | 'telegram' | 'viber' | 'whatsapp' | 'snapchat' | 'line' | 'twitter' | 'linkedin' | 'pinterest' | 'vk' | 'wechat';
export type InstallEnv = {
  platform: Platform; browser: Browser; ios: [number, number] | null; standalone: boolean; hasPrompt: boolean;
  app: App | null;
  safari: number | null;
  ipad: boolean;
};

const APPS: [App, RegExp][] = [
  ['instagram', /Instagram/i], ['facebook', /FBAN|FBAV|FB_IAB|FBIOS|FB4A|Orca-Android|MessengerLite/], ['tiktok', /musical_ly|TikTok|Bytedance/i],
  ['telegram', /Telegram/i], ['viber', /Viber/i], ['whatsapp', /WhatsApp/i], ['snapchat', /Snapchat/i], ['line', /\bLine\//], ['twitter', /Twitter/i],
  ['linkedin', /LinkedInApp/i], ['pinterest', /Pinterest/i], ['vk', /VKAndroidApp|vkclient|VKApp/i], ['wechat', /MicroMessenger/i],
];
const appOf = (ua: string): App | null => APPS.find(([, re]) => re.test(ua))?.[0] ?? null;

export function installEnv(ua: string, maxTouch: number, standalone: boolean, hasPrompt: boolean): InstallEnv {
  const ipadDesktop = /Macintosh/.test(ua) && maxTouch > 1;
  const ios = /iPhone|iPad|iPod/.test(ua) || ipadDesktop;
  const app = appOf(ua);
  if (ios) {
    const v = /OS (\d+)[_.](\d+)/.exec(ua) ?? /Version\/(\d+)\.(\d+)/.exec(ua);
    const version: [number, number] | null = v ? [Number(v[1]), Number(v[2])] : null;
    const sv = /Version\/(\d+)/.exec(ua);
    const browser: Browser = app || /GSA\//.test(ua) ? 'inapp' : /CriOS/.test(ua) ? 'chrome-ios' : /FxiOS/.test(ua) ? 'firefox-ios' : /EdgiOS/.test(ua) ? 'edge-ios'
      : /OPiOS|OPT\//.test(ua) ? 'opera-ios' : /YaBrowser/.test(ua) ? 'yandex-ios' : /DuckDuckGo|Ddg\/|Brave/.test(ua) ? 'other-ios' : /Safari\//.test(ua) ? 'safari' : 'inapp';
    return { platform: 'ios', browser, ios: version, standalone, hasPrompt: false, app, safari: browser === 'safari' && sv ? Number(sv[1]) : null, ipad: /iPad/.test(ua) || ipadDesktop };
  }
  if (/Android/.test(ua)) {
    const browser: Browser = app || /; wv\)/.test(ua) ? 'inapp' : /SamsungBrowser/.test(ua) ? 'samsung' : /Firefox\//.test(ua) ? 'firefox' : /OPR\//.test(ua) ? 'opera' : /EdgA/.test(ua) ? 'edge'
      : /YaBrowser/.test(ua) ? 'yandex' : /Chrome\//.test(ua) ? 'android-chrome' : 'other';
    return { platform: 'android', browser, ios: null, standalone, hasPrompt, app, safari: null, ipad: false };
  }
  return { platform: 'desktop', browser: 'other', ios: null, standalone, hasPrompt, app: null, safari: null, ipad: false };
}

export type Way = 'native' | 'ios' | 'safari' | 'menu' | 'inapp';
export function installWay(env: InstallEnv): Way | null {
  if (env.standalone) return null;
  if (env.browser === 'inapp') return env.platform === 'desktop' ? null : 'inapp';
  if (env.hasPrompt) return 'native';
  if (env.platform === 'ios') {
    if (env.browser === 'safari') return 'ios';
    if (env.browser === 'chrome-ios' || env.browser === 'firefox-ios' || env.browser === 'edge-ios') {
      return !env.ios || env.ios[0] > 16 || (env.ios[0] === 16 && env.ios[1] >= 4) ? 'ios' : 'safari';
    }
    return 'safari';
  }
  if (env.platform === 'android') return 'menu';
  return null;
}

export type GuideId = 'ios-safari' | 'ios-safari26' | 'ipad-safari' | 'ios-chrome' | 'ios-firefox' | 'ios-edge' | 'open-safari' | 'inapp-ios' | 'inapp-android'
  | 'android-chrome' | 'android-samsung' | 'android-firefox' | 'android-opera' | 'android-edge' | 'android-yandex' | 'android-other';
export function guideOf(env: InstallEnv): GuideId | null {
  const w = installWay(env);
  if (!w) return null;
  if (env.platform === 'ios') {
    if (w === 'inapp') return 'inapp-ios';
    if (w === 'safari') return 'open-safari';
    switch (env.browser) {
      case 'chrome-ios': return 'ios-chrome';
      case 'firefox-ios': return 'ios-firefox';
      case 'edge-ios': return 'ios-edge';
      default: return env.ipad ? 'ipad-safari' : (env.safari ?? 0) >= 26 ? 'ios-safari26' : 'ios-safari';
    }
  }
  if (env.platform === 'android') {
    if (w === 'inapp') return 'inapp-android';
    switch (env.browser) {
      case 'samsung': return 'android-samsung';
      case 'firefox': return 'android-firefox';
      case 'opera': return 'android-opera';
      case 'edge': return 'android-edge';
      case 'yandex': return 'android-yandex';
      case 'android-chrome': return 'android-chrome';
      default: return 'android-other';
    }
  }
  return null;
}

export type SysLang = 'ru' | 'en';
export const systemLang = (list: readonly string[] | null | undefined): SysLang => (String(list?.[0] ?? '').toLowerCase().startsWith('ru') ? 'ru' : 'en');

export type SysKey = 'share' | 'addHome' | 'add' | 'cancel' | 'openSafari' | 'openBrowser' | 'copyLink'
  | 'chromeAddHome' | 'chromeInstallApp' | 'chromeInstall' | 'samsungAddTo' | 'samsungHome' | 'samsungAdd'
  | 'firefoxInstall' | 'firefoxAddHome' | 'operaAddTo' | 'operaHome' | 'edgeAddPhone' | 'yandexAddHome';
const SYS_EN: Record<SysKey, string> = {
  share: 'Share', addHome: 'Add to Home Screen', add: 'Add', cancel: 'Cancel', openSafari: 'Open in Safari', openBrowser: 'Open in browser', copyLink: 'Copy Link',
  chromeAddHome: 'Add to Home screen', chromeInstallApp: 'Install app', chromeInstall: 'Install', samsungAddTo: 'Add page to', samsungHome: 'Home screen', samsungAdd: 'Add',
  firefoxInstall: 'Install', firefoxAddHome: 'Add to Home screen', operaAddTo: 'Add to', operaHome: 'Home screen', edgeAddPhone: 'Add to phone', yandexAddHome: 'Add to home screen',
};
const SYS_RU: Partial<Record<SysKey, string>> = {
  share: 'Поделиться', addHome: 'На экран «Домой»', add: 'Добавить', cancel: 'Отменить', copyLink: 'Скопировать',
  chromeAddHome: 'Добавить на главный экран', chromeInstallApp: 'Установить приложение', chromeInstall: 'Установить',
  samsungAddTo: 'Добавить страницу в', samsungHome: 'Главный экран', samsungAdd: 'Добавить',
};
export const sysLabel = (key: SysKey, sys: SysLang): string => (sys === 'ru' ? SYS_RU[key] : undefined) ?? SYS_EN[key];

export function shouldOffer(st: InstallState, env: InstallEnv, now: number): boolean {
  if (env.platform === 'desktop' || env.standalone || st.installed) return false;
  if (st.shown >= MAX_SHOWN) return false;
  if (st.lastDismiss && now - st.lastDismiss < SNOOZE_DAYS * 864e5) return false;
  if (env.platform === 'android' && env.browser === 'android-chrome' && !env.hasPrompt) return false;
  return installWay(env) !== null;
}

export const canInstall = (env: InstallEnv, st: InstallState): boolean => !env.standalone && !st.installed && installWay(env) !== null;

export const countdownLeft = (startedAt: number, now: number, total = COUNTDOWN_S): number => Math.max(0, Math.ceil(total - (now - startedAt) / 1000));
