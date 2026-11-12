import { tr } from './i18n/core';

export const ROLES = ['user', 'alpha', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v);

export const canAgents = (role: string | null | undefined): boolean => role === 'alpha' || role === 'admin';

export const roleKey = (role: string | null | undefined): 'role.user' | 'role.alpha' | 'role.admin' =>
  role === 'admin' ? 'role.admin' : role === 'alpha' ? 'role.alpha' : 'role.user';

export const AGENTS_ONLY = 'Облачные агенты, GitHub и автоматизации — в роли «Альфа»';

export const roleRu = (role: string | null | undefined): string => tr('ru', roleKey(role));
