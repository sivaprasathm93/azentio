import { useCallback, useEffect, useMemo, useState } from 'react'
import { Copy, Download, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import type { Alert, AMLTransaction, AmlCase, CustomerProfile } from '@/types/domain'
import { AUTHORITY_LABEL, buildSarNarrative, type FilingAuthority } from '@/lib/sar'
import { safeStorage } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Label, Textarea } from '@/components/ui/primitives'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/overlays'

export interface SarState {
  authority: FilingAuthority
  text: string
}

/** Draft = generated narrative until the analyst edits it; edits persist locally per case, "Regenerate" discards them. */
export function useSarDraft(input: { aml: AmlCase; customer: CustomerProfile; alerts: Alert[]; flagged: AMLTransaction[]; preparedBy: string; currency: string }): SarState & {
  setText: (t: string) => void
  setAuthority: (a: FilingAuthority) => void
  regenerate: () => void
  edited: boolean
} {
  const key = `sentinel-sar-${input.aml.id}`
  const [authority, setAuthority] = useState<FilingAuthority>('FINCEN')
  const [draft, setDraft] = useState<string | null>(() => safeStorage('local').get(key))

  const generated = useMemo(
    () => buildSarNarrative({ authority, ...input }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [authority, input.aml, input.customer, input.alerts, input.flagged, input.preparedBy, input.currency],
  )

  useEffect(() => {
    setDraft(safeStorage('local').get(key))
  }, [key])

  const setText = useCallback(
    (t: string) => {
      setDraft(t)
      safeStorage('local').set(key, t)
    },
    [key],
  )
  const regenerate = useCallback(() => {
    setDraft(null)
    safeStorage('local').remove(key)
  }, [key])

  return { authority, text: draft ?? generated, setText, setAuthority, regenerate, edited: draft !== null }
}

export function SarDraft({ sar, caseRef, readOnly }: { sar: ReturnType<typeof useSarDraft>; caseRef: string; readOnly: boolean }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(sar.text)
      toast.success('Narrative copied')
    } catch {
      toast.error('Copy was blocked by the browser. Select the text and copy it manually.')
    }
  }

  function download() {
    const blob = new Blob([sar.text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${caseRef}-${sar.authority === 'FINCEN' ? 'SAR' : 'STR'}-narrative.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-2.5">
      <div className="space-y-1">
        <Label htmlFor="authority">Filing format</Label>
        <Select value={sar.authority} onValueChange={(v) => sar.setAuthority(v as FilingAuthority)} disabled={sar.edited}>
          <SelectTrigger id="authority">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(AUTHORITY_LABEL) as FilingAuthority[]).map((a) => (
              <SelectItem key={a} value={a}>
                {AUTHORITY_LABEL[a]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {sar.edited && <p className="text-[11px] text-muted">Format is fixed once you edit the text. Regenerate to switch.</p>}
      </div>

      <div className="space-y-1">
        <Label htmlFor="sar-text">Narrative draft</Label>
        <Textarea
          id="sar-text"
          value={sar.text}
          readOnly={readOnly}
          onChange={(e) => sar.setText(e.target.value)}
          className="num min-h-[340px] resize-y text-[11.5px] leading-relaxed tracking-normal"
          spellCheck
        />
        <p className="text-[11px] text-muted">
          Auto-drafted from case evidence. {sar.edited ? 'Your edits are saved in this browser.' : 'Edit freely; nothing is filed until you escalate.'}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Button variant="outline" size="sm" onClick={copy}>
          <Copy /> Copy
        </Button>
        <Button variant="outline" size="sm" onClick={download}>
          <Download /> Export .txt
        </Button>
        {sar.edited && !readOnly && (
          <Button variant="ghost" size="sm" onClick={sar.regenerate}>
            <RotateCcw /> Regenerate
          </Button>
        )}
      </div>
    </div>
  )
}
