import { NextResponse } from "next/server";

export async function GET() {
  const stores = new Map<string, Map<string, unknown>>();
  const mod = await import("@/lib/memoryDb");
  mod.__dumpStores?.(stores);
  const out: Record<string, unknown[]> = {};
  for (const [name, map] of stores) {
    out[name] = Array.from(map.values());
  }
  return NextResponse.json(out);
}