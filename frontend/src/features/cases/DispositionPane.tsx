import { useState } from 'react'
import { toast } from 'sonner'
import { FileWarning, Lock, MessageSquareMore, PlayCircle, XOctagon } from 'lucide-react'
import type { AMLTransaction, CaseDetail, Disposition } from '@/types/domain'
import type { CaseEvidence } from '@/hooks/useCaseEvidence'
import { useCaseMutations } from '@/hooks/useCases'
import { useAuth } from '@/features/auth/authStore'
import { AUTHORITY_LABEL } from '@/lib/sar'
import { errorMessage } from '@/lib/api'
import { formatDateTime, humanizeEnum } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger, Textarea, Tip } from '@/components/ui/primitives'
import { AuditTrail } from './AuditTrail'
import { CloseCaseDialog, RequestInfoDialog, SarConfirmDialog } from './CaseDialogs'
import { SarDraft, useSarDraft } from './SarDraft'

function Notes({ detail, id }: { detail: CaseDetail; id: string }) {
  const { addNote } = useCaseMutations(id)
  const [text, setText] = useState('')
  const closed = detail.case.status === 'CLOSED'

  return (
    <div className="space-y-3">
      {detail.notes.length === 0 && <p className="text-[12px] text-muted">No notes yet.</p>}
      <ul className="space-y-2">
        {detail.notes.map((n) => (
          <li key={n.id} className="rounded border border-line p-2.5">
            <p className="whitespace-pre-wrap text-[12.5px]">{n.body}</p>
            <div className="mt-1 text-[11px] text-muted">
              <span className="font-medium text-ink">{n.author}</span> · {formatDateTime(n.createdAt)}
            </div>
          </li>
        ))}
      </ul>
      {!closed && (
        <form
          className="space-y-1.5"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!text.trim()) return
            await addNote.mutateAsync(text.trim())
            setText('')
          }}
        >
          <Textarea aria-label="Add a note" rows={3} placeholder="Add a note to the case file" value={text} onChange={(e) => setText(e.target.value)} />
          <Button type="submit" size="sm" variant="outline" disabled={!text.trim()} loading={addNote.isPending}>
            Add note
          </Button>
        </form>
      )}
    </div>
  )
}

export function DispositionPane({ detail, evidence, currency }: { detail: CaseDetail; evidence: CaseEvidence; currency: string }) {
  const c = detail.case
  const id = c.id
  const me = useAuth((s) => s.session?.username ?? 'analyst')
  const isSupervisor = useAuth((s) => s.can('SUPERVISOR'))
  const { transition, addNote } = useCaseMutations(id)

  const sar = useSarDraft({ aml: c, customer: detail.customer, alerts: evidence.details.length ? evidence.details : detail.alerts, flagged: evidence.flagged as AMLTransaction[], preparedBy: me, currency })

  const [dialog, setDialog] = useState<'info' | 'close' | 'sar' | null>(null)
  const closed = c.status === 'CLOSED'
  const busy = transition.isPending || addNote.isPending

  async function run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn()
      toast.success(ok)
      setDialog(null)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const supervisorTip = 'Supervisor decision. Ask a supervisor to complete this step.'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-line px-4 py-3.5">
        <h3 className="eyebrow">Disposition</h3>
        {closed ? (
          <div className="flex items-start gap-2 rounded border border-line bg-panel2 p-2.5 text-[12.5px]">
            <Lock className="mt-0.5 size-3.5 shrink-0 text-muted" />
            <span>
              Case closed{c.outcome ? ` — ${humanizeEnum(c.outcome)}` : ''}. Its record is now read-only.
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {c.status === 'OPEN' && (
              <Button loading={transition.isPending} onClick={() => run(() => transition.mutateAsync({ status: 'INVESTIGATING' }), 'Investigation started')}>
                <PlayCircle /> Start investigation
              </Button>
            )}
            {c.status === 'INVESTIGATING' && (
              <Tip label={isSupervisor ? 'File a suspicious activity report and lock the narrative' : supervisorTip}>
                <span>
                  <Button disabled={!isSupervisor || busy} onClick={() => setDialog('sar')}>
                    <FileWarning /> Escalate to SAR
                  </Button>
                </span>
              </Tip>
            )}
            <Button variant="outline" onClick={() => setDialog('info')}>
              <MessageSquareMore /> Request info
            </Button>
            {c.status !== 'OPEN' && (
              <Tip label={isSupervisor ? 'Close the case with a disposition' : supervisorTip}>
                <span>
                  <Button variant="outline" disabled={!isSupervisor || busy} onClick={() => setDialog('close')}>
                    <XOctagon /> Close
                  </Button>
                </span>
              </Tip>
            )}
          </div>
        )}
      </div>

      <Tabs defaultValue="sar" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="px-4 pt-2">
          <TabsTrigger value="sar">SAR draft</TabsTrigger>
          <TabsTrigger value="notes">Notes · {detail.notes.length}</TabsTrigger>
          <TabsTrigger value="audit">Audit trail</TabsTrigger>
        </TabsList>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <TabsContent value="sar">
            <SarDraft sar={sar} caseRef={c.caseRef} readOnly={closed || c.status === 'SAR_FILED'} />
          </TabsContent>
          <TabsContent value="notes">
            <Notes detail={detail} id={id} />
          </TabsContent>
          <TabsContent value="audit">
            <AuditTrail entries={evidence.audit} />
          </TabsContent>
        </div>
      </Tabs>

      <RequestInfoDialog
        open={dialog === 'info'}
        onClose={() => setDialog(null)}
        busy={addNote.isPending}
        onConfirm={(t) => run(() => addNote.mutateAsync(`REQUEST FOR INFORMATION: ${t}`), 'Request logged')}
      />
      <CloseCaseDialog
        open={dialog === 'close'}
        onClose={() => setDialog(null)}
        busy={transition.isPending}
        onConfirm={(d: Disposition, reason) => run(() => transition.mutateAsync({ status: 'CLOSED', disposition: d, reason }), 'Case closed')}
      />
      <SarConfirmDialog
        open={dialog === 'sar'}
        onClose={() => setDialog(null)}
        busy={busy}
        authorityLabel={AUTHORITY_LABEL[sar.authority]}
        empty={!sar.text.trim()}
        onConfirm={() =>
          run(async () => {
            // The backend has no SAR store, so the filed narrative is preserved as an immutable case note.
            await addNote.mutateAsync(`SAR NARRATIVE FILED (${AUTHORITY_LABEL[sar.authority]}):\n\n${sar.text}`)
            await transition.mutateAsync({ status: 'SAR_FILED', reason: 'SAR narrative approved for filing' })
          }, 'SAR filed')
        }
      />
    </div>
  )
}
