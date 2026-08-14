# Encrypted database backups

`ff_2025_db.7z` is the raw 2025 Supabase export — the CSVs that live, in the
clear, in the gitignored `archived_db/` folder. They contain `user_id` and
`email` for all 32 players, which is exactly why they are not committed as-is.

Contents:

- `ff_2025_picks_rows.csv` — 159 rows from `ff_picks`
- `ff_2025_profiles_rows.csv` — 32 rows from `profiles`, including emails

## How it is encrypted

7-Zip, AES-256, with `-mhe=on` so the **file names are encrypted too** — an
attacker with the blob cannot even list what is inside without the passphrase.

    7z a -t7z -m0=lzma2 -mx=9 -mhe=on -p<passphrase> ff_2025_db.7z archived_db\*

The passphrase is 44 random characters from a 59-character alphabet (~259 bits).
It is **not in this repo, and must never be** — the repo is public, so the
ciphertext is world-readable and permanent. Keep the passphrase in a password
manager. Lose it and the archive is gone; leak it and every address in it is
public forever.

## How to get the data back

Any machine with 7-Zip (Windows), Keka (macOS), or p7zip (Linux):

    7z x ff_2025_db.7z -o archived_db

That restores the two CSVs, which is what
[`2025/data/build-archive-json.mjs`](../../2025/data/build-archive-json.mjs)
reads to regenerate the public `2025/data/*.json` — and that script drops
`user_id` and `email` on the way out.

## To refresh it

Re-export the tables, drop the CSVs in `archived_db/`, and re-run the `7z a`
command above with the same passphrase.
