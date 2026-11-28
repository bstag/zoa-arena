/* Variant: no-leak (wild-hunter + strict EV>1 line filter).
   Bet-audit evidence (117 matches, 4,555 bets): wd is structurally −EV
   (1× payout can never clear breakeven: −53% ROI over 544 bets, all
   phases), colour −70%, mid wilds without the rider −39%. These −EV lines
   are the cold-deck bleed that busts us before the endgame where exact
   (+797%) and rider wilds (+533%) make all the money.

   Mechanic: wild-hunter, plus — outside the Dutch book — never place a
   line whose gross EV < 1: drop wd/ad/colour/character entirely, keep
   wild only when rider-adjusted EV > 1 (10x rider makes wild +EV whenever
   wilds/deckLeft > 10%; plain 5x wild needs wilds > deckLeft/5), keep
   exact when 10×count/deckLeft > 1. Dealer picks untouched (early dealer
   picks audit +32% ROI). Dutch-book lines are never filtered: their
   profit is the SET cover (Σ(1/mult) < 1), not any single line's EV. */
import * as base from "../agent/strategy.mjs";
import * as arb from "./arb.mjs";

export const COLORS = base.COLORS, SHAPES = base.SHAPES, MIN_BET = base.MIN_BET;
export const probabilities = base.probabilities, payout = base.payout, payoutFor = base.payoutFor;
export const dealerSplit = base.dealerSplit, edges = base.edges, stake = base.stake;
export const endgameDutch = arb.endgameDutch;
export const dealerPick = arb.dealerPick;

function evOK(zone, g) {
  const left = base.remaining(g.history);
  const n = g.deckLeft;
  if (zone === "wild") {
    const mult = g.dealerBet?.zone === "wild" ? 10 : 5;
    return (mult * (left.wild || 0)) / n > 1;
  }
  if (zone.startsWith("x:")) return (10 * (left[zone] || 0)) / n > 1;
  return false; // wd/ad/colour/character are structurally <= breakeven
}

export function bets(g) {
  const dutch = endgameDutch(g);
  if (dutch) return dutch;             // guaranteed +EV set cover — never filtered
  const me = g.players[g.you];
  const kept = (arb.bets(g) || []).filter((l) => evOK(l.zone, g));
  const left = base.remaining(g.history);
  const rider = g.dealerBet?.zone === "wild" && (left.wild || 0) > 0;
  if (rider) {
    const wi = kept.findIndex((l) => l.zone === "wild");
    if (wi >= 0) {
      const w = { zone: "wild", amount: Math.max(base.MIN_BET, Math.min(me.tokens, Math.round((kept[wi].amount * 2) / 5) * 5)) };
      kept.splice(wi, 1);
      kept.unshift(w);
    }
  }
  return kept;
}
