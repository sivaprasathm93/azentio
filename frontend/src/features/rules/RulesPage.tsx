import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, FlaskConical, Search, X } from 'lucide-react'
import type { RuleConfig, SimulationRequest, SimulationResult } from '@/types/domain'
import { useCommitCountries, useCommitRule, useRules, useSimulateRule, useWatchlist } from '@/hooks/useRules'
import { useAuth } from '@/features/auth/authStore'
import { config } from '@/lib/config'
import { errorMessage } from '@/lib/api'
import { COUNTRIES, COUNTRY_BY_CODE } from '@/lib/fatf'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { EmptyState, ErrorPanel } from '@/components/ErrorBoundary'
import { Button } from '@/components/ui/button'
import { Badge, Input, Label, Skeleton } from '@/components/ui/primitives'
import { Dialog, DialogBody, DialogContent, DialogFooter, Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlays'

const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)

function Field({ id, label, hint, value, onChange, step, min, disabled }: { id: string; label: string; hint?: string; value: number; onChange: (n: number) => void; step?: number; min?: number; disabled: boolean }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" className="num" value={Number.isFinite(value) ? value : ''} step={step} min={min} disabled={disabled} onChange={(e) => onChange(e.target.valueAsNumber)} />
      {hint && <p className="text-[11.5px] text-muted">{hint}</p>}
    </div>
  )
}

function CardShell({ rule, dirty, valid, canEdit, onPreview, children }: { rule: RuleConfig; dirty: boolean; valid: boolean; canEdit: boolean; onPreview: () => void; children: React.ReactNode }) {
  return (
    <section className="flex flex-col rounded-[var(--radius)] border border-line bg-panel">
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <h2 className="display text-[15px]">{rule.name}</h2>
          <Badge tone="outline" className="num">
            v{rule.version}
          </Badge>
        </div>
        <p className="mt-1 text-[12px] text-muted">{rule.description}</p>
      </div>
      <div className="flex-1 space-y-3 px-4 py-3">{children}</div>
      <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5">
        <span className="text-[11.5px] text-muted">{rule.updatedAt ? `Last changed ${formatDateTime(rule.updatedAt)} by ${rule.updatedBy}` : 'Never changed'}</span>
        <Button size="sm" disabled={!dirty || !valid || !canEdit} onClick={onPreview}>
          <FlaskConical /> Preview impact
        </Button>
      </div>
    </section>
  )
}

/* ------------------------------- Structuring ------------------------------ */

function StructuringCard({ rule, canEdit, onPreview }: { rule: RuleConfig; canEdit: boolean; onPreview: (r: SimulationRequest) => void }) {
  const p = rule.params
  const init = { target: Math.round(num(p.upperAmount, 10000)), delta: Math.round(num(p.upperAmount, 10000)) - num(p.lowerAmount, 9000), windowHours: num(p.windowHours, 24), minCount: num(p.minCount, 3) }
  const [f, setF] = useState(init)
  useEffect(() => setF(init), [rule.version]) // eslint-disable-line react-hooks/exhaustive-deps
  const cur = String(p.currency ?? 'USD')
  const lower = f.target - f.delta
  const valid = f.target > 0 && f.delta > 0 && f.delta < f.target && f.windowHours >= 1 && f.minCount >= 2
  const dirty = JSON.stringify(f) !== JSON.stringify(init)

  return (
    <CardShell rule={rule} dirty={dirty} valid={valid} canEdit={canEdit} onPreview={() => onPreview({ code: rule.code, params: { lowerAmount: lower, upperAmount: f.target - 0.01, minCount: f.minCount, windowHours: f.windowHours } })}>
      <div className="grid grid-cols-2 gap-3">
        <Field id="s-target" label={`Target amount (${cur})`} value={f.target} onChange={(n) => setF({ ...f, target: n })} min={1} disabled={!canEdit} hint="The reporting threshold being dodged." />
        <Field id="s-delta" label="Delta threshold" value={f.delta} onChange={(n) => setF({ ...f, delta: n })} min={1} disabled={!canEdit} hint={valid ? `Flags ${lower.toLocaleString()}–${(f.target - 0.01).toLocaleString()}` : 'Must be below the target.'} />
        <Field id="s-window" label="Rolling window (hours)" value={f.windowHours} onChange={(n) => setF({ ...f, windowHours: n })} min={1} disabled={!canEdit} />
        <Field id="s-count" label="Minimum transactions" value={f.minCount} onChange={(n) => setF({ ...f, minCount: n })} min={2} disabled={!canEdit} />
      </div>
    </CardShell>
  )
}

/* ------------------------------ Rapid movement ----------------------------- */

function RapidCard({ rule, canEdit, onPreview }: { rule: RuleConfig; canEdit: boolean; onPreview: (r: SimulationRequest) => void }) {
  const p = rule.params
  const init = { ratio: num(p.outflowRatio, 0.8), minutes: num(p.windowHours, 48) * 60 }
  const [f, setF] = useState(init)
  useEffect(() => setF(init), [rule.version]) // eslint-disable-line react-hooks/exhaustive-deps
  const valid = f.ratio > 0 && f.ratio <= 1 && f.minutes >= 60 && f.minutes % 60 === 0
  const dirty = JSON.stringify(f) !== JSON.stringify(init)

  return (
    <CardShell rule={rule} dirty={dirty} valid={valid} canEdit={canEdit} onPreview={() => onPreview({ code: rule.code, params: { outflowRatio: f.ratio, windowHours: f.minutes / 60 } })}>
      <div className="grid grid-cols-2 gap-3">
        <Field id="r-ratio" label="In-to-out ratio" value={f.ratio} step={0.05} min={0.05} onChange={(n) => setF({ ...f, ratio: n })} disabled={!canEdit} hint="Share of inflow that must leave (0–1)." />
        <Field id="r-min" label="Max elapsed time (minutes)" value={f.minutes} step={60} min={60} onChange={(n) => setF({ ...f, minutes: n })} disabled={!canEdit} hint={f.minutes % 60 === 0 ? `${f.minutes / 60} h` : 'Use whole hours (multiples of 60).'} />
      </div>
    </CardShell>
  )
}

/* --------------------------- High-risk jurisdictions ----------------------- */

function CountryMultiSelect({ value, onChange, disabled, listNames }: { value: string[]; onChange: (v: string[]) => void; disabled: boolean; listNames: Record<string, string> }) {
  const [q, setQ] = useState('')
  const options = useMemo(() => COUNTRIES.filter((c) => `${c.code} ${c.name}`.toLowerCase().includes(q.toLowerCase())), [q])
  const toggle = (code: string) => onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code])

  return (
    <div className="space-y-2">
      <div className="flex min-h-8 flex-wrap gap-1.5">
        {value.length === 0 && <span className="text-[12px] text-muted">No jurisdictions selected.</span>}
        {value.map((code) => (
          <Badge key={code} tone="high" className="gap-1 !py-0.5">
            {code} · {COUNTRY_BY_CODE.get(code)?.name ?? code}
            {!disabled && (
              <button aria-label={`Remove ${code}`} onClick={() => toggle(code)} className="hover:opacity-70">
                <X className="size-3" />
              </button>
            )}
          </Badge>
        ))}
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" disabled={disabled}>
            Add jurisdictions
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0">
          <div className="relative border-b border-line p-2">
            <Search className="pointer-events-none absolute left-4 top-4 size-3.5 text-muted" />
            <Input aria-label="Search countries" className="pl-8" placeholder="Search country or ISO code" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </div>
          <ul role="listbox" aria-multiselectable className="scroll-thin max-h-64 overflow-y-auto p-1">
            {options.map((c) => {
              const on = value.includes(c.code)
              return (
                <li key={c.code} role="option" aria-selected={on}>
                  <button type="button" onClick={() => toggle(c.code)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-panel2">
                    <span className={cn('grid size-4 place-items-center rounded-[3px] border', on ? 'border-primary bg-primary text-primary-fg' : 'border-line-strong')}>{on && <Check className="size-3" />}</span>
                    <span className="num w-6 text-muted">{c.code}</span>
                    <span className="flex-1 truncate">{c.name}</span>
                    {(listNames[c.code] || c.fatf) && <span className="eyebrow !text-[9px]">{(listNames[c.code] ?? c.fatf)?.replace('FATF_', '').replace('_', ' ')}</span>}
                  </button>
                </li>
              )
            })}
            {options.length === 0 && <li className="p-3 text-center text-[12px] text-muted">No match.</li>}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function JurisdictionCard({ rule, active, listNames, canEdit, onPreview }: { rule: RuleConfig; active: string[]; listNames: Record<string, string>; canEdit: boolean; onPreview: (r: SimulationRequest) => void }) {
  const [sel, setSel] = useState(active)
  const key = active.join()
  useEffect(() => setSel(active), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = [...sel].sort().join() !== [...active].sort().join()

  return (
    <CardShell rule={rule} dirty={dirty} valid canEdit={canEdit} onPreview={() => onPreview({ code: rule.code, params: {}, countries: sel })}>
      <Label>Watchlisted countries (ISO 3166-1 alpha-2)</Label>
      <CountryMultiSelect value={sel} onChange={setSel} disabled={!canEdit} listNames={listNames} />
      <p className="text-[11.5px] text-muted">Any transaction to or from these countries alerts regardless of amount.</p>
    </CardShell>
  )
}

/* ------------------------------ Dry-run modal ------------------------------ */

function Bar({ label, value, max, tone }: { label: string; value: number; max: number; tone: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 text-[12px] text-muted">{label}</span>
      <div className="h-5 flex-1 rounded-sm bg-line/60">
        <div className="h-full rounded-sm" style={{ width: `${max ? (value / max) * 100 : 0}%`, background: tone }} />
      </div>
      <span className="num w-10 text-right text-[14px] font-semibold">{value}</span>
    </div>
  )
}

function DryRunDialog({ request, rule, onClose, canEdit }: { request: SimulationRequest | null; rule: RuleConfig | undefined; onClose: () => void; canEdit: boolean }) {
  const sim = useSimulateRule()
  const commitRule = useCommitRule()
  const commitCountries = useCommitCountries()
  const [result, setResult] = useState<SimulationResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setResult(null)
    setError(null)
    if (request) sim.mutate(request, { onSuccess: setResult, onError: (e) => setError(errorMessage(e)) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])

  async function commit() {
    if (!request) return
    setError(null)
    try {
      if (request.countries) await commitCountries.mutateAsync({ next: request.countries, reason: 'Tuned in the rule manager after a dry run' })
      else await commitRule.mutateAsync({ code: request.code, update: { params: request.params } })
      toast.success(`${rule?.name ?? 'Rule'} updated. It applies to the next transaction evaluated.`)
      onClose()
    } catch (e) {
      setError(errorMessage(e)) // includes the backend's regulatory-floor message on 422
    }
  }

  const max = result ? Math.max(result.currentAlerts, result.projectedAlerts, 1) : 1
  const delta = result ? result.projectedAlerts - result.currentAlerts : 0

  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Impact preview (dry run)" description={`${rule?.name ?? ''} — nothing changes until you commit.`}>
        <DialogBody className="space-y-4">
          {sim.isPending && (
            <div className="space-y-2" aria-busy="true" aria-label="Running simulation">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          )}
          {result && (
            <>
              <div className="space-y-2">
                <Bar label="Today" value={result.currentAlerts} max={max} tone="var(--muted)" />
                <Bar label="After change" value={result.projectedAlerts} max={max} tone={delta > 0 ? 'var(--risk-high)' : 'var(--risk-low)'} />
                <p className="text-[12px] text-muted">Alerts over the last {result.windowDays} days.</p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  ['Newly raised', `+${result.newlyRaised}`, result.newlyRaised ? 'var(--risk-high)' : undefined],
                  ['Suppressed', `−${result.suppressed}`, result.suppressed ? 'var(--risk-low)' : undefined],
                  ['Critical alerts', `${result.criticalDelta >= 0 ? '+' : '−'}${Math.abs(result.criticalDelta)}`, result.criticalDelta < 0 ? 'var(--risk-critical)' : undefined],
                ].map(([l, v, c]) => (
                  <div key={l} className="rounded border border-line p-2">
                    <div className="eyebrow">{l}</div>
                    <div className="num text-[20px] font-semibold" style={c ? { color: c } : undefined}>
                      {v}
                    </div>
                  </div>
                ))}
              </div>
              {result.suppressed > 0 && (
                <p role="alert" className="rounded border border-high/40 bg-high/10 p-2.5 text-[12px] text-high">
                  This change would stop {result.suppressed} alert{result.suppressed === 1 ? '' : 's'} from being raised
                  {result.criticalDelta < 0 ? `, ${Math.abs(result.criticalDelta)} of them critical` : ''}. Confirm that is intended before committing.
                </p>
              )}
              {result.samples.length > 0 && (
                <ul className="divide-y divide-line rounded border border-line text-[12px]">
                  {result.samples.map((s) => (
                    <li key={s.alertRef} className="flex items-center justify-between px-2.5 py-1.5">
                      <span className="num">{s.alertRef}</span>
                      <span className="truncate px-2 text-muted">{s.customerName}</span>
                      <Badge tone="low">would be suppressed · {s.score}</Badge>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[11.5px] text-muted">
                {result.source === 'backend' ? 'Replayed by the server against stored transactions.' : 'Modelled estimate from current thresholds; not a transaction replay.'}
                {config.mode === 'mock' && ' Demo mode scales illustrative portfolio volumes.'} Regulatory floors are enforced by the server on commit.
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="rounded border border-critical/40 bg-critical/10 p-2.5 text-[12.5px] text-critical">
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Discard
          </Button>
          <Button disabled={!result || !canEdit} loading={commitRule.isPending || commitCountries.isPending} onClick={commit}>
            Commit change
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------------------------------- page ---------------------------------- */

export default function RulesPage() {
  const rules = useRules()
  const watch = useWatchlist()
  const canEdit = useAuth((s) => s.can('ADMIN'))
  const [request, setRequest] = useState<SimulationRequest | null>(null)

  const byCode = (code: string) => rules.data?.find((r) => r.code === code)
  const countries = (watch.data ?? []).filter((w) => w.entryType === 'COUNTRY')
  const active = countries.filter((w) => w.active).map((w) => w.value)
  const listNames = Object.fromEntries(countries.map((w) => [w.value, w.listName]))

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-line bg-panel px-5 py-4">
        <h1 className="display text-[22px] leading-none">Rules and typologies</h1>
        <p className="mt-1.5 text-[12px] text-muted">Tune detection thresholds without a redeploy. Every change is previewed first, versioned and audited.</p>
        {!canEdit && (
          <p className="mt-2 inline-block rounded border border-line bg-panel2 px-2.5 py-1 text-[12px]">You can view rules but not change them. Editing needs the admin role.</p>
        )}
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-5">
        {(rules.isError || watch.isError) && <ErrorPanel title="Rules could not be loaded" message={errorMessage(rules.error ?? watch.error)} onRetry={() => { void rules.refetch(); void watch.refetch() }} />}
        {(rules.isLoading || watch.isLoading) && (
          <div className="grid gap-4 xl:grid-cols-3" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-72" />
            ))}
          </div>
        )}
        {rules.data && watch.data && (
          <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {byCode('STRUCTURING') && <StructuringCard rule={byCode('STRUCTURING')!} canEdit={canEdit} onPreview={setRequest} />}
            {byCode('RAPID_MOVEMENT') && <RapidCard rule={byCode('RAPID_MOVEMENT')!} canEdit={canEdit} onPreview={setRequest} />}
            {byCode('HIGH_RISK_JURISDICTION') && <JurisdictionCard rule={byCode('HIGH_RISK_JURISDICTION')!} active={active} listNames={listNames} canEdit={canEdit} onPreview={setRequest} />}
            {!byCode('STRUCTURING') && !byCode('RAPID_MOVEMENT') && !byCode('HIGH_RISK_JURISDICTION') && <EmptyState title="No tunable rules found" hint="The backend returned no structuring, rapid-movement or jurisdiction rules." />}
          </div>
        )}
      </div>

      <DryRunDialog request={request} rule={request ? byCode(request.code) : undefined} onClose={() => setRequest(null)} canEdit={canEdit} />
    </div>
  )
}
