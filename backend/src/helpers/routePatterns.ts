// Shared route-matching patterns used by multiple middleware modules.

/** Matches webhook trigger paths: /webhooks/<numeric id>/trigger. Used by the
 *  global rate limiter (skip) and the auth gate (skip): webhooks authenticate
 *  via HMAC, not session cookie. */
export const WEBHOOK_TRIGGER_RE = /^\/webhooks\/\d+\/trigger$/;
