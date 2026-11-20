/* Blackstag strategy for The Intuition Game.
   Exact deck counting, rider-aware payouts, no negative-EV bets,
   multi-bet half-Kelly sizing, dealer-conditional wd/ad pricing.

   The game state `g` is the socket's game:state object (subset):
   { history: [{color,shape,wild}...], deckLeft, dealerBet: {zone,amount}|null,
     you, players: [{tokens}...] } */
export const COLORS = ["blue", "green", "yellow", "red"];
export const SHAPES = ["lion", "man", "ox", "eagle"];
export const MIN_BET = 5;

/** cards still in the deck, keyed like the zones the server accepts */
export function remaining(history) {
  const left = {};
  for (const c of COLORS) for (const s of SHAPES) left[`x:${c}:${s}`] = 1;
  left.wild = 3;
  for (const c of history) left[c.wild ? "wild" : `x:${c.color}:${c.shape}`] -= 1;
  return left;
}

/** probability the NEXT card lands in each zone */
export function probabilities(g) {
  const left = remaining(g.history);
  const n = Math.max(1, g.deckLeft);
  const p = {};
  for (const [k, v] of Object.entries(left)) if (k !== "wild") p[k] = v / n;
  p.wild = left.wild / n;
  for (const c of COLORS) p[`c:${c}`] = SHAPES.reduce((t, s) => t + left[`x:${c}:${s}`], 0) / n;
  for (const s of SHAPES) p[`s:${s}`] = COLORS.reduce((t, c) => t + left[`x:${c}:${s}`], 0) / n;
  return p;
}

/** payout multiple (profit per 1 risked) for a zone, ignoring the wild rider */
export const payout = (zone) => (zone === "wild" ? 5 : zone.startsWith("x:") ? 10 : zone === "wd" || zone === "ad" ? 1 : 2);

/** rider-adjusted payout: when the dealer called the wild spot, wild bets pay 10x */
export function payoutFor(zone, g) {
  if (zone === "wild" && g.dealerBet?.zone === "wild") return 10;
  return payout(zone);
}

/** P(dealer got colour OR character right) and P(dealer got both wrong, no wild) */
export function dealerSplit(g) {
  const left = remaining(g.history);
  const n = Math.max(1, g.deckLeft);
  const zone = g.dealerBet?.zone;
  if (!zone || zone === "wild") return { wd: 1 - left.wild / n, ad: 0 };
  const [, c, s] = zone.split(":");
  const sameColor = SHAPES.reduce((t, ss) => t + left[`x:${c}:${ss}`], 0);
  const sameShape = COLORS.reduce((t, cc) => t + left[`x:${cc}:${s}`], 0);
  const both = Math.max(0, left[`x:${c}:${s}`]);
  const pBothRight = Math.min(1, (sameColor + sameShape - both) / n);
  const pWild = left.wild / n;
  return { wd: Math.min(1, pBothRight + pWild), ad: Math.max(0, 1 - pBothRight - pWild) };
}

/** expected value per 1 risked, sorted best first */
export function edges(g) {
  const p = probabilities(g);
  const { wd, ad } = dealerSplit(g);
  p.wd = wd; p.ad = ad;
  const out = [];
  for (const [zone, prob] of Object.entries(p)) {
    if (prob <= 0) continue;
    const b = payoutFor(zone, g);
    out.push({ zone, p: prob, ev: prob * b - (1 - prob) });
  }
  return out.sort((a, b) => b.ev - a.ev);
}

/** half-Kelly stake: f* = ev/b, halved. Certainty bets everything; no edge, no bet. */
export function stake(ev, p, tokens) {
  if (tokens < MIN_BET) return 0;
  if (p >= 1) return tokens;
  if (ev <= 0.02) return 0;
  const b = Math.max(1, (ev + (1 - p)) / (p || 1e-9));
  const f = Math.min(0.30, Math.max(0.05, (ev / b) * 0.5));
  return Math.max(MIN_BET, Math.min(tokens, Math.round((tokens * f) / 5) * 5));
}

/** the dealer's one mandatory pick: exact card (wins four ways) or the wild spot */
export function dealerPick(g) {
  const left = remaining(g.history);
  const me = g.players[g.you];
  const n = Math.max(1, g.deckLeft);
  let best = { zone: "wild", ev: (left.wild / n) * 10 - (1 - left.wild / n) };
  for (const [zone, v] of Object.entries(left)) {
    if (zone === "wild" || v <= 0) continue;
    const [, c, s] = zone.split(":");
    const sameColor = SHAPES.reduce((t, ss) => t + (ss === s ? 0 : left[`x:${c}:${ss}`]), 0);
    const sameShape = COLORS.reduce((t, cc) => t + (cc === c ? 0 : left[`x:${cc}:${s}`]), 0);
    const pExact = v / n, pColor = sameColor / n, pShape = sameShape / n, pWild = left.wild / n;
    const ev = pExact * 10 + pColor * 2 + pShape * 2 + pWild * 5 - (1 - pExact - pColor - pShape - pWild);
    if (ev > best.ev) best = { zone, ev };
  }
  const p = best.zone === "wild" ? left.wild / n : 1 / n;
  const amount = best.ev > 0.02 ? stake(best.ev, p, me.tokens) : MIN_BET;
  return { zone: best.zone, amount: Math.max(MIN_BET, amount) };
}

/** your bets for the round: up to three independent positive-EV lines,
    half-Kelly sized, total exposure capped at half the stack */
export function bets(g) {
  const me = g.players[g.you];
  const lines = edges(g).filter((e) => stake(e.ev, e.p, me.tokens) >= MIN_BET).slice(0, 3);
  let budget = Math.floor(me.tokens / 2);
  const out = [];
  for (const line of lines) {
    let amount = stake(line.ev, line.p, me.tokens);
    if (line.p >= 1) { out.length = 0; out.push({ zone: line.zone, amount: me.tokens }); break; }
    amount = Math.min(amount, Math.max(0, budget));
    if (amount < MIN_BET) continue;
    budget -= amount;
    out.push({ zone: line.zone, amount });
    if (budget < MIN_BET) break;
  }
  return out;
}
