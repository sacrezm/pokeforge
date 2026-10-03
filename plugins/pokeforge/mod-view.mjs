import copy from './locales/en.json' with { type: 'json' };

const stats = ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed'];
export const t = (key, slots = {}) => Object.entries(slots).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), copy.mod[key] ?? copy[key] ?? key);
const failure = key => copy.mod.errors[key] ?? copy.errors[key] ?? copy.errors.invalid_response;
const number = value => value == null ? '—' : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const clean = value => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, '');
const clip = (value, width) => { const s = [...clean(value)]; return s.length <= width ? s.join('') : `${s.slice(0, Math.max(0, width - 1)).join('')}…`; };
const bar = (fraction, width = 18) => { const n = Math.round(Math.max(0, Math.min(1, Number(fraction) || 0)) * width); return `${'━'.repeat(n)}${'─'.repeat(width - n)}`; };
const percent = fraction => `${Math.round(Math.max(0, Math.min(1, Number(fraction) || 0)) * 100)}%`;
// The host refuses a Select with more options than this.
const SELECT_MAX = 64;

// resolve() hands out every constructor on every surface and draws an unsupported one as nothing,
// so elements are chosen by surface: Raster on the terminal, Svg elsewhere, no Input/Select on mobile.
function kitOf(kit, view, actions, width, surface = 'terminal') {
  const controls = surface !== 'mobile';
  const text = (value, props = {}) => kit.Text({ ...props, children: [clean(value)] });
  const column = (...children) => kit.Box({ flexDirection: 'column', children: children.flat().filter(Boolean) });
  const section = (...children) => kit.Box({ flexDirection: 'column', marginTop: 1, children: children.flat().filter(Boolean) });
  const row = (...children) => kit.Box({ columnGap: 1, flexWrap: 'wrap', alignItems: 'center', children: children.flat().filter(Boolean) });
  // Spending and choices keep the button chrome; navigation draws plain, dim at rest, as Claude Code's own lists do.
  const button = (key, label, fn, enabled = true) => enabled && !view.busy
    ? kit.Button({ key, label: clean(label), onPress: fn }) : text(label, { dimColor: true });
  const link = (key, label, fn, enabled = true, dim = true) => enabled && !view.busy
    ? kit.Button({ key, label: clean(label), plain: true, dimColor: dim, onPress: fn }) : text(label, { dimColor: true });
  const action = (input, label, enabled = true, prompt = label) => button(`${input.action}:${input.value ?? ''}`, label,
    () => actions.request(input, prompt), enabled);
  const heading = (label, trailing = '') => row(text(label, { bold: true, color: 'suggestion' }), trailing ? text(trailing, { dimColor: true }) : null);
  const name = (label, trailing = '') => row(text(label, { bold: true }), trailing ? text(trailing, { dimColor: true }) : null);
  const kv = (label, value) => row(text(label, { dimColor: true }), text(value));
  // A Select needs options; without the element a short list becomes buttons, a long one shows its value.
  const select = (key, label, value, options, change) => controls && options.length && !view.busy
    ? kit.Select({ key, label, value, options: options.map(o => ({ value: o.value, label: clean(o.label) })), onSelect: change })
    : row(text(label, { dimColor: true }), options.length > 1 && options.length <= 6
      ? options.map(o => link(`${key}:${o.value}`, `${o.value === value ? '● ' : ''}${o.label}`, () => change(o.value), true, o.value !== value))
      : text(options.find(o => o.value === value)?.label ?? '—'));
  const art = (image, label) => !image ? text('◒', { color: 'claude', bold: true })
    : surface !== 'terminal' ? kit.Svg({ source: image.svg, alt: clean(label), width: 128, height: 128 })
    : width >= 36 ? kit.Raster({ key: 'pokemon-art', columns: image.columns, rows: image.rows, cells: image.cells }) : null;
  // Wide terminals draw the 32-column art beside its facts instead of 16 rows above them.
  const beside = width >= 72 && surface === 'terminal';
  const hero = (image, label, ...facts) => beside && image
    ? kit.Box({ columnGap: 2, children: [art(image, label), column(...facts)] }) : column(art(image, label), ...facts);
  const room = beside ? width - 34 : width;
  const progress = (fraction, label) => row(text(bar(fraction, Math.max(6, Math.min(24, room - 16))), { color: 'success' }), text(percent(fraction), { dimColor: true }), label ? text(label, { dimColor: true }) : null);
  const xp = pokemon => pokemon.nextXP == null ? text(t('maxLevel'), { dimColor: true }) : text(t('xpNext', { n: number(pokemon.nextXP) }), { dimColor: true });
  return { controls, text, column, section, row, button, link, action, heading, name, kv, select, art, hero, progress, xp };
}

export function toolbar(kit, view, actions, width = 80) {
  const { text, column, row, link } = kitOf(kit, view, actions, width);
  const state = view.state;
  // The band stays one line; the pane carries the full explanation.
  if (!state) return row(text('◒', { color: 'claude' }), text(t('name'), { bold: true }), text(view.error ? t('offline') : t('loading'), { dimColor: true }),
    view.error ? link('retry', t('retry'), actions.refresh) : null, view.error ? link('open', t('details'), () => actions.open()) : null);
  const p = state.companion, pokemon = state.collection.find(entry => entry.id === p.activeID);
  const label = p.egg ? t('eggTitle') : `${p.shiny ? '✦ ' : ''}${p.name}${pokemon ? ` · ${t('level', { n: pokemon.level })}` : ''}`;
  const today = state.usage.providers.reduce((n, provider) => n + (provider.today ?? 0), 0);
  return column(
    row(text('◒', { color: 'claude' }), text(clip(label, Math.max(12, width - 8)), { bold: true }),
      text(bar(p.progress, Math.max(6, Math.min(18, width - 52))), { color: 'success' }),
      text(p.hatching ? t('hatching') : t('tokensRemaining', { n: number(p.remaining) }), { dimColor: true }),
      link('open', t('open'), () => actions.open())),
    width >= 55 ? row(text(t(state.training.mode), { color: 'claude' }), text(t('toolbarTotals', { today: number(today), count: state.collection.length }), { dimColor: true })) : null,
    view.error ? text(failure(view.error), { color: 'error' }) : null,
  );
}

export function pane(kit, view, actions, width = 58, surface = 'terminal') {
  const ui = kitOf(kit, view, actions, width, surface);
  const { controls, text, column, section, row, button, link, action, heading, name, kv, select, hero, progress, xp } = ui;
  const state = view.state;
  const status = view.notice || (state?.sandbox ? t('sandbox') : state?.headless ? t('standalone') : '');
  const title = kit.Box({ justifyContent: 'space-between', children: [
    row(text(t('name'), { bold: true, color: 'claude' }), status ? text(status, { dimColor: true }) : null), link('close', t('close'), actions.close)] });
  const nav = kit.Box({ columnGap: 2, flexWrap: 'wrap', children: ['home', 'collection', 'activity', 'bag']
    .map(page => link(`page:${page}`, `${view.page === page ? '● ' : ''}${t(page)}`, () => actions.page(page), true, view.page !== page)) });
  const error = view.error ? text(failure(view.error), { color: 'error' }) : null;
  const header = column(title, nav, error);
  if (!state) return column(header, error ? null : text(t('loading'), { dimColor: true }), section(link('retry', t('retry'), actions.refresh, true, false)));
  if (view.pending) return column(header, section(heading(t('confirmTitle')), text(t('confirmBody', { action: view.pending.label })),
    section(row(button('confirm', t('confirm'), actions.confirm), link('cancel', t('cancel'), actions.cancel)))));
  const named = id => state.collection.find(p => p.id === id)?.name ?? t('unknown');

  const detail = state.collection.find(p => p.id === view.detail);
  if (detail) return column(header, section(link('back', t('back'), actions.back)),
    hero(view.detailArt, detail.name,
      heading(`${detail.shiny ? '✦ ' : ''}${detail.name}`, `#${String(detail.speciesID).padStart(3, '0')}`),
      row(text(t('level', { n: detail.level }), { color: 'success' }), text(t(detail.rarity), { dimColor: true })), xp(detail),
      kv(t('nature'), copy.natures[detail.nature] ?? detail.nature ?? t('unknown')),
      detail.trainer ? kv(t('trainer'), detail.trainer) : null),
    section(heading(t('evs'), t('evTotal', { n: Object.values(detail.evs).reduce((a, b) => a + b, 0) })),
      ...stats.map(stat => kit.Box({ columnGap: 1, children: [kit.Box({ width: 16, children: [text(t(stat), { dimColor: true })] }),
        text(bar((detail.evs[stat] ?? 0) / 252, 14), { color: 'success' }), text(String(detail.evs[stat] ?? 0).padStart(3), { dimColor: true })] }))),
    section(row(action({ action: 'target', value: detail.id }, t('trainThis'), detail.trainable && detail.id !== state.training.target),
      action({ action: 'candy', value: detail.id }, t('candyAction'), detail.id === state.training.target && state.training.canCandy, t('candyFor', { name: detail.name })))),
  );

  if (view.page === 'home') {
    const p = state.companion, current = state.collection.find(pokemon => pokemon.id === p.activeID), trainee = state.collection.find(pokemon => pokemon.id === state.training.target);
    // The current trainee first, then the strongest, within what a Select can hold; Collection reaches the rest.
    const trainable = state.collection.filter(pokemon => pokemon.trainable)
      .sort((a, b) => (b.id === trainee?.id) - (a.id === trainee?.id) || b.level - a.level).slice(0, trainee ? SELECT_MAX : SELECT_MAX - 1);
    const trainees = [...trainee ? [] : [{ value: '', label: t('chooseTrainee') }], ...trainable.map(pokemon => ({ value: pokemon.id, label: `${pokemon.name} · ${t('level', { n: pokemon.level })}` }))];
    const today = state.usage.providers.reduce((n, provider) => n + (provider.today ?? 0), 0);
    return column(header,
      section(hero(state.modArt, p.egg ? t('eggTitle') : p.name,
        heading(p.egg ? t('eggTitle') : `${p.shiny ? '✦ ' : ''}${p.name}`, current ? t('level', { n: current.level }) : ''),
        progress(p.progress, t(p.egg ? 'nextHatch' : p.finalStage ? 'nextCollection' : 'nextEvolution')),
        text(p.hatching ? t('hatching') : t('tokensRemaining', { n: number(p.remaining) }), { dimColor: true }),
        current ? xp(current) : null)),
      section(heading(t('trainingTitle')),
        row(...['catching', 'training', 'balanced'].map(mode => action({ action: 'mode', value: mode }, `${state.training.mode === mode ? '● ' : ''}${t(mode)}`))),
        text(t(`mode_${state.training.mode}`), { dimColor: true }),
        trainable.length ? select('target', t('trainee'), trainee?.id ?? '', trainees, id => id && actions.request({ action: 'target', value: id }, t('trainThis'))) : text(t('noTrainee'), { dimColor: true }),
        trainee ? xp(trainee) : null,
        select('focus', t('focus'), state.training.focus, stats.map(stat => ({ value: stat, label: t(stat) })), value => actions.request({ action: 'focus', value }, t(value)))),
      section(kv(t('today'), number(today)), kv(t('owned'), String(state.collection.length)), kv(t('wallet'), number(state.wallet))),
      section(row(action({ action: 'openNative', value: 'trade' }, t('nativeTrade'), !state.sandbox), action({ action: 'openNative', value: 'settings' }, t('nativeSettings'), !state.sandbox),
        link('refresh', t('refresh'), actions.refresh))),
    );
  }
  if (view.page === 'collection') {
    const query = view.search.toLowerCase();
    const list = state.collection.filter(p => `${p.name} ${p.speciesID}`.toLowerCase().includes(query) && (view.filter !== 'shinyOnly' || p.shiny) && (view.filter !== 'trainableOnly' || p.trainable));
    list.sort((a, b) => view.sort === 'levelSort' ? b.level - a.level : view.sort === 'recentSort' ? (b.recordedAt ?? 0) - (a.recordedAt ?? 0) : a.speciesID - b.speciesID);
    const offset = Math.min(view.offset, Math.max(0, Math.floor((list.length - 1) / 8) * 8));
    return column(header,
      section(controls ? kit.Input({ key: 'search', label: t('search'), value: view.search, placeholder: t('searchPlaceholder'), onInput: actions.search, onSubmit: actions.search }) : null,
        select('filter', t('filter'), view.filter, ['all', 'shinyOnly', 'trainableOnly'].map(value => ({ value, label: t(value) })), actions.filter),
        select('sort', t('sort'), view.sort, ['speciesSort', 'levelSort', 'recentSort'].map(value => ({ value, label: t(value) })), actions.sort)),
      section(heading(t('collectionTitle'), t('results', { n: list.length })),
        ...list.slice(offset, offset + 8).map(p => row(
          text(`#${String(p.speciesID).padStart(3, '0')}`, { dimColor: true }),
          link(`detail:${p.id}`, clip(`${p.shiny ? '✦ ' : ''}${p.name}`, Math.max(8, width - 24)), () => actions.detail(p.id), true, false),
          text(t('level', { n: p.level }), { dimColor: true }), p.raising ? text(t('raising'), { color: 'claude' }) : null,
        )),
        !list.length ? text(t(state.collection.length ? 'noResults' : 'emptyCollection'), { dimColor: true }) : null),
      section(row(link('prev', t('previous'), () => actions.offset(Math.max(0, offset - 8)), offset > 0),
        text(t('pageCount', { n: Math.floor(offset / 8) + 1, total: Math.max(1, Math.ceil(list.length / 8)) }), { dimColor: true }),
        link('next', t('next'), () => actions.offset(offset + 8), offset + 8 < list.length))),
    );
  }
  if (view.page === 'activity') {
    const providers = state.usage.providers;
    const days = new Map();
    providers.forEach(p => p.daily.forEach(d => days.set(d.date, (days.get(d.date) ?? 0) + d.tokens)));
    const recent = [...days].sort(([a], [b]) => a.localeCompare(b)).slice(-7), max = Math.max(1, ...recent.map(([, v]) => v));
    return column(header,
      section(heading(t('usageTitle'), state.usage.stale ? t('stale') : '')),
      ...providers.map(p => section(name(p.name), text(t('usageTotals', { today: number(p.today), week: number(p.week), month: number(p.month) })),
        kv(t('cost'), p.cost == null ? t('notAvailable') : `${p.costEstimated ? '~' : ''}${new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' }).format(p.cost)}${p.costPartial ? ` · ${t('partial')}` : ''}`))),
      !providers.length ? text(t('noUsage'), { dimColor: true }) : null,
      section(heading(t('history')),
        ...recent.map(([day, value]) => row(text(day.slice(5), { dimColor: true }), text(bar(value / max, Math.max(8, Math.min(24, width - 20))), { color: 'claude' }), text(number(value), { dimColor: true })))),
      section(heading(t('limits')),
        ...state.usage.limits.map(limit => column(
          name(`${limit.provider} · ${limit.minutes == null ? t('window') : limit.minutes >= 1440 ? t('windowDays', { n: limit.minutes / 1440 }) : t('windowHours', { n: limit.minutes / 60 })}`),
          progress(limit.used / 100, t('resets', { time: limit.reset == null ? t('unknown') : new Date(limit.reset * 1000).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' }) })))),
        !state.usage.limits.length ? text(t('noLimits'), { dimColor: true }) : null),
      section(link('refresh', t('refresh'), actions.refresh)),
    );
  }
  return column(header,
    section(heading(t('bagTitle')), kv(t('wallet'), number(state.wallet)), text(t('currencyHint'), { dimColor: true })),
    section(heading(t('items')),
      ...state.items.map(item => column(row(name(t(item.id), t('have', { n: item.count })),
        action({ action: 'buyItem', value: item.id, expectedPrice: item.price }, t('buy', { n: number(item.price) }), item.canBuy, t('buyAction', { name: t(item.id), n: number(item.price) })),
        item.id === 'rareCandy' ? action({ action: 'candy', value: state.training.target }, t('candyAction'), state.training.canCandy, t('candyFor', { name: named(state.training.target) }))
          : item.id === 'mint' ? action({ action: 'mint', value: state.companion.activeID }, t('mintAction'), state.training.canMint, t('mintFor', { name: named(state.companion.activeID) })) : null),
        text(t(`${item.id}_hint`), { dimColor: true })))),
    section(heading(t('balls')),
      ...state.balls.map(ball => column(row(name(t(ball.id), t('have', { n: ball.count })),
        action({ action: 'buyBall', value: ball.id, expectedPrice: ball.price }, t('buy', { n: number(ball.price) }), state.wallet >= ball.price, t('buyAction', { name: t(ball.id), n: number(ball.price) })),
        action({ action: 'queueBall', value: ball.id }, state.queuedBall === ball.id ? t('queued') : t('queue'), ball.count > 0 && state.queuedBall !== ball.id, t('queueAction', { name: t(ball.id) }))),
        text(t(`${ball.id}_hint`), { dimColor: true })))),
  );
}
