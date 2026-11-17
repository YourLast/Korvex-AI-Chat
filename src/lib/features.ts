import { deleteSetting, getSetting, setSetting } from './settings';
import { cfg } from './cfg';
import { searchConf } from './webSearch';
import { allowedBy, ruleOf, whoOf } from './access';

export const FEATURE_OFF = 'Выключено администратором';

export const FEATURE_IDS = ['voice', 'files', 'memory', 'automations', 'webSearch', 'compare', 'push', 'code', 'signup'] as const;
export type FeatureId = (typeof FEATURE_IDS)[number];

type Def = { id: FeatureId; def: () => boolean; warn?: string };
const DEFS: Record<FeatureId, Def> = {
  voice: { id: 'voice', def: () => true },
  files: { id: 'files', def: () => true },
  memory: { id: 'memory', def: () => true },
  automations: { id: 'automations', def: () => process.env.KX_SCHEDULER !== '0' },
  webSearch: { id: 'webSearch', def: () => !!searchConf() },
  compare: { id: 'compare', def: () => true },
  push: { id: 'push', def: () => process.env.KX_LAN !== '1' },
  code: { id: 'code', def: () => cfg('KX_FEATURE_CODE') === '1', warn: 'code' },
  signup: { id: 'signup', def: () => process.env.ALLOW_SIGNUP === '1' },
};

export const featureDefault = (id: FeatureId): boolean => DEFS[id].def();
export const featureOn = (id: FeatureId): boolean => getSetting<boolean>(`feature.${id}`, DEFS[id].def()) === true;
export function featureFor(id: FeatureId, userId?: string | null, who?: ReturnType<typeof whoOf>): boolean {
  if (!featureOn(id)) return false;
  const rule = ruleOf('feature', id);
  if (!rule || !userId) return true;
  return allowedBy(rule, who ?? whoOf(userId));
}
export const featureMap = (userId?: string | null): Record<FeatureId, boolean> => {
  const who = userId ? whoOf(userId) : undefined;
  return Object.fromEntries(FEATURE_IDS.map((id) => [id, featureFor(id, userId, who)])) as Record<FeatureId, boolean>;
};
export const featureWarn = (id: FeatureId): string | undefined => DEFS[id].warn;
export function setFeature(id: FeatureId, on: boolean | null, by: string | null) {
  if (on === null) { deleteSetting(`feature.${id}`); return; }
  setSetting(`feature.${id}`, on, by);
}
