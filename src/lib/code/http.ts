import { NextResponse } from 'next/server';
import { CodeError, FsError } from './session';
import { GhError } from '../github/api';

export function codeFail(e: unknown): NextResponse {
  if (e instanceof CodeError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof FsError) return NextResponse.json({ error: e.message }, { status: 400 });
  if (e instanceof GhError) return NextResponse.json({ error: e.message }, { status: e.status === 401 ? 400 : e.status && e.status < 500 ? e.status : 502 });
  console.error('[code]', (e as Error).message);
  return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 });
}
