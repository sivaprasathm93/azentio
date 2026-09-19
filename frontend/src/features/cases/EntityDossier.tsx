import { Link } from 'react-router-dom'
import { AlertTriangle, EyeOff, Landmark, ShieldCheck } from 'lucide-react'
import type { Alert, AMLTransaction, CustomerProfile } from '@/types/domain'
import { formatDate, formatMoney, formatTenure, humanizeEnum, initials } from '@/lib/format'
import { KYC_TIER_LABEL } from '@/lib/risk'
import { countryName } from '@/lib/fatf'
import { cn } from '@/lib/utils'
import { RiskBadge } from '@/components/RiskBadge'
import { Badge, Tip } from '@/components/ui/primitives'

const DAY = 86_400_000

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-3.5">
      <h3 className="eyebrow mb-2">{title}</h3>
      {children}
    </section>
  )
}

/** Stated income against what actually moved in the last 30 days. The meter's tick marks 1x income. */
function VelocityMeter({ customer, transactions, currency }: { customer: CustomerProfile; transactions: AMLTransaction[]; currency: string }) {
  const since = Date.now() - 30 * DAY
  const recent = transactions.filter((t) => Date.parse(t.timestamp) >= since)
  const inflow = recent.filter((t) => t.direction === 'CREDIT').reduce((s, t) => s + t.amountBase, 0)
  const outflow = recent.filter((t) => t.direction === 'DEBIT').reduce((s, t) => s + t.amountBase, 0)
  const income = customer.statedMonthlyIncome
  const velocity = inflow + outflow
  const ratio = income ? velocity / income : null
  // scale so that 1x sits at 25% of the track and anything >4x pins to the end
  const pct = ratio == null ? 0 : Math.min(100, (ratio / 4) * 100)
  const hot = ratio != null && ratio > 3

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[11.5px] text-muted">Stated monthly income</div>
          <div className="num text-[15px] font-semibold">{income == null ? <span className="text-muted">Not on file</span> : formatMoney(income, customer.currency)}</div>
        </div>
        <div>
          <div className="text-[11.5px] text-muted">30-day velocity</div>
          <div className={cn('num text-[15px] font-semibold', hot && 'text-critical')}>{formatMoney(velocity, currency)}</div>
        </div>
      </div>
      {ratio != null && (
        <div className="mt-2.5" role="img" aria-label={`Velocity is ${ratio.toFixed(1)} times stated monthly income`}>
          <div className="relative h-2 rounded-full bg-line">
            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: hot ? 'var(--risk-critical)' : 'var(--primary)' }} />
            <div className="absolute -top-1 bottom-[-4px] w-px bg-ink" style={{ left: '25%' }} title="1× income" />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-muted">
            <span>0</span>
            <span className={cn('num font-semibold', hot && 'text-critical')}>{ratio.toFixed(1)}× income</span>
          </div>
        </div>
      )}
      <div className="mt-2 grid grid-cols-2 gap-3 text-[12px]">
        <div>
          <span className="text-muted">In </span>
          <span className="num font-medium">{formatMoney(inflow, currency, true)}</span>
        </div>
        <div>
          <span className="text-muted">Out </span>
          <span className="num font-medium">{formatMoney(outflow, currency, true)}</span>
        </div>
      </div>
    </div>
  )
}

export function EntityDossier({
  customer,
  alerts,
  transactions,
  flagged,
  currency,
}: {
  customer: CustomerProfile
  alerts: Alert[]
  transactions: AMLTransaction[]
  flagged: AMLTransaction[]
  currency: string
}) {
  const involved = new Set(flagged.map((t) => t.accountId))

  return (
    <div>
      <div className="flex items-center gap-3 border-b border-line px-4 py-4">
        <span className="display grid size-11 shrink-0 place-items-center rounded-full bg-ink text-[15px] text-bg" aria-hidden>
          {initials(customer.fullName)}
        </span>
        <div className="min-w-0">
          <h2 className="display truncate text-[17px] leading-tight">{customer.fullName}</h2>
          <div className="num text-[12px] text-muted">{customer.ref}</div>
          <div className="text-[12px] text-muted">
            {humanizeEnum(customer.customerType)}
            {customer.city ? ` · ${customer.city}` : ''} · {countryName(customer.country)}
          </div>
        </div>
      </div>

      <Section title="Risk profile">
        <div className="flex flex-wrap gap-1.5">
          <Tip label={KYC_TIER_LABEL[customer.kycTier]}>
            <Badge tone={customer.kycTier === 3 ? 'high' : customer.kycTier === 2 ? 'medium' : 'low'}>
              <ShieldCheck className="size-3" /> KYC tier {customer.kycTier}
            </Badge>
          </Tip>
          <Badge tone="outline">Rating {customer.kycRating}</Badge>
          {customer.isPep === true && (
            <Badge tone="critical">
              <AlertTriangle className="size-3" /> PEP
            </Badge>
          )}
          {customer.isPep === false && <Badge tone="outline">Not a PEP</Badge>}
          {customer.isPep === null && <Badge tone="outline">PEP status not on file</Badge>}
          {customer.sanctionsHit ? (
            <Badge tone="critical">
              <AlertTriangle className="size-3" /> Sanctions match
            </Badge>
          ) : (
            <Badge tone="outline">No sanctions match</Badge>
          )}
        </div>
        {customer.piiMasked && (
          <p className="mt-2 flex items-start gap-1.5 text-[11.5px] text-muted">
            <EyeOff className="mt-0.5 size-3 shrink-0" /> Identity details are masked for your role. Supervisors can view them.
          </p>
        )}
      </Section>

      <Section title="Relationship">
        <dl className="divide-y divide-line text-[12.5px]">
          <Fact label="Customer since">
            {formatDate(customer.onboardedOn)} <span className="text-muted">· {formatTenure(customer.onboardedOn)}</span>
          </Fact>
          {customer.segment && <Fact label="Segment">{humanizeEnum(customer.segment)}</Fact>}
          {customer.age != null && <Fact label="Age">{customer.age}</Fact>}
          {customer.nationalId && <Fact label="National ID">{customer.nationalId}</Fact>}
        </dl>
      </Section>

      <Section title="Income vs 30-day velocity">
        <VelocityMeter customer={customer} transactions={transactions} currency={currency} />
      </Section>

      <Section title={`Linked accounts (${customer.accounts.length})`}>
        {customer.accounts.length === 0 && <p className="text-[12px] text-muted">No accounts on file.</p>}
        <ul className="space-y-2">
          {customer.accounts.map((a) => (
            <li key={a.id} className={cn('rounded border p-2.5', involved.has(a.accountNumber) ? 'border-critical/50 bg-critical/5' : 'border-line')}>
              <div className="flex items-center justify-between gap-2">
                <span className="num flex items-center gap-1.5 text-[12.5px] font-semibold">
                  <Landmark className="size-3.5 text-muted" />
                  {a.accountNumber}
                </span>
                {involved.has(a.accountNumber) ? <Badge tone="critical">In evidence</Badge> : <Badge tone={a.status === 'ACTIVE' ? 'low' : 'high'}>{humanizeEnum(a.status)}</Badge>}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 text-[11.5px] text-muted">
                <span>{humanizeEnum(a.accountType)}</span>
                <span>{a.currency}</span>
                {a.branch && <span>{a.branch}</span>}
                <span>Opened {formatDate(a.openedOn)}</span>
              </div>
              {a.balance != null && (
                <div className="num mt-1 text-[12px]">
                  <span className="text-muted">Balance </span>
                  {formatMoney(a.balance, a.currency)}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`Alerts in this case (${alerts.length})`}>
        <ul className="space-y-1.5">
          {alerts.map((a) => (
            <li key={a.id} className="flex items-center gap-3">
              <RiskBadge score={a.overallScore} />
              <div className="min-w-0 text-[12px]">
                <div className="num font-semibold">{a.alertRef}</div>
                <div className="truncate text-muted">{a.evidence.map((e) => e.typology).join(', ')}</div>
              </div>
            </li>
          ))}
        </ul>
        <Link to="/alerts" className="mt-2 inline-block text-[12px] font-semibold text-primary hover:underline">
          Back to alert queue
        </Link>
      </Section>
    </div>
  )
}
