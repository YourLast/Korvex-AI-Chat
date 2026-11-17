import { getSetting } from './settings';
export const tourKey = (userId: string) => `tour.admin.${userId}`;
export const tourPending = (userId: string) => getSetting<number | null>(tourKey(userId), null) === null;
