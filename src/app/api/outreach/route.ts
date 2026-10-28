import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { outreachSendService } from "@/services/outreachSendService";
import { logger } from "@/lib/logger";
import { ValidationError, getErrorMessage } from "@/lib/errors";
import { rateLimit } from "@/lib/rateLimiter";

const SendOutreachSchema = z.object({
  prospectId: z.string().min(1),
});

/**
 * Manual "send the initial audit email" button.
 *
 * The send itself lives in outreachSendService so this route and the
 * auto-send pass share every safety rail; here we only do HTTP concerns
 * (rate limit, validation, status mapping).
 */
export async function POST(request: NextRequest) {
  try {
    // Rate Limit: 10 requests per minute
    const rateLimitResponse = rateLimit(request, { intervalMs: 60000, maxRequests: 10 });
    if (rateLimitResponse) return rateLimitResponse;

    const parsed = SendOutreachSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const result = await outreachSendService.sendInitialOutreach(parsed.data.prospectId);

    if (result.ok) {
      return NextResponse.json({ success: true, message: "Email sent successfully." });
    }

    return NextResponse.json({ error: result.error }, { status: result.status });
  } catch (error) {
    logger.error("[API /outreach] Send failed:", getErrorMessage(error));

    if (error instanceof ValidationError) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: 400 });
    }

    return NextResponse.json({ error: "Failed to process outreach request." }, { status: 500 });
  }
}
