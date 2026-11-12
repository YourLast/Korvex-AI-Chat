'use client';
import { useEffect, useRef, useState } from 'react';
import { Button, Field, Group, Notice, Row } from './Kit';

type B = { name: string; short: string; footer: string; accent: string | null; logoUrl: string | null };

export function AdminBrand() {
  const [b, setB] = useState<B | null>(null);
  const [form, setForm] = useState({ name: '', short: '', footer: '', accent: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const fill = (x: B) => { setB(x); setForm({ name: x.name, short: x.short, footer: x.footer, accent: x.accent ?? '' }); };
  useEffect(() => { void fetch('/api/admin/brand').then((r) => r.json()).then(fill).catch(() => setMsg({ ok: false, text: 'Нет связи с сервером' })); }, []);
  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await fetch('/api/admin/brand', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ ok: false, text: j.error || 'Не сохранилось' }); return; }
      fill(j); setMsg({ ok: true, text: 'Сохранено. Новое название и цвет — после обновления страницы.' });
    } finally { setBusy(false); }
  };
  const upload = async (f: File) => {
    const fd = new FormData(); fd.append('file', f);
    setBusy(true);
    try {
      const r = await fetch('/api/admin/brand/logo', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ ok: false, text: j.error || 'Не загрузилось' }); return; }
      setB((x) => (x ? { ...x, logoUrl: j.logoUrl } : x)); setMsg({ ok: true, text: 'Логотип загружен.' });
    } finally { setBusy(false); }
  };
  const dropLogo = async () => { const r = await fetch('/api/admin/brand/logo', { method: 'DELETE' }); if (r.ok) setB((x) => (x ? { ...x, logoUrl: null } : x)); };
  const accentOk = !form.accent || /^#[0-9a-fA-F]{6}$/.test(form.accent);

  return (
    <>
      {msg && <Notice tone={msg.ok ? 'ok' : 'error'}>{msg.text}</Notice>}
      <Group title="Бренд" foot="Название заменяет «Korvex» во всех текстах интерфейса и в том, как модель представляется. Файлы NOTICE и LICENSE не меняются." testId="admin-brand">
        <Field label="Название" value={form.name} onChange={(x) => setForm({ ...form, name: x })} placeholder="Korvex AI" testId="brand-name" />
        <Field label="Короткое название" value={form.short} onChange={(x) => setForm({ ...form, short: x })} placeholder="Korvex" testId="brand-short" />
        <Field label="Строка внизу страницы входа" value={form.footer} onChange={(x) => setForm({ ...form, footer: x })} placeholder="пусто — без строки" testId="brand-footer" />
        <Field label="Акцентный цвет (#rrggbb)" value={form.accent} onChange={(x) => setForm({ ...form, accent: x.trim() })} placeholder="#ffffff" invalid={!accentOk} mono testId="brand-accent"
          trailing={form.accent && accentOk ? <span aria-hidden="true" style={{ display: 'inline-block', width: 18, height: 18, borderRadius: 9, background: form.accent }} /> : undefined} />
      </Group>
      <div className="k-acts">
        <Button onClick={() => void save({ name: '', short: '', footer: null, accent: null })} busy={busy} testId="brand-reset">Как по умолчанию</Button>
        <Button kind="primary" disabled={!accentOk} busy={busy} onClick={() => void save({ name: form.name, short: form.short, footer: form.footer, accent: form.accent || null })} testId="brand-save">Сохранить</Button>
      </div>
      <Group title="Логотип" foot="PNG, WebP или SVG без скриптов, до 512 КБ. Знак в шапке, на странице входа и значок приложения." testId="brand-logo">
        <Row title={b?.logoUrl ? 'Свой логотип' : 'Знак по умолчанию'} icon={undefined}
          right={<span className="mark" aria-hidden="true" style={b?.logoUrl ? { backgroundImage: `url(${b.logoUrl})` } : undefined} />} />
        <input ref={file} type="file" hidden accept="image/png,image/webp,image/svg+xml" data-testid="brand-logo-input" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
        <Row title="Загрузить логотип" chevron onClick={() => file.current?.click()} testId="brand-logo-up" />
        {b?.logoUrl && <Row title="Убрать свой логотип" chevron onClick={() => void dropLogo()} testId="brand-logo-drop" />}
      </Group>
    </>
  );
}
