/* Exact paired replay: re-run any strategy against a REAL match table.
   Unlike whatif.mjs (which re-simulates house seats and is only approximate),
   this keeps every recorded house bet verbatim and substitutes ONLY our seat.
   Bets in this game are simultaneous and independent, so opponents' behavior
   is unaffected by our choices — the result is an exact counterfactual.

   Usage: node analysis/whatif-exact.mjs <matchId> <strategyPath> [ours|them]
     default seat = the side we played; "them" scores the opponent's seat
   Output: actual score vs replayed score (must match when replaying the
   strategy that actually played the match — that's the calibration check). */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
try {
  for (const line of readFileSync(join(HERE, "..", ".env"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {}
const BASE = process.env.ZOA_URL || "https://play.zoagames.com";
const KEY = process.env.IN2IT_API_KEY;
const OUR_USER = 395; // Blackstag

const [matchId, stratPath, sideArg] = process.argv.slice(2);
if (!matchId || !stratPath) { console.error("usage: whatif-exact.mjs <matchId> <strategy> [ours|them]"); process.exit(1); }
const strat = await import(new URL(stratPath, `file://${process.cwd()}/`).href);

const r = await (await fetch(`${BASE}/api/agent/ladder/matches/${matchId}/replay`, {
  headers: { authorization: `Bearer ${KEY}` },
})).json();

const sideName = sideArg || (r.challenger.userId === OUR_USER ? "challenger" : "defender");
const side = r[sideName];
const ourSeat = Number(Object.values(side.table).find((s) => !s.isAI)?.seat ?? side.humanSeat ?? 0);
const actual = side.score;
const rounds = side.rounds;
// dealer wins 4 ways: exact 10x, color 2x, shape 2x, wild-auto 5x (10x if pick was wild)
const dealerSettle = (zone, card) => {
  if (card.wild) return zone === "wild" ? 10 : 5;              // wild-auto
  if (zone.startsWith("x:")) {
    const [, c, s] = zone.split(":");
    if (zone === "x:" + card.color + ":" + card.shape) return 10;
    return c === card.color || s === card.shape ? 2 : 0;
  }
  if (zone.startsWith("c:")) return zone === "c:" + card.color ? 2 : 0;
  if (zone.startsWith("s:")) return zone === "s:" + card.shape ? 2 : 0;
  return 0; // dealer picked a malformed zone
};
const dealerPickHit = (zone, card) => {
  if (card.wild) return zone === "wild";
  if (zone.startsWith("x:")) {
    const [, c, s] = zone.split(":");
    return (c === card.color || s === card.shape);
  }
  if (zone.startsWith("c:")) return zone === "c:" + card.color;
  if (zone.startsWith("s:")) return zone === "s:" + card.shape;
  return false;
};
const playerMult = (zone, card, dealerCalledWild) =>
  zone === "wild" ? (dealerCalledWild ? 10 : 5)
  : zone.startsWith("x:") ? 10
  : zone.startsWith("c:") || zone.startsWith("s:") ? 2
  : 1; // wd / ad
const playerWinners = (card, dealerPickHit, dealerCalledWild) => {
  // a wild card beats every non-wild prediction: only the wild zone wins.
  // Observed (match 803 r7): on a wild card wd loses even when the dealer
  // wins by wild-auto — wd only pays when the dealer actually CALLED wild.
  if (card.wild) {
    const w = ["wild"];
    if (dealerCalledWild) w.push("wd");
    return w;
  }
  const w = ["x:" + card.color + ":" + card.shape, "c:" + card.color, "s:" + card.shape];
  w.push(dealerPickHit ? "wd" : "ad");   // wd = with dealer (hit), ad = against
  return w;
};

let tokens = 250;
const trace = [];
for (const round of rounds) {
  const history = rounds.slice(0, round.round - 1).map((x) => x.card);
  const card = round.card;
  const weAreDealer = round.dealerSeat === ourSeat;
  const realDealerZone = round.dealerBet.zone;
  const dealerCalledWild = realDealerZone === "wild";
  const realDealerPickHit = dealerPickHit(realDealerZone, card);
  let delta = 0, acted = [];
  if (weAreDealer) {
    const g = { history, deckLeft: 19 - (round.round - 1), dealerSeat: ourSeat, you: ourSeat,
      players: [{ seat: ourSeat, tokens }], dealerBet: null };
    const pick = strat.dealerPick(g);
    if (pick.amount > 0) {
      const m = dealerSettle(pick.zone, card);
      delta = m > 0 ? pick.amount * m : -pick.amount;
      acted.push(`D ${pick.zone}x${pick.amount}`);
    }
  } else {
    const winners = playerWinners(card, realDealerPickHit, dealerCalledWild);
    const g = { history, deckLeft: 19 - (round.round - 1), dealerSeat: round.dealerSeat, you: ourSeat,
      players: [{ seat: ourSeat, tokens }], dealerBet: round.dealerBet };
    for (const b of strat.bets(g)) {
      acted.push(`${b.zone}x${b.amount}`);
      const m = playerMult(b.zone, card, dealerCalledWild);
      if (winners.includes(b.zone)) delta += b.amount * m;
      else delta -= b.amount;
    }
  }
  tokens += delta;
  trace.push({ round: round.round, delta, tokens, acts: acted.join("+") || "sit" });
}
const last = trace[trace.length - 1];
console.log(`match ${matchId} (${sideName}, seat ${ourSeat}) | actual ${actual} | replayed ${tokens} | ${tokens === actual ? "EXACT ✓" : "DIFFERS ✗"}`);
if (tokens !== actual) for (const t of trace) console.log(`  r${t.round}: ${t.acts} → ${t.delta} (stack ${t.tokens})`);
