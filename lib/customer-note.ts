export function parseCustomerNote(value: unknown): { ok: true; note: string | null } | { ok: false } {
  if (typeof value !== "string" || value.length > 500) return { ok: false };
  const note = value.trim();
  if (/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(note)) return { ok: false };
  return { ok: true, note: note || null };
}
