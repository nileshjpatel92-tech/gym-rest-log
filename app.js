// Rest Log — all the app's behavior lives in this file.
//
// How the saved data is shaped (one object in localStorage):
// {
//   lifts:    [{ id, name, group, restSec }],        group is 'push', 'pull' or 'legs'
//   workouts: [{ id, startedAt, endedAt,
//                exercises: [{ liftId, liftName,
//                              sets: [{ id, weight, reps, doneAt, restTargetSec, restSec }] }] }],
//   active:   null, or { workoutId, liftId, rest: null | { setId, liftId, startedAt } }
// }
// "restSec" on a set means "how long I rested AFTER this set". Times are milliseconds since 1970 (Date.now()).

const STORAGE_KEY = 'restlog.v1';
const MIN = 60 * 1000;

const GROUPS = [['push', 'Push'], ['pull', 'Pull'], ['legs', 'Legs']];

// Common lifts you can add from the "Add a lift" screen: [name, group, suggested rest in seconds].
// Rest follows the usual rule of thumb: heavy compound lifts 2–3 min, accessories 60–90 s.
const CATALOG = [
  // Push: chest, shoulders, triceps
  ['Bench Press', 'push', 150], ['Incline Bench Press', 'push', 150], ['Decline Bench Press', 'push', 120],
  ['Close-Grip Bench Press', 'push', 120], ['Dumbbell Bench Press', 'push', 120], ['Incline Dumbbell Press', 'push', 120],
  ['Machine Chest Press', 'push', 90], ['Overhead Press', 'push', 120], ['Push Press', 'push', 150],
  ['Seated Dumbbell Shoulder Press', 'push', 120], ['Arnold Press', 'push', 90], ['Dips', 'push', 120],
  ['Push-up', 'push', 60], ['Cable Fly', 'push', 60], ['Dumbbell Fly', 'push', 60], ['Pec Deck', 'push', 60],
  ['Lateral Raise', 'push', 60], ['Front Raise', 'push', 60], ['Tricep Pushdown', 'push', 60],
  ['Overhead Tricep Extension', 'push', 60], ['Skull Crusher', 'push', 75],
  // Pull: back, rear delts, biceps
  ['Deadlift', 'pull', 180], ['Rack Pull', 'pull', 150], ['Barbell Row', 'pull', 120], ['Pendlay Row', 'pull', 120],
  ['T-Bar Row', 'pull', 120], ['Dumbbell Row', 'pull', 90], ['Seated Cable Row', 'pull', 90],
  ['Chest-Supported Row', 'pull', 90], ['Pull-up', 'pull', 120], ['Chin-up', 'pull', 120], ['Lat Pulldown', 'pull', 90],
  ['Straight-Arm Pulldown', 'pull', 60], ['Face Pull', 'pull', 60], ['Reverse Fly', 'pull', 60], ['Shrug', 'pull', 75],
  ['Barbell Curl', 'pull', 60], ['Dumbbell Curl', 'pull', 60], ['Hammer Curl', 'pull', 60],
  ['Preacher Curl', 'pull', 60], ['Cable Curl', 'pull', 60], ['Incline Dumbbell Curl', 'pull', 60],
  // Legs: quads, hamstrings, glutes, calves
  ['Squat', 'legs', 180], ['Front Squat', 'legs', 180], ['Sumo Deadlift', 'legs', 180], ['Romanian Deadlift', 'legs', 120],
  ['Good Morning', 'legs', 120], ['Hip Thrust', 'legs', 120], ['Leg Press', 'legs', 120], ['Hack Squat', 'legs', 120],
  ['Goblet Squat', 'legs', 90], ['Bulgarian Split Squat', 'legs', 90], ['Walking Lunge', 'legs', 90],
  ['Step-up', 'legs', 90], ['Leg Extension', 'legs', 60], ['Lying Leg Curl', 'legs', 60], ['Seated Leg Curl', 'legs', 60],
  ['Hip Abduction', 'legs', 60], ['Standing Calf Raise', 'legs', 60], ['Seated Calf Raise', 'legs', 60],
];

const catalogEntry = (name) => CATALOG.find(([n]) => n.toLowerCase() === name.toLowerCase());

// The lifts a brand-new install starts with
const DEFAULT_LIFTS = [
  'Squat', 'Deadlift', 'Bench Press', 'Overhead Press', 'Barbell Row', 'Romanian Deadlift',
  'Pull-up', 'Leg Press', 'Lat Pulldown', 'Dumbbell Curl', 'Tricep Pushdown', 'Lateral Raise',
];

// ---------- Saving and loading ----------

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && saved.lifts) {
      // Lifts saved before groups existed get their group from the catalog
      for (const lift of saved.lifts) {
        if (!lift.group) lift.group = (catalogEntry(lift.name) || [null, 'push'])[1];
      }
      return saved;
    }
  } catch (e) { /* bad or missing data: fall through to a fresh start */ }
  return {
    version: 1,
    lifts: DEFAULT_LIFTS.map((name) => {
      const [, group, restSec] = catalogEntry(name);
      return { id: newId(), name, group, restSec };
    }),
    workouts: [],
    active: null,
  };
}

let data = load();

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    alert('Could not save. Storage may be full.');
  }
}

// ---------- Small helpers ----------

const $ = (id) => document.getElementById(id);

// 125 -> "2:05"
function fmt(totalSec) {
  totalSec = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

// Accepts "150" (seconds) or "2:30" (minutes:seconds). Returns seconds or null.
function parseDuration(text) {
  if (!text) return null;
  text = text.trim();
  if (text.includes(':')) {
    const [m, s] = text.split(':').map(Number);
    if (isNaN(m) || isNaN(s)) return null;
    return m * 60 + s;
  }
  const n = Number(text);
  return isNaN(n) ? null : n;
}

// Makes user-typed text safe to put inside HTML
function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const liftById = (id) => data.lifts.find((l) => l.id === id);
const activeWorkout = () => data.active && data.workouts.find((w) => w.id === data.active.workoutId);

function findSet(workout, setId) {
  for (const ex of workout.exercises) {
    const set = ex.sets.find((s) => s.id === setId);
    if (set) return set;
  }
  return null;
}

// Most recent set for a lift: this workout first, then older workouts. Used to pre-fill the inputs.
function lastSetFor(liftId) {
  for (let i = data.workouts.length - 1; i >= 0; i--) {
    const ex = data.workouts[i].exercises.find((e) => e.liftId === liftId);
    if (ex && ex.sets.length) return ex.sets[ex.sets.length - 1];
  }
  return null;
}

// ---------- Screens ----------

function show(screenName) {
  for (const el of document.querySelectorAll('.screen')) el.hidden = true;
  $('screen-' + screenName).hidden = false;
  window.scrollTo(0, 0);
  if (screenName === 'workout') renderWorkout();
  if (screenName === 'lifts') { editingLifts = false; renderLifts(); }
  if (screenName === 'add') { $('add-search').value = ''; renderAdd(); }
  if (screenName === 'history') renderHistory();
}

// ---------- Sound (Web Audio API) ----------
// We generate beeps with code instead of playing audio files. Setting the audio session to
// "ambient" asks iOS to mix our sounds with Spotify instead of pausing it.

let audioCtx = null;

function ensureAudio() {
  if ('audioSession' in navigator) {
    try { navigator.audioSession.type = 'ambient'; } catch (e) { /* not supported: ignore */ }
  }
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = new Ctx();
  }
  // iOS only lets audio start after a tap, so this is called from button taps
  if (audioCtx.state !== 'running') audioCtx.resume();
}

// Plays one tone. "at" is seconds from now; volume is 0..1.
function tone(freq, at, duration, volume, wave = 'sine') {
  if (!audioCtx) return;
  const t = audioCtx.currentTime + at;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = wave;
  osc.frequency.value = freq;
  // Quick fade in and out so it doesn't click
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

// Gentle single beep each minute
function playMinuteBeep() {
  tone(880, 0, 0.18, 0.2);
}

// Louder rising three-note chime, played twice, when you hit the target
function playTargetSound() {
  for (const offset of [0, 0.7]) {
    tone(660, offset + 0.0, 0.18, 0.6, 'triangle');
    tone(880, offset + 0.18, 0.18, 0.6, 'triangle');
    tone(1320, offset + 0.36, 0.3, 0.6, 'triangle');
  }
}

// ---------- Keeping the screen awake (Screen Wake Lock API) ----------

let wakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator) || !data.active || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (e) {
    console.warn('Wake lock not available:', e);
  }
}

function releaseWakeLock() {
  if (wakeLock) wakeLock.release();
  wakeLock = null;
}

// The phone drops the wake lock when you leave the app. When you come back, ask again,
// wake the audio back up, and redraw the timer right away.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    requestWakeLock();
    if (audioCtx && audioCtx.state !== 'running') audioCtx.resume();
    tick();
  }
});

// ---------- The rest timer ----------
// The timer never counts. It remembers WHEN rest started and subtracts that from the current
// time on every update, so it stays right even if the phone lags or the app is closed.

// Remembers which beeps already played so each one plays only once
const beeps = { minutes: 0, targetHit: false };

function restTargetSec() {
  const rest = data.active && data.active.rest;
  const lift = rest && liftById(rest.liftId);
  return lift ? lift.restSec : 120;
}

// Called after a reload, or after the target changes, so old beeps don't replay
function syncBeeps() {
  const rest = data.active && data.active.rest;
  if (!rest) return;
  const elapsed = Date.now() - rest.startedAt;
  beeps.minutes = Math.floor(elapsed / MIN);
  beeps.targetHit = elapsed >= restTargetSec() * 1000;
}

function tick() {
  const timerEl = $('timer');
  const rest = data.active && data.active.rest;
  if (!rest) {
    timerEl.textContent = '0:00';
    timerEl.className = 'timer';
    return;
  }
  const elapsed = Date.now() - rest.startedAt;
  const target = restTargetSec() * 1000;
  timerEl.textContent = fmt(elapsed / 1000);
  timerEl.className = 'timer ' + (elapsed >= target ? 'done' : 'resting');

  if (!beeps.targetHit && elapsed >= target) {
    beeps.targetHit = true;
    beeps.minutes = Math.floor(elapsed / MIN); // skip the minute beep if it lands at the same moment
    playTargetSound();
  } else if (Math.floor(elapsed / MIN) > beeps.minutes) {
    beeps.minutes = Math.floor(elapsed / MIN);
    playMinuteBeep();
  }
}

// Update the display 4 times a second. Because tick() uses timestamps, a missed update doesn't matter.
setInterval(tick, 250);

// ---------- Workout actions ----------

function startWorkout() {
  const workout = { id: newId(), startedAt: Date.now(), endedAt: null, exercises: [] };
  data.workouts.push(workout);
  data.active = { workoutId: workout.id, liftId: null, rest: null };
  save();
  ensureAudio();
  requestWakeLock();
  show('lifts');
}

function selectLift(liftId) {
  data.active.liftId = liftId;
  save();
  const last = lastSetFor(liftId);
  $('weight').value = last ? last.weight : '';
  $('reps').value = last ? last.reps : '';
  show('workout');
}

// The big button: either "save this set and start resting" or "stop resting, I'm lifting"
function onMainButton() {
  ensureAudio();
  requestWakeLock();
  const workout = activeWorkout();
  if (!workout) return;

  if (data.active.rest) {
    finishRest(workout);
  } else {
    if (!data.active.liftId) { show('lifts'); return; }
    const weight = Number($('weight').value) || 0;
    const reps = parseInt($('reps').value, 10);
    if (!reps || reps < 1) {
      alert('Enter how many reps you did.');
      return;
    }
    const lift = liftById(data.active.liftId);
    let ex = workout.exercises.find((e) => e.liftId === lift.id);
    if (!ex) {
      ex = { liftId: lift.id, liftName: lift.name, sets: [] };
      workout.exercises.push(ex);
    }
    const set = { id: newId(), weight, reps, doneAt: Date.now(), restTargetSec: null, restSec: null };
    ex.sets.push(set);
    data.active.rest = { setId: set.id, liftId: lift.id, startedAt: Date.now() };
    beeps.minutes = 0;
    beeps.targetHit = false;
  }
  save();
  renderWorkout();
}

// Stop the timer and write the actual rest time onto the set you just finished
function finishRest(workout) {
  const rest = data.active.rest;
  const set = findSet(workout, rest.setId);
  if (set) {
    set.restSec = Math.round((Date.now() - rest.startedAt) / 1000);
    set.restTargetSec = restTargetSec();
  }
  data.active.rest = null;
}

function endWorkout() {
  if (!confirm('End this workout?')) return;
  const workout = activeWorkout();
  if (workout) {
    // A rest still running when you end doesn't count, so it's left blank
    workout.endedAt = Date.now();
    workout.exercises = workout.exercises.filter((e) => e.sets.length);
    if (!workout.exercises.length) {
      data.workouts = data.workouts.filter((w) => w.id !== workout.id);
    }
  }
  data.active = null;
  save();
  releaseWakeLock();
  show('home');
}

function deleteSet(setId) {
  if (!confirm('Delete this set?')) return;
  const workout = activeWorkout();
  for (const ex of workout.exercises) ex.sets = ex.sets.filter((s) => s.id !== setId);
  if (data.active.rest && data.active.rest.setId === setId) data.active.rest = null;
  save();
  renderWorkout();
}

function changeTarget(deltaSec) {
  const lift = liftById(data.active.liftId);
  if (!lift) return;
  lift.restSec = Math.max(15, lift.restSec + deltaSec);
  save();
  syncBeeps();
  renderWorkout();
}

function stepField(field, delta) {
  const input = $(field);
  const next = Math.max(0, (Number(input.value) || 0) + delta);
  input.value = next;
}

// ---------- Drawing each screen ----------

function renderWorkout() {
  const workout = activeWorkout();
  if (!workout) return;
  const lift = liftById(data.active.liftId);
  const resting = !!data.active.rest;

  $('lift-name').textContent = lift ? lift.name : 'Pick a lift';
  // While resting, show the target for the lift you're resting from
  $('target').textContent = fmt(resting ? restTargetSec() : (lift ? lift.restSec : 0));

  const btn = $('btn-main');
  btn.textContent = resting ? 'Start next set' : 'Save set & rest';
  btn.classList.toggle('resting', resting);

  const ex = lift && workout.exercises.find((e) => e.liftId === lift.id);
  const sets = ex ? ex.sets : [];
  $('set-list').innerHTML = sets.map((s, i) => `
    <li>
      <span><strong>Set ${i + 1}</strong> · ${s.weight} lb × ${s.reps}</span>
      <span class="meta">${s.restSec != null ? 'rest ' + fmt(s.restSec) : (data.active.rest && data.active.rest.setId === s.id ? 'resting…' : '')}</span>
      <button class="del" data-set="${s.id}" aria-label="Delete set">✕</button>
    </li>`).reverse().join('');

  tick();
}

// True while the lift list shows Delete buttons instead of rest times
let editingLifts = false;

// Builds list items under Push / Pull / Legs headings. rowHtml(item) draws one row.
function groupedList(items, groupOf, rowHtml) {
  return GROUPS.map(([key, label]) => {
    const inGroup = items.filter((item) => groupOf(item) === key);
    if (!inGroup.length) return '';
    return `<li class="group-head">${label}</li>` + inGroup.map(rowHtml).join('');
  }).join('');
}

function renderLifts() {
  const current = data.active && data.active.liftId;
  $('lifts-title').textContent = data.active ? 'Pick a lift' : 'My lifts';
  $('btn-edit-lifts').textContent = editingLifts ? 'Done' : 'Edit';
  $('btn-add-lift').hidden = editingLifts;
  const sorted = data.lifts.slice().sort((a, b) => a.name.localeCompare(b.name));
  $('lift-list').innerHTML = groupedList(sorted, (l) => l.group, (l) => `
    <li class="${l.id === current ? 'current' : ''}">
      <button class="pick" data-lift="${l.id}">${esc(l.name)}</button>
      ${editingLifts
        ? `<button class="remove" data-remove="${l.id}">Delete</button>`
        : `<button class="rest" data-rest="${l.id}">Rest ${fmt(l.restSec)}</button>`}
    </li>`) || '<li class="note">No lifts yet. Tap “+ Add a lift”.</li>';
}

function deleteLift(liftId) {
  const lift = liftById(liftId);
  if (!confirm(`Remove ${lift.name} from your list? Past workouts keep their sets.`)) return;
  data.lifts = data.lifts.filter((l) => l.id !== liftId);
  if (data.active && data.active.liftId === liftId) data.active.liftId = null;
  save();
  renderLifts();
}

// The "Add a lift" screen: common lifts you don't have yet, filtered by what you type.
// Every typed word must appear in the name, so "db pr" won't match but "dumb press" will.
function renderAdd() {
  const query = $('add-search').value.trim();
  const words = query.toLowerCase().split(/\s+/);
  const have = new Set(data.lifts.map((l) => l.name.toLowerCase()));
  const matches = CATALOG.filter(([name]) =>
    !have.has(name.toLowerCase()) && words.every((w) => name.toLowerCase().includes(w)));

  // Offer "add your own" when the typed name isn't already an exact catalog or list match
  const alreadyHave = have.has(query.toLowerCase());
  $('add-custom').hidden = !query || alreadyHave || !!catalogEntry(query);
  $('custom-name').textContent = query;

  let html = groupedList(matches, (m) => m[1], ([name, , rest]) => `
    <li>
      <button class="pick" data-catalog="${esc(name)}">${esc(name)}</button>
      <span class="rest-hint">Rest ${fmt(rest)}</span>
    </li>`);
  if (alreadyHave) html = `<li class="note">“${esc(query)}” is already in your list.</li>` + html;
  $('add-results').innerHTML = html;
}

function addLift(name, group, restSec) {
  data.lifts.push({ id: newId(), name, group, restSec });
  save();
  show('lifts');
}

function editRest(liftId) {
  const lift = liftById(liftId);
  const input = prompt(`Rest target for ${lift.name} (e.g. 2:30 or 150):`, fmt(lift.restSec));
  const sec = parseDuration(input);
  if (sec == null || sec < 5) return;
  lift.restSec = sec;
  save();
  syncBeeps();
  renderLifts();
}

function renderHistory() {
  const done = data.workouts.filter((w) => w.endedAt).slice().reverse();
  if (!done.length) {
    $('history-list').innerHTML = '<p class="empty">No workouts yet.</p>';
    return;
  }
  $('history-list').innerHTML = done.map((w) => {
    const date = new Date(w.startedAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const mins = Math.round((w.endedAt - w.startedAt) / MIN);
    const lifts = w.exercises.map((ex) => `
      <h4>${esc(ex.liftName)}</h4>
      <table>${ex.sets.map((s, i) => `
        <tr><td>${i + 1}. ${s.weight} lb × ${s.reps}</td>
            <td>${s.restSec != null ? 'rest ' + fmt(s.restSec) + ' / ' + fmt(s.restTargetSec) : ''}</td></tr>`).join('')}
      </table>`).join('');
    return `<div class="workout-card"><h3>${date} · ${mins} min</h3>${lifts}</div>`;
  }).join('');
}

// ---------- Wiring buttons to actions ----------

$('btn-start').addEventListener('click', startWorkout);
$('btn-history').addEventListener('click', () => show('history'));
$('btn-history-back').addEventListener('click', () => show('home'));
$('btn-my-lifts').addEventListener('click', () => show('lifts'));
$('btn-lift').addEventListener('click', () => show('lifts'));
$('btn-lifts-back').addEventListener('click', () => show(data.active ? 'workout' : 'home'));
$('btn-edit-lifts').addEventListener('click', () => { editingLifts = !editingLifts; renderLifts(); });
$('btn-add-lift').addEventListener('click', () => show('add'));
$('btn-add-back').addEventListener('click', () => show('lifts'));
$('add-search').addEventListener('input', renderAdd);
// The keyboard's "Done" key just hides the keyboard
$('add-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
$('btn-main').addEventListener('click', onMainButton);
$('btn-end').addEventListener('click', endWorkout);
$('btn-target-down').addEventListener('click', () => changeTarget(-15));
$('btn-target-up').addEventListener('click', () => changeTarget(15));

for (const b of document.querySelectorAll('.step')) {
  b.addEventListener('click', () => stepField(b.dataset.field, Number(b.dataset.delta)));
}

// One listener for the whole list, since its buttons are redrawn often
$('lift-list').addEventListener('click', (e) => {
  const pick = e.target.closest('[data-lift]');
  const rest = e.target.closest('[data-rest]');
  const remove = e.target.closest('[data-remove]');
  // Picking only makes sense during a workout, and not while deleting
  if (pick && data.active && !editingLifts) selectLift(pick.dataset.lift);
  if (rest) editRest(rest.dataset.rest);
  if (remove) deleteLift(remove.dataset.remove);
});
$('add-results').addEventListener('click', (e) => {
  const item = e.target.closest('[data-catalog]');
  if (!item) return;
  const [name, group, restSec] = catalogEntry(item.dataset.catalog);
  addLift(name, group, restSec);
});
$('add-custom').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-group]');
  if (btn) addLift($('add-search').value.trim(), btn.dataset.group, 90);
});
$('set-list').addEventListener('click', (e) => {
  const del = e.target.closest('[data-set]');
  if (del) deleteSet(del.dataset.set);
});

// ---------- Start up ----------
// If the app was closed mid-workout, pick up right where you left off (the rest timer keeps going).
if (data.active && activeWorkout()) {
  syncBeeps();
  const last = data.active.liftId && lastSetFor(data.active.liftId);
  if (last) { $('weight').value = last.weight; $('reps').value = last.reps; }
  show(data.active.liftId ? 'workout' : 'lifts');
  requestWakeLock();
} else {
  data.active = null;
  show('home');
}
