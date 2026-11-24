import { useSuspenseQuery } from '@tanstack/react-query'
import { healthQueries } from './queries'

export const useHealth = () => useSuspenseQuery(healthQueries.status()).data
