import type { RatingView } from './rating';
import type { StepEvent } from './tools/types';
export type MemoryInfo = {
  v?: number;
  total_tokens: number;
  files_tokens: number;
  files: number;
  inline_files?: number;
  inline_tokens?: number;
  chat_tokens: number;
  chat_turns?: number;
  web_tokens: number;
  other_tokens?: number;
  rows?: number;
  exact?: boolean;
  scope?: string;
  images?: number;
  images_tokens?: number;
  limit_tokens: number;
  remaining_tokens: number;
  warn?: boolean;
  full?: boolean;
  file_list?: { name?: string; tokens?: number; kind?: string }[];
  [k: string]: unknown;
};

export type FileChip = { id: string; name: string; size: number; mime?: string; tokens?: number; info?: Record<string, unknown> };
export const isImage = (f: { mime?: string }) => !!f.mime && f.mime.startsWith('image/');

export type AssistantMeta = {
  modelId?: string;
  levelId?: string;
  memory?: MemoryInfo | null;
  usage?: Record<string, unknown> | null;
  durationMs?: number;
  gen?: { ms: number; n: number; c?: number; tps?: number | null; tokens: number | null } | null;
  finish?: string | null;
  error?: string | null;
  errorUser?: string | null;
  altModel?: { id: string; name: string };
  stopped?: boolean;
  status?: string;
  jobId?: string;
  lane?: 'a' | 'b';
  blocks?: import('./blocks/text').Snapshots | null;
  memUpd?: { op: string; text: string; id?: string; maybe?: boolean; fix?: boolean; section?: string; prev?: { text: string; section: string; sure: number; key?: string | null; origin?: string } | null; undone?: boolean }[];
};

export type PairView = { a: string; b: string; pick: 'a' | 'b' | null; vote: 'a' | 'b' | 'tie' | 'bad' | null };
export type CompareState = { on: boolean; a: { modelId: string; levelId: string }; b: { modelId: string; levelId: string } };

export type MsgView = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string | null;
  reasoningMs?: number | null;
  meta?: AssistantMeta | null;
  files?: FileChip[];
  auto?: { id: string; name: string };
  from?: { threadId: string; title: string; kind: 'agent' | 'send' | 'reply' };
  steps?: StepEvent[];
  memUpd?: { op: string; text: string; id?: string }[];
  pair?: PairView;
  siblings?: { ids: string[]; index: number };
  rating?: RatingView | null;
  streaming?: boolean;
  liveGen?: { n: number; ms: number; c?: number };
  jobId?: string;
  phase?: 'wait' | 'queued' | 'think' | 'answer';
  ahead?: number;
  eta?: number;
  squeue?: { ahead: number; eta: number | null; reason?: 'own_running' | 'kv' } | null;
  startedAt?: number;
  rStartedAt?: number | null;
};

export type ThreadLite = { id: string; title: string; modelId: string; groupId: string | null; side: string | null; updatedAt: number; unread?: boolean; muted?: boolean; busy?: boolean; cmp?: boolean; folderId?: string | null };
export type FolderView = { id: string; name: string; instruction: string; collapsed: boolean; sort: number; count: number; color: string };
