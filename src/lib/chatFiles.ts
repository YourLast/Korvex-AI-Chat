export type ChatFile = { id: string; name: string; text: string };

const attr = (s: string) => s.replace(/["\r\n<>]/g, ' ').trim().slice(0, 260) || 'document';

export function withFiles(question: string, files: ChatFile[]): string {
  if (!files.length) return question;
  const blocks = files.map((f) => `<file name="${attr(f.name)}">\n${f.text}\n</file>`).join('\n\n');
  return `Files attached to this chat:\n\n${blocks}\n\n${question}`;
}
