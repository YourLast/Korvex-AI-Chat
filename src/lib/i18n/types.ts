export type Lang = 'ru' | 'en' | 'sr';
export type Tx = string | readonly string[];
export type Entry = readonly [ru: Tx, en: Tx, sr: Tx];
export type Dict = Record<string, Entry>;
export type Params = Record<string, string | number>;
