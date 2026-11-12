import http from 'node:http';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const lastUserText = (messages) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return { text: m.content, hasResult: false };
    const hasResult = m.content.some((b) => b.type === 'tool_result');
    if (hasResult) return { text: '', hasResult: true, all: messages };
    return { text: m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'), hasResult: false };
  }
  return { text: '', hasResult: false };
};
const firstQuestion = (messages) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user' && Array.isArray(m.content) && m.content.some((b) => b.type === 'text') && !m.content.some((b) => b.type === 'tool_result')) return m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    if (m.role === 'user' && typeof m.content === 'string') return m.content;
  }
  return '';
};

export function startMockAnthropic(port = 0, logFile = process.env.MOCK_ANTHROPIC_LOG || '') {
  const seen = new Set();
  const state = { requests: [] };
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', async () => {
      const key = String(req.headers['x-api-key'] || String(req.headers['authorization'] || '').replace(/^Bearer\s+/i, '') || '');
      const beta = String(req.headers['anthropic-beta'] || '');
      let body = {};
      try { body = JSON.parse(b || '{}'); } catch {  }
      const rec = { at: Date.now(), path: req.url, key: key.slice(-2), beta, body };
      state.requests.push(rec);
      if (logFile) fs.appendFileSync(logFile, JSON.stringify(rec) + '\n');
      if (req.url.startsWith('/v1/messages/count_tokens')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ input_tokens: 1234 })); }
      if (!req.url.startsWith('/v1/messages')) { res.writeHead(404); return res.end(); }
      const q = firstQuestion(body.messages || []);
      const last = lastUserText(body.messages || []);
      const err = (status, type, message) => { res.writeHead(status, { 'Content-Type': 'application/json', 'request-id': 'req_mock' }); res.end(JSON.stringify({ type: 'error', error: { type, message } })); };
      if (/\[nofunds\]/.test(q) && key.endsWith('k1')) return err(402, 'billing_error', 'Your credit balance is too low to access the Anthropic API.');
      if (/\[busy\]/.test(q)) return err(529, 'overloaded_error', 'Overloaded');
      const sysText = Array.isArray(body.system) ? body.system.map((x) => x.text).join('') : String(body.system || '');
      const h = createHash('sha1').update(sysText + JSON.stringify(body.tools || [])).digest('hex');
      const hit = seen.has(h);
      seen.add(h);
      const usage = { input_tokens: 120, output_tokens: 1, cache_read_input_tokens: hit ? 5000 : 0, cache_creation_input_tokens: hit ? 0 : 5000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: hit ? 0 : 5000 } };
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'request-id': 'req_mock' });
      const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      const model = body.model || 'claude-sonnet-5-5';
      send('message_start', { message: { id: 'msg_mock_' + state.requests.length, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage } });
      let idx = 0;
      const thinking = (t) => {
        send('content_block_start', { index: idx, content_block: { type: 'thinking', thinking: '', signature: '' } });
        if (body.thinking?.type === 'adaptive' || body.thinking?.type === 'between_tools') send('content_block_delta', { index: idx, delta: { type: 'thinking_delta', thinking: t } });
        send('content_block_delta', { index: idx, delta: { type: 'signature_delta', signature: 'sig_' + idx } });
        send('content_block_stop', { index: idx }); idx++;
      };
      const text = (t) => {
        send('content_block_start', { index: idx, content_block: { type: 'text', text: '' } });
        for (const part of t.match(/.{1,12}/gs) || []) send('content_block_delta', { index: idx, delta: { type: 'text_delta', text: part } });
        send('content_block_stop', { index: idx }); idx++;
      };
      const tool = (name, input) => {
        send('content_block_start', { index: idx, content_block: { type: 'tool_use', id: 'toolu_' + state.requests.length + '_' + idx, name, input: {} } });
        const j = JSON.stringify(input);
        send('content_block_delta', { index: idx, delta: { type: 'input_json_delta', partial_json: j.slice(0, 5) } });
        send('content_block_delta', { index: idx, delta: { type: 'input_json_delta', partial_json: j.slice(5) } });
        send('content_block_stop', { index: idx }); idx++;
      };
      const end = (stop, out, extra = {}) => { send('message_delta', { delta: { stop_reason: stop, stop_sequence: null, ...extra }, usage: { output_tokens: out, output_tokens_details: { thinking_tokens: Math.floor(out / 2) } } }); send('message_stop', {}); res.end(); };
      const effort = body.output_config?.effort;
      const msgEffort = [...(body.messages || [])].reverse().find((m) => m.role === 'system' && m.output_config?.effort)?.output_config?.effort;
      const eff = msgEffort || effort;
      await new Promise((r) => setTimeout(r, Number(process.env.MOCK_ANTHROPIC_DELAY_MS || 30)));
      if (/\[refuse\]/.test(q)) { text('Начинаю отвечать'); return end('refusal', 5, { stop_details: { type: 'refusal', category: 'cyber', explanation: null } }); }
      if (/\[tool\]/.test(q) && !last.hasResult) { thinking('Нужно посмотреть чаты пользователя.'); tool('chat_list', {}); return end('tool_use', 40); }
      if (/\[search\]/.test(q) && !last.hasResult) { thinking('Поищу в интернете.'); tool('web_search', { query: 'korvex news' }); return end('tool_use', 40); }
      if (last.hasResult) { thinking('Результат инструмента получен, отвечаю.'); text('Готово: нашёл то, что нужно.'); return end('end_turn', 60); }
      thinking(`Думаю над вопросом (уровень ${eff ?? '-'}).`);
      text(`Ответ ${model}: ${q.split('\n')[0].slice(0, 60)}`);
      return end('end_turn', eff === 'max' ? 900 : eff === 'low' ? 30 : 120);
    });
  });
  return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => resolve({ srv, port: srv.address().port, state })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] || 18993);
  startMockAnthropic(port).then(({ port: p }) => console.log(`[mock-anthropic] :${p}`));
}
