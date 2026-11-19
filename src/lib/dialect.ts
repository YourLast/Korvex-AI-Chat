import type { OrgHeader } from './orgCard';
export type Memory = Record<string, unknown>;
export type Extras = { memory?: Memory; sources?: unknown[]; sinfo?: Record<string, number> };
export type QueueReason = 'own_running' | 'kv';
export type QueueInfo = { state: 'queued' | 'started'; ahead: number; eta: number | null; reason?: QueueReason | null };

export type Dialect = {
  name: string;
  headers?(chatId: string, o: { agent?: boolean; org?: OrgHeader | null }): Record<string, string>;
  body?(o: { sources?: boolean }): Record<string, unknown>;
  memoryKey?: string;
  extras?(c: unknown): Extras | null;
  maintFrame?(c: unknown): number | null;
  queueFrame?(c: unknown): QueueInfo | null;
  maintOf?(err: unknown): number | null;
  maintSoft?(err: unknown): boolean;
  conversationHeader?: string;
  workTool?: WorkTool;
  defaultKey?: string;
  maintCode?: string;
};

export type WorkTool = {
  name: string; description: string; parameters: Record<string, unknown>;
  rule: string;
  title: string;
  errLabel: string;
  codeNote: string;
};

export const PLAIN_DIALECT: Dialect = { name: 'korvex', headers: (chatId, o) => ({ ...(o.agent ? { 'X-Korvex-Agent': '1' } : {}), 'X-Korvex-Chat-Id': chatId }) };
