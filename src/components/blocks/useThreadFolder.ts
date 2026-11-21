'use client';
import { useContext } from 'react';
import { usePathname } from 'next/navigation';
import { ShellCtx } from '../Shell';

export function useThreadFolder(): string | null {
  const shell = useContext(ShellCtx);
  const path = usePathname() ?? '';
  const id = /^\/c\/([^/?#]+)/.exec(path)?.[1];
  if (!shell || !id) return null;
  return shell.threads.find((t) => t.id === id)?.folderId ?? null;
}
