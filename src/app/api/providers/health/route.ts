import { NextResponse } from "next/server";
import { discoveryService } from "@/services/discoveryService";
import { getLLMStatus } from "@/lib/ai";

export async function GET() {
  try {
    const health = discoveryService.getProviderHealthSummary();
    return NextResponse.json({ providers: health, llm: getLLMStatus() });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch provider health." },
      { status: 500 }
    );
  }
}
