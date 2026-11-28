/* D: no-leak + top-2 lines — the middle habit between conviction (1 line,
   8/14) and the incumbent 4-line spread (7/14). Keeps a hedge partner but
   still concentrates most of the budget. */
import * as nl from "./no-leak.mjs";

export const COLORS = nl.COLORS, SHAPES = nl.SHAPES, MIN_BET = nl.MIN_BET;
export const probabilities = nl.probabilities, payout = nl.payout, payoutFor = nl.payoutFor;
export const dealerSplit = nl.dealerSplit, edges = nl.edges, stake = nl.stake;
export const endgameDutch = nl.endgameDutch, dealerPick = nl.dealerPick;

export function bets(g) {
  const dutch = endgameDutch(g);
  if (dutch) return dutch;
  return (nl.bets(g) || []).slice(0, 2);
}
