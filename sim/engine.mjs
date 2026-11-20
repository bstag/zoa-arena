/* Shared game primitives: the documented provably-fair shuffle and payout
   settlement, used by the simulator, the walkthrough, and any analysis tool. */
import { createHash } from "node:crypto";

export const COLORS = ["blue", "green", "yellow", "red"];
export const SHAPES = ["lion", "man", "ox", "eagle"];

/** the site's documented shuffle: color-major deck + 3 wilds appended,
    Fisher–Yates keyed by sha256(`${seed}:${i}`), i = 18..1, first 6 bytes BE.
    Verified card-for-card against a real settled replay (match 750). */
export function deckFromSeed(seed) {
  const d = [];
  for (const c of COLORS) for (const s of SHAPES) d.push({ color: c, shape: s, wild: false });
  d.push({ wild: true }, { wild: true }, { wild: true });
  for (let i = d.length - 1; i > 0; i--) {
    const j = createHash("sha256").update(`${seed}:${i}`).digest().readUIntBE(0, 6) % (i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

export const commitFor = (gameId, seed) => createHash("sha256").update(`${gameId}:${seed}`).digest("hex");

/** net chip delta of one player bet against a known card */
export function settleBet(bet, card, dealerCalledWild) {
  if (card.wild) return bet.zone === "wild" ? bet.amount * (dealerCalledWild ? 10 : 5) : -bet.amount;
  if (bet.zone === "wild") return -bet.amount;
  if (bet.zone.startsWith("x:")) {
    const [, c, s] = bet.zone.split(":");
    return card.color === c && card.shape === s ? bet.amount * 10 : -bet.amount;
  }
  if (bet.zone.startsWith("c:")) return card.color === bet.zone.slice(2) ? bet.amount * 2 : -bet.amount;
  if (bet.zone.startsWith("s:")) return card.shape === bet.zone.slice(2) ? bet.amount * 2 : -bet.amount;
  return -bet.amount;
}

/** net chip delta of the dealer's mandatory pick against a known card */
export function settleDealer(bet, card) {
  if (bet.zone === "wild") return card.wild ? bet.amount * 10 : -bet.amount;
  if (card.wild) return bet.amount * 5;
  const [, c, s] = bet.zone.split(":");
  if (card.color === c && card.shape === s) return bet.amount * 10;
  if (card.color === c || card.shape === s) return bet.amount * 2;
  return -bet.amount;
}
