import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { HealthStatus } from './health-status'

const rows = () => within(screen.getByRole('list', { name: 'Services' })).getAllByRole('listitem')

describe('HealthStatus', () => {
  test('shows every service answering', () => {
    render(<HealthStatus checks={{ database: 'up', bucket: 'up' }} />)

    const [api, database, bucket] = rows()
    expect(api).toHaveTextContent(/^APIAnswering$/)
    expect(database).toHaveTextContent(/^DatabaseAnswering$/)
    expect(bucket).toHaveTextContent(/^Photo storageAnswering$/)
  })

  test('names the service that does not answer', () => {
    render(<HealthStatus checks={{ database: 'up', bucket: 'down' }} />)

    const [, database, bucket] = rows()
    expect(database).toHaveTextContent(/Answering$/)
    expect(bucket).toHaveTextContent(/Not answering$/)
  })
})
