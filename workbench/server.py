"""Jev Workbench: draft Jev questions for a dataset with Opus, edit them, export them, run them.

    python workbench/server.py            # http://127.0.0.1:8791

Keys stay on this server (.env or environment). The page sends rows to /api/run in small
batches, so a large dataset shows progress and a failure only affects its own rows. Every Jev
request and response is appended to runs/calls.jsonl so any result can be rerun. The server
stops calling a model once its spend cap for the life of the process is reached.
"""

import argparse
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

import generator  # noqa: E402
from clients import has_env, jev  # noqa: E402

JEV_PRICE_PER_MTOK = 0.042  # input only; output tokens are free
CAPS = {
    "jev": float(os.environ.get("JEV_SPEND_CAP_USD", "2.00")),
    "opus": float(os.environ.get("OPUS_SPEND_CAP_USD", "2.00")),
}
MAX_BODY_BYTES = 30 * 1024 * 1024
WORKERS = 8

LOG = ROOT / "runs" / "calls.jsonl"
spend = {"jev": 0.0, "opus": 0.0}
lock = Lock()


def log(entry: dict) -> None:
    LOG.parent.mkdir(exist_ok=True)
    with lock, LOG.open("a") as f:
        f.write(json.dumps({"at": datetime.now().isoformat(timespec="seconds"), **entry},
                           ensure_ascii=False) + "\n")


def run_one(model: str, state, questions: dict) -> dict:
    if spend["jev"] >= CAPS["jev"]:
        return {"error": f"Jev spend cap ${CAPS['jev']:.2f} reached; restart with a higher JEV_SPEND_CAP_USD"}
    try:
        r, seconds = jev(state, questions, model)
    except Exception as e:
        log({"kind": "jev", "model": model, "state": state, "questions": questions, "error": str(e)})
        return {"error": str(e)}
    tokens = r.get("usage", {}).get("input_tokens", 0)
    with lock:
        spend["jev"] += tokens * JEV_PRICE_PER_MTOK / 1e6
    log({"kind": "jev", "model": model, "state": state, "questions": questions, "response": r})
    return {"answers": r["answers"], "model": r.get("model"), "input_tokens": tokens,
            "seconds": round(seconds, 3)}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / "public"), **kwargs)

    def log_message(self, fmt, *args):
        pass

    def _json(self, code: int, payload: dict) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/api/status":
            return self._json(200, {
                "typesafe_key": has_env("TYPESAFE_API_KEY"),
                "anthropic_key": has_env("ANTHROPIC_API_KEY", "CLAUDE_API_KEY"),
                "opus_model": generator.MODEL, "spend": spend, "caps": CAPS,
            })
        if self.path == "/api/example":
            data = (ROOT / "examples" / "support_tickets.csv").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            return self.wfile.write(data)
        return super().do_GET()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        if length > MAX_BODY_BYTES:
            return self._json(413, {"error": "request too large"})
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return self._json(400, {"error": "invalid JSON"})

        if self.path == "/api/generate":
            if spend["opus"] >= CAPS["opus"]:
                return self._json(429, {"error": f"Opus spend cap ${CAPS['opus']:.2f} reached"})
            try:
                out = generator.generate(body.get("goal", ""), body.get("context", ""),
                                         body.get("columns", []), body.get("sample", []),
                                         int(body.get("n_questions", 8)))
            except Exception as e:
                log({"kind": "opus", "goal": body.get("goal"), "error": f"{type(e).__name__}: {e}"})
                return self._json(502, {"error": f"{type(e).__name__}: {e}"})
            with lock:
                spend["opus"] += out["cost_usd"]
            log({"kind": "opus", "goal": body.get("goal"), "response": out})
            return self._json(200, out)

        if self.path == "/api/run":
            states, questions = body.get("states", []), body.get("questions", {})
            if not questions:
                return self._json(400, {"error": "no questions"})
            model = body.get("model", "jev-latest")
            with ThreadPoolExecutor(max_workers=WORKERS) as pool:
                results = list(pool.map(lambda s: run_one(model, s, questions), states))
            return self._json(200, {"results": results, "spend": spend})

        return self._json(404, {"error": "unknown endpoint"})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8791)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Jev Workbench on http://127.0.0.1:{args.port}  (caps: Jev ${CAPS['jev']}, Opus ${CAPS['opus']})")
    server.serve_forever()


if __name__ == "__main__":
    main()
