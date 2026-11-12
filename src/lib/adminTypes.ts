import type { CompareState, MsgView } from './types';
import type { BlockKind, Source } from './moderationTypes';
import type { Role } from './roles';

export type PersonRow = {
  id: string; email: string; name: string; role: Role; disabled: boolean; createdAt: number;
  chats: number; messages: number; files: number; up: number; down: number; lastAt: number | null;
  blockKind: BlockKind; blockReason: string; blockedAt: number | null; source: Source;
};

export type ChatRow = {
  id: string; title: string; modelId: string; createdAt: number; updatedAt: number; messages: number; up: number; down: number;
  folder: string | null; compare: boolean; temporary: boolean;
};

export type UploadItem = { id: string; name: string; mime: string; size: number; createdAt: number; threadId: string | null; threadTitle: string | null; tokens: number };
export type OutItem = { token: string; name: string; size: number; createdAt: number; threadId: string | null; threadTitle: string | null; messageId: string | null; url: string };

export type RatingItem = {
  id: string; userId: string; userName: string; threadId: string; threadTitle: string | null; messageId: string; value: 1 | -1;
  reasons: string[]; comment: string; modelId: string | null; levelId: string | null; durationMs: number | null; at: number;
  exists: boolean;
  question: string; answer: string;
};
export type RatingsPage = {
  rows: RatingItem[]; up: number; down: number; next: string | null;
  users: { id: string; name: string; n: number }[]; models: { id: string; n: number }[];
};

export type Mark = { id: string; messageId: string; value: 1 | -1; reasons: string[]; comment: string; at: number; onPath: boolean; model: string | null };

export type AdminChatData = {
  thread: { id: string; title: string; modelId: string; effort: string; createdAt: number; updatedAt: number; temporary: boolean; compareGroup: boolean; folder: string | null };
  owner: { id: string; name: string; email: string };
  messages: MsgView[];
  times: Record<string, number>;
  marks: Mark[];
  compare: CompareState | null;
  fileNames: string[];
  otherBranch: boolean;
};

export type ViewKind = 'user' | 'chat' | 'files' | 'file' | 'memory';
export type AdminMemoryItem = { id: string; section: string; key: string | null; text: string; origin: string; sure: boolean; createdAt: number; updatedAt: number;
  chat: { id: string; title: string; intro: boolean } | null; blocked: string | null };
export type AdminMemory = {
  on: boolean; auto: boolean; items: AdminMemoryItem[];
  callName: { value: string; fromProfile: boolean };
  prompt: { used: number; dropped: number; blocked: number; tokens: number; body: string } | null;
  askedName: number | null; introAt: number | null; introDone: boolean;
};
export type ViewLogItem = { id: string; adminId: string; adminName: string; ownerId: string; ownerName: string; kind: ViewKind | string; target: string | null; threadId: string | null; threadTitle: string | null; at: number };

export const VIEW_KIND: Record<string, string> = { user: 'Карточка человека', chat: 'Чат', files: 'Список файлов', file: 'Файл', memory: 'Память' };
