import { useEffect, useState } from 'react'
import type { Disposition } from '@/types/domain'
import { Button } from '@/components/ui/button'
import { Label, Textarea } from '@/components/ui/primitives'
import { Dialog, DialogBody, DialogContent, DialogFooter, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/overlays'

const MIN = 10

function ReasonField({ id, label, value, onChange, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} rows={4} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <p className="text-[11.5px] text-muted">{value.trim().length < MIN ? `At least ${MIN} characters (${value.trim().length} so far).` : 'Recorded in the audit trail.'}</p>
    </div>
  )
}

export function RequestInfoDialog({ open, onClose, onConfirm, busy }: { open: boolean; onClose: () => void; onConfirm: (text: string) => void; busy: boolean }) {
  const [text, setText] = useState('')
  useEffect(() => {
    if (open) setText('')
  }, [open])
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Request information" description="Adds a request to the case notes and audit trail so the relationship manager or branch can respond.">
        <DialogBody>
          <ReasonField id="info" label="What do you need, and from whom?" value={text} onChange={setText} placeholder="e.g. Source-of-funds documents for the four cash deposits, from the relationship manager." />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={text.trim().length < MIN} loading={busy} onClick={() => onConfirm(text.trim())}>
            Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const DISPOSITIONS: { value: Disposition; label: string }[] = [
  { value: 'TRUE_POSITIVE', label: 'True positive — suspicious activity confirmed' },
  { value: 'FALSE_POSITIVE', label: 'False positive — explained by legitimate activity' },
  { value: 'NO_FURTHER_ACTION', label: 'No further action' },
]

export function CloseCaseDialog({
  open,
  onClose,
  onConfirm,
  busy,
}: {
  open: boolean
  onClose: () => void
  onConfirm: (d: Disposition, reason: string) => void
  busy: boolean
}) {
  const [disposition, setDisposition] = useState<Disposition>('NO_FURTHER_ACTION')
  const [reason, setReason] = useState('')
  useEffect(() => {
    if (open) {
      setDisposition('NO_FURTHER_ACTION')
      setReason('')
    }
  }, [open])
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Close case" description="Closes the case and every escalated alert in it with this disposition. This cannot be undone; a supervisor can reopen alerts.">
        <DialogBody className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="disp">Disposition</Label>
            <Select value={disposition} onValueChange={(v) => setDisposition(v as Disposition)}>
              <SelectTrigger id="disp">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DISPOSITIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ReasonField id="close-reason" label="Reason for closing" value={reason} onChange={setReason} placeholder="Summarise the outcome of the investigation." />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={reason.trim().length < MIN} loading={busy} onClick={() => onConfirm(disposition, reason.trim())}>
            Close case
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SarConfirmDialog({
  open,
  onClose,
  onConfirm,
  busy,
  authorityLabel,
  empty,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  busy: boolean
  authorityLabel: string
  empty: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Escalate to SAR" description={`Moves the case to SAR filed. The narrative below the action bar (${authorityLabel}) is saved to the case notes as the filed version.`}>
        <DialogBody>
          {empty ? (
            <p role="alert" className="rounded border border-high/40 bg-high/10 p-2.5 text-[12.5px] text-high">
              The SAR narrative is empty. Write or regenerate it before escalating.
            </p>
          ) : (
            <p className="text-[13px]">Review the narrative once more. After filing, the case can only be closed.</p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={empty} loading={busy} onClick={onConfirm}>
            File SAR
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
