/* C: no-leak + strict conviction — only bet lines with gross EV > 2
   (double-or-better against us), vs no-leak's breakeven EV > 1.
   Fewer bets, bigger edge each; tests whether the marginal EV 1-2 lines
   are contributors or noise. */
import * as base from "../agent/strategy.mjs";
import * as nl from "./no-leak.mjs";

export const COLORS = nl.COLORS, SHAPES = nl.SHAPES, MIN_BET = nl.MIN_BET;
export const probabilities = nl.probabilities, payout = nl.payout, payoutFor = nl.payoutFor;
export const dealerSplit = nl.dealerSplit, edges = nl.edges, stake = nl.stake;
export const endgameDutch = nl.endgameDutch, dealerPick = nl.dealerPick;

function evOK2(zone, g) {
  const left = base.remaining(g.history);
  const n = g.deckLeft;
  if (zone === "wild") {
    const mult = g.dealerBet?.zone === "wild" ? 10 : 5;
    return (mult * (left.wild || 0)) / n > 2;
  }
  if (zone.startsWith("x:")) return (10 * (left[zone] || 0)) / n > 2;
  return false;
}

export function bets(g) {
  const dutch = endgameDutch(g);
  if (dutch) return dutch;
  return (nl.bets(g) || []).filter((l) => evOK2(l.zone, g));
}
