export type PickerVariant = 0 | 'c' | 'list';
export const PICKER_VARIANT: PickerVariant = 'c';

export type LevelControl = 'pill' | 'p2b';
export const LEVEL_CONTROL: LevelControl = 'p2b';

export type MultView = 'head' | 'cells' | 'warm' | null;
export const MULT_VIEW: MultView = 'warm';

export const levelControl = (v: PickerVariant = PICKER_VARIANT): LevelControl => (v === 0 ? 'pill' : LEVEL_CONTROL);
