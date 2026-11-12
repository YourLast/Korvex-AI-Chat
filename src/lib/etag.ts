export const etagMatches = (inm: string | null, etag: string): boolean => !!inm && inm.split(',').some((x) => { const t = x.trim().replace(/^W\//, ''); return t === '*' || t === etag; });
