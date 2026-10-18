import { type QueryKey, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, errorMessage } from './api'
import { useOrg } from './org'
import { toast } from '#/ui/Toast'
import { t } from '#/i18n'

type Query = Record<string, string | number | boolean | null | undefined>

/** GET an organization-scoped resource: `useOrgQuery<Farm[]>('/farms')`. */
export function useOrgQuery<T>(path: string | null, query?: Query, options?: { enabled?: boolean; staleTime?: number; refetchInterval?: number | false | ((data: T | undefined) => number | false) }) {
  const { orgId } = useOrg()
  return useQuery<T>({
    queryKey: ['org', orgId, path, query ?? {}] as QueryKey,
    queryFn: () => api.get<T>(`/orgs/${orgId}${path}`, query),
    enabled: path != null && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 15_000,
    refetchInterval: typeof options?.refetchInterval === 'function' ? (q) => (options.refetchInterval as (d: T | undefined) => number | false)(q.state.data) : options?.refetchInterval,
  })
}

interface MutationOptions<TResult> {
  success?: string | ((result: TResult) => string)
  onSuccess?: (result: TResult) => void
  /** Show errors as toasts (default) or leave them to the caller. */
  silentError?: boolean
}

/**
 * Mutation against the organization's API. Operations touch stock, costs, tasks and crops,
 * so a successful mutation invalidates every cached query of the organization.
 */
export function useOrgMutation<TVars, TResult = unknown>(fn: (orgPath: string, vars: TVars) => Promise<TResult>, options: MutationOptions<TResult> = {}) {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  return useMutation<TResult, Error, TVars>({
    mutationFn: (vars) => fn(`/orgs/${orgId}`, vars),
    onSuccess: async (result) => {
      await qc.invalidateQueries({ queryKey: ['org', orgId] })
      if (options.success) toast.success(typeof options.success === 'function' ? options.success(result) : options.success)
      options.onSuccess?.(result)
    },
    onError: (error) => {
      if (!options.silentError) toast.error(t('common.saveFailed'), errorMessage(error))
    },
  })
}
