/* Variant: arb endgame + compromise dealer schedule.
   Evidence: across 12 real paired decks, arb (full 75% dealer press from r1)
   and arb-moderate (25%→50%→100%) are dead even at 5 wins each — but they
   lose DIFFERENT decks (arb lost 2373's defense where moderate's floor wins;
   moderate lost 831 where arb wins). Hypothesis: a middle schedule
   (50% early, full press from deckLeft ≤ 15) captures both floors.

   A/B: node sim/simulate.mjs --seeds 400 --strategy ./variants/arb-mid.mjs
   Paired: node analysis/whatif-exact.mjs <matchId> ./variants/arb-mid.mjs */
import * as base from "../agent/strategy.mjs";
import * as arb from "./arb.mjs";

export const COLORS = base.COLORS, SHAPES = base.SHAPES, MIN_BET = base.MIN_BET;
export const probabilities = base.probabilities, payout = base.payout, payoutFor = base.payoutFor;
export const dealerSplit = base.dealerSplit, edges = base.edges, stake = base.stake;
export const bets = arb.bets;
export const endgameDutch = arb.endgameDutch;

export function dealerPick(g) {
  const pick = arb.dealerPick(g);
  // 50% stake while the deck is fat (deckLeft > 15), full press after
  const scale = g.deckLeft > 15 ? 0.5 : 1;
  return { zone: pick.zone, amount: Math.max(base.MIN_BET, Math.round((pick.amount * scale) / 5) * 5) };
}
