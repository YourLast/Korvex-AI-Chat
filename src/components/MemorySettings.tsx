'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { MemoryItem, MemoryState } from '@/lib/memoryView';
import { fmtWhen } from '@/lib/format';
import { localeOf, type Lang } from '@/lib/i18n/core';
import { errText } from '@/lib/i18n/errors';
import { useT, type T } from '@/lib/i18n/react';
import { useLive } from '@/lib/live';
import { Button, DestructiveButton, EmptyState, Field, Group, KPage, PickerRow, Row, Sheet, SwitchRow, toast, useConfirm } from './Kit';
import { Icon } from './Icon';
import { MemoryIntro } from './MemoryIntro';
import { RulesNow } from './RulesNow';
import '@/styles/user-memory.css';

const SECTION_IDS = ['who', 'work', 'style', 'rules', 'knowledge', 'interests', 'facts'] as const;
type SectionId = (typeof SECTION_IDS)[number];
const sectionsOf = (t: T) => SECTION_IDS.map((id) => ({ id, title: t(`tools.memset.s.${id}`), hint: t(`tools.memset.s.${id}.hint`) }));
const MAX = 200;

function whenOf(ts: number, lang: Lang, t: T): string {
  if (lang === 'ru') return fmtWhen(ts);
  const d = new Date(ts), d0 = new Date(); d0.setHours(0, 0, 0, 0);
  if (ts >= d0.getTime()) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (ts >= d0.getTime() - 864e5) return t('tools.memset.yesterday');
  if (d.getFullYear() === d0.getFullYear()) return d.toLocaleDateString(localeOf(lang), { day: 'numeric', month: 'short' });
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

function sourceOf(it: MemoryItem, t: T): string {
  const when = whenOf(it.updatedAt, t.lang, t);
  if (it.origin === 'manual') return t('tools.memset.byYou', { when });
  if (it.key === 'writes') return t('tools.memset.byMessages', { when });
  const chat = it.chat ? t('tools.memset.chat', { title: it.chat.title }) : t('tools.memset.chatGone');
  return it.origin === 'asked' ? t('tools.memset.asked', { chat, when }) : t('tools.memset.fromTalk', { chat, when });
}

const NO_SERVER = 'Нет связи с сервером';
async function call(url: string, method: string, body?: unknown): Promise<{ ok: boolean; j: MemoryState & { error?: string } }> {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null);
  if (!r) return { ok: false, j: { error: NO_SERVER } as never };
  return { ok: r.ok, j: (await r.json().catch(() => ({}))) as MemoryState & { error?: string } };
}

export function MemorySettings({ initial }: { initial: MemoryState }) {
  const t = useT();
  const SECTIONS = sectionsOf(t);
  const err = (e: string | undefined, fallback: string) => (e ? errText(t.lang, e) : fallback);
  const [st, setSt] = useState<MemoryState>(initial);
  const [edit, setEdit] = useState<{ item: MemoryItem | null; text: string; section: SectionId } | null>(null);
  const [busy, setBusy] = useState(false);
  const [intro, setIntro] = useState(false);
  const [introDone, setIntroDone] = useState(!!initial.introDone);
  const [again, setAgain] = useState(false);
  const [rnBump, setRnBump] = useState(0);
  const [name, setName] = useState(initial.callName.value);
  const [nameBusy, setNameBusy] = useState(false);
  const [confirmUi, ask] = useConfirm();
  const [nameSeen, setNameSeen] = useState(initial.callName.value);
  if (st.callName.value !== nameSeen) { if (name === nameSeen) setName(st.callName.value); setNameSeen(st.callName.value); }
  const reload = useCallback(async () => {
    const r = await fetch('/api/memory', { cache: 'no-store' }).catch(() => null);
    if (r?.ok) { const j = (await r.json()) as MemoryState; setSt(j); setIntroDone(!!j.introDone); }
  }, []);
  useEffect(() => { if (window.location.hash === '#intro') { setIntro(true); window.history.replaceState(window.history.state, '', window.location.pathname); } }, []);
  useLive((e) => { if (e.t === 'memory' && e.action !== 'rules-run') void reload(); });
  useEffect(() => {
    const id = window.location.hash.startsWith('#m-') ? window.location.hash.slice(3) : '';
    const it = id ? initial.items.find((x) => x.id === id) : undefined;
    if (!it) return;
    document.getElementById(`mem-${it.id}`)?.scrollIntoView({ block: 'center' });
    setEdit({ item: it, text: it.text, section: it.section as SectionId });
    window.history.replaceState(window.history.state, '', window.location.pathname);
  }, [initial.items]);

  const setPref = async (p: { on?: boolean; auto?: boolean }) => {
    const prev = st.prefs;
    setSt((s) => ({ ...s, prefs: { ...s.prefs, ...p } }));
    const r = await call('/api/memory', 'PATCH', p);
    if (!r.ok) { setSt((s) => ({ ...s, prefs: prev })); toast(err(r.j.error, t('tools.memset.saveFail')), 'error'); return; }
    toast(p.on === false ? t('tools.memset.off') : p.on ? t('tools.memset.on') : p.auto ? t('tools.memset.willAuto') : t('tools.memset.onlyAsked'));
  };

  const save = async () => {
    if (!edit) return;
    const text = edit.text.trim();
    if (!text) { toast(t('tools.memset.emptyEntry'), 'error'); return; }
    setBusy(true);
    try {
      const r = edit.item ? await call(`/api/memory/${edit.item.id}`, 'PATCH', { text, section: edit.section }) : await call('/api/memory', 'POST', { text, section: edit.section });
      if (!r.ok) { toast(err(r.j.error, t('tools.memset.saveFail')), 'error'); return; }
      setSt({ prefs: r.j.prefs, items: r.j.items, callName: r.j.callName });
      setEdit(null);
      toast(edit.item ? t('tools.saved') : t('tools.added'));
    } finally { setBusy(false); }
  };
  const remove = async (it: MemoryItem) => {
    const r = await call(`/api/memory/${it.id}`, 'DELETE');
    if (!r.ok) { toast(err(r.j.error, t('tools.memset.delFail')), 'error'); return; }
    setSt({ prefs: r.j.prefs, items: r.j.items, callName: r.j.callName });
    setEdit(null);
    toast(t('tools.removed'));
  };
  const confirmMaybe = async (it: MemoryItem) => {
    const r = await call(`/api/memory/${it.id}`, 'PATCH', { sure: true });
    if (!r.ok) { toast(err(r.j.error, t('tools.memset.saveFail')), 'error'); return; }
    setSt({ prefs: r.j.prefs, items: r.j.items, callName: r.j.callName });
    toast(t('tools.memset.confirmed'));
  };
  const saveName = async () => {
    setNameBusy(true);
    try {
      const r = await call('/api/memory', 'PATCH', { callName: name.trim() });
      if (!r.ok) { toast(err(r.j.error, t('tools.memset.saveFail')), 'error'); return; }
      setSt({ prefs: r.j.prefs, items: r.j.items, callName: r.j.callName });
      setName(r.j.callName.value); setNameSeen(r.j.callName.value);
      toast(t('tools.saved'));
    } finally { setNameBusy(false); }
  };
  const removeFromSheet = async (it: MemoryItem) => {
    if (await ask({ title: t('tools.memset.delAsk'), message: t('tools.memset.delMsg', { text: it.text }), action: t('common.delete') })) await remove(it);
  };
  const clearAll = async () => {
    const r = await call('/api/memory', 'DELETE');
    if (!r.ok) { toast(err(r.j.error, t('tools.memset.delFail')), 'error'); return; }
    setSt({ prefs: r.j.prefs, items: r.j.items, callName: r.j.callName });
    toast(t('tools.memset.cleared'));
  };

  const { on, auto } = st.prefs;
  const n = st.items.length;
  return (
    <KPage title={t('tools.memset.title')} sub={on ? (n ? t('tools.memset.count', { n }) : t('tools.memset.empty')) : t('tools.memset.offState')} testId="memory-settings"
      desc={t('tools.memset.desc')}
      action={<>
        {}
        {on && <Button kind="primary" icon="spark" onClick={() => { setAgain(introDone); setIntro(true); }} testId="mem-intro">{t(introDone ? 'tools.memset.introAgain' : n > 0 ? 'tools.memset.introMore' : 'tools.memset.intro')}</Button>}
        <Button icon="plus" onClick={() => setEdit({ item: null, text: '', section: 'facts' })} testId="mem-add">{t('tools.add')}</Button>
      </>}>
      {on && <RulesNow bump={rnBump} />}
      <Group foot={on ? t('tools.memset.footOn') : t('tools.memset.footOff')}>
        <SwitchRow title={t('tools.memset.use')} sub={on ? t('tools.memset.useOn') : t('tools.memset.useOff')} checked={on} onChange={(v) => void setPref({ on: v })} testId="mem-on" />
        <SwitchRow title={t('tools.memset.auto')} sub={auto ? t('tools.memset.autoOn') : t('tools.memset.autoOff')} checked={on && auto} disabled={!on} onChange={(v) => void setPref({ auto: v })} testId="mem-auto" />
      </Group>

      {on && (
        <Group foot={st.callName.fromProfile && name === st.callName.value ? t('tools.memset.callNameProfile') : t('tools.memset.callNameFoot')} testId="mem-name">
          <Field label={t('tools.memset.callName')} value={name} maxLength={60} onChange={setName} placeholder={t('tools.memset.callNamePh')} testId="mem-name-input" autoComplete="given-name"
            trailing={name.trim() !== (st.callName.fromProfile ? '' : st.callName.value) && (name.trim() || st.callName.id)
              ? <Button kind="primary" size="md" onClick={() => void saveName()} busy={nameBusy} testId="mem-name-save">{t('common.save')}</Button> : undefined} />
        </Group>
      )}

      {n === 0 ? (
        <EmptyState icon="memory" title={t('tools.memset.emptyTitle')} testId="mem-empty"
          text={t('tools.memset.emptyText')} />
      ) : SECTIONS.map((s) => {
        const items = st.items.filter((x) => x.section === s.id && x.sure);
        if (!items.length) return null;
        return (
          <Group key={s.id} title={s.title} aside={items.length} testId={`mem-sec-${s.id}`}>
            {items.map((it) => (
              <Row key={it.id} id={`mem-${it.id}`} title={it.text} sub={sourceOf(it, t)} chevron className={it.blocked ? 'k-row--blocked' : undefined}
                sub2={it.blocked ? <span className="k-row-warn">{t('tools.memset.blocked')}</span> : undefined}
                onClick={() => setEdit({ item: it, text: it.text, section: it.section as SectionId })} testId="mem-item" />
            ))}
          </Group>
        );
      })}
      {(() => {
        const maybe = st.items.filter((x) => !x.sure);
        if (!maybe.length) return null;
        return (
          <Group title={t('tools.memset.s.maybe')} aside={maybe.length} foot={t('tools.memset.maybeFoot')} testId="mem-sec-maybe">
            {maybe.map((it) => (
              <Row key={it.id} id={`mem-${it.id}`} title={it.text} sub={sourceOf(it, t)} testId="mem-maybe"
                right={<span className="mem-maybe-acts">
                  <button type="button" onClick={() => void confirmMaybe(it)} aria-label={`${t('tools.memset.confirm')}: ${it.text}`} title={t('tools.memset.confirm')} data-testid="mem-maybe-yes"><Icon n="check" sm /></button>
                  <button type="button" onClick={() => void remove(it)} aria-label={`${t('tools.memset.reject')}: ${it.text}`} title={t('tools.memset.reject')} data-testid="mem-maybe-no"><Icon n="x" sm /></button>
                </span>} />
            ))}
          </Group>
        );
      })()}

      {n > 0 && (
        <Group foot={t('tools.memset.clearFoot')}>
          <DestructiveButton asRow testId="mem-clear" onConfirm={clearAll}
            confirm={{ title: t('tools.memset.clearAsk'), message: t('tools.memset.clearMsg'), action: t('tools.memset.clearBtn') }}>{t('tools.memset.clearBtn')}</DestructiveButton>
        </Group>
      )}

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit?.item ? t('tools.memset.entry') : t('tools.memset.newEntry')} sub={edit?.item ? sourceOf(edit.item, t) : t('tools.memset.newSub')} testId="mem-sheet"
        foot={<div className="k-acts k-acts--end">
          {edit?.item && <Button kind="danger" icon="trash" onClick={() => void removeFromSheet(edit.item!)} testId="mem-del">{t('common.delete')}</Button>}
          <Button kind="primary" onClick={save} busy={busy} disabled={!edit?.text.trim()} testId="mem-save">{edit?.item ? t('common.save') : t('tools.add')}</Button>
        </div>}>
        {edit && (
          <>
            <Group>
              <Field label={t('tools.memset.what')} value={edit.text} multiline rows={3} maxLength={MAX} onChange={(v) => setEdit({ ...edit, text: v })} testId="mem-text"
                placeholder={t('tools.memset.whatPh')} />
              <PickerRow title={t('tools.memset.section')} value={edit.section} onChange={(v) => setEdit({ ...edit, section: v })} testId="mem-section"
                options={SECTIONS.map((s) => ({ value: s.id, label: s.title, hint: s.hint }))} />
            </Group>
            {edit.item?.chat && (
              <Group plain>
                <Link href={edit.item.chat.href} className="k-row" onClick={() => setEdit(null)} data-testid="mem-chat">
                  <span className="k-row-m"><span className="k-row-t">{t('tools.memset.openChat')}</span><span className="k-row-s">«{edit.item.chat.title}»</span></span>
                </Link>
              </Group>
            )}
            {edit.item?.blocked && <p className="k-sec-foot k-row-warn">{t('tools.memset.blockedNote')}</p>}
          </>
        )}
      </Sheet>
      {confirmUi}
      <MemoryIntro open={intro} again={again} onClose={() => { setIntro(false); setAgain(false); setRnBump((x) => x + 1); void reload(); }} />
    </KPage>
  );
}

export function MemoryRowLink({ on, count }: { on: boolean; count: number }) {
  const t = useT();
  return (
    <Group foot={t('tools.memset.rowFoot')}>
      <Row title={t('tools.memset.title')} icon="memory" value={on ? (count ? t('tools.memset.rowOn', { n: count }) : t('tools.onShort')) : t('tools.offShort')} href="/settings/memory" chevron testId="settings-memory" />
    </Group>
  );
}
