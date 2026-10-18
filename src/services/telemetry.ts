import type { TelemetryMapping } from '../domain/schema';
/** Explicit JSON object fields (dot paths) or whitespace/comma/semicolon separated key=value records. No unlabeled numeric guessing. */
export function parseMeasurement(
  mapping: TelemetryMapping,
  line: string,
): { value: number; deviceTimestamp?: string | number } | null {
  let record: Record<string, unknown>;
  if (mapping.parser === 'json') {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    record = parsed;
  } else {
    record = Object.create(null);
    for (const match of line.matchAll(/(?:^|[\s,;])([A-Za-z_][\w.-]*)\s*=\s*([^\s,;]+)/g)) {
      if (Object.hasOwn(record, match[1])) return null;
      record[match[1]] = match[2];
    }
  }
  const get = (field: string): unknown =>
    mapping.parser === 'json'
      ? field
          .split('.')
          .reduce(
            (value: any, key) =>
              value && typeof value === 'object' && Object.hasOwn(value, key)
                ? value[key]
                : undefined,
            record,
          )
      : record[field];
  const raw = get(mapping.field);
  if (
    raw === undefined ||
    raw === null ||
    typeof raw === 'object' ||
    (typeof raw === 'string' && !raw.trim())
  )
    return null;
  const numeric =
    typeof raw === 'boolean'
      ? raw
        ? 1
        : 0
      : typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)
          ? Number(raw)
          : NaN;
  if (!Number.isFinite(numeric)) return null;
  const timestamp = mapping.deviceTimestampField ? get(mapping.deviceTimestampField) : undefined;
  return {
    value: numeric,
    ...(typeof timestamp === 'string' ||
    (typeof timestamp === 'number' && Number.isFinite(timestamp))
      ? { deviceTimestamp: timestamp }
      : {}),
  };
}
export function formatMeasurement(value: number, units: string) {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value)}${units ? ` ${units}` : ''}`;
}
export function measurementStatus(
  mapping: TelemetryMapping,
  line: string,
): 'missing' | 'invalid' | 'valid' {
  if (parseMeasurement(mapping, line)) return 'valid';
  if (mapping.parser === 'json') {
    if (!line.trimStart().startsWith('{')) return 'missing';
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      return 'invalid';
    }
    let value = record;
    for (const key of mapping.field.split('.')) {
      if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return 'missing';
      value = value[key];
    }
    return 'invalid';
  }
  const label = mapping.field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[\\s,;])${label}\\s*=`).test(line) ? 'invalid' : 'missing';
}
