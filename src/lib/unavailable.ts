
type ModelNames = { id: string; name: string; fullName?: string; unavailableText?: string };

const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN',
  'UND_ERR_SOCKET', 'UND_ERR_CLOSED', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT',
  'ConnectionRefused', 'ConnectionClosed', 'FailedToOpenSocket',
  'upstream_cut',
]);
const UNREACHABLE_STATUS = new Set([502, 503, 504]);
const UNREACHABLE_MSG = /cannot connect to api|fetch failed|failed to fetch|econnrefused|econnreset|socket hang up|network error|timed? ?out|\bterminated\b|other side closed/i;

export function isUnreachable(err: unknown): boolean {
  const seen = new Set<unknown>();
  let cur: unknown = err;
  for (let i = 0; i < 6 && cur && typeof cur === 'object' && !seen.has(cur); i++) {
    seen.add(cur);
    const e = cur as { statusCode?: unknown; status?: unknown; code?: unknown; message?: unknown; cause?: unknown };
    const status = typeof e.statusCode === 'number' ? e.statusCode : typeof e.status === 'number' ? e.status : undefined;
    if (status !== undefined && status >= 400) return UNREACHABLE_STATUS.has(status);
    if (typeof e.code === 'string' && UNREACHABLE_CODES.has(e.code)) return true;
    if (typeof e.message === 'string' && UNREACHABLE_MSG.test(e.message)) return true;
    cur = e.cause;
  }
  return false;
}

export function unavailableText(model: ModelNames, all: ModelNames[]): string {
  if (model.unavailableText?.trim()) return model.unavailableText.trim();
  const other = all.find((x) => x.id !== model.id);
  const who = model.fullName || model.name;
  return other ? `${who} временно недоступна, попробуйте ${other.name}.` : `${who} временно недоступна, попробуйте позже.`;
}

export function brokenText(model: ModelNames): string {
  return `Ответ оборвался: ${model.name} перестала отвечать. Показано то, что успело прийти.`;
}
