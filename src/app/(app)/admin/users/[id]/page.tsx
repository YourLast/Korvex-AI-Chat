import { notFound, redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { getModels } from '@/lib/models';
import { logView, personById, userChats } from '@/lib/adminView';
import { AdminUser } from '@/components/AdminUser';

export const dynamic = 'force-dynamic';

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') redirect('/');
  const person = personById(id);
  if (!person) notFound();
  logView({ adminId: me.id, ownerId: id, kind: 'user' });
  const models = getModels().map((m) => ({ id: m.id, name: m.name, variantOf: m.variantOf, variantName: m.variantName, levels: m.levels.map((l) => ({ id: l.id, label: l.label })) }));
  return <AdminUser person={person} models={models} tz={me.timezone || 'Europe/Moscow'} initial={userChats(id)} isMe={me.id === id} meId={me.id} />;
}
