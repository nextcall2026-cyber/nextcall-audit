export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startFollowUpScheduler } = await import("@/services/followUpScheduler");
    startFollowUpScheduler();
  }
}
