/* Variant: steady-fraction staking — the RumangCounter fingerprint.
   Evidence chain: (1) full-press arb and graduated arb-moderate are dead even
   (5/12 real decks each) and BOTH bust decks where opponents extracted value
   (2377: opponent 10.15M; 2606: opponent 446k; both = 0 under every tested
   schedule). (2) The opponents who repeatedly beat us (RumangCounter, Arsya)
   stake a steady ~30-40% of stack per round — never bust, still compound.

   Mechanic: keep arb's bet selection and endgame Dutch book untouched, but
   post-scale each round's TOTAL commitment (dealer pick + betting lines) to
   a fixed fraction of the current stack. Full-press rounds (4 Kelly lines)
   are the bust engine; this caps the round at ROUND_FRAC of stack. */
import * as base from "../agent/strategy.mjs";
import * as arb from "./arb.mjs";

export const COLORS = base.COLORS, SHAPES = base.SHAPES, MIN_BET = base.MIN_BET;
export const probabilities = base.probabilities, payout = base.payout, payoutFor = base.payoutFor;
export const dealerSplit = base.dealerSplit, edges = base.edges, stake = base.stake;
export const endgameDutch = arb.endgameDutch;

const ROUND_FRAC = 0.35;   // max fraction of stack committed per round

function scaleLines(lines, stack) {
  if (!lines || !lines.length) return lines;
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const cap = Math.round((stack * ROUND_FRAC) / 5) * 5;
  if (total <= cap) return lines;
  const f = cap / total;
  return lines.map((l) => ({ ...l, amount: Math.max(MIN_BET, Math.round((l.amount * f) / 5) * 5) }));
}

export function bets(g) {
  const me = g.players[g.you];
  return scaleLines(arb.bets(g), me.tokens);
}

export function dealerPick(g) {
  const pick = arb.dealerPick(g);
  const stack = g.players[g.you].tokens;
  return scaleLines([pick], stack)[0];
}
