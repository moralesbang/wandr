import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './client'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 4xx won't change by asking again; a 5xx or a dropped connection might.
      retry: (failureCount, error) =>
        failureCount < 2 && !(error instanceof ApiError && error.status < 500),
    },
  },
})

// What the router hands every loader: the cache, reached only through factories.
export type DataContext = { queryClient: QueryClient }
