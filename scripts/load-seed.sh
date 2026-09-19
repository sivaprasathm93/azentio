#!/usr/bin/env bash
# Loads the synthetic seed through the public ingestion API (CSV upload), in dependency order:
# customers -> accounts -> transactions (bulk detection runs as part of the transaction load).
# Then demonstrates validation by uploading a file of malformed rows.
#
# Usage: scripts/load-seed.sh [base-url]      (reads admin credentials from .env)
set -euo pipefail
cd "$(dirname "$0")/.."
BASE="${1:-http://localhost:8080}"
set -a; source .env; set +a
AUTH="${SENTINEL_ADMIN_USER}:${SENTINEL_ADMIN_PASSWORD}"

summary() { python -c "import json,sys; d=json.load(sys.stdin); det=d.get('detection') or {}; print(f\"  {d['recordType']:<12} received={d['received']} accepted={d['accepted']} duplicates={d['duplicates']} rejected={d['rejected']} ingestMs={d['ingestMs']}\" + (f\"\n  detection: evaluated={det['evaluated']} alertsCreated={det['alertsCreated']} alertsUpdated={det['alertsUpdated']} failures={det['failures']} elapsedMs={det['elapsedMs']} ({det['txnPerSecond']} txn/s)\" if det else '')); [print(f\"    line {e['line']}: {e.get('key')} -> {e['error']}\") for e in d['errors'][:12]]"; }

upload() { curl -sS --fail-with-body -u "$AUTH" -F "file=@seed/$2" "$BASE/api/v1/ingest/$1/csv${3:-}" | summary; }

echo "Loading seed into $BASE"
upload customers customers.csv
upload accounts accounts.csv
start=$(date +%s)
upload transactions transactions.csv
echo "  wall clock for transaction load + detection: $(( $(date +%s) - start ))s"
echo "Validation demo (malformed rows are rejected individually, valid rows still load):"
upload transactions transactions_malformed.csv
