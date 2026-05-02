/**
 * HTTP header names used for Distributed License Enforcement between
 * Sencho instances. A primary instance proxies tier-gated requests to
 * its remote fleet nodes and asserts the license state via these
 * headers; the remote node trusts the headers when the request is
 * authenticated as a node_proxy bearer.
 *
 * The header names are part of the wire contract between Sencho
 * instances and live in the public core so the contract is visible
 * regardless of which entitlement provider is bound.
 */
export const PROXY_TIER_HEADER = 'x-sencho-tier';
export const PROXY_VARIANT_HEADER = 'x-sencho-variant';
