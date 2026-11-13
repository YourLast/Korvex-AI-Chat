import { isRestrictedLevel } from '@/lib/levels';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { listKeys } from '@/lib/apikeys';
import { getModels, levelHint, isClaude, apiNameOf } from '@/lib/models';
import { pageLang } from '@/lib/i18n/server';
import { forRole } from '@/lib/levelPolicy';
import { ApiClient } from '@/components/ApiClient';
import { apiBase } from '@/lib/apiBase';
import { apiOn } from '@/lib/apiGate';
import { cfg } from '@/lib/cfg';

export const dynamic = 'force-dynamic';

export default async function ApiPage() {
  const me = await currentUser();
  if (!me) redirect('/login');
  if (!apiOn()) redirect('/');
  const lang = await pageLang(me);
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host') || cfg('KX_DEFAULT_HOST', 'localhost');
  const proto = h.get('x-forwarded-proto') || (/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) ? 'http' : 'https');
  const models = forRole(getModels().filter((m) => !m.hidden && !isClaude(m)).map((m) => ({ id: m.id, apiId: apiNameOf(m), name: m.name, fullName: m.fullName, defaultLevel: m.defaultLevel, maxConcurrent: m.maxConcurrent, images: m.images !== false, tools: m.tools === true, contextTokens: m.contextTokens, maxOutputTokens: m.maxOutputTokens, variantOf: m.variantOf, variantName: m.variantName, levels: m.levels.filter((l) => !isRestrictedLevel(l.id)).map((l) => ({ id: l.id, label: l.label, hint: levelHint(me.role, lang, l) ?? '' })) })), me.role, me.id);
  return <ApiClient base={apiBase(host, proto)} admin={me.role === 'admin'} initial={listKeys(me)} models={models} />;
}
