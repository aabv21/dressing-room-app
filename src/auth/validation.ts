// A deliberately permissive check (M8: catch empty/obviously-malformed input before a network
// call, not replace server-side validation) — one `@`, something on both sides, a dot somewhere
// in the domain part. Supabase's own signup/sign-in endpoints remain the source of truth for
// whether an address is actually valid and deliverable.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}
