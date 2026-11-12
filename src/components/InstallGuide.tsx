'use client';
import type { ReactNode } from 'react';
import { useT } from '@/lib/i18n/react';
import { guideOf, sysLabel, type App, type Browser, type InstallEnv, type SysKey, type SysLang } from '@/lib/install';
import { AddDialog, AndroidDialog, Bar, Ico, Menu, ShareSheet, type BarV } from './InstallArt';

const APP_NAME: Record<App, string> = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', telegram: 'Telegram', viber: 'Viber', whatsapp: 'WhatsApp', snapchat: 'Snapchat', line: 'LINE', twitter: 'X', linkedin: 'LinkedIn', pinterest: 'Pinterest', vk: 'VK', wechat: 'WeChat' };
type Step = { text: string; hint?: string; art?: ReactNode };

const labeller = (sys: SysLang, browser: Browser) => (k: SysKey) => sysLabel(k, ['firefox', 'opera', 'edge', 'yandex'].includes(browser) ? 'en' : sys);

export function InstallGuide({ env, sys, hasPrompt, onNative, onCopy, onDone }: { env: InstallEnv; sys: SysLang; hasPrompt: boolean; onNative: () => void; onCopy: () => void; onDone: () => void }) {
  const t = useT();
  const id = guideOf(env);
  if (!id) return null;
  const L = labeller(sys, env.browser);
  const tap = (k: SysKey) => t('install.g.tap', { item: L(k) });
  const choose = (k: SysKey) => t('install.g.choose', { item: L(k) });
  const ios = env.platform === 'ios';
  const inapp = id === 'inapp-ios' || id === 'inapp-android';
  const safariOpen = id === 'open-safari';
  const shareArt = <ShareSheet addHome={L('addHome')} />;
  const addArt = (v: 'ios' | 'ios26') => <AddDialog v={v} cancel={L('cancel')} title={L('addHome')} add={L('add')} />;
  const addStep = (v: 'ios' | 'ios26'): Step => ({ text: tap('add'), hint: v === 'ios26' ? t('install.h.ios26.keep') : t('install.g.nameHint'), art: addArt(v) });
  const sheetStep: Step = { text: choose('addHome'), hint: t('install.g.scroll'), art: shareArt };
  const shareStep = (hint?: string): Step => ({ text: choose('share'), hint, art: <Menu os="ios" rows={[{}, { label: L('share'), icon: 'share', hl: true }, {}, {}]} /> });
  const andMenu = (rows: { label?: string; hl?: boolean; chev?: boolean; icon?: 'plusBox' }[]) => <Menu os="android" rows={rows} />;
  const confirmBtn = env.browser === 'samsung' || env.browser === 'android-chrome' || env.browser === 'other' ? (env.browser === 'samsung' ? L('samsungAdd') : L('chromeInstall')) : sysLabel('samsungAdd', 'en');
  const andDialog: Step = { text: t('install.g.tap', { item: confirmBtn }), hint: t('install.h.and.confirm'), art: <AndroidDialog cancel={L('cancel')} ok={confirmBtn} /> };
  const dots = (v: BarV, text: string, hint?: string): Step => ({ text, hint, art: <Bar v={v} /> });

  let title = ios ? t('install.iosTitle') : t('install.andTitle');
  let lead = ios ? t('install.iosLead') : t('install.andLead');
  let steps: Step[] = [];
  switch (id) {
    case 'ios-safari26': steps = [dots('ios26', t('install.s.ios26.more'), t('install.h.ios26.more')), shareStep(), sheetStep, addStep('ios26')]; break;
    case 'ios-safari': steps = [dots('ios18', tap('share'), t('install.h.safariBottom')), sheetStep, addStep('ios')]; break;
    case 'ipad-safari': steps = [dots('ipad', tap('share'), t('install.h.ipadTop')), sheetStep, addStep('ios')]; break;
    case 'ios-chrome': steps = [dots('chrome-ios', tap('share'), t('install.h.addrRight')), sheetStep, addStep('ios')]; break;
    case 'ios-firefox': steps = [dots('firefox-ios', tap('share'), t('install.h.addrRight')), sheetStep, addStep('ios')]; break;
    case 'ios-edge': steps = [dots('edge-ios', t('install.s.edge.more')), shareStep(t('install.h.edge.noShare')), sheetStep, addStep('ios')]; break;
    case 'inapp-ios':
    case 'inapp-android': {
      const named = env.app ? APP_NAME[env.app] : null;
      title = named ? t('install.inappTitleApp', { app: named }) : t('install.inappTitle');
      lead = t('install.inappLead');
      steps = [
        dots('inapp', t('install.s.inapp.menu'), t('install.h.inapp.menu')),
        { text: t('install.g.choose', { item: id === 'inapp-ios' ? L('openSafari') : L('openBrowser') }), hint: t('install.h.inapp.open'),
          art: <Menu os={id === 'inapp-ios' ? 'ios' : 'android'} rows={[{ label: L('copyLink'), icon: 'copy' }, { label: id === 'inapp-ios' ? L('openSafari') : L('openBrowser'), icon: 'arrow', hl: true }, {}]} /> },
        { text: t('install.s.inapp.then') },
      ];
      break;
    }
    case 'open-safari': title = t('install.safariTitle'); lead = t('install.safariText'); break;
    case 'android-chrome': steps = [dots('android', t('install.s.and.dotsTop')), { text: choose('chromeAddHome'), hint: t('install.g.or', { item: L('chromeInstallApp') }), art: andMenu([{}, {}, { label: L('chromeAddHome'), icon: 'plusBox', hl: true }, {}]) }, andDialog]; break;
    case 'android-samsung': steps = [dots('samsung', t('install.s.and.menuBottomRight')), { text: choose('samsungAddTo'), art: andMenu([{}, { label: L('samsungAddTo'), hl: true, chev: true }, {}]) }, { text: choose('samsungHome'), art: andMenu([{}, { label: L('samsungHome'), hl: true }, {}]) }, andDialog]; break;
    case 'android-firefox': steps = [dots('android', t('install.s.and.dotsTop')), { text: choose('firefoxInstall'), hint: t('install.g.or', { item: L('firefoxAddHome') }), art: andMenu([{}, { label: L('firefoxInstall'), hl: true }, {}, {}]) }, andDialog]; break;
    case 'android-opera': steps = [dots('android', t('install.s.and.menuAny'), t('install.h.and.menuAny')), { text: choose('operaAddTo'), hint: t('install.g.menuHint'), art: andMenu([{}, { label: L('operaAddTo'), hl: true, chev: true }, {}]) }, { text: choose('operaHome'), art: andMenu([{}, { label: L('operaHome'), hl: true }, {}]) }, andDialog]; break;
    case 'android-edge': steps = [dots('edge-android', t('install.s.and.menuBottomCenter')), { text: choose('edgeAddPhone'), hint: t('install.g.menuHint'), art: andMenu([{}, { label: L('edgeAddPhone'), hl: true }, {}]) }, andDialog]; break;
    case 'android-yandex': steps = [dots('android', t('install.s.and.dotsTop')), { text: choose('yandexAddHome'), hint: t('install.g.menuHint'), art: andMenu([{}, { label: L('yandexAddHome'), hl: true }, {}]) }, andDialog]; break;
    default: steps = [dots('android', t('install.s.and.menuAny'), t('install.h.and.menuAny')), { text: choose('chromeAddHome'), hint: t('install.g.or', { item: L('chromeInstallApp') }), art: andMenu([{}, {}, { label: L('chromeAddHome'), icon: 'plusBox', hl: true }, {}]) }, andDialog];
  }
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const intent = typeof window === 'undefined' ? '' : `intent://${window.location.host}${window.location.pathname}#Intent;scheme=https;package=com.android.chrome;end`;

  return (
    <div className="ins-pane" data-testid="install-guide" data-guide={id} data-os={ios ? 'ios' : 'android'}>
      <span className="ins-icon ins-icon--sm" aria-hidden="true"><img src="/icon-512.png" alt="" width={56} height={56} /></span>
      <h2 id="ins-t">{title}</h2>
      <p className="ins-lead">{lead}</p>
      {hasPrompt && !ios && (
        <div className="ins-acts ins-acts--tight">
          <button type="button" className="ins-primary" data-testid="install-native" onClick={onNative}>{t('install.install')}</button>
          <p className="ins-or">{t('install.manual')}</p>
        </div>
      )}
      {steps.length > 0 && (
        <ol className="ins-steps ins-steps--art">
          {steps.map((s, i) => (
            <li key={i} data-step={i + 1}>
              <div className="ins-step-h"><span className="ins-n" aria-hidden="true">{i + 1}</span><span className="ins-st"><b>{s.text}</b>{s.hint && <small>{s.hint}</small>}</span></div>
              {s.art && <div className="ins-art">{s.art}</div>}
            </li>
          ))}
        </ol>
      )}
      <div className="ins-acts">
        {(inapp || safariOpen) && <button type="button" className="ins-primary" data-testid="install-copy" onClick={onCopy}><Ico n="copy" size={18} />{t('install.copyLink')}</button>}
        {id === 'inapp-android' && <a className="ins-secondary" data-testid="install-open-chrome" href={intent}>{t('install.openChrome')}</a>}
        <button type="button" className={inapp || safariOpen ? 'ins-plain' : 'ins-primary'} data-autofocus="" data-testid="install-gotit" onClick={onDone}>{t('install.gotIt')}</button>
      </div>
      <span hidden data-origin={origin} />
    </div>
  );
}
