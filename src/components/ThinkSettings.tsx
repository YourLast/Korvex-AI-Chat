'use client';
import { useT } from '@/lib/i18n/react';
import { THINK_GATE, setThinkFull, useThinkFull } from '@/lib/thinkPref';
import { Group, SwitchRow } from './Kit';

export function ThinkSettings() {
  const t = useT();
  const on = useThinkFull();
  if (!THINK_GATE.brief) return null;
  return (
    <Group title={t('set.chat')} testId="think-settings" foot={t('set.thinkFullFoot')}>
      <SwitchRow title={t('set.thinkFull')} checked={on} onChange={(v) => setThinkFull(v)} testId="think-full" />
    </Group>
  );
}
