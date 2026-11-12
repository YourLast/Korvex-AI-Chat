import { cfg } from './cfg';

export function apiBase(host: string, proto: string): string {
  const bare = host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  const dom = cfg('KX_API_SITE_DOMAIN'), site = cfg('KX_API_SITE_BASE');
  if (dom && site && (bare === dom || bare.endsWith('.' + dom))) return site;
  return `${proto}://${host}/v1`;
}
