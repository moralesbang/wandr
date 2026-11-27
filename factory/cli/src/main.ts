// The factory's CLI: `bun run factory <command>`. See factory/README.md for every command.

import { parseArgs } from 'node:util'
import { handoffDir, mainRoot } from './job.ts'
import { check } from './commands/check.ts'
import { Refusal, requireJob } from './commands/common.ts'
import { gate } from './commands/gate.ts'
import { hookGuard, hookLog } from './commands/hook.ts'
import {
  abandon,
  atfix,
  attempt,
  block,
  clean,
  rewrite,
  round,
  status,
} from './commands/lifecycle.ts'
import { pr } from './commands/pr.ts'
import { red } from './commands/red.ts'
import { REVIEW_USAGE, review, verifierReads } from './commands/review.ts'
import { RULING_USAGE, ruling } from './commands/ruling.ts'
import { LAUNCH_USAGE, launch } from './launch.ts'
import { answer } from './commands/answer.ts'
import { SANDBOX_USAGE, sandboxCommand } from './commands/sandbox.ts'
import { describeAnswer, start } from './commands/start.ts'
import { describeSeal, seal, unseal } from './seal.ts'
import { watch } from './watch/server.ts'

const USAGE = `Usage: bun run factory <command>

  start <n> --session <id>   take issue <n>, or resume its job
${LAUNCH_USAGE}
  red <n>                    verify the red and commit it
  check <n>                  run CI's steps in the job's worktree
  attempt <n>                record a new build attempt
  gate <n>                   the gate before review
${REVIEW_USAGE}
  round <n>                  record a new review round with the merged findings (reviews/<k>.findings.md)
${RULING_USAGE}
  atfix <n> --note <text>    after an answered Decision Request, commit the acceptance-test fix it authorized
  rewrite <n> --note <text>  commit a rewrite of acceptance tests (needs an answered Decision Request)
  block <n> <file>           keep a Decision Request and block the job
  seal <n> --pass <k> --roles <r,...>  seal the build notes and earlier reports for a blind pass
  unseal <n>                 restore them once every sealed role wrote its blind pass
  answer <n> "<text>"        the user's answer to the Decision Request (only from the user's own prompt)
  pr <n>                     open the pull request
  status                     list the jobs
  watch [--port <port>]      serve the live page
  clean <n>                  remove a merged job
  clean <n> --abandon        discard an unmerged job so its issue can start again
  hook log | hook guard      Claude Code hook entry points
${SANDBOX_USAGE}`

const issueNumber = (value: string | undefined) => {
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0)
    throw new Refusal(`Expected an issue number.\n\n${USAGE}`)
  return number
}

const print = (value: unknown) =>
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2))

async function main(argv: string[]): Promise<number> {
  // The sandbox splits its own arguments at `--`, so the command it runs keeps its flags.
  if (argv[0] === 'sandbox') return sandboxCommand(mainRoot(), argv.slice(1))
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      session: { type: 'string' },
      note: { type: 'string' },
      port: { type: 'string' },
      abandon: { type: 'boolean' },
      pass: { type: 'string' },
      roles: { type: 'string' },
      task: { type: 'string' },
      ruling: { type: 'string' },
    },
  })
  const [command, arg] = positionals
  const root = mainRoot()

  switch (command) {
    case 'start': {
      if (!values.session)
        throw new Refusal('start needs --session <id> (the skill passes ${CLAUDE_SESSION_ID}).')
      const job = await start(root, issueNumber(arg), values.session)
      print({ ...job, handoff: handoffDir(job) })
      const note = describeAnswer(job)
      if (note) print(`\n${note}\n`)
      const sealNote = describeSeal(root, job)
      if (sealNote) print(`\n${sealNote}\n`)
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
    case 'launch': {
      const agent = positionals[2]
      if (!agent || !values.task)
        throw new Refusal(`launch needs the agent and the task:\n${LAUNCH_USAGE}`)
      print(await launch(root, issueNumber(arg), agent, values.task))
      return 0
    }
    case 'review': {
      const number = issueNumber(arg)
      const plan = await review(root, number)
      print({
        ...plan,
        sealed: Object.values(plan.roles).includes('review'),
        reads: verifierReads(root, requireJob(root, number), plan),
      })
      return 0
    }
    case 'ruling':
      print(await ruling(root, issueNumber(arg)))
      return 0
    case 'atfix': {
      const m = values.ruling === undefined ? undefined : Number(values.ruling)
      if (m !== undefined && (!Number.isInteger(m) || m <= 0))
        throw new Refusal('atfix --ruling needs the ruling number factory ruling printed.')
      const options = m === undefined ? {} : { ruling: m }
      print(await atfix(root, issueNumber(arg), values.note ?? '', options))
      return 0
    }
    case 'rewrite':
      print(await rewrite(root, issueNumber(arg), values.note ?? ''))
      return 0
    case 'block': {
      const file = positionals[2]
      if (!file) throw new Refusal('block needs the Decision Request file: block <n> <file>')
      const { request } = await block(root, issueNumber(arg), file)
      print(
        `Job #${arg} is blocked. Decision Request:\n\n${request}\n\nThe user answers with: ! bun run factory answer ${arg} "<text>"`,
      )
      return 0
    }
    case 'seal': {
      const pass = Number(values.pass)
      if (!Number.isInteger(pass) || pass <= 0)
        throw new Refusal('seal needs the review pass: seal <n> --pass <k> --roles <role,...>')
      const roles = (values.roles ?? '').split(',').filter(Boolean)
      const sealed = seal(root, issueNumber(arg), { pass, roles })
      print(
        `Sealed for pass ${sealed.pass} (${sealed.roles.join(', ')}): ${sealed.files.join(', ') || 'nothing to move'}.`,
      )
      return 0
    }
    case 'unseal': {
      const restored = unseal(root, issueNumber(arg))
      print(`Unsealed: ${restored.files.join(', ') || 'nothing to restore'}.`)
      return 0
    }
    case 'answer': {
      const text = positionals[2]
      if (!text) throw new Refusal('answer needs the text: answer <n> "<text>"')
      answer(root, issueNumber(arg), text)
      print(`Decision Request answered; run factory start ${arg} to resume.`)
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
      if (values.abandon) {
        print((await abandon(root, issueNumber(arg))).join('\n'))
        print(`Job #${arg} abandoned.`)
        return 0
      }
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
