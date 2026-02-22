export function parsePositivePort(value: string, flagName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid --${flagName}: "${value}". Expected 1-65535.`);
  }
  return parsed;
}

export function buildNodeOptions(existing: string, requires: string[]): string {
  const parts = existing.trim().length > 0 ? [existing.trim()] : [];
  for (const req of requires) {
    if (!existing.includes(req)) {
      parts.push(`--require ${req}`);
    }
  }
  if (!existing.includes('--dns-result-order=ipv4first')) {
    parts.push('--dns-result-order=ipv4first');
  }
  return parts.join(' ').trim();
}
