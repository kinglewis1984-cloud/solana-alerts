// Receives Helius "enhanced" webhook POSTs for tracked whale/exchange wallets
// and forwards large SOL transfers to Telegram. Deployed as a Vercel serverless
// function (free tier) — no always-on server required.

const LAMPORTS_PER_SOL = 1_000_000_000;

function walletLabel(address) {
  const labels = {
    "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM": "Binance hot wallet",
    "2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm": "Coinbase Commerce",
  };
  return labels[address] || `${address.slice(0, 4)}...${address.slice(-4)}`;
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
  }

  res.status(200).json({ ok: true });
};
