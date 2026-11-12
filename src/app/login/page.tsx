import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { getDb, schema } from '@/lib/db';
import { LoginForm } from '@/components/LoginForm';
import { supportInfo } from '@/lib/support';
import { featureOn } from '@/lib/features';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await currentUser()) redirect('/');
  const any = getDb().select({ id: schema.users.id }).from(schema.users).limit(1).all().length > 0;
  return <LoginForm signupOpen={!any || featureOn('signup')} firstUser={!any} support={supportInfo()} />;
}
