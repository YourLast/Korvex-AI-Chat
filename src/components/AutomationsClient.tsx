'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AutoView } from '@/lib/autoview';
import { errText } from '@/lib/i18n/errors';
import { useT, type T } from '@/lib/i18n/react';
import { cronOf, describeSchedule, dowList, EVERY_HOURS, humanRunError, REPEATS, relTime, repeatLabel, tzName, whenOf, type Repeat, type When } from '@/lib/schedule';
import { Button, DestructiveButton, EmptyState, Field, Group, KPage, Notice, PickerRow, Row, Seg, SelectRow, Sheet, Status, Switch, SwitchRow, timeZones, toast } from './Kit';
import { useIsAdmin, useShell } from './Shell';
import { families, modelLabel } from '@/lib/levels';
import { ModelMark } from './ModelMark';
import { TimeField } from './TimeField';

type Run = { id: string; startedAt: number; finishedAt: number | null; status: string; trigger: string; error: string | null; durationMs: number | null; messageId?: string | null };
type Form = { id?: string; name: string; description: string; prompt: string; modelId: string; levelId: string; when: When; timezone: string; target: string; notify: boolean };

const OFFLINE = 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз';
const dur = (t: T, ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? t('tools.sec', { n: s || 1 }) : t('tools.minSec', { m: Math.floor(s / 60), s: s % 60 });
};

async function api(path: string, method: string, body?: unknown) {
  try {
    const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { ok: r.ok, status: r.status, data: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  } catch { return { ok: false, status: 0, data: { error: OFFLINE } as Record<string, unknown> }; }
}

const TEMPLATES: { key: 'morning' | 'friday' | 'deadlines'; when: Partial<When> }[] = [
  { key: 'morning', when: { repeat: 'daily', time: '09:00' } },
  { key: 'friday', when: { repeat: 'weekly', time: '17:00', dow: 5 } },
  { key: 'deadlines', when: { repeat: 'weekdays', time: '08:30' } },
];

function stateLine(a: AutoView, tz: string, t: T): { text: string; tone: 'ok' | 'warn' | 'err' | 'off' } {
  if (a.running) return { text: t('tools.auto.running'), tone: 'warn' };
  if (!a.enabled) return { text: t('tools.auto.paused'), tone: 'off' };
  if (a.lastStatus === 'error') return { text: t('tools.auto.error', { text: humanRunError(a.lastError, t.lang) }), tone: 'err' };
  return { text: a.nextRunAt ? t('tools.auto.next', { when: relTime(a.nextRunAt, tz, undefined, t.lang) }) : t('tools.auto.waiting'), tone: 'ok' };
}

function AutoForm({ init, tz, onDone, onClose }: { init: Form; tz: string; onDone: (a: AutoView | null, f: Form) => void; onClose: () => void }) {
  const t = useT();
  const { models, threads } = useShell();
  const [f, setF] = useState(init);
  const [err, setErr] = useState('');
  const [tried, setTried] = useState(false);
  const [preview, setPreview] = useState<{ error?: string; runs?: number[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const cron = cronOf(f.when);
  const model = models.find((m) => m.id === f.modelId) ?? models[0];
  const zones = useMemo(() => timeZones(f.timezone), [f.timezone]);
  useEffect(() => {
    if (!cron) { setPreview({ error: t('tools.auto.enterSched') }); return; }
    const id = setTimeout(async () => { const r = await api('/api/automations/preview', 'POST', { cron, timezone: f.timezone }); const d = r.data as { error?: string; runs?: number[] }; setPreview(d.error ? { ...d, error: errText(t.lang, d.error) } : d); }, 250);
    return () => clearTimeout(id);
  }, [cron, f.timezone, t]);
  const chats = threads.filter((x) => !x.groupId);
  const setW = (w: Partial<When>) => setF((x) => ({ ...x, when: { ...x.when, ...w } }));
  const noName = !f.name.trim(), noPrompt = !f.prompt.trim();
  const save = async () => {
    setTried(true); setErr('');
    if (noName || noPrompt) { setErr(noName && noPrompt ? t('tools.auto.needBoth') : noName ? t('tools.auto.needName') : t('tools.auto.needPrompt')); return; }
    if (preview?.error) { setErr(preview.error); return; }
    setBusy(true);
    const body = { name: f.name, description: f.description, prompt: f.prompt, modelId: f.modelId, levelId: f.levelId, cron, timezone: f.timezone, targetThreadId: f.target || null };
    const r = f.id ? await api(`/api/automations/${f.id}`, 'PATCH', { ...body, targetThreadId: f.target || undefined }) : await api('/api/automations', 'POST', body);
    setBusy(false);
    if (!r.ok) { setErr(r.data.error ? errText(t.lang, String(r.data.error)) : t('tools.auto.saveFail')); return; }
    onDone((r.data.automation as AutoView | undefined) ?? null, f);
  };
  const minute = parseInt(f.when.time.split(':')[1] ?? '0', 10) || 0;
  const r = f.when.repeat;
  return (
    <Sheet open onClose={onClose} title={f.id ? t('tools.auto.edit') : t('tools.auto.new')} testId="auto-dialog" focusFirst="[data-testid=auto-name]"
      foot={<Button kind="primary" size="lg" block onClick={save} busy={busy} testId="auto-save">{f.id ? t('common.save') : t('tools.create')}</Button>}>
      <Group>
        <Field label={t('tools.name')} value={f.name} maxLength={100} placeholder={t('tools.auto.namePh')} onChange={(v) => setF({ ...f, name: v })} invalid={tried && noName} testId="auto-name" />
        <Field label={t('tools.auto.what')} multiline rows={4} value={f.prompt} maxLength={20000} placeholder={t('tools.auto.whatPh')} onChange={(v) => setF({ ...f, prompt: v })} invalid={tried && noPrompt} testId="auto-prompt" />
        <Field label={t('tools.auto.descLabel')} value={f.description} maxLength={200} placeholder={t('tools.auto.descPh')} onChange={(v) => setF({ ...f, description: v })} />
      </Group>

      <Group title={t('tools.auto.when')} foot={<span data-testid="auto-preview">{preview?.error ? <span className="k-neg">{preview.error}</span> : preview?.runs ? <>{t('tools.auto.nearest', { list: preview.runs.map((x) => relTime(x, f.timezone, undefined, t.lang)).join(', ') })}{f.timezone !== tz ? ` (${tzName(f.timezone, t.lang)})` : ''}</> : ' '}</span>}>
        <PickerRow title={t('tools.auto.repeat')} value={r} onChange={(v: Repeat) => setW({ repeat: v, ...(v === 'custom' && !f.when.cron ? { cron: cronOf(f.when) } : {}) })} testId="auto-kind"
          options={REPEATS.map((k) => ({ value: k, label: repeatLabel(k, t.lang), testId: `auto-kind-${k}` }))} />
        {r === 'weekly' && <PickerRow title={t('tools.auto.dow')} value={f.when.dow} onChange={(v) => setW({ dow: v })} testId="auto-dow" options={dowList(t.lang).map(([v, l]) => ({ value: v, label: l }))} />}
        {r === 'every' && <PickerRow title={t('tools.auto.every')} value={f.when.every} onChange={(v) => setW({ every: v })} testId="auto-every" options={EVERY_HOURS.map((n) => ({ value: n, label: t('tools.hours', { n }) }))} />}
        {(r === 'daily' || r === 'weekdays' || r === 'weekly' || r === 'monthly') && (
          <Row title={t('tools.auto.time')} right={<TimeField value={f.when.time} onChange={(v) => setW({ time: v })} lang={t.lang} label={t('tools.auto.timeLabel')} testId="auto-time" />} />
        )}
        {(r === 'hourly' || r === 'every') && (
          <Row title={t('tools.auto.minute')} sub={t('tools.auto.minuteEx', { m: String(minute).padStart(2, '0') })} right={<input type="number" className="k-inl" min={0} max={59} value={minute} style={{ width: 80 }} aria-label={t('tools.auto.minute')}
            onChange={(e) => setW({ time: `00:${String(Math.max(0, Math.min(59, Number(e.target.value) || 0))).padStart(2, '0')}` })} />} />
        )}
        {r === 'custom' && <Field label={t('tools.auto.cronLabel')} mono value={f.when.cron} placeholder="30 8 * * 1-5" onChange={(v) => setW({ cron: v })} testId="auto-cron" invalid={!!preview?.error} />}
        <SelectRow title={f.timezone === tz ? t('tools.auto.tzDevice') : t('tools.auto.tz')} value={f.timezone} options={zones} onChange={(v) => setF({ ...f, timezone: v })} testId="auto-tz" />
      </Group>

      <Group title={t('tools.model')} foot={model.levels.find((l) => l.id === f.levelId)?.hint}>
        {models.length <= 3 && families(models).length === models.length
          ? <div className="k-row"><Seg block label={t('tools.model')} value={f.modelId} testId="auto-model" onChange={(v) => { const m = models.find((x) => x.id === v)!; setF({ ...f, modelId: m.id, levelId: m.defaultLevel }); }} options={models.map((m) => ({ value: m.id, label: <span className="mk-lab"><ModelMark id={m.id} models={models} />{m.name}</span>, testId: `auto-model-${m.id}` }))} /></div>
          : <PickerRow title={t('tools.model')} value={f.modelId} testId="auto-model" onChange={(v) => { const m = models.find((x) => x.id === v)!; setF({ ...f, modelId: m.id, levelId: m.defaultLevel }); }} options={models.map((m) => ({ value: m.id, label: <span className="mk-lab"><ModelMark id={m.id} models={models} />{modelLabel(models, m.id)}</span>, testId: `auto-model-${m.id}` }))} />}
        <PickerRow title={t('tools.auto.level')} value={f.levelId} onChange={(v) => setF({ ...f, levelId: v })} testId="auto-level" options={model.levels.map((l) => ({ value: l.id, label: l.label, hint: l.hint, testId: `auto-level-${l.id}` }))} />
      </Group>

      <Group title={t('tools.auto.result')} foot={t('tools.auto.resultFoot')}>
        <SelectRow title={t('tools.auto.where')} value={f.target} onChange={(v) => setF({ ...f, target: v })} testId="auto-target"
          options={[{ value: '', label: f.id ? t('tools.auto.sameChat') : t('tools.auto.newChat', { name: f.name.trim() || t('tools.auto.defaultName') }) }, ...chats.map((x) => ({ value: x.id, label: x.title }))]} />
        <SwitchRow title={t('tools.auto.notify')} sub={f.notify ? t('tools.auto.notifyOn') : t('tools.auto.notifyOff')} checked={f.notify} onChange={(v) => setF({ ...f, notify: v })} testId="auto-notify" />
      </Group>
      {err && <Notice testId="auto-err">{err}</Notice>}
    </Sheet>
  );
}

function deviceTz(): string | null {
  try { const z = Intl.DateTimeFormat().resolvedOptions().timeZone; return z && z.length <= 64 ? z : null; } catch { return null; }
}

export function AutomationsClient({ initial, timezone }: { initial: AutoView[]; timezone: string }) {
  const t = useT();
  const rel = (ts: number, zone: string) => relTime(ts, zone, undefined, t.lang);
  const { models, refresh, threads } = useShell();
  const admin = useIsAdmin();
  const [list, setList] = useState(initial);
  const [filter, setFilter] = useState<'all' | 'on' | 'off' | 'err'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, Run[] | undefined>>({});
  const [form, setForm] = useState<Form | null>(null);
  const [tz, setTz] = useState(() => deviceTz() ?? timezone);
  const newBtn = useRef<HTMLDivElement>(null);
  const open = list.find((a) => a.id === openId) ?? null;

  const reload = useCallback(async () => {
    const r = await fetch('/api/automations', { cache: 'no-store' }).catch(() => null);
    if (r?.ok) setList(((await r.json()) as { automations: AutoView[] }).automations);
  }, []);
  const loadRuns = useCallback(async (id: string) => {
    const r = await fetch(`/api/automations/${id}/runs`, { cache: 'no-store' }).catch(() => null);
    if (r?.ok) { const j = (await r.json()) as { runs: Run[] }; setRuns((x) => ({ ...x, [id]: j.runs })); }
  }, []);
  const anyRunning = list.some((a) => a.running);
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => { void reload(); if (openId) void loadRuns(openId); void refresh(); }, 3000);
    return () => clearInterval(id);
  }, [anyRunning, reload, openId, loadRuns, refresh]);
  useEffect(() => {
    const b = deviceTz();
    if (b && b !== timezone) { void api('/api/me', 'PATCH', { timezone: b }).then((r) => { if (r.ok) { setTz(b); void reload(); } }); }
  }, [timezone, reload]);

  const muted = (a: AutoView) => !!threads.find((x) => x.id === a.targetThreadId)?.muted;
  const setMuted = async (threadId: string, m: boolean) => { const r = await api(`/api/threads/${threadId}`, 'PATCH', { muted: m }); await refresh(); return r.ok; };
  const patchLocal = (id: string, p: Partial<AutoView>) => setList((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const toggle = async (a: AutoView, v: boolean) => {
    patchLocal(a.id, { enabled: v });
    const r = await api(`/api/automations/${a.id}`, 'PATCH', { enabled: v });
    if (!r.ok) { patchLocal(a.id, { enabled: !v }); toast(r.data.error ? errText(t.lang, String(r.data.error)) : t('common.retryLater'), 'error'); return; }
    const fresh = r.data.automation as AutoView | undefined;
    if (fresh) patchLocal(a.id, fresh);
    toast(v ? (fresh?.nextRunAt ? t('tools.auto.onToastWhen', { name: a.name, when: rel(fresh.nextRunAt, tz) }) : t('tools.auto.onToast', { name: a.name })) : t('tools.auto.pausedToast', { name: a.name }));
  };
  const runNow = async (a: AutoView) => {
    patchLocal(a.id, { running: true, lastStatus: 'running' });
    const r = await api(`/api/automations/${a.id}/run`, 'POST');
    if (!r.ok) { patchLocal(a.id, { running: false, lastStatus: a.lastStatus }); toast(r.data.error ? errText(t.lang, String(r.data.error)) : t('tools.auto.runFail'), 'error'); return; }
    toast(t('tools.auto.started', { title: a.targetTitle }));
    await reload(); void loadRuns(a.id);
  };
  const del = async (a: AutoView) => {
    const r = await api(`/api/automations/${a.id}`, 'DELETE');
    if (!r.ok) { toast(t('tools.auto.delFail'), 'error'); return; }
    setOpenId(null); setList((xs) => xs.filter((x) => x.id !== a.id)); toast(t('tools.auto.deleted'));
  };
  const base = (): Form => ({ name: '', description: '', prompt: '', modelId: models[0].id, levelId: models[0].defaultLevel, when: { repeat: 'daily', time: '09:00', dow: 1, every: 3, cron: '' }, timezone: tz, target: '', notify: true });
  const newForm = (tpl?: (typeof TEMPLATES)[number]) => setForm(tpl ? { ...base(), name: t(`tools.auto.tpl.${tpl.key}.name`), prompt: t(`tools.auto.tpl.${tpl.key}.prompt`), when: { ...base().when, ...tpl.when } } : base());
  const editForm = (a: AutoView) => { setOpenId(null); setForm({ id: a.id, name: a.name, description: a.description, prompt: a.prompt, modelId: a.modelId, levelId: a.levelId, when: whenOf(a.cron), timezone: a.timezone, target: '', notify: !muted(a) }); };
  const openDetail = (a: AutoView) => { setOpenId(a.id); void loadRuns(a.id); };
  const saved = async (a: AutoView | null, f: Form) => {
    const editing = !!f.id;
    setForm(null);
    const threadId = a?.targetThreadId;
    if (threadId && f.notify === !!threads.find((t) => t.id === threadId)?.muted) await setMuted(threadId, !f.notify);
    await reload(); void refresh();
    toast(editing ? t('tools.saved') : a?.nextRunAt ? t('tools.auto.created1', { when: rel(a.nextRunAt, f.timezone) }) : t('tools.auto.created'));
  };

  const nOn = list.filter((a) => a.enabled).length;
  const counts = { all: list.length, on: nOn, off: list.length - nOn, err: list.filter((a) => a.lastStatus === 'error').length };
  const shown = list.filter((a) => filter === 'all' || (filter === 'on' && a.enabled) || (filter === 'off' && !a.enabled) || (filter === 'err' && a.lastStatus === 'error'));
  const mLabel = (a: AutoView) => { const m = models.find((x) => x.id === a.modelId); return `${modelLabel(models, a.modelId)} · ${m?.levels.find((l) => l.id === a.levelId)?.label ?? a.levelId}`; };
  const openRuns = open ? runs[open.id] : undefined;

  return (
    <KPage title={t('tools.auto.title')} sub={list.length ? t('tools.auto.sub', { count: t('tools.auto.count', { n: list.length }), on: nOn }) : undefined} testId="automations"
      desc={t('tools.auto.desc')}
      action={list.length > 0 && <div ref={newBtn}><Button kind="primary" icon="plus" onClick={() => newForm()} testId="auto-new">{t('tools.auto.new')}</Button></div>}>

      {list.length === 0 ? (
        <>
          <EmptyState icon="repeat" title={t('tools.auto.emptyTitle')} testId="auto-empty"
            text={t('tools.auto.emptyText')}>
            <Button kind="primary" size="lg" icon="plus" onClick={() => newForm()} testId="auto-new">{t('tools.auto.new')}</Button>
          </EmptyState>
          <Group title={t('tools.auto.tplGroup')} foot={t('tools.auto.tplFoot')}>
            {TEMPLATES.map((tpl) => <Row key={tpl.key} icon="repeat" title={t(`tools.auto.tpl.${tpl.key}.title`)} sub={describeSchedule(cronOf({ repeat: 'daily', time: '09:00', dow: 1, every: 3, cron: '', ...tpl.when }), t.lang)} chevron onClick={() => newForm(tpl)} testId={`tpl-${tpl.key}`} />)}
          </Group>
        </>
      ) : (
        <>
          {list.length > 5 && (
            <Seg label={t('tools.show')} value={filter} onChange={setFilter} options={[
              { value: 'all', label: t('tools.auto.fAll', { n: counts.all }) }, { value: 'on', label: t('tools.auto.fOn', { n: counts.on }) }, { value: 'off', label: t('tools.auto.fOff', { n: counts.off }) },
              ...(counts.err ? [{ value: 'err' as const, label: t('tools.auto.fErr', { n: counts.err }) }] : []),
            ]} />
          )}
          <Group testId="jobs">
            {shown.length === 0 && <Row title={t('tools.auto.fEmpty')} tone="muted" />}
            {shown.map((a) => {
              const st = stateLine(a, tz, t);
              return (
                <div key={a.id} className="k-row k-row--job" data-testid={`job-${a.name}`}>
                  <button type="button" className="k-row-hit" onClick={() => openDetail(a)} aria-label={t('tools.auto.details', { name: a.name })} data-testid="job-open" />
                  <span className="k-row-m">
                    <span className="k-row-t k-row-t--strong">{a.name}</span>
                    <span className="k-row-s">{describeSchedule(a.cron, t.lang)}{a.timezone !== tz ? ` (${tzName(a.timezone, t.lang)})` : ''} · {mLabel(a)}</span>
                    <span className="k-row-s" data-testid="job-status"><Status tone={st.tone}>{st.text}</Status></span>
                  </span>
                  <Switch checked={a.enabled} onChange={(v) => void toggle(a, v)} label={a.enabled ? t('tools.auto.pauseLabel', { name: a.name }) : t('tools.auto.enableLabel', { name: a.name })} testId="job-switch" />
                </div>
              );
            })}
          </Group>
        </>
      )}

      {}
      <Sheet open={!!open} onClose={() => setOpenId(null)} title={open?.name ?? ''} testId="auto-detail">
        {open && (
          <>
            {open.lastStatus === 'error' && !open.running && (
              <Notice testId="job-error">{humanRunError(open.lastError, t.lang)}{admin && open.lastError ? <span className="k-tech">{open.lastError}</span> : null}</Notice>
            )}
            <Button kind="primary" size="lg" block icon="play" busy={open.running} onClick={() => void runNow(open)} testId="job-run">{open.running ? t('tools.auto.running') : t('tools.auto.runNow')}</Button>
            <Group>
              <SwitchRow title={t('tools.auto.enabled')} sub={open.enabled ? t('tools.auto.enabledSub') : t('tools.auto.pausedSub')} checked={open.enabled} onChange={(v) => void toggle(open, v)} testId="job-enabled" />
              <Row title={t('tools.auto.when')} value={describeSchedule(open.cron, t.lang)} sub={open.timezone !== tz ? t('tools.auto.inTz', { tz: tzName(open.timezone, t.lang) }) : undefined} />
              <Row title={t('tools.auto.nextRun')} value={<span data-testid="job-next">{open.enabled ? (open.nextRunAt ? rel(open.nextRunAt, tz) : '—') : t('tools.auto.nextPaused')}</span>}
                sub={open.timezone !== tz ? t('tools.auto.inYourTz', { tz: tzName(tz, t.lang) }) : undefined} />
              <Row title={t('tools.model')} value={mLabel(open)} />
            </Group>
            <Group title={t('tools.auto.result')}>
              <Row title={t('tools.auto.chat')} value={open.targetTitle} href={`/c/${open.targetThreadId}`} chevron testId="job-chat" />
              <SwitchRow title={t('tools.auto.notify')} checked={!muted(open)} onChange={(v) => void setMuted(open.targetThreadId, !v).then((ok) => toast(ok ? (v ? t('tools.auto.notifyOnToast') : t('tools.auto.notifyOffToast')) : t('common.retryLater'), ok ? 'ok' : 'error'))} testId="job-notify" />
            </Group>
            <Group title={t('tools.auto.task')}>
              <div className="k-row"><span className="k-row-m"><span className="k-row-t k-pre" data-testid="job-prompt">{open.prompt}</span></span></div>
            </Group>
            <Group title={t('tools.auto.lastRuns')} testId="runs">
              {openRuns === undefined && <Row title={t('tools.auto.loading')} tone="muted" />}
              {openRuns?.length === 0 && <Row title={t('tools.auto.noRuns')} tone="muted" sub={t('tools.auto.noRunsSub')} />}
              {openRuns?.map((x) => (
                <Row key={x.id} title={`${rel(x.startedAt, tz)} · ${x.trigger === 'manual' ? t('tools.auto.manual') : t('tools.auto.scheduled')}`}
                  sub={<Status tone={x.status === 'ok' ? 'ok' : x.status === 'running' ? 'warn' : 'err'}>{x.status === 'ok' ? (x.durationMs ? t('tools.auto.doneIn', { dur: dur(t, x.durationMs) }) : t('common.done')) : x.status === 'running' ? t('tools.auto.running') : humanRunError(x.error, t.lang)}</Status>}
                  href={x.status === 'ok' ? `/c/${open.targetThreadId}${x.messageId ? `#m-${x.messageId}` : ''}` : undefined} chevron={x.status === 'ok'} />
              ))}
            </Group>
            <div className="k-acts k-acts--stack">
              <Button kind="secondary" icon="edit" onClick={() => editForm(open)} testId="job-edit">{t('tools.auto.editBtn')}</Button>
              <DestructiveButton testId="job-delete" onConfirm={() => del(open)}
                confirm={{ title: t('tools.auto.delAsk', { name: open.name }), message: t('tools.auto.delMsg'), action: t('common.delete') }}>{t('tools.auto.delBtn')}</DestructiveButton>
            </div>
          </>
        )}
      </Sheet>

      {form && <AutoForm init={form} tz={tz} onClose={() => setForm(null)} onDone={(a, f) => void saved(a, f)} />}
    </KPage>
  );
}
