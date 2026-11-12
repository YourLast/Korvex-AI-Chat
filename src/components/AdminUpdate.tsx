'use client';
import { useEffect, useState } from 'react';
import { Notice } from './Kit';

type U = { current: string; latest: string | null; newer: boolean; url: string | null };

export function AdminUpdate() {
  const [u, setU] = useState<U | null>(null);
  useEffect(() => { void fetch('/api/admin/update').then((r) => (r.ok ? r.json() : null)).then(setU).catch(() => {}); }, []);
  if (!u?.newer || !u.latest) return null;
  return (
    <Notice tone="info" testId="admin-update">
      Доступна версия {u.latest} (сейчас {u.current}). Обновить: <code>docker compose pull &amp;&amp; docker compose up -d</code>
      {u.url && <> · <a href={u.url} target="_blank" rel="noreferrer">что нового</a></>}
    </Notice>
  );
}
