export const apiOn = () => process.env.KX_API === '1';
export const API_OFF_MESSAGE = 'API временно недоступен';

export function apiOffResponse(): Response | null {
  if (apiOn()) return null;
  return new Response(JSON.stringify({ error: { message: API_OFF_MESSAGE, type: 'service_unavailable' } }), { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
