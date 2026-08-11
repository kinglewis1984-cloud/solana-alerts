"""
One-time helper: registers (or updates) a Helius enhanced webhook that watches
the wallets in wallets.txt and POSTs matching transactions to the deployed
Vercel whale-webhook endpoint.

Run manually after deploying to Vercel:
    python register_helius_webhook.py

Requires in .env (see .env.example):
    HELIUS_API_KEY
    WEBHOOK_URL              e.g. https://your-project.vercel.app/api/whale-webhook
    HELIUS_WEBHOOK_SECRET    shared secret, must match Vercel env var of the same name
"""
import os
import sys

import requests
from dotenv import load_dotenv

load_dotenv()

HELIUS_API_KEY = os.environ.get("HELIUS_API_KEY", "")
WEBHOOK_URL = os.environ.get("WEBHOOK_URL", "")
WEBHOOK_SECRET = os.environ.get("HELIUS_WEBHOOK_SECRET", "")

WALLETS_FILE = os.path.join(os.path.dirname(__file__), "..", "wallets.txt")


def load_wallets():
    wallets = []
    with open(WALLETS_FILE) as f:
        for line in f:
            line = line.split("#", 1)[0].strip()
            if line:
                wallets.append(line)
    return wallets


def main():
    if not HELIUS_API_KEY or not WEBHOOK_URL:
        sys.exit("Set HELIUS_API_KEY and WEBHOOK_URL in .env first.")

    wallets = load_wallets()
    if not wallets:
        sys.exit(f"No wallet addresses found in {WALLETS_FILE}")

    payload = {
        "webhookURL": WEBHOOK_URL,
        "transactionTypes": ["TRANSFER"],
        "accountAddresses": wallets,
        "webhookType": "enhanced",
        "authHeader": WEBHOOK_SECRET,
        "txnStatus": "success",
    }

    resp = requests.post(
        f"https://api.helius.xyz/v0/webhooks?api-key={HELIUS_API_KEY}",
        json=payload,
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    print("Webhook registered:")
    print(f"  id: {data.get('webhookID')}")
    print(f"  watching {len(wallets)} wallet(s)")
    print("Save the webhookID above if you need to update it later via PUT "
          "https://api.helius.xyz/v0/webhooks/<id>")


if __name__ == "__main__":
    main()
