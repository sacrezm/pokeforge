import { describe, expect, test } from 'claude-code/testing'

import { ART } from './fixtures/art'
import { SNAPSHOTS } from './fixtures/snapshots'
import { world } from './fixtures/world'

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
/** Each pane page, the /pokeforge argument that opens it, and the heading it shows. */
const PAGES = [['home', 'companion', 'trainingTitle'], ['collection', 'collection', 'collectionTitle'],
  ['activity', 'activity', 'usageTitle'], ['bag', 'bag', 'bagTitle']] as const
const POLL_MS = 15_000

describe('pokeforge', () => {
  test('an interactive start registers /pokeforge and reads one snapshot', async ($, on) => {
    const w = world($, on)
    await w.start()
    expect(w.registered).toEqual(['pokeforge'])
    expect(w.calls).toEqual([{ action: 'snapshot' }])
    const [node, helper] = w.argv[0]
    expect(node, 'argv, never a shell line').toBe('node')
    expect(helper).toMatch(/^\/.+\/dist\/mod-host\.mjs$/)
    expect(w.inits[0]?.cwd, 'runs from the plugin root, not the project').toBe(helper.slice(0, -'/dist/mod-host.mjs'.length))
  })

  test('a non-interactive start registers /pokeforge but reads, polls and opens nothing', async ($, on) => {
    const w = world($, on)
    await w.start(null, false)
    await w.clock.advance(4 * POLL_MS)
    expect(w.registered).toEqual(['pokeforge'])
    expect(w.calls).toEqual([])
    expect(w.opened).toEqual([])
  })

  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    test(`an SDK session wakes when ${surface} attaches and shows the companion in the pane`, async ($, on) => {
      const w = world($, on)
      Object.assign(w.state, { modArt: ART })
      await w.start(null, false)
      await w.attach(surface)
      expect(w.calls[0]).toEqual({ action: 'snapshot' })
      expect(w.opened.map(pane => pane.id)).toEqual(['pokeforge'])
      const pane = await w.pane(surface)
      expect(await w.text(pane)).toContain(SNAPSHOTS.hatched.companion.name)
      if (surface !== 'mobile') expect(await pane.find({ type: 'Svg' }), 'the sprite as Svg').toBeDefined()
      await w.clock.advance(POLL_MS)
      expect(w.calls.filter(call => call.action === 'snapshot')).toHaveLength(2)
    })
  }

  test('a pane the person closed stays closed on the next attach, and /pokeforge still opens it', async ($, on) => {
    const w = world($, on, SNAPSHOTS.hatched, { paneClosed: true })
    await w.start(null, false)
    await w.attach('desktop')
    expect(w.calls[0]).toEqual({ action: 'snapshot' })
    expect(w.opened).toEqual([])
    await w.command('')
    expect(w.opened.map(pane => pane.id)).toEqual(['pokeforge'])
  })

  test('the start does not wait on a slow engine', async ($, on) => {
    const w = world($, on)
    const slow = w.held()
    w.answer = () => slow.answer
    let started = false
    const starting = w.start().then(() => { started = true })
    await w.clock.settle()
    expect(w.registered).toEqual(['pokeforge'])
    expect(started, 'session.start returned while the first snapshot (engine auto-start) is still out').toBe(true)
    slow.release(w.ok(w.state))
    await starting
  })

  test('the band shows the companion at 40, 80 and 120 columns, totals from 55', async ($, on) => {
    const w = world($, on)
    await w.start()
    for (const columns of [40, 80, 120]) {
      const band = await w.band(columns)
      const text = await w.text(band)
      expect(text, `${columns} columns`).toContain('Pikachu')
      expect(text, `${columns} columns`).toContain(w.t('level', { n: 12 }))
      expect(text, `${columns} columns`).toContain('━')
      expect(text, `${columns} columns`).toContain(w.t('tokensRemaining', { n: w.compact(600000) }))
      const totals = w.t('toolbarTotals', { today: w.compact(150000), count: 10 })
      if (columns < 55) expect(text, `${columns} columns`).not.toContain(totals)
      else expect(text, `${columns} columns`).toContain(totals)
      await band.unmount()
    }
  })

  test('the band yields to a survey', async ($, on) => {
    const w = world($, on)
    await w.start()
    const band = await w.band(80, true)
    expect(await band.drawn()).toEqual({ type: 'Box' })
  })

  test("another plugin's band beneath stays beside ours", async ($, on) => {
    const w = world($, on)
    w.beneath = (kit, component) => component === 'AbovePrompt' ? kit.Box({ children: [kit.Text({ children: ['other-mod'] })] }) : undefined
    await w.start()
    const text = await w.text(await w.band(80))
    expect(text).toContain('other-mod')
    expect(text).toContain('Pikachu')
  })

  test('the band hides while the pane is open and returns after it closes', async ($, on) => {
    const w = world($, on)
    await w.start()
    const band = await w.band(80)
    expect(await band.find({ text: 'Pikachu' })).toBeDefined()
    const pane = await w.pane()
    for (const [how, close] of [['/pokeforge hide', () => w.command('hide')], ["the pane's Close button", () => pane.press({ key: 'close' })]] as const) {
      await w.command('')
      expect(await band.find({ text: 'Pikachu' }), 'pane open').toBeUndefined()
      const closes = w.closed.length
      await close()
      expect(w.closed.length, how).toBe(closes + 1)
      expect(await band.find({ text: 'Pikachu' }), `pane closed by ${how}`).toBeDefined()
    }
  })

  test('/pokeforge collection opens the pane on the collection page', async ($, on) => {
    const w = world($, on)
    await w.start()
    expect(await w.command('collection')).toEqual({ text: w.t('opened') })
    expect(w.opened.map(pane => pane.id)).toEqual(['pokeforge'])
    const pane = await w.pane()
    expect(await pane.find({ type: 'Input', key: 'search' })).toBeDefined()
    expect(await w.text(pane)).toContain(w.t('results', { n: 10 }))
  })

  test('every page draws on every surface, its controls in a form the surface has', async ($, on) => {
    const w = world($, on, { ...SNAPSHOTS.hatched, modArt: ART })
    await w.start()
    for (const surface of SURFACES) {
      for (const [page, arg, heading] of PAGES) {
        await w.command(arg)
        const pane = await w.pane(surface)
        const where = `${page} on ${surface}`
        expect(await pane.find({ text: w.t(heading) }), `${where}: the mod drew it`).toBeDefined()
        if (page === 'collection' && surface === 'mobile') {
          // Mobile has no Input or Select: the filter shows as its label and current value instead.
          expect(await w.text(pane), where).toContain(w.t('filter'))
          expect(await w.text(pane), where).toContain(w.t('all'))
        } else if (page === 'collection') {
          expect(await pane.find({ type: 'Input', key: 'search' }), where).toBeDefined()
          expect(await pane.find({ type: 'Select', key: 'filter' }), where).toBeDefined()
        }
        await pane.unmount()
      }
    }
  })

  test('the pane never says it runs in Codex', async ($, on) => {
    const w = world($, on)
    await w.start()
    await w.command('companion')
    expect(w.state.headless, 'the bundled engine runs headless').toBe(true)
    expect(await w.text(await w.pane())).not.toMatch(/Codex/)
  })

  test('the pane draws the sprite it is sent, and a placeholder without one', async ($, on) => {
    const w = world($, on, { ...SNAPSHOTS.egg, modArt: ART })
    await w.start()
    for (const surface of SURFACES) {
      const pane = await w.pane(surface)
      if (surface === 'terminal') expect(await pane.find({ type: 'Raster' }), surface).toMatchObject({ props: { columns: ART.columns, rows: ART.rows } })
      else expect(await pane.find({ type: 'Svg' }), surface).toMatchObject({ props: { alt: w.t('eggTitle') } })
      await pane.unmount()
    }
    w.state.modArt = null
    await w.clock.advance(POLL_MS)
    for (const surface of SURFACES) {
      const pane = await w.pane(surface)
      expect([...await pane.findAll({ type: 'Raster' }), ...await pane.findAll({ type: 'Svg' })], surface).toEqual([])
      expect(await w.text(pane), surface).toContain(w.t('eggTitle'))
      await pane.unmount()
    }
  })

  for (const [name, snapshot, said] of [
    ['an empty collection', SNAPSHOTS.empty, 'emptyCollection'],
    ['zero trainable Pokémon', SNAPSHOTS.untrainable, 'noTrainee'],
  ] as const) {
    test(`${name} draws no empty or unmatched Select`, async ($, on) => {
      const w = world($, on, snapshot)
      await w.start()
      let shown = ''
      for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
        for (const [arg, heading] of [['companion', 'trainingTitle'], ['collection', 'collectionTitle']]) {
          await w.command(arg)
          const pane = await w.pane(surface)
          expect(await pane.find({ text: w.t(heading) }), `${arg} on ${surface}: the mod drew it`).toBeDefined()
          for (const select of await pane.findAll({ type: 'Select' })) {
            const options = select.props.options as { value: string }[]
            expect(options.length, `${select.key} on ${surface}`).toBeGreaterThan(0)
            expect(options.map(o => o.value), `${select.key} value on ${surface}`).toContain(select.props.value)
          }
          shown += await w.text(pane)
          await pane.unmount()
        }
      }
      expect(shown).toContain(w.t(said))
    })
  }

  test('the collection searches, filters, sorts and pages', async ($, on) => {
    const w = world($, on)
    await w.start()
    await w.command('collection')
    const pane = await w.pane()
    const listed = async () => (await pane.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('detail:')).map(b => b.key!.slice(7))
    expect((await listed())[0], 'species order').toBe('p-bulbasaur')
    expect(await w.text(pane)).toContain(w.t('pageCount', { n: 1, total: 2 }))

    await pane.input({ key: 'search', text: 'char' })
    expect(await listed()).toEqual(['p-charmander'])
    await pane.input({ key: 'search', text: '' })

    await pane.select({ key: 'filter', value: 'shinyOnly' })
    expect(await listed()).toEqual(['p-magikarp', 'p-eevee'])
    await pane.select({ key: 'filter', value: 'all' })

    await pane.select({ key: 'sort', value: 'levelSort' })
    expect(await listed()).toEqual(['p-mewtwo', 'p-dragonite', 'p-gengar', 'p-snorlax', 'p-pikachu', 'p-charmander', 'p-eevee', 'p-bulbasaur'])

    await pane.press({ key: 'next' })
    expect(await listed()).toEqual(['p-squirtle', 'p-magikarp'])
    expect(await w.text(pane)).toContain(w.t('pageCount', { n: 2, total: 2 }))
    await pane.press({ key: 'prev' })
    expect(await listed()).toHaveLength(8)
  })

  test("a Pokémon's detail shows its EVs and Back returns to the list", async ($, on) => {
    const w = world($, on)
    await w.start()
    await w.command('collection')
    const pane = await w.pane()
    await pane.press({ key: 'detail:p-pikachu' })
    expect(w.calls.at(-1)).toEqual({ action: 'sprite', speciesID: 25, shiny: false })
    const text = await w.text(pane)
    expect(text).toContain(w.t('evs'))
    expect(text).toContain(w.t('evTotal', { n: 172 }))
    const rows = await pane.findAll({ type: 'Box' })
    for (const [stat, value] of [['hp', 40], ['attack', 12], ['speed', 120]] as const) {
      expect(rows.find(row => row.children.length === 3 && row.text.includes(w.t(stat)) && row.text.endsWith(String(value))), stat).toBeDefined()
    }
    await pane.press({ key: 'back' })
    expect(await w.text(pane)).toContain(w.t('results', { n: 10 }))
    expect(await w.text(pane)).not.toContain(w.t('evs'))
  })

  test('a wallet too low for the shop offers no buy button', async ($, on) => {
    const w = world($, on, SNAPSHOTS.poor)
    await w.start()
    await w.command('bag')
    const pane = await w.pane()
    const buys = (await pane.findAll({ type: 'Button' })).filter(b => /^buy(Item|Ball):/.test(b.key ?? ''))
    expect(buys).toEqual([])
  })

  test('buying asks first, then confirm sends one buyItem at the shown price', async ($, on) => {
    const w = world($, on)
    await w.start()
    await w.command('bag')
    const pane = await w.pane()
    await pane.press({ key: 'buyItem:rareCandy' })
    expect(w.mutations(), 'nothing before the confirmation').toEqual([])
    expect(await w.text(pane)).toContain(w.t('confirmTitle'))
    expect(await w.text(pane), 'names what it buys and for how much').toContain(w.t('buyAction', { name: w.t('rareCandy'), n: w.compact(SNAPSHOTS.hatched.items[0].price) }))
    await pane.press({ key: 'confirm' })
    expect(w.mutations()).toEqual([{ action: 'buyItem', value: 'rareCandy', expectedPrice: SNAPSHOTS.hatched.items[0].price }])
    expect(await w.text(pane)).toContain(w.t('have', { n: 4 }))
  })

  test('two quick confirms send one buyItem', async ($, on) => {
    const w = world($, on)
    await w.start()
    await w.command('bag')
    const pane = await w.pane()
    const engine = w.held()
    w.answer = input => input.action === 'buyItem' ? engine.answer : undefined
    await pane.press({ key: 'buyItem:rareCandy' })
    const presses = [pane.press({ key: 'confirm' }), pane.press({ key: 'confirm' })]
    await w.clock.settle()
    engine.release(w.ok(w.state))
    await Promise.allSettled(presses)
    expect(w.mutations()).toHaveLength(1)
  })

  test('cancel sends nothing and returns to the shop', async ($, on) => {
    const w = world($, on)
    await w.start()
    await w.command('bag')
    const pane = await w.pane()
    await pane.press({ key: 'buyItem:rareCandy' })
    await pane.press({ key: 'cancel' })
    await w.clock.advance(POLL_MS)
    expect(w.mutations()).toEqual([])
    expect(await pane.find({ key: 'confirm' })).toBeUndefined()
    expect(await w.text(pane)).toContain(w.t('bagTitle'))
  })

  test('closing the pane forgets the pending confirmation', async ($, on) => {
    const w = world($, on)
    await w.start()
    await w.command('bag')
    const pane = await w.pane()
    await pane.press({ key: 'buyItem:rareCandy' })
    await pane.press({ key: 'close' })
    expect(w.closed.map(pane => pane.id)).toEqual(['pokeforge'])
    await pane.unmount()
    await w.command('bag')
    const reopened = await w.pane()
    expect(await reopened.find({ key: 'confirm' })).toBeUndefined()
    expect(await reopened.find({ key: 'buyItem:rareCandy' })).toBeDefined()
    expect(w.mutations()).toEqual([])
  })

  for (const [name, fail] of [
    ['a host that rejects the run', () => ({ deny: 'could not start node' })],
    ['an engine answering outcome_unknown', (w: ReturnType<typeof world>) => w.ok({ error: 'outcome_unknown' })],
    ['unreadable stdout', () => ({ value: { exitCode: 0, stdout: '{"schemaVersion":1,"collec', stderr: '' } })],
  ] as const) {
    test(`${name} after a purchase reports outcome_unknown and is never re-sent`, async ($, on) => {
      const w = world($, on)
      await w.start()
      await w.command('bag')
      const pane = await w.pane()
      w.answer = input => input.action === 'buyItem' ? fail(w) : undefined
      await pane.press({ key: 'buyItem:rareCandy' })
      await pane.press({ key: 'confirm' })
      expect(await w.text(pane)).toContain(w.error('outcome_unknown'))
      const before = w.calls.length
      await w.clock.advance(4 * POLL_MS)
      const later = w.calls.slice(before).map(c => c.action)
      expect(later.length).toBeGreaterThanOrEqual(3)
      expect(later.filter(a => a !== 'snapshot'), 'only snapshots follow').toEqual([])
    })
  }

  test('a purchase that times out reports outcome_unknown and is never re-sent', async ($, on) => {
    const w = world($, on)
    await w.start()
    await w.command('bag')
    const pane = await w.pane()
    const engine = w.held()
    w.answer = input => input.action === 'buyItem' ? engine.answer : undefined
    await pane.press({ key: 'buyItem:rareCandy' })
    const pressed = pane.press({ key: 'confirm' })
    await w.clock.advance(3 * POLL_MS)
    engine.release({ deny: 'timed out after 60000 ms' })
    await pressed
    await w.clock.settle()
    expect(await w.text(pane)).toContain(w.error('outcome_unknown'))
    const before = w.calls.length
    await w.clock.advance(4 * POLL_MS)
    expect(w.calls.slice(before).filter(c => c.action !== 'snapshot')).toEqual([])
    expect(w.mutations()).toHaveLength(1)
  })

  test('unreadable snapshot stdout shows a catalog error, not a crash', async ($, on) => {
    const w = world($, on)
    w.answer = () => ({ value: { exitCode: 1, stdout: 'node: not found', stderr: '' } })
    await w.start()
    expect(await w.text(await w.band(80)), 'the band stays one short line').toContain(w.t('offline'))
    const text = await w.text(await w.pane())
    expect([w.error('invalid_response'), w.error('host_connection')].some(error => text.includes(error)), text).toBe(true)
  })

  test('a snapshot started before a purchase cannot overwrite its result', async ($, on) => {
    const w = world($, on)
    await w.start()
    await w.command('bag')
    const pane = await w.pane()
    const before = structuredClone(w.state)
    const slow = w.held()
    w.answer = input => input.action === 'snapshot' ? (w.answer = undefined, slow.answer) : undefined
    await w.clock.advance(POLL_MS)
    expect(w.calls.at(-1)).toEqual({ action: 'snapshot' })
    await pane.press({ key: 'buyItem:rareCandy' })
    await pane.press({ key: 'confirm' })
    expect(await w.text(pane)).toContain(w.t('have', { n: 4 }))
    slow.release(w.ok(before))
    await w.clock.settle()
    expect(await w.text(pane)).toContain(w.t('have', { n: 4 }))
  })

  test('a later successful snapshot clears the error', async ($, on) => {
    const w = world($, on)
    await w.start()
    await w.command('bag')
    const pane = await w.pane()
    w.answer = input => input.action === 'buyItem' ? { deny: 'could not start node' } : undefined
    await pane.press({ key: 'buyItem:rareCandy' })
    await pane.press({ key: 'confirm' })
    expect(await w.text(pane)).toContain(w.error('outcome_unknown'))
    await w.clock.advance(POLL_MS)
    const text = await w.text(pane)
    expect(text).not.toContain(w.error('outcome_unknown'))
    expect(text).toContain(w.t('bagTitle'))
  })

  test('session end stops polling', async ($, on) => {
    const w = world($, on)
    await w.start()
    await w.clock.advance(POLL_MS)
    expect(w.calls).toHaveLength(2)
    await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })
    await w.clock.advance(4 * POLL_MS)
    expect(w.calls).toHaveLength(2)
  })

  for (const reason of ['clear', 'resume'] as const) {
    test(`/${reason} ends the session, not the companion`, async ($, on) => {
      const w = world($, on)
      await w.start()
      await $.session.end({ reason, sessionId: 's1', resume: { id: 's1' } })
      await w.clock.advance(POLL_MS)
      expect(w.calls, 'polling goes on: no new session.start follows').toHaveLength(2)
      expect(await w.text(await w.band(80))).toContain(SNAPSHOTS.hatched.companion.name)
    })
  }

  test('a failed engine start is retried by the person, not by every poll', async ($, on) => {
    const w = world($, on)
    w.answer = () => w.ok({ error: 'engine_start_failed' })
    await w.start()
    await w.clock.advance(4 * POLL_MS)
    await $.turn.complete({ answer: '' } as any).catch(() => {})
    expect(w.calls).toHaveLength(1)
    const band = await w.band(80)
    expect(await w.text(band)).toContain(w.t('offline'))
    expect(await w.text(await w.pane())).toContain(w.error('engine_start_failed'))
    w.answer = undefined
    await band.press({ key: 'retry' })
    expect(w.calls).toHaveLength(2)
    expect(await w.text(band)).toContain(SNAPSHOTS.hatched.companion.name)
  })

  test('a real-sized save lists at most 64 trainees, the current one first', async ($, on) => {
    const w = world($, on, SNAPSHOTS.crowded)
    await w.start()
    const pane = await w.pane()
    const select = await pane.find({ type: 'Select', key: 'target' })
    const options = select?.props.options as { value: string }[]
    expect(options.length).toBeLessThanOrEqual(64)
    expect(options[0].value).toBe('p-0')
  })

  test('/pokeforge <page> leaves an open detail for the page asked for', async ($, on) => {
    const w = world($, on)
    await w.start()
    await w.command('collection')
    const pane = await w.pane()
    await pane.press({ key: `detail:${SNAPSHOTS.hatched.collection[0].id}` })
    expect(await w.text(pane)).toContain(w.t('evs'))
    await w.command('bag')
    expect(await w.text(pane)).toContain(w.t('balls'))
    expect(await w.text(pane)).not.toContain(w.t('evs'))
  })

  test('a mode change runs at once, without confirmation', async ($, on) => {
    const w = world($, on)
    await w.start()
    await w.command('companion')
    const pane = await w.pane()
    await pane.press({ key: 'mode:training' })
    expect(w.mutations()).toEqual([{ action: 'mode', value: 'training' }])
    expect(await pane.find({ key: 'confirm' })).toBeUndefined()
    expect((await pane.find({ key: 'mode:training' }))?.props.label).toBe(`● ${w.t('training')}`)
  })

  test('the native shortcuts are labelled from the catalog', async ($, on) => {
    const w = world($, on)
    await w.start()
    await w.command('companion')
    const pane = await w.pane()
    expect((await pane.find({ key: 'openNative:trade' }))?.props.label).toBe(w.t('nativeTrade'))
    expect((await pane.find({ key: 'openNative:settings' }))?.props.label).toBe(w.t('nativeSettings'))
  })
})
