'use client';
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

const LOAD: Record<LoadState, { label: string; hint: string }> = {
  normal: { label: 'Норма', hint: 'Без меток' },
  training: { label: 'Обучение', hint: 'Метка «медленно — идёт обучение» и объявление с готовым текстом' },
  down: { label: 'Недоступна', hint: 'Метка и отказ при отправке с предложением другой модели' },
};
const DURATIONS = [{ value: 0, label: 'До отмены' }, { value: 30, label: '30 минут' }, { value: 60, label: '1 час' }, { value: 180, label: '3 часа' }, { value: 720, label: '12 часов' }];
const NOW_LABEL: Record<ModelState, string> = { ok: 'Работает', slow: 'Медленно', down: 'Недоступна' };
const tzNow = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; } };
const toLocalInput = (ts: number | null) => (ts ? new Date(ts - new Date(ts).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');
type Until = 'none' | '1h' | '3h' | 'eod' | 'date';

async function post(path: string, body: unknown): Promise<{ ok: boolean; error?: string; data?: unknown }> {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    return { ok: r.ok, error: j.error, data: j };
  } catch { return { ok: false, error: 'Нет связи с сервером' }; }
}

const BUSY_NONE: BusySnap = { mode: 'auto', on: false, auto: false, eta: 0, since: null, checkedAt: null, now: 0, queues: [] };
const BUSY_LABEL: Record<BusyMode, string> = { auto: 'Авто', off: 'Выкл', on: 'Вкл' };
const BUSY_HINT: Record<BusyMode, string> = {
  auto: 'Баннер включается сам, когда ожидание для нового сообщения ≥ 1 мин держится 20 секунд, и гаснет, когда < 20 с держится 2 минуты.',
  off: 'Общий баннер не показывается. Личная карточка очереди у отправителя остаётся — это механика, а не режим.',
  on: 'Баннер показывается всем независимо от очереди.',
};
const BUSY_POLL_MS = 5000;
const ALERTS_NONE: AlertsSnap = { now: 0, on: true, waiting: [], log: [] };
const isAlerts = (x: unknown): x is AlertsSnap => !!x && typeof x === 'object' && Array.isArray((x as AlertsSnap).log) && typeof (x as AlertsSnap).on === 'boolean';
function logTime(ts: number, tz: string, now: number): string {
  const f = (o: Intl.DateTimeFormatOptions) => { try { return new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour12: false, ...o }); } catch { return new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', hour12: false, ...o }); } };
  const day = (t: number) => f({ year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
  const hms = f({ hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(ts);
  return day(ts) === day(now) ? hms : `${f({ day: '2-digit', month: '2-digit' }).format(ts)} ${hms.slice(0, 5)}`;
}
const secs = (s: number) => (s >= 90 ? `${Math.round(s / 60)} мин` : `${Math.round(s)} с`);

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
    if (!r.ok) { setAl((a) => ({ ...a, on: !v })); toast(r.error ?? 'Не получилось. Попробуйте ещё раз', 'error'); return; }
    if (isAlerts(r.data)) setAl(r.data);
    toast(v ? 'Уведомления о нагрузке включены' : 'Уведомления о нагрузке выключены');
  };
  const setPolicy = async (v: boolean) => {
    setMaxOnly(v);
    const r = await post('/api/admin/policy', { maxAdminOnly: v });
    if (!r.ok) { setMaxOnly(!v); toast(r.error ?? 'Не получилось. Попробуйте ещё раз', 'error'); return; }
    toast(v ? 'Max — только администраторам' : 'Max открыт всем');
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
    if (!r.ok) { toast(r.error ?? 'Не получилось. Попробуйте ещё раз', 'error'); return; }
    setBz(r.data as BusySnap);
    toast(`Высокая нагрузка: ${BUSY_LABEL[mode].toLowerCase()}`);
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
    if (enabled && !text.trim()) { setErr('Напишите текст объявления'); return; }
    if (enabled && until === 'date' && (!date || new Date(date).getTime() <= Date.now())) { setErr('Выберите время в будущем или «Без срока»'); return; }
    setBusy(true); setErr('');
    const r = await post('/api/admin/banner', enabled ? { text, level, until: untilMs(), enabled } : { enabled: false });
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? 'Не сохранилось. Попробуйте ещё раз'); return; }
    toast(enabled ? (live ? 'Объявление обновлено' : 'Объявление показано всем') : 'Объявление снято');
    router.refresh();
  };
  const setFlag = async (key: string, s: LoadState) => {
    const r = await post('/api/admin/load-state', { state: s, model: key === '*' ? null : key, minutes: mins || undefined });
    if (!r.ok) { toast(r.error ?? 'Не получилось. Попробуйте ещё раз', 'error'); return; }
    const name = key === '*' ? 'Все модели' : snap.models.find((m) => m.id === key)?.name ?? key;
    toast(`${name}: ${LOAD[s].label.toLowerCase()}${s !== 'normal' && mins ? ` на ${DURATIONS.find((d) => d.value === mins)?.label}` : ''}`);
    setFlagFor(null); router.refresh();
  };
  const rows = [{ key: '*', name: 'Все модели', st: null as ModelState | null, probe: null as NoticesSnap['models'][number]['probe'] }, ...snap.models.map((m) => ({ key: m.id, name: m.name, st: m.state, probe: m.probe }))];
  const flagRow = rows.find((r) => r.key === flagFor);
  const cur = (key: string): LoadState => snap.load[key]?.state ?? 'normal';
  const md = models.find((m) => m.id === modelOpen);

  return (
    <div className="k-stack" data-testid="notices">
      <Group title="Объявление для всех" aside={live ? <Status tone="ok">показывается</Status> : 'не показывается'} testId="banner-form"
        foot={live ? <>Видят все{b.until ? <> до {relTime(b.until, tz)}</> : ', без срока'}. Пользователь может скрыть его до следующего изменения.</> : 'Полоса над лентой чата у всех пользователей. Для скриптов: POST /api/admin/banner с ключом API администратора.'}>
        <Field label="Текст" multiline rows={2} maxLength={MAX_TEXT} value={text} placeholder="Например: «Сегодня с 18:00 до 19:00 — обновление, ответы могут задерживаться»" onChange={setText} testId="banner-text" />
        <div className="k-row"><span className="k-row-m"><span className="k-row-t">Вид</span></span>
          <Seg label="Вид" value={level} onChange={setLevel} options={[{ value: 'info', label: 'Обычное', testId: 'banner-level-info' }, { value: 'warn', label: 'Важное', testId: 'banner-level-warn' }]} />
        </div>
        <PickerRow title="Показывать" value={until} onChange={setUntil} testId="banner-until-pick" options={[
          { value: 'none', label: 'Без срока' }, { value: '1h', label: 'Час' }, { value: '3h', label: '3 часа' }, { value: 'eod', label: 'До конца дня' }, { value: 'date', label: 'До даты и времени' },
        ]} />
        {until === 'date' && <Row title="До" right={<input type="datetime-local" className="k-inl" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Показывать до" data-testid="banner-until" />} />}
      </Group>
      {err && <Notice>{err}</Notice>}
      <div className="k-acts">
        <Button kind="primary" busy={busy} onClick={() => void save(true)} testId="banner-save">{live ? 'Сохранить' : 'Показать всем'}</Button>
        {live && <Button kind="secondary" onClick={() => void save(false)} testId="banner-off">Снять</Button>}
      </div>

      <Group title="Нагрузка моделей" testId="load-table" foot="«Обучение» — пользователи видят метку «медленно» и объявление. «Недоступна» — отправка отклоняется с предложением другой модели. Доступность моделей проверяется раз в 15 секунд.">
        {rows.map((r) => {
          const e = snap.load[r.key];
          const c = cur(r.key);
          return (
            <Row key={r.key} title={r.name} tone="strong" chevron onClick={() => { setMins(0); setFlagFor(r.key); }} testId={`load-${r.key === '*' ? 'all' : r.key}`}
              sub={r.key === '*' ? 'Флаг сразу для всех' : <>{r.st && <Status tone={r.st === 'ok' ? 'ok' : r.st === 'slow' ? 'warn' : 'err'}>{NOW_LABEL[r.st]}</Status>}{' · '}{r.probe ? (r.probe.ok ? 'отвечает' : `не отвечает (${r.probe.fails})`) : 'ещё не проверялась'}</>}
              value={<>{LOAD[c].label}{e && c !== 'normal' ? <span className="k-row-s"><br />{e.until ? `до ${relTime(e.until, tz)}` : 'до отмены'}</span> : null}</>} />
          );
        })}
      </Group>

      <Group title="Высокая нагрузка" aside={bz.on ? <Status tone="warn">баннер показывается</Status> : 'баннера нет'} testId="busy-form"
        foot={BUSY_HINT[bz.mode]}>
        <div className="k-row" data-testid="busy-mode-row"><span className="k-row-m"><span className="k-row-t">Высокая нагрузка</span><span className="k-row-s">{bz.mode === 'auto' ? (bz.auto ? 'сейчас включена сама' : 'сейчас не включена') : bz.mode === 'on' ? 'включена вручную' : 'выключена вручную'}</span></span>
          <Seg label="Высокая нагрузка" value={bz.mode} onChange={(m) => void setMode(m)} testId="busy-mode" options={[
            { value: 'auto', label: BUSY_LABEL.auto, testId: 'busy-auto' }, { value: 'off', label: BUSY_LABEL.off, testId: 'busy-off' }, { value: 'on', label: BUSY_LABEL.on, testId: 'busy-on' },
          ]} />
        </div>
        {(bz.queues ?? []).map((q) => (
          <Row key={q.key} title={q.name} testId={`busy-q-${q.key}`}
            sub={<>В работе <span className="tnum" data-testid={`busy-active-${q.key}`}>{q.active} из {q.limit}</span> · в очереди <span className="tnum" data-testid={`busy-queued-${q.key}`}>{q.queued}</span></>}
            sub2={<>Ход в среднем <span className="tnum" data-testid={`busy-avg-${q.key}`}>{secs(q.avg)}</span> · новому сообщению ждать <span className="tnum" data-testid={`busy-eta-${q.key}`}>{q.etaNext ? `~${secs(q.etaNext)}` : 'сразу'}</span></>} />
        ))}
        <Row title="Режим сейчас" value={<span data-testid="busy-now">{bz.on ? 'включён' : 'выключен'}</span>} />
      </Group>

      <Group title="Оповещения о нагрузке" aside={al.on ? <Status tone="ok">включены</Status> : 'выключены'} testId="alerts-form"
        foot="Push всем администраторам с включёнными уведомлениями: нагрузка резко выросла, появилась очередь, ожидание от 1 минуты, режим высокой нагрузки включился — и одно «спало», когда 3 минуты всё спокойно. Один вид — не чаще раза в 10 минут, если не стало намного хуже. В тихие часы администратора push не приходит. При выключенных уведомлениях журнал всё равно ведётся.">
        <SwitchRow title="Уведомления о нагрузке" sub={al.on ? 'сейчас присылаются' : 'сейчас выключены — только журнал'} checked={al.on} onChange={(v) => void setAlertsOn(v)} testId="alerts-toggle" />
        {al.waiting.length > 0 && <Row title="Ждут места сейчас" sub={<span data-testid="alerts-waiting">{al.waiting.slice(0, 6).map((w) => `${w.name}${w.n > 1 ? ` ×${w.n}` : ''} ${secs(w.sec)}`).join(', ')}{al.waiting.length > 6 ? ` и ещё ${al.waiting.length - 6}` : ''}</span>} />}
      </Group>

      <Group title="Журнал нагрузки" aside={al.log.length ? `последние ${al.log.length}` : undefined} testId="alerts-log" foot="Новые сверху. Время — ваше. В скобках у «без push» — оповещение не слали (выключатель или нет push в эпизоде).">
        {al.log.length === 0 && <Row title="Событий пока не было" tone="muted" />}
        {al.log.map((e, i) => (
          <Row key={`${e.at}-${e.kind}-${i}`} title={e.title} sub={e.body} sub2={e.push ? undefined : 'без push'} value={<span className="tnum">{logTime(e.at, tz, Date.now())}</span>} testId={`alert-${e.kind}`} />
        ))}
      </Group>

      <Group title="Уровни размышления" testId="policy-form" foot="Включено: обычный пользователь не видит уровень max, а его запрос с max уходит в движок как xhigh (чат, сравнение, автоматизации, API). Администраторам max доступен всегда. Действует сразу, без перезапуска.">
        <SwitchRow title="Max только для админов" sub={maxOnly ? 'сейчас только администраторам' : 'сейчас открыт всем'} checked={maxOnly} onChange={(v) => void setPolicy(v)} testId="policy-max" />
      </Group>

      <Group title="Модели" testId="models-table" foot="Берутся из models.config.json; здесь только для чтения.">
        {models.map((m) => <Row key={m.id} title={modelLabel(models.map((x) => ({ ...x, defaultLevel: x.defaultLevel ?? '', levels: [] })), m.id)} tone="strong" sub={m.fullName} value={`до ${m.maxConcurrent} одновременно`} chevron onClick={() => setModelOpen(m.id)} testId={`model-${m.id}`} />)}
      </Group>

      <Sheet open={!!flagRow} onClose={() => setFlagFor(null)} title={flagRow ? `Нагрузка: ${flagRow.name}` : ''} testId="flag-sheet">
        {flagRow && (
          <>
            <Group><PickerRow title="Срок флага" value={mins} onChange={setMins} options={DURATIONS} testId="load-duration" /></Group>
            <Group title="Флаг" foot="Нажмите вариант — он применится сразу.">
              {(['normal', 'training', 'down'] as const).map((s) => (
                <button type="button" key={s} role="radio" aria-checked={cur(flagRow.key) === s} className="k-row k-opt-row" onClick={() => void setFlag(flagRow.key, s)} data-testid={`flag-${flagRow.key === '*' ? 'all' : flagRow.key}-${s}`}>
                  <span className="k-row-m"><span className="k-row-t">{LOAD[s].label}</span><span className="k-row-s">{LOAD[s].hint}</span></span>
                  {cur(flagRow.key) === s && <span className="k-check-t">сейчас</span>}
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
              <Row title="Имя на сервере" value={<span className="k-mono">{md.upstreamModel}</span>} />
              <Row title="Адрес" value={<span className="k-mono">{md.baseUrl}</span>} />
              <Row title="Одновременно" value={`до ${md.maxConcurrent}`} />
              <Row title="Картинки" value={md.images ? 'понимает' : 'нет'} />
            </Group>
            <Group title="Уровни → reasoning_effort">
              {md.levels.map((l) => <Row key={l.id} title={l.id} sub={l.hint} value={<span className="k-mono">{l.effort ?? 'поле не шлётся'}</span>} />)}
            </Group>
          </>
        )}
      </Sheet>
    </div>
  );
}
