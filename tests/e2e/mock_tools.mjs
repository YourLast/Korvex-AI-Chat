
const LOOP_RE = /\[tcloop:([a-z][a-z0-9_]*)\s*(\{.*?\})?\]/;

function tcTags(q) {
  const out = [];
  const re = /\[tc:([a-z][a-z0-9_]*)\s*/g;
  let m;
  while ((m = re.exec(q))) {
    let i = re.lastIndex, args = '{}';
    if (q[i] === '{') {
      let depth = 0, str = false, j = i;
      for (; j < q.length; j++) {
        const ch = q[j];
        if (str) { if (ch === '\\') j++; else if (ch === '"') str = false; continue; }
        if (ch === '"') str = true; else if (ch === '{') depth++; else if (ch === '}') { depth--; if (!depth) break; }
      }
      args = q.slice(i, j + 1); i = j + 1;
    }
    if (q[i] === ']') { out.push({ name: m[1], args }); re.lastIndex = i + 1; }
  }
  return out;
}

export const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p.text ?? '').join(' ') : '');

export function toolPlan(body) {
  const msgs = body.messages || [];
  let lu = -1;
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'user' && !textOf(msgs[i].content).startsWith('[Пользователь пишет по ходу работы]')) { lu = i; break; }
  const q0 = lu >= 0 ? textOf(msgs[lu].content) : '';
  const plan = globalThis.process?.env?.MOCK_TOOL_PLAN;
  const q = plan && q0 && !/\[tc/.test(q0) ? `${q0} ${plan}` : q0;
  const after = msgs.slice(lu + 1);
  const results = after.filter((m) => m.role === 'tool');
  const steers = after.filter((m) => m.role === 'user').map((m) => textOf(m.content));
  const k = after.filter((m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length).length;
  const id = (i) => `call_${k}_${i}_${Math.random().toString(36).slice(2, 8)}`;
  const loop = LOOP_RE.exec(q);
  if (loop) return { reasoning: 'Повторю вызов.', content: '', calls: [{ id: id(0), name: loop[1], args: loop[2] || '{}' }] };
  const tags = tcTags(q);
  const serv = q.includes('[servsearch]') && k === 0 ? '[поиск: курс доллара]\n[найдено: 8 источников]\n' : '';
  const pre = q.includes('[tctext]') ? 'Сейчас посмотрю.' : '';
  if (q.includes('[tcpar]') && k === 0 && tags.length) return { reasoning: 'Вызову всё сразу.', content: pre, calls: tags.map((t, i) => ({ id: id(i), ...t })) };
  const memory = q.includes('[servweb]') ? { total_tokens: 900, web_tokens: 880, files_tokens: 0, chat_tokens: 20 } : undefined;
  if (!q.includes('[tcpar]') && k < tags.length) return { reasoning: `${serv}Шаг ${k + 1}: ${tags[k].name}.`, content: pre, calls: [{ id: id(0), ...tags[k] }], ...(memory ? { memory } : {}) };
  const last = results.length ? textOf(results[results.length - 1].content) : '';
  const steer = steers.length ? ` Учёл: ${steers.map((s) => s.replace('[Пользователь пишет по ходу работы] ', '')).join('; ')}.` : '';
  const ans = /\[tcans:([^\]]*)\]/.exec(q)?.[1];
  if (results.length) return { reasoning: 'Готово.', content: ans ? `${ans}${steer}` : `Готово: ${last.replace(/\s+/g, ' ').slice(0, 400)}${steer}`, calls: [] };
  if (/\[Вопрос от агента чата/.test(q)) return { reasoning: '', content: `Ответ агента: ${q.replace(/^\[Вопрос от агента чата «[^»]*»\] /, '').split('\n')[0].slice(0, 200)}${steer}`, calls: [] };
  return { reasoning: 'Думаю.', content: `Ответ без инструментов.${steer}`, calls: [] };
}

export async function streamPlan(res, model, plan, delay = 10, isClosed = () => false) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = (delta, finish = null, extra = {}) => res.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`);
  frame({ role: 'assistant', content: '' });
  if (plan.reasoning) for (const w of plan.reasoning.match(/.{1,12}/gs) ?? []) { if (isClosed()) return; frame({ reasoning_content: w }); await sleep(delay); }
  if (plan.content) for (const w of plan.content.match(/.{1,16}/gs) ?? []) { if (isClosed()) return; frame({ content: w }); await sleep(delay); }
  plan.calls.forEach((c, i) => {
    frame({ tool_calls: [{ index: i, id: c.id, type: 'function', function: { name: c.name, arguments: '' } }] });
    const a = c.args;
    for (let o = 0; o < a.length; o += 7) frame({ tool_calls: [{ index: i, function: { arguments: a.slice(o, o + 7) } }] });
  });
  if (isClosed()) return;
  frame({}, plan.calls.length ? 'tool_calls' : 'stop', { usage: { prompt_tokens: 50, completion_tokens: 7, total_tokens: 57, ...(plan.memory ? { memory: plan.memory } : {}) } });
  res.end('data: [DONE]\n\n');
}
