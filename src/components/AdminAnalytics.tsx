'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Analytics, Bucket } from '@/lib/analytics';
import type { keysView } from '@/lib/anthropic/client';
import { reasonLabel } from '@/lib/rating';
import { fmtInt, fmtSec, fmtTok } from '@/lib/format';
import { count, W } from '@/lib/plural';
import { humanRunError, relTime } from '@/lib/schedule';
import { modelLabel } from '@/lib/levels';
import { Icon } from './Icon';
import { Button, Group, Notice, Row, Seg, SkeletonList, Status } from './Kit';

type AnalyticsX = Analytics & { claudeKeys?: ReturnType<typeof keysView> | null };
type ModelName = { id: string; name: string; levels: { id: string; label?: string }[]; variantOf?: string; variantName?: string };

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)} %` : '—');
const ms = (v: number | null) => (v == null ? '—' : fmtSec(v));
const bucketLabel = (b: { t: number }, kind: 'hour' | 'day', tz: string) => kind === 'hour'
  ? new Date(b.t).toLocaleTimeString('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' })
  : new Date(b.t).toLocaleDateString('ru-RU', { timeZone: tz, day: '2-digit', month: '2-digit' });
const Up = () => <span className="an-th"><Icon n="thumb" sm /><span className="sr">хорошо</span></span>;
const Down = () => <span className="an-th"><Icon n="thumb" sm className="flip" /><span className="sr">плохо</span></span>;

export function Bars<S extends { t: number; errors?: number }>({ series, kind, tz, pick, unit, readLabel = 'за период' }: { series: S[]; kind: 'hour' | 'day'; tz: string; pick: (b: S) => number; unit: (v: number) => string; readLabel?: string }) {
  const [hot, setHot] = useState<number | null>(null);
  const max = Math.max(1, ...series.map(pick));
  const total = series.reduce((s, b) => s + pick(b), 0);
  const every = kind === 'hour' ? 6 : series.length > 10 ? 7 : 1;
  return (
    <div className="an-bars k-chart" onMouseLeave={() => setHot(null)}>
      <div className="an-bars-read" aria-live="polite">
        {hot == null ? <><b className="tnum">{unit(total)}</b><span>{readLabel}</span></>
          : <><b className="tnum">{unit(pick(series[hot]))}</b><span>{bucketLabel(series[hot], kind, tz)}{series[hot].errors ? ` · ${count(series[hot].errors ?? 0, W.error)}` : ''}</span></>}
      </div>
      <div className="an-plot" role="list">
        {series.map((b, i) => {
          const v = pick(b);
          return (
            <button type="button" role="listitem" key={b.t} className="an-col" data-hot={hot === i || undefined} aria-label={`${bucketLabel(b, kind, tz)}: ${unit(v)}`}
              onMouseEnter={() => setHot(i)} onFocus={() => setHot(i)} onBlur={() => setHot(null)} onClick={() => setHot(i)}>
              <span className="an-bar" style={{ height: v ? `max(2px, ${(v / max) * 100}%)` : 0 }} />
            </button>
          );
        })}
      </div>
      <div className="an-axis" aria-hidden="true">
        {series.map((b, i) => <span key={b.t}>{i % every === 0 || i === series.length - 1 ? bucketLabel(b, kind, tz) : ''}</span>)}
      </div>
    </div>
  );
}

export function AdminAnalytics({ models }: { models: ModelName[] }) {
  const [days, setDays] = useState<1 | 7 | 30>(() => {
    try { const v = Number(localStorage.getItem('kx.an.days')); return v === 1 || v === 30 ? v : 7; } catch { return 7; }
  });
  const [d, setD] = useState<Analytics | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (n: number) => {
    setErr(''); setBusy(true);
    try {
      const r = await fetch(`/api/admin/analytics?days=${n}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`код ${r.status}`);
      setD((await r.json()) as Analytics);
    } catch (e) { setErr(`Аналитика не загрузилась (${(e as Error).message}).`); } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(days); try { localStorage.setItem('kx.an.days', String(days)); } catch {  } }, [days, load]);

  const mName = (id: string | null) => (id ? modelLabel(models.map((m) => ({ ...m, defaultLevel: '', levels: m.levels.map((l) => ({ id: l.id, label: l.label ?? l.id })) })), id) : '—');
  const lName = (mid: string | null, lid: string | null) => models.find((m) => m.id === mid)?.levels.find((l) => l.id === lid)?.label ?? lid ?? '—';
  const tz = d?.tz ?? 'Europe/Moscow';
  const per = d?.bucket === 'hour' ? 'по часам' : 'по дням';

  return (
    <div className="k-stack" data-testid="analytics">
      <div className="k-acts">
        <Seg label="Период" value={days} onChange={setDays} options={[{ value: 1, label: 'Сутки', testId: 'an-days-1' }, { value: 7, label: '7 дней', testId: 'an-days-7' }, { value: 30, label: '30 дней', testId: 'an-days-30' }]} />
        <Button kind="plain" icon="retry" busy={busy && !!d} onClick={() => void load(days)}>Обновить</Button>
      </div>
      {err && <Notice action={<Button kind="plain" onClick={() => void load(days)}>Повторить</Button>}>{err}</Notice>}
      {!d ? (!err && <><SkeletonList rows={2} /><SkeletonList rows={3} title /></>) : (
        <>
          <div className="k-list" data-testid="an-tiles">
            <div className="k-stats">
              <div className="k-stat"><small>Пользователи</small><b>{fmtInt(d.users.active)}<em> из {fmtInt(d.users.total)}</em></b><span>активных{d.users.added ? ` · новых ${d.users.added}` : ''}</span></div>
              <div className="k-stat"><small>Чаты</small><b>{fmtInt(d.chats)}</b><span>новых за период</span></div>
              <div className="k-stat"><small>Сообщения</small><b>{fmtInt(d.messages.user)}</b><span>{count(d.messages.assistant, W.answer)}</span></div>
              <div className="k-stat"><small>Токены</small><b>{fmtTok(d.tokens.prompt + d.tokens.completion)}</b><span>вход {fmtTok(d.tokens.prompt)} · выход {fmtTok(d.tokens.completion)}</span></div>
              <div className="k-stat"><small>Время ответа</small><b>{ms(d.latency.medianMs)}</b><span>медиана · p90 {ms(d.latency.p90Ms)}</span></div>
              <div className="k-stat"><small>Ошибки</small><b>{fmtInt(d.errors)}</b><span>{pct(d.errors, d.messages.assistant)} ответов{d.stopped ? ` · остановлено ${d.stopped}` : ''}</span></div>
              <div className="k-stat"><small>Оценки</small><b className="an-rates"><Up />{fmtInt(d.ratings.up)}<Down />{fmtInt(d.ratings.down)}</b><span>{d.ratings.up + d.ratings.down ? `хороших ${pct(d.ratings.up, d.ratings.up + d.ratings.down)}` : 'оценок нет'}</span></div>
              <div className="k-stat"><small>Автоматизации</small><b>{fmtInt(d.automations.runs)}</b><span>успешно {d.automations.ok} · ошибок {d.automations.error}</span></div>
            </div>
          </div>

          <div className="k-grid2">
            <Group title={`Ответы моделей, ${per}`} plain><div className="k-list k-pad"><Bars series={d.series} kind={d.bucket} tz={tz} pick={(b) => b.answers} unit={(v) => count(v, W.answer)} /></div></Group>
            <Group title={`Токены, ${per}`} plain><div className="k-list k-pad"><Bars series={d.series} kind={d.bucket} tz={tz} pick={(b) => b.tokens} unit={(v) => `${fmtTok(v)} токенов`} /></div></Group>
          </div>

          <Group title="Модели и уровни" testId="an-models" plain foot="Время ответа — без ошибок. Токены: вход / выход.">
            {d.byModel.length === 0 ? <div className="k-list"><Row title="За период ответов нет" tone="muted" /></div> : (
              <>
                <div className="k-list k-d"><table className="k-table">
                  <thead><tr><th>Модель · уровень</th><th className="n">Ответы</th><th className="n">Вход</th><th className="n">Выход</th><th className="n">Медиана</th><th className="n">p90</th><th className="n">Ошибки</th><th className="n"><Up /></th><th className="n"><Down /></th></tr></thead>
                  <tbody>
                    {d.byModel.map((r) => (
                      <tr key={r.modelId + r.levelId}>
                        <td><b>{mName(r.modelId)}</b> · {lName(r.modelId, r.levelId)}</td>
                        <td className="n">{fmtInt(r.answers)}</td><td className="n">{fmtTok(r.promptTokens)}</td><td className="n">{fmtTok(r.completionTokens)}</td>
                        <td className="n">{ms(r.medianMs)}</td><td className="n">{ms(r.p90Ms)}</td><td className="n">{r.errors || '—'}</td><td className="n">{r.up || '—'}</td><td className="n">{r.down || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                <div className="k-list k-m">
                  {d.byModel.map((r) => (
                    <Row key={r.modelId + r.levelId} title={<><b className="k-b">{mName(r.modelId)}</b> · {lName(r.modelId, r.levelId)}</>} value={count(r.answers, W.answer)}
                      sub={`медиана ${ms(r.medianMs)} · p90 ${ms(r.p90Ms)} · токены ${fmtTok(r.promptTokens)} / ${fmtTok(r.completionTokens)}`}
                      sub2={<>{r.errors ? `${count(r.errors, W.error)} · ` : ''}<Up /> {r.up} <Down /> {r.down}</>} />
                  ))}
                </div>
              </>
            )}
          </Group>

          {(d.claude?.rows.length || (d as AnalyticsX).claudeKeys?.count) ? (
            <Group title={`Модели Claude (Claude API), ${per}`} testId="an-claude" plain
              foot="Вход — всё, что модель прочла (с кэшем); «из кэша» — доля входа, прочитанная из кэша (дешевле в 10 раз); запись — вход, записанный в кэш. $ — по прайсу Claude API за каждый запрос хода.">
              <div className="k-list">
                {(d.claude?.rows ?? []).map((r) => (
                  <Row key={r.modelId} title={<b className="k-b">{mName(r.modelId)}</b>} value={`$${r.usd.toFixed(2)}`} testId={`an-claude-${r.modelId}`}
                    sub={`${count(r.answers, W.answer)} · запросов ${fmtInt(r.requests)} · вход ${fmtTok(r.input)} (из кэша ${r.cacheShare == null ? '—' : `${Math.round(r.cacheShare * 100)} %`}, запись ${fmtTok(r.cacheWrite)}) · выход ${fmtTok(r.output)}`} />
                ))}
                {d.claude?.rows.length === 0 && <Row title="За период ответов моделей Claude нет" tone="muted" />}
                {(d.claude?.byKey.length ?? 0) > 0 && <Row title="По ключам" tone="muted" value={d.claude!.byKey.map((k) => `ключ ${k.n}: $${k.usd.toFixed(2)}`).join(' · ')} />}
                {(d as AnalyticsX).claudeKeys?.active && (() => { const k = (d as AnalyticsX).claudeKeys!; const a = k.active!; return (
                  <Row title="Ключ Anthropic сейчас" testId="an-claude-key" value={`${a.main ? 'основной' : 'запасной'} ·…${a.last4 ?? '????'}`}
                    sub={[k.lastSwitch ? `переключение ${new Date(k.lastSwitch.at).toLocaleString('ru-RU', { timeZone: tz })}: ключ ${k.lastSwitch.from} → ${k.lastSwitch.to} (${k.lastSwitch.why})` : 'переключений не было',
                      ...k.noFunds.map((x) => `ключ ${x.n} (…${x.last4 ?? '????'}) без денег с ${new Date(x.at).toLocaleTimeString('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' })}, повтор после ${new Date(x.retryAt).toLocaleTimeString('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' })}`)].join(' · ')} />
                ); })()}
              </div>
            </Group>
          ) : null}

          <Group title="Сравнения: какой ответ лучше" testId="an-compare" plain
            aside={d.compare.questions ? `${count(d.compare.questions, W.question)} паре · голосов ${fmtInt(d.compare.votes)}` : undefined}
            foot="Пара — модель (вариант) и уровень каждой стороны; «A против B» и «B против A» — одна строка. Время — медиана ответа стороны.">
            {d.compare.pairs.length === 0 ? <div className="k-list"><Row title={d.compare.questions ? 'Голосов «какой лучше» за период нет' : 'За период сравнений не было'} tone="muted" /></div> : (
              <>
                <div className="k-list k-d"><table className="k-table" data-testid="an-pairs">
                  <thead><tr><th>Сторона A</th><th>Сторона B</th><th className="n">Голоса</th><th className="n">A лучше</th><th className="n">B лучше</th><th className="n">Оба хороши</th><th className="n">Оба плохи</th><th className="n">Время A / B</th></tr></thead>
                  <tbody>
                    {d.compare.pairs.map((r) => (
                      <tr key={`${r.a.modelId}${r.a.levelId}${r.b.modelId}${r.b.levelId}`}>
                        <td><b>{mName(r.a.modelId)}</b> · {lName(r.a.modelId, r.a.levelId)}</td><td><b>{mName(r.b.modelId)}</b> · {lName(r.b.modelId, r.b.levelId)}</td>
                        <td className="n">{fmtInt(r.votes)}</td><td className="n">{r.aWins ? `${r.aWins} · ${pct(r.aWins, r.votes)}` : '—'}</td><td className="n">{r.bWins ? `${r.bWins} · ${pct(r.bWins, r.votes)}` : '—'}</td>
                        <td className="n">{r.ties || '—'}</td><td className="n">{r.bad || '—'}</td><td className="n">{ms(r.medianA)} / {ms(r.medianB)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                <div className="k-list k-m">
                  {d.compare.pairs.map((r) => (
                    <Row key={`${r.a.modelId}${r.a.levelId}${r.b.modelId}${r.b.levelId}`} title={<><b className="k-b">{mName(r.a.modelId)}</b> · {lName(r.a.modelId, r.a.levelId)} — <b className="k-b">{mName(r.b.modelId)}</b> · {lName(r.b.modelId, r.b.levelId)}</>}
                      value={`${fmtInt(r.votes)} гол.`} sub={`A лучше ${r.aWins} · B лучше ${r.bWins} · оба хороши ${r.ties} · оба плохи ${r.bad}`} sub2={`время ${ms(r.medianA)} / ${ms(r.medianB)}`} />
                  ))}
                </div>
              </>
            )}
          </Group>

          <Group title="Последние плохие оценки" testId="an-down">
            {d.downFeed.length === 0 && <Row title="За период плохих оценок не было" tone="muted" />}
            {d.downFeed.map((x) => (
              <Row key={x.id} title={`${x.userName} · ${x.threadTitle ?? 'чат удалён'}`} tone="strong" href={x.exists && x.threadId ? `/admin/chat/${x.threadId}?m=${x.messageId}` : undefined} chevron={x.exists && !!x.threadId} testId={x.exists && x.threadId ? 'an-open' : undefined}
                sub={`${mName(x.modelId)} · ${lName(x.modelId, x.levelId)}${x.durationMs ? ` · ${fmtSec(x.durationMs)}` : ''} · ${relTime(x.at, tz)}${x.exists ? '' : ' · ответ удалён'}`}
                sub2={x.reasons.length || x.comment ? <span className="k-tags">{x.reasons.map((r) => <span key={r} className="k-tag">{reasonLabel(r)}</span>)}{x.comment && <span className="k-quote">«{x.comment}»</span>}</span> : undefined} />
            ))}
          </Group>

          <Group title="API: запросы по ключам" testId="an-api" aside={d.api.requests ? `${count(d.api.requests, W.request)} · ${count(d.api.errors, W.error)}` : undefined}>
            {d.api.keys.length === 0 && <Row title="Запросов к API за период не было" tone="muted" />}
            {d.api.keys.map((k) => (
              <Row key={k.keyId} title={k.name} tone="strong" sub={`${k.owner} · медиана ${ms(k.medianMs)} · токены ${fmtTok(k.promptTokens)} / ${fmtTok(k.completionTokens)}`}
                value={<>{fmtInt(k.requests)}{k.errors ? <span className="k-row-s"><br />{count(k.errors, W.error)}</span> : null}</>} />
            ))}
          </Group>

          <Group title="Запуски автоматизаций" testId="an-runs" aside={d.automations.runs ? `вручную ${d.automations.manual} · по расписанию ${d.automations.schedule}` : undefined}>
            {d.automations.recent.length === 0 && <Row title="Запусков за период не было" tone="muted" />}
            {d.automations.recent.map((r) => (
              <Row key={r.id} title={r.name} sub={`${relTime(r.startedAt, tz)} · ${r.trigger === 'manual' ? 'вручную' : 'по расписанию'}${r.durationMs ? ` · ${ms(r.durationMs)}` : ''}`}
                sub2={r.status === 'error' ? <>{humanRunError(r.error)}{r.error ? <span className="k-tech">{r.error.slice(0, 160)}</span> : null}</> : undefined}
                value={<Status tone={r.status === 'ok' ? 'ok' : r.status === 'error' ? 'err' : 'warn'}>{r.status === 'ok' ? 'Готово' : r.status === 'error' ? 'Ошибка' : 'Идёт'}</Status>} />
            ))}
          </Group>
        </>
      )}
    </div>
  );
}
