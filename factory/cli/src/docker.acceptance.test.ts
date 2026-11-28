import { describe, expect, test } from 'bun:test'
import { DOCKER_APP, ensureDocker, type DockerDeps } from './docker.ts'

/** A Docker whose daemon answers `docker info` from the `up`th call on; every command is logged. */
function fake(overrides: Partial<DockerDeps> & { up?: number } = {}) {
  const ran: string[] = []
  let infos = 0
  let clock = 0
  const { up = Infinity, ...rest } = overrides
  const deps: DockerDeps = {
    platform: 'darwin',
    ci: false,
    exists: (path) => path === DOCKER_APP,
    run: async (argv) => {
      ran.push(argv.join(' '))
      if (argv[0] === 'docker') return ++infos >= up ? 0 : 1
      return 0
    },
    sleep: async (ms) => {
      clock += ms
    },
    now: () => clock,
    timeoutMs: 90_000,
    pollMs: 2_000,
    ...rest,
  }
  return { deps, ran }
}

describe('FI-029: Docker is up before a job starts or its checks run', () => {
  test('a running Docker is left alone', async () => {
    const { deps, ran } = fake({ up: 1 })
    await ensureDocker(deps)
    expect(ran).toEqual(['docker info'])
  })

  test('on macOS with Docker Desktop installed it opens the app and waits for the daemon', async () => {
    const { deps, ran } = fake({ up: 4 })
    await ensureDocker(deps)
    expect(ran[0]).toBe('docker info')
    expect(ran[1]).toBe('open -a Docker')
    expect(ran.filter((command) => command === 'docker info')).toHaveLength(4)
  })

  test('a daemon that never answers fails after the timeout, saying what to do', async () => {
    const { deps, ran } = fake({ timeoutMs: 10_000 })
    await expect(ensureDocker(deps)).rejects.toThrow(
      "Docker didn't start; open Docker Desktop, accept any prompt it shows, and retry.",
    )
    expect(ran.filter((command) => command === 'open -a Docker')).toHaveLength(1)
  })

  test.each([
    ['Linux', { platform: 'linux' }],
    ['CI', { ci: true }],
    ['a Mac without Docker Desktop', { exists: () => false }],
  ])('on %s it starts nothing and fails fast', async (_where, overrides) => {
    const { deps, ran } = fake(overrides)
    await expect(ensureDocker(deps)).rejects.toThrow('Docker')
    expect(ran).toEqual(['docker info'])
  })
})
