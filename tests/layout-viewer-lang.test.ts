import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('layout: панели файла и картинки внутри провайдера языка', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/app/layout.tsx'), 'utf8');
  const open = src.indexOf('<I18nProvider');
  const close = src.indexOf('</I18nProvider>');
  const inside = open >= 0 && close > open ? src.slice(open, close) : '';
  it('провайдер языка найден в layout', () => { expect(inside.length).toBeGreaterThan(0); });
  it('FileViewerSlot и ImageViewerSlot — между <I18nProvider> и </I18nProvider>', () => {
    expect(inside).toContain('<FileViewerSlot />');
    expect(inside).toContain('<ImageViewerSlot />');
  });
  it('и не повторяются снаружи провайдера', () => {
    const outside = src.slice(0, open) + src.slice(close);
    expect(outside).not.toContain('<FileViewerSlot />');
    expect(outside).not.toContain('<ImageViewerSlot />');
  });
});
