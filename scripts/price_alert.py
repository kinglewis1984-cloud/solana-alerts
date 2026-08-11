"""
Checks SOL/BTC/ETH price against the last-seen price (state/price_state.json)
and sends a Telegram alert on a big move. Run on a schedule by
.github/workflows/price-alerts.yml — the workflow commits the updated state
file back to the repo, so no external database is needed.
"""
import json
import os
from pathlib import Path

import requests

COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price"
COINS = {"solana": "SOL", "bitcoin": "BTC", "ethereum": "ETH"}
MOVE_THRESHOLD_PCT = float(os.environ.get("PRICE_MOVE_THRESHOLD_PCT", "3"))

STATE_FILE = Path(__file__).resolve().parent.parent / "state" / "price_state.json"

TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TELEGRAM_CHAT_ID = os.environ["TELEGRAM_CHAT_ID"]


def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {}


def save_state(state):
    STATE_FILE.write_text(json.dumps(state, indent=2))


def fetch_prices():
    resp = requests.get(
        COINGECKO_URL,
        params={"ids": ",".join(COINS), "vs_currencies": "usd"},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


def send_telegram(text):
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    resp = requests.post(
        url,
        json={"chat_id": TELEGRAM_CHAT_ID, "text": text, "parse_mode": "Markdown"},
        timeout=15,
    )
    resp.raise_for_status()


def main():
    state = load_state()
    prices = fetch_prices()

    for coin_id, symbol in COINS.items():
        price = prices.get(coin_id, {}).get("usd")
        if price is None:
            continue

        last_price = state.get(coin_id, {}).get("price")
        if last_price:
            change_pct = (price - last_price) / last_price * 100
            if abs(change_pct) >= MOVE_THRESHOLD_PCT:
                direction = "up" if change_pct > 0 else "down"
                arrow = "🟢" if change_pct > 0 else "🔴"
                send_telegram(
                    f"{arrow} *{symbol}* moved {direction} {abs(change_pct):.1f}%\n"
                    f"${last_price:,.2f} → ${price:,.2f}"
                )
                state[coin_id] = {"price": price}
        else:
            state[coin_id] = {"price": price}

    save_state(state)


if __name__ == "__main__":
    main()
