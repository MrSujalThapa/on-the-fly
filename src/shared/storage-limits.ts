/** Local product limits — see docs/04_LOCAL_PERSISTENCE_AND_RELEASE.md */

export const MAX_OPERATIONS_PER_PAGE = 1000;
export const MAX_OPERATIONS_TOTAL = 25_000;

export const MAX_SINGLE_ASSET_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_ASSETS_BYTES = 20 * 1024 * 1024;

/** Max serialized JSON size for a full export download. */
export const MAX_EXPORT_BYTES = 8 * 1024 * 1024;

/** Max serialized JSON size accepted on import. */
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

/** Show a friendly warning when local storage approaches this size. */
export const STORAGE_SIZE_WARNING_BYTES = 15 * 1024 * 1024;

export const DUPLICATE_OFFSET_PX = 12;
