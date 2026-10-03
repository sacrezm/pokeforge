import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { COPY as copy } from './copy'
import { ART } from './art'
import { SNAPSHOTS } from './snapshots'

type Input = { action: string, value?: string, expectedPrice?: number, speciesID?: number, shiny?: boolean }
type Answer = { value: { exitCode: number, stdout: string, stderr: string } } | { deny: string }
type Surface = 'terminal' | 'desktop' | 'vscode' | 'mobile'
type Node = string | { type?: string, props?: Record<string, unknown>, children?: Node[] } | null | undefined

const textOf = (node: Node): string => typeof node === 'string' ? node
  : node ? [node.props?.label ?? '', ...(node.children ?? []).map(textOf)].join(' ') : ''

/**
 * The world beneath the mod: a mocked clock and store, the host answers it needs, and a fake
 * mod-host CLI that parses argv[2] as the real one does, records it, and answers from `state`.
 */
export function world($: Engine, on: On, start: typeof SNAPSHOTS.hatched = SNAPSHOTS.hatched, store: Record<string, unknown> = {}) {
  const clock = mock.clock(on)
  mock.store(on, store)
  const w = {
    clock,
    state: structuredClone(start),
    /** Every mod-host call, its argv[2] parsed; `argv` the raw argv. */
    calls: [] as Input[],
    argv: [] as (readonly string[])[],
    /** Every mod-host call's run options (cwd, timeoutMs). */
    inits: [] as ({ cwd?: string, timeoutMs?: number } | undefined)[],
    opened: [] as { id: string }[],
    closed: [] as { id: string }[],
    toasts: [] as string[],
    registered: [] as string[],
    /** Answers a call in place of the fake engine; undefined falls through to it. */
    answer: undefined as undefined | ((input: Input) => Answer | Promise<Answer> | undefined),
    /** Another plugin's drawing beneath the mod; undefined draws an empty Box. */
    beneath: undefined as undefined | ((kit: any, component: string) => unknown),
    ok: (body: unknown): Answer => ({ value: { exitCode: 0, stdout: JSON.stringify(body), stderr: '' } }),
    held: () => {
      let release!: (answer: Answer) => void
      const answer = new Promise<Answer>(resolve => { release = resolve })
      return { answer, release }
    },
    mutations: () => w.calls.filter(c => c.action !== 'snapshot' && c.action !== 'sprite'),
    /** The catalog text the mod draws for a key, slots filled as the mod fills them. */
    t: (key: string, slots: Record<string, unknown> = {}) => Object.entries(slots)
      .reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), (copy.mod as any)[key] ?? (copy as any)[key]),
    error: (code: keyof typeof copy.errors) => (copy.mod.errors as Record<string, string>)[code] ?? copy.errors[code],
    compact: (n: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n),
    start: (surface: Surface | null = 'terminal', isInteractive = true) => $.session.start({ surface, isInteractive, cwd: '/work' }),
    /** A remote client joining an SDK session, as Desktop's Code tab and VS Code do after a non-interactive start. */
    attach: (surface: Surface) => $.session.attach({ surface, clientId: `${surface}:default` }),
    command: (args: string) => $.command.run({ command: 'pokeforge', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } }),
    band: (bodyColumns = 80, hasSurvey = false) => $.ui.mount({ plugin: 'pokeforge', surface: 'terminal', component: 'AbovePrompt',
      props: { hasSurvey, isWorking: false, maxRows: 12, bodyColumns, scroll: { offset: 0, bodyRows: 12 }, view: {} } }),
    pane: (surface: Surface = 'terminal', bodyColumns = 58) => $.ui.mount({ plugin: 'pokeforge', surface, component: 'Pane', requestId: 'pokeforge',
      props: { title: copy.mod.name, isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 25 }, view: {} } }),
    /** Everything a drawing shows, Button labels included, as one string. */
    text: async (ui: { drawn: () => Promise<unknown> }) => textOf(await ui.drawn() as Node),
  }

  function engine(input: Input) {
    const { state } = w
    if (input.action === 'sprite') return { art: ART }
    if (input.action === 'buyItem') {
      const item = state.items.find(i => i.id === input.value)!
      state.wallet -= item.price; item.count += 1
    }
    if (input.action === 'mode') state.training.mode = input.value!
    return state
  }

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.attach', ($, e) => ({ clientId: e.clientId }))
  on('command.register', ($, e) => { w.registered.push(e.name); return { value: { command: e.name } } })
  on('ui.render', ($, e) => (w.beneath?.($.ui.resolve(e), e.component) ?? $.ui.resolve(e).Box({ children: [] })) as any)
  on('ui.open', ($, e) => { w.opened.push(e); return { value: undefined } })
  on('ui.close', ($, e) => { w.closed.push(e); return { value: undefined } })
  on('ui.toast', ($, e) => { w.toasts.push(e.text); return { value: undefined } })
  on('process.run', async ($, e) => {
    const input = JSON.parse(e.argv[2]) as Input
    w.calls.push(input); w.argv.push(e.argv); w.inits.push(e.init)
    return (await w.answer?.(input)) ?? w.ok(engine(input))
  })
  return w
}
