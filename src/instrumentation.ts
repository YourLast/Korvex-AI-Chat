export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    (await import('./lib/logTime')).stampConsole();
    const inst = await import('./lib/instance');
    try { inst.startInstance({ adminPort: Number(process.env.KX_ADMIN_PORT) || null }); } catch (e) { console.error('[instance] start', (e as Error).message); }
    process.once('exit', () => inst.markGone());
    try { (await import('./lib/relay')).startRelay(); } catch (e) { console.error('[relay] start', (e as Error).message); }
    const jobs = await import('./lib/jobs');
    const { registerNotify } = await import('./lib/notify');
    registerNotify();
    const { registerKeyUsage } = await import('./lib/apikeys');
    registerKeyUsage();
    try { (await import('./lib/push')).vapid(); } catch (e) { console.error('[push] vapid', (e as Error).message); }
    try { jobs.boot(); } catch (e) { console.error('[jobs] boot', (e as Error).message); }
    const stop = () => { try { jobs.shutdown(); } catch {  } };
    process.prependListener('SIGTERM', stop);
    process.prependListener('SIGINT', stop);
    try { (await import('./lib/status')).startProbe(); } catch (e) { console.error('[status] probe', (e as Error).message); }
    try { (await import('./lib/localModel')).startLocalModel(); } catch (e) { console.error('[local]', (e as Error).message); }
    try { (await import('./lib/busy')).startBusyWatch(); } catch (e) { console.error('[busy]', (e as Error).message); }
    try { (await import('./lib/search')).startIndexer(); } catch (e) { console.error('[search] indexer', (e as Error).message); }
    try { (await import('./lib/tempChat')).startTempSweeper(); } catch (e) { console.error('[temp]', (e as Error).message); }
    try { await import('./lib/brand'); } catch (e) { console.error('[brand]', (e as Error).message); }
    try { (await import('./ext')).ext.boot?.(); } catch (e) { console.error('[ext] boot', (e as Error).message); }
    try { (await import('./lib/titles')).registerTitles(); } catch (e) { console.error('[titles]', (e as Error).message); }
    try { (await import('./lib/curator')).registerCurator(); } catch (e) { console.error('[memory]', (e as Error).message); }
    try { (await import('./lib/memoryRules')).registerRules(); } catch (e) { console.error('[rules]', (e as Error).message); }
    try { (await import('./lib/code/janitor')).startJanitor(); } catch (e) { console.error('[code] janitor', (e as Error).message); }
    try { (await import('./lib/seat')).startSeatSweeper(); } catch (e) { console.error('[seat]', (e as Error).message); }
    if (process.env.KX_SCHEDULER !== '0') {
      const { startScheduler } = await import('./lib/scheduler');
      startScheduler();
    }
  }
}
