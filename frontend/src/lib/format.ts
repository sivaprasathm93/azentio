const moneyCache = new Map<string, Intl.NumberFormat>()

export function formatMoney(amount: number | null | undefined, currency = 'USD', compact = false): string {
  if (amount == null || Number.isNaN(amount)) return '—'
  const key = `${currency}:${compact}:${Number.isInteger(amount)}`
  let f = moneyCache.get(key)
  if (!f) {
    try {
      // Lakh/crore grouping for INR, as Indian analysts read it.
      f = new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
        style: 'currency',
        currency,
        notation: compact ? 'compact' : 'standard',
        maximumFractionDigits: compact ? 1 : 2,
        minimumFractionDigits: compact || Number.isInteger(amount) ? 0 : 2,
      })
    } catch {
      f = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
    }
    moneyCache.set(key, f)
  }
  return f.format(amount)
}

export function formatNumber(n: number | null | undefined, digits = 0) {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatRelative(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return '—'
  const diff = now - new Date(iso).getTime()
  if (Number.isNaN(diff)) return '—'
  const s = Math.round(diff / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

/** "3 y 4 mo" from an onboarding date. */
export function formatTenure(iso: string | null | undefined, now = new Date()) {
  if (!iso) return 'Unknown'
  const start = new Date(iso)
  if (Number.isNaN(start.getTime())) return 'Unknown'
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
  if (now.getDate() < start.getDate()) months -= 1
  months = Math.max(0, months)
  const y = Math.floor(months / 12)
  const m = months % 12
  if (y === 0) return `${m} mo`
  return m === 0 ? `${y} y` : `${y} y ${m} mo`
}

export function initials(name: string) {
  const parts = name.replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function humanizeEnum(v: string) {
  const s = v.toLowerCase().replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}
