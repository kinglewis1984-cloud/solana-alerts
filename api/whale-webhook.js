// Receives Helius "enhanced" webhook POSTs for tracked whale/exchange wallets
// and forwards large SOL transfers to Telegram. Deployed as a Vercel serverless
// function (free tier) — no always-on server required.

const LAMPORTS_PER_SOL = 1_000_000_000;

const LABELS = {
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM": "Binance hot wallet",
  "2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm": "Coinbase Commerce",
  // PENGU token accounts (see wallets.txt)
  "FJhg2bE1PZEedxpqpXZpJKCfF2m9Z6n9MtLSe2zNo4XY": "PENGU: Fireblocks custody",
  "9L8T8MhH4jDafq5qSKHshaVfGoySoSDTbsDU2Jc6a16T": "PENGU: Token deployer",
  "4fh9vfdCCqBWqcCKhYzBSuHzxkiAPCorMshLUuvmiqqT": "PENGU: whale #4",
  "5e2faSYutRBmAk2rEVSPaDBJUYvEosa27azuuyVVHR1t": "PENGU: whale #6",
  "4vCmteVuPA4qnxMKxT2rhMje1yxEkLvP8DK4cEZ1YucN": "PENGU: whale #25",
  "7ooJxKNAaSztQBBdeoiNmhs5pifwPjicqC8iVbaK4Uoa": "PENGU: whale #27",
  "87qW4qsZsTabK7c5ShDArdYruKBSDRdSFD3Yy4Hjeim4": "PENGU: whale #28",
  "93odVNBUZpe765cesNH98w8zz1bMcF1phDkMrWW385T4": "PENGU: Upbit hot wallet",
  "2WGHSZKsZYfv66PRZTZjrfeSN5vZZNsggvhCRg1Zcvat": "PENGU: Bithumb hot wallet",
  "2X5Bf1SXvgnec7KSQw8oyxgMhBjZ99q9h3ZZVKx8EZ2E": "PENGU: Bybit wallet",
};

// SPL tokens we alert on: mint -> symbol + default minimum size
// (override per token with env WHALE_THRESHOLD_<SYMBOL>).
const TOKENS = {
  "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv": { symbol: "PENGU", min: 1_000_000 }, // ~$10k
};

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

      // Prefer the tracked token-account label; fall back to the owner wallet.
      const from = LABELS[t.fromTokenAccount] ? t.fromTokenAccount : t.fromUserAccount;
      const to = LABELS[t.toTokenAccount] ? t.toTokenAccount : t.toUserAccount;
      const text =
        `🐧 *${tok.symbol} whale transfer*\n` +
        `${t.tokenAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${tok.symbol}\n` +
        `From: ${walletLabel(from || "unknown")}\n` +
        `To: ${walletLabel(to || "unknown")}\n` +
        `[View tx](https://solscan.io/tx/${event.signature})`;

      await sendTelegram(text);
    }
  }

  res.status(200).json({ ok: true });
};
