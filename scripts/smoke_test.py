#!/usr/bin/env python3
"""
End-to-end verification of Sentinel against a running instance (after scripts/load-seed.sh).
Checks every business rule, the NFRs that are observable through the API, and the loss-prevention guardrails.
Uses only existing seed customers/accounts; streaming checks post transactions with a DEMO- prefix.

Usage: python scripts/smoke_test.py [base-url]
"""
import base64
import concurrent.futures as cf
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"
ENV = dict(l.strip().split("=", 1) for l in open(ROOT / ".env") if "=" in l and not l.startswith("#"))
USERS = {r: (ENV[f"SENTINEL_{r}_USER"], ENV[f"SENTINEL_{r}_PASSWORD"]) for r in ("ANALYST", "SUPERVISOR", "ADMIN")}
RESULTS = []


def call(method, path, role="ADMIN", body=None):
    u, p = USERS[role] if role else (None, None)
    req = urllib.request.Request(BASE + path, method=method, data=None if body is None else json.dumps(body).encode())
    req.add_header("Content-Type", "application/json")
    if role:
        req.add_header("Authorization", "Basic " + base64.b64encode(f"{u}:{p}".encode()).decode())
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read()
        return e.code, json.loads(raw) if raw else None


def check(name, ok, detail=""):
    RESULTS.append(ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""))


def now(minutes=0):
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M:%SZ")


def customer_id(ref):
    _, page = call("GET", f"/api/v1/customers?q={ref}&size=1", "ANALYST")
    return page["content"][0]["id"]


def rules_for_customer(ref):
    _, page = call("GET", f"/api/v1/alerts?customerId={customer_id(ref)}&size=50", "ANALYST")
    return {code for a in page["content"] for code in a["ruleCodes"]}, page["content"]


def main():
    scenarios = json.load(open(ROOT / "seed" / "scenarios.json"))["typologies"]
    expected = {"STRUCTURING": {"STRUCTURING"}, "RAPID_MOVEMENT": {"RAPID_MOVEMENT"},
                "HIGH_RISK_JURISDICTION": {"HIGH_RISK_JURISDICTION"}, "BEHAVIORAL_DEVIATION": {"BEHAVIORAL_DEVIATION"},
                "ROUND_AMOUNT": {"ROUND_AMOUNT"}, "CTR_THRESHOLD": {"CTR_THRESHOLD"},
                "LAYERING_RING": {"STRUCTURING", "RAPID_MOVEMENT", "HIGH_RISK_JURISDICTION", "CTR_THRESHOLD"}}

    print("\nBusiness rules 1-5: every planted typology in the seed data is detected")
    for typology, customers in scenarios.items():
        caught = sum(1 for c in customers if expected[typology] <= rules_for_customer(c["customerRef"])[0])
        check(f"{typology:<24} caught {caught}/{len(customers)}", caught == len(customers))

    print("\nBR6/7: risk-ordered queue, explanations, evidence")
    _, q = call("GET", "/api/v1/alerts?size=50&status=OPEN", "ANALYST")
    scores = [a["riskScore"] for a in q["content"]]
    check("queue sorted by risk score desc", scores == sorted(scores, reverse=True), f"top={scores[:5]}")
    top = q["content"][0]
    _, detail = call("GET", f"/api/v1/alerts/{top['id']}", "ANALYST")
    check("alert carries explanation + evidence txns", bool(detail["explanation"]) and len(detail["evidence"]) > 0,
          detail["explanation"].splitlines()[0][:90])

    print("\nBR8: PII masking")
    check("list view masks names", all("*" in a["customerName"] for a in q["content"]))
    check("analyst detail view is masked", detail["customer"]["piiMasked"] and "*" in detail["customer"]["nationalId"])
    _, sdetail = call("GET", f"/api/v1/alerts/{top['id']}", "SUPERVISOR")
    check("supervisor detail view is unmasked", not sdetail["customer"]["piiMasked"])

    print("\nSecurity / API standards")
    s, body = call("GET", "/api/v1/alerts", None)
    check("no credentials -> 401 JSON", s == 401 and body["code"] == "UNAUTHENTICATED")
    s, body = call("PATCH", "/api/v1/rules/ROUND_AMOUNT", "ANALYST", {"enabled": False})
    check("analyst cannot tune rules -> 403", s == 403 and body["code"] == "FORBIDDEN")
    s, body = call("POST", "/api/v1/transactions", "ADMIN", {"txnRef": "", "amount": -1})
    check("invalid payload -> 400 with field errors", s == 400 and len(body["fieldErrors"]) >= 3)
    s, _ = call("GET", "/api/v1/alerts/999999999", "ANALYST")
    check("unknown alert -> 404", s == 404)

    print("\nStreaming: sub-second evaluation, structuring caught live, HOLD verdict")
    with open(ROOT / "seed" / "accounts.csv") as f:
        rows = [l.strip().split(",") for l in f][1:]
    struct_customers = {c["customerRef"] for c in scenarios["STRUCTURING"]} | {c["customerRef"] for c in scenarios["LAYERING_RING"]}
    clean = [r for r in rows if r[1] not in struct_customers and r[3] == "INR"]
    acct = clean[7][0]
    run = uuid.uuid4().hex[:6]
    latencies, last = [], None
    for k in range(3):
        t0 = time.perf_counter()
        s, last = call("POST", "/api/v1/transactions", "ADMIN", {
            "txnRef": f"DEMO-{run}-S{k}", "accountNumber": acct, "direction": "CREDIT", "amount": 790000 + k * 1111,
            "currency": "INR", "channel": "CASH", "counterpartyCountry": "IN", "occurredAt": now(-30 + k)})
        latencies.append((time.perf_counter() - t0) * 1000)
    check("3rd sub-threshold cash deposit raises STRUCTURING", "STRUCTURING" in last["detection"]["rulesFired"],
          f"alert {last['detection']['alertRef']} verdict {last['detection']['decision']}")
    check("streaming latency < 1s", max(latencies) < 1000, f"max {max(latencies):.0f} ms, server {last['latencyMs']} ms")
    s, dup = call("POST", "/api/v1/transactions", "ADMIN", {
        "txnRef": f"DEMO-{run}-S0", "accountNumber": acct, "direction": "CREDIT", "amount": 1, "currency": "INR",
        "channel": "CASH", "occurredAt": now()})
    check("replayed txnRef -> 409 (idempotent)", s == 409)

    acct2 = clean[11][0]
    _, frozen = call("GET", "/api/v1/accounts?status=FROZEN", "ANALYST")
    for a in frozen:
        if a["account_number"] == acct2:  # frozen by a previous run: lifting it needs a supervisor and a reason
            s, _ = call("POST", f"/api/v1/accounts/{a['id']}/unfreeze", "ANALYST", {"reason": "retest of sanctions flow"})
            check("analyst cannot unfreeze -> 403", s == 403)
            s, _ = call("POST", f"/api/v1/accounts/{a['id']}/unfreeze", "SUPERVISOR", {"reason": "retest of sanctions flow"})
            check("supervisor unfreezes with reason", s == 200)
    s, sanc = call("POST", "/api/v1/transactions", "ADMIN", {
        "txnRef": f"DEMO-{run}-SANC", "accountNumber": acct2, "direction": "DEBIT", "amount": 1500, "currency": "INR",
        "counterpartyName": "Blue Lagoon Trading FZE", "counterpartyCountry": "AE", "channel": "SWIFT", "occurredAt": now()})
    check("tiny payment to sanctioned party -> HOLD + account frozen",
          sanc["detection"]["decision"] == "HOLD" and sanc["detection"]["accountFrozen"], str(sanc["detection"]["decisionReasons"]))
    s, nxt = call("POST", "/api/v1/transactions", "ADMIN", {
        "txnRef": f"DEMO-{run}-AFTER", "accountNumber": acct2, "direction": "DEBIT", "amount": 99.5, "currency": "INR",
        "counterpartyName": "Grocery Mart", "channel": "UPI", "occurredAt": now()})
    check("next debit on frozen account -> HOLD", nxt["detection"]["decision"] == "HOLD")

    print("\nConcurrency: 40 parallel streams for one customer -> exactly one alert, no lost evidence")
    acct3 = clean[23][0]
    def post(i):
        return call("POST", "/api/v1/transactions", "ADMIN", {
            "txnRef": f"DEMO-{run}-P{i}", "accountNumber": acct3, "direction": "CREDIT", "amount": 800000 + i,
            "currency": "INR", "channel": "CASH", "occurredAt": now(-60 + i % 50)})
    with cf.ThreadPoolExecutor(20) as ex:
        outs = list(ex.map(post, range(40)))
    alert_refs = {o[1]["detection"]["alertRef"] for o in outs if o[0] == 201 and o[1]["detection"]["alertRef"]}
    check("all 40 accepted", all(o[0] == 201 for o in outs))
    check("single aggregated alert", len(alert_refs) == 1, str(alert_refs))
    aid = next(o[1]["detection"]["alertId"] for o in outs if o[1]["detection"]["alertId"])
    _, ad = call("GET", f"/api/v1/alerts/{aid}", "ANALYST")
    demo_evidence = [e for e in ad["evidence"] if e["txnRef"].startswith(f"DEMO-{run}-P")]
    check("every parallel txn is evidence on that alert", len(demo_evidence) == 40, f"{len(demo_evidence)} evidence rows")

    print("\nGuardrails")
    s, b = call("PATCH", "/api/v1/rules/STRUCTURING", "ADMIN", {"enabled": False})
    check("mandated rule cannot be disabled -> 422", s == 422 and b["code"] == "GUARDRAIL_VIOLATION", b["message"])
    s, b = call("PATCH", "/api/v1/rules/CTR_THRESHOLD", "ADMIN", {"params": {"thresholdAmount": 50000}})
    check("CTR cannot be loosened -> 422", s == 422, b["message"])
    s, b = call("PUT", "/api/v1/fx-rates/USD", "ADMIN", {"rateToBase": 0.835})
    check("fat-finger FX rate -> 422 FX_RATE_DEVIATION", s == 422 and b["code"] == "FX_RATE_DEVIATION")
    _, before = call("GET", "/api/v1/rules/ROUND_AMOUNT", "ANALYST")
    s, b = call("PATCH", "/api/v1/rules/ROUND_AMOUNT", "ADMIN", {"params": {"minCount": 4}})
    check("optional rule tunable at runtime (no redeploy), versioned", s == 200 and b["version"] == before["version"] + 1,
          f"v{before['version']} -> v{b['version']}")
    call("PATCH", "/api/v1/rules/ROUND_AMOUNT", "ADMIN", {"params": {"minCount": 3}})

    critical = next(a for a in q["content"] if a["riskScore"] >= 80)
    s, b = call("POST", f"/api/v1/alerts/{critical['id']}/actions", "ANALYST",
                {"action": "CLOSE", "disposition": "FALSE_POSITIVE", "reason": "looks ok"})
    check("analyst cannot close a critical alert (four-eyes) -> 403", s == 403, b["message"])

    print("\nBR6 + audit: disposition workflow, immutability")
    low = next(a for a in reversed(q["content"]) if a["riskScore"] < 80 and "HIGH_RISK_JURISDICTION" not in a["ruleCodes"])
    call("POST", f"/api/v1/alerts/{low['id']}/actions", "ANALYST", {"action": "START_REVIEW"})
    s, closed = call("POST", f"/api/v1/alerts/{low['id']}/actions", "ANALYST",
                     {"action": "CLOSE", "disposition": "FALSE_POSITIVE", "reason": "Property purchase, sale deed on file"})
    check("analyst closes low-risk alert with reason", s == 200 and closed["disposedBy"] == USERS["ANALYST"][0])
    s, _ = call("GET", f"/api/v1/alerts/{low['id']}", "ANALYST")
    check("closed alert still retrievable", s == 200)
    _, hist = call("GET", f"/api/v1/alerts/{low['id']}/history", "ANALYST")
    actions = [h["action"] for h in hist]
    check("audit trail has create -> review -> close with actor",
          actions[0] == "ALERT_CREATED" and "ALERT_START_REVIEW" in actions and actions[-1] == "ALERT_CLOSE"
          and hist[-1]["actor"] == USERS["ANALYST"][0], " -> ".join(actions))
    s, case = call("POST", f"/api/v1/alerts/{critical['id']}/actions", "ANALYST",
                   {"action": "ESCALATE", "reason": "Structuring plus sanctioned wire; needs investigation"})
    check("critical alert escalated to a case", s == 200 and case["caseRef"] is not None, case.get("caseRef"))

    for sql, label in [("DELETE FROM alert WHERE id = 1", "DELETE alert"), ("UPDATE audit_log SET actor = 'x'", "UPDATE audit_log")]:
        r = subprocess.run(["docker", "compose", "exec", "-T", "postgres", "psql", "-U", ENV["POSTGRES_USER"],
                            "-d", ENV["POSTGRES_DB"], "-c", sql], cwd=ROOT, capture_output=True, text=True)
        check(f"database rejects {label}", "not permitted" in r.stderr, r.stderr.strip().splitlines()[0] if r.stderr else "")

    print(f"\n{sum(RESULTS)}/{len(RESULTS)} checks passed")
    sys.exit(0 if all(RESULTS) else 1)


if __name__ == "__main__":
    main()
