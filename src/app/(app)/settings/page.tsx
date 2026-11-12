import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { SettingsClient } from '@/components/SettingsClient';
import { NotifySettings } from '@/components/NotifySettings';
import { VoiceSettings } from '@/components/VoiceSettings';
import { MemoryRowLink } from '@/components/MemorySettings';
import { memoryCount, memoryPrefs } from '@/lib/memory';
import { GithubSettings } from '@/components/GithubSettings';
import { canAgents } from '@/lib/roles';
import { weekView } from '@/lib/week';
import { LimitsRowLink } from '@/components/LimitsSettings';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const me = await currentUser();
  if (!me) redirect('/login');
  const wk = weekView(me);
  return <SettingsClient me={{ name: me.name, email: me.email, timezone: me.timezone, role: me.role }}><MemoryRowLink on={memoryPrefs(me.id).on} count={memoryCount(me.id)} /><LimitsRowLink limited={wk.limited} pct={wk.pct} /><NotifySettings quiet={me.notifyQuiet ?? null} timezone={me.timezone} /><VoiceSettings />{canAgents(me.role) && <GithubSettings />}</SettingsClient>;
}
