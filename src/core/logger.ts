import type { SeverityText } from './types';
export const SEVERITY_NUMBER: Record<SeverityText, number> = {
  DEBUG: 5,
  INFO: 9,
  WARN: 13,
  ERROR: 17,
};
export function nowNanos(): string {
  return `${Date.now()}000000`;
}
