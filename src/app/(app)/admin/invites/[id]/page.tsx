import { notFound, redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { getModels } from '@/lib/models';
import { inviteStats } from '@/lib/inviteStats';
import { InviteStatsView } from '@/components/InviteStats';

export const dynamic = 'force-dynamic';

export default async function InvitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') redirect('/');
  const tz = me.timezone || 'Europe/Moscow';
  const stats = inviteStats(id, tz);
  if (!stats) notFound();
  const models = getModels().map((m) => ({ id: m.id, name: m.name, variantOf: m.variantOf, variantName: m.variantName, levels: m.levels.map((l) => ({ id: l.id, label: l.label })) }));
  return <InviteStatsView initial={stats} models={models} />;
}
