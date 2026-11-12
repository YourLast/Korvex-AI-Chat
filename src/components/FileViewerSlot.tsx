'use client';
import { lazy, Suspense, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { closeFile, useFileView } from '@/lib/fileView';

const load = () => import('./FileViewer');
const FileViewer = lazy(load);

export const leavesChat = (from: string | null, to: string | null): boolean => !!from && !!to && from !== to && !(from === '/' && to.startsWith('/c/'));

export function FileViewerSlot() {
  const st = useFileView();
  const path = usePathname();
  const prev = useRef(path);
  useEffect(() => { const p = prev.current; prev.current = path; if (leavesChat(p, path)) closeFile(); }, [path]);
  if (!st.target && !st.compare) return null;
  return <Suspense fallback={null}><FileViewer /></Suspense>;
}
