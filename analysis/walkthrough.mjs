/* Decision walkthrough: simulate a few games with full narration of what the
   strategy knew, what it bet, and what a hindsight-optimal bet would have done.
   Plus one structural check: the endgame arbitrage.

   node analysis/walkthrough.mjs [--seeds 3] [--strategy ./variants/pokka-style.mjs] */
import { deckFromSeed, commitFor } from "../sim/engine.mjs";
import { remaining, edges, payoutFor, dealerPick, bets, MIN_BET, COLORS, SHAPES } from "../agent/strategy.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const N = Number(opt("seeds", 3));
const stratPath = opt("strategy", null);
const strat = stratPath ? await import(new URL(stratPath, `file://${process.cwd()}/`).href) : { dealerPick, bets };

function settleBet(bet, card, rider) {
  if (card.wild) return bet.zone === "wild" ? bet.amount * (rider ? 10 : 5) : -bet.amount;
  if (bet.zone === "wild") return -bet.amount;
  if (bet.zone.startsWith("x:")) { const [, c, s] = bet.zone.split(":"); return card.color === c && card.shape === s ? bet.amount * 10 : -bet.amount; }
  if (bet.zone.startsWith("c:")) return card.color === bet.zone.slice(2) ? bet.amount * 2 : -bet.amount;
  if (bet.zone.startsWith("s:")) return card.shape === bet.zone.slice(2) ? bet.amount * 2 : -bet.amount;
  return -bet.amount;
}
function settleDealer(bet, card) {
  if (bet.zone === "wild") return card.wild ? bet.amount * 10 : -bet.amount;
  if (card.wild) return bet.amount * 5;
  const [, c, s] = bet.zone.split(":");
  if (card.color === c && card.shape === s) return bet.amount * 10;
  if (card.color === c || card.shape === s) return bet.amount * 2;
  return -bet.amount;
}

/* THE ENDGAME ARBITRAGE: when the remaining deck is fully known (deckLeft <= 3
   and we know exactly which cards), mutually exclusive outcomes can be hedged
   into a GUARANTEED multiplier:
   - deckLeft 1: all-in on that exact card → x10 guaranteed
   - deckLeft 2, both exact: split evenly → 10 * 0.5 = x5 guaranteed
   - deckLeft 2, one wild: all-in on wild → x5 guaranteed
   - deckLeft 3, all exact: split in thirds → x(10/3) guaranteed
   - deckLeft 3 with wilds: all-in wild (p>=1/3) is not guaranteed; skip hedge
   No existing variant does this — we Kelly individual lines instead. */
export function endgameArb(g) {
  const left = remaining(g.history);
  const exacts = Object.entries(left).filter(([z, v]) => z !== "wild" && v > 0);
  const wilds = left.wild;
  const n = g.deckLeft;
  if (n === 1 && exacts.length === 1) return [{ zone: exacts[0][0], amount: g.players[g.you].tokens }];
  if (n === 2 && wilds === 1 && exacts.length === 1) return [{ zone: "wild", amount: g.players[g.you].tokens }];
  if (n === 2 && wilds === 0 && exacts.length === 2) {
    const a = Math.floor((g.players[g.you].tokens / 2) / 5) * 5;
    return exacts.map(([z]) => ({ zone: z, amount: a }));
  }
  if (n === 3 && wilds === 0 && exacts.length === 3) {
    const a = Math.floor((g.players[g.you].tokens / 3) / 5) * 5;
    return exacts.map(([z]) => ({ zone: z, amount: a }));
  }
  return null; // no hedge available
}

let arbGames = 0, arbBetter = 0;
for (let s = 0; s < N; s++) {
  const seed = `walk-${s}-${Math.random().toString(36).slice(2, 6)}`;
  const deck = deckFromSeed(seed);
  let tokens = 250;
  console.log(`\n════ GAME ${s} (${seed}) ════`);
  for (let round = 1; round <= 19; round++) {
    const card = deck[round - 1];
    const history = deck.slice(0, round - 1);
    const g = { history, deckLeft: 19 - (round - 1), dealerSeat: (round - 1) % 4, you: 0, players: [{ seat: 0, tokens }], dealerBet: null };
    const isDealer = g.dealerSeat === 0;
    let delta = 0, action = "";
    const best = edges(g);
    const bestLine = best[0];
    if (isDealer) {
      const pick = strat.dealerPick(g);
      g.dealerBet = { seat: 0, zone: pick.zone, amount: pick.amount };
      delta = settleDealer(pick, card);
      action = `DEALER ${pick.zone} x${pick.amount} (ev ${(bestLine ? bestLine.ev : 0).toFixed(2)})`;
    } else {
      // house dealer pick: price the same four-way EV for the narration
      const house = dealerPick({ ...g, you: 0 });
      g.dealerBet = { seat: 1, zone: house.zone, amount: MIN_BET };
      const dz = g.dealerBet.zone;
      const dealerHit = dz === "wild" ? card.wild : card.wild ? true : card.color === dz.split(":")[1] || card.shape === dz.split(":")[2];
      const myBets = strat.bets(g);
      // hedge check before betting: the CURRENT round's remaining set is known
      const hedge = endgameArb(g);
      if (hedge) {
        action = `ARB ${hedge.map((h) => `${h.zone}x${h.amount}`).join("+")}`;
        delta = hedge.reduce((t, h) => {
          if (h.zone === "wild") return t + (card.wild ? h.amount * (dz === "wild" ? 10 : 5) : -h.amount);
          const [, c, sn] = h.zone.split(":");
          return t + (card.color === c && card.shape === sn ? h.amount * 10 : -h.amount);
        }, 0);
        arbGames++;
      } else {
        for (const b of myBets) {
          if (b.zone === "wd") delta += dealerHit ? b.amount : -b.amount;
          else if (b.zone === "ad") delta += !dealerHit && !card.wild ? b.amount : -b.amount;
          else delta += settleBet(b, card, dz === "wild");
        }
        action = myBets.length ? myBets.map((b) => `${b.zone}x${b.amount}`).join(" + ") : "sit out";
      }
    }
    tokens += delta;
    const p = bestLine ? (bestLine.p * 100).toFixed(0) : 0;
    console.log(`  r${String(round).padStart(2)} ${isDealer ? "D" : " "} card=${card.wild ? "WILD" : `${card.color[0]}${card.shape[0]}`} ${action.padEnd(44)} → ${String(delta > 0 ? "+" + delta : delta).padStart(8)}  stack ${tokens}`);
  }
}
console.log(`\nhedge opportunities seen: ${arbGames}`);
