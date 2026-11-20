/* Counterfactual engine: replay a SETTLED match's real deck through a candidate
   strategy and compare the final stack against what we actually scored.

   node analysis/whatif.mjs <matchId> <strategyPath> [challenger|defender]

   Same deck, same house dealer picks (read from the replay), only OUR decisions
   are substituted. This is a paired comparison on real ladder decks — the
   strongest tuning signal we can get short of playing live. Exit code 0. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
for (const p of [join(HERE, "..", ".env")]) {
  try {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {}
}
const KEY = process.env.IN2IT_API_KEY;
const BASE = process.env.ZOA_URL || "https://play.zoagames.com";
const COLORS = ["blue", "green", "yellow", "red"], SHAPES = ["lion", "man", "ox", "eagle"];

export async function fetchReplay(matchId) {
  const r = await fetch(`${BASE}/api/agent/ladder/matches/${matchId}/replay`, { headers: { authorization: `Bearer ${KEY}` } });
  const j = await r.json();
  if (!j || j.error) throw new Error(`replay fetch failed: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

export function deckFromSeed(seed) {
  const d = [];
  for (const c of COLORS) for (const s of SHAPES) d.push({ color: c, shape: s, wild: false });
  d.push({ wild: true }, { wild: true }, { wild: true });
  for (let i = d.length - 1; i > 0; i--) {
    const jj = createHash("sha256").update(`${seed}:${i}`).digest().readUIntBE(0, 6) % (i + 1);
    [d[i], d[jj]] = [d[jj], d[i]];
  }
  return d;
}

function settleBet(bet, card, dealerCalledWild) {
  if (card.wild) return bet.zone === "wild" ? bet.amount * (dealerCalledWild ? 10 : 5) : -bet.amount;
  if (bet.zone === "wild") return -bet.amount;
  if (bet.zone.startsWith("x:")) {
    const [, c, s] = bet.zone.split(":");
    return card.color === c && card.shape === s ? bet.amount * 10 : -bet.amount;
  }
  if (bet.zone.startsWith("c:")) return card.color === bet.zone.slice(2) ? bet.amount * 2 : -bet.amount;
  if (bet.zone.startsWith("s:")) return card.shape === bet.zone.slice(2) ? bet.amount * 2 : -bet.amount;
  return -bet.amount;
}

function settleDealer(bet, card) {
  if (bet.zone === "wild") return card.wild ? bet.amount * 10 : -bet.amount;
  if (card.wild) return bet.amount * 5;
  const [, c, s] = bet.zone.split(":");
  if (card.color === c && card.shape === s) return bet.amount * 10;
  if (card.color === c || card.shape === s) return bet.amount * 2;
  return -bet.amount;
}

/** run `strat` over the match's deck, substituting only our decisions */
export function whatif(replay, strat, side) {
  const meta = replay.match;
  const P = side === "defender" ? replay.defender : replay.challenger;
  const seat = P.humanSeat ?? 0;
  const deck = deckFromSeed(meta.seed);
  let tokens = 250;
  const rounds = [];
  for (const rd of P.rounds) {
    const idx = rd.round - 1;
    const card = deck[idx];
    const history = deck.slice(0, idx);
    const isDealer = rd.dealerSeat === seat;
    const g = { history, deckLeft: 19 - idx, dealerSeat: rd.dealerSeat, you: seat, players: [{ seat, tokens }], dealerBet: null };
    let delta = 0;
    if (isDealer) {
      const pick = strat.dealerPick(g);
      g.dealerBet = { seat, zone: pick.zone, amount: pick.amount };
      delta = settleDealer(pick, card);
    } else {
      const dz = rd.dealerBet?.zone ?? "x:none:none";
      g.dealerBet = rd.dealerBet ?? { zone: dz, amount: 5 };
      const dealerHit = dz === "wild" ? card.wild : card.wild ? true : card.color === dz.split(":")[1] || card.shape === dz.split(":")[2];
      for (const b of strat.bets(g)) {
        if (b.zone === "wd") delta += dealerHit ? b.amount : -b.amount;
        else if (b.zone === "ad") delta += !dealerHit && !card.wild ? b.amount : -b.amount;
        else delta += settleBet(b, card, dz === "wild");
      }
    }
    tokens += delta;
    rounds.push({ round: rd.round, delta, tokens });
  }
  return { finalTokens: tokens, actual: P.score, rounds, side, seat };
}

/* CLI: node analysis/whatif.mjs <matchId> <strategyPath> [side] */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()) && process.argv[2]) {
  const matchId = process.argv[2];
  const stratPath = process.argv[3];
  const side = process.argv[4];
  const replay = await fetchReplay(matchId);
  const picked = side || (replay.challenger.played && replay.challenger.humanSeat != null ? "challenger" : "defender");
  const strat = await import(new URL(stratPath, `file://${process.cwd()}/`).href);
  const res = whatif(replay, strat, picked);
  console.log(`match ${matchId} (${picked}): actual ${res.actual} → ${stratPath}: ${res.finalTokens}`);
} 
