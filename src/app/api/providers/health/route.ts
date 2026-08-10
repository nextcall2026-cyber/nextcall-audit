import { NextResponse } from "next/server";
import { discoveryService } from "@/services/discoveryService";

export async function GET() {
  try {
    const health = discoveryService.getProviderHealthSummary();
    return NextResponse.json({ providers: health });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Failed to fetch provider health." },
      { status: 500 }
    );
  }
}
