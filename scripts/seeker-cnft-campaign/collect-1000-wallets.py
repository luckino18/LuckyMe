#!/usr/bin/env python3
"""Bounded, resumable, read-only collector for a 1,000-wallet SGT test cohort."""

import base64
import hashlib
import json
import os
import struct
import sys
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

TARGET_WALLETS = 1_000
CANDIDATE_MINTS = 1_200
MAX_REQUESTS = 1_500
PAGE_SIZE = 100
TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
SGT_AUTHORITY = "GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4"
SGT_GROUP = "GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te"
WORK_DIR = Path(os.environ.get("LUCKYME_CNFT_TEST_DIR", "/var/tmp/luckyme-cnft-1000"))
STATE_PATH = WORK_DIR / "state.json"
RESULT_PATH = WORK_DIR / "wallets-1000.json"

ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def load_rpc_url():
    values = {}
    with open("/etc/luckyme/luckyme-api.env", encoding="utf-8") as stream:
        for raw in stream:
            line = raw.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values[key] = value.strip().strip('"').strip("'")
    return values.get("SEEKER_SGT_RPC_URL") or values["ANCHOR_PROVIDER_URL"]


def base58_encode(raw):
    padding = len(raw) - len(raw.lstrip(b"\0"))
    number = int.from_bytes(raw, "big")
    encoded = ""
    while number:
        number, remainder = divmod(number, 58)
        encoded = ALPHABET[remainder] + encoded
    return "1" * padding + (encoded or ("" if padding else "1"))


def initial_state():
    return {
        "schemaVersion": 1,
        "phase": "discover_mints",
        "requestCount": 0,
        "paginationKey": None,
        "mints": [],
        "largestAccounts": {},
        "holders": {},
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def load_state():
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    return initial_state()


def save_state(state):
    temporary = STATE_PATH.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(STATE_PATH)


def rpc(state, rpc_url, method, params):
    payload = json.dumps({
        "jsonrpc": "2.0",
        "id": f"luckyme-cnft-{method}",
        "method": method,
        "params": params,
    }).encode()
    for attempt in range(8):
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
                raise RuntimeError(body["error"].get("message", "RPC error"))
            time.sleep(0.35)
            return body["result"]
        except HTTPError as error:
            if error.code != 429 or attempt == 7:
                raise
            time.sleep(min(10, attempt + 1))
    raise RuntimeError("RPC retry loop exhausted")


def discover_mints(state, rpc_url):
    while len(state["mints"]) < CANDIDATE_MINTS:
        config = {
            "encoding": "base64",
            "commitment": "finalized",
            "limit": PAGE_SIZE,
            "dataSlice": {"offset": 0, "length": 0},
            "filters": [
                {"dataSize": 450},
                {"memcmp": {"offset": 4, "bytes": SGT_AUTHORITY}},
                {"memcmp": {"offset": 202, "bytes": SGT_GROUP}},
                {"memcmp": {"offset": 410, "bytes": SGT_GROUP}},
            ],
        }
        if state["paginationKey"]:
            config["paginationKey"] = state["paginationKey"]
        result = rpc(state, rpc_url, "getProgramAccountsV2", [TOKEN_2022, config])
        known = set(state["mints"])
        state["mints"].extend(
            row["pubkey"] for row in result.get("accounts", []) if row.get("pubkey") not in known
        )
        state["paginationKey"] = result.get("paginationKey")
        save_state(state)
        if len(state["mints"]) % 100 < PAGE_SIZE:
            print(json.dumps({
                "phase": "discover_mints",
                "mints": len(state["mints"]),
                "requests": state["requestCount"],
            }), flush=True)
        if not state["paginationKey"]:
            break
    state["mints"] = state["mints"][:CANDIDATE_MINTS]
    state["phase"] = "resolve_token_accounts"
    save_state(state)


def resolve_token_accounts(state, rpc_url):
    for mint in state["mints"]:
        if mint in state["largestAccounts"]:
            continue
        result = rpc(state, rpc_url, "getTokenLargestAccounts", [mint, {"commitment": "finalized"}])
        live = next((row for row in result.get("value", []) if row.get("amount") == "1"), None)
        state["largestAccounts"][mint] = live.get("address") if live else None
        save_state(state)
        resolved = len(state["largestAccounts"])
        if resolved % 100 == 0:
            print(json.dumps({
                "phase": "resolve_token_accounts",
                "resolved": resolved,
                "requests": state["requestCount"],
            }), flush=True)
    state["phase"] = "resolve_owners"
    save_state(state)


def resolve_owners(state, rpc_url):
    unresolved = [
        (mint, token_account)
        for mint, token_account in state["largestAccounts"].items()
        if token_account and mint not in state["holders"]
    ]
    for offset in range(0, len(unresolved), 100):
        batch = unresolved[offset:offset + 100]
        result = rpc(state, rpc_url, "getMultipleAccounts", [
            [token_account for _, token_account in batch],
            {"encoding": "base64", "commitment": "finalized", "dataSlice": {"offset": 0, "length": 72}},
        ])
        for (mint, _), info in zip(batch, result.get("value", [])):
            if not info or info.get("owner") != TOKEN_2022:
                continue
            data = base64.b64decode(info["data"][0])
            if len(data) < 72 or struct.unpack("<Q", data[64:72])[0] != 1:
                continue
            state["holders"][mint] = base58_encode(data[32:64])
        save_state(state)
        print(json.dumps({
            "phase": "resolve_owners",
            "holders": len(state["holders"]),
            "requests": state["requestCount"],
        }), flush=True)
    state["phase"] = "complete"
    save_state(state)


def write_result(state):
    by_wallet = {}
    for mint in state["mints"]:
        wallet = state["holders"].get(mint)
        if not wallet:
            continue
        by_wallet.setdefault(wallet, []).append(mint)
        if len(by_wallet) >= TARGET_WALLETS:
            break
    if len(by_wallet) < TARGET_WALLETS:
        raise RuntimeError(f"only {len(by_wallet)} unique wallets resolved")
    rows = [
        {"cohortIndex": index, "wallet": wallet, "sgtMints": sorted(mints)}
        for index, (wallet, mints) in enumerate(list(by_wallet.items())[:TARGET_WALLETS], start=1)
    ]
    body = {
        "schemaVersion": 1,
        "kind": "bounded-sgt-test-cohort",
        "cluster": "mainnet-beta",
        "walletCount": len(rows),
        "requestCount": state["requestCount"],
        "wallets": rows,
    }
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
    body["sha256"] = hashlib.sha256(canonical).hexdigest()
    body["completedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    RESULT_PATH.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "ok": True,
        "walletCount": body["walletCount"],
        "requestCount": body["requestCount"],
        "sha256": body["sha256"],
        "resultPath": str(RESULT_PATH),
    }), flush=True)


def main():
    WORK_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    state = load_state()
    rpc_url = load_rpc_url()
    if state["phase"] == "discover_mints":
        discover_mints(state, rpc_url)
    if state["phase"] == "resolve_token_accounts":
        resolve_token_accounts(state, rpc_url)
    if state["phase"] == "resolve_owners":
        resolve_owners(state, rpc_url)
    write_result(state)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr, flush=True)
        raise
