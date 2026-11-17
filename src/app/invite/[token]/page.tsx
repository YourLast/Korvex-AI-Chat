import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { inviteState } from '@/lib/invites';
import { isUnlimited } from '@/lib/inviteTypes';
import { InviteForm } from '@/components/InviteForm';

export const dynamic = 'force-dynamic';

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (await currentUser()) redirect('/');
  const st = inviteState(token);
  const seats = st.state === 'ok' && st.invite && st.invite.maxUses > 1 && !isUnlimited(st.invite) ? { left: st.left ?? 0, max: st.invite.maxUses } : null;
  const email = st.state === 'ok' ? st.invite?.email ?? null : null;
  return <InviteForm token={token} state={st.state} seats={seats} email={email} />;
}
