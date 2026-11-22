import { featureOn } from '@/lib/features';
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
import { cookies } from 'next/headers';
import { pickTheme, THEME_COOKIE } from '@/lib/theme';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const me = await currentUser();
  if (!me) redirect('/login');
  const wk = weekView(me);
  const theme = pickTheme({ user: me.theme, cookie: (await cookies()).get(THEME_COOKIE)?.value });
  return <SettingsClient me={{ name: me.name, email: me.email, timezone: me.timezone, role: me.role, theme }}><MemoryRowLink on={memoryPrefs(me.id).on} count={memoryCount(me.id)} /><LimitsRowLink limited={wk.limited} pct={wk.pct} /><NotifySettings quiet={me.notifyQuiet ?? null} timezone={me.timezone} /><VoiceSettings />{canAgents(me.role) && featureOn('code') && <GithubSettings />}</SettingsClient>;
}
