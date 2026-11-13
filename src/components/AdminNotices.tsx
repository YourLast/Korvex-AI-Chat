'use client';
import { adm, admErr, admLang, admLocale, admf } from '@/lib/i18n/adm';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { BannerLevel, BusyMode, BusySnap, LoadState, ManualBanner, ModelState } from '@/lib/announce';
import { MAX_TEXT } from '@/lib/announce';
import type { AlertsSnap } from '@/lib/loadAlerts';
import { relTime } from '@/lib/schedule';
import { modelLabel } from '@/lib/levels';
import { Button, Field, Group, Notice, PickerRow, Row, Seg, Sheet, Status, SwitchRow, toast } from './Kit';

export type NoticesSnap = {
  now: number;
  banner: ManualBanner;
  load: Record<string, { state: LoadState; until: number | null }>;
  models: { id: string; name: string; state: ModelState; until: number | null; probe: { ok: boolean; fails: number; at: number } | null; flag: LoadState }[];
  busy?: BusySnap;
  maxAdminOnly?: boolean;
  alerts?: AlertsSnap;
};
type M = { id: string; name: string; fullName: string; upstreamModel: string; baseUrl: string; maxConcurrent: number; images: boolean; defaultLevel?: string; variantOf?: string; variantName?: string; levels: { id: string; effort: string | null; hint: string }[] };

const LOAD = (): Record<LoadState, { label: string; hint: string }> => ({
  normal: { label: adm("Норма"), hint: adm("Без меток") },
  training: { label: adm("Обучение"), hint: adm("Метка «медленно — идёт обучение» и объявление с готовым текстом") },
  down: { label: adm("Недоступна"), hint: adm("Метка и отказ при отправке с предложением другой модели") },
});
const DURATIONS = () => ([{ value: 0, label: adm("До отмены") }, { value: 30, label: adm("30 минут") }, { value: 60, label: adm("1 час") }, { value: 180, label: adm("3 часа") }, { value: 720, label: adm("12 часов") }]);
const NOW_LABEL = (): Record<ModelState, string> => ({ ok: adm("Работает"), slow: adm("Медленно"), down: adm("Недоступна") });
const tzNow = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; } };
const toLocalInput = (ts: number | null) => (ts ? new Date(ts - new Date(ts).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');
type Until = 'none' | '1h' | '3h' | 'eod' | 'date';

async function post(path: string, body: unknown): Promise<{ ok: boolean; error?: string; data?: unknown }> {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    return { ok: r.ok, error: admErr(j.error), data: j };
  } catch { return { ok: false, error: adm("Нет связи с сервером") }; }
}

const BUSY_NONE: BusySnap = { mode: 'auto', on: false, auto: false, eta: 0, since: null, checkedAt: null, now: 0, queues: [] };
const BUSY_LABEL = (): Record<BusyMode, string> => ({ auto: adm("Авто"), off: adm("Выкл"), on: adm("Вкл") });
const BUSY_HINT = (): Record<BusyMode, string> => ({
  auto: adm("Баннер включается сам, когда ожидание для нового сообщения ≥ 1 мин держится 20 секунд, и гаснет, когда < 20 с держится 2 минуты."),
  off: adm("Общий баннер не показывается. Личная карточка очереди у отправителя остаётся — это механика, а не режим."),
  on: adm("Баннер показывается всем независимо от очереди."),
});
const BUSY_POLL_MS = 5000;
const ALERTS_NONE: AlertsSnap = { now: 0, on: true, waiting: [], log: [] };
const isAlerts = (x: unknown): x is AlertsSnap => !!x && typeof x === 'object' && Array.isArray((x as AlertsSnap).log) && typeof (x as AlertsSnap).on === 'boolean';
function logTime(ts: number, tz: string, now: number): string {
  const f = (o: Intl.DateTimeFormatOptions) => { try { return new Intl.DateTimeFormat(admLocale(), { timeZone: tz, hour12: false, ...o }); } catch { return new Intl.DateTimeFormat(admLocale(), { timeZone: 'UTC', hour12: false, ...o }); } };
  const day = (t: number) => f({ year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
  const hms = f({ hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(ts);
  return day(ts) === day(now) ? hms : `${f({ day: '2-digit', month: '2-digit' }).format(ts)} ${hms.slice(0, 5)}`;
}
const secs = (s: number) => (s >= 90 ? admf("{0} мин", Math.round(s / 60)) : admf("{0} с", Math.round(s)));

export function AdminNotices({ snap, models = [] }: { snap: NoticesSnap; models?: M[] }) {
  const router = useRouter();
  const b = snap.banner;
  const tz = tzNow();
  const [text, setText] = useState(b.text);
  const [level, setLevel] = useState<BannerLevel>(b.level);
  const [until, setUntil] = useState<Until>(b.until ? 'date' : 'none');
  const [date, setDate] = useState(toLocalInput(b.until));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [flagFor, setFlagFor] = useState<string | null>(null);
  const [mins, setMins] = useState(0);
  const [modelOpen, setModelOpen] = useState<string | null>(null);
  const [bz, setBz] = useState<BusySnap>(snap.busy ?? BUSY_NONE);
  const [maxOnly, setMaxOnly] = useState(snap.maxAdminOnly !== false);
  const [al, setAl] = useState<AlertsSnap>(snap.alerts ?? ALERTS_NONE);
  const setAlertsOn = async (v: boolean) => {
    setAl((a) => ({ ...a, on: v }));
    const r = await post('/api/admin/load-alerts', { on: v });
    if (!r.ok) { setAl((a) => ({ ...a, on: !v })); toast(r.error ?? adm("Не получилось. Попробуйте ещё раз"), 'error'); return; }
    if (isAlerts(r.data)) setAl(r.data);
    toast(v ? adm("Уведомления о нагрузке включены") : adm("Уведомления о нагрузке выключены"));
  };
  const setPolicy = async (v: boolean) => {
    setMaxOnly(v);
    const r = await post('/api/admin/policy', { maxAdminOnly: v });
    if (!r.ok) { setMaxOnly(!v); toast(r.error ?? adm("Не получилось. Попробуйте ещё раз"), 'error'); return; }
    toast(v ? adm("Max — только администраторам") : adm("Max открыт всем"));
  };
  const live = b.enabled && !!b.text && (b.until === null || b.until > snap.now);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const r = await fetch('/api/admin/busy', { cache: 'no-store' });
        if (r.ok && !stop) setBz((await r.json()) as BusySnap);
      } catch {  }
      try {
        const a = await fetch('/api/admin/load-alerts', { cache: 'no-store' });
        const j: unknown = a.ok ? await a.json() : null;
        if (!stop && isAlerts(j)) setAl(j);
      } catch {  }
    };
    void load();
    const t = window.setInterval(() => { void load(); }, BUSY_POLL_MS);
    return () => { stop = true; window.clearInterval(t); };
  }, []);
  const setMode = async (mode: BusyMode) => {
    const r = await post('/api/admin/busy', { mode });
    if (!r.ok) { toast(r.error ?? adm("Не получилось. Попробуйте ещё раз"), 'error'); return; }
    setBz(r.data as BusySnap);
    toast(admf("Высокая нагрузка: {0}", BUSY_LABEL()[mode].toLowerCase()));
  };

  const untilMs = (): number | null => {
    const now = Date.now();
    if (until === '1h') return now + 3_600_000;
    if (until === '3h') return now + 3 * 3_600_000;
    if (until === 'eod') { const d = new Date(); d.setHours(23, 59, 0, 0); return d.getTime(); }
    if (until === 'date') return date ? new Date(date).getTime() : null;
    return null;
  };
  const save = async (enabled: boolean) => {
    if (enabled && !text.trim()) { setErr(adm("Напишите текст объявления")); return; }
    if (enabled && until === 'date' && (!date || new Date(date).getTime() <= Date.now())) { setErr(adm("Выберите время в будущем или «Без срока»")); return; }
    setBusy(true); setErr('');
    const r = await post('/api/admin/banner', enabled ? { text, level, until: untilMs(), enabled } : { enabled: false });
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? adm("Не сохранилось. Попробуйте ещё раз")); return; }
    toast(enabled ? (live ? adm("Объявление обновлено") : adm("Объявление показано всем")) : adm("Объявление снято"));
    router.refresh();
  };
  const setFlag = async (key: string, s: LoadState) => {
    const r = await post('/api/admin/load-state', { state: s, model: key === '*' ? null : key, minutes: mins || undefined });
    if (!r.ok) { toast(r.error ?? adm("Не получилось. Попробуйте ещё раз"), 'error'); return; }
    const name = key === '*' ? adm("Все модели") : snap.models.find((m) => m.id === key)?.name ?? key;
    toast(`${name}: ${LOAD()[s].label.toLowerCase()}${s !== 'normal' && mins ? admf(" на {0}", DURATIONS().find((d) => d.value === mins)?.label) : ''}`);
    setFlagFor(null); router.refresh();
  };
  const rows = [{ key: '*', name: adm("Все модели"), st: null as ModelState | null, probe: null as NoticesSnap['models'][number]['probe'] }, ...snap.models.map((m) => ({ key: m.id, name: m.name, st: m.state, probe: m.probe }))];
  const flagRow = rows.find((r) => r.key === flagFor);
  const cur = (key: string): LoadState => snap.load[key]?.state ?? 'normal';
  const md = models.find((m) => m.id === modelOpen);

  return (
    <div className="k-stack" data-testid="notices">
      <Group title={adm("Объявление для всех")} aside={live ? <Status tone="ok">{adm("показывается")}</Status> : adm("не показывается")} testId="banner-form"
        foot={live ? <>{adm("Видят все")}{b.until ? <> {adm("до")} {relTime(b.until, tz, Date.now(), admLang())}</> : adm(", без срока")}{adm(". Пользователь может скрыть его до следующего изменения.")}</> : adm("Полоса над лентой чата у всех пользователей. Для скриптов: POST /api/admin/banner с ключом API администратора.")}>
        <Field label={adm("Текст")} multiline rows={2} maxLength={MAX_TEXT} value={text} placeholder={adm("Например: «Сегодня с 18:00 до 19:00 — обновление, ответы могут задерживаться»")} onChange={setText} testId="banner-text" />
        <div className="k-row"><span className="k-row-m"><span className="k-row-t">{adm("Вид")}</span></span>
          <Seg label={adm("Вид")} value={level} onChange={setLevel} options={[{ value: 'info', label: adm("Обычное"), testId: 'banner-level-info' }, { value: 'warn', label: adm("Важное"), testId: 'banner-level-warn' }]} />
        </div>
        <PickerRow title={adm("Показывать")} value={until} onChange={setUntil} testId="banner-until-pick" options={[
          { value: 'none', label: adm("Без срока") }, { value: '1h', label: adm("Час") }, { value: '3h', label: adm("3 часа") }, { value: 'eod', label: adm("До конца дня") }, { value: 'date', label: adm("До даты и времени") },
        ]} />
        {until === 'date' && <Row title={adm("До")} right={<input type="datetime-local" className="k-inl" value={date} onChange={(e) => setDate(e.target.value)} aria-label={adm("Показывать до")} data-testid="banner-until" />} />}
      </Group>
      {err && <Notice>{err}</Notice>}
      <div className="k-acts">
        <Button kind="primary" busy={busy} onClick={() => void save(true)} testId="banner-save">{live ? adm("Сохранить") : adm("Показать всем")}</Button>
        {live && <Button kind="secondary" onClick={() => void save(false)} testId="banner-off">{adm("Снять")}</Button>}
      </div>

      <Group title={adm("Нагрузка моделей")} testId="load-table" foot={adm("«Обучение» — пользователи видят метку «медленно» и объявление. «Недоступна» — отправка отклоняется с предложением другой модели. Доступность моделей проверяется раз в 15 секунд.")}>
        {rows.map((r) => {
          const e = snap.load[r.key];
          const c = cur(r.key);
          return (
            <Row key={r.key} title={r.name} tone="strong" chevron onClick={() => { setMins(0); setFlagFor(r.key); }} testId={`load-${r.key === '*' ? 'all' : r.key}`}
              sub={r.key === '*' ? adm("Флаг сразу для всех") : <>{r.st && <Status tone={r.st === 'ok' ? 'ok' : r.st === 'slow' ? 'warn' : 'err'}>{NOW_LABEL()[r.st]}</Status>}{' · '}{r.probe ? (r.probe.ok ? adm("отвечает") : admf("не отвечает ({0})", r.probe.fails)) : adm("ещё не проверялась")}</>}
              value={<>{LOAD()[c].label}{e && c !== 'normal' ? <span className="k-row-s"><br />{e.until ? admf("до {0}", relTime(e.until, tz, Date.now(), admLang())) : adm("до отмены")}</span> : null}</>} />
          );
        })}
      </Group>

      <Group title={adm("Высокая нагрузка")} aside={bz.on ? <Status tone="warn">{adm("баннер показывается")}</Status> : adm("баннера нет")} testId="busy-form"
        foot={BUSY_HINT()[bz.mode]}>
        <div className="k-row" data-testid="busy-mode-row"><span className="k-row-m"><span className="k-row-t">{adm("Высокая нагрузка")}</span><span className="k-row-s">{bz.mode === 'auto' ? (bz.auto ? adm("сейчас включена сама") : adm("сейчас не включена")) : bz.mode === 'on' ? adm("включена вручную") : adm("выключена вручную")}</span></span>
          <Seg label={adm("Высокая нагрузка")} value={bz.mode} onChange={(m) => void setMode(m)} testId="busy-mode" options={[
            { value: 'auto', label: BUSY_LABEL().auto, testId: 'busy-auto' }, { value: 'off', label: BUSY_LABEL().off, testId: 'busy-off' }, { value: 'on', label: BUSY_LABEL().on, testId: 'busy-on' },
          ]} />
        </div>
        {(bz.queues ?? []).map((q) => (
          <Row key={q.key} title={q.name} testId={`busy-q-${q.key}`}
            sub={<>{adm("В работе")} <span className="tnum" data-testid={`busy-active-${q.key}`}>{q.active} {adm("из")} {q.limit}</span> {adm("· в очереди")} <span className="tnum" data-testid={`busy-queued-${q.key}`}>{q.queued}</span></>}
            sub2={<>{adm("Ход в среднем")} <span className="tnum" data-testid={`busy-avg-${q.key}`}>{secs(q.avg)}</span> {adm("· новому сообщению ждать")} <span className="tnum" data-testid={`busy-eta-${q.key}`}>{q.etaNext ? `~${secs(q.etaNext)}` : adm("сразу")}</span></>} />
        ))}
        <Row title={adm("Режим сейчас")} value={<span data-testid="busy-now">{bz.on ? adm("включён") : adm("выключен")}</span>} />
      </Group>

      <Group title={adm("Оповещения о нагрузке")} aside={al.on ? <Status tone="ok">{adm("включены")}</Status> : adm("выключены")} testId="alerts-form"
        foot={adm("Push всем администраторам с включёнными уведомлениями: нагрузка резко выросла, появилась очередь, ожидание от 1 минуты, режим высокой нагрузки включился — и одно «спало», когда 3 минуты всё спокойно. Один вид — не чаще раза в 10 минут, если не стало намного хуже. В тихие часы администратора push не приходит. При выключенных уведомлениях журнал всё равно ведётся.")}>
        <SwitchRow title={adm("Уведомления о нагрузке")} sub={al.on ? adm("сейчас присылаются") : adm("сейчас выключены — только журнал")} checked={al.on} onChange={(v) => void setAlertsOn(v)} testId="alerts-toggle" />
        {al.waiting.length > 0 && <Row title={adm("Ждут места сейчас")} sub={<span data-testid="alerts-waiting">{al.waiting.slice(0, 6).map((w) => `${w.name}${w.n > 1 ? ` ×${w.n}` : ''} ${secs(w.sec)}`).join(', ')}{al.waiting.length > 6 ? admf(" и ещё {0}", al.waiting.length - 6) : ''}</span>} />}
      </Group>

      <Group title={adm("Журнал нагрузки")} aside={al.log.length ? admf("последние {0}", al.log.length) : undefined} testId="alerts-log" foot={adm("Новые сверху. Время — ваше. В скобках у «без push» — оповещение не слали (выключатель или нет push в эпизоде).")}>
        {al.log.length === 0 && <Row title={adm("Событий пока не было")} tone="muted" />}
        {al.log.map((e, i) => (
          <Row key={`${e.at}-${e.kind}-${i}`} title={e.title} sub={e.body} sub2={e.push ? undefined : adm("без push")} value={<span className="tnum">{logTime(e.at, tz, Date.now())}</span>} testId={`alert-${e.kind}`} />
        ))}
      </Group>

      <Group title={adm("Уровни размышления")} testId="policy-form" foot={adm("Включено: обычный пользователь не видит уровень max, а его запрос с max уходит в движок как xhigh (чат, сравнение, автоматизации, API). Администраторам max доступен всегда. Действует сразу, без перезапуска.")}>
        <SwitchRow title={adm("Max только для админов")} sub={maxOnly ? adm("сейчас только администраторам") : adm("сейчас открыт всем")} checked={maxOnly} onChange={(v) => void setPolicy(v)} testId="policy-max" />
      </Group>

      <Group title={adm("Модели")} testId="models-table" foot={adm("Берутся из models.config.json; здесь только для чтения.")}>
        {models.map((m) => <Row key={m.id} title={modelLabel(models.map((x) => ({ ...x, defaultLevel: x.defaultLevel ?? '', levels: [] })), m.id)} tone="strong" sub={m.fullName} value={admf("до {0} одновременно", m.maxConcurrent)} chevron onClick={() => setModelOpen(m.id)} testId={`model-${m.id}`} />)}
      </Group>

      <Sheet open={!!flagRow} onClose={() => setFlagFor(null)} title={flagRow ? admf("Нагрузка: {0}", flagRow.name) : ''} testId="flag-sheet">
        {flagRow && (
          <>
            <Group><PickerRow title={adm("Срок флага")} value={mins} onChange={setMins} options={DURATIONS()} testId="load-duration" /></Group>
            <Group title={adm("Флаг")} foot={adm("Нажмите вариант — он применится сразу.")}>
              {(['normal', 'training', 'down'] as const).map((s) => (
                <button type="button" key={s} role="radio" aria-checked={cur(flagRow.key) === s} className="k-row k-opt-row" onClick={() => void setFlag(flagRow.key, s)} data-testid={`flag-${flagRow.key === '*' ? 'all' : flagRow.key}-${s}`}>
                  <span className="k-row-m"><span className="k-row-t">{LOAD()[s].label}</span><span className="k-row-s">{LOAD()[s].hint}</span></span>
                  {cur(flagRow.key) === s && <span className="k-check-t">{adm("сейчас")}</span>}
                </button>
              ))}
            </Group>
          </>
        )}
      </Sheet>

      <Sheet open={!!md} onClose={() => setModelOpen(null)} title={md?.name ?? ''} sub={md?.fullName} testId="model-sheet">
        {md && (
          <>
            <Group>
              <Row title={adm("Имя на сервере")} value={<span className="k-mono">{md.upstreamModel}</span>} />
              <Row title={adm("Адрес")} value={<span className="k-mono">{md.baseUrl}</span>} />
              <Row title={adm("Одновременно")} value={admf("до {0}", md.maxConcurrent)} />
              <Row title={adm("Картинки")} value={md.images ? adm("понимает") : adm("нет")} />
            </Group>
            <Group title={adm("Уровни → reasoning_effort")}>
              {md.levels.map((l) => <Row key={l.id} title={l.id} sub={l.hint} value={<span className="k-mono">{l.effort ?? adm("поле не шлётся")}</span>} />)}
            </Group>
          </>
        )}
      </Sheet>
    </div>
  );
}
