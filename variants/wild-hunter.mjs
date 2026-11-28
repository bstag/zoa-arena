/* Variant: wild-hunter — boost wild exposure on dealer-wild rider rounds.
   Dashboard evidence: only 6% of our stake rides on wilds (hit 24%, back
   8.85 — profitable), while the opponents who beat us (RumangCounter: 26
   wild bets) hunt wilds far harder. The rider is the lever: when the dealer
   calls the wild spot, wild pays 10x, so p(wild remaining) as low as 10%
   is breakeven and late-deck rider rounds are strongly +EV.

   Mechanic: identical to arb, EXCEPT on rider rounds (dealer called wild,
   >=1 wild left) the wild line moves to the front of the queue and its
   stake is doubled (capped by stack). Everything else untouched. */
import * as base from "../agent/strategy.mjs";
import * as arb from "./arb.mjs";

export const COLORS = base.COLORS, SHAPES = base.SHAPES, MIN_BET = base.MIN_BET;
export const probabilities = base.probabilities, payout = base.payout, payoutFor = base.payoutFor;
export const dealerSplit = base.dealerSplit, edges = base.edges, stake = base.stake;
export const endgameDutch = arb.endgameDutch;
export const dealerPick = arb.dealerPick;

export function bets(g) {
  const me = g.players[g.you];
  const left = base.remaining(g.history);
  const rider = g.dealerBet?.zone === "wild" && (left.wild || 0) > 0;
  const lines = arb.bets(g);
  if (!rider || !lines?.length) return lines;
  // find or mint the wild line, double it, move it to the front
  const wi = lines.findIndex((l) => l.zone === "wild");
  let wildLine;
  if (wi >= 0) {
    wildLine = { zone: "wild", amount: Math.min(me.tokens, lines[wi].amount * 2) };
    lines.splice(wi, 1);
  } else {
    wildLine = { zone: "wild", amount: Math.max(base.MIN_BET, Math.round((me.tokens * 0.15) / 5) * 5) };
  }
  wildLine.amount = Math.max(base.MIN_BET, Math.min(me.tokens, Math.round(wildLine.amount / 5) * 5));
  return [wildLine, ...lines];
}
