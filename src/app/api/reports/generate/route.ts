import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { reportService } from "@/services/reportService";
import { logger } from "@/lib/logger";
import { ValidationError, getErrorMessage } from "@/lib/errors";

const GenerateReportSchema = z.object({
  businessId: z.string().min(1, "Business ID is required"),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = GenerateReportSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          details: parsed.error.issues,
        },
        { status: 400 }
      );
    }

    const { businessId } = parsed.data;

    // Generate the PDF Buffer
    const pdfBuffer = await reportService.generatePdfBuffer(businessId);

    // Create a fresh ArrayBuffer that is guaranteed to be
    // compatible with the Web API BodyInit types.
    const pdfBytes = new Uint8Array(pdfBuffer.length);
    pdfBytes.set(pdfBuffer);

    const pdfArrayBuffer = pdfBytes.buffer;

    // Return the PDF as a binary response
    return new NextResponse(pdfArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="nextcall-audit-${businessId}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      },
    });
  } catch (error) {
    logger.error(
      "[API /reports/generate] PDF generation failed:",
      getErrorMessage(error)
    );

    if (error instanceof ValidationError) {
      return NextResponse.json(
        { error: getErrorMessage(error) },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to generate PDF report." },
      { status: 500 }
    );
  }
}