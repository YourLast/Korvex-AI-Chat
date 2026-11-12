export type BlockKind = '' | 'ban' | 'pause';
export type Source = { key: string; kind: 'invite' | 'admin' | 'none'; label: string; inviteId?: string };
export type SourceRow = Source & { n: number; blocked: number };

export const SRC_ADMIN: Source = { key: 'admin', kind: 'admin', label: 'создан админом' };
export const SRC_NONE: Source = { key: 'none', kind: 'none', label: 'без ссылки' };
export const srcKeyOfInvite = (inviteId: string) => `inv:${inviteId}`;

export type AuditAction = 'ban' | 'pause' | 'unblock' | 'delete' | 'bulk_ban' | 'bulk_alpha' | 'invite_revoke' | 'role' | 'password' | 'seat_warn' | 'seat_clear' | 'week_limit';
export const SYSTEM_PREFIX = 'system:';
export const isSystemActor = (id: string | null | undefined) => !!id && id.startsWith(SYSTEM_PREFIX);
export const AUDIT_LABEL: Record<AuditAction, string> = {
  ban: 'Заблокировал', pause: 'Забрал доступ', unblock: 'Вернул доступ', delete: 'Удалил аккаунт', bulk_ban: 'Заблокировал всех по ссылке',
  bulk_alpha: 'Выдал «Альфу» всем по ссылке', invite_revoke: 'Отозвал ссылку', role: 'Сменил роль', password: 'Сменил пароль',
  seat_warn: 'Предупреждение: одно место — один человек', seat_clear: 'Снял предупреждения о совместном использовании', week_limit: 'Изменил недельный лимит',
};
export type AuditItem = { id: string; at: number; adminId: string; adminName: string; action: string; targetId: string | null; targetName: string; targetEmail: string; inviteId: string | null; reason: string; detail: string };
