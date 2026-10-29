/** Storage values and key names belong to their callers; adapters preserve them. */
export interface KeyValueStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface CoreStorage {
  local: KeyValueStorage;
  session?: KeyValueStorage;
}

export interface CorePlatform {
  storage?: CoreStorage;
  fetch?: typeof globalThis.fetch;
  recordDiagnostic?: (value: unknown) => void;
}

let corePlatform: CorePlatform = {};

/** Configure once, before making requests or reading persisted profiles. */
export function configureCorePlatform(platform: CorePlatform): void {
  corePlatform = platform;
}

export function getCoreStorage(): CoreStorage | undefined {
  return corePlatform.storage;
}

export function fetchCore(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return (corePlatform.fetch ?? globalThis.fetch)(input, init);
}

export function recordCoreDiagnostic(value: unknown): void {
  corePlatform.recordDiagnostic?.(value);
}
