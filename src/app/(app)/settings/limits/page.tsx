import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { weekView } from '@/lib/week';
import { supportInfo } from '@/lib/support';
import { adminLimits } from '@/lib/adminLimits';
import { LimitsSettings } from '@/components/LimitsSettings';
import { AdminLimits } from '@/components/AdminLimits';

export const dynamic = 'force-dynamic';

export default async function LimitsPage() {
  const me = await currentUser();
  if (!me) redirect('/login');
  if (me.role === 'admin') return <AdminLimits d={await adminLimits(me)} />;
  return <LimitsSettings d={{ ...weekView(me), support: supportInfo() }} />;
}
