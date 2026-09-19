const env = import.meta.env

export const config = {
  mode: (env.VITE_API_MODE === 'live' ? 'live' : 'mock') as 'live' | 'mock',
  wsPath: (env.VITE_WS_PATH as string | undefined) ?? '/ws',
  alertTopic: (env.VITE_ALERT_TOPIC as string | undefined) ?? '/topic/alerts',
  /** Currency the backend normalises amounts into (application.yml: sentinel.base-currency). */
  baseCurrency: (env.VITE_BASE_CURRENCY as string | undefined) ?? 'INR',
  /** Alerts for the same entity closer together than this fold into one master row. */
  aggregationWindowHours: 72,
}
