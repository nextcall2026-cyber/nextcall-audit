/**
 * TEMPORARY in-memory persistence shim (demo mode).
 *
 * Activated only when DATA_MODE=memory is set at process start. Implements
 * the small subset of the Astra Data API used by the persistence services
 * (find/findOne/insertOne/updateOne/deleteOne/deleteMany/findOneAndUpdate
 * with $set/$setOnInsert/$push updates) backed by plain Maps, so the
 * create -> enrich -> audit -> prospect -> outreach flow runs with no
 * database. Everything lives in process memory only.
 */

type Doc = Record<string, unknown>;

const stores = new Map<string, Map<string, Doc>>();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getPath(doc: Doc, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (acc, part) => (acc == null ? undefined : (acc as Doc)[part]),
    doc
  );
}

function setPath(doc: Doc, path: string, value: unknown): void {
  const parts = path.split(".");
  let target: Record<string, unknown> = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (typeof target[part] !== "object" || target[part] === null) {
      target[part] = {};
    }
    target = target[part] as Record<string, unknown>;
  }
  target[parts[parts.length - 1]] = value;
}

function deepMatch(doc: Doc, filter: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(filter)) {
    if (key === "$or" && Array.isArray(expected)) {
      if (!expected.some((f) => deepMatch(doc, f as Record<string, unknown>))) return false;
      continue;
    }
    if (key === "$and" && Array.isArray(expected)) {
      if (!expected.every((f) => deepMatch(doc, f as Record<string, unknown>))) return false;
      continue;
    }

    const actual = getPath(doc, key);

    if (expected !== null && typeof expected === "object" && !Array.isArray(expected)) {
      const entries = Object.entries(expected);
      const isOperatorObject = entries.length > 0 && entries.every(([op]) => op.startsWith("$"));
      if (isOperatorObject) {
        for (const [op, val] of entries) {
          switch (op) {
            case "$eq":
              if (actual !== val) return false;
              break;
            case "$ne":
              if (actual === val) return false;
              break;
            case "$in":
              if (!(Array.isArray(val) && val.includes(actual))) return false;
              break;
            case "$nin":
              if (Array.isArray(val) && val.includes(actual)) return false;
              break;
            case "$gt":
              if (!(actual !== null && actual !== undefined && (actual as number) > (val as number))) return false;
              break;
            case "$gte":
              if (!(actual !== null && actual !== undefined && (actual as number) >= (val as number))) return false;
              break;
            case "$lt":
              if (!(actual !== null && actual !== undefined && (actual as number) < (val as number))) return false;
              break;
            case "$lte":
              if (!(actual !== null && actual !== undefined && (actual as number) <= (val as number))) return false;
              break;
            case "$exists":
              if ((actual !== undefined) !== Boolean(val)) return false;
              break;
            case "$regex":
              if (!new RegExp(val as string).test(String(actual ?? ""))) return false;
              break;
            default:
              return false;
          }
        }
        continue;
      }
      if (JSON.stringify(actual) !== JSON.stringify(expected)) return false;
      continue;
    }

    if (actual !== expected) return false;
  }
  return true;
}

function applyUpdate(doc: Doc, update: Record<string, unknown>, isInsert: boolean): void {
  for (const [op, payload] of Object.entries(update)) {
    switch (op) {
      case "$set":
        for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
          setPath(doc, k, v);
        }
        break;
      case "$setOnInsert":
        if (isInsert) {
          for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
            setPath(doc, k, v);
          }
        }
        break;
      case "$push":
        for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
          const arr = ((getPath(doc, k) as unknown[]) ?? []).slice();
          arr.push(v);
          setPath(doc, k, arr);
        }
        break;
      default:
        throw new Error(`[MemoryDb] Unsupported update operator: ${op}`);
    }
  }
}

function matches(filter: Record<string, unknown>, options?: { sort?: Record<string, 1 | -1>; limit?: number }, store?: Map<string, Doc>): Doc[] {
  const docs: Doc[] = [];
  if (store) {
    for (const doc of store.values()) docs.push(doc);
  } else {
    for (const map of stores.values()) {
      for (const doc of map.values()) docs.push(doc);
    }
  }
  let matched = docs.filter((doc) => deepMatch(doc, filter));

  if (options?.sort) {
    const keys = Object.entries(options.sort);
    matched = matched.sort((a, b) => {
      for (const [key, dir] of keys) {
        const av = getPath(a, key) as never;
        const bv = getPath(b, key) as never;
        if (av === bv) continue;
        if (av === undefined) return 1;
        if (bv === undefined) return -1;
        return av > bv ? (dir as number) : -(dir as number);
      }
      return 0;
    });
  }

  if (typeof options?.limit === "number" && options.limit >= 0) {
    matched = matched.slice(0, options.limit);
  }

  return matched;
}

interface MemoryCursor {
  toArray(): Promise<Doc[]>;
}

class MemoryCollection {
  private readonly name: string;

  constructor(name: string) {
    this.name = name;
    if (!stores.has(name)) stores.set(name, new Map());
  }

  private get store(): Map<string, Doc> {
    return stores.get(this.name)!;
  }

  private idOf(doc: Doc): string {
    return String(doc._id ?? doc.id ?? doc.businessId);
  }

  async findOne(
    filter: Record<string, unknown>,
    options?: { sort?: Record<string, 1 | -1>; limit?: number }
  ): Promise<Doc | null> {
    const docs = matches(filter, options, this.store);
    return docs.length > 0 ? clone(docs[0]) : null;
  }

  find(
    filter: Record<string, unknown>,
    options?: { sort?: Record<string, 1 | -1>; limit?: number }
  ): MemoryCursor {
    const docs = matches(filter, options, this.store).map((d) => clone(d));
    return { toArray: async () => docs };
  }

  async insertOne(doc: Doc): Promise<{ insertedId: string; acknowledged: boolean }> {
    const id = this.idOf(doc);
    this.store.set(id, clone(doc));
    return { insertedId: id, acknowledged: true };
  }

  async updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: { upsert?: boolean }
  ): Promise<{ matchedCount: number; modifiedCount: number; upsertedId: string | null; acknowledged: boolean }> {
    const doc = matches(filter, { limit: 1 }, this.store)[0];
    if (doc) {
      applyUpdate(doc, update, false);
      this.store.set(this.idOf(doc), doc);
      return { matchedCount: 1, modifiedCount: 1, upsertedId: null, acknowledged: true };
    }
    if (options?.upsert) {
      const created: Doc = {};
      applyUpdate(created, update, true);
      const idKey = Object.keys(filter).find((k) => k === "_id" || k === "id") ?? "_id";
      const id = String(filter[idKey] ?? this.idOf(created) ?? "upserted");
      created[idKey] = id;
      this.store.set(id, created);
      return { matchedCount: 0, modifiedCount: 1, upsertedId: id, acknowledged: true };
    }
    return { matchedCount: 0, modifiedCount: 0, upsertedId: null, acknowledged: true };
  }

  async findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<Doc | null> {
    const doc = matches(filter, { limit: 1 }, this.store)[0];
    if (!doc) return null;
    applyUpdate(doc, update, false);
    this.store.set(this.idOf(doc), doc);
    return clone(doc);
  }

  async deleteOne(filter: Record<string, unknown>): Promise<{ deletedCount: number }> {
    const doc = matches(filter, { limit: 1 }, this.store)[0];
    if (!doc) return { deletedCount: 0 };
    this.store.delete(this.idOf(doc));
    return { deletedCount: 1 };
  }

  async deleteMany(filter: Record<string, unknown>): Promise<{ deletedCount: number }> {
    let deleted = 0;
    for (const key of Array.from(this.store.keys())) {
      const doc = this.store.get(key)!;
      if (deepMatch(doc, filter)) {
        this.store.delete(key);
        deleted++;
      }
    }
    return { deletedCount: deleted };
  }
}

export interface MemoryDb {
  collection(name: string): MemoryCollection;
}

let memoryDbInstance: MemoryDb | null = null;

export function getMemoryDb(): MemoryDb {
  if (!memoryDbInstance) {
    memoryDbInstance = { collection: (name: string) => new MemoryCollection(name) };
  }
  return memoryDbInstance;
}

export function __dumpStores(target: Map<string, Map<string, unknown>>): void {
  for (const [name, map] of stores) {
    target.set(name, new Map(map));
  }
}