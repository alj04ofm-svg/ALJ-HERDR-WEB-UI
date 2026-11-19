/** File and queue limits. A 2 GiB file is transported as bounded 8 MiB chunks. */
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024 * 1024;
export const ATTACHMENT_CHUNK_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_SELECTION = 100;
/** Older clients keep a bounded single-request transport; new clients use chunks. */
export const LEGACY_ATTACHMENT_BYTES = 100 * 1024 * 1024;
export const MAX_ATTACHMENT_REQUEST_BYTES = Math.ceil(LEGACY_ATTACHMENT_BYTES / 3) * 4 + 64 * 1024;
