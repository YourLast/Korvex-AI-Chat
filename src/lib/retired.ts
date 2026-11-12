export type RetiredModel = { id: string; name: string; variantOf?: string; variantName?: string; levels: { id: string; label: string }[] };

let list: RetiredModel[] = [];
export function setRetired(r: RetiredModel[] | undefined) { if (r) list = r; }
export const retiredModel = (id: string): RetiredModel | undefined => list.find((m) => m.id === id);
