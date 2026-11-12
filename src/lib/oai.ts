export const oaiError = (status: number, message: string, code: string, extra: { type?: string; param?: string | null; headers?: Record<string, string> } = {}) =>
  new Response(JSON.stringify({ error: { message, type: extra.type ?? (status === 401 ? 'authentication_error' : status === 403 ? 'permission_error' : status === 429 ? 'rate_limit_error' : status >= 500 ? 'api_error' : 'invalid_request_error'), code, param: extra.param ?? null } }),
    { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(extra.headers ?? {}) } });

export const oaiJson = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
