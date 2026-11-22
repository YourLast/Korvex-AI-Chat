import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { WeekRefuse } from '@/components/WeekRefuse';

describe('отказ по недельному лимиту', () => {
  it('значок часов, дата — <b>, без err-box', () => {
    const html = renderToStaticMarkup(createElement(WeekRefuse, { text: 'Недельный лимит исчерпан, новые сообщения — с понедельника, 23 ноября. Если…', date: '23 ноября' }));
    expect(html).toContain('<b class="wk-date">23 ноября</b>');
    expect(html).toContain('#i-clock');
    expect(html).not.toContain('err-box');
  });
  it('даты в тексте нет — текст как есть', () => {
    expect(renderToStaticMarkup(createElement(WeekRefuse, { text: 'Лимит исчерпан', date: null }))).toContain('<span>Лимит исчерпан</span>');
  });
});
