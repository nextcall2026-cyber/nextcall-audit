import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOpenAIClient } from "@/lib/ai";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rateLimiter";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB

const ScreenshotExtractSchema = z.object({
  name: z.string().nullish(),
  phone: z.string().nullish(),
  website: z.string().nullish(),
  address: z.string().nullish(),
  rating: z.number().min(0).max(5).nullish(),
  reviewCount: z.number().int().min(0).nullish(),
  category: z.string().nullish(),
  email: z.string().nullish(),
});

const SYSTEM_PROMPT = `You extract business details from a screenshot of a Google Maps (or similar map directory) business listing.

Rules:
- Extract ONLY text and values that are clearly visible in the screenshot. Never guess or infer.
- "name" is the business name shown in the listing.
- "phone" is the phone number exactly as shown (digits, spaces and dashes allowed).
- "website" is the website URL shown in the listing. Return it with scheme if present, otherwise as-is (e.g. jlplumbing.com).
- "address" is the full street address shown.
- "rating" is the star rating as a number between 0 and 5 (e.g. 4.7).
- "reviewCount" is the number of reviews shown (e.g. 123 from "4.7 (123)").
- "category" is the business type/category if shown (e.g. Plumber, Restaurant, Salon).
- "email" is an email address if one is visible anywhere in the screenshot.
- If a field is not visible, return null for it. Do NOT mark fields as extracted when they are absent.
- Return ONLY a JSON object with keys: name, phone, website, address, rating, reviewCount, category, email.`;

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = rateLimit(request, { intervalMs: 60000, maxRequests: 6 });
    if (rateLimitResponse) return rateLimitResponse;

    const formData = await request.formData().catch(() => null);
    const file = formData?.get("screenshot") ?? null;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No screenshot file provided." }, { status: 400 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Uploaded file must be an image (PNG, JPG, WEBP)." }, { status: 400 });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Screenshot is too large (max 8 MB)." }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const dataUrl = `data:${file.type};base64,${bytes.toString("base64")}`;

    const client = getOpenAIClient();

    let parsed: z.infer<typeof ScreenshotExtractSchema> | null = null;

    for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 1000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract the business details from this screenshot. If a field is not visible, return null for it.",
              },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      });

      const raw = completion.choices[0]?.message?.content;
      if (!raw) break;

      try {
        const result = ScreenshotExtractSchema.safeParse(JSON.parse(raw));
        if (result.success) parsed = result.data;
      } catch {
        // Retry once with the same image
      }
    }

    if (!parsed) {
      return NextResponse.json(
        { error: "Could not read business details from this screenshot. Try a clearer screenshot." },
        { status: 422 }
      );
    }

    const fieldLabels: Record<keyof typeof parsed, string> = {
      name: "Business name",
      phone: "Phone number",
      website: "Website",
      address: "Address",
      rating: "Rating",
      reviewCount: "Review count",
      category: "Category",
      email: "Email",
    };

    const missing = (Object.keys(fieldLabels) as (keyof typeof fieldLabels)[]).filter(
      (key) => parsed![key] === null || parsed![key] === undefined || String(parsed![key]).trim() === ""
    ).map((key) => fieldLabels[key]);

    return NextResponse.json({ fields: parsed, missing });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("[API /extract-screenshot] Extraction failed:", message);
    const isKeyMissing = message.includes("OPENAI_API_KEY");
    return NextResponse.json(
      { error: isKeyMissing ? "OPENAI_API_KEY is not configured." : "Failed to extract data from screenshot." },
      { status: 500 }
    );
  }
}