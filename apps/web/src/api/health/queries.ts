import { queryOptions } from '@tanstack/react-query'
import { api, unwrap } from '../client'

export const healthQueries = {
  all: () => ['health'] as const,
  status: () =>
    queryOptions({
      queryKey: [...healthQueries.all(), 'status'] as const,
      queryFn: () => unwrap(api.GET('/api/health')),
    }),
}
