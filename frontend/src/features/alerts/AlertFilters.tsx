import { Check, ChevronDown, Search, X } from 'lucide-react'
import type { Alert, RiskBand } from '@/types/domain'
import { useAlertFilters, type AssigneeFilter, type DatePreset, type StatusScope } from './store'
import { activeFilterCount, bandCounts } from './filtering'
import { ALL_TYPOLOGIES } from '@/lib/typology'
import { BAND_ORDER, bandRange, bandVar } from '@/lib/risk'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input, Switch, Label } from '@/components/ui/primitives'
import { Popover, PopoverContent, PopoverTrigger, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/overlays'

function BandChip({ band, count }: { band: RiskBand; count: number }) {
  const active = useAlertFilters((s) => s.bands.includes(band))
  const toggle = useAlertFilters((s) => s.toggleBand)
  const r = bandRange(band)
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => toggle(band)}
      className={cn(
        'flex h-8 items-center gap-2 rounded-[var(--radius)] border px-2.5 text-[12px] font-semibold transition-colors',
        active ? 'border-transparent text-white' : 'border-line-strong bg-panel text-ink hover:bg-panel2',
      )}
      style={active ? { background: bandVar[band] } : undefined}
    >
      <span className="size-2 rounded-full" style={{ background: active ? '#fff' : bandVar[band] }} aria-hidden />
      {r.label}
      <span className={cn('num text-[11px]', active ? 'text-white/85' : 'text-muted')}>
        {r.min}–{r.max}
      </span>
      <span className={cn('num rounded px-1 text-[11px]', active ? 'bg-white/20' : 'bg-panel2')}>{count}</span>
    </button>
  )
}

function TypologyFilter() {
  const selected = useAlertFilters((s) => s.typologies)
  const toggle = useAlertFilters((s) => s.toggleTypology)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="min-w-36 justify-between">
          <span>{selected.length ? `Typology · ${selected.length}` : 'Typology'}</span>
          <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60">
        <ul role="listbox" aria-multiselectable aria-label="Typology">
          {ALL_TYPOLOGIES.map((t) => {
            const on = selected.includes(t)
            return (
              <li key={t} role="option" aria-selected={on}>
                <button
                  type="button"
                  onClick={() => toggle(t)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-panel2"
                >
                  <span className={cn('grid size-4 place-items-center rounded-[3px] border', on ? 'border-primary bg-primary text-primary-fg' : 'border-line-strong')}>
                    {on && <Check className="size-3" />}
                  </span>
                  {t}
                </button>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

export function AlertFilters({ alerts, me, shown }: { alerts: Alert[]; me: string | undefined; shown: number }) {
  const f = useAlertFilters()
  const counts = bandCounts(alerts, f, me)
  const n = activeFilterCount(f)

  return (
    <section aria-label="Filters" className="space-y-2.5 border-b border-line bg-panel2 px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted" />
          <Input
            aria-label="Search alerts"
            placeholder="Search name, CIF ID or alert ref"
            className="pl-8"
            value={f.search}
            onChange={(e) => f.set({ search: e.target.value })}
          />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Risk band">
          {BAND_ORDER.map((b) => (
            <BandChip key={b} band={b} count={counts[b]} />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <TypologyFilter />

        <div className="w-40">
          <Select value={f.assignee} onValueChange={(v) => f.set({ assignee: v as AssigneeFilter })}>
            <SelectTrigger aria-label="Assignee">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ANY">Any assignee</SelectItem>
              <SelectItem value="ME">Assigned to me</SelectItem>
              <SelectItem value="UNASSIGNED">Unassigned</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="w-36">
          <Select value={f.datePreset} onValueChange={(v) => f.set({ datePreset: v as DatePreset })}>
            <SelectTrigger aria-label="Date range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Any time</SelectItem>
              <SelectItem value="24h">Last 24 hours</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="CUSTOM">Custom range…</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {f.datePreset === 'CUSTOM' && (
          <div className="flex items-center gap-1.5">
            <Input type="date" aria-label="From date" className="w-36" value={f.from ?? ''} max={f.to ?? undefined} onChange={(e) => f.set({ from: e.target.value || null })} />
            <span className="text-muted">to</span>
            <Input type="date" aria-label="To date" className="w-36" value={f.to ?? ''} min={f.from ?? undefined} onChange={(e) => f.set({ to: e.target.value || null })} />
          </div>
        )}

        <div className="w-36">
          <Select value={f.scope} onValueChange={(v) => f.set({ scope: v as StatusScope })}>
            <SelectTrigger aria-label="Status scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">Active alerts</SelectItem>
              <SelectItem value="CLOSED">Closed</SelectItem>
              <SelectItem value="ALL">All statuses</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch id="group" checked={f.groupByEntity} onCheckedChange={(v) => f.set({ groupByEntity: v })} />
            <Label htmlFor="group">Group by entity</Label>
          </div>
          <span className="text-[12px] text-muted" aria-live="polite">
            {shown} shown
          </span>
          {n > 0 && (
            <Button variant="ghost" size="sm" onClick={f.reset}>
              <X /> Clear {n} filter{n === 1 ? '' : 's'}
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}
