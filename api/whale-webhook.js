// Receives Helius "enhanced" webhook POSTs for tracked whale/exchange wallets
// and forwards large SOL transfers to Telegram. Deployed as a Vercel serverless
// function (free tier) — no always-on server required.

const LAMPORTS_PER_SOL = 1_000_000_000;

const LABELS = {
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM": "Binance hot wallet",
  "2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm": "Coinbase Commerce",
  // -- Smart-money wallets (owner addresses, from SolanaSmartMoney/smart_wallets.json) --
  // Live single-wallet buy/sell alerts (see SMART_WALLETS below); this list must be re-synced
  // whenever find_wallets.py adds/drops a wallet (runs Wed+Sat) - see project_solana_smart_money memory.
  "4dKQhjKfrnfQib2GXrekdUMXvusD2AeaAUjjyLRRLJbz": "Smart #4dKQ",
  "FeH2WVeHbjPVP9tM1owxx1ih61Ze6so3yFUdKu43s5Yi": "Smart #FeH2",
  "6MxHjMmvAHvgo1fiqjGZ7vGo1ogruPntRHiM8sSuidaG": "Smart #6Mxh",
  "96r6A6yoi8jzHzYjtAenPQoCfAxrRS8VsQiqvARVadPi": "Smart #96r6",

  // -- PENGU token accounts: STOPPED 2026-09-27 at user's request (kept commented as a reusable template -
  //    label = holder rank as of 2026-09-26; EX = exchange; see project_pengu_holders memory for how this was built) --
  // "FJhg2bE1PZEedxpqpXZpJKCfF2m9Z6n9MtLSe2zNo4XY": "#1 Fireblocks",
  // "9L8T8MhH4jDafq5qSKHshaVfGoySoSDTbsDU2Jc6a16T": "#2 Deployer",
  // "4fh9vfdCCqBWqcCKhYzBSuHzxkiAPCorMshLUuvmiqqT": "#4 Whale",
  // "5e2faSYutRBmAk2rEVSPaDBJUYvEosa27azuuyVVHR1t": "#6 Whale",
  // "4vCmteVuPA4qnxMKxT2rhMje1yxEkLvP8DK4cEZ1YucN": "#25 Whale",
  // "7ooJxKNAaSztQBBdeoiNmhs5pifwPjicqC8iVbaK4Uoa": "#27 Whale",
  // "87qW4qsZsTabK7c5ShDArdYruKBSDRdSFD3Yy4Hjeim4": "#28 Whale",
  // "93odVNBUZpe765cesNH98w8zz1bMcF1phDkMrWW385T4": "EX #5 Upbit",
  // "2WGHSZKsZYfv66PRZTZjrfeSN5vZZNsggvhCRg1Zcvat": "EX #9 Bithumb",
  // "2X5Bf1SXvgnec7KSQw8oyxgMhBjZ99q9h3ZZVKx8EZ2E": "EX #10 Bybit",
};

// Live single-wallet alert: fires on ANY buy/sell by one of these (unlike TOKENS below, which is one specific
// mint watched across any wallet). Owner wallets, not token accounts - these trade many different low-caps.
const SMART_WALLETS = new Set([
  "4dKQhjKfrnfQib2GXrekdUMXvusD2AeaAUjjyLRRLJbz",
  "FeH2WVeHbjPVP9tM1owxx1ih61Ze6so3yFUdKu43s5Yi",
  "6MxHjMmvAHvgo1fiqjGZ7vGo1ogruPntRHiM8sSuidaG",
  "96r6A6yoi8jzHzYjtAenPQoCfAxrRS8VsQiqvARVadPi",
]);

// SPL tokens we alert on: mint -> symbol + default minimum size
// (override per token with env WHALE_THRESHOLD_<SYMBOL>). Reusable template for the next token - see how PENGU
// was set up in project_pengu_holders / project_solana_alerts memory. Empty while nothing is being tracked.
const TOKENS = {
  // "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv": { symbol: "PENGU", cg: "pudgy-penguins", min: 1_000_000 }, // ~$10k
};

// Tracked token accounts that belong to exchanges: on-chain we only see deposits/withdrawals, not their internal trades.
const EXCHANGES = new Set([
  // "93odVNBUZpe765cesNH98w8zz1bMcF1phDkMrWW385T4", // Upbit
  // "2WGHSZKsZYfv66PRZTZjrfeSN5vZZNsggvhCRg1Zcvat", // Bithumb
  // "2X5Bf1SXvgnec7KSQw8oyxgMhBjZ99q9h3ZZVKx8EZ2E", // Bybit
]);

const WSOL = "So11111111111111111111111111111111111111112";
const IGNORE_MINTS = new Set([
  WSOL,
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNyFbBQ7JFLZ8Vc7T",  // USDT
]);

function fmtUsd(n) {
  if (n == null) return "?";
  n = Number(n);
  return n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n).toLocaleString()}`;
}

// SOL <-> single-token net-flow parse for one wallet's own side of a swap (JS port of
// SolanaSmartMoney/scripts/common.py parse_swap - keep both in sync if the logic changes).
function parseWalletSwap(event, wallet) {
  let native = 0;
  for (const t of event.nativeTransfers || []) {
    if (t.toUserAccount === wallet) native += t.amount;
    if (t.fromUserAccount === wallet) native -= t.amount;
  }
  native /= LAMPORTS_PER_SOL;
  let wsol = 0;
  const net = {};
  for (const t of event.tokenTransfers || []) {
    const amt = t.tokenAmount || 0;
    const d = t.toUserAccount === wallet ? amt : t.fromUserAccount === wallet ? -amt : 0;
    if (!d) continue;
    if (t.mint === WSOL) wsol += d;
    else if (!IGNORE_MINTS.has(t.mint)) net[t.mint] = (net[t.mint] || 0) + d;
  }
  const sol = Math.abs(native) >= Math.abs(wsol) ? native : wsol;
  const moved = Object.entries(net).filter(([, v]) => Math.abs(v) > 1e-9);
  if (moved.length !== 1 || Math.abs(sol) < 0.001) return null;
  const [mint, delta] = moved[0];
  if (delta > 0 && sol < 0) return { side: "buy", mint, sol: -sol, amount: delta };
  if (delta < 0 && sol > 0) return { side: "sell", mint, sol, amount: -delta };
  return null;
}

// Best DexScreener pair for a mint, for a bit of context on the alert. Never blocks/fails the alert.
async function dexInfo(mint) {
  try {
    const r = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const pairs = await r.json();
    if (!Array.isArray(pairs) || !pairs.length) return null;
    return pairs.reduce((a, b) => (Number(b?.liquidity?.usd || 0) > Number(a?.liquidity?.usd || 0) ? b : a));
  } catch (e) {
    return null;
  }
}

// What did the tracked account do? `fromT`/`toT` = the tracked token account on that side of the transfer (if any).
function classify(eventType, fromT, toT) {
  if (fromT && toT) return "🔁 *TRANSFER* between tracked wallets";
  const acct = fromT || toT;
  const out = Boolean(fromT);
  if (EXCHANGES.has(acct)) {
    return out
      ? "📤 *WITHDRAWAL* from exchange (possible accumulation)"
      : "📥 *DEPOSIT* to exchange (possible sell pressure)";
  }
  if (eventType === "SWAP") return out ? "🔴 *SELL* (swap)" : "🟢 *BUY* (swap)";
  return out ? "➡️ *TRANSFER OUT* to another wallet" : "⬅️ *TRANSFER IN* from another wallet";
}

// Spot price in USD + GBP from CoinGecko (cached 60s per warm instance). Never blocks or fails an alert.
const priceCache = {};
async function fiatValue(tok, amount) {
  try {
    let c = priceCache[tok.cg];
    if (!c || Date.now() - c.at > 60_000) {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${tok.cg}&vs_currencies=usd,gbp`,
        { signal: AbortSignal.timeout(3000) }
      );
      const j = (await res.json())[tok.cg];
      if (!j || !(j.usd > 0) || !(j.gbp > 0)) return "";
      c = priceCache[tok.cg] = { usd: j.usd, gbp: j.gbp, at: Date.now() };
    }
    const f = (n) => Math.round(n).toLocaleString("en-US");
    return ` (~$${f(amount * c.usd)} / ~£${f(amount * c.gbp)})`;
  } catch (e) {
    return "";
  }
}

function walletLabel(address) {
  return LABELS[address] || `${address.slice(0, 4)}...${address.slice(-4)}`;
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
  if (!res.ok) {
    console.error("Telegram send failed:", await res.text());
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  // Helius sends the shared secret you set as the webhook's authHeader.
  const expected = process.env.HELIUS_WEBHOOK_SECRET;
  if (expected && req.headers["authorization"] !== expected) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const thresholdSol = Number(process.env.WHALE_THRESHOLD_SOL || "500");
  const events = Array.isArray(req.body) ? req.body : [req.body];

  for (const event of events) {
    // Live single-wallet smart-money alert: any SWAP by a tracked wallet, instantly (not the 30-min cluster scan).
    if (event?.type === "SWAP" && SMART_WALLETS.has(event.feePayer)) {
      const parsed = parseWalletSwap(event, event.feePayer);
      const minSol = Number(process.env.SMART_MONEY_MIN_SOL || "0.2");
      if (parsed && parsed.sol >= minSol) {
        const pair = await dexInfo(parsed.mint);
        const name = pair ? `${pair.baseToken?.name || "?"} ($${pair.baseToken?.symbol || "?"})` : "unknown token";
        const mcapLine = pair ? ` · MC ${fmtUsd(pair.marketCap || pair.fdv)} · Liq ${fmtUsd(pair.liquidity?.usd)}` : "";
        const text =
          `🧠 *Smart wallet ${parsed.side === "buy" ? "🟢 BUY" : "🔴 SELL"}* (instant, single wallet)
` +
          `${walletLabel(event.feePayer)}
` +
          `${name}${mcapLine}
` +
          `${parsed.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })} for ${parsed.sol.toFixed(2)} SOL
` +
          `CA: \`${parsed.mint}\`
` +
          `[Chart](https://dexscreener.com/solana/${parsed.mint}) · [Tx](https://solscan.io/tx/${event.signature})`;
        await sendTelegram(text);
      }
    }

    const transfers = event?.nativeTransfers || [];
    for (const t of transfers) {
      const sol = t.amount / LAMPORTS_PER_SOL;
      if (sol < thresholdSol) continue;

      const text =
        `🐋 *Whale transfer detected*\n` +
        `${sol.toLocaleString(undefined, { maximumFractionDigits: 2 })} SOL\n` +
        `From: ${walletLabel(t.fromUserAccount)}\n` +
        `To: ${walletLabel(t.toUserAccount)}\n` +
        `[View tx](https://solscan.io/tx/${event.signature})`;

      await sendTelegram(text);
    }

    for (const t of event?.tokenTransfers || []) {
      const tok = TOKENS[t.mint];
      if (!tok) continue;
      const min = Number(process.env[`WHALE_THRESHOLD_${tok.symbol}`] || tok.min);
      if (!(t.tokenAmount >= min)) continue;

      const fromT = LABELS[t.fromTokenAccount] ? t.fromTokenAccount : null;
      const toT = LABELS[t.toTokenAccount] ? t.toTokenAccount : null;
      if (!fromT && !toT) continue; // route hop that doesn't touch a tracked wallet

      // Prefer the tracked token-account label; fall back to the owner wallet.
      const from = fromT || t.fromUserAccount;
      const to = toT || t.toUserAccount;
      const text =
        `🐧 *${tok.symbol}* ${classify(event.type, fromT, toT)}
` +
        `${t.tokenAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${tok.symbol}${await fiatValue(tok, t.tokenAmount)}
` +
        `From: ${walletLabel(from || "unknown")}
` +
        `To: ${walletLabel(to || "unknown")}
` +
        `[View tx](https://solscan.io/tx/${event.signature})`;

      await sendTelegram(text);
    }
  }

  res.status(200).json({ ok: true });
};
