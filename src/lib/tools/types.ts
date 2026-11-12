
export type JSONSchema = { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean; [k: string]: unknown };

export type StepKind = 'browser' | 'chat' | 'memory' | 'file' | 'github' | 'agent' | 'code' | 'web' | 'work' | 'steer' | 'other';

export type StepStatus = 'run' | 'ok' | 'err' | 'wait_user' | 'denied' | 'stopped';
export const FINAL_STEP: readonly StepStatus[] = ['ok', 'err', 'denied', 'stopped'];

export type Attachment = {
  kind: 'image' | 'file';
  fileId: string;
  url: string;
  name: string;
  mime: string;
  size: number;
  w?: number;
  h?: number;
};

export type AgentExchange = {
  threadId: string;
  threadTitle: string;
  question: string;
  answer?: string;
  state: 'asking' | 'answered' | 'queued' | 'timeout' | 'error';
  messageId?: string;
};

export type StepEvent = {
  id: string;
  kind: StepKind;
  tool?: string;
  title: string;
  status: StepStatus;
  detail?: string;
  thumb?: Attachment;
  live?: { kind: 'browser'; session: string };
  ask?: { text: string; allow?: string; deny?: string };
  check?: { host: string; until: number; open?: boolean };
  agent?: AgentExchange;
  attachments?: Attachment[];
  at: { r: number; c: number };
  round: number;
  t0: number;
  t1?: number;
  parent?: string;
};

export type StepPatch = Partial<Omit<StepEvent, 'at' | 'round' | 't0'>> & { id?: string };

export type ToolResult = {
  content: string;
  attachments?: Attachment[];
  error?: boolean;
};

export type ToolCtx = {
  userId: string;
  threadId: string;
  folderId: string | null;
  jobId: string;
  messageId: string | null;
  callId: string;
  kind: 'chat' | 'automation';
  modelId: string;
  signal: AbortSignal;
  emit: (patch: StepPatch) => void;
  confirm: (text: string, opts?: { allow?: string; deny?: string }) => Promise<boolean>;
  check?: (host: string) => Promise<'done' | 'skip' | 'timeout' | 'unfinished' | 'stop'>;
  attach: (f: { name: string; mime: string; data: Buffer; w?: number; h?: number }) => Promise<Attachment>;
  depth: number;
};

export type KorvexTool<A = Record<string, unknown>> = {
  name: string;
  description: string;
  parameters: JSONSchema;
  kind: StepKind;
  enabled: (ctx: Pick<ToolCtx, 'userId' | 'threadId' | 'folderId' | 'kind' | 'modelId' | 'depth'>) => boolean;
  claudeEnabled?: () => boolean;
  title: (args: A, ctx?: Pick<ToolCtx, 'userId' | 'threadId'>) => string;
  confirm?: (args: A, ctx: ToolCtx) => string | null | Promise<string | null>;
  run: (args: A, ctx: ToolCtx) => Promise<ToolResult>;
};
