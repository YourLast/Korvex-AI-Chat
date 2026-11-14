// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TimeField } from '@/components/TimeField';
import { setClockLocales } from '@/lib/hourFormat';

afterEach(() => { cleanup(); setClockLocales(null); });
const show = (lang: 'ru' | 'en', value: string, onChange = vi.fn()) => { render(createElement(TimeField, { value, onChange, lang, label: 'Время', testId: 'tf' })); return onChange; };

describe('TimeField', () => {
  it('ru: 24 ч, AM/PM нет; ввод часов — значение в 24 ч', () => {
    setClockLocales(['en-US']);
    const on = show('ru', '09:00');
    expect(screen.queryByTestId('tf-ap')).toBeNull();
    expect((screen.getByTestId('tf-h') as HTMLInputElement).value).toBe('09');
    fireEvent.change(screen.getByTestId('tf-h'), { target: { value: '21' } });
    expect(on).toHaveBeenLastCalledWith('21:00');
  });
  it('en-US: 12 ч и AM/PM; PM -> +12 ч; часы 13 не принимаются', () => {
    setClockLocales(['en-US']);
    const on = show('en', '09:00');
    expect(screen.getByTestId('tf-ap').textContent).toBe('AM');
    fireEvent.click(screen.getByTestId('tf-ap'));
    expect(on).toHaveBeenLastCalledWith('21:00');
    on.mockClear();
    fireEvent.change(screen.getByTestId('tf-h'), { target: { value: '13' } });
    expect(on).not.toHaveBeenCalled();
    fireEvent.blur(screen.getByTestId('tf-h'));
    expect((screen.getByTestId('tf-h') as HTMLInputElement).value).toBe('09');
    fireEvent.change(screen.getByTestId('tf-m'), { target: { value: '30' } });
    expect(on).toHaveBeenLastCalledWith('09:30');
  });
  it('en-GB: 24 ч без AM/PM', () => {
    setClockLocales(['en-GB']);
    show('en', '21:00');
    expect(screen.queryByTestId('tf-ap')).toBeNull();
    expect((screen.getByTestId('tf-h') as HTMLInputElement).value).toBe('21');
  });
});
