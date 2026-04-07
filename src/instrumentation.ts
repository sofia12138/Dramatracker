export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { registerExitHandler } = await import('./lib/db');
      registerExitHandler();
    } catch (e) {
      console.error('[instrumentation] db registerExitHandler failed', e);
    }

    try {
      const { startScheduler } = await import('./lib/scheduler');
      startScheduler();
    } catch (e) {
      console.error('[instrumentation] startScheduler failed', e);
    }
  }
}
