/* A: no-leak + dealer wild-spot calls in wild-dense spots.
   Dealer auto-pays 5x on any wild; calling the wild spot doubles that to
   10x but forfeits exact/colour/character wins for the round. Expected:
   call is better exactly when wild density is high enough that the doubled
   auto-pay beats the foregone non-wild branch. Threshold: call when
   wilds/deckLeft >= 0.25 (i.e. odds the card is wild are 1-in-4 or better). */
import * as base from "../agent/strategy.mjs";
import * as nl from "./no-leak.mjs";
import * as arb from "./arb.mjs";

export const COLORS = base.COLORS, SHAPES = base.SHAPES, MIN_BET = base.MIN_BET;
export const probabilities = base.probabilities, payout = base.payout, payoutFor = base.payoutFor;
export const dealerSplit = base.dealerSplit, edges = base.edges, stake = base.stake;
export const endgameDutch = nl.endgameDutch, bets = nl.bets;

export function dealerPick(g) {
  const left = base.remaining(g.history);
  const n = g.deckLeft;
  if ((left.wild || 0) / n >= 0.25) return { zone: "wild", amount: arb.dealerPick(g).amount };
  return nl.dealerPick(g);
}
