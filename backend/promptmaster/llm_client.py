"""OpenRouter LLM client for PromptMaster Engine."""

import asyncio
import contextvars
import os
import json
import logging
import time
import httpx
from typing import Any

logger = logging.getLogger(__name__)

# Must stay under the serverless function limit. Vercel's default is 60s, so a
# 120s client timeout (the previous default) could never fire before the
# platform killed the request — the caller just saw an opaque 504.
DEFAULT_TIMEOUT = 55.0
_RETRY_MAX_ATTEMPTS = 3
_RETRY_BASE_DELAY = 1.5
_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


#: Whether the call being made is a JSON repair pass. Set around the repair in
#: `generate_json`, read by `_meter` (E1, 6 Oct: repair work is measured).
_REPAIRING: contextvars.ContextVar[bool] = contextvars.ContextVar("pm_repairing", default=False)

#: The sources a web-search call returned (OpenRouter's `url_citation`
#: annotations). Set by the request, read by `generate_with_web` (20 Oct).
WEB_ANNOTATIONS: contextvars.ContextVar[list[dict[str, Any]] | None] = contextvars.ContextVar("pm_web_annotations", default=None)


def _meter(
    *,
    model: str,
    tokens_in: int,
    tokens_out: int,
    elapsed: float,
    finish_reason: str,
    attempt: int = 1,
    provider_cost: float | None = None,
) -> None:
    """FR-18/FR-19: record one provider call, both to the log and to the meter.

    This is the only place in the codebase that observes a completed LLM call
    with its token counts, which is why metering hangs off it rather than off
    each of the seven routers. Every path — `generate`, `generate_with_meta`,
    `generate_json` and its repair pass, every retry attempt — funnels through
    `_single_request`, so nothing can spend money without being counted. A
    router-level hook would have missed the repair call, which is precisely the
    call that costs money when things are going badly.

    Wholly best-effort. Metering that can raise is metering that can lose a
    generation the user has already paid for, so every failure here is
    swallowed after being logged. The token counts still reached the caller.
    """
    line_extra = {
        "event": "llm_call",
        "model": model,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "duration_ms": int(elapsed * 1000),
        "finish_reason": finish_reason,
        "attempt": "repair" if _REPAIRING.get() else "retry" if attempt > 1 else "first",
        "thinking": _thinking(),
    }

    try:
        from observability import UsageEvent, current_usage
        from pricing import pricing_cache

        cache = pricing_cache()
        price = cache.get(model)
        # Warm the cache for the *next* call, never for this one.
        cache.ensure_fresh()

        # A web search is billed per search as well as per token; the
        # provider's own total covers both (20 Oct). Otherwise, from tokens.
        cost = provider_cost if provider_cost is not None else price.cost(tokens_in, tokens_out) if price else None
        if cost is not None:
            line_extra["cost_usd"] = round(cost, 8)

        accumulator = current_usage()
        if accumulator is not None:
            accumulator.add(
                UsageEvent(
                    model=model,
                    tokens_in=tokens_in,
                    tokens_out=tokens_out,
                    elapsed_ms=int(elapsed * 1000),
                    cost_usd=cost,
                    prompt_price_usd=price.prompt if price else None,
                    completion_price_usd=price.completion if price else None,
                    attempt=line_extra["attempt"],
                )
            )
    except Exception:  # pragma: no cover - defensive, see docstring
        logger.warning("metering_failed", exc_info=True)

    logger.info("llm_call", extra=line_extra)


class OpenRouterError(Exception):
    """Base error for OpenRouter API failures.

    Carries structure as well as a message. Until now this class was purely
    stringly-typed: `_is_retryable` substring-matched "429" against the message,
    which quietly also matches a model that happened to emit "429" in its prose,
    and gives a caller nothing to branch on when it needs to tell "you are out
    of credits" (never retry, tell the user) from "you are rate limited" (retry
    after N seconds). FR-16 needs that distinction to produce a recovery message
    rather than a stack trace.

    Every field is optional and the message is unchanged, so existing callers
    and tests that only read `str(e)` keep working.
    """

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        provider_code: str | None = None,
        retry_after: float | None = None,
    ):
        super().__init__(message)
        self.status_code = status_code
        self.provider_code = provider_code
        self.retry_after = retry_after


class OpenRouterDeadlineError(OpenRouterError):
    """Ran out of wall-clock budget before the request could be retried.

    Distinct from a plain timeout so callers (the job drain in particular) can
    re-queue the work instead of counting it as a failed attempt.
    """

    pass


def _provider_code(response: httpx.Response) -> str | None:
    """Pull OpenRouter's own error code out of the body, if it says one.

    OpenRouter wraps upstream failures as {"error": {"code": ..., "message": ...}}.
    The code is what distinguishes "context_length_exceeded" from a generic 400,
    and no amount of substring-matching the HTTP status recovers it.
    """
    try:
        body = response.json()
    except Exception:
        return None
    if not isinstance(body, dict):
        return None
    error = body.get("error")
    if not isinstance(error, dict):
        return None
    code = error.get("code")
    if code is None:
        # Some providers put the machine-readable name in `type` instead.
        code = error.get("type")
    return str(code) if code is not None else None


def _retry_after_seconds(response: httpx.Response) -> float | None:
    """Honour the provider's own Retry-After rather than guessing a backoff."""
    raw = response.headers.get("retry-after")
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        # The HTTP-date form is legal but rare here; a wrong guess is worse
        # than falling back to the standard ladder.
        return None


#: Room for a model that reasons before it answers, on top of the answer's own
#: budget. 18 Oct (same-model pilot): Claude Opus 5.5 reasons by default on
#: OpenRouter, the reasoning counted against Go's 900-token planner budget, and
#: the plan came back as cut-off JSON — every run on that model failed at its
#: first step.
REASONING_HEADROOM = 2048

#: Models that reason before answering on OpenRouter, so they get the headroom.
_REASONING_PREFIXES = ("anthropic/", "openai/gpt-5.6")

#: The model every project uses unless it picked another (18 Oct: GPT-5.4 retired).
DEFAULT_MODEL = "anthropic/claude-opus-5.5"

#: Models no longer used, and what a project still set to one runs on instead.
#: Mirrored in the frontend's `RETIRED_MODELS` (lib/constants.ts).
RETIRED_MODELS = {
    "openai/gpt-5.4": DEFAULT_MODEL,
    "anthropic/claude-sonnet-4": "anthropic/claude-sonnet-5.5",
}


def resolve_model(model: str) -> str:
    """The model a call runs on: a retired one is replaced, anything else is kept."""
    return RETIRED_MODELS.get(model, model)


#: An answer ceiling at or above this is a writing call (a stage draft, a
#: continuation, a full table), not a judgment.
LONG_ANSWER_TOKENS = 4096


#: Room for Deep's reasoning, on top of the answer's own budget. Opus 5.5
#: reasons adaptively: a 600-word memo at high effort used 555 reasoning
#: tokens against 71 at low (21 Oct probe), so this is generous, and an
#: unspent ceiling costs nothing.
DEEP_HEADROOM = 8192


def _thinking() -> str:
    from observability import thinking_var  # late, as `current_usage` below

    return thinking_var.get()


def _with_language(messages: list[dict[str, str]]) -> list[dict[str, str]]:
    """The project's output language, as the last word of the system message.

    Every call a request makes passes through here — the draft, its checks, the
    side chat, Go — so a Spanish project is answered in Spanish everywhere.
    A JSON repair is left alone: it only fixes syntax.
    """
    from observability import language_var  # late, as `_thinking` above

    from .language import language_directive

    directive = "" if _REPAIRING.get() else language_directive(language_var.get())
    if not directive:
        return messages
    if messages and messages[0]["role"] == "system":
        return [{"role": "system", "content": f"{messages[0]['content']}\n\n{directive}"}, *messages[1:]]
    return [{"role": "system", "content": directive}, *messages]


def _token_budget(model: str, max_tokens: int) -> dict[str, Any]:
    """The answer keeps `max_tokens`; a reasoning model's reasoning gets its own budget.

    A reasoning budget is a hint, not a cap: Opus 5.5 overran a 256-token one
    two-fold and a 2,048-token one by a fifth. On a 24,000-token merge prompt
    it spent the whole 14,048 and returned no text at all (19 Oct, FIELDGUIDE
    copy: "No content in response (finish_reason='length')"). Low effort is the
    setting it keeps to, so a writing call uses that and the answer gets the room.
    """
    if model.startswith(_REASONING_PREFIXES):
        if _thinking() == "deep":
            # Deep: the model decides how long to think, up to high effort,
            # and the answer still keeps its own full budget beside it.
            return {"max_tokens": max_tokens + DEEP_HEADROOM, "reasoning": {"effort": "high"}}
        if max_tokens >= LONG_ANSWER_TOKENS:
            return {"max_tokens": max_tokens + REASONING_HEADROOM, "reasoning": {"effort": "low"}}
        return {"max_tokens": max_tokens + REASONING_HEADROOM, "reasoning": {"max_tokens": REASONING_HEADROOM}}
    return {"max_tokens": max_tokens}


class OpenRouterClient:
    """Async client for the OpenRouter API.

    Features:
    - Configurable per-call timeout
    - Automatic retry (up to 3x) with exponential backoff on transient failures
    - JSON-repair pass on parse failure
    - Defensive content validation
    """

    BASE_URL = "https://openrouter.ai/api/v1/chat/completions"
    MODELS_URL = "https://openrouter.ai/api/v1/models"
    DEFAULT_MODEL = DEFAULT_MODEL

    def __init__(
        self,
        api_key: str | None = None,
        model: str = DEFAULT_MODEL,
        timeout: float = DEFAULT_TIMEOUT,
    ):
        self.api_key = api_key or os.getenv("OPENROUTER_API_KEY")
        if not self.api_key:
            raise ValueError(
                "OpenRouter API key required. Set OPENROUTER_API_KEY environment variable "
                "or pass api_key parameter."
            )
        self.model = model
        self.timeout = timeout
        # No client-level timeout: it would silently cap every per-call value.
        # Each request passes its own, defaulting to self.timeout.
        self._client = httpx.AsyncClient(timeout=None)

    async def generate(
        self,
        prompt: str,
        system: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 16384,
        json_mode: bool = False,
        model: str | None = None,
        timeout: float | None = None,
        deadline: float | None = None,
    ) -> tuple[str, dict[str, int]]:
        """Generate a response from the LLM with automatic retry.

        Returns:
            Tuple of (response_content, usage_stats).
        """
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        runs_on = resolve_model(model or self.model)
        payload: dict[str, Any] = {
            "model": runs_on,
            "messages": _with_language(messages),
            "temperature": temperature,
            **_token_budget(runs_on, max_tokens),
        }

        if json_mode:
            payload["response_format"] = {"type": "json_object"}

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/graphcs/promptmaster-engine",
            "X-Title": "PromptMaster Engine",
        }

        content, usage_stats, _finish_reason = await self._request_with_retries(
            payload, headers, timeout, deadline
        )
        return content, usage_stats

    async def generate_with_meta(
        self,
        prompt: str,
        system: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 16384,
        json_mode: bool = False,
        model: str | None = None,
        timeout: float | None = None,
        deadline: float | None = None,
    ) -> tuple[str, dict[str, int], str]:
        """Like generate(), but also returns the OpenRouter finish_reason.

        Returns:
            Tuple of (response_content, usage_stats, finish_reason).
            finish_reason is one of: "stop", "length", "content_filter", "tool_calls", "unknown".
        """
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        runs_on = resolve_model(model or self.model)
        payload: dict[str, Any] = {
            "model": runs_on,
            "messages": _with_language(messages),
            "temperature": temperature,
            **_token_budget(runs_on, max_tokens),
        }

        if json_mode:
            payload["response_format"] = {"type": "json_object"}

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/graphcs/promptmaster-engine",
            "X-Title": "PromptMaster Engine",
        }

        return await self._request_with_retries(payload, headers, timeout, deadline)

    async def generate_with_web(
        self,
        prompt: str,
        system: str | None = None,
        model: str | None = None,
        max_results: int = 5,
        timeout: float | None = None,
        deadline: float | None = None,
    ) -> tuple[str, list[dict[str, Any]]]:
        """One call with OpenRouter's web search on (20 Oct, Sean: "web search
        and source retrieval … with citations and saved sources").

        Returns the reply and the sources the search returned, as OpenRouter's
        `url_citation` annotations. Exa is named as the engine so every model
        searches the same way, at a known price per search.
        """
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        runs_on = resolve_model(model or self.model)
        payload: dict[str, Any] = {
            "model": runs_on,
            "messages": _with_language(messages),
            "temperature": 0.2,
            **_token_budget(runs_on, 2_000),
            "plugins": [{"id": "web", "engine": "exa", "max_results": max(1, min(max_results, 10))}],
            # The provider's total, search included, for the meter.
            "usage": {"include": True},
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/graphcs/promptmaster-engine",
            "X-Title": "PromptMaster Engine",
        }
        WEB_ANNOTATIONS.set(None)
        content, _usage, _finish = await self._request_with_retries(payload, headers, timeout, deadline)
        return content, WEB_ANNOTATIONS.get() or []

    async def generate_json(
        self,
        prompt: str,
        system: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 8192,
        model: str | None = None,
        timeout: float | None = None,
        deadline: float | None = None,
    ) -> tuple[dict, dict[str, int]]:
        """Generate a JSON response from the LLM.

        Includes one repair pass on parse failure.

        Returns:
            Tuple of (parsed_json, total_usage_stats).
        """
        content, usage = await self.generate(
            prompt=prompt,
            system=system,
            temperature=temperature,
            max_tokens=max_tokens,
            json_mode=True,
            model=model,
            timeout=timeout,
            deadline=deadline,
        )

        cleaned = self._clean_json_response(content)

        try:
            return json.loads(cleaned), usage
        except json.JSONDecodeError as parse_error:
            pass

        # Repair pass
        logger.warning(f"JSON parse failed, attempting repair pass")
        repair_prompt = (
            f"The following JSON is malformed:\n\n```\n{content}\n```\n\n"
            f"Fix it and return only valid JSON."
        )

        token = _REPAIRING.set(True)
        try:
            repaired, repair_usage = await self.generate(
                prompt=repair_prompt,
                system="You are a JSON repair assistant. Output only valid JSON.",
                temperature=0.0,
                max_tokens=max_tokens,
                json_mode=True,
                model=model,
                timeout=timeout,
                # The repair shares the caller's budget: this is the second
                # call in the worst case, and it is what pushed a single
                # request past the function limit.
                deadline=deadline,
            )
            total_usage = {
                "tokens_in": usage.get("tokens_in", 0) + repair_usage.get("tokens_in", 0),
                "tokens_out": usage.get("tokens_out", 0) + repair_usage.get("tokens_out", 0),
            }
            return json.loads(self._clean_json_response(repaired)), total_usage
        except OpenRouterDeadlineError:
            raise
        except (json.JSONDecodeError, OpenRouterError) as repair_error:
            raise OpenRouterError(
                f"Failed to parse JSON after repair attempt: {repair_error}"
            )
        finally:
            _REPAIRING.reset(token)


    async def _request_with_retries(
        self,
        payload: dict[str, Any],
        headers: dict[str, str],
        timeout: float | None,
        deadline: float | None,
    ) -> tuple[str, dict[str, int], str]:
        """Run a request with backoff, respecting a wall-clock deadline.

        `deadline` is a time.monotonic() value. Without it the ladder can burn
        three request timeouts plus 4.5s of sleep, which overruns a serverless
        function limit and turns a recoverable retry into an opaque 504.
        """
        last_error: Exception | None = None

        for attempt in range(1, _RETRY_MAX_ATTEMPTS + 1):
            # Never let one attempt outlive the budget.
            call_timeout = timeout if timeout is not None else self.timeout
            if deadline is not None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise OpenRouterDeadlineError(
                        f"Deadline exceeded before attempt {attempt}"
                    ) from last_error
                call_timeout = min(call_timeout, remaining)

            try:
                return await self._single_request(payload, headers, attempt, call_timeout)
            except OpenRouterError as e:
                if not self._is_retryable(e) or attempt == _RETRY_MAX_ATTEMPTS:
                    if attempt == _RETRY_MAX_ATTEMPTS:
                        last_error = e
                        break
                    raise
                last_error = e
                # A provider that tells us when to come back knows better than
                # our ladder does; a 429 retried too early just burns an attempt.
                delay = _RETRY_BASE_DELAY * (2 ** (attempt - 1))
                if e.retry_after is not None:
                    delay = max(delay, e.retry_after)
                # Don't sleep into the deadline just to fail on the far side.
                if deadline is not None and time.monotonic() + delay >= deadline:
                    raise OpenRouterDeadlineError(
                        f"Deadline would elapse during backoff after attempt {attempt}: {e}"
                    ) from e
                logger.warning(
                    f"Retryable error (attempt {attempt}/{_RETRY_MAX_ATTEMPTS}), "
                    f"retrying in {delay:.1f}s: {e}"
                )
                await asyncio.sleep(delay)

        raise last_error or OpenRouterError("All retry attempts failed")

    async def _single_request(
        self,
        payload: dict[str, Any],
        headers: dict[str, str],
        attempt: int,
        timeout: float | None = None,
    ) -> tuple[str, dict[str, int], str]:
        """Execute a single HTTP request."""
        t0 = time.monotonic()
        effective_timeout = timeout if timeout is not None else self.timeout

        try:
            response = await self._client.post(
                self.BASE_URL, json=payload, headers=headers, timeout=effective_timeout
            )

            if response.status_code in _RETRYABLE_STATUS_CODES:
                raise OpenRouterError(
                    f"Server error (HTTP {response.status_code}): {response.text[:200]}",
                    status_code=response.status_code,
                    provider_code=_provider_code(response),
                    retry_after=_retry_after_seconds(response),
                )
            response.raise_for_status()

            data = response.json()

            choices = data.get("choices")
            if not choices or not isinstance(choices, list):
                raise OpenRouterError(f"Invalid response: missing 'choices'")

            message = choices[0].get("message") or {}
            content = message.get("content")
            finish_reason = choices[0].get("finish_reason", "unknown")

            if not content:
                # Billed all the same: a reply spent wholly on reasoning still
                # cost its tokens, and an unmetered failure is an unread bill.
                usage = data.get("usage", {})
                _meter(
                    model=str(payload.get("model") or ""),
                    tokens_in=usage.get("prompt_tokens", 0),
                    tokens_out=usage.get("completion_tokens", 0),
                    elapsed=time.monotonic() - t0,
                    finish_reason=finish_reason,
                    attempt=attempt,
                )
                raise OpenRouterError(f"No content in response (finish_reason={finish_reason!r})")

            if finish_reason == "length":
                logger.warning("Response truncated (finish_reason='length') — returning partial content")

            usage = data.get("usage", {})
            usage_stats = {
                "tokens_in": usage.get("prompt_tokens", 0),
                "tokens_out": usage.get("completion_tokens", 0),
            }

            elapsed = time.monotonic() - t0
            provider_cost = usage.get("cost") if payload.get("plugins") and isinstance(usage.get("cost"), (int, float)) else None
            _meter(
                model=str(payload.get("model") or ""),
                tokens_in=usage_stats["tokens_in"],
                tokens_out=usage_stats["tokens_out"],
                elapsed=elapsed,
                finish_reason=finish_reason,
                attempt=attempt,
                provider_cost=provider_cost,
            )
            if payload.get("plugins"):
                WEB_ANNOTATIONS.set([a for a in (message.get("annotations") or []) if isinstance(a, dict)])

            return content, usage_stats, finish_reason

        except httpx.TimeoutException as e:
            raise OpenRouterError(
                f"Request timed out after {effective_timeout}s",
                provider_code="timeout",
            ) from e
        except httpx.HTTPStatusError as e:
            raise OpenRouterError(
                f"HTTP {e.response.status_code}: {e.response.text[:200]}",
                status_code=e.response.status_code,
                provider_code=_provider_code(e.response),
                retry_after=_retry_after_seconds(e.response),
            ) from e
        except httpx.RequestError as e:
            raise OpenRouterError(f"Network error: {e}", provider_code="network") from e

    def _is_retryable(self, error: OpenRouterError) -> bool:
        """Whether an error is worth another attempt.

        Prefers the structured status code now that we carry one. The substring
        pass is kept as a fallback, not as the primary signal: errors raised
        without a status (and every OpenRouterError constructed by older code,
        including in tests) still classify exactly as they did before.
        """
        if error.status_code is not None:
            return error.status_code in _RETRYABLE_STATUS_CODES
        if error.provider_code in ("timeout", "network"):
            return True
        msg = str(error)
        return any(code in msg for code in ["429", "500", "502", "503", "504", "timed out", "Network error"])

    def _clean_json_response(self, content: str) -> str:
        """Strip markdown code blocks from JSON response."""
        cleaned = content.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            cleaned = "\n".join(lines)
        return cleaned

    @classmethod
    async def fetch_text_models(cls, api_key: str | None = None, timeout: float = 20.0) -> list[dict[str, Any]]:
        """Fetch available text models from OpenRouter.

        Returns list of dicts with: id, name, context_length.
        """
        headers: dict[str, str] = {
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/promptmaster-engine",
            "X-Title": "PromptMaster Engine",
        }
        resolved_key = api_key or os.getenv("OPENROUTER_API_KEY")
        if resolved_key:
            headers["Authorization"] = f"Bearer {resolved_key}"

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.get(cls.MODELS_URL, headers=headers)
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPStatusError, httpx.RequestError, httpx.TimeoutException) as e:
            raise OpenRouterError(f"Failed to fetch models: {e}") from e

        data = payload.get("data")
        if not isinstance(data, list):
            raise OpenRouterError("Invalid model list response")

        models: list[dict[str, Any]] = []
        for item in data:
            if not isinstance(item, dict):
                continue
            model_id = item.get("id")
            if not isinstance(model_id, str) or not model_id.strip():
                continue

            # Filter for text-capable models
            arch = item.get("architecture") or {}
            in_mods = arch.get("input_modalities") or item.get("input_modalities") or []
            out_mods = arch.get("output_modalities") or item.get("output_modalities") or []
            all_mods = item.get("modalities") or []
            combined = {str(m).lower() for m in in_mods + out_mods + all_mods}
            if combined and "text" not in combined:
                continue

            ctx = item.get("context_length", 0)
            try:
                ctx = int(ctx or 0)
            except (TypeError, ValueError):
                ctx = 0

            models.append({
                "id": model_id.strip(),
                "name": item.get("name") or model_id.strip(),
                "context_length": ctx,
            })

        models.sort(key=lambda m: m["id"])
        return models

    async def close(self):
        """Close the HTTP client."""
        await self._client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()
