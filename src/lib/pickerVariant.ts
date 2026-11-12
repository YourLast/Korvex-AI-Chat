export type PickerVariant = 0 | 'c';
export const PICKER_VARIANT: PickerVariant = 'c';

export type LevelControl = 'pill' | 'p2b';
export const LEVEL_CONTROL: LevelControl = 'p2b';

export const levelControl = (v: PickerVariant = PICKER_VARIANT): LevelControl => (v === 0 ? 'pill' : LEVEL_CONTROL);
