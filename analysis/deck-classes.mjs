/* Deck-class analysis: what does the real deck space look like?
   A deck is 16 distinct exact cards + 3 identical wilds. The strategically
   dominant feature is WHERE THE WILDS SIT (they kill predictions, auto-pay
   x5, unlock x10 riders): only C(19,3) = 969 wild-timing classes exist.
   This tool reconstructs every cached replay's actual card sequence and
   reports the wild-timing histogram vs theory, plus our class coverage.

   Usage: node analysis/deck-classes.mjs [--cache .replay-cache] */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const cacheDir = args.includes("--cache") ? args[args.indexOf("--cache") + 1] : join(HERE, "..", ".replay-cache");
const OUR_USER = 395;

const files = readdirSync(cacheDir).filter((f) => f.endsWith(".json"));
const classes = new Set();
let decks = 0, early = 0, late = 0, noEarly = 0;
const theory = { early: 804 / 969, late: 683 / 969, noEarly: 165 / 969 };

for (const f of files) {
  let r;
  try { r = JSON.parse(readFileSync(join(cacheDir, f), "utf8")); } catch { continue; }
  const ours = r.challenger?.userId === OUR_USER ? r.challenger : r.defender;
  if (!ours?.rounds?.length) continue;
  const wp = ours.rounds
    .map((rd, i) => (rd.card?.wild ? i : -1))
    .filter((i) => i >= 0);
  decks += 1;
  classes.add(wp.join(","));
  if (wp.some((p) => p < 8)) early += 1; else noEarly += 1;
  if (wp.some((p) => p >= 13)) late += 1;
}

const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : "0") + "%";
console.log(`decks reconstructed:      ${decks}`);
console.log(`distinct wild classes:    ${classes.size} of 969 (${pct(classes.size, 969)} of the class space)`);
console.log(`coupon-collector to full: ~7,250 games`);
console.log("");
console.log(`wild timing               real        theory`);
console.log(`>=1 wild in first 8       ${pct(early, decks).padEnd(10)}  83.0%`);
console.log(`>=1 wild in last 6        ${pct(late, decks).padEnd(10)}  70.5%`);
console.log(`zero wilds in first 8     ${pct(noEarly, decks).padEnd(10)}  17.0%`);
