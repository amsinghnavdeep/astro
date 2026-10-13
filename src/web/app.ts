import { confirmPurchase } from './consent.js';
import { renderMarkdown } from '../markdown.js';

type Status = 'awaiting_payment' | 'starting' | 'active' | 'failed';
type Thread = {
  id: string; fullName: string; gender: string; dateOfBirth: string; timeOfBirth: string; placeOfBirth: string;
  language: string; status: Status; isFree: boolean; questionsLeft: number; questionsAllowed: number;
  expired: boolean; expiresAt: string | null; createdAt: string; kundliId: string | null;
};
type Msg = { id: string; role: 'user' | 'pandit'; body: string; createdAt: string };
type Pricing = { freeQuestions: number; packQuestions: number; packCents: number; consultationDays: number; currency: string };
type Me = { user: { name: string; email: string }; freeAvailable: boolean; chatCredits: { credits: number; expiresAt: string }[]; pricing: Pricing; languages: string[]; maxChars: number };
type Kundli = { id: string; fullName: string; newborn: boolean; gender: string; dateOfBirth: string; timeOfBirth: string; placeOfBirth: string; timezone: string; latitude: number | null; longitude: number | null };
type Place = { label: string; latitude: number; longitude: number; timezone: string | null };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const landingView = $('landing-view');
const appView = $('app-view');
const signinModal = $<HTMLDialogElement>('signin-modal');
const threadList = $('thread-list');
const profileView = $('profile-view');
const profileForm = $<HTMLFormElement>('profile-form');
const chatView = $('chat-view');
const messagesEl = $('messages');
const scroller = $('scroller');
const working = $('working');
const askForm = $<HTMLFormElement>('ask-form');
const askInput = $<HTMLTextAreaElement>('ask-input');
const askSubmit = $<HTMLButtonElement>('ask-submit');
const askError = $('ask-error');
const statePanel = $('state-panel');
const banner = $('banner');
const langSelect = $<HTMLSelectElement>('lang-select');
const PENDING_Q = 'kaalera:pendingQuestion';
const STEPS = ['Casting your Kundli…', 'Reading the planets and houses…', 'Checking your dashas and transits…', "Writing Kaal's answer…"];

let me: Me | null = null;
let threads: Thread[] = [];
let current: Thread | null = null;
let kundlis: Kundli[] = [];
let pending = 0;
let pollTimer: number | undefined;
let renderedKey = '';
let sending = false;
let workingSince = 0;
let workingTimer: number | undefined;

/* ---------- helpers ---------- */

function deviceId(): string {
  try {
    let id = localStorage.getItem('kaalera_device');
    if (!id) localStorage.setItem('kaalera_device', (id = crypto.randomUUID().replace(/-/g, '')));
    return id;
  } catch {
    return '';
  }
}

async function api<T>(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', 'X-Kaalera-Device': deviceId() }, credentials: 'same-origin' });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  return { ok: res.ok, status: res.status, data };
}

const money = (cents: number, currency = 'usd') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const packLabel = (p: Pricing) => `Add ${p.packQuestions} questions — ${money(p.packCents, p.currency)}`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function timeLeft(t: Thread): string {
  if (t.expired) return 'Closed';
  if (t.status === 'awaiting_payment') return 'Awaiting payment';
  if (t.status === 'failed') return "Couldn't start";
  if (t.status === 'starting' || !t.expiresAt) return 'Starting…';
  const ms = new Date(t.expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Closed';
  const days = Math.ceil(ms / 86_400_000 - 0.05);
  if (days >= 1) return `${plural(days, 'day')} left`;
  return `${plural(Math.max(1, Math.floor(ms / 3_600_000)), 'hour')} left`;
}

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtTime(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

function showBanner(text: string, autoHide = 0): void {
  banner.textContent = text;
  banner.hidden = false;
  if (autoHide) setTimeout(() => (banner.hidden = true), autoHide);
}

function fillLanguages(select: HTMLSelectElement, langs: string[], value = 'English'): void {
  select.replaceChildren(...langs.map((l) => new Option(l, l, false, l === value)));
}

const credTotal = (): number => (me?.chatCredits ?? []).reduce((n, l) => n + l.credits, 0);

async function goToCheckout(threadId: string, btn?: HTMLButtonElement): Promise<void> {
  if (!(await confirmPurchase('chat', money(me!.pricing.packCents, me!.pricing.currency)))) return;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Opening checkout…';
  }
  const { ok, data } = await api<{ checkoutUrl: string }>(`/api/threads/${encodeURIComponent(threadId)}/checkout`, { method: 'POST', body: JSON.stringify({ agreed: true }) });
  if (ok && data.checkoutUrl) {
    location.href = data.checkoutUrl;
    return;
  }
  askError.textContent = data.error ?? 'Could not open checkout. Please try again.';
  if (current) renderState();
}

document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('[data-signin]')) openSignin();
  if (t.closest('[data-signup]')) openSignin(false, true);
  if (t.closest('[data-close]')) (t.closest('dialog') as HTMLDialogElement | null)?.close();
  const add = t.closest<HTMLButtonElement>('[data-addq]');
  if (add && current) goToCheckout(current.id, add);
});

/* ---------- landing + sign-in ---------- */

function priceCard(name: string, amt: string, note: string): HTMLElement {
  const d = el('div', 'l-card price');
  d.append(el('h3', '', name), el('div', 'price-amt', amt), el('p', 'muted', note));
  return d;
}

async function renderPrices(): Promise<void> {
  const { ok, data } = await api<Pricing>('/api/plans');
  if (!ok) return;
  const p = data;
  $('l-prices').replaceChildren(
    priceCard('Free', money(0, p.currency), `Your first consultation: an opening reading plus ${plural(p.freeQuestions, 'question')} answered.`),
    priceCard(`${p.packQuestions} questions`, money(p.packCents, p.currency), `Start another consultation, or add ${p.packQuestions} more questions to an open one.`),
    priceCard(`${p.consultationDays}-day consultations`, `${p.consultationDays} days`, `Each consultation stays open for ${p.consultationDays} days, then becomes read-only.`),
  );
}

type SkyPlanet = { name: string; nakshatra: string; retrograde: boolean };

const EXAMPLE: [string, string][] = [
  ['b', 'Around mid-2021:'], ['', ' there are strong chances you changed jobs or cities. Did this happen?\n'],
  ['b', 'Mar 2027 – Nov 2027:'], ['', ' your strongest window for a promotion or a better offer. Apply in this period.\n'],
  ['b', 'Issue:'], ['', ' Saturn is slowing your 10th house until early 2027.\n'],
  ['b', 'Remedy:'], ['', ' chant "Om Gurave Namah" 108 times on Thursdays.\n'],
  ['b', 'Kaal sees more:'], ['', ' a money rise linked to this job change.'],
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function liveSkyLine(): Promise<string> {
  const { ok, data } = await api<{ planets: SkyPlanet[] }>('/api/sky');
  if (!ok) return 'Today\'s planet positions loaded';
  const moon = data.planets.find((p) => p.name === 'Moon');
  const retro = data.planets.filter((p) => p.retrograde).map((p) => p.name);
  return `Moon in ${moon?.nakshatra ?? '—'}${retro.length ? ` · ${retro.join(', ')} retrograde` : ''}`;
}

async function runConsole(): Promise<void> {
  const steps = $('agent-steps'), out = $('agent-out');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sky = liveSkyLine();
  for (;;) {
    const plan: [string, () => Promise<string> | string][] = [
      ['Casting Kundli', () => 'Lagna, 9 grahas, 12 houses'],
      ['Reading the live sky', () => sky],
      ['Reading dasha periods', () => 'Jupiter mahadasha · Saturn antardasha'],
      ['Scanning transits to 2028', () => 'Jupiter enters 10th house: Mar 2027'],
      ['Checking past events', () => '3 strong matches'],
      ['Writing prediction', () => 'Done'],
    ];
    steps.replaceChildren();
    out.hidden = true;
    out.replaceChildren();
    $('agent-state').textContent = 'working';
    $('agent').classList.remove('done');
    const t0 = performance.now();
    const tick = setInterval(() => { $('agent-time').textContent = `${((performance.now() - t0) / 1000).toFixed(1)}s`; }, 100);
    for (let i = 0; i < plan.length; i++) {
      const li = el('li', 'run');
      li.append(el('span', 'st-ic'), el('span', 'st-name', plan[i][0]), el('span', 'st-detail'));
      steps.append(li);
      await sleep(reduce ? 0 : 650 + Math.random() * 450);
      li.querySelector('.st-detail')!.textContent = await plan[i][1]();
      li.className = 'ok';
      $('agent-count').textContent = `${i + 1}/${plan.length} steps`;
      $<HTMLElement>('agent-bar').style.width = `${((i + 1) / plan.length) * 100}%`;
    }
    out.hidden = false;
    for (const [tag, text] of EXAMPLE) {
      const node = tag ? el('b') : el('span');
      out.append(node);
      for (let i = 0; i <= text.length; i += reduce ? text.length : 3) {
        node.textContent = text.slice(0, i);
        if (!reduce) await sleep(16);
      }
      node.textContent = text;
    }
    clearInterval(tick);
    $('agent-state').textContent = 'answered';
    $('agent').classList.add('done');
    if (reduce) return;
    await sleep(9000);
  }
}

document.querySelectorAll<HTMLButtonElement>('.topic').forEach((b) =>
  b.addEventListener('click', () => {
    $<HTMLTextAreaElement>('l-input').value = b.dataset.q ?? '';
    startFromLanding(b.dataset.q ?? '');
  }),
);

function openSignin(expired = false, signup = false): void {
  $('login-title').textContent = signup ? 'Create your Kaalera account' : 'Sign in to Kaalera';
  $('login-sub').textContent = signup
    ? 'Enter your name and email. We\'ll email you a link to finish signing up. No password needed.'
    : 'We\'ll email you a sign-in link. No password needed.';
  $('login-submit').textContent = signup ? 'Create account' : 'Email me a sign-in link';
  $('login-expired').hidden = !expired;
  $('login-form').hidden = false;
  $('login-sent').hidden = true;
  $('login-error').textContent = '';
  if (!signinModal.open) signinModal.showModal();
  signinModal.querySelector<HTMLInputElement>('input[name=email]')?.focus();
}

function startFromLanding(text: string): void {
  if (text.trim()) sessionStorage.setItem(PENDING_Q, text.trim());
  openSignin();
}

$<HTMLFormElement>('l-form').addEventListener('submit', (e) => {
  e.preventDefault();
  startFromLanding($<HTMLTextAreaElement>('l-input').value);
});
$('l-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    const v = $<HTMLTextAreaElement>('l-input').value;
    if (v.trim()) startFromLanding(v);
  }
});
document.querySelectorAll<HTMLButtonElement>('.l-chip').forEach((c) =>
  c.addEventListener('click', () => {
    $<HTMLTextAreaElement>('l-input').value = c.textContent ?? '';
    startFromLanding(c.textContent ?? '');
  }),
);

$<HTMLFormElement>('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const btn = $<HTMLButtonElement>('login-submit');
  const fd = new FormData(form);
  btn.disabled = true;
  const { ok, data } = await api<{ sent: boolean; devLink?: string }>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email: String(fd.get('email') ?? ''), name: String(fd.get('name') ?? '') || undefined }),
  });
  btn.disabled = false;
  if (!ok) {
    $('login-error').textContent = data.error ?? 'Could not send the sign-in link.';
    return;
  }
  $('sent-email').textContent = String(fd.get('email'));
  $('dev-link-box').hidden = !data.devLink;
  if (data.devLink) $<HTMLAnchorElement>('dev-link').href = data.devLink;
  form.hidden = true;
  $('login-sent').hidden = false;
});
$('login-again').addEventListener('click', () => openSignin());

/* ---------- sidebar ---------- */

function renderThreads(): void {
  threadList.replaceChildren(
    ...threads.map((t) => {
      const b = el('button', 'thread' + (current?.id === t.id ? ' active' : '') + (t.expired ? ' closed' : ''));
      b.type = 'button';
      const sub = t.expired || t.status !== 'active' ? timeLeft(t) : `${timeLeft(t)} · ${plural(t.questionsLeft, 'question')}`;
      b.append(el('div', 't-name', t.fullName), el('div', 't-sub', sub));
      b.addEventListener('click', () => openThread(t));
      return b;
    }),
  );
  if (!threads.length) threadList.append(el('div', 'tiny muted empty', 'No consultations yet.'));
}

const closeMenu = () => appView.classList.remove('menu-open');
$('menu').addEventListener('click', () => appView.classList.add('menu-open'));
$('menu-close').addEventListener('click', closeMenu);
$('scrim').addEventListener('click', closeMenu);
$('new-thread').addEventListener('click', () => showProfile());
$('logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  location.href = '/';
});

/* ---------- new consultation ---------- */

function setupTimezones(): void {
  const sel = $<HTMLSelectElement>('tz-select');
  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['UTC'];
  const opts = [new Option('Select the birthplace timezone', '', true, true), ...zones.map((z) => new Option(z.replaceAll('_', ' '), z))];
  opts[0].disabled = true;
  sel.replaceChildren(...opts);
}

function selectTimezone(tz: string | null): void {
  if (!tz) return;
  const sel = $<HTMLSelectElement>('tz-select');
  if (![...sel.options].some((o) => o.value === tz)) sel.append(new Option(tz.replaceAll('_', ' '), tz));
  sel.value = tz;
}

function showProfile(question = ''): void {
  renderKundliList();
  stopPolling();
  current = null;
  renderThreads();
  closeMenu();
  chatView.hidden = true;
  profileView.hidden = false;
  banner.hidden = true;
  $('top-right').hidden = true;
  $('top-title').textContent = 'New consultation';
  $('top-sub').textContent = '';
  $('profile-cancel').hidden = threads.length === 0;
  $('profile-error').textContent = '';
  if (question) $<HTMLTextAreaElement>('profile-question').value = question;
  const p = me!.pricing;
  const note = $('price-note');
  const submit = $('profile-submit');
  if (me!.freeAvailable) {
    note.innerHTML = '<strong>This consultation is free.</strong> ';
    note.append(`Kaal gives an opening reading and answers ${plural(p.freeQuestions, 'question')}. Open for ${p.consultationDays} days.`);
    submit.textContent = 'Start free consultation';
  } else if (credTotal() > 0) {
    const next = me!.chatCredits[0];
    note.innerHTML = '';
    note.append(el('strong', '', `You have ${plural(credTotal(), 'question')} left.`),
      ` This consultation uses 1 now for the opening reading and your first answer. Open for ${p.consultationDays} days. Questions expire 3 months after purchase (next on ${new Date(next.expiresAt).toLocaleDateString()}).`);
    submit.textContent = 'Start consultation';
  } else {
    note.innerHTML = '';
    note.append(el('strong', '', `${money(p.packCents, p.currency)} for ${p.packQuestions} questions.`),
      ` An opening reading plus answers to ${plural(p.packQuestions, 'question')}, open for ${p.consultationDays} days. You'll pay securely by card.`);
    submit.textContent = `Continue to payment — ${money(p.packCents, p.currency)}`;
  }
  history.replaceState(null, '', '/');
}

$('profile-cancel').addEventListener('click', () => threads[0] && openThread(threads[0]));

const placeInput = $<HTMLInputElement>('place-input');
const placeList = $('place-list');
let placeTimer: number | undefined;
let placeSeq = 0;
let places: Place[] = [];
let placeActive = -1;

function closePlaces(): void {
  placeList.hidden = true;
  placeInput.setAttribute('aria-expanded', 'false');
  placeActive = -1;
}

function pickPlace(p: Place): void {
  placeInput.value = p.label;
  $<HTMLInputElement>('lat-input').value = String(p.latitude);
  $<HTMLInputElement>('lon-input').value = String(p.longitude);
  selectTimezone(p.timezone);
  closePlaces();
}

function renderPlaces(): void {
  placeList.replaceChildren(
    ...places.map((p, i) => {
      const li = el('li', i === placeActive ? 'active' : '', p.label);
      li.setAttribute('role', 'option');
      if (p.timezone) li.append(el('span', 'tiny muted', p.timezone));
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pickPlace(p);
      });
      return li;
    }),
  );
  placeList.hidden = places.length === 0;
  placeInput.setAttribute('aria-expanded', String(!placeList.hidden));
}

placeInput.addEventListener('input', () => {
  $<HTMLInputElement>('lat-input').value = '';
  $<HTMLInputElement>('lon-input').value = '';
  clearTimeout(placeTimer);
  const q = placeInput.value.trim();
  if (q.length < 2) return closePlaces();
  placeTimer = window.setTimeout(async () => {
    const seq = ++placeSeq;
    const { data } = await api<{ places: Place[] }>(`/api/places?q=${encodeURIComponent(q)}`);
    if (seq !== placeSeq) return;
    places = data.places ?? [];
    placeActive = -1;
    renderPlaces();
  }, 250);
});
placeInput.addEventListener('keydown', (e) => {
  if (placeList.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    placeActive = (placeActive + (e.key === 'ArrowDown' ? 1 : -1) + places.length) % places.length;
    renderPlaces();
  } else if (e.key === 'Enter' && placeActive >= 0) {
    e.preventDefault();
    pickPlace(places[placeActive]);
  } else if (e.key === 'Escape') closePlaces();
});
placeInput.addEventListener('blur', () => setTimeout(closePlaces, 120));

profileForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('profile-error');
  const submit = $<HTMLButtonElement>('profile-submit');
  err.textContent = '';
  const body = Object.fromEntries(new FormData(profileForm).entries());
  if (!body.kundliId) {
    err.textContent = 'Choose a Kundli or add a new one first.';
    return;
  }
  if (!me!.freeAvailable && credTotal() < 1) {
    if (!(await confirmPurchase('chat', money(me!.pricing.packCents, me!.pricing.currency)))) return;
    (body as Record<string, unknown>).agreed = true;
  }
  const label = submit.textContent;
  submit.disabled = true;
  submit.textContent = me!.freeAvailable ? 'Casting your Kundli…' : 'Opening checkout…';
  const { ok, status, data } = await api<{ thread?: Thread; checkoutUrl?: string }>('/api/threads', { method: 'POST', body: JSON.stringify(body) });
  if (data.checkoutUrl) {
    sessionStorage.removeItem(PENDING_Q);
    location.href = data.checkoutUrl;
    return;
  }
  submit.disabled = false;
  submit.textContent = label;
  if (data.thread) {
    sessionStorage.removeItem(PENDING_Q);
    profileForm.reset();
    me!.freeAvailable = me!.freeAvailable && !data.thread.isFree;
    void fetch('/api/me').then((r) => (r.ok ? r.json() : null)).then((m: Me | null) => { if (m) me!.chatCredits = m.chatCredits; });
    upsertThread(data.thread);
    openThread(data.thread);
    if (status === 503) showBanner(data.error ?? 'Kaal is unavailable right now. Tap Retry in a minute.');
    return;
  }
  if ((data as { code?: string }).code === 'free_used') me!.freeAvailable = false;
  if (!ok) err.textContent = data.error ?? 'Something went wrong. Please try again.';
});


/* ---------- kundlis ---------- */
const kundliModal = $<HTMLDialogElement>('kundli-modal');
const kundliForm = $<HTMLFormElement>('kundli-form');
const aboutSelect = $<HTMLSelectElement>('about-select');
let editing: Kundli | null = null;
let kundliOrigin: 'profile' | 'about' = 'profile';

async function loadKundlis(): Promise<void> {
  const { ok, data } = await api<{ kundlis: Kundli[] }>('/api/kundlis');
  if (ok) kundlis = data.kundlis;
}

const kundliSub = (k: Kundli) => `${fmtDate(k.dateOfBirth)} · ${fmtTime(k.timeOfBirth)} · ${k.placeOfBirth}`;

function renderKundliList(selected = $<HTMLInputElement>('kundli-id').value): void {
  if (!kundlis.some((k) => k.id === selected)) selected = kundlis.length === 1 ? kundlis[0].id : '';
  $<HTMLInputElement>('kundli-id').value = selected;
  const list = $('kundli-list');
  if (!kundlis.length) {
    list.replaceChildren(el('div', 'kundli-empty', 'No Kundli saved yet. Add one to start.'));
    return;
  }
  list.replaceChildren(...kundlis.map((k) => {
    const card = el('div', `kundli-card${k.id === selected ? ' selected' : ''}`);
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', String(k.id === selected));
    card.tabIndex = 0;
    const main = el('div', 'k-main');
    main.append(el('div', 'k-name', k.fullName), el('div', 'k-sub', kundliSub(k)));
    const edit = el('button', 'btn sm ghost', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', (e) => { e.stopPropagation(); openKundli(k, 'profile'); });
    card.append(main, edit);
    card.addEventListener('click', () => renderKundliList(k.id));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); renderKundliList(k.id); } });
    return card;
  }));
}

function syncNewborn(): void {
  const nb = $<HTMLInputElement>('newborn-box').checked;
  const name = $<HTMLInputElement>('kundli-name');
  name.required = !nb;
  name.placeholder = nb ? 'Optional for a newborn' : 'e.g. Arjun Sharma';
}
$('newborn-box').addEventListener('change', syncNewborn);

function openKundli(k: Kundli | null, origin: 'profile' | 'about'): void {
  editing = k;
  kundliOrigin = origin;
  kundliForm.reset();
  const f = kundliForm.elements as unknown as Record<string, HTMLInputElement>;
  if (k) {
    f.fullName.value = k.newborn && k.fullName === 'Newborn baby' ? '' : k.fullName;
    f.newborn.checked = k.newborn;
    f.gender.value = k.gender;
    f.dateOfBirth.value = k.dateOfBirth;
    f.timeOfBirth.value = k.timeOfBirth;
    f.placeOfBirth.value = k.placeOfBirth;
    $<HTMLInputElement>('lat-input').value = k.latitude == null ? '' : String(k.latitude);
    $<HTMLInputElement>('lon-input').value = k.longitude == null ? '' : String(k.longitude);
    selectTimezone(k.timezone);
  } else {
    selectTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }
  syncNewborn();
  $('kundli-title').textContent = k ? 'Edit Kundli' : 'Add a Kundli';
  $('kundli-delete').hidden = !k;
  $('kundli-error').textContent = '';
  kundliModal.showModal();
}

$('kundli-add').addEventListener('click', () => openKundli(null, 'profile'));

kundliForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('kundli-error');
  const save = $<HTMLButtonElement>('kundli-save');
  err.textContent = '';
  const body = Object.fromEntries(new FormData(kundliForm).entries());
  save.disabled = true;
  const { ok, data } = await api<{ kundli: Kundli }>(editing ? `/api/kundlis/${editing.id}` : '/api/kundlis', {
    method: editing ? 'PUT' : 'POST', body: JSON.stringify(body),
  });
  save.disabled = false;
  if (!ok) {
    err.textContent = data.error ?? 'Please check the birth details.';
    return;
  }
  await loadKundlis();
  kundliModal.close();
  if (kundliOrigin === 'about' && current) {
    fillAbout(current, data.kundli.id);
  } else renderKundliList(data.kundli.id);
});

$('kundli-delete').addEventListener('click', async () => {
  if (!editing || !confirm(`Delete the Kundli for ${editing.fullName}? Past consultations stay.`)) return;
  await api(`/api/kundlis/${editing.id}`, { method: 'DELETE' });
  await loadKundlis();
  kundliModal.close();
  renderKundliList();
});

function fillAbout(t: Thread, selected = ''): void {
  const opts = [new Option(`${t.fullName} (this consultation)`, '')];
  for (const k of kundlis) if (k.id !== t.kundliId) opts.push(new Option(k.fullName, k.id));
  opts.push(new Option('+ Add new Kundli…', '__new'));
  aboutSelect.replaceChildren(...opts);
  aboutSelect.value = selected;
  aboutSelect.dataset.prev = selected;
}

aboutSelect.addEventListener('change', () => {
  if (aboutSelect.value === '__new') {
    aboutSelect.value = aboutSelect.dataset.prev ?? '';
    openKundli(null, 'about');
    return;
  }
  aboutSelect.dataset.prev = aboutSelect.value;
});

/* ---------- conversation ---------- */

function upsertThread(t: Thread): void {
  const i = threads.findIndex((x) => x.id === t.id);
  if (i >= 0) threads[i] = t;
  else threads.unshift(t);
  if (current?.id === t.id) current = t;
  renderThreads();
}

function stopPolling(): void {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = undefined;
  setWorking(false);
}

function openThread(t: Thread): void {
  if (current?.id !== t.id) fillAbout(t);
  current = t;
  pending = 0;
  renderedKey = '';
  renderThreads();
  closeMenu();
  profileView.hidden = true;
  chatView.hidden = false;
  banner.hidden = true;
  askError.textContent = '';
  messagesEl.replaceChildren();
  $('top-title').textContent = t.fullName;
  $('top-sub').textContent = `${fmtDate(t.dateOfBirth)} · ${fmtTime(t.timeOfBirth)} · ${t.placeOfBirth}`;
  $('top-right').hidden = false;
  fillLanguages(langSelect, me!.languages, t.language);
  history.replaceState(null, '', `/?t=${encodeURIComponent(t.id)}`);
  renderState();
  poll();
}

langSelect.addEventListener('change', async () => {
  if (!current) return;
  const language = langSelect.value;
  current.language = language;
  const { ok, data } = await api<{ thread: Thread }>(`/api/threads/${encodeURIComponent(current.id)}`, { method: 'PATCH', body: JSON.stringify({ language }) });
  if (ok && data.thread) upsertThread(data.thread);
  showBanner(`Kaal will answer your next question in ${language}.`, 3500);
});

function messageNode(m: Msg): HTMLElement {
  if (m.role === 'user') return el('div', 'msg user', m.body);
  const div = el('div', 'msg kaal');
  const who = el('div', 'who');
  who.append(el('span', 'avatar kaal-av', 'K'), el('span', '', 'Kaal'));
  const body = el('div', 'body');
  body.innerHTML = renderMarkdown(m.body);
  div.append(who, body);
  return div;
}

const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140;

function renderMessages(msgs: Msg[]): void {
  const key = msgs.map((m) => m.id).join(',');
  if (key === renderedKey) return;
  const stick = nearBottom() || !renderedKey || msgs.at(-1)?.role === 'user';
  renderedKey = key;
  messagesEl.replaceChildren(...msgs.map(messageNode));
  if (stick) scroller.scrollTop = scroller.scrollHeight;
}

function setWorking(on: boolean): void {
  if (on === !working.hidden) return;
  working.hidden = !on;
  clearInterval(workingTimer);
  if (!on) return;
  workingSince = Date.now();
  const tick = () => {
    const s = Math.floor((Date.now() - workingSince) / 1000);
    const step = STEPS[Math.floor(s / 8) % STEPS.length];
    const stepEl = $('working-step');
    if (stepEl.textContent !== step) {
      stepEl.textContent = step;
      stepEl.classList.remove('enter');
      void stepEl.offsetWidth;
      stepEl.classList.add('enter');
    }
    $('working-time').textContent = s >= 5 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : '';
  };
  tick();
  workingTimer = window.setInterval(tick, 1000);
  if (nearBottom()) scroller.scrollTop = scroller.scrollHeight;
}

/** Shows the panel/composer that matches the consultation's state. */
function renderState(): void {
  const t = current;
  if (!t || !me) return;
  const p = me.pricing;
  const isLive = t.status === 'active' && !t.expired;
  $('q-left').textContent = t.expired ? 'Closed' : t.status === 'active' ? `${plural(t.questionsLeft, 'question')} left` : timeLeft(t);
  langSelect.disabled = t.expired;
  statePanel.replaceChildren();
  statePanel.hidden = true;
  const panel = (title: string, sub: string, action?: HTMLElement) => {
    const text = el('div');
    text.append(el('strong', '', title), el('div', 'muted', sub));
    statePanel.append(text);
    if (action) statePanel.append(action);
    statePanel.hidden = false;
  };
  const btn = (label: string, fn: (b: HTMLButtonElement) => void, primary = true) => {
    const b = el('button', primary ? 'btn primary' : 'btn', label);
    b.type = 'button';
    b.addEventListener('click', () => fn(b));
    return b;
  };

  if (t.expired) {
    panel(`This consultation closed after ${p.consultationDays} days`, 'You can still read it. Start a new consultation to ask more.', btn('Start a new consultation', () => showProfile()));
  } else if (t.status === 'awaiting_payment') {
    panel('Complete payment to start', `${money(p.packCents, p.currency)} for an opening reading plus ${plural(p.packQuestions, 'question')}.`, btn('Complete payment to start', (b) => goToCheckout(t.id, b)));
  } else if (t.status === 'failed') {
    panel("Kaal couldn't start this consultation", 'Your question is saved and you were not charged for a failed start.', btn('Retry', retry));
  } else if (isLive && t.questionsLeft < 1 && pending === 0) {
    const b = btn(packLabel(p), () => undefined);
    b.dataset.addq = '';
    panel("You've used all questions in this consultation", `Add ${p.packQuestions} more questions for ${money(p.packCents, p.currency)} · ${timeLeft(t)} in this consultation.`, b);
  }
  askForm.hidden = !isLive || t.questionsLeft < 1;
  askSubmit.disabled = sending;
  askInput.placeholder = pending > 0 ? 'Kaal is answering… you can type your next question.' : 'Ask a follow-up about career, marriage, health, money…';
  $('composer-hint').textContent = `${plural(t.questionsLeft, 'question')} left · ${t.language}`;
  const inline = $<HTMLButtonElement>('add-inline');
  inline.hidden = !isLive || t.questionsLeft < 1;
  inline.disabled = false;
  inline.textContent = packLabel(p);
  setWorking((t.status === 'starting' || pending > 0) && !t.expired);
}

async function retry(b: HTMLButtonElement): Promise<void> {
  if (!current) return;
  b.disabled = true;
  b.textContent = 'Retrying…';
  const { ok, data } = await api<{ thread: Thread }>(`/api/threads/${encodeURIComponent(current.id)}/retry`, { method: 'POST' });
  if (ok && data.thread) {
    upsertThread(data.thread);
    renderState();
    poll();
  } else {
    askError.textContent = data.error ?? 'Still unavailable. Please try again shortly.';
    renderState();
  }
}

async function poll(): Promise<void> {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = undefined;
  if (!current) return;
  const id = current.id;
  const { ok, data } = await api<{ thread: Thread; messages: Msg[]; pending: number }>(`/api/threads/${encodeURIComponent(id)}/messages`);
  if (current?.id !== id) return;
  if (ok) {
    pending = data.pending;
    upsertThread(data.thread);
    renderMessages(data.messages);
    renderState();
  }
  const busy = ok && (data.pending > 0 || data.thread.status === 'starting');
  const delay = busy ? 3000 : 15000;
  pollTimer = window.setTimeout(poll, document.hidden ? Math.max(delay, 15000) : delay);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && current) poll();
});

async function ask(text: string): Promise<void> {
  text = text.trim();
  if (!current || !text || sending) return;
  askError.textContent = '';
  sending = true;
  const t = current;
  messagesEl.append(messageNode({ id: 'tmp', role: 'user', body: text, createdAt: new Date().toISOString() }));
  scroller.scrollTop = scroller.scrollHeight;
  askInput.value = '';
  autosize();
  renderState();
  const { ok, status, data } = await api<{ message: Msg; thread: Thread }>(`/api/threads/${encodeURIComponent(t.id)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text, language: langSelect.value || t.language, kundliId: aboutSelect.value || undefined }),
  });
  sending = false;
  renderedKey = '';
  if (ok) {
    pending = Math.max(pending, 1);
    upsertThread(data.thread);
  } else {
    askInput.value = text;
    autosize();
    if (status === 402) {
      current = { ...t, questionsLeft: 0 };
      upsertThread(current);
    } else if (status === 429) askError.textContent = data.error ?? 'Please wait for Kaal to answer your previous question.';
    else askError.textContent = data.error ?? 'Something went wrong. Please try again.';
  }
  renderState();
  poll();
}

function autosize(): void {
  askInput.style.height = 'auto';
  askInput.style.height = `${Math.min(askInput.scrollHeight, 200)}px`;
}

askForm.addEventListener('submit', (e) => {
  e.preventDefault();
  ask(askInput.value);
});
askInput.addEventListener('input', autosize);
askInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    ask(askInput.value);
  }
});

/* ---------- boot ---------- */

async function confirmCheckout(sessionId: string): Promise<void> {
  const { ok, data } = await api<{ paid: boolean; kind?: string }>(`/api/checkout/confirm?session_id=${encodeURIComponent(sessionId)}`);
  const p = me!.pricing;
  if (!ok || !data.paid) showBanner(data.error ?? "We couldn't confirm the payment yet. If you were charged, it will appear shortly.");
  else if (data.kind === 'topup') showBanner(`Payment received — ${p.packQuestions} questions added.`, 6000);
  else showBanner('Payment received — Kaal is starting your consultation.', 6000);
}

async function boot(): Promise<void> {
  setupTimezones();
  const params = new URLSearchParams(location.search);
  const res = await api<Me>('/api/me');
  $('boot').hidden = true;
  if (!res.ok) {
    landingView.hidden = false;
    appView.hidden = true;
    renderPrices();
    void runConsole();
    if (params.get('login') === 'expired') {
      history.replaceState(null, '', '/');
      openSignin(true);
    }
    return;
  }
  me = res.data;
  landingView.hidden = true;
  appView.hidden = false;
  $('me-name').textContent = me.user.name || me.user.email.split('@')[0];
  $('me-email').textContent = me.user.email;
  $('me-avatar').textContent = (me.user.name || me.user.email).slice(0, 1).toUpperCase();
  askInput.maxLength = me.maxChars;
  $<HTMLTextAreaElement>('profile-question').maxLength = me.maxChars;
  fillLanguages($<HTMLSelectElement>('profile-lang'), me.languages);
  await loadKundlis();
  try {
    $<HTMLSelectElement>('tz-select').value = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch { /* keep placeholder */ }

  const checkout = params.get('checkout');
  const wantedId = params.get('t');
  const confirming = checkout?.startsWith('cs_') ? confirmCheckout(checkout) : null;
  if (confirming) await confirming;
  const { data } = await api<{ threads: Thread[] }>('/api/threads');
  threads = data.threads ?? [];
  const keepBanner = !banner.hidden ? banner.textContent : null;
  const pendingQ = sessionStorage.getItem(PENDING_Q);
  const wanted = threads.find((t) => t.id === wantedId);
  if (wanted) openThread(wanted);
  else if (pendingQ || !threads.length) showProfile(pendingQ ?? '');
  else openThread(threads[0]);
  if (keepBanner) showBanner(keepBanner, 6000);
}

boot();
