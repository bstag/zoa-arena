/* Variant: arb (Dutch book endgame) + graduated dealer stake.
   Rationale: full dealer press (75%) at round 1 on a 250-chip stack turns one
   cold dealer round into a bust before the Dutch-book endgame can arrive
   (matches 765 & 820 both bled out early). Dealer rounds stay the most +EV
   bets in the game, so press them HARD once the stack/deck supports it —
   but scale early exposure down so a cold round 1 costs ~1/4 of the stack,
   not 3/4.

   A/B: node sim/simulate.mjs --seeds 400 --strategy ./variants/arb-moderate.mjs */
import * as base from "../agent/strategy.mjs";
import * as arb from "./arb.mjs";

export const COLORS = base.COLORS, SHAPES = base.SHAPES, MIN_BET = base.MIN_BET;
export const probabilities = base.probabilities, payout = base.payout, payoutFor = base.payoutFor;
export const dealerSplit = base.dealerSplit, edges = base.edges, stake = base.stake;
export const bets = arb.bets;
export const endgameDutch = arb.endgameDutch;

export function dealerPick(g) {
  const pick = arb.dealerPick(g);
  // dealer rounds 1-2 sit early in the bet order (round 1 & 5 of 19 at 4-seat):
  // scale stake by depth — 25% at deckLeft 19, 50% at 17, 75%+ from deckLeft 15 on
  const depth = Math.max(0, (19 - g.deckLeft) / 18);        // 0 → 1 as deck thins
  const scale = depth < 0.15 ? 0.25 : depth < 0.3 ? 0.5 : 1;
  return { zone: pick.zone, amount: Math.max(base.MIN_BET, Math.round((pick.amount * scale) / 5) * 5) };
}
