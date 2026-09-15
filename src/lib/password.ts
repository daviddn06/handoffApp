/**
 * Password strength, the way the server judges it. server/validation.js holds
 * the same rules, so the meter never promises something the API refuses.
 *
 * The score is an entropy style estimate rather than a count of character
 * classes: length drives it, and anything that makes the password guessable
 * (a run, a repeat, your own name, a password everybody picks) is taken back
 * off. That matches how a real attacker works far better than "one symbol".
 */

/** The same short list the server carries, trimmed to what a meter needs. */
const COMMON = [
  "password",
  "passw0rd",
  "qwerty",
  "qwertyuiop",
  "asdfgh",
  "asdfghjkl",
  "zxcvbn",
  "zxcvbnm",
  "abc123",
  "abcdef",
  "iloveyou",
  "sunshine",
  "princess",
  "monkey",
  "dragon",
  "shadow",
  "master",
  "football",
  "baseball",
  "basketball",
  "letmein",
  "welcome",
  "whatever",
  "trustno1",
  "freedom",
  "starwars",
  "pokemon",
  "minecraft",
  "fortnite",
  "trojan",
  "trojans",
  "fighton",
  "usc",
  "ucla",
  "bruins",
  "campus",
  "college",
  "student",
  "university",
  "school",
  "roommate",
  "handoff",
  "sublease",
  "sublet",
  "apartment",
  "losangeles",
  "california",
  "secret",
  "admin",
  "login",
  "changeme",
  "computer",
  "internet",
  "instagram",
  "snapchat",
  "netflix",
  "spotify",
  "iphone",
  "summer",
  "winter",
  "birthday",
  "chocolate",
  "sunflower",
];

const KEYBOARD_ROWS = [
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
  "1234567890",
  "abcdefghijklmnopqrstuvwxyz",
];

const fold = (value: string) =>
  value
    .toLowerCase()
    .replace(/[@4]/g, "a")
    .replace(/[$5]/g, "s")
    .replace(/0/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/3/g, "e")
    .replace(/[7+]/g, "t");

const strip = (value: string) =>
  value
    .toLowerCase()
    .replace(/^[\d\W_]+/, "")
    .replace(/[\d\W_]+$/, "");

/** A password that is one of the guesses everybody tries first. */
export function isCommonPassword(value: string) {
  const raw = value.toLowerCase();
  const bases = [
    raw,
    strip(raw),
    raw.replace(/[^a-z0-9]+/g, ""),
    raw.replace(/[^a-z]+/g, ""),
  ];
  return bases.some((base) => {
    if (!base) return false;
    const folded = fold(base);
    return (
      COMMON.includes(base) ||
      COMMON.includes(folded) ||
      COMMON.includes(folded.replace(/[^a-z]+/g, ""))
    );
  });
}

/** The longest run of one repeated character, "aaa" counts as 3. */
function longestRepeat(value: string) {
  let best = 1;
  let run = 1;
  for (let i = 1; i < value.length; i++) {
    run = value[i] === value[i - 1] ? run + 1 : 1;
    if (run > best) best = run;
  }
  return value.length ? best : 0;
}

/** The longest straight run along a keyboard row or the alphabet, forwards or back. */
function longestSequence(value: string) {
  const low = value.toLowerCase();
  let best = 0;
  for (const row of KEYBOARD_ROWS) {
    const reversed = [...row].reverse().join("");
    for (const source of [row, reversed])
      for (let length = source.length; length >= 3; length--)
        for (let start = 0; start + length <= source.length; start++) {
          const run = source.slice(start, start + length);
          if (low.includes(run) && run.length > best) best = run.length;
        }
  }
  return best;
}

/** Personal words a stranger can look up: the name and the email local part. */
function personalWords({ email = "", name = "" }) {
  const words: string[] = [];
  const local = email.split("@")[0].toLowerCase();
  if (local.length >= 3) words.push(local);
  for (const part of local.split(/[^a-z]+/))
    if (part.length >= 3) words.push(part);
  for (const part of name.toLowerCase().split(/[^a-z]+/))
    if (part.length >= 3) words.push(part);
  return [...new Set(words)];
}

export type PasswordLevel = "empty" | "weak" | "okay" | "good" | "strong";

export type PasswordCheck = {
  /** 0 empty, 1 weak, 2 okay, 3 good, 4 strong. */
  score: 0 | 1 | 2 | 3 | 4;
  level: PasswordLevel;
  label: string;
  /** The single most useful next step, or "" when there is nothing to add. */
  hint: string;
  /** The server rule this password breaks, "" when it would be accepted. */
  problem: string;
  /** True when the server would accept it. The meter only advises. */
  valid: boolean;
  /** An order of magnitude guess, "" when an honest one is not available. */
  crack: string;
};

const LABELS: Record<PasswordLevel, string> = {
  empty: "",
  weak: "Weak",
  okay: "Okay",
  good: "Good",
  strong: "Strong",
};

/**
 * The server rules, one message at a time so the student is told the single
 * thing that is missing. Mirrors passwordProblem in server/validation.js.
 */
export function passwordProblem(
  value: string,
  { email = "", name = "" }: { email?: string; name?: string } = {},
) {
  if (value.length < 10) return "Use a password with at least 10 characters.";
  if (value.length > 128) return "Use a password with at most 128 characters.";
  void email;
  void name;
  if (isCommonPassword(value))
    return "That password is one of the most common ones. Choose something only you would pick.";
  return "";
}

/** Order of magnitude only, and only for a password worth estimating. */
function crackTime(bits: number) {
  if (bits < 45) return "instant";
  if (bits < 60) return "hours";
  if (bits < 75) return "years";
  return "centuries";
}

export function passwordCheck(
  value: string,
  context: { email?: string; name?: string } = {},
): PasswordCheck {
  const password = value ?? "";
  if (!password)
    return {
      score: 0,
      level: "empty",
      label: "",
      hint: "",
      problem: "Choose a password.",
      valid: false,
      crack: "",
    };

  const problem = passwordProblem(password, context);
  const low = password.toLowerCase();
  const folded = fold(password);

  // Rough per character entropy from the alphabet actually used.
  let alphabet = 0;
  if (/[a-z]/.test(password)) alphabet += 26;
  if (/[A-Z]/.test(password)) alphabet += 26;
  if (/\d/.test(password)) alphabet += 10;
  if (/[^a-zA-Z0-9]/.test(password)) alphabet += 20;
  let bits = password.length * Math.log2(Math.max(alphabet, 2));

  // Take back the parts a guesser does not have to search.
  const repeat = longestRepeat(password);
  if (repeat >= 3) bits -= (repeat - 2) * 6;
  const sequence = longestSequence(password);
  if (sequence >= 3) bits -= (sequence - 2) * 7;
  const words = personalWords(context);
  const personal = words.find(
    (word) => low.includes(word) || folded.includes(word),
  );
  if (personal) bits -= personal.length * Math.log2(Math.max(alphabet, 2)) + 4;
  const dictionary = COMMON.find(
    (word) => word.length >= 5 && (low.includes(word) || folded.includes(word)),
  );
  if (dictionary)
    bits -= dictionary.length * Math.log2(Math.max(alphabet, 2)) - 6;
  // A mix of kinds is worth a little, but far less than another six characters.
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((test) =>
    test.test(password),
  ).length;
  bits += (kinds - 1) * 2;
  if (/\s/.test(password.trim())) bits += 3;
  bits = Math.max(4, bits);

  let score: PasswordCheck["score"] =
    bits < 45 ? 1 : bits < 60 ? 2 : bits < 75 ? 3 : 4;
  // Anything the server would refuse can never read better than Weak.
  if (problem) score = 1;

  const level: PasswordLevel = (["weak", "okay", "good", "strong"] as const)[
    score - 1
  ];

  // One hint, the single most useful next step.
  let hint = "";
  if (problem) hint = problem;
  else if (personal) hint = "Do not use your name or email.";
  else if (dictionary) hint = "Avoid words everybody picks.";
  else if (sequence >= 4) hint = "Avoid 1234 style sequences.";
  else if (repeat >= 3) hint = "Avoid repeating the same character.";
  else if (bits < 75) hint = "Add a few more characters.";

  return {
    score,
    level,
    label: LABELS[level],
    hint,
    problem,
    valid: !problem,
    crack: problem ? "" : crackTime(bits),
  };
}
