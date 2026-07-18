#!/usr/bin/env python3
"""Rank the 1,000-wallet SGT cohort by bounded, read-only Solana activity."""

import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

TARGET_WALLETS = 500
SIGNATURE_LIMIT = 1_000
MAX_REQUESTS = 1_100
DAY = 86_400
WORK_DIR = Path(os.environ.get("LUCKYME_ACTIVITY_DIR", "/var/tmp/luckyme-cnft-top500"))
INPUT_PATH = Path(os.environ.get(
    "LUCKYME_ACTIVITY_INPUT",
    "/var/tmp/luckyme-cnft-top500/wallets-1000.json",
))
STATE_PATH = WORK_DIR / "state.json"
RESULT_PATH = WORK_DIR / "top-500-by-activity.json"


def load_rpc_url():
    values = {}
    with open("/etc/luckyme/luckyme-api.env", encoding="utf-8") as stream:
        for raw in stream:
            line = raw.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values[key] = value.strip().strip('"').strip("'")
    return values.get("SEEKER_SGT_RPC_URL") or values["ANCHOR_PROVIDER_URL"]


def file_sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save_state(state):
    temporary = STATE_PATH.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(STATE_PATH)


def load_or_create_state(input_sha256):
    if STATE_PATH.exists():
        state = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        if state.get("inputFileSha256") != input_sha256:
            raise RuntimeError("input cohort changed after ranking started")
        return state
    now = int(time.time())
    state = {
        "schemaVersion": 1,
        "phase": "analyze",
        "requestCount": 0,
        "inputFileSha256": input_sha256,
        "asOfUnix": now,
        "cutoff30Unix": now - 30 * DAY,
        "cutoff90Unix": now - 90 * DAY,
        "activity": {},
        "createdAt": datetime.fromtimestamp(now, timezone.utc).isoformat(),
    }
    save_state(state)
    return state


def rpc(state, rpc_url, wallet):
    payload = json.dumps({
        "jsonrpc": "2.0",
        "id": "luckyme-activity",
        "method": "getSignaturesForAddress",
        "params": [wallet, {"commitment": "finalized", "limit": SIGNATURE_LIMIT}],
    }).encode()
    for attempt in range(6):
        if state["requestCount"] >= MAX_REQUESTS:
            save_state(state)
            raise RuntimeError(f"hard request budget reached: {MAX_REQUESTS}")
        state["requestCount"] += 1
        save_state(state)
        try:
            request = Request(rpc_url, data=payload, headers={"Content-Type": "application/json"})
            with urlopen(request, timeout=90) as response:
                body = json.load(response)
            if body.get("error"):
                message = str(body["error"].get("message", "RPC error"))
                if "rate" in message.lower() and attempt < 5:
                    time.sleep(min(8, attempt + 1))
                    continue
                raise RuntimeError(message)
            time.sleep(0.30)
            return body["result"]
        except HTTPError as error:
            if error.code != 429 or attempt == 5:
                raise
            time.sleep(min(8, attempt + 1))
        except URLError:
            if attempt == 5:
                raise
            time.sleep(min(8, attempt + 1))
    raise RuntimeError("RPC retry loop exhausted")


def summarize_activity(signatures, cutoff30, cutoff90):
    successful = [
        row for row in signatures
        if row.get("err") is None and isinstance(row.get("blockTime"), int)
    ]
    recent30 = [row for row in successful if row["blockTime"] >= cutoff30]
    recent90 = [row for row in successful if row["blockTime"] >= cutoff90]
    timestamps = [row["blockTime"] for row in successful]
    oldest_sample = min(timestamps) if timestamps else None
    return {
        "successfulTx30d": len(recent30),
        "activeDays30d": len({row["blockTime"] // DAY for row in recent30}),
        "successfulTx90d": len(recent90),
        "activeDays90d": len({row["blockTime"] // DAY for row in recent90}),
        "latestActivityUnix": max(timestamps) if timestamps else None,
        "sampledSignatures": len(signatures),
        "sampleCapped": len(signatures) == SIGNATURE_LIMIT,
        "oldestSampleUnix": oldest_sample,
    }


def analyze(state, rpc_url, wallets):
    for row in wallets:
        wallet = row["wallet"]
        if wallet in state["activity"]:
            continue
        signatures = rpc(state, rpc_url, wallet)
        state["activity"][wallet] = summarize_activity(
            signatures,
            state["cutoff30Unix"],
            state["cutoff90Unix"],
        )
        save_state(state)
        analyzed = len(state["activity"])
        if analyzed % 50 == 0:
            print(json.dumps({
                "phase": "analyze",
                "wallets": analyzed,
                "requests": state["requestCount"],
            }), flush=True)
    state["phase"] = "complete"
    save_state(state)


def ranking_key(row):
    activity = row["activity"]
    return (
        -activity["activeDays30d"],
        -activity["successfulTx30d"],
        -activity["activeDays90d"],
        -activity["successfulTx90d"],
        -(activity["latestActivityUnix"] or 0),
        row["wallet"],
    )


def write_result(state, cohort):
    ranked = []
    for source in cohort["wallets"]:
        wallet = source["wallet"]
        if wallet not in state["activity"]:
            raise RuntimeError(f"missing activity result for {wallet}")
        ranked.append({
            "wallet": wallet,
            "sgtMints": source["sgtMints"],
            "sourceCohortIndex": source["cohortIndex"],
            "activity": state["activity"][wallet],
        })
    ranked.sort(key=ranking_key)
    top = ranked[:TARGET_WALLETS]
    for index, row in enumerate(top, start=1):
        row["activityRank"] = index
    body = {
        "schemaVersion": 1,
        "kind": "sgt-test-cohort-top-by-solana-activity",
        "cluster": "mainnet-beta",
        "walletCount": len(top),
        "sourceWalletCount": len(cohort["wallets"]),
        "inputFileSha256": state["inputFileSha256"],
        "requestCount": state["requestCount"],
        "asOfUnix": state["asOfUnix"],
        "cutoff30Unix": state["cutoff30Unix"],
        "cutoff90Unix": state["cutoff90Unix"],
        "ranking": [
            "activeDays30d desc",
            "successfulTx30d desc",
            "activeDays90d desc",
            "successfulTx90d desc",
            "latestActivityUnix desc",
            "wallet asc",
        ],
        "samplingNote": "At most the latest 1000 finalized signatures per wallet were analyzed.",
        "wallets": top,
    }
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
    body["sha256"] = hashlib.sha256(canonical).hexdigest()
    body["completedAt"] = datetime.now(timezone.utc).isoformat()
    RESULT_PATH.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "ok": True,
        "walletCount": len(top),
        "requestCount": state["requestCount"],
        "sha256": body["sha256"],
        "resultPath": str(RESULT_PATH),
    }), flush=True)


def main():
    WORK_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    cohort = json.loads(INPUT_PATH.read_text(encoding="utf-8"))
    if cohort.get("walletCount") != 1_000 or len(cohort.get("wallets", [])) != 1_000:
        raise RuntimeError("expected the verified 1,000-wallet cohort")
    input_sha256 = file_sha256(INPUT_PATH)
    state = load_or_create_state(input_sha256)
    if state["phase"] == "analyze":
        analyze(state, load_rpc_url(), cohort["wallets"])
    write_result(state, cohort)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr, flush=True)
        raise
