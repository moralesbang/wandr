// The factory's CLI: `bun run factory <command>`. See factory/README.md for every command.

import { parseArgs } from 'node:util'
import { mainRoot } from './job.ts'
import { check } from './commands/check.ts'
import { Refusal } from './commands/common.ts'
import { gate } from './commands/gate.ts'
import { hookGuard, hookLog } from './commands/hook.ts'
import { atfix, attempt, block, clean, rewrite, round, status } from './commands/lifecycle.ts'
import { pr } from './commands/pr.ts'
import { red } from './commands/red.ts'
import { answersSinceLastRequest, start } from './commands/start.ts'
import { watch } from './watch/server.ts'

const USAGE = `Usage: bun run factory <command>

  start <n> --session <id>   take issue <n>, or resume its job
  red <n>                    verify the red and commit it
  check <n>                  run CI's steps in the job's worktree
  attempt <n>                record a new build attempt
  gate <n>                   the gate before review
  round <n>                  record a new review round with findings
  atfix <n> --note <text>    commit a same-guarantee acceptance-test fix
  rewrite <n> --note <text>  commit an authorized rewrite of acceptance tests
  block <n> <file>           post a Decision Request and block the job
  pr <n>                     open the pull request
  status                     list the jobs
  watch [--port <port>]      serve the live page
  clean <n>                  remove a merged job
  hook log | hook guard      Claude Code hook entry points`

const issueNumber = (value: string | undefined) => {
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0)
    throw new Refusal(`Expected an issue number.\n\n${USAGE}`)
  return number
}

const print = (value: unknown) =>
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2))

async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      session: { type: 'string' },
      note: { type: 'string' },
      port: { type: 'string' },
    },
  })
  const [command, arg] = positionals
  const root = mainRoot()

  switch (command) {
    case 'start': {
      if (!values.session)
        throw new Refusal('start needs --session <id> (the skill passes ${CLAUDE_SESSION_ID}).')
      const job = await start(root, issueNumber(arg), values.session)
      print(job)
      const answers = await answersSinceLastRequest(job)
      if (answers.length) {
        print('\nThe user answered the last Decision Request:\n')
        for (const answer of answers)
          print(`--- ${answer.author.login}, ${answer.createdAt}\n${answer.body}\n`)
      }
      return 0
    }
    case 'red': {
      const { job, problems } = await red(root, issueNumber(arg))
      if (problems.length) {
        print(`The red is rejected:\n${problems.map((p) => `- ${p}`).join('\n')}`)
        return 1
      }
      print(`Red commit ${job.redCommit}.`)
      return 0
    }
    case 'check': {
      const job = await check(root, issueNumber(arg))
      const result = job.lastCheck
      print(
        result?.green
          ? `Green. Log: ${result.log}`
          : `Red at "${result?.failedStep}". Log: ${result?.log}`,
      )
      return result?.green ? 0 : 1
    }
    case 'attempt':
      print(`Build attempt ${attempt(root, issueNumber(arg)).attempts} of 3.`)
      return 0
    case 'round':
      print(`Review round ${round(root, issueNumber(arg)).rounds} of 3 with findings.`)
      return 0
    case 'gate': {
      const { result } = await gate(root, issueNumber(arg))
      print(result)
      return result.passed ? 0 : 1
    }
    case 'atfix':
      print(await atfix(root, issueNumber(arg), values.note ?? ''))
      return 0
    case 'rewrite':
      print(await rewrite(root, issueNumber(arg), values.note ?? ''))
      return 0
    case 'block': {
      const file = positionals[2]
      if (!file) throw new Refusal('block needs the Decision Request file: block <n> <file>')
      await block(root, issueNumber(arg), file)
      print(`Job #${arg} is blocked; the Decision Request is on the issue.`)
      return 0
    }
    case 'pr':
      print((await pr(root, issueNumber(arg))).pr)
      return 0
    case 'status':
      print(status(root))
      return 0
    case 'watch':
      await watch(root, Number(values.port ?? 4300))
      return 0
    case 'clean':
      await clean(root, issueNumber(arg))
      print(`Job #${arg} cleaned.`)
      return 0
    case 'hook': {
      const stdin = await Bun.stdin.text()
      if (arg === 'log') await hookLog(root, stdin)
      else if (arg === 'guard') process.stdout.write(hookGuard(root, stdin))
      else throw new Refusal('hook log | hook guard')
      return 0
    }
    default:
      print(USAGE)
      return command ? 1 : 0
  }
}

main(Bun.argv.slice(2)).then(
  (code) => {
    if (code !== 0) process.exitCode = code
  },
  (error: unknown) => {
    if (error instanceof Refusal) {
      console.error(error.message)
      process.exitCode = 2
    } else {
      console.error(error)
      process.exitCode = 1
    }
  },
)
