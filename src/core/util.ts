/** Small helpers with no Node dependencies (shared with the UI bundle). */
export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
