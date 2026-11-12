import { describe, expect, it } from 'vitest';
import { promptParts, registerPromptPart } from '@/lib/tools/registry';

const ctx = { userId: 'u', threadId: 't', folderId: null, kind: 'chat' as const, modelId: 'alpha', depth: 0 };

describe('promptParts', () => {
  it('одинаковый блок от нескольких регистраций — один раз, порядок по первому появлению', () => {
    const rule = 'PP-TEST: у этого чата свой браузер';
    const offs = [
      registerPromptPart(() => 'PP-TEST-A'),
      registerPromptPart(() => rule),
      registerPromptPart(() => rule + '\n'),
      registerPromptPart(() => 'PP-TEST-B'),
      registerPromptPart(() => rule),
      registerPromptPart(() => null),
      registerPromptPart(() => { throw new Error('сбой части'); }),
    ];
    try {
      const mine = promptParts(ctx).filter((p) => p.startsWith('PP-TEST'));
      expect(mine).toEqual(['PP-TEST-A', rule, 'PP-TEST-B']);
    } finally {
      offs.forEach((f) => f());
    }
  });

  it('разные блоки не склеиваются и не теряются', () => {
    const offs = [registerPromptPart(() => 'PP-X1'), registerPromptPart(() => 'PP-X2')];
    try {
      expect(promptParts(ctx).filter((p) => p.startsWith('PP-X'))).toEqual(['PP-X1', 'PP-X2']);
    } finally {
      offs.forEach((f) => f());
    }
  });
});
