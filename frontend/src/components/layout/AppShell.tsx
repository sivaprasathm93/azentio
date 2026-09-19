import { NavLink, Outlet } from 'react-router-dom'
import { BriefcaseBusiness, Moon, ShieldAlert, SlidersHorizontal, Sun } from 'lucide-react'
import { useAuth } from '@/features/auth/authStore'
import { useTheme } from '@/hooks/useTheme'
import { useAlertStream } from '@/hooks/useAlertStream'
import { config } from '@/lib/config'
import { initials } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Tip } from '@/components/ui/primitives'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/overlays'

const NAV = [
  { to: '/alerts', label: 'Alert queue', icon: ShieldAlert },
  { to: '/cases', label: 'Cases', icon: BriefcaseBusiness },
  { to: '/rules', label: 'Rules', icon: SlidersHorizontal },
]

function Wordmark() {
  return (
    <div className="flex items-center gap-2.5 px-3 py-4">
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
        <path d="M16 3l11 4.2v8.4c0 6.2-4.4 11-11 13.8C9.4 26.6 5 21.8 5 15.6V7.2z" fill="none" stroke="#8391ff" strokeWidth="2" />
        <circle cx="16" cy="15" r="3.4" fill="#f26b21" />
      </svg>
      <div className="hidden lg:block">
        <div className="display text-[16px] leading-none text-white">Sentinel</div>
        <div className="eyebrow mt-1 !text-[9.5px] !text-rail-fg">AML monitoring</div>
      </div>
    </div>
  )
}

export function AppShell() {
  useAlertStream()
  const { dark, toggle } = useTheme()
  const session = useAuth((s) => s.session)
  const switchUser = useAuth((s) => s.switchMockUser)

  return (
    <div className="flex h-screen overflow-hidden">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-panel focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="flex w-14 shrink-0 flex-col bg-rail text-rail-fg lg:w-52">
        <Wordmark />
        <nav className="flex flex-1 flex-col gap-0.5 px-2" aria-label="Primary">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Tip key={to} label={label} side="right">
              <NavLink
                to={to}
                className={({ isActive }) =>
                  cn(
                    'relative flex h-9 items-center gap-2.5 rounded-[var(--radius)] px-2.5 text-[13px] font-semibold transition-colors hover:bg-white/5 hover:text-white',
                    isActive && 'bg-white/8 text-white before:absolute before:-left-2 before:top-1.5 before:h-6 before:w-[3px] before:rounded-r before:bg-[#8391ff]',
                  )
                }
              >
                <Icon className="size-4 shrink-0" />
                <span className="hidden lg:inline">{label}</span>
              </NavLink>
            </Tip>
          ))}
        </nav>

        <div className="flex flex-col gap-2 border-t border-rail-line p-2">
          {config.mode === 'mock' && session && (
            <div className="hidden lg:block">
              <div className="eyebrow mb-1 !text-[9.5px] !text-rail-fg">Demo persona</div>
              <Select value={session.username} onValueChange={(v) => switchUser(v as 'analyst' | 'supervisor' | 'admin')}>
                <SelectTrigger className="h-7 border-rail-line bg-white/5 text-[12px] text-white" aria-label="Demo persona">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="analyst">Analyst</SelectItem>
                  <SelectItem value="supervisor">Supervisor</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex items-center gap-2 px-1">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-bold text-white" aria-hidden>
              {initials(session?.username ?? '?')}
            </span>
            <div className="hidden min-w-0 flex-1 lg:block">
              <div className="truncate text-[12px] font-semibold text-white">{session?.username}</div>
              <div className="truncate text-[10.5px]">{session?.roles.at(-1)?.toLowerCase()}</div>
            </div>
            <Tip label={dark ? 'Switch to light theme' : 'Switch to dark theme'} side="right">
              <button onClick={toggle} aria-label="Toggle theme" className="rounded p-1.5 hover:bg-white/10 hover:text-white">
                {dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
              </button>
            </Tip>
          </div>
        </div>
      </aside>

      <main id="main" className="min-w-0 flex-1 overflow-hidden">
        <ErrorBoundary region="page">
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  )
}
