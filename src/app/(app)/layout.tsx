import { redirect } from 'next/navigation';
import { userFlags } from '@/lib/inviteFlags';
import { currentUser } from '@/lib/auth';
import { threadList } from '@/lib/threadlist';
import { listFolders } from '@/lib/folders';
import { lockedFor, retiredModels } from '@/lib/models';
import { modelsFor } from '@/lib/levelPolicy';
import { statusFor, startProbe } from '@/lib/status';
import { cleanTz, DEFAULT_TZ } from '@/lib/tz';
import { pageLang } from '@/lib/i18n/server';
import { apiOn } from '@/lib/apiGate';
import { Shell } from '@/components/Shell';
import { featureMap } from '@/lib/features';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const lang = await pageLang(user);
  const list = threadList(user.id);
  startProbe();
  const status = statusFor(cleanTz(user.lastTz) ?? cleanTz(user.timezone) ?? DEFAULT_TZ, Date.now(), lang);
  return <Shell user={{ name: user.name, email: user.email, role: user.role, orgs: !!userFlags(user.id).orgs }} models={modelsFor(user.role, lang, user.id)} retired={retiredModels()} locked={lockedFor(user.role, user.id)} initialThreads={list} initialFolders={listFolders(user.id)} initialStatus={status} apiOn={apiOn()} features={featureMap(user.id)}>{children}</Shell>;
}
