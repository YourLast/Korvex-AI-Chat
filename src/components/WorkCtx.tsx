'use client';
import { createContext, useContext } from 'react';
import type { Decision, LiveReq } from './WorkFeed';
import type { WStep } from '@/lib/work';

export type WorkActions = {
  openLive: (r: LiveReq) => void;
  decide: (jobId: string, s: WStep, allow: Decision) => Promise<boolean>;
  barFor: string | null;
  liveId?: string | null;
};
export const WorkCtx = createContext<WorkActions | null>(null);
export const useWork = () => useContext(WorkCtx);

export async function decideStep(jobId: string, stepId: string, allow: Decision): Promise<boolean> {
  try {
    const r = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/steps/${encodeURIComponent(stepId)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: allow === 'open' ? 'open' : allow ? 'allow' : 'deny' }),
    });
    return r.ok;
  } catch { return false; }
}

export async function steerJob(jobId: string, text: string, mode: 'next' | 'now' = 'next'): Promise<{ ok: boolean; status: number }> {
  try {
    const r = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/steer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, mode }) });
    return { ok: r.ok, status: r.status };
  } catch { return { ok: false, status: 0 }; }
}
