import { useCallback, useState } from 'react'
import { safeStorage } from '@/lib/utils'

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains('dark')
    document.documentElement.classList.toggle('dark', next)
    safeStorage('local').set('sentinel-theme', next ? 'dark' : 'light')
    setDark(next)
  }, [])
  return { dark, toggle }
}
