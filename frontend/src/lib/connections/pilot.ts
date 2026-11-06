/** Is this address on the pilot list? An unset list means no one, and a guest has no address. */
export function isPilotEmail(email: string | null | undefined, list: string | undefined): boolean {
  if (!email) return false;
  const allowed = (list ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}
