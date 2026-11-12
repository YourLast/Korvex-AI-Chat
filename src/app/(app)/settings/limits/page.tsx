import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { weekView } from '@/lib/week';
import { supportInfo } from '@/lib/support';
import { LimitsSettings } from '@/components/LimitsSettings';

export const dynamic = 'force-dynamic';

export default async function LimitsPage() {
  const me = await currentUser();
  if (!me) redirect('/login');
  return <LimitsSettings d={{ ...weekView(me), support: supportInfo() }} />;
}
