'use client';
import { useEffect, useState } from 'react';
import { Button, CopyButton, toast } from './Kit';
import { useFT } from './orgMode';

type View = { address: string | null; tag: string; senders: string[]; hasKey: boolean; keyHint: string | null; on: boolean; key?: string };

export function OrgInbox({ folderId }: { folderId: string }) {
  const t = useFT();
  const [v, setV] = useState<View | null>(null);
  const [senders, setSenders] = useState('');
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void fetch(`/api/folders/${folderId}/inbox`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j: View | null) => { if (j) { setV(j); setSenders(j.senders.join('\n')); } }).catch(() => {});
  }, [folderId]);
  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/folders/${folderId}/inbox`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
      if (!r?.ok) { toast(t('fld.errSave'), 'error'); return null; }
      const j = await r.json() as View;
      setV(j); setSenders(j.senders.join('\n'));
      if (j.key) setKey(j.key);
      return j;
    } finally { setBusy(false); }
  };
  if (!v) return null;
  const url = typeof window !== 'undefined' ? `${window.location.origin}/api/orgs/${folderId}/ingest` : `/api/orgs/${folderId}/ingest`;
  return (
    <div className="pj-field org-in" data-testid="org-inbox">
      <span className="pj-lab">{t('org.in.title')}</span>
      {!v.on && <p className="pj-text">{t('org.in.off')}</p>}
      {v.address && (
        <div className="org-in-row">
          <small>{t('org.in.mail')}</small>
          <div className="org-in-line"><code data-testid="org-inbox-address">{v.address}</code><CopyButton text={v.address} iconOnly testId="org-inbox-copy" />
            <Button kind="plain" busy={busy} onClick={() => void post({ reissueTag: true })} testId="org-inbox-newaddr">{t('org.in.newAddr')}</Button></div>
          <small className="org-in-hint">{t('org.in.mailHint')}</small>
          <small>{t('org.in.senders')}</small>
          <textarea className="pj-area" rows={3} value={senders} onChange={(e) => setSenders(e.target.value)} placeholder={t('org.in.sendersPh')} data-testid="org-inbox-senders" />
          <div><Button busy={busy} onClick={() => void post({ senders: senders.split(/[\n,;]+/) }).then((j) => j && toast(t('org.in.saved')))} testId="org-inbox-save">{t('org.in.saveSenders')}</Button></div>
        </div>
      )}
      <div className="org-in-row">
        <small>{t('org.in.key')}</small>
        <div className="org-in-line">
          {v.hasKey && <span data-testid="org-inbox-keyset">{t('org.in.keySet', { hint: v.keyHint ?? '' })}</span>}
          <Button busy={busy} onClick={() => void post({ issueKey: true })} testId="org-inbox-issue">{v.hasKey ? t('org.in.reissue') : t('org.in.issue')}</Button>
          {v.hasKey && <Button kind="plain" busy={busy} onClick={() => { setKey(null); void post({ revokeKey: true }); }} testId="org-inbox-revoke">{t('org.in.revoke')}</Button>}
        </div>
        {key && <div className="org-in-key"><code data-testid="org-inbox-key">{key}</code><CopyButton text={key} iconOnly /><small>{t('org.in.once')}</small></div>}
        <small className="org-in-hint">{t('org.in.keyHint')} {t('org.in.endpoint', { url })}</small>
      </div>
    </div>
  );
}
