# SolanaAlerts

Whale-transfer + price move alerts to Telegram. $0 to run: free Helius RPC/webhooks,
free Vercel hosting, free GitHub Actions cron. No on-chain deployment, no server to keep on.

## How it works

- **Whale alerts** (`api/whale-webhook.js`): Helius watches the wallets in `wallets.txt`
  and pushes matching transfers to this Vercel function in real time. No polling.
- **Price alerts** (`scripts/price_alert.py`): GitHub Actions runs this every 15 min,
  compares SOL/BTC/ETH price to the last alert baseline (`state/price_state.json`),
  and pushes a Telegram message on a >3% move. The workflow commits the updated
  state file back to the repo — no external database.

## Setup

### 1. Deploy the webhook receiver to Vercel

```sh
npm i -g vercel      # if not already installed
cd SolanaAlerts
vercel --prod
```

In the Vercel project dashboard, add these environment variables (Settings → Environment Variables):

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `HELIUS_WEBHOOK_SECRET` — any random string you make up
- `WHALE_THRESHOLD_SOL` — default 500

Note the deployed URL, e.g. `https://solana-alerts.vercel.app`.

### 2. Register the Helius webhook

```sh
cp .env.example .env
# fill in HELIUS_API_KEY, WEBHOOK_URL (https://<your-vercel-url>/api/whale-webhook),
# and HELIUS_WEBHOOK_SECRET (same value as step 1)
pip install -r scripts/requirements.txt
python scripts/register_helius_webhook.py
```

To add more watched wallets later, edit `wallets.txt` and re-run this script — it
overwrites the existing webhook's address list.

### 3. Push to GitHub and enable the price-alert cron

Push this repo to GitHub, then in the repo's Settings → Secrets and variables → Actions, add:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

The `price-alerts.yml` workflow runs automatically every 15 minutes once the repo is on GitHub
with Actions enabled — no further setup needed.

## Notes

- `wallets.txt` ships with 2 verified addresses (Binance hot wallet, Coinbase Commerce).
  Add more from [Solscan](https://solscan.io) (Top Accounts) or a labeled-wallet source like Arkham —
  don't guess addresses, a wrong one just fails silently.
- Helius free tier: 100k credits/month, plenty for a handful of watched wallets.
- Vercel free (Hobby) tier: serverless functions are effectively free at this volume;
  no cron used on Vercel (Hobby cron is capped at once/day, too slow for price checks —
  that's why price alerts run on GitHub Actions instead).
