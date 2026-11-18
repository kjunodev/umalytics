import { normalizeMatchCode } from './matchDetection';
import { isRawPlayerIdentifier } from './rosterIdentity';

const NAME_LIMIT = 50;
const NAME_LENGTH = 64;

export interface UnrecognisedFeedField {
  name: string;
  count: number;
  firstEventType: string;
}

function feedFieldName(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || /[^A-Za-z0-9_.-]/.test(value) ||
      /^\d+$/.test(value) || /^[a-f0-9]{32}$/i.test(value) ||
      isRawPlayerIdentifier(value) || normalizeMatchCode(value) !== undefined) return undefined;
  return value.slice(0, NAME_LENGTH);
}

export class UnrecognisedFeedFields {
  private fields = new Map<string, UnrecognisedFeedField>();

  record(rawName: unknown, rawEventType: unknown, count = 1): void {
    const name = feedFieldName(rawName), firstEventType = feedFieldName(rawEventType);
    if (name === undefined || firstEventType === undefined || !Number.isSafeInteger(count) || count < 1) return;
    const field = this.fields.get(name);
    if (field) field.count = Math.min(field.count + count, Number.MAX_SAFE_INTEGER);
    else if (this.fields.size < NAME_LIMIT) this.fields.set(name, { name, count, firstEventType });
  }

  // Validate again when a batch crosses the page or storage boundary.
  merge(batch: unknown): void {
    if (!Array.isArray(batch)) return;
    for (const entry of batch.slice(0, NAME_LIMIT)) {
      if (entry === null || typeof entry !== 'object' || typeof entry.count !== 'number') continue;
      this.record(entry.name, entry.firstEventType, entry.count);
    }
  }

  snapshot(): UnrecognisedFeedField[] {
    return Array.from(this.fields.values(), field => ({ ...field }));
  }
}

export function formatUnrecognisedFeedFields(fields: readonly UnrecognisedFeedField[] = []): string {
  const lines = fields.map(({ name, count, firstEventType }) => `${name} ×${count} (first seen in ${firstEventType})`);
  return `Unrecognised feed fields\n${lines.join('\n') || 'none'}`;
}
