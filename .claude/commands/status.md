---
description: Read STATUS.md and propose the next step
---

1. Read `docs/STATUS.md` and `docs/DECISIONS.md`.
2. Check the real state: `git status`, `git log --oneline -10`, and the files/migrations STATUS.md refers to. Flag anything in STATUS.md that does not match the repository.
3. Compare against the phase plan in `docs/ZCORE_CONTEXT.md` (section 14).

Reply in Bosnian, briefly:

- **Gotovo:** what is actually implemented (verified, not just claimed).
- **U toku / otvoreno:** unfinished work, known issues, mismatches.
- **Sljedeći korak:** one concrete recommended feature, with a 3–5 line plan (files, migration, permissions, tests) and why it comes next.

Do not change any files.
