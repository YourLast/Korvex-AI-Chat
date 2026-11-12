export type TestSummary = { ok: boolean; passed: number; failed: number; framework: string };

const TEST_CMD = /\b(pytest|py\.test|unittest|tox|nox|jest|vitest|mocha|ava|go\s+test|cargo\s+test|npm\s+(run\s+)?test|yarn\s+test|pnpm\s+(run\s+)?test|make\s+test|rspec|phpunit|dotnet\s+test|gradle\w*\s+test|mvn\s+test)\b/;

const n = (s: string | undefined) => (s ? Number(s) : 0);

export function parseTests(cmd: string, out: string, code: number): TestSummary | null {
  const tail = out.slice(-20_000);
  const py = [...tail.matchAll(/=+ (.*?(?:passed|failed|error|errors|no tests ran).*?) in [\d.]+s/g)].at(-1);
  if (py) {
    const s = py[1];
    const failed = n(s.match(/(\d+) failed/)?.[1]) + n(s.match(/(\d+) errors?/)?.[1]);
    return { ok: code === 0 && failed === 0, passed: n(s.match(/(\d+) passed/)?.[1]), failed, framework: 'pytest' };
  }
  const pyq = [...tail.matchAll(/^(?:(\d+) failed)?(?:, )?(?:(\d+) passed)?.* in [\d.]+s\s*$/gm)].filter((m) => m[1] || m[2]).at(-1);
  if (pyq) return { ok: code === 0 && !n(pyq[1]), passed: n(pyq[2]), failed: n(pyq[1]), framework: 'pytest' };
  const js = [...tail.matchAll(/Tests:?\s+(.*?)(?:\(\d+\)|\d+ total)/g)].at(-1);
  if (js) {
    const failed = n(js[1].match(/(\d+) failed/)?.[1]);
    return { ok: code === 0 && failed === 0, passed: n(js[1].match(/(\d+) passed/)?.[1]), failed, framework: /vitest/.test(cmd + tail) ? 'vitest' : 'jest' };
  }
  const mp = tail.match(/(\d+) passing/);
  if (mp) { const failed = n(tail.match(/(\d+) failing/)?.[1]); return { ok: code === 0 && !failed, passed: n(mp[1]), failed, framework: 'mocha' }; }
  const cg = [...tail.matchAll(/test result: \w+\. (\d+) passed; (\d+) failed/g)].at(-1);
  if (cg) return { ok: code === 0 && !n(cg[2]), passed: n(cg[1]), failed: n(cg[2]), framework: 'cargo' };
  const ut = tail.match(/Ran (\d+) tests? in/);
  if (ut) {
    const f = tail.match(/FAILED \((?:failures=(\d+))?(?:, )?(?:errors=(\d+))?/);
    const failed = f ? n(f[1]) + n(f[2]) : 0;
    return { ok: code === 0 && !failed, passed: n(ut[1]) - failed, failed, framework: 'unittest' };
  }
  if (/\bgo\s+test\b/.test(cmd)) {
    const failed = (tail.match(/^--- FAIL/gm) ?? []).length;
    const passed = (tail.match(/^--- PASS/gm) ?? []).length + (tail.match(/^ok\s+\S+/gm) ?? []).length;
    return { ok: code === 0, passed, failed, framework: 'go' };
  }
  if (TEST_CMD.test(cmd)) return { ok: code === 0, passed: 0, failed: code === 0 ? 0 : 1, framework: 'tests' };
  return null;
}
