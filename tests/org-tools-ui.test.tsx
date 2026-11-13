// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DocsPanel } from '@/components/OrgDocs';
import { OrgModeCtx } from '@/components/orgMode';

beforeEach(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/card')) return new Response(JSON.stringify({ card: { inn: '7701234567' } }));
    return new Response(JSON.stringify({ docs: [{ id: 'd1', name: 'Выписки/kl_to_1c.txt', size: 10, mime: 'text/plain', type: 'statement', date: null, from: '2026-10-01', to: '2026-10-31', number: null, sum: null, library: true }], counts: { statement: 1 } }));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const open = (onAdd: (c: unknown[], text?: string) => void) => render(createElement(OrgModeCtx.Provider, { value: true, children: createElement(DocsPanel, { open: true, onClose: () => {}, org: 'org', orgName: 'Ромашка', onAdd }) }));

describe('сценарии в панели документов', () => {
  it('«Сверить банк с 1С» + документ → файлы и готовый запрос с ИНН, периодом и именем файла', async () => {
    const onAdd = vi.fn();
    open(onAdd);
    await waitFor(() => expect(screen.getAllByTestId('org-doc').length).toBe(1));
    fireEvent.click(screen.getByTestId('org-sc-bank'));
    fireEvent.click(screen.getByTestId('org-doc'));
    fireEvent.click(screen.getByTestId('org-add'));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    const [chips, text] = onAdd.mock.calls[0] as [{ id: string }[], string];
    expect(chips.map((c) => c.id)).toEqual(['d1']);
    expect(text).toMatch(/^Сверь выписку банка с разноской в 1С по организации «Ромашка» \(ИНН 7701234567\) за период с \d{2}\.\d{2}\.\d{4} по \d{2}\.\d{2}\.\d{4} \(файлы: «kl_to_1c\.txt»\)/);
  });
  it('сценарий без документов — запрос по документам чата; без сценария — только файлы, как раньше', async () => {
    const onAdd = vi.fn();
    open(onAdd);
    await waitFor(() => expect(screen.getAllByTestId('org-doc').length).toBe(1));
    expect((screen.getByTestId('org-add') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('org-sc-vat'));
    fireEvent.click(screen.getByTestId('org-add'));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd.mock.calls[0][1]).toContain('(файлы: документы этого чата)');
    fireEvent.click(screen.getByTestId('org-sc-vat'));
    fireEvent.click(screen.getByTestId('org-doc'));
    fireEvent.click(screen.getByTestId('org-add'));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(2));
    expect(onAdd.mock.calls[1][1]).toBeUndefined();
  });
});
