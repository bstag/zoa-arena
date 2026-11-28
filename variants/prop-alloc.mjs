/* E: no-leak + proportional EV allocation.
   The incumbent funds lines SEQUENTIALLY: each line is Kelly-sized on the
   full stack, then the next line takes its cut of what remains — the first
   line dominates and totals can balloon. Proportional allocation instead
   splits the round budget (30% of stack) across the passing lines weighted
   by EV, so exposure is capped and every +EV line gets fair share. */
import * as base from "../agent/strategy.mjs";
import * as nl from "./no-leak.mjs";
import * as arb from "./arb.mjs";

export const COLORS = nl.COLORS, SHAPES = nl.SHAPES, MIN_BET = nl.MIN_BET;
export const probabilities = nl.probabilities, payout = nl.payout, payoutFor = nl.payoutFor;
export const dealerSplit = nl.dealerSplit, edges = nl.edges, stake = nl.stake;
export const endgameDutch = nl.endgameDutch, dealerPick = nl.dealerPick;

const ROUND_FRAC = 0.5;

export function bets(g) {
  const dutch = endgameDutch(g);
  if (dutch) return dutch;
  const me = g.players[g.you];
  const evOf = (zone) => {
    const left = base.remaining(g.history);
    const mult = zone === "wild" ? (g.dealerBet?.zone === "wild" ? 10 : 5) : zone.startsWith("x:") ? 10 : 2;
    const count = zone === "wild" ? (left.wild || 0) : (left[zone] || 0);
    return (mult * count) / g.deckLeft;
  };
  const raw = arb.bets(g) || [];
  const kept = raw.filter((l) => evOf(l.zone) > 1);
  if (!kept.length) return kept;
  const totalEV = kept.reduce((s, l) => s + evOf(l.zone), 0);
  const budget = Math.round((me.tokens * ROUND_FRAC) / 5) * 5;
  return kept.map((l) => ({
    zone: l.zone,
    amount: Math.max(base.MIN_BET, Math.min(me.tokens, Math.round((budget * evOf(l.zone) / totalEV) / 5) * 5)),
  }));
}
