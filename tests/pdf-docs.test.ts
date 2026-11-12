// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const st = vi.hoisted(() => ({ opened: [] as string[], destroyed: [] as string[], fail: false, gate: null as null | Promise<void> }));
vi.mock('@/components/fileview/pdfjs', async (orig) => {
  const o = await orig<typeof import('@/components/fileview/pdfjs')>();
  const lib = {
    Util: { transform: (a: number[], b: number[]) => [...a, ...b] },
    getDocument: (p: { data?: Uint8Array; url?: string }) => {
      const tag = p.url ?? `bytes:${p.data?.length}`;
      st.opened.push(tag);
      return {
        destroy: async () => { st.destroyed.push(tag); },
        promise: (async () => {
          if (st.gate) await st.gate;
          if (st.fail) throw new Error('bad pdf');
          return { numPages: 5, getPage: async () => ({ getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, transform: [] }), getTextContent: async () => ({ items: [{ str: 'x' }] }) }) };
        })(),
      };
    },
  };
  return { ...o, loadPdfjs: async () => lib as never };
});
import { _pdfDocsState, _resetPdfDocs, acquirePdf, KEEP, peekPdf, prefetchPdf } from '@/components/fileview/pdfDocs';

let fetched: string[] = [];
beforeEach(() => {
  _resetPdfDocs(); st.opened = []; st.destroyed = []; st.fail = false; st.gate = null; fetched = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { fetched.push(String(url)); return new Response(new Uint8Array([37, 80, 68, 70])); }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('кэш PDF: второе открытие без загрузки', () => {
  it('тот же файл второй раз — тот же документ, ни запроса, ни разбора; peekPdf отдаёт его сразу', async () => {
    const a = await acquirePdf('f1');
    expect(fetched).toEqual(['/api/files/f1/pdf?wait=12000']);
    a.release();
    expect(peekPdf('f1')?.doc).toBe(a.doc);
    const b = await acquirePdf('f1');
    expect(b.doc).toBe(a.doc);
    expect(fetched.length).toBe(1);
    expect(st.opened.length).toBe(1);
    b.release();
  });
  it('два окна ждут один и тот же файл — загрузка одна', async () => {
    const [a, b] = await Promise.all([acquirePdf('f1'), acquirePdf('f1')]);
    expect(a.doc).toBe(b.doc);
    expect(fetched.length).toBe(1);
    a.release(); b.release();
  });
  it('размеры страниц и текст страниц живут вместе с документом: после повторного открытия они уже известны', async () => {
    const a = await acquirePdf('f1');
    a.sizes[7] = [595, 842];
    expect(await a.text(2)).toEqual([{ str: 'x' }]);
    a.release();
    const b = await acquirePdf('f1');
    expect(b.sizes[7]).toEqual([595, 842]);
    expect(b.sizes[1]).toEqual([600, 800]);
    b.release();
  });
  it('PDF по адресу: pdf.js берёт файл кусками (Range), байты целиком не качаем; не вышло — целиком', async () => {
    const a = await acquirePdf('f2', undefined, undefined, true);
    expect(st.opened).toEqual(['/api/files/f2/pdf']);
    expect(fetched.length).toBe(0);
    a.release();
    st.fail = true;
    await acquirePdf('f3', undefined, undefined, true).catch(() => {});
    expect(st.opened.slice(1)).toEqual(['/api/files/f3/pdf', 'bytes:4']);
    expect(fetched).toEqual(['/api/files/f3/pdf?wait=12000']);
  });
});

describe('кэш PDF: память', () => {
  it(`держится не больше ${KEEP} документов: самый давний из неиспользуемых выбрасывается и освобождается`, async () => {
    for (const id of ['a', 'b', 'c']) (await acquirePdf(id)).release();
    expect(_pdfDocsState().ids).toEqual(['a', 'b', 'c']);
    (await acquirePdf('d')).release();
    expect(_pdfDocsState().ids).toEqual(['b', 'c', 'd']);
    expect(st.destroyed).toEqual(['bytes:4']);
    expect(peekPdf('a')).toBeNull();
  });
  it('документ, который сейчас показан, не выбрасывается, пока на него есть ссылка', async () => {
    const shown = await acquirePdf('a');
    for (const id of ['b', 'c', 'd', 'e']) (await acquirePdf(id)).release();
    expect(peekPdf('a')).not.toBeNull();
    expect(_pdfDocsState().ids).toContain('a');
    shown.release();
    (await acquirePdf('f')).release();
    expect(_pdfDocsState().ids.length).toBe(KEEP);
    expect(peekPdf('d')).toBeNull();
  });
  it('недавно открытый переживает давний: порядок — по последнему использованию', async () => {
    for (const id of ['a', 'b', 'c']) (await acquirePdf(id)).release();
    (await acquirePdf('a')).release();
    (await acquirePdf('d')).release();
    expect(_pdfDocsState().ids.sort()).toEqual(['a', 'c', 'd']);
  });
});

describe('кэш PDF: сбои и отмена', () => {
  it('сбой не кэшируется: следующее открытие пробует заново', async () => {
    st.fail = true;
    await expect(acquirePdf('f1')).rejects.toThrow();
    expect(_pdfDocsState().ids).toEqual([]);
    st.fail = false;
    const a = await acquirePdf('f1');
    expect(a.doc).toBeTruthy();
    a.release();
  });
  it('все ушли, пока документ готовился (закрыли панель) — загрузка прекращается и в кэше не остаётся', async () => {
    let open!: () => void;
    st.gate = new Promise<void>((r) => { open = r; });
    const ac = new AbortController();
    const p = acquirePdf('f1', undefined, ac.signal).then(() => 'ok', (e: Error) => e.name);
    await vi.waitFor(() => expect(st.opened.length).toBe(1));
    ac.abort();
    expect(await p).toBe('AbortError');
    expect(_pdfDocsState().ids).toEqual([]);
    open();
  });
  it('prefetchPdf — тихий подогрев: документ в кэше без ссылки, сбой не бросает', async () => {
    prefetchPdf('p1');
    await vi.waitFor(() => expect(peekPdf('p1')).not.toBeNull());
    expect(_pdfDocsState().refs).toEqual([0]);
    st.fail = true;
    expect(() => prefetchPdf('p2')).not.toThrow();
  });
});
