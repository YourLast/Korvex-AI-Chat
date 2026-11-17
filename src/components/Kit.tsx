'use client';
import { adm } from '@/lib/i18n/adm';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { Popover, useIsMobile } from './Popover';
import { Topbar } from './Shell';
import { LangSwitch } from './LangSwitch';
import { useT } from '@/lib/i18n/react';
import '@/styles/kit.css';
import { useBrand } from './BrandCtx';
import { FOOTER_LINK } from '@/ext/client';


export function KPage({ title, sub, heading, desc, action, topTools, testId, children }: {
  title: string; sub?: string; heading?: ReactNode; desc?: ReactNode; action?: ReactNode; topTools?: ReactNode; testId?: string; children: ReactNode;
}) {
  return (
    <>
      <Topbar title={title} sub={sub}>{topTools}</Topbar>
      <div className="page"><div className="k-page" data-testid={testId}>
        <header className="k-head">
          <div className="k-head-t"><h1>{heading ?? title}</h1>{desc && <p>{desc}</p>}</div>
          {action && <div className="k-head-a">{action}</div>}
        </header>
        {children}
      </div></div>
      <ToastHost />
    </>
  );
}

function PageFoot() {
  const b = useBrand();
  if (!b.footer) return <footer className="page-foot"><span>{b.name}</span></footer>;
  const i = FOOTER_LINK ? b.footer.indexOf(FOOTER_LINK.word) : -1;
  return (
    <footer className="page-foot" data-testid="site-footer">
      <span>{i < 0 || !FOOTER_LINK ? b.footer : <>{b.footer.slice(0, i)}<a href={FOOTER_LINK.href} target="_blank" rel="noopener">{FOOTER_LINK.word}</a>{b.footer.slice(i + FOOTER_LINK.word.length)}</>}</span>
    </footer>
  );
}

export function KSolo({ children, wide, testId }: { children: ReactNode; wide?: boolean; testId?: string }) {
  return (
    <div className="app app--solo"><main className="main">
      <LangSwitch />
      <div className="k-solo"><div className={`k-solo-in${wide ? ' k-solo-in--wide' : ''}`} data-testid={testId}>{children}</div></div>
      <PageFoot />
    </main></div>
  );
}


export function Group({ title, aside, foot, children, plain, testId, id }: { title?: ReactNode; aside?: ReactNode; foot?: ReactNode; children: ReactNode; plain?: boolean; testId?: string; id?: string }) {
  return (
    <section className="k-sec" data-testid={testId} id={id}>
      {(title || aside) && <div className="k-sec-h"><h2>{title}</h2>{aside && <span className="k-sec-aside">{aside}</span>}</div>}
      {plain ? children : <div className="k-list">{children}</div>}
      {foot && <div className="k-sec-foot">{foot}</div>}
    </section>
  );
}

type RowBase = { title: ReactNode; sub?: ReactNode; sub2?: ReactNode; value?: ReactNode; right?: ReactNode; icon?: string; tone?: 'danger' | 'muted' | 'strong'; testId?: string; chevron?: boolean; className?: string };

export function Row({ title, sub, sub2, value, right, icon, tone, testId, chevron, className, onClick, href, disabled, id }: RowBase & { onClick?: () => void; href?: string; disabled?: boolean; id?: string }) {
  const cls = `k-row${tone ? ` k-row--${tone}` : ''}${className ? ' ' + className : ''}`;
  const body = (
    <>
      {icon && <span className="k-row-i"><Icon n={icon} sm /></span>}
      <span className="k-row-m">
        <span className="k-row-t">{title}</span>
        {sub && <span className="k-row-s">{sub}</span>}
        {sub2 && <span className="k-row-s">{sub2}</span>}
      </span>
      {value !== undefined && value !== null && value !== '' && <span className="k-row-v">{value}</span>}
      {right}
      {chevron && <Icon n="chev-right" sm className="k-chev" />}
    </>
  );
  if (href) return <Link href={href} className={cls} data-testid={testId} id={id}>{body}</Link>;
  if (onClick) return <button type="button" className={cls} onClick={onClick} disabled={disabled} data-testid={testId} id={id}>{body}</button>;
  return <div className={cls} data-testid={testId} id={id}>{body}</div>;
}

export function SwitchRow({ title, sub, checked, onChange, disabled, testId }: { title: ReactNode; sub?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; testId?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} className="k-row" onClick={() => onChange(!checked)} data-testid={testId}>
      <span className="k-row-m"><span className="k-row-t">{title}</span>{sub && <span className="k-row-s">{sub}</span>}</span>
      <Switch checked={checked} />
    </button>
  );
}

export function Switch({ checked, onChange, label, testId, disabled }: { checked: boolean; onChange?: (v: boolean) => void; label?: string; testId?: string; disabled?: boolean }) {
  if (!onChange) return <span className="k-switch" data-on={checked || undefined} aria-hidden="true" />;
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className="k-switch-hit" data-testid={testId}
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}>
      <span className="k-switch" data-on={checked || undefined} aria-hidden="true" />
    </button>
  );
}

export type Opt<T extends string | number> = { value: T; label: ReactNode; hint?: ReactNode; testId?: string };

export function PickerRow<T extends string | number>({ title, value, options, onChange, testId, sub }: { title: ReactNode; value: T; options: Opt<T>[]; onChange: (v: T) => void; testId?: string; sub?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const cur = options.find((o) => o.value === value);
  return (
    <div className="k-pick" data-open={open || undefined}>
      <button type="button" className="k-row" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} data-testid={testId}>
        <span className="k-row-m"><span className="k-row-t">{title}</span>{sub && <span className="k-row-s">{sub}</span>}</span>
        <span className="k-row-v" data-testid={testId ? `${testId}-value` : undefined}>{cur?.label ?? String(value)}</span>
        <Icon n="chev-down" sm className="k-chev k-chev--down" />
      </button>
      {open && (
        <div className="k-opts" id={id} role="radiogroup">
          {options.map((o) => (
            <button type="button" key={String(o.value)} role="radio" aria-checked={o.value === value} className="k-row k-opt" data-testid={o.testId}
              onClick={() => { onChange(o.value); setOpen(false); }}>
              <span className="k-row-m"><span className="k-row-t">{o.label}</span>{o.hint && <span className="k-row-s">{o.hint}</span>}</span>
              {o.value === value && <Icon n="check" sm className="k-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SelectRow({ title, value, options, onChange, testId, sub, display }: { title: ReactNode; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; testId?: string; sub?: ReactNode; display?: ReactNode }) {
  const cur = options.find((o) => o.value === value);
  return (
    <label className="k-row k-select">
      <span className="k-row-m"><span className="k-row-t">{title}</span>{sub && <span className="k-row-s">{sub}</span>}</span>
      <span className="k-row-v">{display ?? cur?.label ?? value}</span>
      <Icon n="chev-ud" sm className="k-chev" />
      <select value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} aria-label={typeof title === 'string' ? title : undefined}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function Field({ label, value, onChange, placeholder, type = 'text', multiline, rows = 3, maxLength, min, max, inputMode, autoComplete, invalid, testId, mono, autoFocus, required, minLength, name, id, trailing, readOnly }: {
  label: ReactNode; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; multiline?: boolean; rows?: number; maxLength?: number; min?: number; max?: number;
  inputMode?: 'text' | 'numeric' | 'email' | 'url'; autoComplete?: string; invalid?: boolean; testId?: string; mono?: boolean; autoFocus?: boolean; required?: boolean; minLength?: number; name?: string; id?: string; trailing?: ReactNode; readOnly?: boolean;
}) {
  const input = multiline
    ? <textarea value={value} rows={rows} maxLength={maxLength} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} data-testid={testId} autoFocus={autoFocus} required={required} name={name} id={id} />
    : <input type={type} value={value} maxLength={maxLength} min={min} max={max} minLength={minLength} placeholder={placeholder} inputMode={inputMode} autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)} data-testid={testId} autoFocus={autoFocus} required={required} name={name} id={id} readOnly={readOnly} />;
  return (
    <label className={`k-field${mono ? ' k-field--mono' : ''}`} data-invalid={invalid || undefined}>
      <span className="k-field-l">{label}</span>
      {trailing ? <span className="k-field-in">{input}{trailing}</span> : input}
    </label>
  );
}

export function ReadField({ label, value, testId }: { label: ReactNode; value: ReactNode; testId?: string }) {
  return <div className="k-field k-field--ro"><span className="k-field-l">{label}</span><span className="k-field-v" data-testid={testId}>{value}</span></div>;
}

export function Seg<T extends string | number>({ value, options, onChange, label, testId, block }: { value: T; options: Opt<T>[]; onChange: (v: T) => void; label: string; testId?: string; block?: boolean }) {
  return (
    <div className={`k-seg${block ? ' k-seg--block' : ''}`} role="radiogroup" aria-label={label} data-testid={testId}>
      {options.map((o) => (
        <button type="button" key={String(o.value)} role="radio" aria-checked={o.value === value} onClick={() => o.value !== value && onChange(o.value)} data-testid={o.testId}>{o.label}</button>
      ))}
    </div>
  );
}


type BtnProps = { children: ReactNode; onClick?: () => void; icon?: string; kind?: 'primary' | 'secondary' | 'plain' | 'danger'; size?: 'md' | 'lg'; block?: boolean; disabled?: boolean; busy?: boolean; testId?: string; type?: 'button' | 'submit'; href?: string; label?: string };
export function Button({ children, onClick, icon, kind = 'secondary', size = 'md', block, disabled, busy, testId, type = 'button', href, label }: BtnProps) {
  const cls = `k-btn k-btn--${kind}${size === 'lg' ? ' k-btn--lg' : ''}${block ? ' k-btn--block' : ''}`;
  const inner = <>{busy ? <span className="k-spin" aria-hidden="true" /> : icon ? <Icon n={icon} sm /> : null}<span>{children}</span></>;
  if (href) return <Link href={href} className={cls} data-testid={testId} aria-label={label}>{inner}</Link>;
  return <button type={type} className={cls} onClick={onClick} disabled={disabled || busy} aria-busy={busy || undefined} data-testid={testId} aria-label={label}>{inner}</button>;
}

export function DestructiveButton({ children, confirm, onConfirm, testId, block, icon = 'trash', asRow, iconOnly }: {
  children: ReactNode; confirm: { title: string; message?: ReactNode; action: string }; onConfirm: () => Promise<unknown> | void; testId?: string; block?: boolean; icon?: string; asRow?: boolean; iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); setOpen(false); } };
  return (
    <>
      {iconOnly
        ? <button type="button" className="k-icon-btn" aria-label={typeof children === 'string' ? children : confirm.action} title={typeof children === 'string' ? children : confirm.action} onClick={() => setOpen(true)} data-testid={testId}><Icon n={icon} sm /></button>
        : asRow
        ? <button type="button" className="k-row k-row--danger k-row--center" onClick={() => setOpen(true)} data-testid={testId}><span className="k-row-m"><span className="k-row-t">{children}</span></span></button>
        : <Button kind="danger" icon={icon} block={block} onClick={() => setOpen(true)} testId={testId}>{children}</Button>}
      <Confirm open={open} title={confirm.title} message={confirm.message} action={confirm.action} busy={busy} onCancel={() => setOpen(false)} onConfirm={go} />
    </>
  );
}

export function Confirm({ open, title, message, action, onConfirm, onCancel, busy }: { open: boolean; title: string; message?: ReactNode; action: string; onConfirm: () => void; onCancel: () => void; busy?: boolean }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); onCancel(); } };
    window.addEventListener('keydown', key, true);
    const id = requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[data-cancel]')?.focus({ preventScroll: true }));
    return () => { window.removeEventListener('keydown', key, true); cancelAnimationFrame(id); };
  }, [open, onCancel]);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="k-alert-scrim" onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div className="k-alert" role="alertdialog" aria-modal="true" aria-label={title} ref={ref} data-testid="confirm">
        <div className="k-alert-t"><b>{title}</b>{message && <p>{message}</p>}</div>
        <div className="k-alert-a">
          <button type="button" className="k-btn k-btn--secondary k-btn--lg" data-cancel onClick={onCancel} disabled={busy} data-testid="confirm-cancel">{t('common.cancel')}</button>
          <button type="button" className="k-btn k-btn--danger-fill k-btn--lg" onClick={onConfirm} disabled={busy} data-testid="confirm-ok">{busy ? <span className="k-spin" aria-hidden="true" /> : null}{action}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function useConfirm(): [ReactNode, (o: { title: string; message?: ReactNode; action: string }) => Promise<boolean>] {
  const [st, setSt] = useState<{ title: string; message?: ReactNode; action: string; resolve: (v: boolean) => void } | null>(null);
  const ask = useCallback((o: { title: string; message?: ReactNode; action: string }) => new Promise<boolean>((resolve) => setSt({ ...o, resolve })), []);
  const done = (v: boolean) => { st?.resolve(v); setSt(null); };
  const ui = <Confirm open={!!st} title={st?.title ?? ''} message={st?.message} action={st?.action ?? ''} onCancel={() => done(false)} onConfirm={() => done(true)} />;
  return [ui, ask];
}

export function CopyButton({ text, label: label0, testId, kind = 'secondary', block, size, onCopied, iconOnly }: { text: string; label?: string; testId?: string; kind?: BtnProps['kind']; block?: boolean; size?: 'md' | 'lg'; onCopied?: () => void; iconOnly?: boolean }) {
  const t = useT();
  const label = label0 ?? t('common.copy');
  const [ok, setOk] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); } catch { fallbackCopy(text); }
    setOk(true); onCopied?.(); setTimeout(() => setOk(false), 1600);
  };
  if (iconOnly) return <button type="button" className="k-icon-btn" aria-label={ok ? t('common.copied') : label} title={ok ? t('common.copied') : label} onClick={(e) => { e.stopPropagation(); void copy(); }} data-testid={testId}><Icon n={ok ? 'check' : 'copy'} sm /></button>;
  return <Button kind={kind} size={size} block={block} icon={ok ? 'check' : 'copy'} onClick={copy} testId={testId}>{ok ? t('common.copied') : label}</Button>;
}
function fallbackCopy(text: string) {
  const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select();
  try { document.execCommand('copy'); } catch {  } t.remove();
}


export function Sheet({ open, onClose, title, sub, anchor, children, foot, testId, focusFirst }: { open: boolean; onClose: () => void; title: string; sub?: string; anchor?: HTMLElement | null; children: ReactNode; foot?: ReactNode; testId?: string; focusFirst?: string }) {
  const mobile = useIsMobile();
  if (mobile) return <Popover anchor={anchor ?? null} open={open} onClose={onClose} title={title} sub={sub} sheetClass="k-sheet" bodyClass="k-sheet-body" foot={foot} testId={testId}>{children}</Popover>;
  return <Dialog open={open} onClose={onClose} title={title} sub={sub} foot={foot} testId={testId} focusFirst={focusFirst}>{children}</Dialog>;
}

function Dialog({ open, onClose, title, sub, children, foot, testId, focusFirst }: { open: boolean; onClose: () => void; title: string; sub?: string; children: ReactNode; foot?: ReactNode; testId?: string; focusFirst?: string }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const back = document.activeElement as HTMLElement | null;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); } };
    document.addEventListener('keydown', key);
    const id = requestAnimationFrame(() => (ref.current?.querySelector<HTMLElement>(focusFirst ?? 'input, textarea, button:not([data-x])'))?.focus({ preventScroll: true }));
    return () => { document.removeEventListener('keydown', key); cancelAnimationFrame(id); back?.focus?.({ preventScroll: true }); };
  }, [open, focusFirst]);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="k-dlg-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="k-dlg" role="dialog" aria-modal="true" aria-label={title} ref={ref} data-testid={testId}>
        <div className="k-dlg-h"><div><b>{title}</b>{sub && <small>{sub}</small>}</div><button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose} data-x data-testid="pop-close"><Icon n="x" /></button></div>
        <div className="k-dlg-b">{children}</div>
        {foot && <div className="k-dlg-f">{foot}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function timeZones(current: string): { value: string; label: string }[] {
  let list: string[] = ['Europe/Kaliningrad', 'Europe/Moscow', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Omsk', 'Asia/Novosibirsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Yakutsk', 'Asia/Vladivostok', 'Asia/Magadan', 'Asia/Kamchatka', 'Europe/Minsk', 'Asia/Almaty', 'Asia/Dubai', 'Europe/Belgrade', 'Europe/Berlin', 'Europe/London', 'America/New_York', 'UTC'];
  try { list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? list; } catch {  }
  return (list.includes(current) ? list : [current, ...list]).map((z) => ({ value: z, label: z.replace(/_/g, ' ') }));
}


export function EmptyState({ icon = 'spark', title, text, children, testId }: { icon?: string; title: ReactNode; text?: ReactNode; children?: ReactNode; testId?: string }) {
  return (
    <div className="k-empty" data-testid={testId}>
      <span className="k-empty-i"><Icon n={icon} /></span>
      <b>{title}</b>
      {text && <p>{text}</p>}
      {children && <div className="k-empty-a">{children}</div>}
    </div>
  );
}

export function SkeletonList({ rows = 3, title }: { rows?: number; title?: boolean }) {
  const t = useT();
  return (
    <div className="k-sec" aria-busy="true" aria-label={t('common.loading')}>
      {title && <div className="k-sec-h"><span className="k-sk" style={{ width: 96, height: 12 }} /></div>}
      <div className="k-list">
        {Array.from({ length: rows }, (_, i) => (
          <div className="k-row" key={i}><span className="k-row-m"><span className="k-sk" style={{ width: `${56 - i * 9}%`, height: 14 }} /><span className="k-sk" style={{ width: `${34 + i * 7}%`, height: 10, marginTop: 8 }} /></span></div>
        ))}
      </div>
    </div>
  );
}

export function PageSkeleton({ title }: { title: string }) {
  return (
    <>
    <Topbar title={adm(title)} />{}
    <div className="page"><div className="k-page" aria-busy="true">
      <header className="k-head"><div className="k-head-t"><span className="k-sk" style={{ width: 180, height: 28 }} /><span className="k-sk" style={{ width: '70%', height: 14, marginTop: 12 }} /></div></header>
      <SkeletonList rows={3} title /><SkeletonList rows={2} title />
    </div></div>
    </>
  );
}

export function Notice({ tone = 'error', children, action, testId }: { tone?: 'error' | 'info' | 'ok'; children: ReactNode; action?: ReactNode; testId?: string }) {
  return (
    <div className={`k-notice k-notice--${tone}`} role={tone === 'error' ? 'alert' : 'status'} data-testid={testId}>
      <Icon n={tone === 'error' ? 'alert' : tone === 'ok' ? 'check' : 'spark'} sm /><span className="k-notice-t">{children}</span>{action}
    </div>
  );
}

export function Status({ tone, children }: { tone: 'ok' | 'warn' | 'err' | 'off'; children: ReactNode }) {
  return <span className="k-status"><i className={`k-dot k-dot--${tone}`} />{children}</span>;
}


type T = { id: number; text: string; tone?: 'ok' | 'error' };
let toasts: T[] = [];
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export function toast(text: string, tone: 'ok' | 'error' = 'ok') {
  const t = { id: ++seq, text, tone };
  toasts = [...toasts.slice(-2), t]; emit();
  setTimeout(() => { toasts = toasts.filter((x) => x.id !== t.id); emit(); }, tone === 'error' ? 4200 : 2400);
}
const EMPTY: T[] = [];
function ToastHost() {
  const list = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => toasts, () => EMPTY);
  if (!list.length || typeof document === 'undefined') return null;
  const dock = document.querySelector('.dock');
  const above = dock ? Math.max(0, window.innerHeight - dock.getBoundingClientRect().top) + 8 : null;
  return createPortal(
    <div className="k-toasts" aria-live="polite" role="status" style={above !== null ? { bottom: above } : undefined}>
      {list.map((t) => <div key={t.id} className={`k-toast${t.tone === 'error' ? ' k-toast--err' : ''}`} data-testid="k-toast"><Icon n={t.tone === 'error' ? 'alert' : 'check'} sm />{t.text}</div>)}
    </div>,
    document.body,
  );
}
export { ToastHost };
