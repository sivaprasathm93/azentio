import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, errorMessage } from '@/lib/api'
import type { CaseDetail, CaseStatus, CaseTransition } from '@/types/domain'
import { alertKeys } from './useAlerts'

export const caseKeys = {
  all: ['cases'] as const,
  list: (s?: CaseStatus[]) => ['cases', 'list', s ?? 'all'] as const,
  detail: (id: string) => ['cases', 'detail', id] as const,
  txns: (customerId: string) => ['cases', 'txns', customerId] as const,
}

export function useCaseList(statuses?: CaseStatus[]) {
  return useQuery({ queryKey: caseKeys.list(statuses), queryFn: async () => (await api.listCases(statuses)).content })
}

export function useCase(id: string | undefined) {
  return useQuery({ queryKey: caseKeys.detail(id ?? ''), queryFn: () => api.getCase(id!), enabled: !!id, staleTime: 15_000 })
}

export function useCustomerTransactions(customerId: string | undefined) {
  return useQuery({
    queryKey: caseKeys.txns(customerId ?? ''),
    queryFn: () => api.getCustomerTransactions(customerId!),
    enabled: !!customerId,
    staleTime: 60_000,
  })
}

export function useCaseMutations(id: string) {
  const qc = useQueryClient()
  const set = (d: CaseDetail) => {
    qc.setQueryData(caseKeys.detail(id), d)
    qc.invalidateQueries({ queryKey: caseKeys.list() })
    qc.invalidateQueries({ queryKey: alertKeys.all })
  }

  const transition = useMutation({
    mutationFn: (t: CaseTransition) => api.transitionCase(id, t),
    onSuccess: set,
    onError: (e) => toast.error(errorMessage(e)),
  })
  const assign = useMutation({
    mutationFn: (assignee: string) => api.assignCase(id, assignee),
    onSuccess: set,
    onError: (e) => toast.error(errorMessage(e)),
  })
  const addNote = useMutation({
    mutationFn: (body: string) => api.addCaseNote(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: caseKeys.detail(id) }),
    onError: (e) => toast.error(errorMessage(e)),
  })
  return { transition, assign, addNote }
}
