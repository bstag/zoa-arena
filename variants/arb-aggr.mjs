/* Variant: arb-moderate + mid-deck aggression.
   Evidence: matches 815/831 vs pokka-agent — hot decks we crush them (204M vs
   2M), cold decks they out-compound us mid-game while we sit out thin edges
   (355k vs 42k). Mid-deck (deckLeft ~8-14) small +EV lines are being taken at
   tiny Kelly fractions; when the endgame compounds regardless, taking more of
   each small edge early raises the base the dutch multiplies.

   Changes vs arb-moderate:
   1. Mid-deck EV floor drops (take ev > 0.1 lines, not ev > 0.35+).
   2. Small-edge lines get a 12% minimum stake instead of pure Kelly f.
   3. Up to 5 lines instead of 4 in the mid-deck band.

   A/B: node sim/simulate.mjs --seeds 400 --strategy ./variants/arb-aggr.mjs */
import * as base from "../agent/strategy.mjs";
import * as arb from "./arb.mjs";
import * as moderate from "./arb-moderate.mjs";

export const COLORS = base.COLORS, SHAPES = base.SHAPES, MIN_BET = base.MIN_BET;
export const probabilities = base.probabilities, payout = base.payout, payoutFor = base.payoutFor;
export const dealerSplit = base.dealerSplit, stake = base.stake;
export const dealerPick = moderate.dealerPick;
export const endgameDutch = arb.endgameDutch;

function stakeFull(ev, p, tokens) {
  if (tokens < base.MIN_BET) return 0;
  if (p >= 1) return tokens;
  if (ev <= 0.02) return 0;
  const b = Math.max(1, (ev + (1 - p)) / (p || 1e-9));
  const f = Math.min(0.5, Math.max(0.05, ev / b));
  return Math.max(base.MIN_BET, Math.min(tokens, Math.round((tokens * f) / 5) * 5));
}

function stakeMid(ev, p, tokens) {
  if (tokens < base.MIN_BET) return 0;
  if (p >= 1) return tokens;
  if (ev <= 0.1) return 0;                       // mid-deck floor: 0.1 not 0.02
  const b = Math.max(1, (ev + (1 - p)) / (p || 1e-9));
  const f = Math.min(0.5, Math.max(0.12, ev / b)); // 12% floor for thin edges
  return Math.max(base.MIN_BET, Math.min(tokens, Math.round((tokens * f) / 5) * 5));
}

export function betsMid(g) {
  const dutch = arb.endgameDutch(g);
  if (dutch) return dutch;
  const me = g.players[g.you];
  const midDeck = g.deckLeft <= 14;
  const pick = midDeck ? stakeMid : stakeFull;
  const maxLines = midDeck ? 5 : 4;
  const lines = base.edges(g)
    .filter((e) => pick(e.ev, e.p, me.tokens) >= base.MIN_BET)
    .slice(0, maxLines);
  let budget = me.tokens;
  const out = [];
  for (const line of lines) {
    let amount = pick(line.ev, line.p, me.tokens);
    if (line.p >= 1) { out.length = 0; out.push({ zone: line.zone, amount: me.tokens }); break; }
    amount = Math.min(amount, Math.max(0, budget));
    if (amount < base.MIN_BET) continue;
    budget -= amount;
    out.push({ zone: line.zone, amount });
    if (budget < base.MIN_BET) break;
  }
  return out;
}

// simulate.mjs and the agent resolve `bets` — use the depth-aware path
export const bets = betsMid;
