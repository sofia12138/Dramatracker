export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerExitHandler } = await import('./lib/db');
    registerExitHandler();

    const { startScheduler } = await import('./lib/scheduler');
    startScheduler();
  }
}
