'use client';
import { useEffect, useState } from 'react';
import { Button, Field, Group, Notice, PickerRow, Row, Sheet, SwitchRow, useConfirm } from './Kit';

type Kind = 'openai-compatible' | 'openai' | 'anthropic' | 'openrouter' | 'ollama' | 'lmstudio';
type Prov = { id: string; name: string; kind: Kind; baseUrl: string; hasKey: boolean; models: number };
type Lvl = { id: string; label: string; effort: string | null };
type AM = { id: string; providerId: string; upstreamModel: string; name: string; levels: Lvl[]; images: number; tools: number; contextTokens: number; hidden: number };
type View = { providers: Prov[]; presets: Record<Kind, { label: string; baseUrl: string; needsKey: boolean }>; models: AM[]; configModels: { id: string; name: string; hidden: boolean }[] };

const KINDS: Kind[] = ['openai-compatible', 'openai', 'anthropic', 'openrouter', 'ollama', 'lmstudio'];
const LEVELS: Record<'plain' | 'reasoning', Lvl[]> = {
  plain: [{ id: 'off', label: 'off', effort: null }],
  reasoning: [{ id: 'low', label: 'low', effort: 'low' }, { id: 'medium', label: 'medium', effort: 'medium' }, { id: 'high', label: 'high', effort: 'high' }],
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

export function AdminModels() {
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState('');
  const [prov, setProv] = useState<{ id?: string; name: string; kind: Kind; baseUrl: string; key: string; hasKey: boolean } | null>(null);
  const [test, setTest] = useState<{ ok: boolean; models?: string[]; error?: string } | null>(null);
  const [mod, setMod] = useState<{ id: string; providerId: string; upstreamModel: string; name: string; levels: 'plain' | 'reasoning'; images: boolean; tools: boolean; contextTokens: string; isNew: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmUi, ask] = useConfirm();
  const load = () => fetch('/api/admin/providers').then((r) => r.json()).then(setV).catch(() => setErr('Нет связи с сервером'));
  useEffect(() => { void load(); }, []);

  const call = async (url: string, method: string, body?: unknown) => {
    setBusy(true);
    try {
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error || 'Не сохранилось'); return null; }
      setErr(''); return j;
    } finally { setBusy(false); }
  };
  const saveProv = async () => {
    if (!prov) return;
    const r = await call('/api/admin/providers', 'POST', { ...(prov.id ? { id: prov.id } : {}), name: prov.name, kind: prov.kind, baseUrl: prov.baseUrl, ...(prov.key ? { key: prov.key } : {}) });
    if (r) { setProv(null); setTest(null); void load(); }
  };
  const testProv = async () => {
    if (!prov) return;
    setTest(null);
    const r = await call('/api/admin/providers/test', 'POST', { ...(prov.id ? { id: prov.id } : {}), kind: prov.kind, baseUrl: prov.baseUrl, ...(prov.key ? { key: prov.key } : {}) });
    if (r) setTest(r);
  };
  const delProv = async (p: Prov) => {
    if (!(await ask({ title: `Удалить «${p.name}»?`, message: p.models ? `Вместе с ним уйдут его модели (${p.models}). Старые чаты с ними откроются, новых ответов не будет.` : undefined, action: 'Удалить' }))) return;
    if (await call(`/api/admin/providers?id=${encodeURIComponent(p.id)}`, 'DELETE')) void load();
  };
  const saveMod = async () => {
    if (!mod) return;
    const r = await call('/api/admin/models', 'POST', { id: mod.id, providerId: mod.providerId, upstreamModel: mod.upstreamModel, name: mod.name, levels: LEVELS[mod.levels],
      images: mod.images, tools: mod.tools, contextTokens: Number(mod.contextTokens) || 32768 });
    if (r) { setMod(null); void load(); }
  };
  const delMod = async (m: AM) => {
    if (!(await ask({ title: `Удалить модель «${m.name}»?`, action: 'Удалить' }))) return;
    if (await call(`/api/admin/models?id=${encodeURIComponent(m.id)}`, 'DELETE')) void load();
  };
  const provName = (id: string) => v?.providers.find((p) => p.id === id)?.name ?? '—';

  return (
    <>
      {confirmUi}
      {err && <Notice>{err}</Notice>}
      <Group title="Провайдеры" aside={<Button onClick={() => { setTest(null); setProv({ name: '', kind: 'openai-compatible', baseUrl: '', key: '', hasKey: false }); }} testId="prov-add">Добавить</Button>}
        foot="Ключ хранится зашифрованным и после сохранения не показывается." testId="admin-providers">
        {(v?.providers ?? []).length === 0 && <Row title="Провайдеров пока нет" tone="muted" />}
        {(v?.providers ?? []).map((p) => (
          <Row key={p.id} title={p.name} sub={`${v?.presets[p.kind]?.label ?? p.kind} · ${p.baseUrl || 'адрес по умолчанию'} · ${p.hasKey ? 'ключ задан' : 'без ключа'} · моделей: ${p.models}`}
            chevron onClick={() => { setTest(null); setProv({ id: p.id, name: p.name, kind: p.kind, baseUrl: p.baseUrl, key: '', hasKey: p.hasKey }); }} testId={`prov-${p.id}`} />
        ))}
      </Group>
      <Group title="Модели" aside={v?.providers.length ? <Button onClick={() => setMod({ id: '', providerId: v.providers[0].id, upstreamModel: '', name: '', levels: 'plain', images: false, tools: true, contextTokens: '32768', isNew: true })} testId="model-add">Добавить</Button> : undefined}
        foot={v?.configModels.length ? `Из файла конфигурации: ${v.configModels.map((m) => m.name).join(', ')}.` : undefined} testId="admin-models">
        {(v?.models ?? []).length === 0 && <Row title="Моделей из админки пока нет" tone="muted" />}
        {(v?.models ?? []).map((m) => (
          <Row key={m.id} title={m.name} sub={`${provName(m.providerId)} · ${m.upstreamModel}${m.hidden ? ' · скрыта' : ''}`} chevron
            onClick={() => setMod({ id: m.id, providerId: m.providerId, upstreamModel: m.upstreamModel, name: m.name, levels: m.levels.some((l) => l.effort) ? 'reasoning' : 'plain', images: !!m.images, tools: !!m.tools, contextTokens: String(m.contextTokens), isNew: false })} testId={`model-${m.id}`} />
        ))}
      </Group>

      <Sheet open={!!prov} onClose={() => setProv(null)} title={prov?.id ? 'Провайдер' : 'Новый провайдер'} testId="prov-sheet"
        foot={<>
          {prov?.id && <Button kind="danger" onClick={() => { const p = v?.providers.find((x) => x.id === prov.id); if (p) { setProv(null); void delProv(p); } }}>Удалить</Button>}
          <Button onClick={() => void testProv()} busy={busy} testId="prov-test">Проверить связь</Button>
          <Button kind="primary" onClick={() => void saveProv()} busy={busy} disabled={!prov?.name.trim()} testId="prov-save">Сохранить</Button>
        </>}>
        {prov && <Group>
          <PickerRow title="Вид" value={prov.kind} options={KINDS.map((k) => ({ value: k, label: v?.presets[k]?.label ?? k }))} onChange={(k) => setProv({ ...prov, kind: k })} testId="prov-kind" />
          <Field label="Название" value={prov.name} onChange={(x) => setProv({ ...prov, name: x })} placeholder={v?.presets[prov.kind]?.label} testId="prov-name" />
          <Field label="Адрес API" value={prov.baseUrl} onChange={(x) => setProv({ ...prov, baseUrl: x })} placeholder={v?.presets[prov.kind]?.baseUrl || 'https://…/v1'} mono testId="prov-url" />
          <Field label="Ключ API" type="password" value={prov.key} onChange={(x) => setProv({ ...prov, key: x })} placeholder={prov.hasKey ? 'задан — оставьте пустым, чтобы не менять' : v?.presets[prov.kind]?.needsKey ? 'нужен' : 'не нужен'} autoComplete="off" testId="prov-key" />
        </Group>}
        {test && (test.ok ? <Notice tone="ok">Связь есть. Моделей на сервере: {test.models?.length ?? 0}{test.models?.length ? ` — ${test.models.slice(0, 6).join(', ')}${test.models.length > 6 ? '…' : ''}` : ''}</Notice>
          : <Notice>Связи нет: {test.error}</Notice>)}
      </Sheet>

      <Sheet open={!!mod} onClose={() => setMod(null)} title={mod?.isNew ? 'Новая модель' : 'Модель'} testId="model-sheet"
        foot={<>
          {mod && !mod.isNew && <Button kind="danger" onClick={() => { const m = v?.models.find((x) => x.id === mod.id); if (m) { setMod(null); void delMod(m); } }}>Удалить</Button>}
          <Button kind="primary" onClick={() => void saveMod()} busy={busy} disabled={!mod?.id || !mod?.name.trim() || !mod?.upstreamModel.trim()} testId="model-save">Сохранить</Button>
        </>}>
        {mod && v && <Group>
          <PickerRow title="Провайдер" value={mod.providerId} options={v.providers.map((p) => ({ value: p.id, label: p.name }))} onChange={(x) => setMod({ ...mod, providerId: x })} testId="model-prov" />
          <Field label="Модель на сервере" value={mod.upstreamModel} onChange={(x) => setMod({ ...mod, upstreamModel: x, ...(mod.isNew && (!mod.id || mod.id === slug(mod.upstreamModel)) ? { id: slug(x) } : {}), ...(mod.isNew && (!mod.name || mod.name === mod.upstreamModel) ? { name: x } : {}) })} placeholder="gpt-4.1-mini, llama3.1:8b…" mono testId="model-upstream" />
          <Field label="Название в чате" value={mod.name} onChange={(x) => setMod({ ...mod, name: x })} testId="model-name" />
          {mod.isNew && <Field label="Код модели (в адресах и API)" value={mod.id} onChange={(x) => setMod({ ...mod, id: slug(x) })} mono testId="model-id" />}
          <PickerRow title="Размышление" value={mod.levels} options={[{ value: 'plain', label: 'Нет' }, { value: 'reasoning', label: 'Уровни low · medium · high' }]} onChange={(x) => setMod({ ...mod, levels: x })} testId="model-levels" />
          <Field label="Окно, токенов" value={mod.contextTokens} onChange={(x) => setMod({ ...mod, contextTokens: x.replace(/\D/g, '') })} inputMode="numeric" testId="model-ctx" />
          <SwitchRow title="Видит картинки" checked={mod.images} onChange={(x) => setMod({ ...mod, images: x })} testId="model-images" />
          <SwitchRow title="Инструменты (поиск, файлы, память)" checked={mod.tools} onChange={(x) => setMod({ ...mod, tools: x })} testId="model-tools" />
        </Group>}
      </Sheet>
    </>
  );
}
