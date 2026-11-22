export const REASONS = [
  { id: 'wrong', label: 'неверно' },
  { id: 'misread', label: 'не понял задачу' },
  { id: 'incomplete', label: 'не доделал' },
  { id: 'slow', label: 'медленно' },
  { id: 'format', label: 'формат' },
  { id: 'long', label: 'длинно' },
  { id: 'other', label: 'другое' },
] as const;
export type ReasonId = (typeof REASONS)[number]['id'];
export const REASON_IDS = REASONS.map((r) => r.id) as string[];
export const reasonLabel = (id: string) => REASONS.find((r) => r.id === id)?.label ?? id;

export type RatingView = { value: 1 | -1; reasons: string[]; comment: string };
