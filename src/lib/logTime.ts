const METHODS = ['log', 'info', 'warn', 'error'] as const;

export function stampConsole(c: Console = console, now: () => Date = () => new Date()): void {
  const g = c as Console & { __kxStamped?: boolean };
  if (g.__kxStamped || process.env.KX_LOG_TS === '0') return;
  g.__kxStamped = true;
  for (const m of METHODS) {
    const orig = c[m].bind(c);
    c[m] = (...args: unknown[]) => {
      const ts = now().toISOString();
      if (typeof args[0] === 'string') args[0] = `${ts} ${args[0]}`; else args.unshift(ts);
      orig(...args);
    };
  }
}
