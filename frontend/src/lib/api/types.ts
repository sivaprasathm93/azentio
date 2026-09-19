import type {
  Alert,
  AlertAction,
  AlertDetail,
  AlertQuery,
  AMLTransaction,
  AmlCase,
  AuditEntry,
  CaseDetail,
  CaseNote,
  CaseStatus,
  CaseTransition,
  CustomerProfile,
  DashboardMetrics,
  Page,
  RuleConfig,
  RuleUpdate,
  Session,
  SimulationRequest,
  SimulationResult,
  WatchlistEntry,
} from '@/types/domain'

/** The one interface every screen talks to. Implemented by the HTTP adapter and by the in-browser mock. */
export interface SentinelApi {
  readonly mode: 'mock' | 'live'

  /** Who the app is acting as. Live mode probes the backend to work out the roles of its service account. */
  whoami(): Promise<Session>

  listAlerts(q?: AlertQuery): Promise<Page<Alert>>
  getAlert(id: string): Promise<AlertDetail>
  getAlertHistory(id: string): Promise<AuditEntry[]>
  actOnAlert(id: string, action: AlertAction): Promise<AlertDetail>

  listCases(statuses?: CaseStatus[]): Promise<Page<AmlCase>>
  createCase(alertIds: string[], title: string, reason: string): Promise<CaseDetail>
  getCase(id: string): Promise<CaseDetail>
  transitionCase(id: string, t: CaseTransition): Promise<CaseDetail>
  assignCase(id: string, assignee: string): Promise<CaseDetail>
  addCaseNote(id: string, body: string): Promise<CaseNote>

  getCustomer(id: string): Promise<CustomerProfile>
  getCustomerTransactions(customerId: string): Promise<AMLTransaction[]>

  listRules(): Promise<RuleConfig[]>
  updateRule(code: string, update: RuleUpdate): Promise<RuleConfig>
  listWatchlist(): Promise<WatchlistEntry[]>
  addWatchlistCountry(code: string, listName: string, reason: string): Promise<WatchlistEntry>
  setWatchlistActive(id: string, active: boolean, reason: string): Promise<WatchlistEntry>
  simulateRule(req: SimulationRequest): Promise<SimulationResult>

  getMetrics(): Promise<DashboardMetrics>
}
