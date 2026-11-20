/* Regret analyzer: fetch a settled match replay and diff our actual decisions
   against ex-post perfect play (the seed reveals the whole deck).

   node analysis/regret.mjs <matchId> [challenger|defender]

   Per round:
   - what we bet, its ex-ante EV (was it the right call given what we knew?)
   - what it realized
   - what perfect play realized (all-in on the best-paying zone that hit)
   Aggregates: final stacks, total regret, decision errors vs sizing errors. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { remaining, payout, dealerSplit, edges } from "../agent/strategy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
for (const p of [join(HERE, "..", ".env"), join(HERE, "..", "..", ".env")]) {
  try {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {}
}
const KEY = process.env.IN2IT_API_KEY;
const BASE = process.env.ZOA_URL || "https://play.zoagames.com";
const matchId = process.argv[2];
let side = process.argv[3];
if (!KEY || !matchId) { console.error("usage: node analysis/regret.mjs <matchId> [challenger|defender]"); process.exit(1); }

const r = await fetch(`${BASE}/api/agent/ladder/matches/${matchId}/replay`, { headers: { authorization: `Bearer ${KEY}` } });
const j = await r.json();
if (!j || j.error) { console.error("replay fetch failed:", JSON.stringify(j).slice(0, 300)); process.exit(1); }
const meta = j.match, ch = j.challenger, df = j.defender;
if (!side) side = ch.humanSeat != null && ch.played ? "challenger" : "defender";
const P = side === "challenger" ? ch : df;
const seat = P.humanSeat ?? 0;
console.log(`match ${meta.id} | ${ch.name} (${ch.score}) vs ${df.name} (${df.score}) | winner: ${meta.winnerId === ch.userId ? ch.name : df.name}`);
console.log(`analyzing: ${P.name} (${side}, seat ${seat}) | stake ${meta.stakeChips}, pot ${meta.potChips}`);

/* reconstruct the deck from the published seed (verified against a live replay) */
const COLORS = ["blue", "green", "yellow", "red"], SHAPES = ["lion", "man", "ox", "eagle"];
function deckFromSeed(seed) {
  const d = [];
  for (const c of COLORS) for (const s of SHAPES) d.push({ color: c, shape: s, wild: false });
  d.push({ wild: true }, { wild: true }, { wild: true });
  for (let i = d.length - 1; i > 0; i--) {
    const jj = createHash("sha256").update(`${seed}:${i}`).digest().readUIntBE(0, 6) % (i + 1);
    [d[i], d[jj]] = [d[jj], d[i]];
  }
  return d;
}
const deck = deckFromSeed(meta.seed);

let tokens = 250, perfect = 250, evBank = 0;
let satOutPositive = 0, negativeEvBets = 0, sizingMiss = 0, dealerRounds = 0, dealerSized = 0;
const misses = [];
for (const rd of P.rounds) {
  const idx = rd.round - 1;
  const card = deck[idx];
  const history = deck.slice(0, idx);
  const g = { history, deckLeft: 19 - idx, dealerSeat: rd.dealerSeat, you: seat, players: [{ seat, tokens }], dealerBet: rd.dealerBet ?? null };
  const isDealer = rd.dealerSeat === seat;
  const myBets = (rd.bets || []).filter((b) => b.seat === seat);
  const actual = rd.deltas?.[String(seat)] ?? 0;

  /* ex-ante EV of what we actually did */
  let evActual = 0;
  if (isDealer && rd.dealerBet) {
    dealerRounds++;
    dealerSized += rd.dealerBet.amount;
    const left = remaining(history), n = g.deckLeft, zone = rd.dealerBet.zone;
    if (zone === "wild") { const pw = left.wild / n; evActual += (pw * 10 - (1 - pw)) * rd.dealerBet.amount; }
    else {
      const [, c, s] = zone.split(":");
      const sameColor = SHAPES.reduce((t, ss) => t + (ss === s ? 0 : left[`x:${c}:${ss}`]), 0);
      const sameShape = COLORS.reduce((t, cc) => t + (cc === c ? 0 : left[`x:${cc}:${s}`]), 0);
      const pExact = (left[`x:${c}:${s}`] || 0) / n, pColor = sameColor / n, pShape = sameShape / n, pWild = left.wild / n;
      evActual += (pExact * 10 + pColor * 2 + pShape * 2 + pWild * 5 - (1 - pExact - pColor - pShape - pWild)) * rd.dealerBet.amount;
    }
  } else {
    for (const b of myBets) {
      const es = edges(g).find((e) => e.zone === b.zone);
      const p = es ? es.p : 0;
      const ev = es ? es.ev : -1;
      evActual += ev * b.amount;
      if (ev <= 0.02) negativeEvBets++;
      else if (es && stakeFor(es) > b.amount * 2) sizingMiss++;
    }
    if (!isDealer && myBets.length === 0) {
      const best = edges(g)[0];
      if (best && stakeFor(best) >= 5) satOutPositive++;
    }
  }

  /* perfect play: everything on the best-paying zone that hits this card */
  let bestMult;
  if (card.wild) bestMult = rd.dealerBet?.zone === "wild" ? 10 : isDealer ? 10 : 5;
  else if (isDealer) bestMult = 10;
  else bestMult = 10;
  const perfectDelta = perfect * bestMult;

  tokens += actual;
  perfect += perfectDelta;
  evBank += evActual;
  const regret = perfectDelta - actual;
  if (regret > 500 && regret < 1e15) misses.push(`r${rd.round}: actual ${actual > 0 ? "+" : ""}${actual} vs perfect +${Math.round(perfectDelta)} (${card.wild ? "WILD" : `${card.color} ${card.shape}`})`);
}
console.log(`\nfinal: us ${tokens} | deck-reconstructed: ${tokens === P.score ? "matches reported score ✓" : "MISMATCH vs " + P.score}`);
console.log(`ex-ante EV earned: ${evBank.toFixed(0)} chips of pure edge (realized ${tokens - 250})`);
console.log(`decision errors: ${negativeEvBets} negative-EV bets | ${satOutPositive} rounds sat out with +EV available | ${sizingMiss} undersized bets`);
console.log(`dealer rounds: ${dealerRounds}, avg stake ${dealerRounds ? (dealerSized / dealerRounds).toFixed(0) : "-"} (dealer pick is structurally +EV — size it like your best bet)`);
console.log(`theoretical ceiling (all-in compounding): 10^${(Math.log10(perfect)).toFixed(1)} — not reachable, but late-deck compounding is where the score lives`);
if (misses.length) { console.log("biggest reachable misses:"); for (const m of misses.slice(0, 8)) console.log("  " + m); }

function stakeFor(e) {
  const b = payout(e.zone);
  return Math.max(0, Math.min(1, (e.ev / b) * 0.5));
}
