import * as M from './model.js';
import { openStore, update, read } from './store.js';

const $ = (q, el = document) => el.querySelector(q);
const app = $('#app'), nav = $('#nav'), sheetEl = $('#sheet'), installEl = $('#install'), lockEl = $('#lock');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Math.round(n).toLocaleString('en-AU');
const num = v => { const x = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(x) && x >= 0 ? x : null; };
const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ROUTES = ['today', 'shots', 'food', 'gym', 'body', 'settings'];
const TABS = [['today', '☀️', 'Today'], ['shots', '💉', 'Shots'], ['food', '🍗', 'Food'], ['gym', '🏋️', 'Gym'], ['body', '⚖️', 'Body']];
const KIND = { shot: 'var(--shots)', food: 'var(--food)', gym: 'var(--gym)', water: 'var(--water)', weight: 'var(--body)' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const REST_SECONDS = 90, WATER_STEP = 500;

let state, today = M.dateKey(), toastTimer, lastRoute = '';
const ui = { sheet: null, vals: {}, editFav: false, rest: null, pendingSetup: null, route: null, setupHash: '', lock: null };

const route = () => { const r = ui.setupHash ? ui.route : location.hash.slice(1); return ROUTES.includes(r) ? r : 'today'; };
const day = () => state.days[today] || M.blankDay();
const dayOf = s => (s.days[today] ??= M.blankDay());
const dateOf = key => new Date(key + 'T12:00:00');
const longDate = key => dateOf(key).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = key => dateOf(key).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
const hhmm = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const clock = t => { const [h, m] = t.split(':').map(Number); return Number.isFinite(h) ? `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}` : ''; };

// ---------- feedback ----------
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600); }
function buzz(pattern = 12) { try { navigator.vibrate?.(pattern); } catch {} try { $('#haptic')?.click(); } catch {} }
function confetti(x = innerWidth / 2, y = innerHeight / 3, count = 18) {
  if (calm) return;
  const layer = $('#fx'), bits = ['🎉', '✨', '⭐', '💪', '🔥'];
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.textContent = bits[i % bits.length];
    el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.fontSize = 14 + Math.random() * 16 + 'px';
    layer.append(el);
    const a = Math.random() * Math.PI * 2, r = 60 + Math.random() * 130;
    el.animate([{ transform: 'translate(-50%,-50%) scale(.4)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * r}px), calc(-50% + ${Math.sin(a) * r - 40}px)) scale(1.1) rotate(${Math.random() * 240 - 120}deg)`, opacity: 1, offset: .7 }, { transform: `translate(calc(-50% + ${Math.cos(a) * r}px), calc(-50% + ${Math.sin(a) * r + 60}px)) scale(.9)`, opacity: 0 }], { duration: 900 + Math.random() * 500, easing: 'cubic-bezier(.2,.8,.3,1)' }).onfinish = () => el.remove();
  }
}
const doneKeys = () => new Set(M.checklist(state, today).filter(q => q.done).map(q => q.key));

async function commit(mutator, message) {
  const before = doneKeys(), levelBefore = M.rewards(state, today).level;
  try { state = await update(mutator); } catch (e) { toast(e.message || 'Could not save. Your data is safe.'); return false; }
  render();
  const list = M.checklist(state, today), fresh = list.filter(q => q.done && !before.has(q.key));
  for (const q of fresh) {
    const el = document.querySelector(`[data-key="${CSS.escape(q.key)}"]`);
    if (el) { el.classList.add('pop'); const b = el.getBoundingClientRect(); confetti(b.left + b.width / 2, b.top + b.height / 2, 14); } else confetti();
  }
  if (fresh.length) {
    buzz([20, 40, 30]);
    const r = M.rewards(state, today);
    if (list.every(q => q.done)) { setTimeout(() => confetti(innerWidth / 2, innerHeight / 2, 40), 250); message = 'Perfect day 🏆'; }
    else if (r.level > levelBefore) message = `Level ${r.level} 🎉`;
    else message ??= `+${M.XP_PER_TICK} XP ⚡`;
  }
  if (message) toast(message);
  return true;
}

// ---------- small parts ----------
const bar = (fraction, color) => `<div class="bar"><i style="width:${Math.max(0, Math.min(1, fraction)) * 100}%;background:${color}"></i></div>`;
function ring(score) {
  const c = 2 * Math.PI * 52;
  return `<div class="ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" class="track"/><circle cx="60" cy="60" r="52" class="fill" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - score / 100)}"/></svg><div><strong>${score}</strong><small>score</small></div></div>`;
}
function macro(label, value, target, unit, color, cap, min) {
  const over = cap && target && value > target * 1.05;
  return `<div class="macro"><div class="macroTop"><span>${label}</span><strong>${fmt(value)}<small> / ${target ? fmt(target) : '?'} ${unit}</small></strong></div>${bar(target ? value / target : 0, over ? 'var(--bad)' : color)}${target ? (min && min < target ? `<small class="range">Range ${fmt(min)}–${fmt(target)} ${unit}</small>` : '') : '<a class="link" href="#settings">Set your target</a>'}</div>`;
}
const macros = t => macro('Calories', t.kcal, state.targets.kcal, 'kcal', 'var(--food)', true, state.targets.kcalMin) + macro('Protein', t.protein, state.targets.protein, 'g', 'var(--ok)');
const range = g => (g.min === g.max ? `${g.min}` : `${g.min}–${g.max}`);
function phaseLine() {
  const p = M.currentPhase(state); if (!p) return '';
  return `<a class="phase" href="#settings"><span class="pill on">${esc(p.name)}</span>${p.until ? `<span class="pill">until ${dateOf(p.until).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}</span>` : ''}${p.goal ? `<span class="pill">🎯 ${range(p.goal)} kg</span>` : ''}</a>`;
}
const reviewCard = () => (state.review && M.dow(today) === state.review.day ? `<a class="card review" href="#body"><strong>📋 ${DAYS[state.review.day]} check</strong><span>${esc(state.review.text)}</span></a>` : '');
const emptySetup = () => (standalone && !M.hasData(state) && !state.profile.name ? `<section class="card empty"><p class="bigEmoji">🔗</p><h2>Load your setup</h2><p>Copy your personal setup link. Then tap here.</p><button class="big primary" data-action="setup-paste">Paste setup link</button></section>` : '');
const stepper = (bind, step, unit, label) => `<div class="stepper"><button type="button" class="stepBtn" data-step="${-step}" aria-label="Less ${label}">−</button><label><span class="sr">${label}</span><input inputmode="decimal" data-bind="${bind}" value="${esc(ui.vals[bind] ?? '')}" placeholder="0" autocomplete="off" enterkeyhint="done"><em>${unit}</em></label><button type="button" class="stepBtn" data-step="${step}" aria-label="More ${label}">+</button></div>`;
const field = (name, label, value = '', extra = '') => `<label class="field"><span>${label}</span><input name="${name}" value="${esc(value ?? '')}" autocomplete="off" ${extra}></label>`;
const numField = (name, label, value) => field(name, label, value, 'inputmode="decimal" placeholder="?"');
const top = (title, eyebrow = '') => `<header class="top"><div>${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}<h1>${title}</h1></div>${route() === 'today' ? '<a class="gear" href="#settings" aria-label="Settings">⚙️</a>' : ''}</header>`;
const foodMeta = f => M.favouriteReady(f) ? `${fmt(f.kcal)} kcal · ${fmt(f.protein)} g protein` : 'Add numbers ✏️';

// ---------- Today ----------
function tile(q) {
  const water = q.kind === 'water';
  return `<div class="tile ${q.done ? 'done' : ''}" data-key="${esc(q.key)}" style="--c:${q.color || KIND[q.kind]}"><button class="tileMain" data-action="tile" data-kind="${q.kind}" data-id="${esc(q.key.slice(q.key.indexOf(':') + 1))}"><span class="ico" aria-hidden="true">${q.icon}</span><span class="copy"><strong>${esc(q.name)}</strong><small>${esc(q.detail)}${water ? ' · tap for +' + WATER_STEP + ' mL' : ''}</small>${water ? `<span class="mini"><i style="width:${q.progress * 100}%"></i></span>` : ''}</span><span class="check" aria-hidden="true">${q.done ? '✓' : water ? '+' : ''}</span><span class="sr">${q.done ? 'Done' : 'Not done'}</span></button>${water && day().water > 0 ? `<button class="tileSide" data-action="water" data-ml="${-WATER_STEP}" aria-label="Take off ${WATER_STEP} mL">−</button>` : ''}</div>`;
}
function viewToday() {
  const r = M.rewards(state, today), t = M.totals(day());
  return top(`Hey ${esc(state.profile.name || 'there')} 👋`, longDate(today)) + `
  <section class="card hero">${ring(r.score)}<div class="heroCopy"><div class="lvl"><strong>Level ${r.level}</strong><span>${r.streak ? `🔥 ${r.streak} day${r.streak > 1 ? 's' : ''}` : '✨ Start today'}</span></div>${bar(r.intoLevel / M.XP_PER_LEVEL, 'var(--accent)')}<small>${r.intoLevel} / ${M.XP_PER_LEVEL} XP · ${r.done} of ${r.total} done</small></div></section>
  ${emptySetup()}${phaseLine()}${reviewCard()}
  <section class="card">${macros(t)}</section>
  <h2>Today's list</h2><div class="tiles">${M.checklist(state, today).map(tile).join('')}</div>
  <p class="foot">Saved on this phone only.</p>`;
}

// ---------- Shots ----------
function shotCard(p) {
  const log = M.shotLog(state, today, p.id), u = M.unitsFor(p, today), site = M.siteFor(state, p, today, today);
  const head = `<div class="shotHead"><h2>${esc(p.name || 'Shot')}</h2>${u.week ? `<span class="pill">Week ${u.week}</span>` : ''}</div>`;
  if (log) return `<article class="shot done" data-key="shot:${esc(p.id)}" style="--c:${p.color}">${head}<p class="doneLine">✅ Done${log.units ? ' · ' + esc(log.units) + ' units' : ''}${log.site ? ' · ' + esc(log.site) : ''} · ${clock(log.time)}</p><button class="quiet small" data-action="shot-undo" data-id="${esc(p.id)}">Undo</button></article>`;
  if (u.needWeek) { ui.vals['week.' + p.id] ??= '1'; return `<article class="shot" style="--c:${p.color}">${head}<p class="ask">Which week is your next shot?</p>${stepper('week.' + p.id, 1, 'week', 'Week')}<button class="big primary" data-action="week-save" data-id="${esc(p.id)}">Save week</button></article>`; }
  const spot = site ? `<button class="spot" data-action="spot" data-id="${esc(p.id)}"><span>📍 ${esc(site)}</span>${p.sites.length > 1 ? '<small>change</small>' : ''}</button>` : '';
  const notes = [u.note, p.note].filter(Boolean).map(x => `<p class="note">${esc(x)}</p>`).join('');
  if (!u.units) return `<article class="shot" style="--c:${p.color}">${head}<p class="ask">Set dose from vial label</p>${spot}${notes}<button class="big primary" data-action="shot-edit" data-id="${esc(p.id)}">Set dose ✏️</button></article>`;
  return `<article class="shot" data-key="shot:${esc(p.id)}" style="--c:${p.color}">${head}<div class="units"><strong>${esc(u.units)}</strong><span>units</span></div>${p.detail ? `<p class="detail">${esc(p.detail)}</p>` : ''}${spot}${notes}<button class="big primary" data-action="shot-done" data-id="${esc(p.id)}">Done ✅</button></article>`;
}
function viewShots() {
  if (!state.shots.length) return top('Shots 💉') + `<section class="card empty"><p class="bigEmoji">💉</p><h2>No shots yet</h2><p>Add your first shot. You only do this once.</p><button class="big primary" data-action="shot-new">+ Add a shot</button></section>${disclaimer()}`;
  const due = M.dueShots(state, today);
  const week = Array.from({ length: 7 }, (_, i) => M.addDays(today, i + 1)).map(d => {
    const list = M.dueShots(state, d);
    return `<div class="weekRow"><strong>${DAYS[M.dow(d)]}<small>${dateOf(d).getDate()}</small></strong><div>${list.length ? list.map(p => { const u = M.unitsFor(p, d), site = M.siteFor(state, p, d, today); return `<span class="chip" style="--c:${p.color}"><b>${esc(p.name)}</b>${u.units ? ' · ' + esc(u.units) + 'u' : ''}${site ? ' · ' + esc(site) : ''}</span>`; }).join('') : '<span class="muted">Night off 😴</span>'}</div></div>`;
  }).join('');
  return top('Tonight 🌙', longDate(today)) + (state.shotNote ? `<p class="tip">${esc(state.shotNote)}</p>` : '') + (due.length ? due.map(shotCard).join('') : '<section class="card empty"><p class="bigEmoji">😴</p><h2>Nothing tonight</h2></section>') + `<h2>Next 7 nights</h2><section class="card week">${week}</section><button class="big quiet" data-action="shots-manage">⚙️ Edit shots</button>${disclaimer()}`;
}
const disclaimer = () => '<p class="foot">Personal reference. Not medical advice.</p>';

// ---------- Food ----------
function viewFood() {
  const d = day(), t = M.totals(d);
  const favs = state.favourites.map(f => `<button class="fav ${M.favouriteReady(f) ? '' : 'todo'}" data-action="fav" data-id="${esc(f.id)}">${f.photo ? `<img src="${esc(f.photo)}" alt="">` : `<span class="favEmoji" aria-hidden="true">${esc(f.emoji || '🍽️')}</span>`}<strong>${esc(f.name)}</strong><small>${foodMeta(f)}${f.estimate && M.favouriteReady(f) ? ' · ≈ estimate' : ''}</small>${ui.editFav ? '<span class="editDot">✏️</span>' : ''}</button>`).join('');
  return top('Food 🍗', longDate(today)) + `
  <section class="card">${macros(t)}<p class="sub">Carbs ${fmt(t.carbs)} g · Fat ${fmt(t.fat)} g</p></section>
  <button class="big primary" data-action="food-open">+ Add food</button>
  ${state.favourites.length ? `<div class="rowHead"><h2>${ui.editFav ? 'Tap one to edit' : 'Quick add'}</h2><button class="link" data-action="fav-mode">${ui.editFav ? 'Done' : 'Edit'}</button></div><div class="favs" data-key="food">${favs}</div>` : ''}
  <h2>Eaten today</h2>${d.food.length ? `<ul class="list">${d.food.map(f => `<li><span class="ico" aria-hidden="true">${esc(f.emoji || '🍽️')}</span><div><strong>${esc(f.name)}</strong><small>${fmt(f.kcal)} kcal · ${fmt(f.protein)} g protein</small></div><button class="x" data-action="food-remove" data-id="${esc(f.id)}" aria-label="Remove ${esc(f.name)}">✕</button></li>`).join('')}</ul>` : '<p class="muted pad">Nothing yet. Tap a food above.</p>'}`;
}

// ---------- Gym ----------
function pickExercise(name) {
  ui.vals['gym.exercise'] = name;
  let last = null;
  for (const key of Object.keys(state.days).sort()) for (const x of state.days[key].sets) if (x.exercise.toLowerCase() === name.toLowerCase()) last = x;
  ui.vals['gym.weight'] = last ? String(last.weight) : '';
  ui.vals['gym.reps'] = last ? String(last.reps) : '8';
}
function weekPlan() {
  const now = (M.dow(today) + 6) % 7;
  return `<h2>Your week</h2>${state.gymNote ? `<p class="tip">📍 ${esc(state.gymNote)}</p>` : ''}<section class="card week">${state.split.map((name, i) => `<div class="weekRow ${i === now ? 'now' : ''}"><strong>${DAYS[(i + 1) % 7]}</strong><div class="planDay"><b>${esc(name || 'Rest')}</b>${state.splitNotes[i] ? `<small>${esc(state.splitNotes[i])}</small>` : ''}</div></div>`).join('')}</section><button class="link center" data-action="split-edit">Edit week</button>`;
}
function viewGym() {
  const d = day(), suggested = M.splitToday(state, today), note = state.splitNotes[(M.dow(today) + 6) % 7];
  if (!d.gymSplit) return top('Gym 🏋️', longDate(today)) + `<section class="card empty"><p class="bigEmoji">${d.gymDone ? '✅' : suggested.toLowerCase() === 'rest' ? '😴' : '💪'}</p><h2>${d.gymDone ? 'Gym ticked today' : suggested.toLowerCase() === 'rest' ? 'Rest day' : esc(suggested)}</h2><p>${d.gymDone ? 'Want to log your sets too?' : esc(note) || 'Tap start. Then log each set.'}</p><button class="big primary" data-action="gym-start">Start workout</button></section>${weekPlan()}`;
  const names = [...new Set([...d.sets.map(x => x.exercise), ...M.exercisesFor(state, d.gymSplit)])];
  const current = ui.vals['gym.exercise'] || '';
  const best = current ? M.bestBefore(state, current, today) : null;
  const groups = new Map(); for (const x of d.sets) groups.set(x.exercise, [...(groups.get(x.exercise) || []), x]);
  const setsHtml = [...groups].map(([name, sets]) => `<li class="setRow"><strong>${esc(name)}</strong><div>${sets.map(x => `<button class="setChip" data-action="set-remove" data-id="${esc(x.id)}" aria-label="Remove set ${x.weight} kilograms times ${x.reps}">${x.weight} × ${x.reps} <span>✕</span></button>`).join('')}</div></li>`).join('');
  const header = top(esc(d.gymSplit), d.gymDone ? 'Workout done ✅' : 'Workout') ;
  if (d.gymDone) return header + `<section class="card empty" data-key="gym"><p class="bigEmoji">🏁</p><h2>${d.sets.length} set${d.sets.length === 1 ? '' : 's'} logged</h2><button class="big quiet" data-action="gym-reopen">Add more sets</button></section>${setsHtml ? `<ul class="list">${setsHtml}</ul>` : ''}`;
  return header + `
  <div class="chips">${names.map(n => `<button class="pick ${n === current ? 'on' : ''}" data-action="ex-pick" data-name="${esc(n)}">${esc(n)}</button>`).join('')}<button class="pick add" data-action="ex-new">+ Exercise</button></div>
  ${current ? `<section class="card lift"><h2>${esc(current)}</h2><p class="sub">${best ? `Best: ${best.weight} kg × ${best.reps}` : 'First time. Set your mark.'}</p>${stepper('gym.weight', 2.5, 'kg', 'Weight')}${stepper('gym.reps', 1, 'reps', 'Reps')}<button class="big primary" data-action="set-log">Log set ✅</button></section>` : `<section class="card empty"><p>${names.length ? 'Pick an exercise.' : 'Add your first exercise.'}</p></section>`}
  ${ui.rest ? `<section class="card rest"><div><small>Rest</small><strong id="rest">${restText()}</strong></div><button class="quiet small" data-action="rest-add">+30 s</button><button class="quiet small" data-action="rest-skip">Skip</button></section>` : ''}
  ${setsHtml ? `<h2>Today's sets</h2><ul class="list">${setsHtml}</ul>` : ''}
  <button class="big quiet" data-action="gym-finish" data-key="gym">Finish workout 🏁</button>
  <button class="link center" data-action="gym-start">Change day</button>`;
}
const restText = () => { const s = Math.max(0, Math.ceil((ui.rest.end - Date.now()) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
setInterval(() => {
  if (!ui.rest) return;
  if (Date.now() >= ui.rest.end) { ui.rest = null; buzz([200, 100, 200]); toast('Rest over. Go 💪'); if (route() === 'gym') render(); return; }
  const el = $('#rest'); if (el) el.textContent = restText();
}, 250);

// ---------- Body ----------
function chart(rows) {
  if (rows.length < 2) return '<p class="muted pad">Log two days to see your line.</p>';
  const v = rows.map(b => b.weight), min = Math.min(...v) - .5, max = Math.max(...v) + .5;
  const x = i => 16 + i * 288 / (rows.length - 1), y = w => 130 - (w - min) / (max - min) * 110;
  return `<svg class="chart" viewBox="0 0 320 160" role="img" aria-label="Weight from ${v[0]} to ${v.at(-1)} kilograms"><polyline points="${rows.map((b, i) => `${x(i).toFixed(1)},${y(b.weight).toFixed(1)}`).join(' ')}"/>${rows.map((b, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(b.weight).toFixed(1)}" r="${i === rows.length - 1 ? 6 : 3.5}"/>`).join('')}<text x="16" y="154">${shortDate(rows[0].date)}</text><text x="304" y="154" text-anchor="end">${shortDate(rows.at(-1).date)}</text></svg>`;
}
function viewBody() {
  const rows = state.body.filter(b => b.weight > 0).sort((a, b) => a.date.localeCompare(b.date));
  const avg = M.average(state, today), prev = M.average(state, M.addDays(today, -7)), mine = state.body.find(b => b.date === today), last = rows.at(-1);
  ui.vals['body.weight'] ??= String(mine?.weight ?? last?.weight ?? '');
  ui.vals['body.waist'] ??= String(mine?.waist ?? '');
  const change = avg !== null && prev !== null ? avg - prev : null;
  const recent = [...state.body].sort((a, b) => b.date.localeCompare(a.date));
  const entry = b => `<li><div><strong>${b.weight ?? '?'} kg${b.waist ? ` · ${b.waist} cm` : ''}</strong><small>${longDate(b.date)}</small></div><button class="x" data-action="body-remove" data-id="${esc(b.id)}" aria-label="Remove entry">✕</button></li>`;
  const phase = M.currentPhase(state), goal = phase?.goal, prog = M.goalProgress(state, avg);
  const goalCard = goal || state.start ? `<section class="card goal"><div class="goalRow">${state.start ? `<div><small>Start</small><strong>${state.start.weight}<em> kg</em></strong><span>${esc(state.start.label)}</span></div>` : ''}${goal ? `<div><small>🎯 ${esc(phase.name)} goal</small><strong>${range(goal)}<em> kg</em></strong><span>${esc(goal.label)}</span></div>` : ''}</div>${prog !== null ? bar(prog, 'var(--body)') + `<small>${Math.round(prog * 100)}% of the way</small>` : ''}${state.review ? `<p class="sub">📋 ${DAYS[state.review.day]} check: ${esc(state.review.text)}</p>` : ''}</section>` : '';
  return top('Body ⚖️', longDate(today)) + `
  <section class="card avg"><small>7-day average</small><strong>${avg !== null ? avg.toFixed(1) : '?'}<em> kg</em></strong>${change !== null ? `<span class="pill">${change > 0 ? '▲' : change < 0 ? '▼' : '•'} ${Math.abs(change).toFixed(1)} kg vs last week</span>` : avg === null ? '<span class="muted">Log your weight to start.</span>' : ''}</section>
  ${goalCard}
  <section class="card" data-key="weight"><h2>${mine ? 'Today ✅' : 'This morning'}</h2>${stepper('body.weight', .1, 'kg', 'Weight')}<p class="sub">Waist at belly button (optional)</p>${stepper('body.waist', .5, 'cm', 'Waist')}<button class="big primary" data-action="body-save">${mine ? 'Update' : 'Save ✅'}</button></section>
  <section class="card"><h2>Weight</h2>${chart(rows.slice(-30))}</section>
  ${recent.length ? `<ul class="list">${recent.slice(0, 4).map(entry).join('')}</ul>${recent.length > 4 ? `<details><summary>Show ${recent.length - 4} more</summary><ul class="list">${recent.slice(4).map(entry).join('')}</ul></details>` : ''}` : ''}
  <div class="rowHead"><h2>Photos</h2><label class="link">+ Add photo<input type="file" accept="image/*" data-file="photo" hidden></label></div>
  ${state.photos.length ? `<div class="photos">${[...state.photos].sort((a, b) => b.date.localeCompare(a.date)).map(p => `<button data-action="photo-view" data-id="${esc(p.id)}"><img src="${esc(p.data)}" alt="Progress photo ${shortDate(p.date)}"><small>${shortDate(p.date)}</small></button>`).join('')}</div>` : '<p class="muted pad">Optional. Photos stay on this phone.</p>'}`;
}

// ---------- Settings ----------
function viewSettings() {
  const t = state.targets, phase = M.currentPhase(state);
  return `<header class="top"><div><a class="back" href="#today">‹ Back</a><h1>Settings ⚙️</h1></div></header>
  <form class="card" data-form="settings"><h2>You</h2>${field('name', 'Your name', state.profile.name, 'maxlength="40"')}${field('born', 'Born', state.profile.born, 'type="date"')}${numField('height', 'Height (cm)', state.profile.height)}${state.profile.notes.length ? `<ul class="notes">${state.profile.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
  ${state.phases.length ? `<h2>Phase</h2><div class="seg">${state.phases.map(p => `<button type="button" data-action="phase" data-id="${esc(p.id)}" class="${p.id === state.phase ? 'on' : ''}">${esc(p.name)}</button>`).join('')}</div>${phase?.note ? `<p class="sub">${esc(phase.note)}</p>` : ''}` : ''}
  <h2>Daily targets${phase ? ' · ' + esc(phase.name) : ''}</h2>${numField('kcal', 'Calories (kcal)', t.kcal)}${numField('kcalMin', 'Calories, low end (optional)', t.kcalMin)}${numField('protein', 'Protein (g)', t.protein)}${numField('water', 'Water (L)', t.water)}<button class="big primary">Save</button></form>
  <section class="card"><h2>Look</h2><div class="seg"><button data-action="theme" data-value="dark" class="${state.settings.theme === 'dark' ? 'on' : ''}">🌙 Dark</button><button data-action="theme" data-value="light" class="${state.settings.theme === 'light' ? 'on' : ''}">☀️ Light</button></div></section>
  <section class="card"><h2>Backup</h2><p class="sub">Your data lives on this phone only. Save a backup file now and then.</p><button class="big quiet" data-action="export">⬇️ Save backup</button><label class="big quiet fileBtn">⬆️ Load backup<input type="file" accept="application/json,.json" data-file="import" hidden></label></section>
  <section class="card"><h2>More</h2><button class="big quiet" data-action="shots-manage">💉 Edit shots</button><button class="big quiet" data-action="split-edit">🏋️ Edit gym week</button><button class="big quiet" data-action="plan-reload">🔄 Reload my plan</button><button class="big quiet" data-action="setup-open">🔗 Paste setup link</button>${standalone ? '' : '<button class="big quiet" data-action="install-help">📲 Add to Home Screen</button>'}</section>
  ${disclaimer()}<p class="foot">Chad v4</p>`;
}

// ---------- sheets ----------
function sheetHtml() {
  const s = ui.sheet; if (!s) return '';
  const wrap = (title, body) => `<div class="backdrop" data-action="sheet-close"></div><div class="panel" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="panelHead"><h2>${esc(title)}</h2><button class="x" data-action="sheet-close" aria-label="Close">✕</button></div>${body}</div>`;
  if (s.type === 'split') return wrap('Which day?', `<div class="stack">${M.splitChoices(state).map(n => `<button class="big ${n === M.splitToday(state, today) ? 'primary' : 'quiet'}" data-action="split-pick" data-name="${esc(n)}">${esc(n)}${n === M.splitToday(state, today) ? ' ⭐' : ''}</button>`).join('')}</div>`);
  if (s.type === 'exercise') return wrap('New exercise', `<form data-form="exercise">${field('name', 'Exercise name', '', 'required maxlength="60" placeholder="Bench press" autocapitalize="words"')}<button class="big primary">Add</button></form>`);
  if (s.type === 'food') return wrap('Add food', `<form data-form="food">${field('name', 'What did you eat?', '', 'required maxlength="80"')}<div class="grid2">${numField('kcal', 'Calories', '')}${numField('protein', 'Protein (g)', '')}${numField('carbs', 'Carbs (g)', '')}${numField('fat', 'Fat (g)', '')}</div><label class="tick"><input type="checkbox" name="save"><span>⭐ Keep as a favourite</span></label><button class="big primary">Add</button></form>`);
  if (s.type === 'fav') { const f = s.draft; return wrap(M.favouriteReady(f) ? 'Edit favourite' : 'Add the numbers once', `<form data-form="fav">${field('name', 'Name', f.name, 'required maxlength="80"')}<div class="grid2">${field('emoji', 'Emoji', f.emoji, 'maxlength="8"')}<label class="field"><span>Photo</span><span class="photoPick"><span class="ph">${s.draft.photo ? `<img src="${esc(s.draft.photo)}" alt="">` : '📷'}</span><input type="file" accept="image/*" data-file="fav-photo" hidden></span></label>${numField('kcal', 'Calories', f.kcal)}${numField('protein', 'Protein (g)', f.protein)}${numField('carbs', 'Carbs (g)', f.carbs)}${numField('fat', 'Fat (g)', f.fat)}</div><label class="tick"><input type="checkbox" name="estimate" ${f.estimate ? 'checked' : ''}><span>≈ These numbers are an estimate</span></label><button class="big primary">Save</button><button type="button" class="link center danger" data-action="fav-delete">Delete favourite</button></form>`); }
  if (s.type === 'shots') return wrap('Your shots', `<div class="stack">${state.shots.map(p => `<button class="big quiet left" data-action="shot-edit" data-id="${esc(p.id)}"><i class="dot" style="background:${p.color}"></i>${esc(p.name || 'Shot')} ✏️</button>`).join('')}<button class="big primary" data-action="shot-new">+ Add a shot</button></div>`);
  if (s.type === 'shot') { const p = s.draft; return wrap(s.isNew ? 'New shot' : 'Edit shot', `<form data-form="shot">${field('name', 'Name', p.name, 'required maxlength="60"')}
    ${p.plan?.length ? '' : field('units', 'Units per shot', p.units, 'inputmode="decimal" maxlength="12" placeholder="From your vial label"')}
    ${field('detail', 'Small print (optional)', p.detail, 'maxlength="120" placeholder="What the label says"')}
    <div class="field"><span>Which nights?</span><div class="dayPick">${DAYS.map((n, i) => `<button type="button" class="${p.days.includes(i) ? 'on' : ''}" data-action="day-toggle" data-day="${i}" aria-pressed="${p.days.includes(i)}">${n}</button>`).join('')}</div></div>
    ${field('sites', 'Spots, in order (comma between)', p.sites.join(', '), 'maxlength="300" placeholder="Belly L, Belly R"')}
    ${field('note', 'Reminder (optional)', p.note, 'maxlength="200"')}
    <label class="field"><span>Weekly steps (optional). One line each: start week: units | note</span><textarea name="plan" rows="4" placeholder="1: 10 | note">${esc((p.plan || []).map(r => `${r.from}: ${r.units}${r.note ? ' | ' + r.note : ''}`).join('\n'))}</textarea></label>
    ${p.anchor ? `<button type="button" class="link center" data-action="week-reset">Change which week I am on</button>` : ''}
    <button class="big primary">Save</button>${s.isNew ? '' : '<button type="button" class="link center danger" data-action="shot-delete">Delete this shot</button>'}</form>`); }
  if (s.type === 'photo') { const p = state.photos.find(x => x.id === s.id); return p ? wrap(longDate(p.date), `<img class="fullPhoto" src="${esc(p.data)}" alt="Progress photo"><button class="link center danger" data-action="photo-delete" data-id="${esc(p.id)}">Delete photo</button>`) : ''; }
  if (s.type === 'split-edit') return wrap('Your gym week', `<form data-form="split">${state.split.map((name, i) => `<div class="grid2">${field('day' + i, DAYS[(i + 1) % 7], name, 'maxlength="60" placeholder="Rest"')}${field('note' + i, 'Note', state.splitNotes[i], 'maxlength="120"')}</div>`).join('')}${field('gymNote', 'Where (optional)', state.gymNote, 'maxlength="200"')}<button class="big primary">Save</button></form>`);
  if (s.type === 'setup') return wrap('Paste setup link', `<form data-form="setup"><label class="field"><span>Your personal setup link</span><textarea name="link" rows="4" required placeholder="https://…#setup=…"></textarea></label><button class="big primary">Load setup</button></form>`);
  if (s.type === 'setup-confirm') return wrap('Load your setup?', `<p class="sub">This updates your shots, favourites, targets and plan. Your logs stay.</p><div class="stack"><button class="big primary" data-action="setup-yes">Yes, load it</button><button class="big quiet" data-action="setup-no">No</button></div>`);
  if (s.type === 'import-confirm') return wrap('Load this backup?', `<p class="sub">This replaces everything on this phone with the backup file.</p><div class="stack"><button class="big primary" data-action="import-yes">Yes, replace</button><button class="big quiet" data-action="sheet-close">No</button></div>`);
  return '';
}
function openSheet(sheet) { ui.sheet = sheet; renderSheet(); const first = $('.panel input:not([type=file]):not([type=checkbox]), .panel textarea', sheetEl); if (first && !first.value && !isIOS) first.focus(); }
function closeSheet() { ui.sheet = null; renderSheet(); }
function renderSheet() { sheetEl.innerHTML = sheetHtml(); sheetEl.classList.toggle('open', !!ui.sheet); }

// ---------- render ----------
const VIEWS = { today: viewToday, shots: viewShots, food: viewFood, gym: viewGym, body: viewBody, settings: viewSettings };
function render() {
  const r = route(), keep = r === lastRoute ? app.scrollTop : 0;
  document.documentElement.dataset.theme = state.settings.theme;
  $('meta[name=theme-color]').content = state.settings.theme === 'light' ? '#f3f4f6' : '#0b0d10';
  app.innerHTML = VIEWS[r]();
  app.dataset.route = r;
  nav.innerHTML = TABS.map(([key, icon, label]) => `<a href="#${key}" ${key === r ? 'aria-current="page"' : ''}><span aria-hidden="true">${icon}</span>${label}</a>`).join('');
  app.scrollTop = keep; lastRoute = r;
}
function renderInstall(force = false) {
  const show = force || (!standalone && !localStorage.getItem('chad-install-skip'));
  installEl.hidden = !show;
  if (!show) { installEl.innerHTML = ''; return; }
  installEl.innerHTML = `<div class="installCard"><img src="assets/icon-192.png" alt="" width="84" height="84"><h1>Add Chad to your Home Screen</h1>
  <svg class="phone" viewBox="0 0 200 150" aria-hidden="true"><rect x="60" y="4" width="80" height="142" rx="14" class="ph"/><rect x="68" y="14" width="64" height="100" rx="6" class="scr"/><g class="share"><rect x="90" y="126" width="20" height="14" rx="3"/><path d="M100 132v-14m-5 5 5-5 5 5"/></g><path class="arrow" d="M160 96c0 22-14 34-36 36m8-7-9 7 9 6"/></svg>
  <ol><li><b>1</b><span>Tap <strong>Share</strong> ⬆️</span></li><li><b>2</b><span>Tap <strong>Add to Home Screen</strong></span></li><li><b>3</b><span>Tap <strong>Add</strong></span></li></ol>
  ${ui.pendingSetup ? '<p class="ok">✅ Your personal setup comes with it.</p><button class="big quiet" data-action="setup-copy">Copy setup link (backup)</button>' : ''}<button class="link" data-action="install-skip">Not now</button></div>`;
}

// ---------- PIN lock ----------
// The plan ships encrypted in seed.enc.json. The PIN opens it once. After that the data lives on this phone.
let seedBox;
async function loadSeedBox() {
  if (seedBox !== undefined) return seedBox;
  try { const r = await fetch('seed.enc.json'); const box = r.ok ? await r.json() : null; seedBox = M.validSeedBox(box) && crypto.subtle ? box : null; } catch { seedBox = null; }
  return seedBox;
}
const pinSkipped = () => { try { return !!localStorage.getItem('chad-pin-skip'); } catch { return false; } };
const untouched = () => !M.hasData(state) && !state.profile.name && !state.settings.setupApplied;
function renderLock() {
  const k = ui.lock; lockEl.hidden = !k;
  if (!k) { lockEl.innerHTML = ''; return; }
  const key = d => `<button type="button" data-action="lock-key" data-d="${d}">${d}</button>`;
  lockEl.innerHTML = `<div class="lockCard" role="dialog" aria-modal="true" aria-label="Enter your PIN"><p class="bigEmoji" aria-hidden="true">${k.busy ? '🔓' : '🔒'}</p><h1>Enter your PIN</h1>
  <p class="lockMsg ${k.bad ? 'bad' : ''}" role="status">${k.busy ? 'Unlocking…' : k.bad ? 'Try again' : `${k.box.digits} numbers`}</p>
  <div class="dots ${k.bad && !k.pin ? 'wobble' : ''}" aria-hidden="true">${Array.from({ length: k.box.digits }, (_, i) => `<i class="${i < k.pin.length ? 'on' : ''}"></i>`).join('')}</div>
  <div class="keys ${k.busy ? 'busy' : ''}">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(key).join('')}${k.mode === 'reload' ? '<button type="button" class="soft" data-action="lock-cancel">Cancel</button>' : '<span></span>'}${key(0)}<button type="button" class="soft" data-action="lock-del" aria-label="Delete">⌫</button></div>
  ${k.mode === 'first' ? '<button class="link" data-action="lock-skip">No PIN? Start empty</button>' : ''}</div>`;
}
function closeLock() { ui.lock = null; renderLock(); }
async function lockDigit(d) {
  const k = ui.lock; if (!k || k.busy || k.pin.length >= k.box.digits) return;
  k.pin += d; k.bad = false; renderLock();
  if (k.pin.length < k.box.digits) return;
  k.busy = true; renderLock();
  let setup;
  try { setup = await readSetup('setup=' + await M.openSeed(k.box, k.pin)); } catch { k.pin = ''; k.busy = false; k.bad = true; buzz([60, 40, 60]); renderLock(); return; }
  if (k.mode === 'reload') { closeLock(); await commit(s => M.applySetup(s, setup.payload, setup.mark), 'Plan reloaded ✅'); return; }
  try { state = await update(s => M.applySetup(s, setup.payload, setup.mark)); } catch (e) { k.pin = ''; k.busy = false; renderLock(); toast(e.message || 'Could not save'); return; }
  closeLock(); history.replaceState(null, '', location.pathname + location.search); render(); renderInstall(); toast('Your plan is loaded ✅'); confetti();
}

// ---------- actions ----------
async function logShot(id) {
  const p = state.shots.find(x => x.id === id); if (!p) return;
  const u = M.unitsFor(p, today);
  if (!u.units) { location.hash = 'shots'; return; }
  await commit(s => { const shot = s.shots.find(x => x.id === id), d = dayOf(s); if (!shot || d.shots.some(x => x.shotId === id)) return; d.shots.push({ id: M.newId(), shotId: id, name: shot.name, units: u.units, site: M.siteFor(s, shot, today, today), time: hhmm() }); });
}
async function downscale(file, max, quality = .72) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(Error('That photo did not open')); i.src = url; });
    const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  } finally { URL.revokeObjectURL(url); }
}
const SETUP_RE = /setup=((?:z\.)?[A-Za-z0-9_-]+)/;
async function readSetup(text) { const m = String(text).match(SETUP_RE); if (!m) throw Error('That is not a setup link'); return { payload: await M.decodeSetup(m[1]), mark: M.setupMark(m[1]) }; }
async function runSetup(setup) { const ok = await commit(s => M.applySetup(s, setup.payload, setup.mark), 'Setup loaded ✅'); closeSheet(); return ok; }

const actions = {
  tile(el) {
    const kind = el.dataset.kind, done = el.parentElement.classList.contains('done');
    if (kind === 'shot') return done ? (location.hash = 'shots') : logShot(el.dataset.id);
    if (kind === 'food') return (location.hash = 'food');
    if (kind === 'weight') return (location.hash = 'body');
    if (kind === 'gym') return commit(s => { const d = dayOf(s); d.gymDone = !d.gymDone; });
    if (kind === 'water') return actions.water({ dataset: { ml: WATER_STEP } });
  },
  water: el => commit(s => { const d = dayOf(s); d.water = Math.max(0, d.water + Number(el.dataset.ml)); }),
  'shot-done': el => logShot(el.dataset.id),
  'shot-undo': el => commit(s => { const d = dayOf(s); d.shots = d.shots.filter(x => x.shotId !== el.dataset.id); }, 'Undone'),
  spot: el => commit(s => { const p = s.shots.find(x => x.id === el.dataset.id); if (p?.sites.length > 1) p.siteOffset = (p.siteOffset + 1) % p.sites.length; }),
  'week-save'(el) {
    const week = Math.round(num(ui.vals['week.' + el.dataset.id]) ?? 0);
    if (week < 1) return toast('Pick week 1 or more');
    return commit(s => { const p = s.shots.find(x => x.id === el.dataset.id); p.anchor = { date: M.nextDueDate(p, today) || today, week }; }, `Week ${week} set ✅`);
  },
  'shots-manage': () => openSheet({ type: 'shots' }),
  'shot-new': () => openSheet({ type: 'shot', isNew: true, draft: M.blankShot(state.shots.length) }),
  'shot-edit'(el) { const p = state.shots.find(x => x.id === el.dataset.id); if (p) openSheet({ type: 'shot', isNew: false, draft: structuredClone(p) }); },
  'day-toggle'(el) { const p = ui.sheet.draft, i = Number(el.dataset.day); p.days = p.days.includes(i) ? p.days.filter(x => x !== i) : [...p.days, i].sort(); el.classList.toggle('on'); el.setAttribute('aria-pressed', p.days.includes(i)); },
  'week-reset'(el) { ui.sheet.draft.anchor = null; el.textContent = 'OK. Save, then set your week.'; el.disabled = true; },
  'shot-delete'(el) { if (!el.dataset.sure) { el.dataset.sure = 1; el.textContent = 'Tap again to delete'; return; } const id = ui.sheet.draft.id; closeSheet(); return commit(s => { s.shots = s.shots.filter(x => x.id !== id); }, 'Shot deleted'); },
  'food-open': () => openSheet({ type: 'food' }),
  'fav-mode': () => { ui.editFav = !ui.editFav; render(); },
  fav(el) {
    const f = state.favourites.find(x => x.id === el.dataset.id); if (!f) return;
    if (ui.editFav || !M.favouriteReady(f)) return openSheet({ type: 'fav', draft: structuredClone(f) });
    return commit(s => { dayOf(s).food.push({ id: M.newId(), name: f.name, emoji: f.emoji, kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat }); }, `Added ${f.name} ✅`).then(() => buzz(15));
  },
  'fav-delete'(el) { if (!el.dataset.sure) { el.dataset.sure = 1; el.textContent = 'Tap again to delete'; return; } const id = ui.sheet.draft.id; closeSheet(); return commit(s => { s.favourites = s.favourites.filter(x => x.id !== id); }, 'Deleted'); },
  'food-remove': el => commit(s => { const d = dayOf(s); d.food = d.food.filter(x => x.id !== el.dataset.id); }, 'Removed'),
  'gym-start': () => openSheet({ type: 'split' }),
  'split-pick'(el) { closeSheet(); delete ui.vals['gym.exercise']; return commit(s => { dayOf(s).gymSplit = el.dataset.name; }); },
  'ex-pick'(el) { pickExercise(el.dataset.name); render(); },
  'ex-new': () => openSheet({ type: 'exercise' }),
  async 'set-log'() {
    const exercise = ui.vals['gym.exercise'], weight = num(ui.vals['gym.weight']), reps = Math.round(num(ui.vals['gym.reps']) ?? 0);
    if (!exercise) return toast('Pick an exercise');
    if (weight === null) return toast('Set the weight');
    if (reps < 1) return toast('Set the reps');
    const set = { id: M.newId(), exercise, weight, reps }, prev = M.bestBefore(state, exercise, today), pr = !!prev && M.strength(set) > M.strength(prev);
    ui.rest = { end: Date.now() + REST_SECONDS * 1000 };
    if (await commit(s => { dayOf(s).sets.push(set); }, pr ? 'New best 🏆' : 'Set logged ✅')) { buzz(pr ? [40, 60, 40, 60, 80] : 15); if (pr) confetti(innerWidth / 2, innerHeight / 2, 36); }
  },
  'set-remove': el => commit(s => { const d = dayOf(s); d.sets = d.sets.filter(x => x.id !== el.dataset.id); }, 'Set removed'),
  'rest-add'() { if (ui.rest) ui.rest.end += 30000; },
  'rest-skip'() { ui.rest = null; render(); },
  'gym-finish'() { ui.rest = null; return commit(s => { dayOf(s).gymDone = true; }, 'Workout done 🏁'); },
  'gym-reopen': () => commit(s => { dayOf(s).gymDone = false; }),
  'body-save'() {
    const weight = num(ui.vals['body.weight']), waist = num(ui.vals['body.waist']);
    if (!weight) return toast('Type your weight');
    return commit(s => { const row = s.body.find(b => b.date === today); if (row) { row.weight = weight; row.waist = waist || null; } else s.body.push({ id: M.newId(), date: today, weight, waist: waist || null }); }, 'Saved ✅');
  },
  'body-remove'(el) { delete ui.vals['body.weight']; delete ui.vals['body.waist']; return commit(s => { s.body = s.body.filter(b => b.id !== el.dataset.id); }, 'Removed'); },
  'photo-view': el => openSheet({ type: 'photo', id: el.dataset.id }),
  'photo-delete'(el) { if (!el.dataset.sure) { el.dataset.sure = 1; el.textContent = 'Tap again to delete'; return; } closeSheet(); return commit(s => { s.photos = s.photos.filter(p => p.id !== el.dataset.id); }, 'Photo deleted'); },
  theme: el => commit(s => { s.settings.theme = el.dataset.value; }),
  async export() {
    const name = `chad-backup-${today}.json`, text = JSON.stringify(await read(), null, 1);
    const file = new File([text], name, { type: 'application/json' });
    if (isIOS && navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); } catch {} return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Backup saved ⬇️');
  },
  async 'import-yes'() { const data = ui.sheet.data; closeSheet(); ui.vals = {}; await commit(() => data, 'Backup loaded ✅'); },
  'setup-open': () => openSheet({ type: 'setup' }),
  'setup-yes': () => runSetup(ui.sheet.setup),
  'setup-no'() { try { localStorage.setItem('chad-setup-no', ui.sheet.setup.mark); } catch {} closeSheet(); },
  async 'setup-copy'(el) { try { await navigator.clipboard.writeText(location.href); el.textContent = 'Copied ✅'; } catch { toast('Copy did not work. Copy the address instead.'); } },
  async 'setup-paste'() { let text = ''; try { text = await navigator.clipboard.readText(); } catch {} let setup; try { setup = await readSetup(text); } catch { return openSheet({ type: 'setup' }); } return runSetup(setup); },
  phase: el => commit(s => M.setPhase(s, el.dataset.id)),
  'split-edit': () => openSheet({ type: 'split-edit' }),
  'install-help': () => renderInstall(true),
  'install-skip'() { localStorage.setItem('chad-install-skip', '1'); renderInstall(); },
  async 'plan-reload'() { const box = await loadSeedBox(); if (!box) return toast('No plan in this app. Use your setup link.'); ui.lock = { mode: 'reload', box, pin: '', busy: false, bad: false }; renderLock(); },
  'lock-key': el => lockDigit(el.dataset.d),
  'lock-del'() { const k = ui.lock; if (!k || k.busy) return; k.pin = k.pin.slice(0, -1); k.bad = false; renderLock(); },
  'lock-cancel': closeLock,
  'lock-skip'() { try { localStorage.setItem('chad-pin-skip', '1'); } catch {} closeLock(); renderInstall(); },
  'sheet-close': closeSheet
};

const forms = {
  settings(f) { return commit(s => { s.profile.name = String(f.get('name')).trim(); s.profile.born = M.validDate(f.get('born')) ? f.get('born') : ''; s.profile.height = num(f.get('height')) || null; M.setTargets(s, Object.fromEntries(['kcal', 'kcalMin', 'protein', 'water'].map(k => [k, num(f.get(k)) || null]))); }, 'Saved ✅'); },
  split(f) { closeSheet(); return commit(s => { s.split = s.split.map((_, i) => String(f.get('day' + i)).trim() || 'Rest'); s.splitNotes = s.splitNotes.map((_, i) => String(f.get('note' + i)).trim()); s.gymNote = String(f.get('gymNote')).trim(); }, 'Saved ✅'); },
  exercise(f) { const name = String(f.get('name')).trim(); if (!name) return; closeSheet(); pickExercise(name); render(); },
  async food(f) {
    const name = String(f.get('name')).trim(), kcal = num(f.get('kcal')), protein = num(f.get('protein'));
    if (!name || kcal === null || protein === null) return toast('Add a name, calories and protein');
    const item = { name, emoji: '🍽️', kcal, protein, carbs: num(f.get('carbs')), fat: num(f.get('fat')) };
    closeSheet();
    await commit(s => { dayOf(s).food.push({ id: M.newId(), ...item }); if (f.get('save')) s.favourites.push({ id: M.newId(), ...item, estimate: false, photo: null }); }, `Added ${name} ✅`);
  },
  fav(f) {
    const d = ui.sheet.draft, name = String(f.get('name')).trim(); if (!name) return;
    const next = { ...d, name, emoji: String(f.get('emoji')).trim() || '🍽️', kcal: num(f.get('kcal')), protein: num(f.get('protein')), carbs: num(f.get('carbs')), fat: num(f.get('fat')), estimate: !!f.get('estimate') };
    closeSheet();
    return commit(s => { const i = s.favourites.findIndex(x => x.id === next.id); if (i >= 0) s.favourites[i] = next; else s.favourites.push(next); }, 'Saved ✅');
  },
  shot(f) {
    const d = ui.sheet.draft, name = String(f.get('name')).trim(); if (!name) return;
    const plan = String(f.get('plan') || '').split('\n').map(line => line.match(/^\s*(\d+)\s*:\s*([^|]*)(?:\|(.*))?$/)).filter(Boolean).map(m => ({ from: Math.max(1, Number(m[1])), units: m[2].trim().slice(0, 20), note: (m[3] || '').trim() }));
    const next = { ...d, name, units: f.has('units') ? String(f.get('units')).trim() : d.units, detail: String(f.get('detail')).trim(), note: String(f.get('note')).trim(), sites: String(f.get('sites')).split(',').map(x => x.trim()).filter(Boolean), plan: plan.length ? plan : null };
    if (!next.plan) next.anchor = null;
    if (next.siteOffset >= Math.max(1, next.sites.length)) next.siteOffset = 0;
    closeSheet();
    return commit(s => { const i = s.shots.findIndex(x => x.id === next.id); if (i >= 0) s.shots[i] = next; else s.shots.push(next); }, 'Saved ✅');
  },
  async setup(f) { try { const setup = await readSetup(f.get('link')); if (M.hasData(state)) openSheet({ type: 'setup-confirm', setup }); else return runSetup(setup); } catch (e) { toast(e.message.includes('setup') ? e.message : 'That link did not work'); } }
};

const files = {
  async photo(file) { const data = await downscale(file, 900); await commit(s => { s.photos.push({ id: M.newId(), date: today, data }); }, 'Photo saved 📸'); },
  async 'fav-photo'(file, input) { ui.sheet.draft.photo = await downscale(file, 240); input.closest('.photoPick').querySelector('.ph').innerHTML = `<img src="${esc(ui.sheet.draft.photo)}" alt="">`; },
  async import(file) { const data = M.migrate(JSON.parse(await file.text())); openSheet({ type: 'import-confirm', data }); }
};

// ---------- events ----------
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  buzz();
  Promise.resolve(actions[el.dataset.action]?.(el, e)).catch(err => toast(err.message || 'Something went wrong'));
});
document.addEventListener('submit', e => { e.preventDefault(); buzz(); Promise.resolve(forms[e.target.dataset.form]?.(new FormData(e.target), e.target)).catch(err => toast(err.message || 'Something went wrong')); });
document.addEventListener('change', e => { const input = e.target.closest('[data-file]'); if (!input || !input.files[0]) return; files[input.dataset.file](input.files[0], input).catch(err => toast(err instanceof SyntaxError ? 'That file is not a backup' : err.message || 'That file did not work')).finally(() => { input.value = ''; }); });
document.addEventListener('input', e => { const b = e.target.dataset?.bind; if (b) ui.vals[b] = e.target.value; });
document.addEventListener('keydown', e => { if (ui.lock) { if (/^\d$/.test(e.key)) lockDigit(e.key); else if (e.key === 'Backspace') actions['lock-del'](); else if (e.key === 'Escape' && ui.lock.mode === 'reload') closeLock(); return; } if (e.key === 'Escape' && ui.sheet) closeSheet(); if (e.key === 'Enter' && e.target.dataset?.bind) e.target.blur(); });

// Steppers: tap once, or hold to run.
let holdTimer, holdLoop;
const stopHold = () => { clearTimeout(holdTimer); clearInterval(holdLoop); };
function stepOnce(btn) {
  const input = btn.parentElement.querySelector('input'), step = Number(btn.dataset.step), places = (String(Math.abs(step)).split('.')[1] || '').length;
  const next = Math.max(0, (num(input.value) ?? 0) + step);
  input.value = next.toFixed(places); ui.vals[input.dataset.bind] = input.value;
}
document.addEventListener('pointerdown', e => { const btn = e.target.closest('[data-step]'); if (!btn) return; e.preventDefault(); stopHold(); buzz(8); stepOnce(btn); holdTimer = setTimeout(() => { holdLoop = setInterval(() => stepOnce(btn), 70); }, 420); });
for (const type of ['pointerup', 'pointercancel', 'pointerleave', 'blur']) addEventListener(type, stopHold, true);

// Native feel: no pinch zoom, no double-tap zoom, no context menu on chrome.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, e => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', e => { if (e.touches.length > 1 || (typeof e.scale === 'number' && e.scale !== 1)) e.preventDefault(); }, { passive: false });
document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });
document.addEventListener('contextmenu', e => { if (!e.target.closest('input, textarea')) e.preventDefault(); });
// Keep sheets above the iOS keyboard.
if (window.visualViewport) { const fit = () => { document.documentElement.style.setProperty('--kb', Math.max(0, innerHeight - visualViewport.height - visualViewport.offsetTop) + 'px'); if (ui.sheet) scrollTo(0, 0); }; visualViewport.addEventListener('resize', fit); visualViewport.addEventListener('scroll', fit); }

addEventListener('hashchange', async () => {
  // iPhone Safari with a setup link: keep the link in the address (Add to Home Screen copies the address), move the tab in memory.
  if (ui.setupHash && location.hash !== ui.setupHash) { const r = location.hash.slice(1); if (ROUTES.includes(r)) ui.route = r; history.replaceState(null, '', location.pathname + location.search + ui.setupHash); if (ui.sheet) closeSheet(); ui.editFav = false; render(); return; }
  if (ui.sheet) closeSheet(); ui.editFav = false; if (await handleSetupLink()) { render(); renderInstall(); if (ui.setupToast) { ui.setupToast = false; toast('Your setup is loaded ✅'); } return; } render(); });
document.addEventListener('visibilitychange', async () => { if (document.hidden || !state) return; today = M.dateKey(); try { state = await read(); render(); } catch {} });

// ---------- start ----------
// A personal setup link: #setup=<base64url JSON>. The part after # never leaves the phone.
const SETUP_CACHE = 'chad-setup', SETUP_KEY = './__setup';
// Second road into the installed app: a copy of the link data in Cache Storage on this phone (never sent anywhere).
async function stashSetup(text) { try { await (await caches.open(SETUP_CACHE)).put(SETUP_KEY, new Response(text, { headers: { 'content-type': 'text/plain' } })); } catch {} }
async function stashedSetup() { try { const r = await (await caches.open(SETUP_CACHE)).match(SETUP_KEY); return r ? await r.text() : ''; } catch { return ''; } }
// Applies a setup once. Older or declined setups are ignored. A phone that already has data is asked first.
async function offerSetup(setup) {
  const rev = M.setupRev(setup.payload), cfg = state.settings;
  if (cfg.setupApplied === setup.mark || rev < cfg.setupRev) return;
  let declined = ''; try { declined = localStorage.getItem('chad-setup-no') || ''; } catch {}
  if (declined === setup.mark) return;
  if (M.hasData(state)) { render(); openSheet({ type: 'setup-confirm', setup }); }
  else { state = await update(s => M.applySetup(s, setup.payload, setup.mark)); ui.setupToast = true; }
}
async function handleSetupLink() {
  const m = location.hash.match(/^#setup=((?:z\.)?[A-Za-z0-9_-]+)/);
  if (!m) return false;
  // In iPhone Safari the link stays in the address so Add to Home Screen carries it into the installed app.
  const keep = isIOS && !standalone;
  if (!keep) history.replaceState(null, '', location.pathname + location.search);
  else { $('link[rel=manifest]')?.remove(); ui.setupHash = m[0]; }
  try {
    const setup = await readSetup(m[0]);
    if (keep) ui.pendingSetup = setup;
    await stashSetup(m[1]);
    await offerSetup(setup);
  } catch { toast('That setup link did not work'); }
  return true;
}
// Installed app opened with no link and nothing on it: look for the copy Safari left.
async function handleStashedSetup() {
  if (M.hasData(state) || state.settings.setupApplied) return;
  const text = await stashedSetup(); if (!text) return;
  try { await offerSetup(await readSetup('setup=' + text)); } catch {}
}
async function start() {
  try { state = await openStore(); } catch (e) { app.innerHTML = `<section class="card empty"><h2>Chad could not open your data</h2><p>${esc(e.message || '')}</p><p>Close other Chad tabs and open again. Your data is safe.</p></section>`; return; }
  if (!(await handleSetupLink())) await handleStashedSetup();
  render();
  // Nothing on this phone yet: ask for the PIN once and load the plan that ships with the app.
  const box = untouched() && !pinSkipped() ? await loadSeedBox() : null;
  if (box) { ui.lock = { mode: 'first', box, pin: '', busy: false, bad: false }; renderLock(); } else renderInstall();
  if (ui.setupToast) { ui.setupToast = false; toast('Your setup is loaded ✅'); }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.storage?.persist?.().catch(() => {});
}
start();
