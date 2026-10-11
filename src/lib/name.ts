/**
 * A student's name is a first name and a last name. Mirrors
 * server/validation.js, so the message the student reads while typing and the
 * answer the server gives can never disagree.
 */
export const NAME_PROBLEM = "Enter your first and last name.";
const NAME_WORD = "\\p{L}+(?:['\u2019-]\\p{L}+)*";
const NAME_PATTERN = new RegExp(`^${NAME_WORD}(?:\\s+${NAME_WORD})+$`, "u");

export function nameProblem(value: string): string {
  const raw = (value || "").trim();
  if (raw.length > 80) return "Use a name with at most 80 characters.";
  return NAME_PATTERN.test(raw) ? "" : NAME_PROBLEM;
}

/**
 * Auto capitalisation, kept deliberately simple. The first letter of every
 * word goes up and the rest of the word stays as it was typed, so McDonald
 * survives. A name typed entirely in lower case has the rest lowered too. A
 * hyphen starts a new word, an apostrophe does not, so "o'brien" becomes
 * "O'brien".
 */
export function titleCaseName(value: string): string {
  const raw = (value || "").trim().replace(/\s+/g, " ");
  const allLower = raw === raw.toLowerCase();
  return raw.replace(
    /(^|[\s-])(\p{L})(\p{L}*)/gu,
    (_match, lead: string, first: string, rest: string) =>
      `${lead}${first.toUpperCase()}${allLower ? rest.toLowerCase() : rest}`,
  );
}
