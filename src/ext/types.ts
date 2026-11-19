import type { Dialect } from '@/lib/dialect';
import type { IngestResult } from '@/lib/extract';

export type ServerExt = {
  dialect?: Dialect;
  boot?(): void;
  userArrived?(userId: string, reason: 'login'): void;
  introOpened?(userId: string, timezone?: string | null): void;
  beforeThreadsGone?(threadIds: string[]): void;
  afterThreadsGone?(userId: string, threadIds: string[]): void;
  ingestDocument?(data: Buffer, name: string, chosenModelId: string | null | undefined, opts?: { uploadId?: string | null }): Promise<IngestResult>;
  extractLocal?(data: Buffer, name: string): Promise<{ text: string; info: Record<string, unknown> }>;
  claudeIdentity?(name: string): string;
  filesInMessage?(question: string, files: { id: string; name: string; text: string }[]): string;
};
