/**
 * search.js — NutriPolo
 * Client search shared by the Clients list and the command palette (Ctrl+K):
 * without accents or case ("maria" finds "María") and phones compared by
 * their digits ("600 11 22 33", "+34600112233" and "600112233" are the same).
 */

export const foldText = (s) => String(s ?? '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .trim();

const phoneDigits = (s) => {
  let d = String(s ?? '').replace(/\D/g, '');
  if (d.startsWith('0034')) d = d.slice(4);
  else if (d.startsWith('34') && d.length === 11) d = d.slice(2);
  return d;
};

/** A matcher for `query`: true for clients whose name, email or phone fits. */
export function clientMatcher(query) {
  const q = foldText(query);
  const digits = phoneDigits(query);
  if (!q) return () => true;
  return (client) =>
    foldText(client?.nombre).includes(q)
    || foldText(client?.email).includes(q)
    || (digits.length >= 3 && [client?.telefono, client?.whatsapp].some(p => phoneDigits(p).includes(digits)));
}
