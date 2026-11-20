/* Offline simulator for The Intuition Game — reproduce thousands of games
   locally so strategies can be A/B tested without burning the 96 games/day cap.

   The deck is generated with the site's documented provably-fair shuffle, so
   sim results transfer directly to live play for any strategy that only reads
   `history` (which ours does — the deck order is unknowable in advance).

   node sim/simulate.mjs --seeds 500 --strategy ./agent/strategy.mjs [--table 4]
   node sim/simulate.mjs --seeds 500 --strategy ./agent/strategy.mjs --verbose

   Output: final-token distribution (min/median/mean/p90/max), win rate vs the
   table, and per-round aggregate EV so you can see WHERE a strategy earns. */
import { createHash } from "node:crypto";
import { remaining, dealerPick, bets, payoutFor, COLORS, SHAPES, MIN_BET, dealerSplit } from "../agent/strategy.mjs";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1]?.startsWith("--") ? true : args[i + 1]) ?? true : (typeof dflt === "boolean" ? dflt : dflt);
};
const SEEDS = Number(opt("seeds", 200));
const STRATEGY = opt("strategy", "../agent/strategy.mjs");
const TABLE = Number(opt("table", 4));
const VERBOSE = opt("verbose", false);
const START_TOKENS = 250;

const SIM_URL = import.meta.url;   // resolve relative paths against this file, not the cwd
async function loadStrategy(spec) {
  const tries = [new URL(spec, SIM_URL).href, new URL(spec, `file://${process.cwd()}/`).href];
  for (const u of tries) { try { return await import(u); } catch (e) { if (e.code !== "ERR_MODULE_NOT_FOUND") throw e; } }
  throw new Error(`cannot load strategy ${spec}`);
}
const strat = await loadStrategy(STRATEGY);

/** the site's documented shuffle: color-major deck + 3 wilds, Fisher–Yates keyed by sha256(seed:i) */
export function deckFromSeed(seed) {
  const d = [];
  for (const c of COLORS) for (const s of SHAPES) d.push({ color: c, shape: s, wild: false });
  d.push({ wild: true }, { wild: true }, { wild: true });
  for (let i = d.length - 1; i > 0; i--) {
    const j = createHash("sha256").update(`${seed}:${i}`).digest().readUIntBE(0, 6) % (i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}
export const commitFor = (gameId, seed) => createHash("sha256").update(`${gameId}:${seed}`).digest("hex");

/** net chip delta of one player bet against a known card */
function settleBet(bet, card, dealerCalledWild) {
  if (card.wild) {
    if (bet.zone === "wild") return bet.amount * (dealerCalledWild ? 10 : 5);
    return -bet.amount;                       // wild defeats every other prediction
  }
  if (bet.zone === "wild") return -bet.amount;
  if (bet.zone.startsWith("x:")) {
    const [, c, s] = bet.zone.split(":");
    return card.color === c && card.shape === s ? bet.amount * 10 : -bet.amount;
  }
  if (bet.zone.startsWith("c:")) return card.color === bet.zone.slice(2) ? bet.amount * 2 : -bet.amount;
  if (bet.zone.startsWith("s:")) return card.shape === bet.zone.slice(2) ? bet.amount * 2 : -bet.amount;
  return -bet.amount;                          // wd/ad are priced separately below
}

/** net chip delta of the dealer's mandatory pick against a known card */
function settleDealer(bet, card) {
  if (bet.zone === "wild") return card.wild ? bet.amount * 10 : -bet.amount;
  if (card.wild) return bet.amount * 5;        // any wild pays the dealer 5x automatically
  const [, c, s] = bet.zone.split(":");
  if (card.color === c && card.shape === s) return bet.amount * 10;
  if (card.color === c || card.shape === s) return bet.amount * 2;
  return -bet.amount;
}

/** play one full 19-card game. seat 0 is ours, first dealer; dealer rotates by round. */
export function playGame(seed, strat, tableSize = TABLE) {
  const deck = deckFromSeed(seed);
  let tokens = START_TOKENS;
  const trace = [];
  for (let round = 1; round <= 19; round++) {
    const card = deck[round - 1];
    const history = deck.slice(0, round - 1);
    const g = {
      history, deckLeft: 19 - (round - 1),
      dealerSeat: (round - 1) % tableSize, you: 0,
      players: Array.from({ length: tableSize }, (_, i) => ({ seat: i, tokens: i === 0 ? tokens : START_TOKENS })),
      dealerBet: null,
    };
    const isDealer = g.dealerSeat === 0;
    let delta = 0;
    if (isDealer) {
      const pick = strat.dealerPick(g);
      g.dealerBet = { seat: 0, zone: pick.zone, amount: pick.amount };
      delta = settleDealer(pick, card);
    } else {
      // the dealer's pick happens before betting; a stand-in house dealer prices the same four-way EV
      const house = naiveDealerPick(g);
      g.dealerBet = { seat: g.dealerSeat, zone: house.zone, amount: house.amount };
      const dz = g.dealerBet.zone;
      const dealerHit = dz === "wild" ? card.wild : card.wild ? true : card.color === dz.split(":")[1] || card.shape === dz.split(":")[2];
      for (const b of strat.bets(g)) {
        if (b.zone === "wd") delta += dealerHit ? b.amount : -b.amount;
        else if (b.zone === "ad") delta += !dealerHit && !card.wild ? b.amount : -b.amount;
        else delta += settleBet(b, card, dz === "wild");
      }
    }
    tokens += delta;
    trace.push({ round, isDealer, card, delta, tokens, dealerBet: g.dealerBet, deckLeft: g.deckLeft, history });
  }
  return { tokens, trace };
}

/** a stand-in house dealer: prices the same four-way EV as our dealerPick but bets minimum */
function naiveDealerPick(g) {
  const left = remaining(g.history);
  const n = Math.max(1, g.deckLeft);
  let best = { zone: "wild", ev: -Infinity };
  for (const [zone, v] of Object.entries(left)) {
    if (zone === "wild" || v <= 0) continue;
    const [, c, s] = zone.split(":");
    const sameColor = SHAPES.reduce((t, ss) => t + (ss === s ? 0 : left[`x:${c}:${ss}`]), 0);
    const sameShape = COLORS.reduce((t, cc) => t + (cc === c ? 0 : left[`x:${cc}:${s}`]), 0);
    const pExact = v / n, pColor = sameColor / n, pShape = sameShape / n, pWild = left.wild / n;
    const ev = pExact * 10 + pColor * 2 + pShape * 2 + pWild * 5 - (1 - pExact - pColor - pShape - pWild);
    if (ev > best.ev) best = { zone, ev };
  }
  return { zone: best.zone, amount: MIN_BET };
}

const finals = [];
let roundEv = {};
for (let i = 0; i < SEEDS; i++) {
  const { tokens, trace } = playGame(`sim-seed-${i}`, strat);
  finals.push(tokens);
  for (const t of trace) {
    roundEv[t.round] = roundEv[t.round] || { n: 0, sum: 0 };
    roundEv[t.round].n++; roundEv[t.round].sum += t.delta;
  }
  if (VERBOSE && i < 3) {
    console.log(`seed ${i}: ${tokens} tokens`);
    for (const t of trace) console.log(`  r${String(t.round).padStart(2)} ${t.isDealer ? "D" : " "} ${t.card.wild ? "WILD" : `${t.card.color} ${t.card.shape}`.padEnd(11)} ${String(t.delta).padStart(6)} → ${t.tokens}`);
  }
}
finals.sort((a, b) => a - b);
const q = (f) => finals[Math.floor(f * (finals.length - 1))];
const mean = finals.reduce((a, b) => a + b, 0) / finals.length;
const winRate = (finals.filter((t) => t > START_TOKENS).length / finals.length * 100).toFixed(1);
console.log(`\n${SEEDS} games, table ${TABLE}, strategy ${STRATEGY}`);
console.log(`final tokens: min ${q(0)} | p10 ${q(0.1)} | median ${q(0.5)} | mean ${mean.toFixed(0)} | p90 ${q(0.9)} | max ${q(1)} | profitable: ${winRate}%`);
console.log("mean delta per round:");
for (const [r, s] of Object.entries(roundEv)) console.log(`  round ${String(r).padStart(2)}: ${(s.sum / s.n).toFixed(1).padStart(7)}  (${s.n})`);
