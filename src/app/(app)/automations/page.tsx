import { desc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { getDb, schema } from '@/lib/db';
import { autoView } from '@/lib/autoview';
import { canAgents } from '@/lib/roles';
import { AutomationsClient } from '@/components/AutomationsClient';
import { AlphaOnly } from '@/components/AlphaOnly';

export const dynamic = 'force-dynamic';

export default async function AutomationsPage() {
  const me = await currentUser();
  if (!me) redirect('/login');
  if (!canAgents(me.role)) return <AlphaOnly titleKey="tools.auto.title" />;
  const rows = getDb().select().from(schema.automations).where(eq(schema.automations.userId, me.id)).orderBy(desc(schema.automations.createdAt)).all();
  return <AutomationsClient initial={rows.map(autoView)} timezone={me.timezone} />;
}
