import "server-only";

import { DataAPIClient, type Db } from "@datastax/astra-db-ts";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

let dbClient: Db | null = null;

export async function getDbClient(): Promise<Db> {
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

export function isHibernationError(error: any): boolean {
  const message = error?.message ?? String(error ?? "");
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
    } catch (error: any) {
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
  const db = await getDbClient();

  return db.collection("audits");
}

// --- PROSPECT & OUTREACH COLLECTIONS ---

export async function getProspectsCollection() {
  const db = await getDbClient();

  return db.collection("prospects");
}

export async function getOutreachCollection() {
  const db = await getDbClient();

  return db.collection("outreach");
}