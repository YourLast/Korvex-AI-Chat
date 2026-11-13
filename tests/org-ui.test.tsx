import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { OrgSwitch, quickPeriod } from '@/components/OrgDocs';
import { OrgModeCtx } from '@/components/orgMode';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/' }));

describe('организации в интерфейсе', () => {
  it('быстрые периоды: этот месяц, прошлый (через год), квартал', () => {
    const d = new Date(2026, 10, 13);
    expect(quickPeriod('this', d)).toEqual(['2026-11-01', '2026-11-30']);
    expect(quickPeriod('last', d)).toEqual(['2026-10-01', '2026-10-31']);
    expect(quickPeriod('quarter', d)).toEqual(['2026-10-01', '2026-12-31']);
    expect(quickPeriod('last', new Date(2026, 0, 10))).toEqual(['2025-12-01', '2025-12-31']);
  });
  it('переключатель: в режиме организаций — «Все организации» или имя выбранной; без режима — «Все проекты»', () => {
    const folders = [{ id: 'o1', name: 'ООО Ромашка', instruction: '', collapsed: false, sort: 0, color: 'green', count: 3 }] as never;
    const sw = (org: string | null) => createElement(OrgSwitch, { folders, org, setOrg: () => {}, onNew: () => {} });
    const all = renderToStaticMarkup(createElement(OrgModeCtx.Provider, { value: true }, sw(null)));
    expect(all).toContain('data-testid="org-switch"');
    expect(all).toContain('Все организации');
    expect(renderToStaticMarkup(sw(null))).toContain('Все проекты');
    const one = renderToStaticMarkup(createElement(OrgSwitch, { folders, org: 'o1', setOrg: () => {}, onNew: () => {} }));
    expect(one).toContain('ООО Ромашка');
    expect(one).toContain('is-on');
  });
});
