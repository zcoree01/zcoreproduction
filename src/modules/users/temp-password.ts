import { randomInt } from "node:crypto";

// Temporary passwords are easy to read out and type on a phone: a simple
// Bosnian word without diacritics plus three digits ("jabuka482"). Digits 0
// and 1 are left out (confused with O and l). The user must replace the
// password at the first sign-in, so it only has to survive a short time
// (sign-in is rate limited by Supabase Auth).

export const TEMP_PASSWORD_WORDS = [
  "jabuka",
  "kruska",
  "sljiva",
  "malina",
  "jagoda",
  "banana",
  "limun",
  "lopta",
  "stolica",
  "prozor",
  "vrata",
  "cvijet",
  "livada",
  "planina",
  "rijeka",
  "jezero",
  "oblak",
  "mjesec",
  "sunce",
  "kamen",
  "grana",
  "trava",
  "ptica",
  "macka",
  "krava",
  "pijesak",
  "snijeg",
  "olovka",
  "knjiga",
  "sveska",
  "torba",
  "cipela",
  "jakna",
  "majica",
  "pekara",
  "ulica",
  "avion",
  "vagon",
  "traktor",
  "kombi",
  "lampa",
  "kocka",
  "tanjur",
  "lonac",
  "kasika",
  "ormar",
  "krevet",
  "jastuk",
  "cekic",
  "kljuc",
  "turpija",
  "bager",
  "kutija",
  "zvono",
  "sirena",
  "dugme",
] as const;

const DIGITS = "23456789";

export function generateTempPassword(): string {
  const word = TEMP_PASSWORD_WORDS[randomInt(TEMP_PASSWORD_WORDS.length)] ?? "jabuka";
  let digits = "";
  for (let i = 0; i < 3; i++) digits += DIGITS[randomInt(DIGITS.length)];
  return `${word}${digits}`;
}
