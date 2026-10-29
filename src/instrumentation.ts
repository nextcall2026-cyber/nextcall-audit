export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startAutomationScheduler } = await import("@/services/automationScheduler");
    startAutomationScheduler();
  }
}