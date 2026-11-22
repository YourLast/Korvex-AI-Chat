'use client';
import type { AdminLimits as Data, Price } from '@/lib/adminLimits';
import { adm, admf } from '@/lib/i18n/adm';
import { localeOf } from '@/lib/i18n/core';
import { useT } from '@/lib/i18n/react';
import { roleRu } from '@/lib/roles';
import { Group, KPage } from './Kit';
import '@/styles/limits.css';

const MONTH_WEEKS = 365 / 12 / 7;
const pctOf = (a: number, b: number) => (b > 0 ? Math.floor((a / b) * 100) : 0);

function Bar({ title, used, limit, sub, loc, testId }: { title: string; used: number; limit: number; sub?: string; loc: string; testId: string }) {
  const h = (s: number) => new Intl.NumberFormat(loc, { maximumFractionDigits: s < 36_000 ? 1 : 0 }).format(s / 3600);
  const p = pctOf(used, limit);
  return (
    <div className="lad-bar" data-tone={p >= 100 ? 'over' : p >= 80 ? 'warn' : 'ok'} data-testid={testId}>
      <div className="lad-bar-top">
        <span className="lad-bar-t">{title}</span>
        <span className="lad-bar-v">{admf('{0} ч из {1} ч · {2} %', h(used), h(limit), p)}</span>
      </div>
      <div className="lad-track" role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, p)}>
        <i style={{ width: `${Math.min(100, p)}%` }} />
      </div>
      {sub && <span className="lad-sub">{sub}</span>}
    </div>
  );
}

export function AdminLimits({ d }: { d: Data }) {
  const t = useT();
  const loc = localeOf(t.lang);
  const usd = (v: number) => new Intl.NumberFormat(loc, { style: 'currency', currency: 'USD', maximumFractionDigits: v < 10 ? 2 : 0 }).format(v);
  const rub = (v: number) => new Intl.NumberFormat(loc, { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v);
  const num = (v: number, f = 0) => new Intl.NumberFormat(loc, { maximumFractionDigits: f }).format(v);
  const hrs = (s: number) => num(s / 3600, 1);
  const pct1 = (v: number) => num(v, v < 10 ? 1 : 0);
  const reset = (() => { try { return new Date(d.resetAt).toLocaleDateString(loc, { day: 'numeric', month: 'long', timeZone: d.tz }); } catch { return ''; } })();
  const rubOf = (v: number) => (d.rate ? v * d.rate.value : null);
  const weekRub = rubOf(d.usd);
  const priceLine = (p: Price) => {
    const week = p.cur === 'USD' ? d.usd : weekRub;
    if (week === null) return null;
    const share = (week / p.amount) * 100;
    return { label: admf('{0} в месяц', p.cur === 'USD' ? usd(p.amount) : rub(p.amount)), week: share, month: share * MONTH_WEEKS };
  };
  const total = d.people.reduce((a, p) => ({ used: a.used + p.used, usd: a.usd + p.usd }), { used: 0, usd: 0 });
  const modeNote = d.mode === 'off' ? adm('Недельный лимит выключен для всех (KX_WEEK_MODE=off): пороги ниже — для сведения.')
    : d.mode === 'hard' ? adm('Режим hard: отказ уже с мягкого порога.') : null;

  return (
    <KPage title={t('shell.limits')} testId="limits">
      <Group title={adm('Недельный лимит')} plain testId="lad-week"
        foot={admf('Администратор не ограничен: его расход считается так же, как у людей, и сравнивается с обычными порогами. Неделя обновится {0}.', reset)}>
        <div className="lad-in">
        <div className="lad-bars">
          <Bar loc={loc} testId="lad-soft" title={adm('Мягкий порог')} used={d.used} limit={d.soft}
            sub={adm('KX_WEEK_LIMIT. Дальше ходы человека принимаются, но идут в очереди после других людей.')} />
          <Bar loc={loc} testId="lad-hard" title={adm('Жёсткий порог')} used={d.used} limit={d.hard}
            sub={adm('KX_WEEK_HARD. Дальше новые ходы не принимаются; порог — наша безубыточность на одного человека.')} />
        </div>
        {modeNote && <p className="lad-note">{modeNote}</p>}
        </div>
      </Group>

      <Group title={adm('Деньги этой недели')} plain testId="lad-money"
        foot={admf('Час карты ≈ {0} (src/lib/week.ts); ходы Claude — по прайсу Claude API (cost_usd).', usd(d.hourUsd))}>
        <div className="lad-in">
        <dl className="lad-dl">
          <div className="lad-dl-r lad-dl-r--sum" data-testid="lad-usd"><dt>{adm('Всего')}</dt>
            <dd>{usd(d.usd)}{weekRub !== null && <> · {rub(weekRub)}</>}</dd></div>
          {d.lanes.map((l) => (
            <div className="lad-dl-r" key={l.id} data-testid={`lad-lane-${l.id}`}>
              <dt>{l.claude ? admf('{0} · Claude', l.name) : l.name}</dt>
              <dd>{l.claude ? admf("ходов: {0} · {1}", l.turns, usd(l.usd)) : admf("ходов: {0} · {1} ч карты · {2}", l.turns, hrs(l.cardS), usd(l.usd))}</dd>
            </div>
          ))}
          {!d.lanes.length && <div className="lad-dl-r"><dt>{adm('Ходов на этой неделе нет')}</dt><dd /></div>}
        </dl>
        {d.prices.length > 0 && (
          <table className="lad-tbl lad-tbl--price" data-testid="lad-prices">
            <thead><tr><th>{adm('Цена по умолчанию')}</th><th>{adm('Эта неделя')}</th><th>{adm('Месяц в таком темпе')}</th></tr></thead>
            <tbody>
              {d.prices.map((p, i) => { const r = priceLine(p); return r && (
                <tr key={i}><td>{r.label}</td><td>{pct1(r.week)} %</td><td>{pct1(r.month)} %</td></tr>
              ); })}
            </tbody>
          </table>
        )}
        {d.rate && <p className="lad-note">{admf('Рубли — по курсу ЦБ на {0}: {1} ₽ за $1{2}.', d.rate.date.split('-').reverse().join('.'), num(d.rate.value, 2), d.rate.stale ? adm(' (последний известный)') : '')}</p>}
        </div>
      </Group>

      <Group title={adm('Люди на этой неделе')} plain testId="lad-people"
        foot={d.idle ? admf('Ещё {0} без ходов на этой неделе. Личный лимит, сброс недели и совместное использование — в карточке человека.', d.idle)
          : adm('Личный лимит, сброс недели и совместное использование — в карточке человека.')}>
        <div className="lad-in">
        {d.people.length ? (
          <table className="lad-tbl" data-testid="lad-people-tbl">
            <thead><tr><th>{adm('Человек')}</th><th>{adm('Неделя, ч')}</th><th>{adm('Мягкий')}</th><th>{adm('Жёсткий')}</th><th>$</th></tr></thead>
            <tbody>
              {d.people.map((p) => (
                <tr key={p.id}>
                  <td><a href={`/admin/users/${p.id}`}>{p.name}</a><span className="lad-role">{p.limited ? (p.mult > 1 ? ` · ×${p.mult}` : '') : ` · ${p.role === 'admin' ? adm(roleRu('admin')) : adm('без лимита')}`}</span></td>
                  <td>{hrs(p.used)}</td><td>{pctOf(p.used, p.soft)} %</td><td>{pctOf(p.used, p.hard)} %</td><td>{usd(p.usd)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td>{adm('Всего')}</td><td>{hrs(total.used)}</td><td /><td /><td>{usd(total.usd)}</td></tr></tfoot>
          </table>
        ) : <p className="lad-note">{adm('На этой неделе ходов ни у кого нет.')}</p>}
        </div>
      </Group>

      <Group title={adm('Другие пороги')} plain testId="lad-other">
        <div className="lad-in">
        <dl className="lad-dl">
          <div className="lad-dl-r"><dt>{adm('Одно место — один человек: смена сессии')}</dt><dd>{d.seat.on ? admf('{0} раз за {1} мин', d.seat.switches, d.seat.windowMin) : adm('выключено')}</dd></div>
          <div className="lad-dl-r"><dt>{adm('Ходы поверх своего идущего хода')}</dt><dd>{d.seat.on ? admf('{0} за {1} мин', d.seat.concurrent, d.seat.windowMin) : adm('выключено')}</dd></div>
          <div className="lad-dl-r"><dt>{adm('К кому применяется')}</dt><dd>{d.seat.roles.map((r) => adm(roleRu(r))).join(', ')}{adm('; администратору — никогда')}</dd></div>
          <div className="lad-dl-r"><dt>{adm('Приём документов организации')}</dt><dd>{admf('{0} файлов в сутки', d.orgDay)}</dd></div>
        </dl>
        </div>
      </Group>
    </KPage>
  );
}
