import { ext } from '@/ext';
import { judgeText } from './placeholders';
import { extractNode } from './extractNode';

export type Extracted = { text: string; info: Record<string, unknown> };
export type IngestResult = ({ ok: true } & Extracted) | { ok: false; status: number; message: string };

export const extractText = (data: Buffer, name: string): Promise<Extracted> => (ext.extractLocal ?? extractNode)(data, name);

export async function ingestDocument(data: Buffer, name: string, chosenModelId: string | null | undefined): Promise<IngestResult> {
  if (ext.ingestDocument) return ext.ingestDocument(data, name, chosenModelId);
  let got: Extracted;
  try { got = await extractNode(data, name); } catch (e) { return { ok: false, status: 422, message: `Не удалось прочитать файл: ${(e as Error).message}` }; }
  const v = judgeText(got.text, name, false);
  if (!v.ok) return { ok: false, status: 422, message: v.message };
  return { ok: true, text: got.text, info: { ...got.info, extractor: 'node', ...(v.unrecognized ? { unrecognized: v.unrecognized } : {}) } };
}
