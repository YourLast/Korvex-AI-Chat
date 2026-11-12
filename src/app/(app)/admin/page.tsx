import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { listInvites } from '@/lib/invites';
import { getModels } from '@/lib/models';
import { adminSnapshot } from '@/lib/status';
import { adminBusy, startBusyWatch } from '@/lib/busy';
import { adminAlerts } from '@/lib/loadAlerts';
import { asLang } from '@/lib/i18n/core';
import { people } from '@/lib/adminView';
import { AdminClient } from '@/components/AdminClient';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const me = await currentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') redirect('/');
  startBusyWatch();
  const users = people();
  const invites = listInvites();
  const models = getModels().map((m) => ({ id: m.id, name: m.name, fullName: m.fullName, upstreamModel: m.upstreamModel, baseUrl: m.baseUrl, maxConcurrent: m.maxConcurrent, images: m.images !== false, defaultLevel: m.defaultLevel, variantOf: m.variantOf, variantName: m.variantName, levels: m.levels.map((l) => ({ id: l.id, effort: l.effort, hint: l.hint ?? '' })) }));
  return <AdminClient meId={me.id} users={users} invites={invites} models={models} notices={{ ...adminSnapshot(), busy: adminBusy(), alerts: adminAlerts(asLang(me.lang) ?? 'ru') }} tz={me.timezone || 'Europe/Moscow'} />;
}
