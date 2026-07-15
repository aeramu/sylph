interface CryptoLike {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;
}

let fallbackCounter = 0;

/**
 * Generate a client-side UI id without requiring a secure browser context.
 *
 * `crypto.randomUUID()` is unavailable in browsers when Sylph is opened over
 * plain HTTP from another device (for example http://raspberrypi.local:5173),
 * even though it works on localhost. These ids are only used as local UI keys,
 * so Web Crypto and a collision-resistant legacy fallback are sufficient.
 */
export function createId(cryptoApi: CryptoLike | null = globalThis.crypto ?? null): string {
  if (typeof cryptoApi?.randomUUID === 'function') {
    try {
      return cryptoApi.randomUUID();
    } catch {
      // Some browsers expose the method but reject it outside a secure context.
    }
  }

  if (typeof cryptoApi?.getRandomValues === 'function') {
    try {
      const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
      // RFC 4122 version 4 / variant bits. This is only a UI key, but retaining
      // UUID shape makes logs and debugging consistent with randomUUID().
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
      return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
    } catch {
      // Fall through for old or restricted browsers.
    }
  }

  fallbackCounter = (fallbackCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `local-${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${Math.random().toString(36).slice(2)}`;
}
