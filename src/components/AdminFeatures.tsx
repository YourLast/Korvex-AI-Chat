'use client';
import { useEffect, useState } from 'react';
import { Group, Notice, SwitchRow, useConfirm } from './Kit';

type F = { id: string; on: boolean; default: boolean; warn?: string };
const TEXT: Record<string, { title: string; sub: string }> = {
  voice: { title: 'Голосовой ввод', sub: 'Микрофон в поле ввода (распознавание речи на сервере).' },
  files: { title: 'Файлы', sub: 'Загрузка файлов и папок в чат.' },
  memory: { title: 'Память о человеке', sub: 'Модель запоминает факты о человеке и учитывает их в ответах.' },
  automations: { title: 'Автоматизации', sub: 'Задачи по расписанию.' },
  webSearch: { title: 'Поиск в интернете', sub: 'Инструмент веб-поиска для моделей (нужен адрес поисковика).' },
  compare: { title: 'Сравнение моделей', sub: 'Два ответа рядом в одном чате.' },
  push: { title: 'Уведомления', sub: 'Web Push о готовом ответе.' },
  code: { title: 'Режим кода', sub: 'Агент работает с репозиторием GitHub и запускает команды в песочнице.' },
  signup: { title: 'Регистрация без приглашения', sub: 'Любой может создать аккаунт на странице входа.' },
};

export function AdminFeatures() {
  const [list, setList] = useState<F[] | null>(null);
  const [err, setErr] = useState('');
  const [confirmUi, ask] = useConfirm();
  useEffect(() => { void fetch('/api/admin/features').then((r) => r.json()).then((j) => setList(j.features)).catch(() => setErr('Нет связи с сервером')); }, []);
  const set = async (f: F, on: boolean) => {
    if (on && f.warn === 'code' && !(await ask({ title: 'Включить режим кода?', message: 'Агент будет выполнять команды в контейнере на этом сервере. Включайте только на изолированной машине, где Docker отделён от ваших данных.', action: 'Включить' }))) return;
    const r = await fetch('/api/admin/features', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: f.id, on }) }).catch(() => null);
    if (!r?.ok) { setErr('Не сохранилось'); return; }
    setErr(''); setList((await r.json()).features);
  };
  return (
    <>
      {confirmUi}
      {err && <Notice>{err}</Notice>}
      <Group title="Функции" foot="Выключенная функция пропадает у всех и закрыта на сервере. Изменения — сразу, без перезапуска." testId="admin-features">
        {(list ?? []).map((f) => (
          <SwitchRow key={f.id} title={TEXT[f.id]?.title ?? f.id} sub={TEXT[f.id]?.sub} checked={f.on} onChange={(v) => void set(f, v)} testId={`feature-${f.id}`} />
        ))}
      </Group>
    </>
  );
}
