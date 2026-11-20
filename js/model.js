// Chad data model. Pure functions only, no DOM, no storage.
export const VERSION = 4;
export const XP_PER_TICK = 20;
export const XP_PER_LEVEL = 200;
export const COLORS = ['#a78bfa', '#4cc2ff', '#ff9f43', '#3ddc84', '#ff6b9d', '#ffc83d'];

const pad = n => String(n).padStart(2, '0');
const utc = key => new Date(key + 'T12:00:00Z');

// The day rolls over at 4 am, so a shot logged after midnight still counts for that night.
export function dateKey(now = new Date()) {
  const d = new Date(now.getTime() - 4 * 3600e3);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const addDays = (key, n) => { const d = utc(key); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const dow = key => utc(key).getUTCDay();
export const diffDays = (a, b) => Math.round((utc(a) - utc(b)) / 864e5);
export const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
export const newId = () => (globalThis.crypto?.randomUUID?.() ?? 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));

export const blankTargets = () => ({ kcal: null, kcalMin: null, protein: null, water: null });
const TARGET_KEYS = ['kcal', 'kcalMin', 'protein', 'water'];
export const seed = () => ({
  schemaVersion: VERSION,
  revision: 0,
  profile: { name: '', born: '', height: null, notes: [] },
  targets: blankTargets(),
  phases: [],
  phase: '',
  start: null,
  review: null,
  split: ['Push', 'Pull', 'Legs', 'Push', 'Pull', 'Legs', 'Rest'],
  splitNotes: ['', '', '', '', '', '', ''],
  gymNote: '',
  shots: [],
  shotNote: '',
  favourites: [],
  body: [],
  photos: [],
  days: {},
  settings: { theme: 'dark', setupApplied: '', setupRev: 0 }
});

export const blankDay = () => ({ water: 0, food: [], sets: [], shots: [], gymSplit: '', gymDone: false });
export const blankShot = (i = 0) => ({ id: newId(), name: '', color: COLORS[i % COLORS.length], days: [0, 1, 2, 3, 4, 5, 6], units: '', detail: '', note: '', sites: [], siteOffset: 0, plan: null, anchor: null });

// ---------- validation ----------
const num = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const numOrNull = n => n === null || num(n);
const str = (s, max = 400) => typeof s === 'string' && s.length <= max;
const obj = o => !!o && typeof o === 'object' && !Array.isArray(o);
const fail = msg => { throw Error(msg); };
const unique = list => new Set(list.map(x => x.id)).size === list.length;

function validShot(p) {
  return obj(p) && str(p.id) && str(p.name) && str(p.color, 20) && str(p.units, 20) && str(p.detail) && str(p.note)
    && Array.isArray(p.days) && p.days.every(n => Number.isInteger(n) && n >= 0 && n <= 6)
    && Array.isArray(p.sites) && p.sites.every(x => str(x, 60))
    && Number.isInteger(p.siteOffset) && p.siteOffset >= 0
    && (p.plan === null || (Array.isArray(p.plan) && p.plan.every(r => obj(r) && Number.isInteger(r.from) && r.from >= 1 && str(r.units, 20) && str(r.note))))
    && (p.anchor === null || (obj(p.anchor) && validDate(p.anchor.date) && Number.isInteger(p.anchor.week) && p.anchor.week >= 1));
}
const validTargets = t => obj(t) && TARGET_KEYS.every(k => numOrNull(t[k]));
const validPhase = p => obj(p) && str(p.id, 40) && str(p.name, 40) && (p.until === '' || validDate(p.until)) && str(p.note, 200) && validTargets(p.targets)
  && (p.goal === null || (obj(p.goal) && num(p.goal.min) && num(p.goal.max) && str(p.goal.label, 60)));
const validFood = f => obj(f) && str(f.id) && str(f.name) && str(f.emoji, 16) && [f.kcal, f.protein, f.carbs, f.fat].every(numOrNull);
const validFavourite = f => validFood(f) && typeof f.estimate === 'boolean' && (f.photo === null || (str(f.photo, 400000) && f.photo.startsWith('data:image/')));

export function validate(s) {
  if (!obj(s) || s.schemaVersion !== VERSION) fail('This backup is not a Chad backup');
  if (!obj(s.profile) || !str(s.profile.name, 60) || !(s.profile.born === '' || validDate(s.profile.born)) || !numOrNull(s.profile.height) || !Array.isArray(s.profile.notes) || s.profile.notes.length > 30 || !s.profile.notes.every(x => str(x, 200))) fail('Invalid profile');
  if (!validTargets(s.targets)) fail('Invalid targets');
  if (!Array.isArray(s.phases) || s.phases.length > 12 || !s.phases.every(validPhase) || !unique(s.phases) || !str(s.phase, 40) || (s.phase !== '' && !s.phases.some(p => p.id === s.phase))) fail('Invalid phases');
  if (!(s.start === null || (obj(s.start) && num(s.start.weight) && str(s.start.label, 60)))) fail('Invalid start weight');
  if (!(s.review === null || (obj(s.review) && Number.isInteger(s.review.day) && s.review.day >= 0 && s.review.day <= 6 && str(s.review.text, 200)))) fail('Invalid weekly check');
  if (!Array.isArray(s.split) || s.split.length !== 7 || !s.split.every(x => str(x, 60))) fail('Invalid gym split');
  if (!Array.isArray(s.splitNotes) || s.splitNotes.length !== 7 || !s.splitNotes.every(x => str(x, 120)) || !str(s.gymNote, 200)) fail('Invalid gym notes');
  if (!Array.isArray(s.shots) || !s.shots.every(validShot) || !unique(s.shots)) fail('Invalid shots');
  if (!str(s.shotNote)) fail('Invalid shot note');
  if (!Array.isArray(s.favourites) || !s.favourites.every(validFavourite) || !unique(s.favourites)) fail('Invalid favourites');
  if (!Array.isArray(s.body) || !unique(s.body) || !s.body.every(b => obj(b) && str(b.id) && validDate(b.date) && numOrNull(b.weight) && numOrNull(b.waist))) fail('Invalid body log');
  if (!Array.isArray(s.photos) || !unique(s.photos) || !s.photos.every(p => obj(p) && str(p.id) && validDate(p.date) && typeof p.data === 'string' && p.data.startsWith('data:image/'))) fail('Invalid photos');
  if (!obj(s.settings) || !['dark', 'light'].includes(s.settings.theme) || !str(s.settings.setupApplied) || !Number.isInteger(s.settings.setupRev) || s.settings.setupRev < 0) fail('Invalid settings');
  if (!obj(s.days)) fail('Invalid days');
  for (const [date, d] of Object.entries(s.days)) {
    if (!validDate(date) || !obj(d) || !num(d.water) || typeof d.gymDone !== 'boolean' || !str(d.gymSplit, 60)) fail('Invalid day ' + date);
    if (!Array.isArray(d.food) || !d.food.every(f => validFood(f) && num(f.kcal) && num(f.protein))) fail('Invalid food on ' + date);
    if (!Array.isArray(d.sets) || !d.sets.every(x => obj(x) && str(x.id) && str(x.exercise, 100) && num(x.weight) && num(x.reps))) fail('Invalid sets on ' + date);
    if (!Array.isArray(d.shots) || !d.shots.every(x => obj(x) && str(x.id) && str(x.shotId) && str(x.name) && str(x.units, 20) && str(x.site, 60) && str(x.time, 5))) fail('Invalid shots on ' + date);
  }
  return s;
}

// ---------- migration ----------
function fromV2(o) {
  const s = seed();
  s.revision = o.revision || 0;
  s.profile.name = typeof o.profile?.name === 'string' ? o.profile.name : '';
  for (const k of ['kcal', 'protein', 'water']) s.targets[k] = num(o.targets?.[k]) ? o.targets[k] : null;
  if (Array.isArray(o.split) && o.split.length === 7) s.split = o.split.map(String);
  s.favourites = (o.meals || []).map(m => ({ id: String(m.id), name: String(m.name), emoji: '🍽️', kcal: m.kcal ?? null, protein: m.protein ?? null, carbs: null, fat: null, estimate: false, photo: null }));
  s.shots = (o.supplements || []).map((p, i) => ({ ...blankShot(i), id: String(p.id), name: String(p.name), days: p.days || [], detail: p.dose || '', note: p.schedule || '' }));
  s.body = (o.body || []).map(b => ({ id: String(b.id), date: b.date, weight: b.weight ?? null, waist: b.waist ?? null }));
  for (const [date, d] of Object.entries(o.days || {})) {
    s.days[date] = {
      water: Math.round((d.water || 0) * 1000),
      food: (d.food || []).map(f => ({ id: f.id, name: f.name, emoji: '🍽️', kcal: f.kcal, protein: f.protein, carbs: null, fat: null })),
      sets: (d.sets || []).map(x => ({ id: x.id, exercise: x.exercise, weight: x.weight, reps: x.reps })),
      shots: (d.doses || []).map(x => ({ id: x.id, shotId: x.supplementId, name: x.name, units: String(x.dose || '').slice(0, 20), site: '', time: x.time })),
      gymSplit: '', gymDone: !!d.trained
    };
  }
  if (o.settings?.theme === 'paper') s.settings.theme = 'light';
  return s;
}

// Schema 3 → 4 adds the plan fields (phases, start weight, weekly check, gym notes). Nothing is removed.
function fromV3(o) {
  const d = seed();
  return { ...o, schemaVersion: VERSION, profile: { ...d.profile, ...o.profile }, targets: { ...d.targets, ...o.targets }, phases: [], phase: '', start: null, review: null, splitNotes: d.splitNotes, gymNote: '', settings: { ...d.settings, ...o.settings } };
}

export function migrate(data) {
  if (!obj(data)) fail('Invalid backup');
  if (data.schemaVersion === 1 || data.schemaVersion === 2) data = fromV2(data);
  else if (data.schemaVersion === 3) data = fromV3(data);
  return validate(data);
}

// ---------- one-time personal setup (from the link hash) ----------
// Link data is base64url JSON. A leading "z." means it is deflate-compressed first (keeps the link short enough to send in one message).
export async function decodeSetup(text) {
  const zipped = text.startsWith('z.'), b64 = text.slice(zipped ? 2 : 0).replace(/-/g, '+').replace(/_/g, '/');
  let bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  if (zipped) bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  const payload = JSON.parse(new TextDecoder().decode(bytes));
  if (!obj(payload)) fail('Invalid setup link');
  return payload;
}
export function setupMark(text) { let h = 5381; for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0; return 'setup-' + h.toString(36); }
// Sets configuration only. Logs stay. What the user already set on the phone (week, spot, a missing dose, missing food numbers, photos) is kept.
export function applySetup(state, payload, mark) {
  const s = structuredClone(state), text = (v, max) => String(v ?? '').slice(0, max);
  const numIn = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  const targetsIn = t => { const out = blankTargets(); if (obj(t)) for (const k of TARGET_KEYS) out[k] = numIn(t[k]); return out; };
  if (obj(payload.profile)) {
    const p = payload.profile;
    if (typeof p.name === 'string') s.profile.name = p.name;
    if (typeof p.born === 'string') s.profile.born = p.born;
    if ('height' in p) s.profile.height = p.height;
    if (Array.isArray(p.notes)) s.profile.notes = p.notes;
  }
  if (obj(payload.targets)) for (const k of TARGET_KEYS) if (k in payload.targets) s.targets[k] = payload.targets[k];
  if (Array.isArray(payload.phases)) {
    s.phases = payload.phases.map(p => ({ id: text(p.id, 40), name: text(p.name, 40), until: p.until || '', note: text(p.note, 200), targets: targetsIn(p.targets), goal: obj(p.goal) ? { min: p.goal.min, max: p.goal.max, label: text(p.goal.label, 60) } : null }));
    s.phase = typeof payload.phase === 'string' && s.phases.some(p => p.id === payload.phase) ? payload.phase : s.phases[0]?.id || '';
    const now = currentPhase(s);
    if (now) s.targets = { ...now.targets };
  }
  if ('start' in payload) s.start = payload.start;
  if ('review' in payload) s.review = payload.review;
  if (Array.isArray(payload.split)) s.split = payload.split;
  if (Array.isArray(payload.splitNotes)) s.splitNotes = payload.splitNotes;
  if (typeof payload.gymNote === 'string') s.gymNote = payload.gymNote;
  if (typeof payload.shotNote === 'string') s.shotNote = payload.shotNote;
  if (Array.isArray(payload.shots)) {
    const old = new Map(s.shots.map(p => [p.id, p])), ids = new Set(payload.shots.map(p => p.id));
    s.shots = [...payload.shots.map((p, i) => { const was = old.get(p.id), next = { ...blankShot(i), ...p }; if (was) { next.anchor = was.anchor; next.siteOffset = was.siteOffset < Math.max(1, next.sites.length) ? was.siteOffset : 0; if (!next.units) next.units = was.units; } return next; }), ...s.shots.filter(p => !ids.has(p.id))];
  }
  if (Array.isArray(payload.favourites)) {
    const old = new Map(s.favourites.map(f => [f.id, f])), ids = new Set(payload.favourites.map(f => f.id));
    s.favourites = [...payload.favourites.map(f => { const was = old.get(f.id), next = { id: newId(), emoji: '🍽️', kcal: null, protein: null, carbs: null, fat: null, estimate: false, photo: null, ...f }; if (was) { next.photo ??= was.photo; if (!favouriteReady(next) && favouriteReady(was)) Object.assign(next, { kcal: was.kcal, protein: was.protein, carbs: was.carbs, fat: was.fat, estimate: was.estimate }); } return next; }), ...s.favourites.filter(f => !ids.has(f.id))];
  }
  s.settings.setupApplied = mark;
  s.settings.setupRev = setupRev(payload);
  return validate(s);
}
export const setupRev = payload => (Number.isInteger(payload?.rev) && payload.rev > 0 ? payload.rev : 0);
export const currentPhase = s => s.phases.find(p => p.id === s.phase) || null;
// Switching phase loads that phase's targets. A phase with no targets yet shows "Set your target".
export function setPhase(s, id) { const p = s.phases.find(x => x.id === id); if (!p) return; s.phase = id; s.targets = { ...p.targets }; }
export function setTargets(s, targets) { s.targets = { ...blankTargets(), ...targets }; const p = currentPhase(s); if (p) p.targets = { ...s.targets }; }
// 0 at the start weight, 1 at the top of the goal range. null when there is nothing to compare.
export function goalProgress(s, avg) {
  const goal = currentPhase(s)?.goal;
  if (!goal || !s.start || avg === null || s.start.weight === goal.max) return null;
  return Math.max(0, Math.min(1, (s.start.weight - avg) / (s.start.weight - goal.max)));
}
export const hasData = s => s.shots.length > 0 || s.favourites.length > 0 || s.body.length > 0 || s.phases.length > 0 || Object.keys(s.days).length > 0;

// ---------- shots ----------
export const dueShots = (s, date) => s.shots.filter(p => p.days.includes(dow(date)));
export const shotLog = (s, date, shotId) => (s.days[date]?.shots || []).find(x => x.shotId === shotId);
export const nextDueDate = (shot, from) => { for (let i = 0; i < 7; i++) { const d = addDays(from, i); if (shot.days.includes(dow(d))) return d; } return null; };

export function weekOf(shot, date) {
  if (!shot.plan?.length || !shot.anchor) return null;
  const w = shot.anchor.week + Math.floor(diffDays(date, shot.anchor.date) / 7);
  return w >= 1 ? w : null;
}
// Returns {units, note, week, needWeek}. units '' means the dose is not set.
export function unitsFor(shot, date) {
  if (!shot.plan?.length) return { units: shot.units, note: '', week: null, needWeek: false };
  const week = weekOf(shot, date);
  if (week === null) return { units: '', note: '', week: null, needWeek: true };
  const row = [...shot.plan].sort((a, b) => a.from - b.from).filter(r => r.from <= week).pop();
  return { units: row?.units || '', note: row?.note || '', week, needWeek: false };
}
// Spot rotation moves one step for every shot taken. Future dates assume each scheduled shot is taken.
export function siteFor(s, shot, date, today) {
  if (!shot.sites.length) return '';
  const logged = shotLog(s, date, shot.id);
  if (logged && date <= today) return logged.site;
  let n = shot.siteOffset;
  for (const [key, d] of Object.entries(s.days)) if (key < today && key < date) n += d.shots.filter(x => x.shotId === shot.id).length;
  for (let d = today; d < date; d = addDays(d, 1)) if (shotLog(s, d, shot.id) || shot.days.includes(dow(d))) n++;
  return shot.sites[n % shot.sites.length];
}

// ---------- food ----------
export const totals = d => d.food.reduce((a, f) => ({ kcal: a.kcal + f.kcal, protein: a.protein + f.protein, carbs: a.carbs + (f.carbs || 0), fat: a.fat + (f.fat || 0) }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
export function favouriteReady(f) { return f.kcal !== null && f.protein !== null; }

// ---------- gym ----------
export const splitToday = (s, date) => s.split[(dow(date) + 6) % 7];
export const splitChoices = s => [...new Set(s.split.filter(x => x && x.toLowerCase() !== 'rest'))];
export const strength = set => set.weight * (1 + set.reps / 30);
export function bestBefore(s, exercise, date, excludeId = null) {
  let best = null;
  for (const [key, d] of Object.entries(s.days)) if (key <= date) for (const x of d.sets) {
    if (x.id === excludeId || x.exercise.toLowerCase() !== exercise.toLowerCase()) continue;
    if (!best || strength(x) > strength(best)) best = x;
  }
  return best;
}
export function exercisesFor(s, split) {
  const seen = new Map();
  for (const key of Object.keys(s.days).sort().reverse()) { const d = s.days[key]; if (d.gymSplit === split) for (const x of d.sets) if (!seen.has(x.exercise.toLowerCase())) seen.set(x.exercise.toLowerCase(), x.exercise); }
  return [...seen.values()];
}

// ---------- body ----------
export function average(s, date) {
  const rows = s.body.filter(b => b.weight > 0 && b.date <= date && b.date > addDays(date, -7));
  return rows.length ? rows.reduce((n, b) => n + b.weight, 0) / rows.length : null;
}

// ---------- today checklist, score, XP, streak ----------
export function checklist(s, date, lite = false) {
  const d = s.days[date] || blankDay(), t = totals(d), items = [];
  for (const p of dueShots(s, date)) {
    const log = d.shots.find(x => x.shotId === p.id), u = unitsFor(p, date);
    items.push({ key: 'shot:' + p.id, kind: 'shot', icon: '💉', name: p.name || 'Shot', done: !!log, ready: !!u.units, color: p.color,
      detail: log ? `Done${log.site ? ' · ' + log.site : ''}` : u.needWeek ? 'Set your week first' : u.units ? [u.units + ' units', lite ? '' : siteFor(s, p, date, date)].filter(Boolean).join(' · ') : 'Set dose from vial label' });
  }
  items.push({ key: 'food', kind: 'food', icon: '🍗', name: 'Meals', done: d.food.length > 0, detail: d.food.length ? `${d.food.length} logged · ${Math.round(t.kcal)} kcal` : 'Log your first meal' });
  if (splitToday(s, date).toLowerCase() !== 'rest' || d.gymDone) items.push({ key: 'gym', kind: 'gym', icon: '🏋️', name: 'Gym', done: d.gymDone, detail: d.gymDone ? `Done${d.gymSplit ? ' · ' + d.gymSplit : ''}` : splitToday(s, date) });
  const goal = s.targets.water ? s.targets.water * 1000 : null;
  items.push({ key: 'water', kind: 'water', icon: '💧', name: 'Water', done: !!goal && d.water >= goal, detail: `${(d.water / 1000).toFixed(1)}${goal ? ' / ' + s.targets.water : ''} L`, progress: goal ? Math.min(1, d.water / goal) : 0 });
  const weighed = s.body.find(b => b.date === date && b.weight > 0);
  items.push({ key: 'weight', kind: 'weight', icon: '⚖️', name: 'Morning weight', done: !!weighed, detail: weighed ? `${weighed.weight} kg` : 'Step on the scale' });
  return items;
}
export function rewards(s, date) {
  const today = checklist(s, date), done = today.filter(q => q.done).length;
  const dates = new Set([...Object.keys(s.days), ...s.body.map(b => b.date)]);
  const count = key => checklist(s, key, true).filter(q => q.done).length;
  let xp = 0; for (const key of dates) xp += count(key) * XP_PER_TICK;
  let streak = 0, cursor = done ? date : addDays(date, -1);
  while (streak < 1000 && dates.has(cursor) && count(cursor) > 0) { streak++; cursor = addDays(cursor, -1); }
  return { done, total: today.length, score: Math.round(done / today.length * 100), xp, level: 1 + Math.floor(xp / XP_PER_LEVEL), intoLevel: xp % XP_PER_LEVEL, streak };
}
