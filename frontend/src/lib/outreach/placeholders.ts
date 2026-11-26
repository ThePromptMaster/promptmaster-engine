/**
 * Placeholders left in an email (Sean, 26 Nov: "Hold anything with an unresolved placeholder").
 * Pure. An email that still holds one is never approved, ticketed or sent.
 */

/** What still needs filling in: `{{first_name}}`, `[Name]`, `<company>`, TBD, TODO, XX. In order, once each. */
export function unresolvedPlaceholders(text: string): string[] {
  const found: string[] = [];
  const add = (s: string) => {
    if (!found.includes(s)) found.push(s);
  };
  for (const m of text.matchAll(/\{\{\s*[^{}]{0,40}?\s*\}\}/g)) add(m[0]);
  // "[Name]", "[Company name]": a capitalised word or two in square brackets. Not "[1]" or "[S3]".
  for (const m of text.matchAll(/\[(?:[A-Z][a-z]+)(?: [A-Za-z]+){0,3}\]/g)) add(m[0]);
  // "<company>", "<first name>": lower-case words in angle brackets, never an address or a tag with attributes.
  for (const m of text.matchAll(/<(?:[a-z]+)(?:[ _][a-z]+){0,3}>/g)) {
    if (!/^<(?:br|p|b|i|u|em|strong|div|span|ul|ol|li|a)>$/.test(m[0])) add(m[0]);
  }
  for (const m of text.matchAll(/\b(?:TBD|TBC|TODO|XXX*)\b/g)) add(m[0]);
  return found;
}
