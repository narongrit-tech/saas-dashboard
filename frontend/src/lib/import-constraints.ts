/**
 * Shared constraints for all import dialogs.
 * Keep in sync with server-side bodySizeLimit in next.config.mjs (currently 20mb).
 * Client-side guard is intentionally more generous at 50 MB to give a clear
 * user-facing error before the browser tries to upload a huge file.
 */

/** Maximum file size accepted by every import dialog (50 MB). */
export const MAX_IMPORT_FILE_SIZE_BYTES = 50 * 1024 * 1024

/** Human-readable version used in error messages. */
export const MAX_IMPORT_FILE_SIZE_LABEL = '50 MB'

/**
 * MIME type denylist — reject only clearly non-spreadsheet files.
 * We use a denylist rather than an allowlist because file.type is
 * browser/OS-dependent and can be empty for valid CSV/XLSX files.
 */
export const REJECTED_MIME_RE = /^(image\/|video\/|audio\/|application\/pdf)/
