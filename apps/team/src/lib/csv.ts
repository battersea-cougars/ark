// A spreadsheet cell for a CSV the app makes (the Unpaid fees export). Quoted, and text a spreadsheet would run as a
// formula (it starts with =, +, -, @, a tab or a return: a member's name from a join request, say) starts with an
// apostrophe, so it's only ever shown (OWASP's CSV injection advice). Numbers, and amounts like -12.00, stay numbers.
const FORMULA = /^[=+\-@\t\r]/;
const NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(v: string | number): string {
  const s = String(v);
  const safe = FORMULA.test(s) && !NUMBER.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}
