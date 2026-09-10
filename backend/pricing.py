"""FR-18: what a call cost, from the provider that charged for it.

There are three ways to put a dollar figure on a generation, and two of them are
traps.

**A hardcoded rate table** is the obvious one, and it is the worst. OpenRouter
changes prices, adds models, and retires them; a table in this repository is
correct on the day it is written and silently wrong forever after. Nothing
fails, no test goes red — the cost page just quietly reports numbers that are
not true, which is worse than reporting nothing, because a number is believed.

**Computing at read time from a live price list** keeps the rates current but
retroactively rewrites history: last month's spend changes when a model's price
does. For a contract deliverable that reports usage, a figure that moves after
the fact is indefensible.

So: **the price in force at the moment of the call is snapshotted onto the usage
row**, taken from OpenRouter's own `/models` payload, and the cost is computed
from that snapshot. `model_usage` stores `tokens_in`, `tokens_out`, the two unit
prices, and the product. If the price was not known when the call happened, the
cost column is null and every surface says "pricing unavailable" rather than
showing a zero — a zero is a lie that looks like a fact.

**The cache never blocks a generation.** A cold cache means the first few calls
record tokens with a null cost while a background refresh runs; it does not mean
those calls wait on an HTTP round-trip to OpenRouter. Metering is bookkeeping,
and bookkeeping does not get to add latency to the thing the user is waiting
for. The tokens are always recorded, so a later reconciliation against
OpenRouter's own dashboard is always possible.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

MODELS_URL = "https://openrouter.ai/api/v1/models"

#: Prices move rarely. An hour is short enough that a new model is priced
#: within one, and long enough that we are not polling a public API pointlessly.
_TTL_SECONDS = 3600.0
_FETCH_TIMEOUT = 10.0


@dataclass(frozen=True)
class ModelPrice:
    """USD per single token, as OpenRouter quotes it."""

    prompt: float
    completion: float

    def cost(self, tokens_in: int, tokens_out: int) -> float:
        return tokens_in * self.prompt + tokens_out * self.completion


class PricingCache:
    """Process-local, TTL'd, refreshed off the request path."""

    def __init__(self) -> None:
        self._prices: dict[str, ModelPrice] = {}
        self._fetched_at: float = 0.0
        self._refreshing: asyncio.Task | None = None

    # -- reads -------------------------------------------------------------

    def get(self, model: str) -> ModelPrice | None:
        """The cached price, or None. Never fetches; never blocks."""
        if not model:
            return None
        price = self._prices.get(model)
        if price is not None:
            return price
        # OpenRouter accepts suffixed variants (`:free`, `:nitro`, `:floor`)
        # that are billed as the base model. Matching the base rather than
        # returning None is the difference between a priced row and a blank one.
        base = model.split(":", 1)[0]
        return self._prices.get(base)

    @property
    def is_fresh(self) -> bool:
        return bool(self._prices) and (time.monotonic() - self._fetched_at) < _TTL_SECONDS

    @property
    def size(self) -> int:
        return len(self._prices)

    # -- writes ------------------------------------------------------------

    def prime(self, prices: dict[str, ModelPrice]) -> None:
        """Install a price map directly. Used by the refresher and by tests."""
        self._prices = prices
        self._fetched_at = time.monotonic()

    def ensure_fresh(self) -> None:
        """Kick off a refresh if the cache is stale. Returns immediately.

        Fire-and-forget on purpose — see the module docstring. The task
        reference is held so it is not garbage collected mid-flight, which is
        the classic way a detached asyncio task disappears without running.
        """
        if self.is_fresh:
            return
        if self._refreshing is not None and not self._refreshing.done():
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return  # No loop (sync context, or a test): nothing to schedule.
        self._refreshing = loop.create_task(self._refresh())

    async def _refresh(self) -> None:
        try:
            prices = await fetch_prices()
        except Exception as exc:
            # Deliberately swallowed. A pricing outage must degrade the cost
            # column to null, never fail a user's generation.
            logger.warning("pricing_refresh_failed", extra={"error": str(exc)})
            # Back off by pretending we just fetched, so a persistent outage
            # does not mean a new HTTP attempt on every single LLM call.
            self._fetched_at = time.monotonic()
            return
        if prices:
            self.prime(prices)
            logger.info("pricing_refreshed", extra={"models_priced": len(prices)})

    def reset(self) -> None:
        self._prices = {}
        self._fetched_at = 0.0
        self._refreshing = None


_cache = PricingCache()


def pricing_cache() -> PricingCache:
    return _cache


async def fetch_prices(timeout: float = _FETCH_TIMEOUT) -> dict[str, ModelPrice]:
    """Read the model list and keep only what it says about money."""
    headers = {"Content-Type": "application/json", "X-Title": "PromptMaster Engine"}
    key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if key:
        headers["Authorization"] = f"Bearer {key}"

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.get(MODELS_URL, headers=headers)
        response.raise_for_status()
        payload = response.json()

    return parse_prices(payload)


def parse_prices(payload: object) -> dict[str, ModelPrice]:
    """Extract `{model_id: ModelPrice}` from an OpenRouter `/models` body.

    Split out from the fetch so the parsing is testable without a network call,
    which is the rule the rest of this suite follows.
    """
    if not isinstance(payload, dict):
        return {}
    data = payload.get("data")
    if not isinstance(data, list):
        return {}

    prices: dict[str, ModelPrice] = {}
    for item in data:
        if not isinstance(item, dict):
            continue
        model_id = item.get("id")
        if not isinstance(model_id, str) or not model_id.strip():
            continue
        pricing = item.get("pricing")
        if not isinstance(pricing, dict):
            continue
        prompt = _as_price(pricing.get("prompt"))
        completion = _as_price(pricing.get("completion"))
        if prompt is None or completion is None:
            continue
        prices[model_id.strip()] = ModelPrice(prompt=prompt, completion=completion)
    return prices


def _as_price(raw: object) -> float | None:
    """OpenRouter quotes prices as decimal *strings*, e.g. `"0.0000025"`.

    A free model is the literal string `"0"`, which is a real price of zero and
    must survive as 0.0 — not be discarded as falsy. Anything unparseable
    returns None, which propagates to a null cost rather than to a wrong one.
    """
    if isinstance(raw, (int, float)):
        value = float(raw)
    elif isinstance(raw, str) and raw.strip():
        try:
            value = float(raw.strip())
        except ValueError:
            return None
    else:
        return None
    return value if value >= 0 else None
