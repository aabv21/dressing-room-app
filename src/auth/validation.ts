// Deliberately permissive: it stops empty or malformed input before a request; Supabase Auth still
// decides whether an address is valid and deliverable.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}
