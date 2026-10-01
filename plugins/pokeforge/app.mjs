import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import copy from './locales/en.json' with { type: 'json' };
const $ = selector => document.querySelector(selector);
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const text = (key, values = {}) => String(copy[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
const t = (key, values) => h(text(key, values));
const number = value => value == null ? copy.notAvailable : new Intl.NumberFormat('en', { notation: value >= 100000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
const date = value => value ? new Date(value * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : copy.unknown;
const stats = ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed'];
let state, page = 'home', busy = false, reading = false, connected = false, pendingAction, revision = 0;
let search = '', filter = 'all', sort = 'speciesSort';
const embedded = window.parent !== window;
const app = new App({ name: 'pokeforge', version: '2.7.0' });
for (const element of document.querySelectorAll('[data-copy]')) element.textContent = text(element.dataset.copy);
function notice(message = '', error = false) { $('#notice').textContent = message; $('#notice').classList.toggle('error', error); }
function image(id, shiny = false, egg = false) {
  const file = egg ? 'egg' : Number.isInteger(id) && id > 0 && id < 20000 ? `${shiny ? 'shiny/' : ''}${id}` : null;
  return file ? `<img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${file}.png" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="sprite-fallback" aria-hidden="true">◒</span>';
}
const progress = (value, label) => `<progress max="1" value="${Math.max(0, Math.min(1, Number(value) || 0))}" aria-label="${h(label)}"></progress>`;
const heading = (title, intro) => `<h1>${t(title)}</h1><p class="intro">${t(intro)}</p>`;
const metric = (label, value) => `<div class="metric"><span>${t(label)}</span><strong class="mono">${h(number(value))}</strong></div>`;
function actionButton(action, value, label, enabled = true, extra = '') {
  return `<button data-action="${action}" data-value="${h(value)}" ${enabled && !busy ? '' : 'disabled'} ${extra}>${label}</button>`;
}
function xp(pokemon) {
  const lower = pokemon.level ** 3;
  const upper = (pokemon.level + 1) ** 3;
  const value = pokemon.level >= 100 ? 1 : (pokemon.xp - lower) / (upper - lower);
  return `<div class="xp"><div class="row"><strong>${t('level', { n: pokemon.level })}</strong><span class="small muted">${pokemon.nextXP == null ? t('maxLevel') : t('xpNext', { n: number(pokemon.nextXP) })}</span></div>${progress(value, text('level', { n: pokemon.level }))}</div>`;
}
function evs(pokemon) {
  return `<div class="row small"><strong>${t('evs')}</strong><span class="muted">${t('evTotal', { n: Object.values(pokemon.evs).reduce((a,b) => a+b, 0) })}</span></div><div class="ev-grid">${stats.map(stat => `<div><div class="row"><span>${t(stat)}</span><span>${h(pokemon.evs[stat] ?? 0)}</span></div>${progress((pokemon.evs[stat] ?? 0) / 252, text(stat))}</div>`).join('')}</div>`;
}
function home() {
  const c = state.companion;
  const trainee = state.collection.find(p => p.id === state.training.target);
  const reports = state.usage.providers.filter(p => p.today != null);
  const today = reports.length ? reports.reduce((sum, p) => sum + p.today, 0) : null;
  const targetLabel = c.egg ? 'nextHatch' : c.finalStage ? 'nextCollection' : 'nextEvolution';
  return `<div class="metrics">${metric(reports.length && reports.length < state.usage.providers.length ? 'todayPartial' : 'today', today)}${metric('owned', state.collection.length)}${metric('wallet', state.wallet)}</div>
    <div class="home-grid"><article class="card"><div class="scene">${image(c.speciesID, c.shiny, c.egg)}</div><div class="pad">
    <div class="row"><span class="eyebrow">${t(c.egg ? 'egg' : 'yourCompanion')}</span>${c.shiny ? `<span class="badge shiny">✦ ${t('shiny')}</span>` : ''}</div>
    <h2 class="hero-name">${c.egg ? t('eggTitle') : h(c.name)}</h2><div class="row small"><span>${t(targetLabel)}</span><span class="mono">${Math.round(c.progress * 100)}%</span></div>
    ${progress(c.progress, text(targetLabel))}<p class="small muted">${c.hatching ? t('hatching') : t('tokensRemaining', { n: number(c.remaining) })}</p></div></article>
    <article class="training-panel"><h2>${t('trainingTitle')}</h2>
    <div class="mode-buttons" role="group" aria-label="${t('mode')}">${['catching', 'training', 'balanced'].map(mode => actionButton('mode', mode, t(mode), true, `aria-pressed="${state.training.mode === mode}"`)).join('')}</div>
    <p class="small muted">${t(`mode_${state.training.mode}`)}</p><div class="controls">
    <label>${t('trainee')}<select data-setting="target" ${busy ? 'disabled' : ''}><option value="" disabled ${!trainee ? 'selected' : ''}>${t('chooseTrainee')}</option>${state.collection.filter(p => p.trainable).map(p => `<option value="${h(p.id)}" ${trainee?.id === p.id ? 'selected' : ''}>${h(p.name)} · ${t('level', { n: p.level })}</option>`).join('')}</select></label>
    <label>${t('focus')}<select data-setting="focus" ${busy ? 'disabled' : ''}>${stats.map(stat => `<option value="${stat}" ${state.training.focus === stat ? 'selected' : ''}>${t(stat)}</option>`).join('')}</select></label></div>
    ${trainee ? xp(trainee) + evs(trainee) : `<p class="small muted">${t('noTrainee')}</p>`}
    <div class="actions">${actionButton('candy', state.training.target, t('candyAction'), state.training.canCandy)}</div></article></div>`;
}
function collection() {
  return `${heading('collectionTitle', 'collectionIntro')}<div class="filters">
    <label>${t('search')}<input id="search" type="search" value="${h(search)}" autocomplete="off"></label>
    <label>${t('filter')}<select id="filter">${['all', 'shinyOnly', 'trainableOnly'].map(key => `<option value="${key}" ${filter === key ? 'selected' : ''}>${t(key)}</option>`).join('')}</select></label>
    <label>${t('sort')}<select id="sort">${['speciesSort', 'levelSort', 'recentSort'].map(key => `<option value="${key}" ${sort === key ? 'selected' : ''}>${t(key)}</option>`).join('')}</select></label></div><p id="results" class="small muted"></p><div id="collection-grid" class="collection-grid"></div>`;
}
function collectionGrid() {
  let list = state.collection.filter(p => (!search || `${p.name} ${p.speciesID}`.toLowerCase().includes(search.toLowerCase())) && (filter !== 'shinyOnly' || p.shiny) && (filter !== 'trainableOnly' || p.trainable));
  list.sort((a, b) => sort === 'levelSort' ? b.level - a.level : sort === 'recentSort' ? (b.recordedAt ?? 0) - (a.recordedAt ?? 0) : a.speciesID - b.speciesID);
  $('#results').textContent = text('results', { n: list.length });
  $('#collection-grid').innerHTML = list.length ? list.map(p => `<button class="pokemon" data-detail="${h(p.id)}" aria-label="${t('details', { name: p.name })}"><div class="row"><span class="number">#${h(String(p.speciesID).padStart(3, '0'))}</span>${p.shiny ? `<span class="badge shiny">✦ ${t('shiny')}</span>` : ''}</div><div class="sprite-wrap">${image(p.speciesID, p.shiny)}</div><strong>${h(p.name)}</strong><div class="row"><span>${t('level', { n: p.level })}</span><span class="muted">${t(p.raising ? 'raising' : p.rarity)}</span></div></button>`).join('') : `<div class="empty">${t(state.collection.length ? 'noResults' : 'emptyCollection')}<div class="actions"><button id="clear-filters" class="secondary">${t('clearFilters')}</button></div></div>`;
}
function activity() {
  const usage = state.usage;
  const providers = usage.providers;
  const days = new Map();
  providers.forEach(p => p.daily.forEach(d => days.set(d.date, (days.get(d.date) ?? 0) + d.tokens)));
  const sortedDays = [...days].sort(([a], [b]) => a.localeCompare(b));
  const peak = Math.max(1, ...days.values());
  const cost = p => p.cost == null ? t('notAvailable') : `${p.costEstimated ? '~' : ''}${h(new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' }).format(p.cost))}${p.costPartial ? ` · ${t('partial')}` : ''}`;
  return `${heading('usageTitle', 'usageIntro')}<p class="small muted">${t('lastUpdated', { time: date(usage.updatedAt) })}${usage.stale ? ` · ${t('stale')}` : ''}</p>
    ${providers.length ? `<div class="card pad table-wrap"><table><thead><tr>${['provider', 'today', 'week', 'month', 'cost'].map(key => `<th scope="col">${t(key)}</th>`).join('')}</tr></thead><tbody>${providers.map(p => `<tr><th scope="row">${h(p.name)}</th><td>${h(number(p.today))}</td><td>${h(number(p.week))}</td><td>${h(number(p.month))}</td><td>${cost(p)}</td></tr>`).join('')}</tbody></table><p class="small muted">${t('costHint')}</p></div>` : `<div class="empty">${t('noUsage')}</div>`}
    <div class="usage-grid"><article class="card pad"><h3>${t('history')}</h3>${sortedDays.length ? `<div class="chart" role="img" aria-label="${t('history')}">${sortedDays.map(([d, value]) => `<div class="bar" style="--height:${Math.max(2, value / peak * 100)}%" title="${h(d)} · ${h(number(value))}"></div>`).join('')}</div><div class="row chart-legend"><span>${h(sortedDays[0][0])}</span><span>${h(sortedDays.at(-1)[0])}</span></div><details class="small muted"><summary>${t('history')}</summary>${sortedDays.map(([d,v]) => `<div class="row"><span>${h(d)}</span><span>${h(number(v))}</span></div>`).join('')}</details>` : `<p class="muted">${t('notAvailable')}</p>`}</article>
    <article class="card pad"><h3>${t('limits')}</h3>${usage.limits.length ? usage.limits.map(limit => {
      const label = limit.minutes == null ? text('window') : limit.minutes >= 1440 ? text('windowDays', { n: limit.minutes / 1440 }) : text('windowHours', { n: limit.minutes / 60 });
      return `<div class="limit"><div class="row small"><span>${h(limit.provider)} · ${h(label)}</span><strong>${t('used', { n: Math.round(limit.used) })}</strong></div>${progress(limit.used / 100, label)}<span class="small muted">${t('resets', { time: date(limit.reset) })}</span></div>`;
    }).join('') : `<p class="small muted">${t('noLimits')}</p>`}</article></div>`;
}
function bag() {
  const icons = { rareCandy: '🍬', mint: '🌿', shinyCharm: '✦' };
  return `${heading('bagTitle', 'bagIntro')}<div class="metrics">${metric('wallet', state.wallet)}</div><p class="small muted">${t('currencyHint')}</p>
    <h2 class="section-heading">${t('items')}</h2><div class="shop-grid">${state.items.map(item => `<article class="card pad shop-card"><div class="row"><span class="item-icon" aria-hidden="true">${icons[item.id] || '◒'}</span><span class="inventory-label">${t('have', { n: item.count })}</span></div><h3>${t(item.id)}</h3><p class="small muted">${t(`${item.id}_hint`)}</p><div class="actions">${actionButton('buyItem', item.id, t('buy', { n: number(item.price) }), item.canBuy, `data-price="${item.price}"`)}${item.id === 'rareCandy' ? actionButton('candy', state.training.target, t('candyAction'), state.training.canCandy) : item.id === 'mint' ? actionButton('mint', state.companion.activeID, t('mintAction'), state.training.canMint) : item.count ? `<span class="badge">${t('passive')}</span>` : ''}</div></article>`).join('')}</div>
    <h2 class="section-heading">${t('balls')}</h2><p class="small muted">${t('ballHint')}</p><div class="shop-grid">${state.balls.map(ball => `<article class="card pad shop-card"><div class="row"><span class="item-icon" aria-hidden="true">◒</span><span class="inventory-label">${t('have', { n: ball.count })}</span></div><h3>${t(ball.id)}</h3><p class="small muted">${t(`${ball.id}_hint`)}</p><div class="row">${state.queuedBall === ball.id ? `<span class="badge">${t('queued')}</span>` : ''}${state.eggBall === ball.id ? `<span class="badge">${t('equipped')}</span>` : ''}</div><div class="actions">${actionButton('buyBall', ball.id, t('buy', { n: number(ball.price) }), state.wallet >= ball.price, `data-price="${ball.price}"`)}${actionButton('queueBall', ball.id, t('queue'), ball.count > 0)}</div></article>`).join('')}</div>`;
}
function render() {
  $('#main').setAttribute('aria-busy', 'false');
  $('#refresh').disabled = busy || !connected;
  document.querySelectorAll('nav button').forEach(button => {
    if (button.dataset.page === page) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  if (!state) return;
  $('#connection').textContent = text(state.sandbox ? 'sandbox' : state.headless ? 'standalone' : 'live'); $('#connection').className = 'connection live';
  $('#main').innerHTML = ({ home, collection, activity, bag })[page]();
  if (page === 'collection') collectionGrid();
  document.querySelectorAll('[data-native]').forEach(button => { button.disabled = busy || state.sandbox; });
}
function showDetail(id) {
  const pokemon = state?.collection.find(p => p.id === id);
  if (!pokemon) return;
  $('#detail-body').innerHTML = `<div class="sprite-wrap">${image(pokemon.speciesID, pokemon.shiny)}</div><div class="eyebrow">#${h(pokemon.speciesID)} · ${t(pokemon.rarity)}${pokemon.shiny ? ` · ${t('shiny')}` : ''}</div><h2 id="detail-title">${h(pokemon.name)}</h2>${xp(pokemon)}${evs(pokemon)}<dl><dt>${t('nature')}</dt><dd>${h(pokemon.nature ?? text('unknown'))}</dd><dt>${t('trainer')}</dt><dd>${h(pokemon.trainer ?? text('unknown'))}</dd><dt>${t('recordedAt')}</dt><dd>${h(date(pokemon.recordedAt))}</dd></dl><p class="small muted">${t('recordHint')}</p><div class="actions">${actionButton('target', pokemon.id, t('trainThis'), pokemon.trainable)}</div>`;
  if (!$('#details').open) $('#details').showModal();
}
async function call(input) {
  if (!connected) return { error: 'host_connection' };
  if (embedded) {
    const result = await app.callServerTool({ name: input.action === 'snapshot' ? 'get_pokeforge' : 'update_pokeforge', arguments: input.action === 'snapshot' ? {} : input });
    return result.structuredContent ?? { error: 'invalid_response' };
  }
  const response = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  if (!response.ok) throw new Error('host_connection');
  return response.json();
}
function acceptState(result) {
  if (result.schemaVersion === 1) { state = result; render(); }
  if (result.error || result.saveError) {
    notice(copy.errors[result.error ?? 'save_failed'] || copy.errors.invalid_response, true);
    if (!result.schemaVersion) {
      state = null;
      $('#connection').textContent = text('offline'); $('#connection').className = 'connection';
      $('#main').innerHTML = `<div class="empty"><p>${h(copy.errors[result.error] || copy.errors.invalid_response)}</p><button id="retry">${t('retry')}</button></div>`;
      document.querySelectorAll('[data-native]').forEach(button => { button.disabled = true; });
    }
    return false;
  }
  return true;
}
async function refresh() {
  if (busy || reading || document.hidden || $('dialog[open]') || ['INPUT', 'SELECT'].includes(document.activeElement.tagName)) return;
  reading = true;
  const started = revision;
  try {
    const result = await call({ action: 'snapshot' });
    if (started === revision && !busy && acceptState(result)) notice();
  }
  catch { acceptState({ error: 'host_connection' }); }
  finally { reading = false; $('#main').setAttribute('aria-busy', 'false'); $('#refresh').disabled = busy || !connected; }
}
async function mutate(input) {
  if (busy) return;
  busy = true; revision += 1; render(); notice(text('saving'));
  document.querySelectorAll('dialog button').forEach(button => { button.disabled = true; });
  try {
    const ok = acceptState(await call(input));
    if (ok) { notice(text('saved')); $('#details').close(); }
  } catch { notice(copy.errors.outcome_unknown, true); }
  finally {
    busy = false; render(); document.querySelectorAll('dialog button').forEach(button => { button.disabled = false; });
  }
}
function requestAction(button) {
  const input = { action: button.dataset.action, value: button.dataset.value };
  if (button.dataset.price) input.expectedPrice = Number(button.dataset.price);
  if (['candy', 'mint', 'buyItem', 'buyBall', 'queueBall'].includes(input.action)) {
    pendingAction = input;
    const label = input.action.startsWith('buy') ? text('buyAction', { name: text(input.value), n: number(input.expectedPrice) }) : input.action === 'queueBall' ? text('queueAction', { name: text(input.value) }) : text(`${input.action}Action`);
    $('#confirm-body').textContent = text('confirmBody', { action: label }); $('#confirmation').showModal();
  } else mutate(input);
}
document.addEventListener('click', event => {
  if (event.target.closest('.brand')) { event.preventDefault(); page = 'home'; render(); return; }
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.dataset.close) return $(`#${button.dataset.close}`).close();
  if (button.dataset.page) { page = button.dataset.page; render(); return; }
  if (button.dataset.detail) return showDetail(button.dataset.detail);
  if (button.dataset.native) return mutate({ action: 'openNative', value: button.dataset.native });
  if (button.dataset.action) return requestAction(button);
  if (button.id === 'retry') return refresh();
  if (button.id === 'refresh') return mutate({ action: 'refresh' });
  if (button.id === 'clear-filters') { search = ''; filter = 'all'; render(); return; }
  if (button.id === 'confirm' && pendingAction) { const input = pendingAction; pendingAction = null; $('#confirmation').close(); mutate(input); }
});
document.addEventListener('input', event => { if (event.target.id === 'search') { search = event.target.value; collectionGrid(); } });
document.addEventListener('change', event => {
  if (event.target.dataset.setting) mutate({ action: event.target.dataset.setting, value: event.target.value });
  if (event.target.id === 'filter') { filter = event.target.value; collectionGrid(); }
  if (event.target.id === 'sort') { sort = event.target.value; collectionGrid(); }
});
document.addEventListener('error', event => {
  if (event.target.tagName === 'IMG') { event.target.outerHTML = '<span class="sprite-fallback" aria-hidden="true">◒</span>'; }
}, true);
function theme(context) {
  if (context?.theme) { applyDocumentTheme(context.theme); document.documentElement.classList.toggle('dark', context.theme === 'dark'); document.documentElement.classList.toggle('light', context.theme === 'light'); }
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
}
app.addEventListener('hostcontextchanged', theme);
app.ontoolresult = result => { if (result.structuredContent) acceptState(result.structuredContent); };
if (embedded) {
  const timeout = setTimeout(() => { if (!connected) acceptState({ error: 'host_connection' }); }, 10000);
  try { await app.connect(); connected = true; theme(app.getHostContext()); }
  catch { acceptState({ error: 'host_connection' }); }
  finally { clearTimeout(timeout); }
} else connected = location.hostname === '127.0.0.1';
await refresh();
setInterval(refresh, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
