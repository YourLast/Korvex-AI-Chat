import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { currentUser } from '@/lib/auth';
import { getDb, schema } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function AdminAnswer({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') redirect('/');
  const m = getDb().select({ threadId: schema.messages.threadId, role: schema.messages.role }).from(schema.messages).where(eq(schema.messages.id, id)).get();
  if (!m || m.role !== 'assistant') notFound();
  redirect(`/admin/chat/${m.threadId}?m=${id}`);
}
