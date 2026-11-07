"""Clients for TypeSafe (Jev) and Anthropic (Claude).

Jev goes over stdlib HTTP so the tool runs on Python 3.9 (the TypeSafe SDK needs 3.10+).
Claude uses the official Anthropic SDK. Both raise on failure: a failed call is an error,
never an answer.
"""

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
JEV_URL = "https://api.typesafe.ai/v1/systemone"


def env(name: str, *fallbacks: str) -> str:
    """Read a key from the environment, then from .env next to the repo root."""
    names = (name,) + fallbacks
    for n in names:
        if os.environ.get(n):
            return os.environ[n].strip()
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            for n in names:
                if line.startswith(n + "="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise KeyError(f"{name} not set (environment or {ENV_FILE})")


def has_env(name: str, *fallbacks: str) -> bool:
    try:
        return bool(env(name, *fallbacks))
    except KeyError:
        return False


def _post(url: str, body: dict, headers: dict, timeout: int = 120) -> tuple:
    """POST JSON, retrying 429/5xx a few times. Returns (response_json, seconds)."""
    data = json.dumps(body).encode("utf-8")
    for attempt in range(4):
        req = urllib.request.Request(url, data=data, method="POST",
                                     headers={"Content-Type": "application/json", **headers})
        start = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.load(resp), time.perf_counter() - start
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:800]
            if e.code in (429, 500, 502, 503, 529) and attempt < 3:
                retry_after = e.headers.get("retry-after")
                time.sleep(float(retry_after) if retry_after else 2 ** attempt)
                continue
            raise RuntimeError(f"HTTP {e.code} from {url}: {detail}") from None


def jev(state, questions: dict, model: str = "jev-latest") -> tuple:
    """One System One request. Returns (response, seconds)."""
    return _post(JEV_URL, {"model": model, "state": state, "questions": questions},
                 {"Authorization": f"Bearer {env('TYPESAFE_API_KEY')}"})


_claude_client = None


def claude(**params) -> tuple:
    """One Messages API request. Returns (message, seconds)."""
    global _claude_client
    import anthropic

    if _claude_client is None:
        _claude_client = anthropic.Anthropic(api_key=env("ANTHROPIC_API_KEY", "CLAUDE_API_KEY"))
    start = time.perf_counter()
    message = _claude_client.messages.create(**params)
    return message, time.perf_counter() - start
