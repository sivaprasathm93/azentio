import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { Alert } from '@/types/domain'
import { rowAlerts, type GridRow } from '@/lib/grouping'
import { requiresSupervisor } from '@/lib/risk'
import { Button } from '@/components/ui/button'
import { Input, Label, Textarea } from '@/components/ui/primitives'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/overlays'

const MIN_REASON = 10

export function eligibleAlerts(row: GridRow | null): Alert[] {
  return row ? rowAlerts(row).filter((a) => a.status === 'OPEN' || a.status === 'UNDER_REVIEW') : []
}

function AlertList({ alerts }: { alerts: Alert[] }) {
  return (
    <ul className="mb-3 divide-y divide-line rounded border border-line text-[12px]">
      {alerts.map((a) => (
        <li key={a.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
          <span className="num">{a.alertRef}</span>
          <span className="truncate text-muted">{a.evidence.map((e) => e.typology).join(', ')}</span>
          <span className="num font-semibold">{a.overallScore}</span>
        </li>
      ))}
    </ul>
  )
}

export function DismissDialog({
  row,
  onClose,
  onConfirm,
  busy,
  isSupervisor,
}: {
  row: GridRow | null
  onClose: () => void
  onConfirm: (reason: string) => void
  busy: boolean
  isSupervisor: boolean
}) {
  const [reason, setReason] = useState('')
  useEffect(() => setReason(''), [row])
  const alerts = eligibleAlerts(row)
  const blocked = !isSupervisor && alerts.filter(requiresSupervisor)
  const valid = reason.trim().length >= MIN_REASON

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Dismiss as false positive" description={`${alerts.length} alert${alerts.length === 1 ? '' : 's'} will be closed. The alert is kept with your name, reason and time.`}>
        <DialogBody>
          <AlertList alerts={alerts} />
          {blocked && blocked.length > 0 && (
            <p role="alert" className="mb-3 flex gap-2 rounded border border-high/40 bg-high/10 p-2.5 text-[12px] text-high">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {blocked.map((a) => a.alertRef).join(', ')} score 80 or above, or match a sanctions list. Closing those needs a supervisor. Promote them to a case instead.
              </span>
            </p>
          )}
          <Label htmlFor="reason">Reason for dismissal</Label>
          <Textarea
            id="reason"
            className="mt-1"
            rows={4}
            placeholder="What did you check, and why is this not suspicious?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="mt-1 text-[11.5px] text-muted">{reason.trim().length < MIN_REASON ? `At least ${MIN_REASON} characters (${reason.trim().length} so far).` : 'Recorded in the audit trail.'}</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!valid || (!!blocked && blocked.length > 0)} loading={busy} onClick={() => onConfirm(reason.trim())}>
            Dismiss {alerts.length > 1 ? `${alerts.length} alerts` : 'alert'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function PromoteDialog({
  row,
  onClose,
  onConfirm,
  busy,
}: {
  row: GridRow | null
  onClose: () => void
  onConfirm: (title: string, reason: string) => void
  busy: boolean
}) {
  const [title, setTitle] = useState('')
  const [reason, setReason] = useState('')
  const alerts = eligibleAlerts(row)
  useEffect(() => {
    setTitle(row ? `Investigation — ${row.alert.customerName}` : '')
    setReason('')
  }, [row])
  const valid = reason.trim().length >= MIN_REASON && title.trim().length > 0

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Promote to case" description="Opens one investigation case with all listed alerts attached. Their status becomes Escalated.">
        <DialogBody className="space-y-3">
          <AlertList alerts={alerts} />
          <div className="space-y-1">
            <Label htmlFor="title">Case title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="why">Why escalate?</Label>
            <Textarea id="why" rows={3} placeholder="Summarise what makes this worth a full investigation." value={reason} onChange={(e) => setReason(e.target.value)} />
            <p className="text-[11.5px] text-muted">{reason.trim().length < MIN_REASON ? `At least ${MIN_REASON} characters (${reason.trim().length} so far).` : 'Recorded in the audit trail.'}</p>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid} loading={busy} onClick={() => onConfirm(title.trim(), reason.trim())}>
            Open case
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
