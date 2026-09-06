"""OpenRouter LLM client for PromptMaster Engine."""

import asyncio
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
    DEFAULT_MODEL = "openai/gpt-5.4"

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

        payload: dict[str, Any] = {
            "model": model or self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
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

        payload: dict[str, Any] = {
            "model": model or self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
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
                raise OpenRouterError(f"No content in response (finish_reason={finish_reason!r})")

            if finish_reason == "length":
                logger.warning("Response truncated (finish_reason='length') — returning partial content")

            usage = data.get("usage", {})
            usage_stats = {
                "tokens_in": usage.get("prompt_tokens", 0),
                "tokens_out": usage.get("completion_tokens", 0),
            }

            elapsed = time.monotonic() - t0
            logger.info(f"LLM response: {usage_stats['tokens_in']:,} in / {usage_stats['tokens_out']:,} out ({elapsed:.1f}s)")

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
