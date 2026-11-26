/** Optional frontend capability: older hosts do not expose a UUID service. */
export interface UUIDContext {
  uuid?: { v4?: () => string };
}

/** RFC 4122 v4 identifiers, including on HTTP/LAN and older hosts. */
export function newId(ctx?: UUIDContext): string {
  if (typeof ctx?.uuid?.v4 === 'function') return ctx.uuid.v4();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
