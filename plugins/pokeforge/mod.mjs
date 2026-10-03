import { pane, toolbar, t } from './mod-view.mjs';

const PANE = 'pokeforge';
const SPENDING = ['candy', 'mint', 'buyItem', 'buyBall', 'queueBall'];
// After a failed engine start only the person retries; an automatic refresh would relaunch it each time.
const STARTUP = ['engine_start_failed', 'engine_invalid', 'engine_platform'];

/** All game state is a live native snapshot. Only ephemeral view state lives here. */
export function register(on) {
  const view = { state: null, page: 'home', search: '', filter: 'all', sort: 'speciesSort', offset: 0,
    detail: null, detailArt: null, pending: null, busy: false, error: null, notice: '', open: false };
  // remote: woken by a client attach, where the pane is the companion and its close is remembered.
  let root, host, poll, wake, remote = false, revision = 0, reading = false, ended = false;

  const invalidate = () => host?.invalidate();
  async function call(input) {
    if (!root) return { error: 'host_connection' };
    // The plugin root as cwd keeps a version manager's per-project node choice out of it.
    const result = await host.run(['node', `${root}/dist/mod-host.mjs`, JSON.stringify(input)], { cwd: root, timeoutMs: 60000 });
    const state = JSON.parse(result.stdout);
    if (state.error) return state;
    if (input.action === 'sprite') return state;
    if (state.schemaVersion !== 1 || !Array.isArray(state.collection) || !state.companion || !state.training || !state.usage) return { error: 'invalid_response' };
    return state;
  }
  function accept(result) {
    const previous = view.state;
    view.state = result.schemaVersion === 1 ? result : null;
    view.error = result.error ?? (result.saveError ? 'save_failed' : null);
    if (view.state && !view.error && previous && previous.companion.egg && !result.companion.egg) host.toast(t('hatched', { name: result.companion.name }));
    if (view.state && view.detail && !view.state.collection.some(p => p.id === view.detail)) { view.detail = null; view.detailArt = null; }
  }
  async function refresh() {
    if (reading || view.busy || ended || !host) return;
    reading = true;
    const started = revision;
    try { const result = await call({ action: 'snapshot' }); if (started === revision && !ended) accept(result); }
    catch { if (started === revision && !ended) { view.state = null; view.error = 'host_connection'; } }
    finally { reading = false; invalidate(); }
  }
  const auto = () => { if (!STARTUP.includes(view.error)) void refresh(); };
  async function mutate(input) {
    if (view.busy || ended) return;
    view.busy = true; revision++; view.notice = t('saving'); invalidate();
    try {
      const result = await call(input); accept(result);
      view.notice = view.error ? '' : t('saved');
    } catch { view.state = null; view.error = 'outcome_unknown'; view.notice = ''; }
    finally { view.busy = false; invalidate(); }
  }
  async function open(page = view.page) {
    const next = ['home', 'collection', 'activity', 'bag'].includes(page) ? page : 'home';
    if (next !== view.page) { view.detail = null; view.detailArt = null; view.pending = null; }
    view.page = next; view.open = true;
    try { await host.open({ id: PANE, title: t('name'), columns: 58, rows: 34, focus: true, closeOnEscape: true }); if (remote) void host.remember(false).catch(() => {}); }
    catch { view.open = false; }
    invalidate();
  }
  // A plugin's own close raises no ui.close hook of its own, so it forgets the pane here too.
  const closed = () => { view.open = false; view.pending = null; invalidate(); };
  const actions = {
    open, refresh,
    close: async () => { await host?.close({ id: PANE }).catch(() => {}); closed(); if (remote) void host?.remember(true).catch(() => {}); },
    page: page => { view.page = page; view.detail = null; view.pending = null; view.notice = ''; invalidate(); },
    search: value => { view.search = value; view.offset = 0; invalidate(); },
    filter: value => { view.filter = value; view.offset = 0; invalidate(); },
    sort: value => { view.sort = value; view.offset = 0; invalidate(); },
    offset: value => { view.offset = value; invalidate(); },
    detail: async id => {
      view.detail = id; view.detailArt = null; invalidate();
      const pokemon = view.state?.collection.find(p => p.id === id);
      if (!pokemon) return;
      try {
        const result = await call({ action: 'sprite', speciesID: pokemon.speciesID, shiny: pokemon.shiny });
        if (view.detail === id) view.detailArt = result.art;
      } catch {}
      invalidate();
    },
    back: () => { view.detail = null; view.pending = null; view.notice = ''; invalidate(); },
    cancel: () => { view.pending = null; invalidate(); },
    // Spending waits for confirm; the snapshot's target and price are captured now and re-checked natively.
    request: async (input, label) => {
      if (view.busy || !view.state || view.pending) return;
      if (SPENDING.includes(input.action)) { view.pending = { input, label }; await open(); }
      else await mutate(input);
    },
    confirm: async () => {
      if (!view.pending || view.busy) return;
      const input = view.pending.input; view.pending = null;
      await mutate(input);
    },
  };

  on('session.start', async ($, e, next) => {
    ended = false; poll?.cancel(); host = undefined;
    // The SDK (Desktop's Code tab, VS Code) starts non-interactive and draws once a client attaches; -p never does.
    wake = () => {
      if (host || ended) return;
      // Each effect stays spelled $.noun.event(...) so validation can enumerate it.
      host = {
        run: (argv, init) => $.process.run(argv, init),
        invalidate: () => $.ui.invalidate('ui.render'),
        open: pane => $.ui.open(pane),
        close: pane => $.ui.close(pane),
        toast: text => $.ui.toast(text),
        remember: closed => $.store.set('paneClosed', closed),
      };
      root = $.plugin.root;
      void refresh();
      poll = $.clock.every(15000, auto);
    };
    await $.command.register({ name: 'pokeforge', description: t('commandDescription'), argumentHint: t('commandHint'), immediate: true });
    if (e.isInteractive) wake();
    return next(e);
  });
  // Remote surfaces have no band above the prompt: the pane is their companion, unless the person closed it last time.
  on('session.attach', async ($, e, next) => {
    if (!host && !ended) {
      wake?.(); remote = true;
      if (await $.store.get('paneClosed').catch(() => undefined) !== true) {
        view.open = true; void host.open({ id: PANE, title: t('name'), columns: 58, rows: 34 }).catch(() => { view.open = false; });
      }
    }
    return next(e);
  });
  // /clear and resume end a session but not the process: no new session.start follows them.
  on('session.end', ($, e, next) => {
    if (e.reason !== 'clear' && e.reason !== 'resume') { ended = true; poll?.cancel(); }
    return next(e);
  });
  on('turn.complete', ($, e, next) => { auto(); return next(e); });
  on('command.run', { command: 'pokeforge' }, async ($, e) => {
    wake?.();
    const arg = e.args.trim();
    if (arg === 'hide') await actions.close();
    else if (arg === 'refresh') await refresh();
    else await open({ companion: 'home', collection: 'collection', activity: 'activity', bag: 'bag' }[arg] ?? view.page);
    return { text: t(arg === 'hide' ? 'hidden' : 'opened') };
  });
  on('ui.close', { id: 'pokeforge' }, async ($, e, next) => {
    const result = await next(e);
    if (result?.deny === undefined) {
      closed();
      if (remote && e.origin?.kind === 'person') void $.store.set('paneClosed', true).catch(() => {});
    }
    return result;
  });
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const previous = await next(e);
    if (!host || ended || e.props.hasSurvey || view.open) return previous;
    const kit = $.ui.resolve(e);
    return kit.Box({ flexDirection: 'column', children: [previous, toolbar(kit, view, actions, e.props.bodyColumns)] });
  });
  on('ui.render', { component: 'Pane' }, ($, e, next) => {
    if (e.requestId !== PANE || !host || ended) return next(e);
    return pane($.ui.resolve(e), view, actions, Math.max(24, e.props.bodyColumns ?? 58), e.surface);
  });
}
