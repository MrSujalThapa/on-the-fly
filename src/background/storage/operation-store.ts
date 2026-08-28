import type { EditorOperation } from "../../editor/operations.js";
import type { PageKey } from "../../editor/ids.js";
import {
  coalescePageOperations,
} from "../../editor/persistence/coalesce-page-operations.js";
import { validateOperation } from "../../editor/validation/validate-operation.js";
import {
  buildExportPayload,
  type OtfExportPayload,
  type StoredAsset,
  validateImportAssets,
  validateImportOperations,
} from "../../shared/export-import.js";
import { MAX_OPERATIONS_PER_PAGE } from "../../shared/storage-limits.js";
import {
  defaultCustomizationId,
  derivePageInfo,
  type StoredCustomization,
  type StoredOperation,
  type StoredPage,
  type StoredSite,
} from "../../shared/storage-records.js";

export const OTF_DB_NAME = "on_the_fly_v1";
export const OTF_DB_VERSION = 1;

export const STORE = {
  SITES: "sites",
  PAGES: "pages",
  CUSTOMIZATIONS: "customizations",
  OPERATIONS: "operations",
  ASSETS: "assets",
} as const;

export { MAX_OPERATIONS_PER_PAGE };

export interface SaveOperationsResult {
  saved: number;
  skipped: number;
  totalCount: number;
  trimmed: number;
  capReached: boolean;
}

export interface OperationStoreOptions {
  indexedDB: IDBFactory;
  dbName?: string;
  now?: () => number;
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("indexeddb_request_failed"));
    };
  });
}

function awaitTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      resolve();
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error("indexeddb_transaction_failed"));
    };
    tx.onabort = () => {
      reject(tx.error ?? new Error("indexeddb_transaction_aborted"));
    };
  });
}

/**
 * Local-only IndexedDB store for approved editor operations. No backend, no
 * cloud sync. The IDBFactory is injectable so tests can run against
 * fake-indexeddb while production uses the service-worker `indexedDB`.
 */
export class OperationStore {
  private readonly factory: IDBFactory;
  private readonly dbName: string;
  private readonly now: () => number;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options: OperationStoreOptions) {
    this.factory = options.indexedDB;
    this.dbName = options.dbName ?? OTF_DB_NAME;
    this.now = options.now ?? (() => Date.now());
  }

  private openDatabase(): Promise<IDBDatabase> {
    this.dbPromise ??= this.openDatabaseFresh();
    return this.dbPromise;
  }

  private openDatabaseFresh(): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(this.dbName, OTF_DB_VERSION);
      request.onupgradeneeded = () => {
        upgradeSchema(request.result);
      };
      request.onsuccess = () => {
        const db = request.result;
        if (hasCompleteSchema(db)) {
          resolve(db);
          return;
        }
        // A version-less open (or a blocked delete) can leave v1 with no
        // stores. Opening the same version never re-runs onupgradeneeded, so
        // drop it and recreate the real schema.
        db.close();
        const drop = this.factory.deleteDatabase(this.dbName);
        drop.onsuccess = () => {
          this.openDatabaseFresh().then(resolve, reject);
        };
        drop.onerror = () => {
          reject(drop.error ?? new Error("indexeddb_recreate_failed"));
        };
        drop.onblocked = () => {
          reject(new Error("indexeddb_recreate_blocked"));
        };
      };
      request.onerror = () => {
        reject(request.error ?? new Error("indexeddb_open_failed"));
      };
    });
  }

  private resetConnection(): void {
    this.dbPromise = null;
  }

  private async withDatabase<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.openDatabase());
    } catch (error) {
      if (!isMissingStoreError(error)) throw error;
      try {
        (await this.dbPromise)?.close();
      } catch {
        // The cached connection is already dead.
      }
      this.resetConnection();
      return fn(await this.openDatabase());
    }
  }

  /** Replaces all stored operations for a page (used by undo/clear sync). */
  async replacePageOperations(
    pageKey: PageKey,
    operations: EditorOperation[],
  ): Promise<{ totalCount: number; trimmed: number }> {
    const invalid = operations.find((operation) => !isPersistableOperation(operation));
    if (invalid) {
      const validation = validateOperation(invalid);
      throw new Error(`invalid_checkpoint_operation:${invalid.id}:${validation.errors.join("|") || invalid.status}`);
    }
    if (operations.length > MAX_OPERATIONS_PER_PAGE) {
      throw new Error(`checkpoint_operation_limit_exceeded:${String(operations.length)}:${String(MAX_OPERATIONS_PER_PAGE)}`);
    }
    return this.replacePageOperationsInternal(pageKey, operations);
  }

  /**
   * Merges incoming operations with saved page state (coalescing duplicate hide
   * ops per target), then rewrites the page operation list. Returns diagnostics
   * so callers can log cap/quota issues instead of failing silently.
   */
  async saveOperations(
    pageKey: PageKey,
    operations: EditorOperation[],
  ): Promise<SaveOperationsResult> {
    const valid = operations.filter(isPersistableOperation);
    const skipped = operations.length - valid.length;

    if (valid.length === 0) {
      const totalCount = await this.countOperations(pageKey);
      return { saved: 0, skipped, totalCount, trimmed: 0, capReached: false };
    }

    const existing = await this.loadOperations(pageKey);
    const { operations: merged, applied, skipped: coalesceSkipped } = coalescePageOperations(
      existing,
      valid,
    );

    if (applied === 0 && merged.length === existing.length) {
      return {
        saved: 0,
        skipped: skipped + coalesceSkipped,
        totalCount: existing.length,
        trimmed: 0,
        capReached: false,
      };
    }

    const { totalCount, trimmed } = await this.replacePageOperationsInternal(pageKey, merged);

    return {
      saved: applied,
      skipped: skipped + coalesceSkipped,
      totalCount,
      trimmed,
      capReached: trimmed > 0,
    };
  }

  /** Returns the number of stored operations for a page. */
  async countOperations(pageKey: PageKey): Promise<number> {
    return this.withDatabase(async (db) => {
      const tx = db.transaction(STORE.OPERATIONS, "readonly");
      const count = await promisifyRequest<number>(
        tx.objectStore(STORE.OPERATIONS).index("pageKey").count(pageKey),
      );
      await awaitTransaction(tx);
      return count;
    });
  }

  /**
   * Replaces all operations for a page with the merged list, reassigning
   * monotonic sequence numbers. Trims oldest ops when over the per-page cap.
   */
  private async replacePageOperationsInternal(
    pageKey: PageKey,
    operations: EditorOperation[],
  ): Promise<{ totalCount: number; trimmed: number }> {
    return this.withDatabase(async (db) => {
    const { origin, normalizedPath } = derivePageInfo(pageKey);
    const timestamp = this.now();
    const customizationId = defaultCustomizationId(pageKey);

    let trimmed = 0;
    let finalOps = operations;
    if (operations.length > MAX_OPERATIONS_PER_PAGE) {
      trimmed = operations.length - MAX_OPERATIONS_PER_PAGE;
      finalOps = operations.slice(trimmed);
    }

    const tx = db.transaction(
      [STORE.SITES, STORE.PAGES, STORE.CUSTOMIZATIONS, STORE.OPERATIONS],
      "readwrite",
    );
    const operationsStore = tx.objectStore(STORE.OPERATIONS);

    const existingKeys = await promisifyRequest<IDBValidKey[]>(
      operationsStore.index("pageKey").getAllKeys(pageKey),
    );
    for (const key of existingKeys) {
      operationsStore.delete(key);
    }

    await upsertSite(tx.objectStore(STORE.SITES), origin, timestamp);
    await upsertPage(tx.objectStore(STORE.PAGES), pageKey, origin, normalizedPath, timestamp);
    await upsertCustomization(
      tx.objectStore(STORE.CUSTOMIZATIONS),
      customizationId,
      pageKey,
      timestamp,
    );

    finalOps.forEach((operation, index) => {
      const stored: StoredOperation = {
        ...operation,
        pageKey,
        customizationId,
        sequence: index + 1,
      };
      operationsStore.put(stored);
    });

    await awaitTransaction(tx);
    return { totalCount: finalOps.length, trimmed };
    });
  }

  /** Loads approved operations for a page, ordered by sequence (replay order). */
  async loadOperations(pageKey: PageKey): Promise<EditorOperation[]> {
    return this.withDatabase(async (db) => {
    const tx = db.transaction(STORE.OPERATIONS, "readonly");
    const stored = await promisifyRequest(
      tx.objectStore(STORE.OPERATIONS).index("pageKey").getAll(pageKey) as IDBRequest<
        StoredOperation[]
      >,
    );
    await awaitTransaction(tx);

    return stored
      .slice()
      .sort((left, right) => left.sequence - right.sequence)
      .map(toEditorOperation)
      .filter(isPersistableOperation);
    });
  }

  /** Reads all local stores for export. */
  async exportAll(): Promise<OtfExportPayload> {
    const db = await this.openDatabase();
    const tx = db.transaction(
      [STORE.SITES, STORE.PAGES, STORE.CUSTOMIZATIONS, STORE.OPERATIONS, STORE.ASSETS],
      "readonly",
    );

    const sites = await readAll<StoredSite>(tx.objectStore(STORE.SITES));
    const pages = await readAll<StoredPage>(tx.objectStore(STORE.PAGES));
    const customizations = await readAll<StoredCustomization>(tx.objectStore(STORE.CUSTOMIZATIONS));
    const operations = await readAll<StoredOperation>(tx.objectStore(STORE.OPERATIONS));
    const assets = await readAll<StoredAsset>(tx.objectStore(STORE.ASSETS));
    await awaitTransaction(tx);

    return buildExportPayload({
      dbName: this.dbName,
      sites,
      pages,
      customizations,
      operations,
      assets,
    });
  }

  /** Replaces all local stores with validated import data. */
  async importAll(payload: OtfExportPayload): Promise<{
    sites: number;
    pages: number;
    customizations: number;
    operations: number;
    assets: number;
  }> {
    const operations = payload.operations.map(toEditorOperation);
    const operationValidation = validateImportOperations(operations);
    if (!operationValidation.ok) {
      throw new Error(operationValidation.error);
    }

    const assetValidation = validateImportAssets(payload.assets);
    if (!assetValidation.ok) {
      throw new Error(assetValidation.error);
    }

    const db = await this.openDatabase();
    const tx = db.transaction(
      [STORE.SITES, STORE.PAGES, STORE.CUSTOMIZATIONS, STORE.OPERATIONS, STORE.ASSETS],
      "readwrite",
    );

    for (const storeName of [
      STORE.SITES,
      STORE.PAGES,
      STORE.CUSTOMIZATIONS,
      STORE.OPERATIONS,
      STORE.ASSETS,
    ] as const) {
      const store = tx.objectStore(storeName);
      const keys = await promisifyRequest<IDBValidKey[]>(store.getAllKeys());
      for (const key of keys) {
        store.delete(key);
      }
    }

    for (const site of payload.sites) {
      tx.objectStore(STORE.SITES).put(site);
    }
    for (const page of payload.pages) {
      tx.objectStore(STORE.PAGES).put(page);
    }
    for (const customization of payload.customizations) {
      tx.objectStore(STORE.CUSTOMIZATIONS).put(customization);
    }
    for (const operation of payload.operations) {
      tx.objectStore(STORE.OPERATIONS).put(operation);
    }
    for (const asset of payload.assets) {
      tx.objectStore(STORE.ASSETS).put(asset);
    }

    await awaitTransaction(tx);

    return {
      sites: payload.sites.length,
      pages: payload.pages.length,
      customizations: payload.customizations.length,
      operations: payload.operations.length,
      assets: payload.assets.length,
    };
  }

  /** Rough byte estimate for diagnostics and warnings. */
  async estimateStorageBytes(): Promise<{
    operationCount: number;
    pageCount: number;
    assetCount: number;
    estimatedBytes: number;
  }> {
    const payload = await this.exportAll();
    const json = JSON.stringify(payload);
    return {
      operationCount: payload.operations.length,
      pageCount: payload.pages.length,
      assetCount: payload.assets.length,
      estimatedBytes: new TextEncoder().encode(json).length,
    };
  }

  /** Removes all stored operations, the customization, and the page record. */
  async clearPage(pageKey: PageKey): Promise<number> {
    const db = await this.openDatabase();
    const tx = db.transaction(
      [STORE.PAGES, STORE.CUSTOMIZATIONS, STORE.OPERATIONS],
      "readwrite",
    );
    const operationsStore = tx.objectStore(STORE.OPERATIONS);
    const keys = await promisifyRequest<IDBValidKey[]>(
      operationsStore.index("pageKey").getAllKeys(pageKey),
    );
    for (const key of keys) {
      operationsStore.delete(key);
    }

    const customizations = tx.objectStore(STORE.CUSTOMIZATIONS);
    const customizationKeys = await promisifyRequest<IDBValidKey[]>(
      customizations.index("pageKey").getAllKeys(pageKey),
    );
    for (const key of customizationKeys) {
      customizations.delete(key);
    }

    tx.objectStore(STORE.PAGES).delete(pageKey);
    await awaitTransaction(tx);
    return keys.length;
  }

  close(): void {
    if (!this.dbPromise) {
      return;
    }
    void this.dbPromise.then((db) => {
      db.close();
    });
    this.dbPromise = null;
  }
}

function isPersistableOperation(operation: EditorOperation): boolean {
  return operation.status === "approved" && validateOperation(operation).ok;
}

function hasCompleteSchema(db: IDBDatabase): boolean {
  return (
    db.objectStoreNames.contains(STORE.SITES) &&
    db.objectStoreNames.contains(STORE.PAGES) &&
    db.objectStoreNames.contains(STORE.CUSTOMIZATIONS) &&
    db.objectStoreNames.contains(STORE.OPERATIONS) &&
    db.objectStoreNames.contains(STORE.ASSETS)
  );
}

function isMissingStoreError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "NotFoundError" ||
    /object store(?:s)? was not found/iu.test(error.message)
  );
}

function upgradeSchema(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(STORE.SITES)) {
    db.createObjectStore(STORE.SITES, { keyPath: "origin" });
  }

  if (!db.objectStoreNames.contains(STORE.PAGES)) {
    const pages = db.createObjectStore(STORE.PAGES, { keyPath: "pageKey" });
    pages.createIndex("origin", "origin", { unique: false });
    pages.createIndex("updatedAt", "updatedAt", { unique: false });
  }

  if (!db.objectStoreNames.contains(STORE.CUSTOMIZATIONS)) {
    const customizations = db.createObjectStore(STORE.CUSTOMIZATIONS, { keyPath: "id" });
    customizations.createIndex("pageKey", "pageKey", { unique: false });
    customizations.createIndex("updatedAt", "updatedAt", { unique: false });
  }

  if (!db.objectStoreNames.contains(STORE.OPERATIONS)) {
    const operations = db.createObjectStore(STORE.OPERATIONS, { keyPath: "id" });
    operations.createIndex("pageKey", "pageKey", { unique: false });
    operations.createIndex("customizationId", "customizationId", { unique: false });
    operations.createIndex("sequence", "sequence", { unique: false });
    operations.createIndex("updatedAt", "createdAt", { unique: false });
  }

  if (!db.objectStoreNames.contains(STORE.ASSETS)) {
    const assets = db.createObjectStore(STORE.ASSETS, { keyPath: "id" });
    assets.createIndex("pageKey", "pageKey", { unique: false });
    assets.createIndex("createdAt", "createdAt", { unique: false });
  }
}

async function upsertSite(
  store: IDBObjectStore,
  origin: string,
  timestamp: number,
): Promise<void> {
  const existing = await promisifyRequest(
    store.get(origin) as IDBRequest<StoredSite | undefined>,
  );
  const record: StoredSite = {
    origin,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  store.put(record);
}

async function upsertPage(
  store: IDBObjectStore,
  pageKey: PageKey,
  origin: string,
  normalizedPath: string,
  timestamp: number,
): Promise<void> {
  const existing = await promisifyRequest(
    store.get(pageKey) as IDBRequest<StoredPage | undefined>,
  );
  const record: StoredPage = {
    pageKey,
    origin,
    normalizedPath,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  store.put(record);
}

async function upsertCustomization(
  store: IDBObjectStore,
  id: string,
  pageKey: PageKey,
  timestamp: number,
): Promise<void> {
  const existing = await promisifyRequest(
    store.get(id) as IDBRequest<StoredCustomization | undefined>,
  );
  const record: StoredCustomization = {
    id,
    pageKey,
    name: existing?.name ?? "Default",
    isActive: true,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  store.put(record);
}

function toEditorOperation(stored: StoredOperation): EditorOperation {
  const record = { ...stored } as Partial<StoredOperation>;
  delete record.customizationId;
  delete record.sequence;
  return record as EditorOperation;
}

async function readAll<T>(store: IDBObjectStore): Promise<T[]> {
  return promisifyRequest(store.getAll() as IDBRequest<T[]>);
}
