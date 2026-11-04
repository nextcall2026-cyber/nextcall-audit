import "server-only";

import { DataAPIClient, type Db } from "@datastax/astra-db-ts";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

import { getErrorMessage } from "@/lib/errors";
let dbClient: Db | null = null;

export async function getDbClient(): Promise<Db> {
  // TEMPORARY demo mode: run entirely in process memory (no Astra DB).
  if (process.env.DATA_MODE === "memory") {
    const { getMemoryDb } = await import("@/lib/memoryDb");
    logger.warn("[DB] DATA_MODE=memory: using in-memory persistence (demo only, no data saved).");
    return getMemoryDb() as unknown as Db;
  }

  if (
    !env.ASTRA_DB_API_ENDPOINT ||
    !env.ASTRA_DB_APPLICATION_TOKEN
  ) {
    logger.warn(
      "Astra DB credentials are not configured. Database operations will be skipped."
    );

    throw new Error("Astra DB is not configured.");
  }

  if (!dbClient) {
    logger.debug("Initializing Astra DB client...");

    const client = new DataAPIClient(
      env.ASTRA_DB_APPLICATION_TOKEN
    );

    dbClient = client.db(
      env.ASTRA_DB_API_ENDPOINT
    );
  }

  return dbClient;
}

export function isHibernationError(error: unknown): boolean {
  const message = getErrorMessage(error) ?? String(error ?? "");
  return (
    message.includes("resuming from hibernation") ||
    message.toLowerCase().includes("hibernat")
  );
}

export async function withDbRetry<T>(
  operation: () => Promise<T>,
  options?: { retries?: number; baseDelayMs?: number }
): Promise<T> {
  const retries = options?.retries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 2000;

  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isHibernationError(error) || attempt >= retries) {
        throw error;
      }

      const delay = baseDelayMs * 2 ** attempt;
      logger.warn(
        `[DB] Database is waking from hibernation, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export async function getBusinessesCollection() {
  const db = await getDbClient();

  return db.collection("businesses");
}

export async function getAuditsCollection() {
  return getEnsuredCollection("audits");
}

// --- PROSPECT & OUTREACH COLLECTIONS ---

export async function getProspectsCollection() {
  const db = await getDbClient();

  return db.collection("prospects");
}

export async function getOutreachCollection() {
  return getEnsuredCollection("outreach");
}

// --- NOTIFICATIONS & SETTINGS ---

// Collections created on first use (the Astra Data API needs the collection to
// exist before the first query; the in-memory shim creates collections lazily
// on its own).
const ensuredCollections = new Set<string>();

/**
 * Fields that legitimately exceed Astra's 8KB cap on INDEXED string values
 * (base64 screenshots, full email HTML bodies). Their collections are created
 * with `indexing.deny` so the data is STORED but never INDEXED — a deny list
 * only applies at creation time, which is why creation carries the options.
 */
const LARGE_STRING_FIELDS: Record<string, string[]> = {
  // Pasted screenshots arrive as base64; a compressed paste is 100-250KB+.
  screenshot_uploads: ["dataBase64"],
  // The exact HTML body that went out, kept for records/resends.
  outreach: ["body"],
};

/** Matches every flavour of Astra's indexed-string size rejection. */
const SIZE_LIMIT_PATTERN =
  /Document size limitation|exceeds maximum allowed|maximum allowed|indexed (?:String|string) value/i;

function collectionCreateOptions(name: string): Record<string, unknown> {
  const deny = LARGE_STRING_FIELDS[name];
  return deny ? { defaultIdType: "uuid", indexing: { deny } } : { defaultIdType: "uuid" };
}

interface CreateCapableDb {
  createCollection?: (n: string, o?: Record<string, unknown>) => Promise<unknown>;
  dropCollection?: (n: string) => Promise<unknown>;
}

/** A string long enough to trip the 8KB indexed-string cap, but tiny on disk. */
const PROBE_VALUE = "x".repeat(9001);

/**
 * Self-heal for a collection that predates its deny list: Astra rejects any
 * document holding a large string in it. One probe document decides — reject
 * means the whole collection is misconfigured, and since docs carrying large
 * strings could never have been written there, dropping it loses nothing.
 */
async function dropAndRecreateIfLargeStringsRejected(db: Db, name: string): Promise<void> {
  const driver = db as unknown as CreateCapableDb;
  if (typeof driver.dropCollection !== "function") return;

  const field = LARGE_STRING_FIELDS[name][0];
  const collection = db.collection(name);

  try {
    const inserted = await collection.insertOne({ [field]: PROBE_VALUE });
    await collection.deleteOne({ _id: inserted.insertedId });
    return;
  } catch (error) {
    const message = getErrorMessage(error) ?? "";
    if (!SIZE_LIMIT_PATTERN.test(message)) {
      logger.warn(`[DB] Large-string probe on "${name}" failed for another reason — leaving it alone: ${message}`);
      return;
    }
    logger.warn(`[DB] "${name}" rejects large strings on "${field}" — dropping and recreating with indexing.deny.`);
  }

  try {
    await driver.dropCollection(name);
    await (db as unknown as CreateCapableDb).createCollection?.(name, collectionCreateOptions(name));
    logger.info(`[DB] Recreated collection "${name}" with indexing.deny: [${LARGE_STRING_FIELDS[name].join(", ")}].`);
  } catch (error) {
    logger.error(`[DB] Failed to recreate "${name}" with indexing.deny: ${getErrorMessage(error)}`);
  }
}

async function getEnsuredCollection(name: string) {
  const db = await getDbClient();

  if (!ensuredCollections.has(name)) {
    const create = (db as unknown as CreateCapableDb).createCollection;

    if (typeof create === "function") {
      try {
        await create.call(db, name, collectionCreateOptions(name));
        logger.info(`[DB] Created collection "${name}".`);
      } catch (error) {
        // Most commonly "already exists" — nothing to do, but surface anything else.
        logger.debug(`[DB] Create "${name}" skipped: ${getErrorMessage(error)}`);
      }

      if (LARGE_STRING_FIELDS[name]) {
        await dropAndRecreateIfLargeStringsRejected(db, name);
      }
    }

    ensuredCollections.add(name);
  }

  return db.collection(name);
}

export async function getNotificationsCollection() {
  return getEnsuredCollection("notifications");
}

export async function getSettingsCollection() {
  return getEnsuredCollection("settings");
}

/** Background job queue (audit worker, and later the sender/copywriter). */
export async function getAuditJobsCollection() {
  return getEnsuredCollection("audit_jobs");
}

/** Pasted screenshots waiting for the audit worker's vision read. */
export async function getScreenshotUploadsCollection() {
  return getEnsuredCollection("screenshot_uploads");
}