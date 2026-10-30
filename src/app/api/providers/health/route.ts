import { NextResponse } from "next/server";
import { discoveryService } from "@/services/discoveryService";
import { getLLMStatus } from "@/lib/ai";
import { emailQuotaService } from "@/services/emailQuotaService";
import { totalRemaining } from "@/lib/emailRouting";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";

export async function GET() {
  try {
    const health = discoveryService.getProviderHealthSummary();

    // Sending capacity is a "health" signal too: once Brevo and Resend are
    // both spent the automation stops until 00:00 UTC, and this is where the
    // dashboard can see it coming.
    let email: {
      providers: Awaited<ReturnType<typeof emailQuotaService.getCapacities>>;
      remainingToday: number;
    } | null = null;

    try {
      const providers = await emailQuotaService.getCapacities();
      email = { providers, remainingToday: totalRemaining(providers) };
    } catch (error) {
      logger.warn(`[API /providers/health] Email capacity unavailable: ${getErrorMessage(error)}`);
    }

    return NextResponse.json({ providers: health, llm: getLLMStatus(), email });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch provider health." },
      { status: 500 }
    );
  }
}
