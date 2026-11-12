import { describe, expect, it } from 'vitest';
import { estTokens } from '@/lib/tokest';

const EN = 'The Provider may hold, limit or release funds received for the Merchant when it reasonably believes that the account is exposed to elevated risk of chargebacks, fraud or non-compliance with these terms. Fees are charged per transaction and are deducted from the settlement amount before payout.\n';
const RU = 'Поставщик обязуется передать Покупателю товар в сроки, установленные настоящим Договором, а Покупатель обязуется принять товар и оплатить его в течение десяти банковских дней с момента получения счёта. Стороны несут ответственность в соответствии с законодательством Российской Федерации.\n';
const TABLE = '12.03.2026;ООО «Ромашка»;Акт № 17;125000,50;НДС 20%;25000,10\n13.03.2026;ИП Иванов;Акт № 18;48200,00;НДС 20%;9640,00\n14.03.2026;АО «Кедр-Сервис»;Акт № 19;310450,75;НДС 20%;62090,15\n';
const SR = 'Zakupac se obavezuje da prostor koristi isključivo u poslovne svrhe i da ga održava u ispravnom stanju. Zakupnina se plaća unapred, do petog dana u mesecu, na račun zakupodavca. U slučaju kašnjenja duže od petnaest dana, zakupodavac ima pravo da raskine ugovor.\n';
const UK = 'Цей договір набирає чинності з дати підписання і діє три роки. Жодна зі сторін не може передавати права та обов’язки за цим договором третім особам без письмової згоди іншої сторони.\n';

describe('оценка токенов (по составу знаков, сверена с токенизатором движка)', () => {
  it.each([
    ['английская проза', EN, 216],
    ['русская проза', RU, 260],
    ['таблица с цифрами (xlsx / csv)', TABLE, 592],
    ['сербский (латиница)', SR, 352],
    ['украинский', UK, 240],
  ])('%s — в пределах ±20 %% от настоящего счёта', (_n, s, real) => {
    const e = estTokens(s.repeat(4));
    expect(e / real).toBeGreaterThan(0.8);
    expect(e / real).toBeLessThan(1.2);
  });
  it('таблица с цифрами дороже прозы той же длины (число режется по цифре); русская проза чуть дороже английской', () => {
    const per = (s: string) => estTokens(s.repeat(4)) / (s.length * 4);
    expect(per(TABLE)).toBeGreaterThan(per(RU) * 1.5);
    expect(per(RU)).toBeGreaterThan(per(EN));
  });
  it('длинный текст — по выборке, тот же порядок величины', () => {
    const one = estTokens(RU.repeat(50));
    const big = estTokens(RU.repeat(5000));
    expect(big / (one * 100)).toBeGreaterThan(0.9);
    expect(big / (one * 100)).toBeLessThan(1.1);
  });
  it('пусто — 0, пробелы и иероглифы не ломают', () => {
    expect(estTokens('')).toBe(0);
    expect(estTokens('   \n  ')).toBeGreaterThan(0);
    expect(estTokens('本协议自双方签字盖章之日起生效。'.repeat(10))).toBeGreaterThan(50);
  });
});
