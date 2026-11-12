
const DROP = new Set(['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties', 'default', 'examples', '$schema']);

export function strictSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(strictSchema);
  if (!s || typeof s !== 'object') return s;
  const o = s as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (DROP.has(k)) continue;
    if (k === 'properties' && v && typeof v === 'object' && !Array.isArray(v)) out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, strictSchema(pv)]));
    else if (k === 'items' || k === 'anyOf' || k === 'allOf' || k === 'oneOf' || k === '$defs' || k === 'definitions') out[k] = strictSchema(v);
    else out[k] = v;
  }
  const isObj = o.type === 'object' || (Array.isArray(o.type) && o.type.includes('object'));
  if (isObj) {
    out.additionalProperties = false;
    if (!out.properties) out.properties = {};
  }
  return out;
}

const typeOk = (t: string, v: unknown): boolean => {
  switch (t) {
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'integer': return typeof v === 'number' && Number.isInteger(v);
    case 'boolean': return typeof v === 'boolean';
    case 'array': return Array.isArray(v);
    case 'object': return !!v && typeof v === 'object' && !Array.isArray(v);
    case 'null': return v === null;
    default: return true;
  }
};

export function validate(schema: unknown, v: unknown, at = 'input'): string | null {
  if (!schema || typeof schema !== 'object') return null;
  const s = schema as { type?: string | string[]; properties?: Record<string, unknown>; required?: string[]; enum?: unknown[]; items?: unknown; additionalProperties?: unknown; anyOf?: unknown[] };
  if (Array.isArray(s.anyOf) && s.anyOf.length) return s.anyOf.some((x) => validate(x, v, at) === null) ? null : `${at}: не подходит ни под один вариант`;
  if (s.type) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t) => typeOk(t, v))) return `${at}: ожидался ${types.join(' | ')}`;
  }
  if (Array.isArray(s.enum) && !s.enum.some((e) => e === v)) return `${at}: допустимо ${s.enum.map((e) => JSON.stringify(e)).join(', ')}`;
  if (Array.isArray(v) && s.items) {
    for (let i = 0; i < v.length; i++) { const e = validate(s.items, v[i], `${at}[${i}]`); if (e) return e; }
  }
  if (v && typeof v === 'object' && !Array.isArray(v) && (s.properties || s.required)) {
    const o = v as Record<string, unknown>;
    for (const r of s.required ?? []) if (!(r in o) || o[r] === undefined) return `${at}.${r}: обязательное поле`;
    for (const [k, val] of Object.entries(o)) {
      const ps = s.properties?.[k];
      if (ps === undefined) { if (s.additionalProperties === false) return `${at}.${k}: неизвестное поле`; continue; }
      if (val === null && !(Array.isArray((ps as { type?: unknown }).type) && ((ps as { type: string[] }).type).includes('null'))) continue;
      const e = validate(ps, val, `${at}.${k}`);
      if (e) return e;
    }
  }
  return null;
}
