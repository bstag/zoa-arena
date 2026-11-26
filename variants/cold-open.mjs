/* Variant: cold-open cap + full-press endgame ("their opening, our endgame").
   Evidence: match 2377 round-by-round — we opened dealer at 76% of stack on
   round 1 and were dead by round 8; the opponent opened at 36%, probed at 2%,
   survived to round 9 with 65 tokens, and compounded ×156,000 through the
   hottest stretch of the deck (r19 WILD ×10 = +9.2M). arb-moderate does NOT
   fix this (it caps only the dealer stake — betting lines stay full Kelly and
   it also died on 2377); steady.mjs caps everything, which survives but
   forfeits the ceiling (1/14 real decks). The profile the data points to:
   cap TOTAL round commitment at COLD_FRAC while the deck is fat (deckLeft >
   WARM_AT — no counting edge exists yet, rounds are near-fair), full press
   once the deck thins and the edge is measurable. */
import * as base from "../agent/strategy.mjs";
import * as arb from "./arb.mjs";

export const COLORS = base.COLORS, SHAPES = base.SHAPES, MIN_BET = base.MIN_BET;
export const probabilities = base.probabilities, payout = base.payout, payoutFor = base.payoutFor;
export const dealerSplit = base.dealerSplit, edges = base.edges, stake = base.stake;
export const endgameDutch = arb.endgameDutch;

const COLD_FRAC = 0.30;  // max fraction of stack per round while the deck is fat
const WARM_AT = 12;      // deckLeft at which full press resumes

function scaleLines(lines, stack) {
  if (!lines || !lines.length) return lines;
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const cap = Math.round((stack * COLD_FRAC) / 5) * 5;
  if (total <= cap) return lines;
  const f = cap / total;
  return lines.map((l) => ({ ...l, amount: Math.max(MIN_BET, Math.round((l.amount * f) / 5) * 5) }));
}

export function bets(g) {
  const me = g.players[g.you];
  if (g.deckLeft > WARM_AT) return scaleLines(arb.bets(g), me.tokens);
  return arb.bets(g);
}

export function dealerPick(g) {
  const pick = arb.dealerPick(g);
  if (g.deckLeft > WARM_AT) return scaleLines([pick], g.players[g.you].tokens)[0];
  return pick;
}
