"use client";

/**
 * Browser-side OCR with Tesseract.js — the zero-AI screenshot reader.
 *
 * Runs entirely on the operator's machine when a screenshot lands in the
 * "Add a business" form. The recognized text travels with the upload, and the
 * audit worker parses the fields straight out of it, skipping the AI vision
 * read. Any failure here is silent: the image still uploads and the worker
 * falls back to AI — OCR must never block queueing.
 */

import type { ScreenshotTextResult } from "@/lib/ocrTypes";

const OCR_TIMEOUT_MS = 30_000;

/** Longest side accepted by the recognizer — way more room than vision needs. */
const MAX_OCR_DIMENSION = 2400;

async function decodeToCanvas(file: File): Promise<HTMLCanvasElement | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_OCR_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false; // tiny text stays crisp
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas;
  } catch {
    return null;
  }
}

/**
 * Reads all the text out of a screenshot in the browser. Returns null on any
 * failure or timeout — the caller just uploads without OCR text.
 */
export async function readScreenshotText(file: File): Promise<ScreenshotTextResult> {
  try {
    const canvas = await decodeToCanvas(file);
    if (!canvas) return { ok: false };

    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker(["eng"], 1, { logger: () => undefined });

    try {
      const { data } = await worker.recognize(canvas);
      const text = (data?.text ?? "").trim();
      if (!text) return { ok: false };
      return { ok: true, text };
    } finally {
      await worker.terminate();
    }
  } catch {
    // Network problem loading the WASM, timeout, unsupported browser — all
    // downgrade to the AI vision path without saying a word to the operator.
    return { ok: false };
  }
}

/** readScreenshotText with a hard deadline so slow disks never stall queueing. */
export async function readScreenshotTextWithDeadline(file: File): Promise<ScreenshotTextResult> {
  return Promise.race([
    readScreenshotText(file).catch(() => ({ ok: false } as ScreenshotTextResult)),
    new Promise<ScreenshotTextResult>((resolve) =>
      setTimeout(() => resolve({ ok: false }), OCR_TIMEOUT_MS)
    ),
  ]);
}
