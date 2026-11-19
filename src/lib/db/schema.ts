import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'alpha', 'user'] }).notNull().default('user'),
  disabled: integer('disabled').notNull().default(0),
  timezone: text('timezone').notNull().default('Europe/Moscow'),
  notifyQuiet: text('notify_quiet').default('23:00-08:00'),
  lastTz: text('last_tz'),
  memoryOn: integer('memory_on').notNull().default(1),
  memoryAuto: integer('memory_auto').notNull().default(1),
  memoryMeta: text('memory_meta', { mode: 'json' }).$type<MemoryMeta>(),
  lang: text('lang').notNull().default(''),
  blockKind: text('block_kind').notNull().default(''),
  blockReason: text('block_reason').notNull().default(''),
  blockedAt: integer('blocked_at'),
  blockedBy: text('blocked_by'),
  source: text('source').notNull().default(''),
  weekMult: real('week_mult').notNull().default(1),
  weekResetAt: integer('week_reset_at'),
  seatResetAt: integer('seat_reset_at'),
  createdAt: integer('created_at').notNull(),
});

export const invites = sqliteTable('invites', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  role: text('role', { enum: ['admin', 'alpha', 'user'] }).notNull().default('user'),
  note: text('note').notNull().default(''),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
  usedBy: text('used_by'),
  usedAt: integer('used_at'),
  maxUses: integer('max_uses').notNull().default(1),
  uses: integer('uses').notNull().default(0),
  revokedAt: integer('revoked_at'),
  email: text('email'),
  createdAt: integer('created_at').notNull(),
});

export const inviteUses = sqliteTable('invite_uses', {
  id: text('id').primaryKey(),
  inviteId: text('invite_id').notNull().references(() => invites.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
}, (t) => [index('invite_uses_invite_idx').on(t.inviteId, t.createdAt)]);

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const threads = sqliteTable('threads', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull().default('Новый чат'),
  modelId: text('model_id').notNull(),
  effort: text('effort').notNull().default('off'),
  leafId: text('leaf_id'),
  groupId: text('group_id'),
  side: text('side'),
  answeredAt: integer('answered_at'),
  readAt: integer('read_at'),
  muted: integer('muted').notNull().default(0),
  compare: text('compare', { mode: 'json' }).$type<ThreadCompare>(),
  titleManual: integer('title_manual').notNull().default(0),
  titleGen: integer('title_gen').notNull().default(0),
  temporary: integer('temporary').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  folderId: text('folder_id').references((): AnySQLiteColumn => folders.id, { onDelete: 'set null' }),
}, (t) => [index('threads_user_idx').on(t.userId, t.updatedAt), index('threads_group_idx').on(t.groupId), index('threads_folder_idx').on(t.folderId)]);

export const folders = sqliteTable('folders', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  instruction: text('instruction').notNull().default(''),
  collapsed: integer('collapsed').notNull().default(0),
  sort: integer('sort').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  color: text('color').notNull().default(''),
}, (t) => [index('folders_user_idx').on(t.userId, t.sort)]);

export type Folder = typeof folders.$inferSelect;

export type CompareSide = { modelId: string; levelId: string };
export type ThreadCompare = { on: boolean; a: CompareSide; b: CompareSide };

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').notNull().references(() => threads.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  parentId: text('parent_id'),
  session: text('session'),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  content: text('content').notNull().default(''),
  reasoning: text('reasoning'),
  reasoningMs: integer('reasoning_ms'),
  meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: integer('created_at').notNull(),
}, (t) => [index('messages_thread_idx').on(t.threadId, t.seq)]);

export const files = sqliteTable('files', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  threadId: text('thread_id').references(() => threads.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  mime: text('mime').notNull().default('application/octet-stream'),
  size: integer('size').notNull(),
  sha256: text('sha256').notNull(),
  text: text('text').notNull().default(''),
  info: text('info', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: integer('created_at').notNull(),
  folderId: text('folder_id'),
  docType: text('doc_type'),
  docDate: text('doc_date'),
  docFrom: text('doc_from'),
  docTo: text('doc_to'),
}, (t) => [index('files_thread_idx').on(t.threadId), index('files_user_folder').on(t.userId, t.folderId)]);

export type Invite = typeof invites.$inferSelect;
export type User = typeof users.$inferSelect;
export type Thread = typeof threads.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type FileRow = typeof files.$inferSelect;

export const orgInbox = sqliteTable('org_inbox', {
  folderId: text('folder_id').primaryKey().references(() => folders.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tag: text('tag').notNull(),
  senders: text('senders', { mode: 'json' }).$type<string[]>().notNull().default([]),
  keyHash: text('key_hash'),
  keyHint: text('key_hint'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => [uniqueIndex('org_inbox_tag').on(t.tag), uniqueIndex('org_inbox_key').on(t.keyHash)]);

export const automations = sqliteTable('automations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  prompt: text('prompt').notNull(),
  modelId: text('model_id').notNull(),
  levelId: text('level_id').notNull(),
  cron: text('cron').notNull(),
  timezone: text('timezone').notNull(),
  targetThreadId: text('target_thread_id').notNull().references(() => threads.id, { onDelete: 'cascade' }),
  enabled: integer('enabled').notNull().default(1),
  nextRunAt: integer('next_run_at'),
  lastRunAt: integer('last_run_at'),
  lastStatus: text('last_status'),
  lastError: text('last_error'),
  createdAt: integer('created_at').notNull(),
}, (t) => [index('automations_user_idx').on(t.userId), index('automations_next_idx').on(t.enabled, t.nextRunAt)]);

export const automationRuns = sqliteTable('automation_runs', {
  id: text('id').primaryKey(),
  automationId: text('automation_id').notNull().references(() => automations.id, { onDelete: 'cascade' }),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
  status: text('status').notNull(),
  trigger: text('trigger').notNull(),
  error: text('error'),
  messageId: text('message_id'),
  durationMs: integer('duration_ms'),
  owner: text('owner'),
}, (t) => [index('runs_auto_idx').on(t.automationId, t.startedAt)]);

export type Automation = typeof automations.$inferSelect;
export type AutomationRun = typeof automationRuns.$inferSelect;

export const ratings = sqliteTable('ratings', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  threadId: text('thread_id').notNull(),
  messageId: text('message_id').notNull(),
  value: integer('value').notNull(),
  reasons: text('reasons', { mode: 'json' }).$type<string[]>(),
  comment: text('comment'),
  modelId: text('model_id'),
  levelId: text('level_id'),
  durationMs: integer('duration_ms'),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => [uniqueIndex('ratings_user_msg_idx').on(t.userId, t.messageId), index('ratings_time_idx').on(t.updatedAt)]);

export type Rating = typeof ratings.$inferSelect;

export const compareVotes = sqliteTable('compare_votes', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  threadId: text('thread_id').notNull(),
  questionId: text('question_id'),
  messageA: text('message_a').notNull(),
  messageB: text('message_b').notNull(),
  winner: text('winner').notNull(),
  modelA: text('model_a'),
  levelA: text('level_a'),
  modelB: text('model_b'),
  levelB: text('level_b'),
  durationA: integer('duration_a'),
  durationB: integer('duration_b'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => [uniqueIndex('compare_votes_pair_idx').on(t.userId, t.messageA, t.messageB), index('compare_votes_time_idx').on(t.updatedAt)]);

export type CompareVote = typeof compareVotes.$inferSelect;

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  threadId: text('thread_id').references(() => threads.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull().default('chat'),
  mode: text('mode').notNull().default('send'),
  userMessageId: text('user_message_id'),
  messageId: text('message_id'),
  modelId: text('model_id').notNull(),
  levelId: text('level_id').notNull(),
  status: text('status').notNull(),
  error: text('error'),
  apiKeyId: text('api_key_id'),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  cacheReadTokens: integer('cache_read_tokens'),
  cacheWriteTokens: integer('cache_write_tokens'),
  costUsd: real('cost_usd'),
  cardS: real('card_s'),
  durationMs: integer('duration_ms'),
  createdAt: integer('created_at').notNull(),
  startedAt: integer('started_at'),
  finishedAt: integer('finished_at'),
  owner: text('owner'),
}, (t) => [index('jobs_status_idx').on(t.status), index('jobs_user_idx').on(t.userId, t.createdAt), index('jobs_thread_idx').on(t.threadId)]);

export type Job = typeof jobs.$inferSelect;

export const pushSubs = sqliteTable('push_subs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  device: text('device').notNull(),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  ua: text('ua').notNull().default(''),
  createdAt: integer('created_at').notNull(),
  lastOkAt: integer('last_ok_at'),
  lastActiveAt: integer('last_active_at'),
  fails: integer('fails').notNull().default(0),
}, (t) => [index('push_user_idx').on(t.userId)]);

export type PushSub = typeof pushSubs.$inferSelect;

export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  prefix: text('prefix').notNull(),
  models: text('models', { mode: 'json' }).$type<string[]>().notNull(),
  levels: text('levels', { mode: 'json' }).$type<Record<string, string>>().notNull(),
  rpm: integer('rpm').notNull().default(20),
  expiresAt: integer('expires_at'),
  revokedAt: integer('revoked_at'),
  lastUsedAt: integer('last_used_at'),
  requests: integer('requests').notNull().default(0),
  promptTokens: integer('prompt_tokens').notNull().default(0),
  completionTokens: integer('completion_tokens').notNull().default(0),
  createdAt: integer('created_at').notNull(),
}, (t) => [index('api_keys_user_idx').on(t.userId)]);

export type ApiKey = typeof apiKeys.$inferSelect;

export const searchDocs = sqliteTable('search_docs', {
  id: integer('id').primaryKey(),
  kind: text('kind').notNull(),
  ref: text('ref').notNull(),
  threadId: text('thread_id').notNull(),
  userId: text('user_id').notNull(),
  at: integer('at').notNull(),
}, (t) => [uniqueIndex('search_docs_ref_idx').on(t.kind, t.ref), index('search_docs_thread_idx').on(t.threadId), index('search_docs_user_idx').on(t.userId)]);

export const searchDirty = sqliteTable('search_dirty', {
  kind: text('kind').notNull(),
  ref: text('ref').notNull(),
}, (t) => [primaryKey({ columns: [t.kind, t.ref] })]);

export const searchMeta = sqliteTable('search_meta', {
  k: text('k').primaryKey(),
  v: text('v').notNull(),
});

export const outFiles = sqliteTable('out_files', {
  token: text('token').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  threadId: text('thread_id'),
  messageId: text('message_id'),
  source: text('source').notNull().default('job'),
  createdAt: integer('created_at').notNull(),
}, (t) => [index('out_files_user_idx').on(t.userId)]);

export type OutFile = typeof outFiles.$inferSelect;

export const githubAccounts = sqliteTable('github_accounts', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull().default('pat'),
  login: text('login').notNull(),
  ghId: integer('gh_id'),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  tokenEnc: text('token_enc').notNull(),
  scopes: text('scopes'),
  expiresAt: integer('expires_at'),
  coAuthors: text('co_authors', { mode: 'json' }).$type<string[]>(),
  createdAt: integer('created_at').notNull(),
  checkedAt: integer('checked_at').notNull(),
});

export const codeSessions = sqliteTable('code_sessions', {
  threadId: text('thread_id').primaryKey().references(() => threads.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  repo: text('repo').notNull(),
  baseBranch: text('base_branch').notNull(),
  baseSha: text('base_sha'),
  workBranch: text('work_branch'),
  status: text('status').notNull().default('cloning'),
  error: text('error'),
  origin: text('origin').notNull().default('code'),
  prUrl: text('pr_url'),
  prNumber: integer('pr_number'),
  pushedSha: text('pushed_sha'),
  tests: text('tests', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => [index('code_sessions_user_idx').on(t.userId)]);

export const codeEdits = sqliteTable('code_edits', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').notNull().references(() => threads.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  messageId: text('message_id'),
  callId: text('call_id'),
  path: text('path').notNull(),
  source: text('source').notNull().default('agent'),
  before: text('before'),
  after: text('after'),
  added: integer('added').notNull().default(0),
  removed: integer('removed').notNull().default(0),
  revertedAt: integer('reverted_at'),
  createdAt: integer('created_at').notNull(),
}, (t) => [index('code_edits_thread_idx').on(t.threadId, t.createdAt)]);

export const codeRuns = sqliteTable('code_runs', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').notNull().references(() => threads.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  messageId: text('message_id'),
  callId: text('call_id'),
  cmd: text('cmd').notNull(),
  exitCode: integer('exit_code'),
  output: text('output').notNull().default(''),
  test: text('test', { mode: 'json' }).$type<{ ok: boolean; passed: number; failed: number; framework: string } | null>(),
  durationMs: integer('duration_ms'),
  createdAt: integer('created_at').notNull(),
}, (t) => [index('code_runs_thread_idx').on(t.threadId, t.createdAt)]);

export type GithubAccount = typeof githubAccounts.$inferSelect;
export type CodeSession = typeof codeSessions.$inferSelect;
export type CodeEdit = typeof codeEdits.$inferSelect;
export type CodeRun = typeof codeRuns.$inferSelect;

export const agentMsgs = sqliteTable('agent_msgs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  fromThread: text('from_thread').notNull(),
  toThread: text('to_thread').notNull(),
  fromJob: text('from_job'),
  toJob: text('to_job'),
  question: text('question').notNull(),
  answer: text('answer'),
  status: text('status').notNull(),
  userMessageId: text('user_message_id'),
  answerMessageId: text('answer_message_id'),
  depth: integer('depth').notNull().default(1),
  createdAt: integer('created_at').notNull(),
  answeredAt: integer('answered_at'),
}, (t) => [index('agent_msgs_user_idx').on(t.userId, t.createdAt), index('agent_msgs_to_idx').on(t.toThread)]);

export type AgentMsg = typeof agentMsgs.$inferSelect;

export const userMemory = sqliteTable('user_memory', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  section: text('section').notNull(),
  key: text('key'),
  text: text('text').notNull(),
  origin: text('origin').notNull().default('auto'),
  sure: integer('sure').notNull().default(1),
  threadId: text('thread_id').references(() => threads.id, { onDelete: 'set null' }),
  messageId: text('message_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => [index('user_memory_user_idx').on(t.userId, t.section)]);

export type MemoryRow = typeof userMemory.$inferSelect;
export type MemoryMeta = { askedName?: number; introAt?: number; introDone?: number;
  introEnd?: number;
  introMarks?: { chat: string; done: string[]; skip: string[] };
  endReason?: string;
  invite?: { start?: number; shown?: number; day?: string; later?: string; never?: number };
  rules?: { pending?: number; done?: number; n?: number; ids?: string[]; seen?: number; failed?: number; now?: number; later?: number; nowSeen?: number } };

export const browserSessions = sqliteTable('browser_sessions', {
  threadId: text('thread_id').primaryKey().references(() => threads.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  lastUrl: text('last_url'),
  lastTitle: text('last_title'),
  actions: integer('actions').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  usedAt: integer('used_at').notNull(),
}, (t) => [index('browser_sessions_user_idx').on(t.userId, t.usedAt)]);

export type BrowserSession = typeof browserSessions.$inferSelect;

export const adminViews = sqliteTable('admin_views', {
  id: text('id').primaryKey(),
  adminId: text('admin_id').notNull(),
  ownerId: text('owner_id').notNull(),
  kind: text('kind').notNull(),
  target: text('target'),
  threadId: text('thread_id'),
  createdAt: integer('created_at').notNull(),
}, (t) => [index('admin_views_time_idx').on(t.createdAt), index('admin_views_owner_idx').on(t.ownerId, t.createdAt)]);

export type AdminView = typeof adminViews.$inferSelect;

export const adminAudit = sqliteTable('admin_audit', {
  id: text('id').primaryKey(),
  at: integer('at').notNull(),
  adminId: text('admin_id').notNull(),
  adminName: text('admin_name').notNull().default(''),
  action: text('action').notNull(),
  targetId: text('target_id'),
  targetName: text('target_name').notNull().default(''),
  targetEmail: text('target_email').notNull().default(''),
  inviteId: text('invite_id'),
  reason: text('reason').notNull().default(''),
  detail: text('detail').notNull().default(''),
}, (t) => [index('admin_audit_time_idx').on(t.at), index('admin_audit_target_idx').on(t.targetId, t.at)]);

export type AuditRow = typeof adminAudit.$inferSelect;

export const serveForget = sqliteTable('serve_forget', {
  id: text('id').primaryKey(),
  chatId: text('chat_id').notNull(),
  baseUrl: text('base_url').notNull(),
  createdAt: integer('created_at').notNull(),
  tries: integer('tries').notNull().default(0),
  nextAt: integer('next_at').notNull(),
  lastError: text('last_error').notNull().default(''),
}, (t) => [uniqueIndex('serve_forget_uq').on(t.chatId, t.baseUrl), index('serve_forget_next_idx').on(t.nextAt)]);

export const seatSignals = sqliteTable('seat_signals', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  session: text('session').notNull(),
  net: text('net').notNull().default(''),
  ua: text('ua').notNull().default(''),
  jobs: text('jobs').notNull().default(''),
  ov: integer('ov').notNull().default(0),
  at: integer('at').notNull(),
}, (t) => [index('seat_signals_user_idx').on(t.userId, t.at)]);

export const seatEvents = sqliteTable('seat_events', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day: text('day').notNull(),
  kind: text('kind', { enum: ['switch', 'concurrent'] }).notNull(),
  at: integer('at').notNull(),
  detail: text('detail').notNull().default(''),
}, (t) => [index('seat_events_user_idx').on(t.userId, t.at)]);

export const seatStrikes = sqliteTable('seat_strikes', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['warn', 'pause24', 'pause'] }).notNull(),
  at: integer('at').notNull(),
}, (t) => [index('seat_strikes_user_idx').on(t.userId, t.at)]);

export const userNotices = sqliteTable('user_notices', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  key: text('key').notNull(),
  at: integer('at').notNull(),
  seenAt: integer('seen_at'),
}, (t) => [uniqueIndex('user_notices_uq').on(t.userId, t.kind, t.key)]);

export const instances = sqliteTable('instances', {
  id: text('id').primaryKey(),
  pid: integer('pid').notNull(),
  build: text('build'),
  adminPort: integer('admin_port'),
  state: text('state').notNull().default('live'),
  startedAt: integer('started_at').notNull(),
  heartbeatAt: integer('heartbeat_at').notNull(),
});

export const jobCommands = sqliteTable('job_commands', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull(),
  owner: text('owner').notNull(),
  kind: text('kind').notNull(),
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: integer('created_at').notNull(),
  takenAt: integer('taken_at'),
}, (t) => [index('job_commands_owner_idx').on(t.owner, t.takenAt)]);

export const busRelay = sqliteTable('bus_relay', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  origin: text('origin').notNull(),
  userId: text('user_id').notNull(),
  event: text('event', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  at: integer('at').notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
  updatedBy: text('updated_by'),
});

export const providers = sqliteTable('providers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  baseUrl: text('base_url').notNull().default(''),
  keyEnc: text('key_enc'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const adminModels = sqliteTable('admin_models', {
  id: text('id').primaryKey(),
  providerId: text('provider_id').notNull().references(() => providers.id, { onDelete: 'cascade' }),
  upstreamModel: text('upstream_model').notNull(),
  name: text('name').notNull(),
  fullName: text('full_name').notNull().default(''),
  blurb: text('blurb').notNull().default(''),
  levels: text('levels', { mode: 'json' }).$type<{ id: string; label: string; effort: string | null; hint?: string }[]>().notNull(),
  defaultLevel: text('default_level').notNull(),
  images: integer('images').notNull().default(0),
  tools: integer('tools').notNull().default(0),
  contextTokens: integer('context_tokens').notNull().default(32768),
  maxOutputTokens: integer('max_output_tokens').notNull().default(4096),
  maxConcurrent: integer('max_concurrent').notNull().default(4),
  hidden: integer('hidden').notNull().default(0),
  sort: integer('sort').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
