import { Client } from '@stomp/stompjs'
import SockJS from 'sockjs-client'
import type { Alert } from '@/types/domain'
import type { BeAlertSummary } from '@/types/backend'
import { toAlert } from '@/lib/api/adapters'
import { config } from '@/lib/config'
import { getDb, spawnLiveAlert } from '@/lib/api/mock/data'

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'polling'

export interface AlertStream {
  start(handlers: { onAlert: (a: Alert) => void; onStatus: (s: StreamStatus) => void }): void
  stop(): void
}

/**
 * STOMP over SockJS, subscribing to /topic/alerts. Reconnects with backoff. If the broker never comes up
 * (the current backend exposes REST only) the status settles on "polling" and TanStack Query's interval
 * refetch keeps the queue fresh, so the screen degrades instead of breaking.
 */
export function createStompStream(): AlertStream {
  let client: Client | null = null
  let failures = 0

  return {
    start({ onAlert, onStatus }) {
      onStatus('connecting')
      client = new Client({
        webSocketFactory: () => new SockJS(config.wsPath) as unknown as WebSocket,
        reconnectDelay: 5000,
        heartbeatIncoming: 10_000,
        heartbeatOutgoing: 10_000,
        onConnect: () => {
          failures = 0
          onStatus('live')
          client?.subscribe(config.alertTopic, (msg) => {
            try {
              const raw = JSON.parse(msg.body) as BeAlertSummary
              onAlert(toAlert(raw))
            } catch {
              /* ignore a malformed frame; the next poll reconciles */
            }
          })
        },
        onWebSocketClose: () => {
          failures += 1
          onStatus(failures >= 3 ? 'polling' : 'reconnecting')
        },
        onStompError: () => onStatus('offline'),
      })
      client.activate()
    },
    stop() {
      void client?.deactivate()
      client = null
    },
  }
}

/** Demo stream: raises a new alert every 12-25 seconds so the live header, banner and grouping can be seen. */
export function createMockStream(): AlertStream {
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  return {
    start({ onAlert, onStatus }) {
      stopped = false
      onStatus('connecting')
      setTimeout(() => !stopped && onStatus('live'), 600)
      const schedule = () => {
        timer = setTimeout(() => {
          if (stopped) return
          onAlert(spawnLiveAlert(getDb()))
          schedule()
        }, 12_000 + Math.random() * 13_000)
      }
      schedule()
    },
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
    },
  }
}
