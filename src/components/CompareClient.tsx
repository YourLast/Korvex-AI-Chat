'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/react';
import type { PublicModel } from '@/lib/models';
import { isImage, type FileChip, type MsgView } from '@/lib/types';
import { fixPair, levelOnSwitch, normalizeSel, pairFromPrefs, readPrefs, rememberLevel } from '@/lib/levels';
import { Composer } from './Composer';
import { AssistantMsg, UserTurn } from './Message';
import { ModelMark } from './ModelMark';
import { LevelButton, ModelName, PickerButton, exitMs, pairLabels, type CompareNext, type Pair, type Sel, type Side } from './ModelPicker';
import { Topbar, useShell } from './Shell';
import { useChatStream, type TurnMode } from './useChatStream';
import { MuteButton, saveThreadSel, takePickerParam, useOlder, useSeen, useStick } from './ChatClient';
import { putGroup } from '@/lib/tcache';
import { PairVote, voteNames, type Winner } from './PairTurn';
import { live } from '@/lib/live';

type Turn = { user?: MsgView; ans?: MsgView };
function turnsOf(msgs: MsgView[]): Turn[] {
  const t: Turn[] = [];
  for (const m of msgs) {
    if (m.role === 'user') t.push({ user: m });
    else if (t.length && !t[t.length - 1].ans) t[t.length - 1].ans = m;
    else t.push({ ans: m });
  }
  return t;
}

type Init = { groupId: string; a: { id: string; modelId: string; effort: string; title: string }; b: { id: string; modelId: string; effort: string }; msgsA: MsgView[]; msgsB: MsgView[]; fileNames: string[]; hasMore?: boolean;
  votes?: Record<string, string> };

export function CompareClient({ models: modelsProp, init, preview = false }: { models: PublicModel[]; init: Init | null; preview?: boolean }) {
  const t = useT();
  const shell = useShell();
  const { refresh } = shell;
  const models = shell?.models ?? modelsProp;
  const router = useRouter();
  const [, setGid] = useState<string | null>(init?.groupId ?? null);
  const [ids, setIds] = useState<{ a: string; b: string } | null>(init ? { a: init.a.id, b: init.b.id } : null);
  const [title, setTitle] = useState(init?.a.title ?? t('tools.cmp.title'));
  const [fileNames, setFileNames] = useState(init?.fileNames ?? []);
  const [pair, setPair] = useState<Pair>(() => (init
    ? fixPair(models, { model: '', levels: {} }, { a: { modelId: init.a.modelId, levelId: init.a.effort }, b: { modelId: init.b.modelId, levelId: init.b.effort } }) : null)
    ?? pairFromPrefs(models, { model: models[0].id, levels: {} }));
  const A = useChatStream(init?.msgsA ?? [], init?.hasMore ?? false, ids?.a ?? null);
  const B = useChatStream(init?.msgsB ?? [], init?.hasMore ?? false, ids?.b ?? null);
  const listTitle = shell?.threads.find((x) => x.id === ids?.a || (!!init?.groupId && x.groupId === init.groupId))?.title;
  useEffect(() => { if (preview || !ids) return; live?.setThreads([ids.a, ids.b]); return () => live?.setThreads([]); }, [preview, ids]);
  const [active, setActive] = useState<Side>('a');
  const shownHash = useRef('');
  useEffect(() => {
    const pick = () => {
      const h = window.location.hash;
      if (!h.startsWith('#m-') || h === shownHash.current) return;
      const id = h.slice(3);
      const side: Side | null = B.msgs.some((m) => m.id === id) && !A.msgs.some((m) => m.id === id) ? 'b' : A.msgs.some((m) => m.id === id) ? 'a' : null;
      if (!side) return;
      shownHash.current = h;
      setActive(side);
    };
    pick();
    window.addEventListener('hashchange', pick);
    return () => window.removeEventListener('hashchange', pick);
  }, [A.msgs, B.msgs]);
  const [pickOpen, setPickOpen] = useState(false);
  const [instant, setInstant] = useState(false);
  const [ready, setReady] = useState(!!init);
  const { ref: scrollRef, onScroll, tick, el: scrollEl, stick } = useStick();
  const meG = shell?.threads.find((x) => (!!init?.groupId && x.groupId === init.groupId) || x.id === ids?.a);
  useSeen(init?.groupId ?? null, !!meG?.unread, scrollEl, stick, preview);
  const busy = A.busy || B.busy;
  const hasMore = (A.hasMore || B.hasMore) && !preview;
  const loadOlder = useCallback(async () => {
    if (!ids || preview) return false;
    const [x, y] = await Promise.all([A.older(ids.a), B.older(ids.b)]);
    return x || y;
  }, [ids, preview, A, B]);
  const sentinel = useOlder(scrollEl, hasMore, loadOlder, `${A.msgs[0]?.id}|${B.msgs[0]?.id}`);
  useEffect(() => {
    if (preview || busy || !ids || !init?.groupId || (!A.msgs.length && !B.msgs.length)) return;
    putGroup({ groupId: init.groupId, a: { id: ids.a, modelId: pair.a.modelId, effort: pair.a.levelId, title }, b: { id: ids.b, modelId: pair.b.modelId, effort: pair.b.levelId },
      msgsA: A.msgs, msgsB: B.msgs, fileNames, hasMore: A.hasMore || B.hasMore });
  }, [preview, busy, ids, init?.groupId, pair, title, A.msgs, B.msgs, A.hasMore, B.hasMore, fileNames]);

  useEffect(() => {
    const p = readPrefs(models);
    const pr = init ? pair : pairFromPrefs(models, p);
    if (!init) setPair(pr);
    setReady(true);
    const want = preview ? null : takePickerParam();
    if (want !== null) {
      setActive(pr.b.modelId === want && pr.a.modelId !== want ? 'b' : 'a');
      setInstant(true); setPickOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { tick(); });

  const setLevel = useCallback((side: Side, levelId: string) => {
    const s: Sel = { ...pair[side], levelId };
    setPair((p) => ({ ...p, [side]: s }));
    rememberLevel(models, s, false);
    if (ids) saveThreadSel(ids[side], s);
  }, [pair, ids, models]);
  const onCompare = useCallback((on: boolean, next?: CompareNext) => {
    if (on) return;
    const s = next?.sel ?? pair[active];
    rememberLevel(models, s, true);
    setPickOpen(false);
    const here = location.pathname;
    window.setTimeout(() => { if (location.pathname === here) router.push(`/?new=${Date.now()}`); }, exitMs());
  }, [pair, active, models, router]);
  const setSideModel = useCallback((side: Side, modelId: string) => {
    const s: Sel = { modelId, levelId: levelOnSwitch(models, modelId, pair[side], readPrefs(models).levels) };
    setPair((p) => ({ ...p, [side]: s }));
    rememberLevel(models, s, false);
    if (ids) saveThreadSel(ids[side], s);
  }, [pair, ids, models]);

  const ta = turnsOf(A.msgs), tb = turnsOf(B.msgs);
  const ensureIds = useCallback(async () => {
    if (ids) return ids;
    const r = await fetch('/api/threads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ compare: { a: pair.a, b: pair.b } }) });
    if (!r.ok) return null;
    const j = (await r.json()) as { groupId: string; threads: [string, string] };
    const t = { a: j.threads[0], b: j.threads[1] };
    setIds(t); setGid(j.groupId);
    window.history.replaceState(null, '', `/g/${j.groupId}`);
    return t;
  }, [ids, pair]);

  const doSend = useCallback(async (text: string, files: FileChip[], opts?: { mode?: TurnMode; turn?: number }) => {
    const t = await ensureIds();
    if (!t) return;
    if (files.length) setFileNames((n) => [...n, ...files.filter((f) => !isImage(f)).map((f) => f.name)]);
    const mode = opts?.mode;
    const base = { text, files, fileIds: files.map((f) => f.id), mode };
    rememberLevel(models, pair.a, false); rememberLevel(models, pair.b, false);
    await Promise.all([
      A.send({ ...base, editId: mode === 'edit' ? ta[opts!.turn!]?.user?.id : undefined, threadId: t.a, modelId: pair.a.modelId, levelId: pair.a.levelId }, (x) => setTitle(x)),
      B.send({ ...base, editId: mode === 'edit' ? tb[opts!.turn!]?.user?.id : undefined, threadId: t.b, modelId: pair.b.modelId, levelId: pair.b.levelId }),
    ]);
    refresh();
  }, [ensureIds, pair, A, B, refresh, ta, tb, models]);

  const columnTurn = useCallback(async (side: Side, mode: TurnMode, m?: MsgView) => {
    if (!ids) return;
    const S = side === 'a' ? A : B;
    const use = mode === 'continue' && m?.meta?.modelId && m.meta.levelId ? normalizeSel(models, { modelId: m.meta.modelId, levelId: m.meta.levelId }) : pair[side];
    await S.send({ threadId: ids[side], text: '', modelId: use.modelId, levelId: use.levelId, mode });
    refresh();
  }, [ids, A, B, pair, models, refresh]);

  const imgOk = models.find((m) => m.id === pair.a.modelId)?.images !== false && models.find((m) => m.id === pair.b.modelId)?.images !== false;
  const n = Math.max(ta.length, tb.length);
  const [la, lb] = pairLabels(models, pair.a, pair.b);
  const sideOf = (m: MsgView): Sel => ({ modelId: m.meta?.modelId ?? '', levelId: m.meta?.levelId ?? '' });
  const pairNames = (x: MsgView, y: MsgView): [string, string] => { const [p, q] = pairLabels(models, sideOf(x), sideOf(y)); return voteNames(p, q); };
  const empty = n === 0;
  const lastIdx = n - 1;

  const chip = (
    <PickerButton models={models} compare sel={pair[active]} pair={pair} tab={active} onTab={setActive} onModel={() => {}} onLevel={(l) => setLevel(active, l)} onPairModel={setSideModel}
      onCompare={onCompare} compareNote={empty ? t('tools.cmp.noteEmpty') : t('tools.cmp.noteOff')}
      open={pickOpen} onOpenChange={(o) => { setPickOpen(o); if (!o) setInstant(false); }} instant={instant} pending={!ready} />
  );
  const tabs = (
    <div className="seg seg--lg cmp-tabs" role="tablist" aria-label={t('tools.cmp.tabs')}>
      {(['a', 'b'] as const).map((k) => (
        <button type="button" key={k} role="tab" aria-selected={active === k} onClick={() => setActive(k)} data-tab={k} data-testid={`tab-${k}`}>
          <ModelMark id={pair[k].modelId} models={models} /><ModelName name={(k === 'a' ? la : lb).name} suffix={(k === 'a' ? la : lb).suffix} />
        </button>
      ))}
    </div>
  );

  return (
    <>
      <Topbar title={listTitle || title} sub={ready ? <><ModelName name={la.name} suffix={la.suffix} /> · {la.level} × <ModelName name={lb.name} suffix={lb.suffix} /> · {lb.level}</> : ' '} home={false} mode="compare" chat={!empty && !preview && init?.groupId ? { id: ids?.a ?? init.groupId, groupId: init.groupId, title: listTitle || title, muted: !!meG?.muted } : undefined}>
        {!empty && !preview && <MuteButton id={init?.groupId ?? null} muted={!!meG?.muted} />}
      </Topbar>
      {empty ? (
        <div className="home" data-testid="home">
          <div className="home-hero">
            <span className="mark" aria-hidden="true" />
            <h1 className="t-display">{t('tools.cmp.title')}</h1>
            <p>{t('tools.cmp.lead')}</p>
          </div>
        </div>
      ) : (
        <div className="thread" ref={scrollRef} onScroll={onScroll} data-testid="thread">
          <div className="thread-in thread-in--wide">
            {hasMore && <div ref={sentinel} className="older" data-testid="older">{A.loadingOlder || B.loadingOlder ? <span className="shimmer">{t('tools.cmp.loadingOlder')}</span> : <span>{t('tools.cmp.older')}</span>}</div>}
            {Array.from({ length: n }, (_, i) => (
              <div key={i} className="turn" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-6)' }}>
                {(ta[i]?.user ?? tb[i]?.user) && (
                  <UserTurn m={(ta[i]?.user ?? tb[i]?.user)!} busy={busy} onEdit={(t) => doSend(t, [], { mode: 'edit', turn: i })}
                    onSwitch={(id) => {
                      const ua = ta[i]?.user, ub = tb[i]?.user, idx = ua?.siblings?.ids.indexOf(id) ?? -1;
                      if (ids && ua && idx >= 0) { A.switchTo(ids.a, id); const bid = ub?.siblings?.ids[idx]; if (bid) B.switchTo(ids.b, bid); }
                    }} />
                )}
                <div className="cmp" data-active={active}>
                  {tabs}
                  {([['a', ta[i]?.ans, A], ['b', tb[i]?.ans, B]] as const).map(([k, m, S]) => (
                    m ? <AssistantMsg key={k} col={k} m={m} models={models} fileNames={fileNames} last={i === lastIdx} canRegen={!busy}
                          headSlot={i === lastIdx && (!m.meta?.modelId || m.meta.modelId === pair[k].modelId) ? <LevelButton models={models} sel={pair[k]} side={k} onLevel={(l) => setLevel(k, l)} align={k === 'b' ? 'right' : 'left'} disabled={busy} /> : undefined}
                          onRegenerate={() => columnTurn(k, 'regenerate')}
                          onContinue={() => columnTurn(k, 'continue', m)}
                          onSwitch={(id) => ids && S.switchTo(k === 'a' ? ids.a : ids.b, id)} />
                      : <div key={k} className={`ans ans-${k}`} />
                  ))}
                </div>
                {ta[i]?.ans && tb[i]?.ans && (
                  <PairVote a={ta[i].ans} b={tb[i].ans} vote={(init?.votes?.[`${ta[i].ans!.id}|${tb[i].ans!.id}`] as Winner | undefined) ?? null}
                    names={pairNames(ta[i].ans, tb[i].ans)} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {}
      <Composer busy={busy} placeholder={pair.a.modelId !== pair.b.modelId ? t('tools.cmp.phBoth') : t('tools.cmp.phTwo')} modelSlot={chip} onStop={() => { A.stop(); B.stop(); }} onSend={(t, f) => doSend(t, f)} acceptImages={imgOk} modelId={pair.a.modelId} footNote={t('tools.cmp.foot')} />
    </>
  );
}
