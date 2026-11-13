'use client';
import { createContext, useContext, useMemo } from 'react';
import { hasKey, type Key } from '@/lib/i18n/core';
import { useT } from '@/lib/i18n/react';

export const OrgModeCtx = createContext(false);
export const useOrgMode = () => useContext(OrgModeCtx);

export function useFT(): ReturnType<typeof useT> {
  const t = useT();
  const on = useOrgMode();
  return useMemo(() => {
    if (!on) return t;
    const f = ((k: Key, p?: Record<string, string | number>) => t((hasKey(`org.${k}`) ? `org.${k}` : k) as Key, p)) as ReturnType<typeof useT>;
    return Object.assign(f, { lang: t.lang });
  }, [t, on]);
}
