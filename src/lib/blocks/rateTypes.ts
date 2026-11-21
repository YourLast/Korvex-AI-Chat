export type RateState = 'ok' | 'holiday' | 'notYet' | 'stale' | 'unknown' | 'fail';
export type RateView = {
  state: RateState;
  code: string;
  name?: string;
  nominal?: number;
  value?: string;
  date?: string;
  asked?: string;
  prev?: { value: string; date: string } | null;
  at?: number;
  history?: { date: string; value: string }[];
};
