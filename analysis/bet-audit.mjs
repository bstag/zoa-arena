/* Bet-type audit: every bet we've made across all cached replays, scored
   against the actual winners[] of its round. Extends the owner dashboard
   (which pools 90 days) with per-type, per-phase, rider-split economics.

   Dealer picks are settled separately (they win four ways: exact 10x,
   colour 2x, character 2x, wild-auto 5x/10x) using component compare.

   Usage: node analysis/bet-audit.mjs [--cache .replay-cache] */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const cacheDir = args.includes("--cache") ? args[args.indexOf("--cache") + 1] : join(HERE, "..", ".replay-cache");
const OUR_USER = 395;

const bucket = (k) => ({
  staked: 0, won: 0, net: 0, hits: 0, n: 0,
  add(amount, stake_){ this.staked += amount; this.n += 1; if (stake_) { this.won += stake_; this.hits += 1; this.net += stake_ - amount; } else this.net -= amount; },
});
const byType = { exact: bucket(), wild: bucket(), colour: bucket(), character: bucket(), wd: bucket(), ad: bucket(), dealer: bucket() };
const byPhase = { early: {}, mid: {}, end: {} };
const phase = (deckLeft) => (deckLeft > 12 ? "early" : deckLeft > 6 ? "mid" : "end");
const phaseType = (p, t) => (byPhase[p][t] ??= bucket());

const payout = (zone, rider) => (zone === "wild" ? (rider ? 10 : 5) : zone.startsWith("x:") ? 10 : zone === "wd" || zone === "ad" ? 1 : 2);

let matches = 0;
for (const f of readdirSync(cacheDir).filter((x) => x.endsWith(".json"))) {
  let r;
  try { r = JSON.parse(readFileSync(join(cacheDir, f), "utf8")); } catch { continue; }
  const ours = r.challenger?.userId === OUR_USER ? r.challenger : r.defender;
  if (!ours?.rounds?.length) continue;
  matches += 1;
  const mySeat = (ours.table || []).find((s) => !s.isAI)?.seat ?? 0;
  const deckLeftAt = (rd) => 19 - (rd.round - 1);
  for (const rd of ours.rounds) {
    const ph = phase(deckLeftAt(rd));
    const winners = new Set(rd.winners || []);
    const rider = rd.dealerBet?.zone === "wild";
    for (const b of rd.bets || []) {
      if (b.seat !== mySeat) continue;
      const t = b.zone === "wild" ? "wild" : b.zone.startsWith("x:") ? "exact" : b.zone.startsWith("c:") ? "colour" : b.zone.startsWith("s:") ? "character" : b.zone;
      const hit = winners.has(b.zone);
      const back = hit ? b.amount * payout(b.zone, rider) : 0;
      byType[t].add(b.amount, back);
      phaseType(ph, t).add(b.amount, back);
    }
    // dealer pick: wins exact 10x / colour 2x / character 2x / wild-auto 5x (10x if called wild)
    if (rd.dealerSeat === mySeat && rd.dealerBet) {
      const d = rd.dealerBet, card = rd.card || {};
      let mult = 0;
      if (card.wild) mult = d.zone === "wild" ? (rider ? 10 : 5) : 5;         // wild auto-pays the dealer
      else if (d.zone === `x:${card.color}:${card.shape}`) mult = 10;
      else if (d.zone === `c:${card.color}`) mult = 2;
      else if (d.zone === `s:${card.shape}`) mult = 2;
      const back = mult > 0 ? d.amount * mult : 0;
      byType.dealer.add(d.amount, back);
      phaseType(ph, "dealer").add(d.amount, back);
    }
  }
}

const fmt = (b) => `${String(b.n).padStart(4)} | ${String(Math.round(b.staked)).padStart(9)} | ${(100 * b.hits / Math.max(1, b.n)).toFixed(1).padStart(5)}% | ${String(Math.round(b.net)).padStart(10)} | ${(b.staked ? (100 * b.net / b.staked).toFixed(1) : "0").padStart(7)}%`;
console.log(`matches: ${matches}\n`);
console.log("type      bets |     staked |  hit% |        net |     ROI");
for (const [t, b] of Object.entries(byType)) console.log(`${t.padEnd(9)} ${fmt(b)}`);
console.log("\nby phase:");
for (const [p, types] of Object.entries(byPhase)) {
  console.log(`-- ${p} (deckLeft ${p === "early" ? "13-19" : p === "mid" ? "7-12" : "1-6"})`);
  for (const [t, b] of Object.entries(types)) console.log(`  ${t.padEnd(9)} ${fmt(b)}`);
}
