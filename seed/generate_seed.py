#!/usr/bin/env python3
"""
Synthetic seed data for Sentinel AML. No real PII: names are combined from fictitious word lists and IDs are random.

Produces (in this directory):
  customers.csv, accounts.csv, transactions.csv   ~500 customers, ~800 accounts, ~12,000 transactions over 120 days
  transactions_malformed.csv                       rows that must be rejected by ingestion validation
  scenarios.json                                   which customers carry which planted laundering typology

Baseline activity is deliberately "clean" (non-round amounts, domestic counterparties, modest values) so the planted
typologies stand out. Deterministic for a given --seed; dates are relative to --end (default: today, UTC).

Usage: python generate_seed.py [--seed 42] [--end 2026-09-19]
"""
import argparse
import csv
import json
import random
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent
DAYS = 120
IST = timezone(timedelta(hours=5, minutes=30))

FIRST = ["Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Ayaan", "Krishna", "Ishaan", "Ananya",
         "Diya", "Saanvi", "Aadhya", "Kiara", "Myra", "Anika", "Navya", "Riya", "Meera", "Kabir", "Rohan", "Nikhil",
         "Priya", "Kavya", "Tara", "Zoya", "Farhan", "Imran", "Neha", "Rahul", "Sneha", "Vikram", "Lakshmi", "Omar",
         "Elena", "Marcus", "Hana", "Leo", "Nora"]
LAST = ["Vardhan", "Kestrel", "Malhotri", "Sundaram", "Rathore", "Iyengar", "Bhandari", "Castellan", "Devraj",
        "Easwar", "Fernhill", "Ganeshan", "Harikumar", "Jadhavan", "Kulkarn", "Lokesh", "Mirchandan", "Narang",
        "Oberai", "Pillaiyar", "Quereshi", "Raghunath", "Sethuram", "Thakkar", "Upadhyay", "Venkatesh", "Wadekar",
        "Yeshwant", "Zaveri", "Ashbury"]
BIZ_SUFFIX = ["Traders", "Exports", "Logistics", "Textiles", "Agro Foods", "Infotech", "Pharma Distributors",
              "Hardware Mart", "Auto Parts", "Jewellers"]
MERCHANTS = ["Grocery Mart", "City Power Board", "Metro Rail Card", "PhoneNet Telecom", "Apollo Pharmacy Store",
             "BookWorld", "FuelPoint", "RentPay Housing", "Swiggle Foods", "Insure Life Co", "School Fees Trust",
             "Cinema Plex", "Cloud Kitchen Co", "Hospital Billing", "Water Board"]
DOMESTIC = ["IN"] * 20 + ["AE", "GB", "SG", "US"]
HIGH_RISK = ["IR", "KP", "MM", "SY"]
SANCTIONED = ["Orion Shell Holdings Ltd", "Blue Lagoon Trading FZE"]


class Gen:
    def __init__(self, seed, end):
        self.r = random.Random(seed)
        self.end = end
        self.start = end - timedelta(days=DAYS)
        self.customers, self.accounts, self.txns = [], [], []
        self.scenarios = {}
        self.txn_seq = 0

    # ------------------------------------------------------------------ helpers
    def ts(self, day_offset, hour=None, minute=None):
        """Timestamp `day_offset` days after start, at an IST business hour."""
        d = self.start + timedelta(days=day_offset)
        h = hour if hour is not None else self.r.randint(8, 20)
        m = minute if minute is not None else self.r.randint(0, 59)
        return datetime.combine(d, time(h, m, self.r.randint(0, 59)), IST).astimezone(timezone.utc)

    def odd(self, lo, hi):
        """Non-round amount (paise and non-zero units)."""
        v = round(self.r.uniform(lo, hi), 2)
        if v % 10 == 0:
            v += 7.35
        return v

    def txn(self, acct, direction, amount, when, channel, cp_name=None, cp_country="IN", currency=None):
        self.txn_seq += 1
        self.txns.append({
            "txn_ref": f"TXN{self.txn_seq:07d}",
            "account_number": acct["account_number"],
            "direction": direction,
            "amount": f"{amount:.2f}",
            "currency": currency or acct["currency"],
            "counterparty_name": cp_name or "",
            "counterparty_account": f"CP{self.r.randint(10**9, 10**10 - 1)}" if cp_name else "",
            "counterparty_country": cp_country or "",
            "channel": channel,
            "jurisdiction": cp_country or "",
            "occurred_at": when.strftime("%Y-%m-%dT%H:%M:%SZ"),
        })

    def tag(self, typology, cust, note):
        self.scenarios.setdefault(typology, []).append({"customerRef": cust["external_ref"], "note": note})

    # ------------------------------------------------------------------ master data
    def build_customers(self, n=500):
        for i in range(1, n + 1):
            business = self.r.random() < 0.15
            name = f"{self.r.choice(LAST)} {self.r.choice(BIZ_SUFFIX)}" if business else \
                f"{self.r.choice(FIRST)} {self.r.choice(LAST)}"
            letters = "".join(self.r.choice("ABCDEFGHJKLMNPQRSTUVWXYZ") for _ in range(5))
            risk = self.r.choices(["LOW", "MEDIUM", "HIGH"], [80, 15, 5])[0]
            dob = date(1950, 1, 1) + timedelta(days=self.r.randint(0, 18000))
            self.customers.append({
                "external_ref": f"C{i:05d}", "full_name": name,
                "national_id": f"{letters}{self.r.randint(1000, 9999)}{self.r.choice('ABCDEFGHJK')}",
                "date_of_birth": "" if business else dob.isoformat(),
                "customer_type": "BUSINESS" if business else "RETAIL",
                "country": self.r.choices(["IN", "AE", "GB", "SG"], [92, 3, 3, 2])[0],
                "kyc_risk_rating": risk,
            })
        acct_no = 5000000000
        for c in self.customers:
            n_acc = 1 if self.r.random() < 0.4 else 2
            for k in range(n_acc):
                acct_no += self.r.randint(1, 97)
                business = c["customer_type"] == "BUSINESS"
                if business:
                    typ = "BUSINESS" if k == 0 else "CURRENT"
                else:
                    typ = "SAVINGS" if k == 0 else self.r.choice(["CURRENT", "NRE", "WALLET"])
                ccy = "USD" if (typ == "CURRENT" and self.r.random() < 0.25) else "INR"
                self.accounts.append({
                    "account_number": f"MT{acct_no}", "customer_ref": c["external_ref"], "account_type": typ,
                    "currency": ccy,
                    "opened_on": (self.start - timedelta(days=self.r.randint(60, 2000))).isoformat(),
                    "risk_rating": c["kyc_risk_rating"] if self.r.random() < 0.8 else "MEDIUM",
                    "status": "ACTIVE", "_customer": c,
                })

    def accounts_of(self, cust):
        return [a for a in self.accounts if a["_customer"] is cust]

    # ------------------------------------------------------------------ clean baseline
    def baseline(self):
        for a in self.accounts:
            business = a["_customer"]["customer_type"] == "BUSINESS"
            fx = 83.5 if a["currency"] == "USD" else 1.0
            if not business and a["account_type"] == "SAVINGS":
                salary = self.odd(40000, 150000)
                for month_day in range(3, DAYS, 30):
                    self.txn(a, "CREDIT", salary / fx, self.ts(month_day, 10), "NEFT", "Employer Payroll Pvt Ltd")
            n = self.r.randint(20, 30) if business else self.r.randint(8, 15)
            for _ in range(n):
                day = self.r.randint(0, DAYS - 1)
                if business:
                    direction = self.r.choice(["CREDIT", "DEBIT"])
                    amt = self.odd(20000, 180000)
                    ch = self.r.choice(["NEFT", "RTGS", "IMPS", "CHEQUE"])
                    cp = f"{self.r.choice(LAST)} {self.r.choice(BIZ_SUFFIX)}"
                else:
                    direction = "DEBIT" if self.r.random() < 0.8 else "CREDIT"
                    amt = self.odd(300, 45000)
                    ch = self.r.choice(["UPI", "CARD", "IMPS", "ATM", "NEFT"])
                    cp = self.r.choice(MERCHANTS)
                self.txn(a, direction, amt / fx, self.ts(day), ch, cp, self.r.choice(DOMESTIC))

    # ------------------------------------------------------------------ planted typologies
    def pick(self, pool, n, retail=None):
        chosen = []
        for c in pool:
            if len(chosen) == n:
                break
            if retail is None or (c["customer_type"] == "RETAIL") == retail:
                chosen.append(c)
        for c in chosen:
            pool.remove(c)
        return chosen

    def plant(self):
        pool = self.customers[:]
        self.r.shuffle(pool)

        # 1. Structuring: 3-5 deposits just under USD 10,000 within 24h
        for c in self.pick(pool, 15):
            a = self.accounts_of(c)[0]
            day = self.r.randint(40, DAYS - 2)
            count = self.r.randint(3, 5)
            for k in range(count):
                if a["currency"] == "USD":
                    amt, ccy = self.r.uniform(9050, 9950), "USD"
                else:
                    amt, ccy = self.r.uniform(9050, 9950) * 83.5, "INR"
                self.txn(a, "CREDIT", round(amt, 2), self.ts(day, 9 + k * 3), "CASH", "Cash deposit - branch", "IN", ccy)
            self.tag("STRUCTURING", c, f"{count} cash deposits just below USD 10k on day {day}")

        # 2. Rapid movement: large inflow, 85-98% out within 6-40h (money mule / layering)
        for c in self.pick(pool, 12):
            a = self.accounts_of(c)[0]
            fx = 83.5 if a["currency"] == "USD" else 1.0
            day = self.r.randint(30, DAYS - 3)
            inflow = self.odd(1200000, 4000000)
            self.txn(a, "CREDIT", inflow / fx, self.ts(day, 10), "RTGS", f"{self.r.choice(LAST)} Ventures LLP")
            outs = self.r.randint(2, 4)
            share = self.r.uniform(0.85, 0.98) * inflow
            for k in range(outs):
                hours = 6 + k * self.r.randint(5, 11)
                when = self.ts(day, 10) + timedelta(hours=hours)
                self.txn(a, "DEBIT", round(share / outs, 2) / fx, when, self.r.choice(["IMPS", "NEFT", "SWIFT"]),
                         f"{self.r.choice(FIRST)} {self.r.choice(LAST)}", self.r.choice(["IN", "IN", "AE", "SG"]))
            self.tag("RAPID_MOVEMENT", c, f"INR {inflow:,.0f} in and ~{share / inflow:.0%} out within ~{hours}h on day {day}")

        # 3. High-risk jurisdictions and sanctioned counterparties (any amount)
        for c in self.pick(pool, 10):
            a = self.accounts_of(c)[0]
            fx = 83.5 if a["currency"] == "USD" else 1.0
            day = self.r.randint(10, DAYS - 1)
            country = self.r.choice(HIGH_RISK)
            self.txn(a, self.r.choice(["DEBIT", "CREDIT"]), self.odd(15000, 600000) / fx, self.ts(day), "SWIFT",
                     f"{self.r.choice(LAST)} General Trading", country)
            self.tag("HIGH_RISK_JURISDICTION", c, f"SWIFT transfer with {country} on day {day}")
        for c, party in zip(self.pick(pool, 2), SANCTIONED):
            a = self.accounts_of(c)[0]
            fx = 83.5 if a["currency"] == "USD" else 1.0
            day = self.r.randint(60, DAYS - 1)
            self.txn(a, "DEBIT", self.odd(250000, 900000) / fx, self.ts(day), "SWIFT", party, "AE")
            self.tag("HIGH_RISK_JURISDICTION", c, f"payment to watch-listed counterparty '{party}' on day {day}")

        # 4. Behavioural deviation: quiet retail customer suddenly moves a lot in one day
        for c in self.pick(pool, 10, retail=True):
            a = self.accounts_of(c)[0]
            fx = 83.5 if a["currency"] == "USD" else 1.0
            day = self.r.randint(DAYS - 30, DAYS - 1)
            n = self.r.randint(4, 7)
            total = 0
            for k in range(n):
                amt = self.odd(90000, 240000)
                total += amt
                self.txn(a, self.r.choice(["CREDIT", "DEBIT"]), amt / fx, self.ts(day, 9 + k), "IMPS",
                         f"{self.r.choice(FIRST)} {self.r.choice(LAST)}")
            self.tag("BEHAVIORAL_DEVIATION", c, f"{n} transfers totalling INR {total:,.0f} on day {day}")

        # 5. Repeated round amounts
        for c in self.pick(pool, 10):
            a = self.accounts_of(c)[0]
            day = self.r.randint(20, DAYS - 6)
            n = self.r.randint(3, 5)
            for k in range(n):
                amt = self.r.choice([100000, 150000, 200000, 250000, 500000])
                if a["currency"] == "USD":
                    amt = self.r.choice([2000, 3000, 5000])
                self.txn(a, "DEBIT", amt, self.ts(day + k), self.r.choice(["NEFT", "RTGS", "CASH"]),
                         f"{self.r.choice(FIRST)} {self.r.choice(LAST)}")
            self.tag("ROUND_AMOUNT", c, f"{n} round-amount transfers from day {day}")

        # 6. Single large transactions (CTR) - mostly legitimate, low risk score
        for c in self.pick(pool, 15):
            a = self.accounts_of(c)[0]
            fx = 83.5 if a["currency"] == "USD" else 1.0
            day = self.r.randint(0, DAYS - 1)
            amt = self.odd(900000, 3000000)
            self.txn(a, "DEBIT", amt / fx, self.ts(day), "RTGS", "Skyline Realty Developers")
            self.tag("CTR_THRESHOLD", c, f"single RTGS of INR {amt:,.0f} (property purchase) on day {day}")

        # 7. Layering ring: HIGH-risk customer combining structuring, pass-through and a high-risk wire
        ring = self.pick(pool, 3)
        for c in ring:
            c["kyc_risk_rating"] = "HIGH"
            a = self.accounts_of(c)[0]
            day = self.r.randint(DAYS - 10, DAYS - 3)
            for k in range(4):
                self.txn(a, "CREDIT", round(self.r.uniform(9200, 9900) * 83.5, 2), self.ts(day, 9 + k * 2), "CASH",
                         "Cash deposit - branch", currency="INR")
            self.txn(a, "DEBIT", 3100000.0, self.ts(day + 1, 11), "SWIFT", "Orion Shell Holdings Ltd", "AE", currency="INR")
            self.txn(a, "DEBIT", 150000.0, self.ts(day + 1, 15), "SWIFT", "Kaveh Import Export", "IR", currency="INR")
            self.tag("LAYERING_RING", c, f"structuring + pass-through to sanctioned party + IR wire from day {day}")

    # ------------------------------------------------------------------ output
    def malformed(self):
        acct = self.accounts[0]["account_number"]
        future = (datetime.now(timezone.utc) + timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%SZ")
        ok_time = self.ts(DAYS - 1).strftime("%Y-%m-%dT%H:%M:%SZ")
        header = list(self.txns[0].keys())
        rows = [
            ["BAD0001", acct, "SIDEWAYS", "100.00", "INR", "", "", "IN", "UPI", "IN", ok_time],
            ["BAD0002", acct, "DEBIT", "-50.00", "INR", "", "", "IN", "UPI", "IN", ok_time],
            ["BAD0003", "MT0000000000", "DEBIT", "100.00", "INR", "", "", "IN", "UPI", "IN", ok_time],
            ["BAD0004", acct, "DEBIT", "100.00", "XYZ", "", "", "IN", "UPI", "IN", ok_time],
            ["BAD0005", acct, "DEBIT", "100.00", "INR", "", "", "IN", "UPI", "IN", future],
            ["BAD0006", acct, "DEBIT", "abc", "INR", "", "", "IN", "UPI", "IN", ok_time],
            ["BAD0007", acct, "DEBIT", "100.00", "INR", "", "", "IN", "PIGEON", "IN", ok_time],
            ["BAD0008", acct, "DEBIT"],
            ["GOOD0001", acct, "DEBIT", "1234.56", "INR", "Grocery Mart", "", "IN", "UPI", "IN", ok_time],
            ["GOOD0001", acct, "DEBIT", "1234.56", "INR", "Grocery Mart", "", "IN", "UPI", "IN", ok_time],
        ]
        with open(OUT / "transactions_malformed.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(header)
            w.writerows(rows)

    def write(self):
        def dump(name, rows, fields):
            with open(OUT / name, "w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
                w.writeheader()
                w.writerows(rows)

        dump("customers.csv", self.customers, ["external_ref", "full_name", "national_id", "date_of_birth",
                                               "customer_type", "country", "kyc_risk_rating"])
        dump("accounts.csv", self.accounts, ["account_number", "customer_ref", "account_type", "currency",
                                             "opened_on", "risk_rating", "status"])
        self.txns.sort(key=lambda t: t["occurred_at"])
        dump("transactions.csv", self.txns, list(self.txns[0].keys()))
        self.malformed()
        with open(OUT / "scenarios.json", "w", encoding="utf-8") as f:
            json.dump({"generatedFor": self.end.isoformat(), "windowDays": DAYS, "typologies": self.scenarios}, f, indent=2)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--end", type=date.fromisoformat, default=datetime.now(timezone.utc).date() - timedelta(days=1))
    args = p.parse_args()
    g = Gen(args.seed, args.end)
    g.build_customers()
    g.baseline()
    g.plant()
    g.write()
    print(f"customers={len(g.customers)} accounts={len(g.accounts)} transactions={len(g.txns)}")
    for k, v in g.scenarios.items():
        print(f"  {k:<24} {len(v)} customers")


if __name__ == "__main__":
    main()
