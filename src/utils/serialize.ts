/**
 * `JSON.stringify` throws on BigInt, and `files.size_bytes` is a bigint. This
 * replacer is registered as Express's `json replacer` so every response
 * serialises consistently. Prisma `Decimal` already emits an exact string via
 * its own `toJSON`, which is what money must be sent as — never a JS number.
 */
export function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

/** Strips fields that must never leave the process. */
export function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const clone = { ...obj };
  for (const key of keys) delete clone[key];
  return clone;
}
