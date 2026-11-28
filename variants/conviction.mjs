/* B: no-leak + conviction — fund ONLY the single best line per round
   (after the leak filter), no 4-line spread. Tests the habit dimension:
   RumangCounter spreads ~3 lines, xiaozhi-ops 5, we spread up to 4. */
import * as nl from "./no-leak.mjs";

export const COLORS = nl.COLORS, SHAPES = nl.SHAPES, MIN_BET = nl.MIN_BET;
export const probabilities = nl.probabilities, payout = nl.payout, payoutFor = nl.payoutFor;
export const dealerSplit = nl.dealerSplit, edges = nl.edges, stake = nl.stake;
export const endgameDutch = nl.endgameDutch, dealerPick = nl.dealerPick;

export function bets(g) {
  const dutch = endgameDutch(g);
  if (dutch) return dutch;                       // set cover stays
  const lines = nl.bets(g) || [];
  return lines.slice(0, 1);                      // conviction: top line only
}
