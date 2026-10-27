import { usernameSchema } from "@/lib/auth/username";

// Usernames generated from a person's name: first name, a dot and as many
// letters of the last name as needed to be unique ("mirza.z", "mirza.ze", …),
// then the whole last name with a number ("mirza.zebic2", …).

const MAX_USERNAME = 32;
const MAX_NUMBER_SUFFIX = 99;

const LETTER_MAP: Record<string, string> = { đ: "dj", ß: "ss", æ: "ae", ø: "o", ł: "l" };

/** Lower-case ASCII letters and digits only ("Đurić-Šehić" → "djuricsehic"). */
export function normalizeNamePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[đßæøł]/g, (letter) => LETTER_MAP[letter] ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** "Mirza Zebić" → first "Mirza", last "Zebić" (middle words are dropped). */
export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  return { firstName: words[0] ?? "", lastName: words.length > 1 ? (words.at(-1) ?? "") : "" };
}

/** Username candidates in order of preference; all valid usernames. */
export function usernameCandidates(firstName: string, lastName: string): string[] {
  let first = normalizeNamePart(firstName);
  let last = normalizeNamePart(lastName);
  if (first === "") [first, last] = [last, ""];
  if (first === "") first = "korisnik";
  // Room for ".", the last name and a two-digit number.
  first = first.slice(0, 16);
  last = last.slice(0, MAX_USERNAME - first.length - 3);

  const candidates: string[] = [];
  if (last === "") {
    candidates.push(first);
    for (let n = 2; n <= MAX_NUMBER_SUFFIX; n++) candidates.push(`${first}${n}`);
  } else {
    for (let length = 1; length <= last.length; length++) {
      candidates.push(`${first}.${last.slice(0, length)}`);
    }
    for (let n = 2; n <= MAX_NUMBER_SUFFIX; n++) candidates.push(`${first}.${last}${n}`);
  }
  return candidates.filter((candidate) => usernameSchema.safeParse(candidate).success);
}

/** First candidate that is not taken, or null when all are. */
export function pickUsername(candidates: string[], taken: ReadonlySet<string>): string | null {
  return candidates.find((candidate) => !taken.has(candidate)) ?? null;
}
