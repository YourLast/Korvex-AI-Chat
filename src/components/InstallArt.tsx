import type { ReactNode } from 'react';
import { useBrand } from './BrandCtx';

export type IcoName = 'share' | 'dotsH' | 'dotsV' | 'burger' | 'back' | 'fwd' | 'tabs' | 'book' | 'plusBox' | 'reload' | 'lock' | 'home' | 'star' | 'close' | 'sidebar' | 'plus' | 'copy' | 'link' | 'arrow';
const P: Record<IcoName, ReactNode> = {
  share: <><path d="M12 15.5V3.5" /><path d="M8.2 7.2 12 3.4l3.8 3.8" /><path d="M7.5 10.5H6.4A1.9 1.9 0 0 0 4.5 12.4v6.2a1.9 1.9 0 0 0 1.9 1.9h11.2a1.9 1.9 0 0 0 1.9-1.9v-6.2a1.9 1.9 0 0 0-1.9-1.9h-1.1" /></>,
  dotsH: <><circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none" /></>,
  dotsV: <><circle cx="12" cy="5.5" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="18.5" r="1.6" fill="currentColor" stroke="none" /></>,
  burger: <><path d="M5 7h14M5 12h14M5 17h14" /></>,
  back: <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />,
  fwd: <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />,
  tabs: <><rect x="4.5" y="7.5" width="12" height="12" rx="2.4" /><path d="M8 4.5h9.2a2.3 2.3 0 0 1 2.3 2.3V16" /></>,
  book: <><path d="M12 6.3C10.3 5 7.8 4.6 4.5 4.8v12.9c3.3-.2 5.8.2 7.5 1.5 1.7-1.3 4.2-1.7 7.5-1.5V4.8c-3.3-.2-5.8.2-7.5 1.5Z" /><path d="M12 6.3v12.9" /></>,
  plusBox: <><rect x="4" y="4" width="16" height="16" rx="3.4" /><path d="M12 8.4v7.2M8.4 12h7.2" /></>,
  reload: <><path d="M18.2 9.2A6.6 6.6 0 1 0 19 13" /><path d="M18.6 4.8v4.6h-4.6" /></>,
  lock: <><rect x="6.5" y="10.5" width="11" height="8" rx="2" /><path d="M9 10.5V8.4a3 3 0 0 1 6 0v2.1" /></>,
  home: <><path d="M4.5 11 12 4.5l7.5 6.5" /><path d="M6.5 9.8V19h11V9.8" /></>,
  star: <path d="m12 4.6 2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7Z" />,
  close: <path d="m6.5 6.5 11 11m0-11-11 11" />,
  sidebar: <><rect x="4" y="5.5" width="16" height="13" rx="2.4" /><path d="M9.5 5.5v13" /></>,
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2.4" /><path d="M15.5 8.5V6.9a2.4 2.4 0 0 0-2.4-2.4H6.9a2.4 2.4 0 0 0-2.4 2.4v6.2a2.4 2.4 0 0 0 2.4 2.4h1.6" /></>,
  link: <><path d="M10.2 13.8a3.6 3.6 0 0 0 5.1 0l2.6-2.6a3.6 3.6 0 0 0-5.1-5.1l-.9.9" /><path d="M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-2.6 2.6a3.6 3.6 0 0 0 5.1 5.1l.9-.9" /></>,
  arrow: <path d="M7 17 17 7M9 7h8v8" />,
};
export function Ico({ n, size = 20 }: { n: IcoName; size?: number }) {
  return <svg className="ia-i" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{P[n]}</svg>;
}
const Hl = ({ children, className = '' }: { children: ReactNode; className?: string }) => <span className={`ia-hl ${className}`}>{children}</span>;
const Skel = ({ w = 60 }: { w?: number }) => <i className="ia-sk" style={{ width: `${w}%` }} />;

export type BarV = 'ios26' | 'ios18' | 'ipad' | 'chrome-ios' | 'firefox-ios' | 'edge-ios' | 'android' | 'samsung' | 'edge-android' | 'inapp';
const Url = ({ lead, tail }: { lead?: ReactNode; tail?: ReactNode }) => (
  <span className="ia-url">{lead}<span className="ia-url-t">korvex</span>{tail}</span>
);

export function Bar({ v }: { v: BarV }) {
  const os = v.endsWith('ios') || v === 'ios26' || v === 'ios18' || v === 'ipad' ? 'ia--ios' : 'ia--and';
  let body: ReactNode;
  switch (v) {
    case 'ios26':
      body = <div className="ia-row ia-row--26"><span className="ia-circ"><Ico n="back" /></span><Url lead={<span className="ia-aa">aA</span>} tail={<Ico n="reload" size={16} />} /><Hl className="ia-circ"><Ico n="dotsH" /></Hl></div>;
      break;
    case 'ios18':
      body = <div className="ia-stack"><div className="ia-row"><Url lead={<span className="ia-aa">aA</span>} tail={<Ico n="reload" size={16} />} /></div><div className="ia-tb"><Ico n="back" /><Ico n="fwd" /><Hl><Ico n="share" /></Hl><Ico n="book" /><Ico n="tabs" /></div></div>;
      break;
    case 'ipad':
      body = <div className="ia-row ia-row--top"><Ico n="sidebar" /><Ico n="back" /><Url lead={<span className="ia-aa">aA</span>} tail={<Ico n="reload" size={16} />} /><Hl><Ico n="share" /></Hl><Ico n="plus" /><Ico n="tabs" /></div>;
      break;
    case 'chrome-ios':
      body = <div className="ia-row ia-row--top"><span className="ia-url ia-url--chrome"><Ico n="lock" size={15} /><span className="ia-url-t">korvex</span><Hl><Ico n="share" size={18} /></Hl></span><Ico n="tabs" /><Ico n="dotsV" /></div>;
      break;
    case 'firefox-ios':
      body = <div className="ia-row ia-row--top"><span className="ia-url ia-url--ff"><Ico n="lock" size={15} /><span className="ia-url-t">korvex</span><Hl><Ico n="share" size={18} /></Hl></span><Ico n="tabs" /><Ico n="burger" /></div>;
      break;
    case 'edge-ios':
      body = <div className="ia-tb ia-tb--edge"><Ico n="back" /><Ico n="fwd" /><Hl><Ico n="dotsH" /></Hl><Ico n="tabs" /><Ico n="home" /></div>;
      break;
    case 'samsung':
      body = <div className="ia-tb ia-tb--sam"><Ico n="back" /><Ico n="fwd" /><Ico n="home" /><Ico n="star" /><Ico n="tabs" /><Hl><Ico n="burger" /></Hl></div>;
      break;
    case 'edge-android':
      body = <div className="ia-tb ia-tb--edge"><Ico n="back" /><Ico n="fwd" /><Hl><Ico n="burger" /></Hl><Ico n="tabs" /><Ico n="home" /></div>;
      break;
    case 'inapp':
      body = <div className="ia-row ia-row--top ia-row--inapp"><Ico n="close" /><span className="ia-inapp-t">korvex</span><Hl><Ico n="dotsH" /></Hl></div>;
      break;
    default:
      body = <div className="ia-row ia-row--top"><span className="ia-url ia-url--chrome"><Ico n="lock" size={15} /><span className="ia-url-t">korvex</span></span><Ico n="tabs" /><Hl><Ico n="dotsV" /></Hl></div>;
  }
  return <div className={`ia ia-bar ${os}`} data-art={v} aria-hidden="true">{body}</div>;
}

export type MenuRow = { label?: string; hl?: boolean; icon?: IcoName; chev?: boolean };
export function Menu({ os, rows }: { os: 'ios' | 'android'; rows: MenuRow[] }) {
  return (
    <div className={`ia ia-menu ${os === 'ios' ? 'ia--ios' : 'ia--and'}`} data-art="menu" aria-hidden="true">
      {rows.map((r, i) => {
        const row = (
          <span className={`ia-mr${r.hl ? ' is-hl' : ''}`} key={i}>
            <span className="ia-mi">{r.icon ? <Ico n={r.icon} size={18} /> : <i className="ia-mi-sk" />}</span>
            {r.label ? <b>{r.label}</b> : <Skel w={30 + ((i * 17) % 35)} />}
            {r.chev && <Ico n="fwd" size={16} />}
          </span>
        );
        return r.hl ? <Hl className="ia-mr-hl" key={i}>{row}</Hl> : row;
      })}
    </div>
  );
}

export function ShareSheet({ addHome }: { addHome: string }) {
  const { name, short, logoUrl } = useBrand(); const icon = logoUrl ?? '/icon-192.png';
  return (
    <div className="ia ia--ios ia-sheet" data-art="sheet" aria-hidden="true">
      <i className="ia-grab" />
      <div className="ia-sh-head"><img src={icon} alt="" width={34} height={34} /><span><b>{name}</b><small>{short.toLowerCase()}</small></span></div>
      <div className="ia-sh-list">
        <span className="ia-mr"><span className="ia-mi"><i className="ia-mi-sk" /></span><Skel w={40} /></span>
        <Hl className="ia-mr-hl"><span className="ia-mr is-hl"><span className="ia-mi"><Ico n="plusBox" size={18} /></span><b>{addHome}</b></span></Hl>
        <span className="ia-mr"><span className="ia-mi"><i className="ia-mi-sk" /></span><Skel w={52} /></span>
      </div>
    </div>
  );
}

export function AddDialog({ v, cancel, title, add }: { v: 'ios' | 'ios26'; cancel: string; title: string; add: string }) {
  const { name, short, logoUrl } = useBrand(); const icon = logoUrl ?? '/icon-192.png';
  return (
    <div className="ia ia--ios ia-dlg" data-art="add-dialog" aria-hidden="true">
      <div className="ia-dlg-h"><span className="ia-dlg-c">{cancel}</span><b>{title}</b><Hl><span className="ia-dlg-a">{add}</span></Hl></div>
      <div className="ia-dlg-b">
        <div className="ia-dlg-f"><img src={icon} alt="" width={44} height={44} /><span><b>{name}</b><small>{short.toLowerCase()}</small></span></div>
        {v === 'ios26' && <div className="ia-dlg-t"><Skel w={46} /><i className="ia-tg" /></div>}
      </div>
    </div>
  );
}

export function AndroidDialog({ cancel, ok }: { cancel: string; ok: string }) {
  const { name, short, logoUrl } = useBrand(); const icon = logoUrl ?? '/icon-192.png';
  return (
    <div className="ia ia--and ia-adlg" data-art="android-dialog" aria-hidden="true">
      <div className="ia-adlg-f"><img src={icon} alt="" width={40} height={40} /><span><b>{name}</b><small>{short.toLowerCase()}</small></span></div>
      <div className="ia-adlg-a"><span>{cancel}</span><Hl><span className="ia-adlg-ok">{ok}</span></Hl></div>
    </div>
  );
}
