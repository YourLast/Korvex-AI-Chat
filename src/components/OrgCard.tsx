'use client';
import { useEffect, useState } from 'react';
import { Button, toast } from './Kit';
import { useFT } from './orgMode';
import { errText } from '@/lib/i18n/errors';

type Card = { inn: string; kpp: string; tax: string | null; vat: string | null; policyFileId: string | null; policyName: string | null };
type Doc = { id: string; name: string; library: boolean };
const TAXES = ['osn', 'usn_income', 'usn_income_expense', 'ausn', 'psn'] as const;
const VATS = ['none', '0', '5', '7', '10', '20', '22'] as const;

export function OrgCard({ folderId }: { folderId: string }) {
  const t = useFT();
  const [c, setC] = useState<Card | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void fetch(`/api/folders/${folderId}/card`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j: { card: Card } | null) => { if (j) setC(j.card); }).catch(() => {});
    void fetch(`/api/docs?folder=${folderId}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j: { docs: Doc[] } | null) => { if (j) setDocs(j.docs.filter((d) => d.library)); })
  }, [folderId]);
  if (!c) return null;
  const save = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/folders/${folderId}/card`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inn: c.inn, kpp: c.kpp, tax: c.tax, vat: c.vat, policyFileId: c.policyFileId }) }).catch(() => null);
      const j = r ? await r.json().catch(() => ({})) as { card?: Card; error?: string } : {};
      if (!r?.ok || !j.card) { toast(j.error ? errText(t.lang, j.error) : t('fld.errSave'), 'error'); return; }
      setC(j.card); toast(t('org.card.saved'));
    } finally { setBusy(false); }
  };
  return (
    <div className="pj-field org-in" data-testid="org-card">
      <span className="pj-lab">{t('org.card.title')}</span>
      <small className="org-in-hint">{t('org.card.hint')}</small>
      <div className="org-in-line">
        <label className="org-card-f"><small>{t('org.card.inn')}</small><input className="org-card-in" inputMode="numeric" maxLength={12} value={c.inn} onChange={(e) => setC({ ...c, inn: e.target.value.replace(/\D/g, '') })} data-testid="org-card-inn" /></label>
        <label className="org-card-f"><small>{t('org.card.kpp')}</small><input className="org-card-in" maxLength={9} value={c.kpp} onChange={(e) => setC({ ...c, kpp: e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '') })} data-testid="org-card-kpp" /></label>
      </div>
      <div className="org-in-line">
        <label className="org-card-f"><small>{t('org.card.tax')}</small>
          <select className="org-card-in" value={c.tax ?? ''} onChange={(e) => setC({ ...c, tax: e.target.value || null })} data-testid="org-card-tax">
            <option value="">—</option>{TAXES.map((x) => <option key={x} value={x}>{t(`org.card.tax.${x}` as never)}</option>)}
          </select></label>
        <label className="org-card-f"><small>{t('org.card.vat')}</small>
          <select className="org-card-in" value={c.vat ?? ''} onChange={(e) => setC({ ...c, vat: e.target.value || null })} data-testid="org-card-vat">
            <option value="">—</option>{VATS.map((x) => <option key={x} value={x}>{x === 'none' ? t('org.card.vatNone') : `${x}%`}</option>)}
          </select></label>
      </div>
      <label className="org-card-f"><small>{t('org.card.policy')}</small>
        <select className="org-card-in" value={c.policyFileId ?? ''} onChange={(e) => setC({ ...c, policyFileId: e.target.value || null })} data-testid="org-card-policy">
          <option value="">{t('org.card.policyNone')}</option>{docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select></label>
      <div><Button busy={busy} onClick={() => void save()} testId="org-card-save">{t('org.card.save')}</Button></div>
    </div>
  );
}
