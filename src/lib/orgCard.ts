import { and, eq } from 'drizzle-orm';
import { getDb, schema } from './db';
import { getSetting, setSetting } from './settings';

export const TAXES = ['osn', 'usn_income', 'usn_income_expense', 'ausn', 'psn'] as const;
export type Tax = (typeof TAXES)[number];
export const VATS = ['none', '0', '5', '7', '10', '20', '22'] as const;
export type Vat = (typeof VATS)[number];
export type OrgCard = { inn?: string; kpp?: string; tax?: Tax | null; vat?: Vat | null; policyFileId?: string | null };

const key = (folderId: string) => `org.card.${folderId}`;
const TAX_RU: Record<Tax, string> = { osn: 'ОСН', usn_income: 'УСН «Доходы»', usn_income_expense: 'УСН «Доходы минус расходы»', ausn: 'АУСН', psn: 'ПСН (патент)' };
const VAT_RU = (v: Vat) => (v === 'none' ? 'без НДС' : `${v}%`);

export function orgCard(folderId: string | null | undefined): OrgCard {
  if (!folderId) return {};
  const c = getSetting<OrgCard | null>(key(folderId), null);
  return c && typeof c === 'object' ? c : {};
}

function folderOf(userId: string, folderId: string) {
  return getDb().select().from(schema.folders).where(and(eq(schema.folders.id, folderId), eq(schema.folders.userId, userId))).get() ?? null;
}
export function libraryFile(userId: string, folderId: string, fileId: string) {
  const f = getDb().select().from(schema.files).where(and(eq(schema.files.id, fileId), eq(schema.files.userId, userId))).get();
  return f && f.folderId === folderId && !f.threadId ? f : null;
}

export function setOrgCard(userId: string, folderId: string, p: OrgCard): OrgCard | string {
  if (!folderOf(userId, folderId)) return 'folder';
  const next: OrgCard = { ...orgCard(folderId) };
  if (p.inn !== undefined) { const v = String(p.inn ?? '').replace(/\s/g, ''); if (v && !/^(\d{10}|\d{12})$/.test(v)) return 'inn'; next.inn = v; }
  if (p.kpp !== undefined) { const v = String(p.kpp ?? '').replace(/\s/g, ''); if (v && !/^\d{4}[\dA-Z]{2}\d{3}$/.test(v)) return 'kpp'; next.kpp = v; }
  if (p.tax !== undefined) { if (p.tax !== null && !(TAXES as readonly string[]).includes(p.tax)) return 'tax'; next.tax = p.tax; }
  if (p.vat !== undefined) { if (p.vat !== null && !(VATS as readonly string[]).includes(p.vat)) return 'vat'; next.vat = p.vat; }
  if (p.policyFileId !== undefined) { if (p.policyFileId && !libraryFile(userId, folderId, p.policyFileId)) return 'policy'; next.policyFileId = p.policyFileId || null; }
  setSetting(key(folderId), next, userId);
  return next;
}

export function orgCardText(name: string, c: OrgCard, policyName?: string | null): string | null {
  const parts = [
    c.inn ? `ИНН ${c.inn}` : '', c.kpp ? `КПП ${c.kpp}` : '',
    c.tax ? `система налогообложения: ${TAX_RU[c.tax]}` : '', c.vat ? `ставка НДС: ${VAT_RU(c.vat)}` : '',
    policyName ? `учётная политика — файл «${policyName}» (приложен к чату)` : '',
  ].filter(Boolean);
  return parts.length ? `Карточка организации «${name}»: ${parts.join('; ')}. Учитывай её во всех расчётах этой организации.` : null;
}

export type OrgHeader = { name: string; inn?: string; kpp?: string; tax?: Tax; vat?: Vat };
export function orgHeader(userId: string, folderId: string | null): OrgHeader | null {
  if (!folderId) return null;
  const c = orgCard(folderId);
  if (!c.inn && !c.kpp && !c.tax && !c.vat) return null;
  const f = folderOf(userId, folderId);
  if (!f) return null;
  return { name: f.name, ...(c.inn ? { inn: c.inn } : {}), ...(c.kpp ? { kpp: c.kpp } : {}), ...(c.tax ? { tax: c.tax } : {}), ...(c.vat ? { vat: c.vat } : {}) };
}

export function orgCardFor(userId: string, folderId: string | null): string | null {
  if (!folderId) return null;
  const f = folderOf(userId, folderId);
  if (!f) return null;
  const c = orgCard(folderId);
  const pol = c.policyFileId ? libraryFile(userId, folderId, c.policyFileId) : null;
  return orgCardText(f.name, c, pol?.name ?? null);
}
