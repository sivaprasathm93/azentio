import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { config } from '@/lib/config'
import { createMockStream, createStompStream } from '@/lib/realtime/alertStream'
import { useStream } from '@/features/alerts/store'
import { useAuth } from '@/features/auth/authStore'
import { alertKeys } from './useAlerts'

/**
 * Mounts the alert push channel for the whole app (one connection). Streamed alerts are only *counted* here;
 * the queue merges them when the analyst clicks the banner, so rows never jump under the cursor mid-triage.
 */
export function useAlertStream() {
  const qc = useQueryClient()
  const ready = useAuth((s) => !!s.session)

  useEffect(() => {
    if (!ready) return
    const { setStatus, push, pruneFresh } = useStream.getState()
    const stream = config.mode === 'live' ? createStompStream() : createMockStream()
    stream.start({
      onStatus: setStatus,
      onAlert: (a) => {
        push(a.id)
        // Keep the detail cache honest if this alert is already open somewhere.
        qc.invalidateQueries({ queryKey: alertKeys.detail(a.id) })
      },
    })
    const prune = setInterval(() => pruneFresh(3000), 1000)
    return () => {
      stream.stop()
      clearInterval(prune)
    }
  }, [ready, qc])
}
