export type PickerVariant = 0 | 'c' | 'list';
export const PICKER_VARIANT: PickerVariant = 'list';

export type LevelControl = 'pill' | 'p2b';
export const LEVEL_CONTROL: LevelControl = 'p2b';

export type MultView = 'head' | 'cells' | null;
export const MULT_VIEW: MultView = null;

export const levelControl = (v: PickerVariant = PICKER_VARIANT): LevelControl => (v === 0 ? 'pill' : LEVEL_CONTROL);
