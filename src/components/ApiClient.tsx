'use client';
import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import type { KeyView } from '@/lib/apikeys';
import { localeOf, type Lang } from '@/lib/i18n/core';
import { errText } from '@/lib/i18n/errors';
import { useT, type T } from '@/lib/i18n/react';
import { relTime } from '@/lib/schedule';
import { modelLabel } from '@/lib/levels';
import { fmtIntL, fmtTokL } from './Memory';
import { Button, CopyButton, DestructiveButton, EmptyState, Field, Group, KPage, Notice, PickerRow, Row, Seg, Sheet, SwitchRow, toast } from './Kit';
import { API_MEMORY_KEY, EXTRA_KEY } from '@/ext/client';

type M = { id: string; apiId: string; name: string; fullName: string; defaultLevel: string; maxConcurrent: number; levels: { id: string; label: string; hint: string }[]; variantOf?: string; variantName?: string;
  images?: boolean; tools?: boolean; contextTokens?: number; maxOutputTokens?: number };
const effortOf = (lvl: string) => (lvl === 'off' ? 'none' : lvl);
const ZED_EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const editorEffort = (m: M) => (ZED_EFFORTS.has(m.defaultLevel) ? m.defaultLevel : m.levels.some((l) => ZED_EFFORTS.has(l.id)) ? m.levels.find((l) => ZED_EFFORTS.has(l.id))!.id : 'medium');
const outTokens = (m: M) => m.maxOutputTokens ?? (m.tools ? 8192 : 4096);
const efforts = (m: M) => m.levels.map((l) => effortOf(l.id));
const date = (ts: number, lang: Lang) => new Date(ts).toLocaleDateString(localeOf(lang), { day: 'numeric', month: 'long', year: 'numeric' });
const rich = (s: string): ReactNode => s.split('`').map((x, i) => (i % 2 ? <code key={i}>{x}</code> : x));
const cm = (text: string, mark: string) => text.split('\n').map((l) => `${mark} ${l}`).join('\n');
const tzNow = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; } };
const EXPIRY: { value: number; id: string; testId: string }[] = [
  { value: 0, id: 'none', testId: 'key-exp-none' }, { value: 7, id: '7', testId: 'key-exp-7' }, { value: 30, id: '30', testId: 'key-exp-30' },
  { value: 90, id: '90', testId: 'key-exp-90' }, { value: 365, id: '365', testId: 'key-exp-365' },
];
const expiryLabel = (t: T, value: number) => (value === 0 ? t('tools.api.expNone') : value === 365 ? t('tools.api.expYear') : t('tools.days', { n: value }));

function statusText(k: KeyView, t: T): string {
  if (k.status === 'revoked') return k.revokedAt ? t('tools.api.revokedOn', { date: date(k.revokedAt, t.lang) }) : t('tools.api.revoked');
  if (k.status === 'expired') return k.expiresAt ? t('tools.api.expiredOn', { date: date(k.expiresAt, t.lang) }) : t('tools.api.expired');
  return k.expiresAt ? t('tools.api.validUntil', { date: date(k.expiresAt, t.lang) }) : t('tools.api.noExpiry');
}

export function ApiClient({ base, admin, initial, models }: { base: string; admin: boolean; initial: KeyView[]; models: M[] }) {
  const t = useT();
  const L = t.lang;
  const [keys, setKeys] = useState(initial);
  const blank = () => ({ name: '', models: [models[0].id] as string[], levels: Object.fromEntries(models.map((m) => [m.id, m.defaultLevel])) as Record<string, string>, rpm: '20', expires: 0 });
  const [f, setF] = useState(blank);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<'new' | 'made' | null>(null);
  const [made, setMade] = useState<{ key: string; view: KeyView } | null>(null);
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState<KeyView | null>(null);
  const [oldOpen, setOldOpen] = useState(false);
  const [tab, setTab] = useState<'curl' | 'python' | 'js'>('curl');
  const [ed, setEd] = useState<'zed' | 'cursor' | 'opencode' | 'claude'>('zed');
  const [docModel, setDocModel] = useState(models[0].id);
  const newBtn = useRef<HTMLDivElement>(null);
  const dm = models.find((m) => m.id === docModel) ?? models[0];
  const lvl = made?.view.levels[dm.id] ?? dm.defaultLevel;
  const key = made?.key ?? '$KORVEX_API_KEY';
  const tz = useMemo(tzNow, []);
  const active = keys.filter((k) => k.status === 'active');
  const old = keys.filter((k) => k.status !== 'active');
  const mName = (id: string) => modelLabel(models, id);
  const lName = (mid: string, lid: string) => models.find((m) => m.id === mid)?.levels.find((l) => l.id === lid)?.label ?? lid;
  const modelsText = (k: KeyView, sep: string) => (k.models.length ? k.models.map((id) => `${mName(id)}${sep}${lName(id, k.levels[id] ?? '')}`).join(', ') : t('tools.api.onlyService'));
  const rpmN = Math.round(Number(f.rpm));
  const rpmBad = !Number.isFinite(rpmN) || rpmN < 1 || rpmN > 600;

  const reload = async () => { const r = await fetch('/api/keys', { cache: 'no-store' }); if (r.ok) setKeys(((await r.json()) as { keys: KeyView[] }).keys); };
  const create = async () => {
    setErr(''); setBusy(true);
    try {
      const body = { name: f.name.trim(), models: f.models, levels: Object.fromEntries(f.models.map((id) => [id, f.levels[id]])), rpm: rpmN, expiresDays: f.expires || null };
      const r = await fetch('/api/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { key?: string; view?: KeyView; error?: string };
      if (!r.ok || !j.key || !j.view) { setErr(j.error ? errText(L, j.error) : t('tools.api.createFail', { code: r.status })); return; }
      setMade({ key: j.key, view: j.view }); setShown(false); setSheet('made');
      if (!j.view.models.includes(docModel)) setDocModel(j.view.models[0]);
      setF(blank());
      await reload();
    } catch { setErr(t('tools.api.offline')); } finally { setBusy(false); }
  };
  const revoke = async (k: KeyView) => {
    const r = await fetch(`/api/keys/${k.id}`, { method: 'DELETE' }).catch(() => null);
    if (r?.ok) { if (made?.view.id === k.id) setMade(null); setOpen(null); await reload(); toast(t('tools.api.revokedToast', { name: k.name || k.prefix })); }
    else toast(t('tools.api.revokeFail'), 'error');
  };
  const toggleModel = (id: string, on: boolean) => setF((x) => ({ ...x, models: on ? models.map((m) => m.id).filter((m) => m === id || x.models.includes(m)) : x.models.filter((y) => y !== id) }));
  const closeSheet = () => { if (sheet === 'made') setShown(true); setSheet(null); setErr(''); };

  const hello = t('tools.api.sn.hello'), esg = t('tools.api.sn.esg');
  const snippets = useMemo(() => ({
    curl: `curl ${base}/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -H "X-Korvex-Conversation: demo-1" \\
  -d '{
    "model": "${dm.apiId}",
    "reasoning_effort": "${effortOf(lvl)}",
    "messages": [{"role": "user", "content": "${hello}"}]
  }'

# ${t('tools.api.sn.stream')}
curl -N ${base}/chat/completions \\
  -H "Authorization: Bearer ${key}" -H "Content-Type: application/json" \\
  -d '{"model": "${dm.apiId}", "stream": true, "stream_options": {"include_usage": true},
       "messages": [{"role": "user", "content": "${esg}"}]}'

# ${t('tools.api.sn.models')}
curl ${base}/models -H "Authorization: Bearer ${key}"`,
    python: `# pip install openai
from openai import OpenAI

client = OpenAI(base_url="${base}", api_key="${key}", timeout=1800)

r = client.chat.completions.create(
    model="${dm.apiId}",
    reasoning_effort="${effortOf(lvl)}",
    messages=[{"role": "user", "content": "${hello}"}],
    extra_headers={"X-Korvex-Conversation": "demo-1"},  # ${t('tools.api.sn.conv')}
)
print(r.choices[0].message.content)
${API_MEMORY_KEY ? `print(r.usage.model_extra.get("${API_MEMORY_KEY}"))  # ${t('tools.api.sn.memUsed')}\n` : ''}
# ${t('tools.api.sn.streamShort')}
for ch in client.chat.completions.create(
        model="${dm.apiId}", stream=True, stream_options={"include_usage": True},
        messages=[{"role": "user", "content": "${esg}"}]):
    if ch.choices and ch.choices[0].delta.content:
        print(ch.choices[0].delta.content, end="", flush=True)`,
    js: `// npm i openai
import OpenAI from "openai";

const client = new OpenAI({ baseURL: "${base}", apiKey: "${key}" });

const r = await client.chat.completions.create(
  {
    model: "${dm.apiId}",
    reasoning_effort: "${effortOf(lvl)}",
    messages: [{ role: "user", content: "${hello}" }],
  },
  { headers: { "X-Korvex-Conversation": "demo-1" } }, // ${t('tools.api.sn.conv')}
);
console.log(r.choices[0].message.content);

// ${t('tools.api.sn.streamShort')}
const s = await client.chat.completions.create({
  model: "${dm.apiId}", stream: true,
  messages: [{ role: "user", content: "${esg}" }],
});
for await (const ch of s) process.stdout.write(ch.choices[0]?.delta?.content ?? "");`,
  }), [base, key, dm.id, lvl, hello, esg, t]);

  const sample = `{
  "id": "chatcmpl-3f9c…",
  "object": "chat.completion",
  "model": "${dm.apiId}",
  "choices": [{
    "index": 0,
    "message": { "role": "assistant", "content": "${t('tools.api.sampleHello', { name: dm.name })}", "reasoning_content": "…" },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 412, "completion_tokens": 96, "total_tokens": 508${API_MEMORY_KEY ? `,
    "${API_MEMORY_KEY}": { "total_tokens": 1210, "limit_tokens": 5767168, "remaining_tokens": 5765958, "files": 0, "chat_tokens": 1210 }` : ''}
  },
  "${EXTRA_KEY}": { "conversation": "demo-1" }
}`;

  const edModels = models.filter((m) => !m.variantOf);
  const toolModel = edModels.find((m) => m.tools);
  const cc = toolModel ?? edModels[0];
  const editors = useMemo(() => ({
    zed: `${cm(t('tools.api.sn.zedHead'), '//')}
{
  "language_models": {
    "openai_compatible": {
      "Korvex": {
        "api_url": "${base}",
        "available_models": [
${edModels.map((m) => `          {
            "name": "${m.apiId}",
            "display_name": "${m.fullName}",
            "max_tokens": ${m.contextTokens ?? 131072},
            "max_output_tokens": ${outTokens(m)},
            "reasoning_effort": "${editorEffort(m)}",${m.levels.some((l) => l.id === 'on') ? '  // ' + t('tools.api.sn.zedOn', { name: m.name }) : ''}
            "capabilities": {
              "tools": ${m.tools ? 'true' : 'false'},${m.tools ? '' : '  // ' + t('tools.api.sn.zedNoTools', { name: m.name })}
              "images": ${m.tools ? 'false' : m.images !== false ? 'true' : 'false'},${m.tools ? '  // ' + t('tools.api.sn.zedNoImg') : ''}
              "parallel_tool_calls": false,
              "prompt_cache_key": true,  // ${t('tools.api.sn.zedCache')}
              "chat_completions": true,  // ${t('tools.api.sn.zedChat')}
              "interleaved_reasoning": true,  // ${t('tools.api.sn.zedReason')}
              "max_tokens_parameter": false
            }
          }`).join(',\n')}
        ]
      }
    }
  }
}`,
    cursor: `Cursor -> Settings -> Models:
  1. API Keys -> OpenAI API Key: ${key}
  2. Override OpenAI Base URL: ${base}
  3. Add custom model: ${edModels.map((m) => m.apiId).join(', ')}
     ${t('tools.api.sn.cuName')}
${t('tools.api.sn.cuHist', { list: edModels.map((m) => t('tools.api.sn.cuWin', { id: m.apiId, num: fmtIntL(L, m.contextTokens ?? 131072) })).join(', ') })}

${t('tools.api.sn.cuNet')}
${toolModel ? `${t('tools.api.sn.cuAgent', { id: toolModel.id })}${edModels.some((m) => !m.tools) ? t('tools.api.sn.cuNoTools', { names: edModels.filter((m) => !m.tools).map((m) => m.name).join(', ') }) : ''}` : ''}`,
    opencode: `${cm(t('tools.api.sn.ocHead'), '//')}
{
  "$schema": "https://opencode.ai/config.json",
  "compaction": { "auto": false, "prune": false },
  "provider": {
    "korvex": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Korvex",
      "options": { "baseURL": "${base}", "apiKey": "{env:KORVEX_API_KEY}" },
      "models": {
${edModels.map((m) => `        "${m.apiId}": {
          "name": "${m.fullName}",
          "tool_call": ${m.tools ? 'true' : 'false'},
          "reasoning": true,
          "attachment": ${m.tools ? 'false' : m.images !== false ? 'true' : 'false'},
          "interleaved": { "field": "reasoning_content" },
          "limit": { "context": ${m.contextTokens ?? 131072}, "output": ${outTokens(m)} },
          "options": { "reasoningEffort": "${effortOf(m.defaultLevel)}" },
          "variants": {
${efforts(m).map((e) => `            "${e}": { "reasoningEffort": "${e}" }`).join(',\n')}
          }
        }`).join(',\n')}
      }
    }
  }
}`,
    claude: `${cm(t('tools.api.sn.clHead'), '#')}
model_list:
  - model_name: ${cc.apiId}
    litellm_params:
      model: hosted_vllm/${cc.apiId}   # ${t('tools.api.sn.clHost')}
      api_base: ${base}
      api_key: os.environ/KORVEX_API_KEY
  - model_name: "*"                 # ${t('tools.api.sn.clStar')}
    litellm_params:
      model: hosted_vllm/${cc.apiId}
      api_base: ${base}
      api_key: os.environ/KORVEX_API_KEY
litellm_settings:
  drop_params: true                 # ${t('tools.api.sn.clDrop')}
general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY

# ${t('tools.api.sn.clStep2')}
export KORVEX_API_KEY=${key}
export LITELLM_MASTER_KEY=sk-$(openssl rand -hex 16); echo $LITELLM_MASTER_KEY
litellm --config litellm_config.yaml --host 127.0.0.1 --port 4000

# ${t('tools.api.sn.clStep3')}
export ANTHROPIC_BASE_URL=http://127.0.0.1:4000
export ANTHROPIC_AUTH_TOKEN=<${t('tools.api.sn.clTok')}>
export ANTHROPIC_MODEL=${cc.apiId} ANTHROPIC_DEFAULT_HAIKU_MODEL=${cc.apiId} ANTHROPIC_DEFAULT_SONNET_MODEL=${cc.apiId} ANTHROPIC_DEFAULT_OPUS_MODEL=${cc.apiId} ANTHROPIC_DEFAULT_FABLE_MODEL=${cc.apiId} CLAUDE_CODE_SUBAGENT_MODEL=${cc.apiId}
export CLAUDE_CODE_MAX_CONTEXT_TOKENS=${cc.contextTokens ?? 131072} DISABLE_AUTO_COMPACT=1   # ${t('tools.api.sn.clWin', { name: cc.name })}
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
claude`,
  }), [base, key, edModels, toolModel, cc, L, t]);

  const keyRow = (k: KeyView) => (
    <Row key={k.id} testId={`key-row-${k.id}`} title={k.name || t('tools.api.untitled')} tone={k.status === 'active' ? 'strong' : 'muted'} chevron onClick={() => setOpen(k)}
      sub={<><span className="k-mono">{k.prefix}…</span> · {modelsText(k, ' ')}{admin && k.owner ? ` · ${k.owner}` : ''}</>}
      sub2={k.status === 'active' ? `${t('tools.api.rpm', { n: k.rpm })} · ${k.lastUsedAt ? t('tools.api.lastUsed', { when: relTime(k.lastUsedAt, tz, undefined, L) }) : t('tools.api.neverUsed')}` : statusText(k, t)} />
  );
  const newKey = () => { setErr(''); setSheet('new'); };

  return (
    <KPage title="API" sub={t('tools.api.active', { n: active.length })} testId="api-page"
      desc={t('tools.api.desc')}
      action={keys.length > 0 && <div ref={newBtn}><Button kind="primary" icon="plus" onClick={newKey} testId="key-new">{t('tools.api.new')}</Button></div>}>

      {made && shown && (
        <Group title={t('tools.api.madeTitle', { name: made.view.name || made.view.prefix })} testId="key-made" plain>
          <div className="k-secret">
            <code data-testid="key-value">{made.key}</code>
            <p>{t('tools.api.madeNote')}</p>
            <div className="k-acts"><CopyButton text={made.key} kind="primary" testId="key-copy" onCopied={() => toast(t('tools.api.keyCopied'))} /><Button kind="plain" onClick={() => setShown(false)}>{t('tools.hide')}</Button></div>
          </div>
        </Group>
      )}

      {keys.length === 0 ? (
        <EmptyState icon="key" title={t('tools.api.emptyTitle')} text={t('tools.api.emptyText')} testId="keys-empty">
          <Button kind="primary" size="lg" icon="plus" onClick={newKey} testId="key-new">{t('tools.api.emptyBtn')}</Button>
        </EmptyState>
      ) : (
        <Group title={admin ? t('tools.api.allKeys') : t('tools.api.yourKeys')} aside={admin ? t('tools.api.youAdmin') : undefined} testId="keys">
          {active.length === 0 && <Row title={t('tools.api.noActive')} tone="muted" />}
          {active.map(keyRow)}
          {old.length > 0 && <Row title={t('tools.api.oldKeys', { n: old.length })} tone="muted" onClick={() => setOldOpen((o) => !o)} testId="keys-old"
            right={<span className="k-row-s">{oldOpen ? t('tools.hide') : t('tools.show')}</span>} />}
          {oldOpen && old.map(keyRow)}
        </Group>
      )}

      <Group title={t('tools.api.connect')} testId="api-docs" plain>
        <div className="k-list">
          <Row title={<span className="k-mono" data-testid="api-base">{base}</span>} sub={t('tools.api.baseUrl')} right={<CopyButton text={base} iconOnly label={t('tools.api.copyAddr')} onCopied={() => toast(t('tools.api.addrCopied'))} />} />
        </div>
        <div className="k-doc k-sec-foot"><p>{rich(t('tools.api.hdr', { key: made ? `${made.key.slice(0, 9)}…` : t('tools.api.keyPh') }))}</p></div>
      </Group>

      <Group title={t('tools.api.methods')}>
        <dl className="k-defs">
          <div><dt>GET /v1/models</dt><dd>{rich(t('tools.api.mModels'))}</dd></div>
          <div><dt>POST /v1/chat/completions</dt><dd>{rich(t('tools.api.mChat', { list: edModels.map((m) => t('tools.api.mConc', { name: m.name, n: m.maxConcurrent })).join(', ') }))}</dd></div>
        </dl>
      </Group>

      <Group title={t('tools.api.fields')}>
        <dl className="k-defs">
          <div><dt>model</dt><dd>{rich(t('tools.api.fModel', { list: models.map((m) => m.id).join(t('tools.api.or')) }))}</dd></div>
          <div><dt>messages</dt><dd>{rich(t('tools.api.fMessages'))}</dd></div>
          <div><dt>tools, tool_choice</dt><dd>{rich(t('tools.api.fTools', { list: toolModel ? `${models.filter((m) => m.tools).map((m) => m.id).join(', ')}` : t('tools.api.noneYet') }))}</dd></div>
          <div><dt>max_tokens</dt><dd>{rich(t('tools.api.fMax'))}</dd></div>
          <div><dt>reasoning_effort</dt><dd>{rich(t('tools.api.fEffort', { list: models.map((m) => `${m.name}: ${m.levels.map((l) => effortOf(l.id)).join(', ')}`).join('. ') }))}</dd></div>
          <div><dt>stream</dt><dd>{rich(t('tools.api.fStream'))}</dd></div>
          <div><dt>stream_options.include_usage</dt><dd>{rich(t('tools.api.fUsage'))}</dd></div>
          <div><dt>X-Korvex-Conversation</dt><dd>{rich(t('tools.api.fConv'))}</dd></div>
          <div><dt>user</dt><dd>{t('tools.api.fUser')}</dd></div>
        </dl>
      </Group>

      <Group title={t('tools.api.examples')} id="snippets" plain>
        <div className="k-acts">
          <Seg label={t('tools.api.progLang')} value={tab} onChange={setTab} options={[{ value: 'curl', label: 'curl', testId: 'snip-curl' }, { value: 'python', label: 'Python', testId: 'snip-python' }, { value: 'js', label: 'JavaScript', testId: 'snip-js' }]} />
          {models.length > 1 && <Seg label={t('tools.api.docModel')} value={docModel} onChange={setDocModel} options={models.map((m) => ({ value: m.id, label: modelLabel(models, m.id), testId: `snip-model-${m.id}` }))} />}
        </div>
        {!made && <p className="k-sec-foot">{rich(t('tools.api.envHint'))}</p>}
        <div className="k-code" data-testid="snippet">
          <div className="k-code-h"><span>{tab === 'curl' ? 'bash' : tab === 'python' ? 'python' : 'javascript'}</span><CopyButton text={snippets[tab]} kind="plain" testId="snippet-copy" onCopied={() => toast(t('tools.api.sampleCopied'))} /></div>
          <pre><code>{snippets[tab]}</code></pre>
        </div>
      </Group>

      <Group title={t('tools.api.editors')} id="editors" testId="api-editors" plain foot={toolModel
        ? <>{t('tools.api.edTools', { names: models.filter((m) => m.tools).map((m) => m.name).join(', ') })}{edModels.some((m) => !m.tools) && <>{rich(t('tools.api.edNoTools', { names: edModels.filter((m) => !m.tools).map((m) => m.name).join(', ') }))}</>}
          {toolModel.contextTokens ? <>{t('tools.api.edWinA', { name: toolModel.name })}<span data-testid="api-window">{fmtIntL(L, toolModel.contextTokens)}</span>{t('tools.api.edWinB')}</> : null}</>
        : t('tools.api.edNone')}>
        <div className="k-acts">
          <Seg label={t('tools.api.program')} value={ed} onChange={setEd} options={[{ value: 'zed', label: 'Zed', testId: 'ed-zed' }, { value: 'cursor', label: 'Cursor', testId: 'ed-cursor' }, { value: 'opencode', label: 'OpenCode', testId: 'ed-opencode' }, { value: 'claude', label: 'Claude Code', testId: 'ed-claude' }]} />
        </div>
        <div className="k-code" data-testid="editor-snippet">
          <div className="k-code-h"><span>{ed === 'cursor' ? t('tools.api.settingsLabel') : ed === 'zed' ? 'settings.json' : ed === 'claude' ? 'LiteLLM + Claude Code' : 'opencode.json'}</span><CopyButton text={editors[ed]} kind="plain" testId="editor-copy" onCopied={() => toast(t('tools.api.confCopied'))} /></div>
          <pre><code>{editors[ed]}</code></pre>
        </div>
      </Group>

      <Group title={t('tools.api.sampleTitle')} plain>
        <div className="k-code"><div className="k-code-h"><span>json</span><CopyButton text={sample} kind="plain" /></div><pre><code>{sample}</code></pre></div>
      </Group>

      <Group title={t('tools.api.errors')} testId="api-errors" foot={rich(t('tools.api.errFoot', { json: '{"error": {"message", "type", "code", "param"}}' }))}>
        <dl className="k-defs">
          <div><dt>400 · invalid_reasoning_effort, invalid_messages</dt><dd>{t('tools.api.e400')}</dd></div>
          <div><dt>400 · tools_not_supported, invalid_tools, invalid_tool_choice</dt><dd>{rich(edModels.some((m) => !m.tools) ? t('tools.api.e400tools', { names: edModels.filter((m) => !m.tools).map((m) => m.name).join(', ') }) : t('tools.api.e400tools2'))}</dd></div>
          <div><dt>401 · missing_api_key, invalid_api_key</dt><dd>{t('tools.api.e401')}</dd></div>
          <div><dt>403 · model_not_allowed</dt><dd>{t('tools.api.e403')}</dd></div>
          <div><dt>404 · model_not_found</dt><dd>{t('tools.api.e404')}</dd></div>
          <div><dt>413 · request_too_large, context_length_exceeded</dt><dd>{t('tools.api.e413')}</dd></div>
          <div><dt>429 · rate_limit_exceeded, too_many_concurrent</dt><dd>{t('tools.api.e429')}</dd></div>
          <div><dt>502 · upstream_error</dt><dd>{t('tools.api.e502')}</dd></div>
        </dl>
      </Group>

      {}
      <Sheet open={sheet !== null} onClose={closeSheet} title={sheet === 'made' ? t('tools.api.madeSheet') : t('tools.api.new')} anchor={newBtn.current} testId="key-sheet" focusFirst={sheet === 'made' ? '[data-testid=key-copy]' : '[data-testid=key-name]'}
        foot={sheet === 'made'
          ? <Button kind="secondary" size="lg" block onClick={closeSheet} testId="key-done">{t('common.done')}</Button>
          : <Button kind="primary" size="lg" block onClick={create} busy={busy} disabled={!f.models.length || rpmBad} testId="key-create">{t('tools.api.createKey')}</Button>}>
        {sheet === 'made' && made ? (
          <div className="k-secret">
            <code data-testid="key-value">{made.key}</code>
            <p>{t('tools.api.onceNote')}</p>
            <div className="k-acts"><CopyButton text={made.key} kind="primary" size="lg" block testId="key-copy" onCopied={() => toast(t('tools.api.keyCopied'))} /></div>
          </div>
        ) : (
          <>
            <Group>
              <Field label={t('tools.name')} value={f.name} maxLength={80} placeholder={t('tools.api.namePh')} onChange={(v) => setF({ ...f, name: v })} testId="key-name" />
            </Group>
            <Group title={t('tools.api.models')} foot={!f.models.length ? <span className="k-neg">{t('tools.api.needModel')}</span> : t('tools.api.levelNote')}>
              {models.map((m) => (
                <Fragment key={m.id}>
                  <SwitchRow title={modelLabel(models, m.id)} sub={m.fullName} checked={f.models.includes(m.id)} onChange={(v) => toggleModel(m.id, v)} testId={`key-model-${m.id}`} />
                  {f.models.includes(m.id) && (
                    <PickerRow title={t('tools.api.level')} value={f.levels[m.id]} onChange={(v) => setF({ ...f, levels: { ...f.levels, [m.id]: v } })} testId={`key-level-${m.id}`}
                      options={m.levels.map((l) => ({ value: l.id, label: l.label, hint: l.hint, testId: `key-level-${m.id}-${l.id}` }))} />
                  )}
                </Fragment>
              ))}
            </Group>
            <Group title={t('tools.api.limits')} foot={rpmBad ? <span className="k-neg">{t('tools.api.rpmBad')}</span> : t('tools.api.expNote')}>
              <Row title={t('tools.api.rpmLabel')} right={<input className="k-inl" type="number" inputMode="numeric" min={1} max={600} value={f.rpm} aria-label={t('tools.api.rpmLabel')} style={{ width: 96 }}
                onChange={(e) => setF({ ...f, rpm: e.target.value })} data-testid="key-rpm" />} />
              <PickerRow title={t('tools.api.expiry')} value={f.expires} onChange={(v) => setF({ ...f, expires: v })} options={EXPIRY.map((e) => ({ value: e.value, label: expiryLabel(t, e.value), testId: e.testId }))} testId="key-expiry" />
            </Group>
            {err && <Notice>{err}</Notice>}
          </>
        )}
      </Sheet>

      {}
      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.name || t('tools.api.key')} testId="key-detail">
        {open && (
          <>
            <Group foot={t('tools.api.lostNote')}>
              <Row title={t('tools.api.prefix')} value={<span className="k-mono">{open.prefix}…</span>} />
              {admin && open.owner && <Row title={t('tools.api.owner')} value={open.owner} />}
              <Row title={t('tools.api.models')} value={modelsText(open, ' · ')} />
              <Row title={t('tools.api.limit')} value={t('tools.api.rpm', { n: open.rpm })} />
              <Row title={t('tools.api.term')} value={statusText(open, t)} />
              <Row title={t('tools.api.created')} value={date(open.createdAt, L)} />
            </Group>
            <Group title={t('tools.api.usage')}>
              <Row title={t('tools.api.lastReq')} value={open.lastUsedAt ? relTime(open.lastUsedAt, tz, undefined, L) : t('tools.api.none')} />
              <Row title={t('tools.api.reqTotal')} value={fmtIntL(L, open.requests)} />
              <Row title={t('tools.api.tokens')} value={`${fmtTokL(L, open.promptTokens + open.completionTokens)}`} sub={t('tools.api.inOut', { a: fmtTokL(L, open.promptTokens), b: fmtTokL(L, open.completionTokens) })} />
            </Group>
            {open.status !== 'revoked' && (
              <DestructiveButton block testId={`revoke-${open.id}`} onConfirm={() => revoke(open)}
                confirm={{ title: t('tools.api.revokeAsk', { name: open.name || open.prefix }), message: t('tools.api.revokeMsg'), action: t('tools.api.revoke') }}>{t('tools.api.revokeKey')}</DestructiveButton>
            )}
          </>
        )}
      </Sheet>
    </KPage>
  );
}
