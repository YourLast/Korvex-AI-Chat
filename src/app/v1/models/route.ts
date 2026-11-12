import { authKey } from '@/lib/apikeys';
import { getModels, isClaude } from '@/lib/models';
import { isRestrictedLevel } from '@/lib/levels';
import { oaiError, oaiJson } from '@/lib/oai';
import { apiOffResponse } from '@/lib/apiGate';
import { EXTRA_KEY } from '@/ext/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const off = apiOffResponse();
  if (off) return off;
  const a = authKey(req);
  if ('status' in a) return oaiError(a.status, a.message, a.code);
  const hideMax = true;
  const data = getModels().filter((m) => !m.hidden && !isClaude(m) && a.key.models.includes(m.id)).flatMap((m0) => (m0.apiNames?.length ? m0.apiNames : [m0.id]).map((apiId, _i, names) => {
    const m = hideMax ? { ...m0, levels: m0.levels.filter((l) => !isRestrictedLevel(l.id)) } : m0;
    const ctx = m.contextTokens, out = m.maxOutputTokens;
    return {
      id: apiId, object: 'model', created: Math.floor(a.key.createdAt / 1000), owned_by: 'korvex', name: m.fullName,
      ...(ctx ? { context_length: ctx, max_context_length: ctx, max_model_len: ctx, context_window: ctx, max_input_tokens: ctx } : {}),
      ...(out ? { max_output_tokens: out, max_completion_tokens: out } : {}),
      ...(ctx ? { top_provider: { context_length: ctx, ...(out ? { max_completion_tokens: out } : {}), is_moderated: false } } : {}),
      supported_parameters: [...(m.tools ? ['tools', 'tool_choice'] : []), 'reasoning_effort', 'max_tokens', 'stream'],
      [EXTRA_KEY]: { name: m.fullName, aliases: names.filter((x) => x !== apiId), reasoning_effort: m.levels.map((l) => (l.id === 'off' ? 'none' : l.id)), levels: m.levels.map((l) => l.id), default_level: a.key.levels[m.id] ?? m.defaultLevel, images: m.images !== false, tools: m.tools === true,
        ...(ctx ? { context_window: ctx } : {}), ...(m.engineContextTokens ? { engine_context_length: m.engineContextTokens } : {}), ...(out ? { max_output_tokens: out } : {}),
        history: 'server' },
    };
  }));
  return oaiJson({ object: 'list', data });
}
