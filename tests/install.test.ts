import { describe, expect, it } from 'vitest';
import { COUNTDOWN_S, EMPTY_INSTALL, MAX_SHOWN, SNOOZE_DAYS, canInstall, countdownLeft, guideOf, installEnv, installWay, markDismissed, markInstalled, markShown, readInstall, shouldOffer, sysLabel, systemLang } from '@/lib/install';

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  iphoneSafari15: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1',
  iphoneChrome15: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1',
  iphoneChrome16_3: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0 Mobile/15E148 Safari/604.1',
  iphoneChrome16_4: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0 Mobile/15E148 Safari/604.1',
  iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/124.0 Mobile/15E148 Safari/605.1.15',
  iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0',
  iphoneSafari26: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  iphoneChrome26: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.122 Mobile/15E148 Safari/604.1',
  iphoneEdge: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/124.0 Mobile/15E148 Safari/605.1.15',
  iphoneOpera: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 OPT/5.0.0 Safari/604.1',
  iphoneTelegram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Telegram-iOS',
  iphoneViber: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Viber/21.0',
  iphoneTikTok: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_35.0.0 BytedanceWebview/d8a21c6',
  androidOpera: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 OPR/80.0.0.0',
  androidEdge: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 EdgA/124.0.0.0',
  androidYandex: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 YaBrowser/24.4.0 Mobile Safari/537.36',
  androidTelegram: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36 Telegram-Android/10.9',
  iphoneWebview: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  ipadDesktopUa: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:125.0) Gecko/125.0 Firefox/125.0',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36',
  androidWebview: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36',
  desktopChrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};
const env = (ua: string, o: { touch?: number; standalone?: boolean; prompt?: boolean } = {}) => installEnv(ua, o.touch ?? 5, o.standalone ?? false, o.prompt ?? false);
const DAY = 864e5, NOW = 1_800_000_000_000;

describe('как установить в этом браузере', () => {
  it('iPhone Safari — шаги «Поделиться»; Chrome/Firefox на iOS 16.4+ — те же шаги; старше или встроенный просмотр — «откройте в Safari»', () => {
    expect(installWay(env(UA.iphoneSafari))).toBe('ios');
    expect(installWay(env(UA.iphoneSafari15))).toBe('ios');
    expect(installWay(env(UA.iphoneChrome))).toBe('ios');
    expect(installWay(env(UA.iphoneFirefox))).toBe('ios');
    expect(installWay(env(UA.iphoneChrome16_4))).toBe('ios');
    expect(installWay(env(UA.iphoneChrome16_3))).toBe('safari');
    expect(installWay(env(UA.iphoneChrome15))).toBe('safari');
    expect(installWay(env(UA.iphoneInstagram))).toBe('inapp');
    expect(installWay(env(UA.iphoneWebview))).toBe('inapp');
    expect(installWay(env(UA.iphoneOpera))).toBe('safari');
    expect(env(UA.iphoneChrome).browser).toBe('chrome-ios');
    expect(env(UA.iphoneFirefox).browser).toBe('firefox-ios');
    expect(env(UA.iphoneSafari).ios).toEqual([17, 4]);
  });
  it('iOS: событие beforeinstallprompt не учитывается (его там нет; эмуляция в десктопном Chrome не должна менять способ)', () => {
    expect(installWay(env(UA.iphoneSafari, { prompt: true }))).toBe('ios');
    expect(installWay(env(UA.iphoneChrome, { prompt: true }))).toBe('ios');
  });
  it('iPad с настольным User-Agent (Macintosh + касание) — это iOS; компьютер Mac без касания — нет', () => {
    expect(env(UA.ipadDesktopUa, { touch: 5 }).platform).toBe('ios');
    expect(installWay(env(UA.ipadDesktopUa, { touch: 5 }))).toBe('ios');
    expect(env(UA.ipadDesktopUa, { touch: 0 }).platform).toBe('desktop');
  });
  it('Android: есть пойманное системное окно — оно; нет — через меню; встроенный просмотр — нечем', () => {
    expect(installWay(env(UA.androidChrome, { prompt: true }))).toBe('native');
    expect(installWay(env(UA.androidChrome))).toBe('menu');
    expect(installWay(env(UA.androidFirefox))).toBe('menu');
    expect(installWay(env(UA.androidSamsung))).toBe('menu');
    expect(env(UA.androidSamsung).browser).toBe('samsung');
    expect(env(UA.androidWebview).browser).toBe('inapp');
    expect(installWay(env(UA.androidWebview))).toBe('inapp');
    expect(installWay(env(UA.androidWebview, { prompt: true }))).toBe('inapp');
  });
  it('компьютер: только с системным окном (Chrome/Edge); установленное приложение — никак', () => {
    expect(installWay(env(UA.desktopChrome, { touch: 0 }))).toBeNull();
    expect(installWay(env(UA.desktopChrome, { touch: 0, prompt: true }))).toBe('native');
    expect(installWay(env(UA.iphoneSafari, { standalone: true }))).toBeNull();
    expect(installWay(env(UA.androidChrome, { prompt: true, standalone: true }))).toBeNull();
  });
});

describe('инструкция по браузеру и приложению', () => {
  it('iOS Safari: версию системы в User-Agent заморозили на 18_x — iOS 26 узнаём по версии Safari', () => {
    expect(env(UA.iphoneSafari26).safari).toBe(26);
    expect(env(UA.iphoneSafari26).ios).toEqual([18, 6]);
    expect(guideOf(env(UA.iphoneSafari26))).toBe('ios-safari26');
    expect(guideOf(env(UA.iphoneSafari))).toBe('ios-safari');
    expect(guideOf(env(UA.iphoneSafari15))).toBe('ios-safari');
    expect(guideOf(env(UA.ipadDesktopUa, { touch: 5 }))).toBe('ipad-safari');
  });
  it('другие браузеры на iPhone — каждый со своей инструкцией; Opera и прочие — через Safari', () => {
    expect(guideOf(env(UA.iphoneChrome))).toBe('ios-chrome');
    expect(guideOf(env(UA.iphoneChrome26))).toBe('ios-chrome');
    expect(guideOf(env(UA.iphoneFirefox))).toBe('ios-firefox');
    expect(guideOf(env(UA.iphoneEdge))).toBe('ios-edge');
    expect(guideOf(env(UA.iphoneChrome15))).toBe('open-safari');
    expect(guideOf(env(UA.iphoneOpera))).toBe('open-safari');
  });
  it('встроенные просмотры: Telegram, Viber, TikTok, Instagram — «откройте в браузере»; приложение опознаём, где UA его выдаёт', () => {
    for (const [ua, app] of [[UA.iphoneTelegram, 'telegram'], [UA.iphoneViber, 'viber'], [UA.iphoneTikTok, 'tiktok'], [UA.iphoneInstagram, 'instagram']] as const) {
      expect(guideOf(env(ua)), app).toBe('inapp-ios');
      expect(env(ua).app, app).toBe(app);
    }
    expect(guideOf(env(UA.iphoneWebview))).toBe('inapp-ios');
    expect(env(UA.iphoneWebview).app).toBeNull();
    expect(guideOf(env(UA.androidTelegram))).toBe('inapp-android');
    expect(env(UA.androidTelegram).app).toBe('telegram');
    expect(guideOf(env(UA.androidWebview))).toBe('inapp-android');
  });
  it('Android: у каждого браузера своя инструкция', () => {
    expect(guideOf(env(UA.androidChrome))).toBe('android-chrome');
    expect(guideOf(env(UA.androidChrome, { prompt: true }))).toBe('android-chrome');
    expect(guideOf(env(UA.androidSamsung))).toBe('android-samsung');
    expect(guideOf(env(UA.androidFirefox))).toBe('android-firefox');
    expect(guideOf(env(UA.androidOpera))).toBe('android-opera');
    expect(guideOf(env(UA.androidEdge))).toBe('android-edge');
    expect(guideOf(env(UA.androidYandex))).toBe('android-yandex');
  });
  it('компьютер и установленное приложение — без инструкции', () => {
    expect(guideOf(env(UA.desktopChrome, { touch: 0 }))).toBeNull();
    expect(guideOf(env(UA.iphoneSafari26, { standalone: true }))).toBeNull();
  });
});

describe('надписи системного интерфейса — на языке системы телефона', () => {
  it('язык системы: русский — русский, всё остальное (в том числе сербский) — английский', () => {
    expect(systemLang(['ru-RU', 'en'])).toBe('ru');
    expect(systemLang(['sr-RS', 'ru'])).toBe('en');
    expect(systemLang(['sr-Latn-RS'])).toBe('en');
    expect(systemLang(['en-GB'])).toBe('en');
    expect(systemLang([])).toBe('en');
    expect(systemLang(null)).toBe('en');
  });
  it('iOS: русские настоящие надписи; без русского — английские', () => {
    expect([sysLabel('share', 'ru'), sysLabel('addHome', 'ru'), sysLabel('add', 'ru')]).toEqual(['Поделиться', 'На экран «Домой»', 'Добавить']);
    expect([sysLabel('share', 'en'), sysLabel('addHome', 'en'), sysLabel('add', 'en')]).toEqual(['Share', 'Add to Home Screen', 'Add']);
  });
  it('Android: Chrome и Samsung — русские надписи; непроверенные (Firefox, Opera, Edge, Yandex) — английские даже на русском телефоне', () => {
    expect(sysLabel('chromeAddHome', 'ru')).toBe('Добавить на главный экран');
    expect(sysLabel('chromeInstallApp', 'ru')).toBe('Установить приложение');
    expect(sysLabel('samsungAddTo', 'ru')).toBe('Добавить страницу в');
    expect(sysLabel('firefoxInstall', 'ru')).toBe('Install');
    expect(sysLabel('operaAddTo', 'ru')).toBe('Add to');
    expect(sysLabel('edgeAddPhone', 'ru')).toBe('Add to phone');
    expect(sysLabel('yandexAddHome', 'ru')).toBe('Add to home screen');
    expect(sysLabel('chromeAddHome', 'en')).toBe('Add to Home screen');
  });
});

describe('когда показывать лист сам', () => {
  const st = EMPTY_INSTALL;
  it('телефон, не установлено, ни разу не показывали — да; компьютер и установленное — нет', () => {
    expect(shouldOffer(st, env(UA.iphoneSafari), NOW)).toBe(true);
    expect(shouldOffer(st, env(UA.androidChrome, { prompt: true }), NOW)).toBe(true);
    expect(shouldOffer(st, env(UA.androidFirefox), NOW)).toBe(true);
    expect(shouldOffer(st, env(UA.desktopChrome, { touch: 0, prompt: true }), NOW)).toBe(false);
    expect(shouldOffer(st, env(UA.iphoneSafari, { standalone: true }), NOW)).toBe(false);
    expect(shouldOffer(markInstalled(st), env(UA.iphoneSafari), NOW)).toBe(false);
    expect(shouldOffer(st, env(UA.androidWebview), NOW)).toBe(true);
  });
  it('Android/Chrome без системного окна сам лист не показывает (приложение, скорее всего, уже стоит); пункт меню остаётся', () => {
    expect(shouldOffer(st, env(UA.androidChrome), NOW)).toBe(false);
    expect(canInstall(env(UA.androidChrome), st)).toBe(true);
  });
  it('после «Не сейчас» — молчим 7 дней, потом снова; не больше трёх показов за всё время', () => {
    const e = env(UA.iphoneSafari);
    const d = markDismissed(markShown(st), NOW);
    expect(shouldOffer(d, e, NOW + 6 * DAY)).toBe(false);
    expect(shouldOffer(d, e, NOW + SNOOZE_DAYS * DAY)).toBe(true);
    let x = st;
    for (let i = 0; i < MAX_SHOWN; i++) x = markDismissed(markShown(x), NOW + i * 10 * DAY);
    expect(x.shown).toBe(3);
    expect(shouldOffer(x, e, NOW + 100 * DAY)).toBe(false);
    expect(shouldOffer(markShown(markShown(st)), e, NOW)).toBe(true);
  });
  it('хранилище: битое значение — как пустое; числа приводятся', () => {
    expect(readInstall(null)).toEqual(EMPTY_INSTALL);
    expect(readInstall('не json')).toEqual(EMPTY_INSTALL);
    expect(readInstall(JSON.stringify({ shown: 2.9, lastDismiss: 5, installed: true }))).toEqual({ shown: 2, lastDismiss: 5, installed: true });
    expect(readInstall(JSON.stringify({ shown: 'x' }))).toEqual(EMPTY_INSTALL);
  });
  it('пункт меню: есть, пока не установлено и есть способ', () => {
    expect(canInstall(env(UA.iphoneSafari), st)).toBe(true);
    expect(canInstall(env(UA.iphoneSafari, { standalone: true }), st)).toBe(false);
    expect(canInstall(env(UA.iphoneSafari), markInstalled(st))).toBe(false);
    expect(canInstall(env(UA.desktopChrome, { touch: 0 }), st)).toBe(false);
    expect(canInstall(env(UA.desktopChrome, { touch: 0, prompt: true }), st)).toBe(true);
  });
});

describe('мягкая карточка: обратный отсчёт', () => {
  it('«ОК» оживает через 3 секунды: 3 -> 2 -> 1 -> 0', () => {
    const t0 = 1_000_000;
    expect(COUNTDOWN_S).toBe(3);
    expect([0, 100, 999].map((d) => countdownLeft(t0, t0 + d))).toEqual([3, 3, 3]);
    expect([1000, 1500, 1999].map((d) => countdownLeft(t0, t0 + d))).toEqual([2, 2, 2]);
    expect([2000, 2400, 2999].map((d) => countdownLeft(t0, t0 + d))).toEqual([1, 1, 1]);
    expect([3000, 3001, 9000].map((d) => countdownLeft(t0, t0 + d))).toEqual([0, 0, 0]);
  });
});
