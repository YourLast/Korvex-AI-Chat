'use client';
import { adm, admCount, admLang, admLocale, admf } from '@/lib/i18n/adm';
import { useCallback, useEffect, useState } from 'react';
import type { Analytics, Bucket } from '@/lib/analytics';
import type { keysView } from '@/lib/anthropic/client';
import { reasonLabel } from '@/lib/rating';
import { fmtInt, fmtSec, fmtTok } from '@/lib/format';
import { W } from '@/lib/plural';
import { humanRunError, relTime } from '@/lib/schedule';
import { modelLabel } from '@/lib/levels';
import { Icon } from './Icon';
import { Button, Group, Notice, Row, Seg, SkeletonList, Status } from './Kit';

type AnalyticsX = Analytics & { claudeKeys?: ReturnType<typeof keysView> | null };
type ModelName = { id: string; name: string; levels: { id: string; label?: string }[]; variantOf?: string; variantName?: string };

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)} %` : '—');
const ms = (v: number | null) => (v == null ? '—' : fmtSec(v));
const bucketLabel = (b: { t: number }, kind: 'hour' | 'day', tz: string) => kind === 'hour'
  ? new Date(b.t).toLocaleTimeString(admLocale(), { timeZone: tz, hour: '2-digit', minute: '2-digit' })
  : new Date(b.t).toLocaleDateString(admLocale(), { timeZone: tz, day: '2-digit', month: '2-digit' });
const Up = () => <span className="an-th"><Icon n="thumb" sm /><span className="sr">{adm("хорошо")}</span></span>;
const Down = () => <span className="an-th"><Icon n="thumb" sm className="flip" /><span className="sr">{adm("плохо")}</span></span>;

export function Bars<S extends { t: number; errors?: number }>({ series, kind, tz, pick, unit, readLabel = adm("за период") }: { series: S[]; kind: 'hour' | 'day'; tz: string; pick: (b: S) => number; unit: (v: number) => string; readLabel?: string }) {
  const [hot, setHot] = useState<number | null>(null);
  const max = Math.max(1, ...series.map(pick));
  const total = series.reduce((s, b) => s + pick(b), 0);
  const every = kind === 'hour' ? 6 : series.length > 10 ? 7 : 1;
  return (
    <div className="an-bars k-chart" onMouseLeave={() => setHot(null)}>
      <div className="an-bars-read" aria-live="polite">
        {hot == null ? <><b className="tnum">{unit(total)}</b><span>{readLabel}</span></>
          : <><b className="tnum">{unit(pick(series[hot]))}</b><span>{bucketLabel(series[hot], kind, tz)}{series[hot].errors ? ` · ${admCount(series[hot].errors ?? 0, W.error)}` : ''}</span></>}
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
      if (!r.ok) throw new Error(admf("код {0}", r.status));
      setD((await r.json()) as Analytics);
    } catch (e) { setErr(admf("Аналитика не загрузилась ({0}).", (e as Error).message)); } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(days); try { localStorage.setItem('kx.an.days', String(days)); } catch {  } }, [days, load]);

  const mName = (id: string | null) => (id ? modelLabel(models.map((m) => ({ ...m, defaultLevel: '', levels: m.levels.map((l) => ({ id: l.id, label: l.label ?? l.id })) })), id) : '—');
  const lName = (mid: string | null, lid: string | null) => models.find((m) => m.id === mid)?.levels.find((l) => l.id === lid)?.label ?? lid ?? '—';
  const tz = d?.tz ?? 'Europe/Moscow';
  const per = d?.bucket === 'hour' ? adm("по часам") : adm("по дням");

  return (
    <div className="k-stack" data-testid="analytics">
      <div className="k-acts">
        <Seg label={adm("Период")} value={days} onChange={setDays} options={[{ value: 1, label: adm("Сутки"), testId: 'an-days-1' }, { value: 7, label: adm("7 дней"), testId: 'an-days-7' }, { value: 30, label: adm("30 дней"), testId: 'an-days-30' }]} />
        <Button kind="plain" icon="retry" busy={busy && !!d} onClick={() => void load(days)}>{adm("Обновить")}</Button>
      </div>
      {err && <Notice action={<Button kind="plain" onClick={() => void load(days)}>{adm("Повторить")}</Button>}>{err}</Notice>}
      {!d ? (!err && <><SkeletonList rows={2} /><SkeletonList rows={3} title /></>) : (
        <>
          <div className="k-list" data-testid="an-tiles">
            <div className="k-stats">
              <div className="k-stat"><small>{adm("Пользователи")}</small><b>{fmtInt(d.users.active)}<em> {adm("из")} {fmtInt(d.users.total)}</em></b><span>{adm("активных")}{d.users.added ? admf(" · новых {0}", d.users.added) : ''}</span></div>
              <div className="k-stat"><small>{adm("Чаты")}</small><b>{fmtInt(d.chats)}</b><span>{adm("новых за период")}</span></div>
              <div className="k-stat"><small>{adm("Сообщения")}</small><b>{fmtInt(d.messages.user)}</b><span>{admCount(d.messages.assistant, W.answer)}</span></div>
              <div className="k-stat"><small>{adm("Токены")}</small><b>{fmtTok(d.tokens.prompt + d.tokens.completion)}</b><span>{adm("вход")} {fmtTok(d.tokens.prompt)} {adm("· выход")} {fmtTok(d.tokens.completion)}</span></div>
              <div className="k-stat"><small>{adm("Время ответа")}</small><b>{ms(d.latency.medianMs)}</b><span>{adm("медиана · p90")} {ms(d.latency.p90Ms)}</span></div>
              <div className="k-stat"><small>{adm("Ошибки")}</small><b>{fmtInt(d.errors)}</b><span>{pct(d.errors, d.messages.assistant)} {adm("ответов")}{d.stopped ? admf(" · остановлено {0}", d.stopped) : ''}</span></div>
              <div className="k-stat"><small>{adm("Оценки")}</small><b className="an-rates"><Up />{fmtInt(d.ratings.up)}<Down />{fmtInt(d.ratings.down)}</b><span>{d.ratings.up + d.ratings.down ? admf("хороших {0}", pct(d.ratings.up, d.ratings.up + d.ratings.down)) : adm("оценок нет")}</span></div>
              <div className="k-stat"><small>{adm("Автоматизации")}</small><b>{fmtInt(d.automations.runs)}</b><span>{adm("успешно")} {d.automations.ok} {adm("· ошибок")} {d.automations.error}</span></div>
            </div>
          </div>

          <div className="k-grid2">
            <Group title={admf("Ответы моделей, {0}", per)} plain><div className="k-list k-pad"><Bars series={d.series} kind={d.bucket} tz={tz} pick={(b) => b.answers} unit={(v) => admCount(v, W.answer)} /></div></Group>
            <Group title={admf("Токены, {0}", per)} plain><div className="k-list k-pad"><Bars series={d.series} kind={d.bucket} tz={tz} pick={(b) => b.tokens} unit={(v) => admf("{0} токенов", fmtTok(v))} /></div></Group>
          </div>

          <Group title={adm("Модели и уровни")} testId="an-models" plain foot={adm("Время ответа — без ошибок. Токены: вход / выход.")}>
            {d.byModel.length === 0 ? <div className="k-list"><Row title={adm("За период ответов нет")} tone="muted" /></div> : (
              <>
                <div className="k-list k-d"><table className="k-table">
                  <thead><tr><th>{adm("Модель · уровень")}</th><th className="n">{adm("Ответы")}</th><th className="n">{adm("Вход")}</th><th className="n">{adm("Выход")}</th><th className="n">{adm("Медиана")}</th><th className="n">p90</th><th className="n">{adm("Ошибки")}</th><th className="n"><Up /></th><th className="n"><Down /></th></tr></thead>
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
                    <Row key={r.modelId + r.levelId} title={<><b className="k-b">{mName(r.modelId)}</b> · {lName(r.modelId, r.levelId)}</>} value={admCount(r.answers, W.answer)}
                      sub={admf("медиана {0} · p90 {1} · токены {2} / {3}", ms(r.medianMs), ms(r.p90Ms), fmtTok(r.promptTokens), fmtTok(r.completionTokens))}
                      sub2={<>{r.errors ? `${admCount(r.errors, W.error)} · ` : ''}<Up /> {r.up} <Down /> {r.down}</>} />
                  ))}
                </div>
              </>
            )}
          </Group>

          {(d.claude?.rows.length || (d as AnalyticsX).claudeKeys?.count) ? (
            <Group title={admf("Модели Claude (Claude API), {0}", per)} testId="an-claude" plain
              foot={adm("Вход — всё, что модель прочла (с кэшем); «из кэша» — доля входа, прочитанная из кэша (дешевле в 10 раз); запись — вход, записанный в кэш. $ — по прайсу Claude API за каждый запрос хода.")}>
              <div className="k-list">
                {(d.claude?.rows ?? []).map((r) => (
                  <Row key={r.modelId} title={<b className="k-b">{mName(r.modelId)}</b>} value={`$${r.usd.toFixed(2)}`} testId={`an-claude-${r.modelId}`}
                    sub={admf("{0} · запросов {1} · вход {2} (из кэша {3}, запись {4}) · выход {5}", admCount(r.answers, W.answer), fmtInt(r.requests), fmtTok(r.input), r.cacheShare == null ? '—' : `${Math.round(r.cacheShare * 100)} %`, fmtTok(r.cacheWrite), fmtTok(r.output))} />
                ))}
                {d.claude?.rows.length === 0 && <Row title={adm("За период ответов моделей Claude нет")} tone="muted" />}
                {(d.claude?.byKey.length ?? 0) > 0 && <Row title={adm("По ключам")} tone="muted" value={d.claude!.byKey.map((k) => admf("ключ {0}: ${1}", k.n, k.usd.toFixed(2))).join(' · ')} />}
                {(d as AnalyticsX).claudeKeys?.active && (() => { const k = (d as AnalyticsX).claudeKeys!; const a = k.active!; return (
                  <Row title={adm("Ключ Anthropic сейчас")} testId="an-claude-key" value={`${a.main ? adm("основной") : adm("запасной")} ·…${a.last4 ?? '????'}`}
                    sub={[k.lastSwitch ? admf("переключение {0}: ключ {1} → {2} ({3})", new Date(k.lastSwitch.at).toLocaleString(admLocale(), { timeZone: tz }), k.lastSwitch.from, k.lastSwitch.to, k.lastSwitch.why) : adm("переключений не было"),
                      ...k.noFunds.map((x) => admf("ключ {0} (…{1}) без денег с {2}, повтор после {3}", x.n, x.last4 ?? '????', new Date(x.at).toLocaleTimeString(admLocale(), { timeZone: tz, hour: '2-digit', minute: '2-digit' }), new Date(x.retryAt).toLocaleTimeString(admLocale(), { timeZone: tz, hour: '2-digit', minute: '2-digit' })))].join(' · ')} />
                ); })()}
              </div>
            </Group>
          ) : null}

          <Group title={adm("Сравнения: какой ответ лучше")} testId="an-compare" plain
            aside={d.compare.questions ? admf("{0} паре · голосов {1}", admCount(d.compare.questions, W.question), fmtInt(d.compare.votes)) : undefined}
            foot={adm("Пара — модель (вариант) и уровень каждой стороны; «A против B» и «B против A» — одна строка. Время — медиана ответа стороны.")}>
            {d.compare.pairs.length === 0 ? <div className="k-list"><Row title={d.compare.questions ? adm("Голосов «какой лучше» за период нет") : adm("За период сравнений не было")} tone="muted" /></div> : (
              <>
                <div className="k-list k-d"><table className="k-table" data-testid="an-pairs">
                  <thead><tr><th>{adm("Сторона A")}</th><th>{adm("Сторона B")}</th><th className="n">{adm("Голоса")}</th><th className="n">{adm("A лучше")}</th><th className="n">{adm("B лучше")}</th><th className="n">{adm("Оба хороши")}</th><th className="n">{adm("Оба плохи")}</th><th className="n">{adm("Время A / B")}</th></tr></thead>
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
                      value={admf("{0} гол.", fmtInt(r.votes))} sub={admf("A лучше {0} · B лучше {1} · оба хороши {2} · оба плохи {3}", r.aWins, r.bWins, r.ties, r.bad)} sub2={admf("время {0} / {1}", ms(r.medianA), ms(r.medianB))} />
                  ))}
                </div>
              </>
            )}
          </Group>

          <Group title={adm("Последние плохие оценки")} testId="an-down">
            {d.downFeed.length === 0 && <Row title={adm("За период плохих оценок не было")} tone="muted" />}
            {d.downFeed.map((x) => (
              <Row key={x.id} title={`${x.userName} · ${x.threadTitle ?? adm("чат удалён")}`} tone="strong" href={x.exists && x.threadId ? `/admin/chat/${x.threadId}?m=${x.messageId}` : undefined} chevron={x.exists && !!x.threadId} testId={x.exists && x.threadId ? 'an-open' : undefined}
                sub={`${mName(x.modelId)} · ${lName(x.modelId, x.levelId)}${x.durationMs ? ` · ${fmtSec(x.durationMs)}` : ''} · ${relTime(x.at, tz, Date.now(), admLang())}${x.exists ? '' : adm(" · ответ удалён")}`}
                sub2={x.reasons.length || x.comment ? <span className="k-tags">{x.reasons.map((r) => <span key={r} className="k-tag">{adm(reasonLabel(r))}</span>)}{x.comment && <span className="k-quote">«{x.comment}»</span>}</span> : undefined} />
            ))}
          </Group>

          <Group title={adm("API: запросы по ключам")} testId="an-api" aside={d.api.requests ? `${admCount(d.api.requests, W.request)} · ${admCount(d.api.errors, W.error)}` : undefined}>
            {d.api.keys.length === 0 && <Row title={adm("Запросов к API за период не было")} tone="muted" />}
            {d.api.keys.map((k) => (
              <Row key={k.keyId} title={k.name} tone="strong" sub={admf("{0} · медиана {1} · токены {2} / {3}", k.owner, ms(k.medianMs), fmtTok(k.promptTokens), fmtTok(k.completionTokens))}
                value={<>{fmtInt(k.requests)}{k.errors ? <span className="k-row-s"><br />{admCount(k.errors, W.error)}</span> : null}</>} />
            ))}
          </Group>

          <Group title={adm("Запуски автоматизаций")} testId="an-runs" aside={d.automations.runs ? admf("вручную {0} · по расписанию {1}", d.automations.manual, d.automations.schedule) : undefined}>
            {d.automations.recent.length === 0 && <Row title={adm("Запусков за период не было")} tone="muted" />}
            {d.automations.recent.map((r) => (
              <Row key={r.id} title={r.name} sub={`${relTime(r.startedAt, tz, Date.now(), admLang())} · ${r.trigger === 'manual' ? adm("вручную") : adm("по расписанию")}${r.durationMs ? ` · ${ms(r.durationMs)}` : ''}`}
                sub2={r.status === 'error' ? <>{humanRunError(r.error, admLang())}{r.error ? <span className="k-tech">{r.error.slice(0, 160)}</span> : null}</> : undefined}
                value={<Status tone={r.status === 'ok' ? 'ok' : r.status === 'error' ? 'err' : 'warn'}>{r.status === 'ok' ? adm("Готово") : r.status === 'error' ? adm("Ошибка") : adm("Идёт")}</Status>} />
            ))}
          </Group>
        </>
      )}
    </div>
  );
}
