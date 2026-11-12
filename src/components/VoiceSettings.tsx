'use client';
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/react';
import { AUTOSEND_KEY, readAutoSend } from '@/lib/voiceLogic';
import { Group, SwitchRow } from './Kit';

export function VoiceSettings() {
  const t = useT();
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { setOn(readAutoSend((k) => localStorage.getItem(k))); }, []);
  const flip = () => {
    const v = !on;
    setOn(v);
    try { if (v) localStorage.setItem(AUTOSEND_KEY, '1'); else localStorage.removeItem(AUTOSEND_KEY); } catch {  }
  };
  return (
    <Group title={t('tools.voice.title')} testId="voice-settings"
      foot={t('tools.voice.foot')}>
      <SwitchRow title={t('tools.voice.autosend')} sub={on ? t('tools.voice.autosendOn') : t('tools.voice.autosendOff')}
        checked={!!on} disabled={on === null} onChange={flip} testId="voice-autosend" />
    </Group>
  );
}
