// A link's token opens a shared walk, so it never reaches a log (API-014).
// Case-insensitive and tolerant of repeated slashes, because the SPA's router
// would still open the shared page for `/S/<token>` or `//s/<token>`.
const TOKEN_PATHS = [/^(\/+s\/+)[^/]+/i, /^(\/+api\/+shared\/+)[^/]+/i]

export const redactPath = (path: string) =>
  TOKEN_PATHS.reduce((redacted, pattern) => redacted.replace(pattern, '$1[redacted]'), path)
