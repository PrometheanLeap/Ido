import fs from 'fs';
import path from 'path';

// ── Version ─────────────────────────────────────────────────

let _version = '0.0.0';

function loadVersion(): void {
  try {
    const vPath = path.resolve(import.meta.dirname, '../../VERSION');
    _version = fs.readFileSync(vPath, 'utf8').trim();
  } catch {
    /* VERSION file not found — using fallback */
  }
}

loadVersion();

export function getVersion(): string {
  return _version;
}
