import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { extractNode } from '@/lib/extractNode';

async function office(files: Record<string, string>): Promise<Buffer> {
  const z = new JSZip();
  for (const [n, c] of Object.entries(files)) z.file(n, c);
  return Buffer.from(await z.generateAsync({ type: 'nodebuffer' }));
}

describe('извлекатель ядра', () => {
  it('текст и код — как есть; двоичное без расширения — «не читается»', async () => {
    expect((await extractNode(Buffer.from('привет, мир\nвторая строка'), 'note.txt')).text).toBe('привет, мир\nвторая строка');
    expect((await extractNode(Buffer.from('a=1'), 'run.cfg')).info.format).toBe('text');
    await expect(extractNode(Buffer.from([0, 1, 2, 3, 0, 255]), 'blob.bin')).rejects.toThrow(/не читается/);
  });
  it('таблица xlsx — каждый лист в CSV с заголовком листа', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['склад', 'остаток'], ['А-1', 12.5]]), 'Март');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['итог', 42]]), 'Итоги');
    const r = await extractNode(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer, 'wells.xlsx');
    expect(r.text).toContain('[sheet Март]\nсклад,остаток\nА-1,12.5');
    expect(r.text).toContain('[sheet Итоги]\nитог,42');
    expect(r.info).toMatchObject({ format: 'xlsx', sheets: 2 });
  });
  it('docx — абзацы по строкам, сущности и табуляция раскрыты', async () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>Договор №7</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Сумма: </w:t></w:r><w:r><w:tab/><w:t>1 000 &amp; НДС</w:t></w:r></w:p><w:p/></w:body></w:document>';
    const r = await extractNode(await office({ 'word/document.xml': xml, '[Content_Types].xml': '<Types/>' }), 'contract.docx');
    expect(r.text).toBe('Договор №7\nСумма: \t1 000 & НДС');
  });
  it('pptx — слайды по порядку номеров', async () => {
    const s = (t: string) => `<p:sld><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`;
    const r = await extractNode(await office({ 'ppt/slides/slide10.xml': s('Десятый'), 'ppt/slides/slide2.xml': s('Второй'), 'ppt/slides/slide1.xml': s('Первый') }), 'deck.pptx');
    expect(r.text).toBe('[slide 1]\nПервый\n\n[slide 2]\nВторой\n\n[slide 3]\nДесятый');
  });
  it('PDF — текстовый слой по страницам', async () => {
    const f = path.join(process.cwd(), 'tests', 'e2e', 'fixtures', 'brief.pdf');
    if (!fs.existsSync(f)) return;
    const r = await extractNode(fs.readFileSync(f), 'brief.pdf');
    expect(r.info).toMatchObject({ format: 'pdf', pages: 2 });
    expect(r.text.startsWith('[page 1]\n')).toBe(true);
    expect(r.text).toContain('[page 2]');
  });
});
