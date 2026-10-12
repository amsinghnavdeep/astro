import { renderMarkdown } from '../markdown.js';

type Thread = { id: string; fullName: string; dateOfBirth: string; timeOfBirth: string; placeOfBirth: string; pandit: string; status: string };
type Msg = { id: string; role: 'user' | 'pandit'; body: string; createdAt: string };
type Pack = { id: string; credits: number; cents: number };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const landingView = $('landing-view');
const appView = $('app-view');
const signinModal = $<HTMLDialogElement>('signin-modal');
const rechargeModal = $<HTMLDialogElement>('recharge-modal');
const threadList = $('thread-list');
const profileView = $('profile-view');
const profileForm = $<HTMLFormElement>('profile-form');
const profileQuestion = $<HTMLTextAreaElement>('profile-question');
const chatView = $('chat-view');
const messagesEl = $('messages');
const scroller = $('scroller');
const typing = $('typing');
const askForm = $<HTMLFormElement>('ask-form');
const askInput = $<HTMLTextAreaElement>('ask-input');
const askSubmit = $<HTMLButtonElement>('ask-submit');
const askError = $('ask-error');
const locked = $('locked');
const banner = $('banner');
const PENDING_Q = 'pandit:pendingQuestion';

let threads: Thread[] = [];
let current: Thread | null = null;
let credits = 0;
let packs: Pack[] = [];
let selectedPack = '';
let hasPurchased = false;
let pollTimer: number | undefined;
let renderedKey = '';
let sending = false;

const usd = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

async function api<T>(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; credits?: number };
  if (typeof data.credits === 'number') setCredits(data.credits);
  return { ok: res.ok, status: res.status, data };
}

function formJson(form: HTMLFormElement): string {
  return JSON.stringify(Object.fromEntries(new FormData(form).entries()));
}

function setCredits(n: number): void {
  credits = n;
  $('credits').textContent = String(n);
  $('r-balance').textContent = String(n);
  updateComposer();
}

function updateComposer(): void {
  const out = credits < 1;
  locked.hidden = !out;
  askForm.hidden = out;
  $('locked-title').textContent = hasPurchased ? "You're out of chats" : "You've used your free chat";
  if (out) $('suggestions').hidden = true;
}

function showBanner(text: string): void {
  banner.textContent = text;
  banner.hidden = false;
}

/* ---------- Recharge (Devin-style top-up) ---------- */

function renderPacks(): void {
  const box = $('r-packs');
  box.innerHTML = '';
  for (const p of packs) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'r-pack' + (p.id === selectedPack ? ' selected' : '');
    const left = document.createElement('div');
    left.innerHTML = `<div class="r-name">${p.credits} chats</div><div class="r-per">${usd(Math.round(p.cents / p.credits))} per chat</div>`;
    const price = document.createElement('div');
    price.className = 'r-price';
    price.textContent = usd(p.cents);
    b.append(left, price);
    b.addEventListener('click', () => {
      selectedPack = p.id;
      renderPacks();
    });
    box.append(b);
  }
  const sel = packs.find((p) => p.id === selectedPack);
  $('r-pay').textContent = sel ? `Pay ${usd(sel.cents)}` : 'Pay';
}

function openRecharge(): void {
  if (!selectedPack) selectedPack = packs[1]?.id ?? packs[0]?.id ?? '';
  renderPacks();
  rechargeModal.showModal();
}

$('r-pay').addEventListener('click', async () => {
  const pay = $<HTMLButtonElement>('r-pay');
  const pack = packs.find((p) => p.id === selectedPack);
  if (!pack) return;
  pay.disabled = true;
  pay.textContent = 'Processing…';
  const { ok } = await api('/api/buy', { method: 'POST', body: JSON.stringify({ packId: pack.id }) });
  pay.disabled = false;
  renderPacks();
  if (!ok) return;
  hasPurchased = true;
  rechargeModal.close();
  showBanner(`Added ${pack.credits} chats. Ask away.`);
  setTimeout(() => (banner.hidden = true), 4000);
});

document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('[data-recharge]')) openRecharge();
  if (t.closest('[data-signin]')) signinModal.showModal();
  if (t.closest('[data-close]')) (t.closest('dialog') as HTMLDialogElement | null)?.close();
});

/* ---------- Landing ---------- */

async function renderPrices(): Promise<void> {
  const { data } = await api<{ freeCredits: number; packs: Pack[] }>('/api/plans');
  const box = $('l-prices');
  box.innerHTML = '';
  const card = (name: string, amt: string, note: string) => {
    const d = document.createElement('div');
    d.className = 'l-card';
    d.innerHTML = `<h3></h3><div class="price-amt"></div><p class="muted"></p>`;
    d.querySelector('h3')!.textContent = name;
    d.querySelector('.price-amt')!.textContent = amt;
    d.querySelector('p')!.textContent = note;
    box.append(d);
  };
  card('Free', '$0', `${data.freeCredits} chat to try — your reading plus your first answer.`);
  for (const p of data.packs ?? []) card(`${p.credits} chats`, usd(p.cents), `${usd(Math.round(p.cents / p.credits))} per chat. Never expires.`);
}

function startFromLanding(text: string): void {
  sessionStorage.setItem(PENDING_Q, text.trim());
  signinModal.showModal();
  signinModal.querySelector<HTMLInputElement>('input[name=name]')?.focus();
}

$<HTMLFormElement>('l-form').addEventListener('submit', (e) => {
  e.preventDefault();
  startFromLanding($<HTMLTextAreaElement>('l-input').value);
});
$('l-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    startFromLanding($<HTMLTextAreaElement>('l-input').value);
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
  const { ok, data } = await api('/api/login', { method: 'POST', body: formJson(e.target as HTMLFormElement) });
  if (!ok) {
    $('login-error').textContent = data.error ?? 'Could not sign in.';
    return;
  }
  signinModal.close();
  boot();
});

/* ---------- Consultations ---------- */

function renderThreads(): void {
  threadList.innerHTML = '';
  for (const t of threads) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'thread' + (current?.id === t.id ? ' active' : '');
    const name = document.createElement('div');
    name.className = 't-name';
    name.textContent = t.fullName;
    const sub = document.createElement('div');
    sub.className = 't-sub';
    sub.textContent = `${t.dateOfBirth} · ${t.placeOfBirth}`;
    b.append(name, sub);
    b.addEventListener('click', () => openThread(t));
    threadList.append(b);
  }
}

function stopPolling(): void {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = undefined;
}

function showProfile(question = ''): void {
  stopPolling();
  current = null;
  renderThreads();
  appView.classList.remove('menu-open');
  chatView.hidden = true;
  profileView.hidden = false;
  banner.hidden = true;
  $('top-title').textContent = 'New consultation';
  $('top-sub').textContent = '';
  $('profile-cancel').hidden = threads.length === 0;
  if (question) profileQuestion.value = question;
  $('profile-note').textContent = credits > 0
    ? (hasPurchased || threads.length ? 'Add birth details once — yourself, spouse, child or parent. Starting a chat uses 1 chat.' : 'Your first chat is free: an opening reading of the chart plus a full answer to your question.')
    : 'You are out of chats. Recharge to start a new consultation.';
  history.replaceState(null, '', '/');
}

function openThread(t: Thread): void {
  current = t;
  renderedKey = '';
  renderThreads();
  appView.classList.remove('menu-open');
  profileView.hidden = true;
  chatView.hidden = false;
  banner.hidden = true;
  askError.textContent = '';
  messagesEl.innerHTML = '';
  $('top-title').textContent = t.fullName;
  $('top-sub').textContent = `${t.dateOfBirth} · ${t.timeOfBirth} · ${t.placeOfBirth}`;
  $('typing-name').textContent = 'Kaalera';
  history.replaceState(null, '', `/?t=${encodeURIComponent(t.id)}`);
  typing.hidden = false;
  updateComposer();
  poll();
}

function messageNode(m: Msg): HTMLElement {
  const div = document.createElement('div');
  div.className = `msg ${m.role}`;
  if (m.role === 'user') {
    div.textContent = m.body;
    return div;
  }
  const who = document.createElement('div');
  who.className = 'who';
  who.innerHTML = '<span class="avatar pandit-av">ॐ</span>';
  const name = document.createElement('span');
  name.textContent = 'Kaalera';
  who.append(name);
  const body = document.createElement('div');
  body.className = 'body';
  body.innerHTML = renderMarkdown(m.body);
  div.append(who, body);
  return div;
}

function renderMessages(msgs: Msg[]): void {
  const key = msgs.map((m) => m.id).join(',');
  if (key === renderedKey) return;
  const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
  renderedKey = key;
  messagesEl.replaceChildren(...msgs.map(messageNode));
  $('suggestions').hidden = credits < 1 || msgs.length === 0 || msgs.some((m) => m.role === 'user');
  if (nearBottom || msgs.at(-1)?.role === 'user') scroller.scrollTop = scroller.scrollHeight;
}

async function poll(): Promise<void> {
  stopPolling();
  if (!current) return;
  const id = current.id;
  const { ok, data } = await api<{ messages: Msg[]; pending: number; thread: Thread }>(`/api/threads/${encodeURIComponent(id)}/messages`);
  if (current?.id !== id) return;
  if (ok) {
    renderMessages(data.messages);
    typing.hidden = data.pending === 0;
    if (!typing.hidden) scroller.scrollTop = scroller.scrollHeight;
    if (data.thread.status === 'failed') showBanner('This consultation could not be started. Please create it again.');
  }
  const delay = ok && data.pending > 0 ? 3000 : 15000;
  pollTimer = window.setTimeout(poll, document.hidden ? Math.max(delay, 15000) : delay);
}

async function ask(text: string): Promise<void> {
  text = text.trim();
  if (!current || !text || sending) return;
  askError.textContent = '';
  if (credits < 1) return openRecharge();
  sending = true;
  askSubmit.disabled = true;
  messagesEl.append(messageNode({ id: 'tmp', role: 'user', body: text, createdAt: new Date().toISOString() }));
  typing.hidden = false;
  scroller.scrollTop = scroller.scrollHeight;
  askInput.value = '';
  autosize();
  const { ok, status, data } = await api<{ message: Msg }>(`/api/threads/${encodeURIComponent(current.id)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
  sending = false;
  askSubmit.disabled = false;
  renderedKey = '';
  if (!ok) {
    if (status === 402) openRecharge();
    else askError.textContent = data.error ?? 'Something went wrong.';
    askInput.value = text;
  }
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
document.querySelectorAll<HTMLButtonElement>('#suggestions .chip').forEach((c) => c.addEventListener('click', () => ask(c.textContent ?? '')));

profileForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('profile-error');
  err.textContent = '';
  if (credits < 1) return openRecharge();
  const submit = $<HTMLButtonElement>('profile-submit');
  submit.disabled = true;
  submit.textContent = 'Casting the chart…';
  const { ok, status, data } = await api<{ thread: Thread }>('/api/threads', { method: 'POST', body: formJson(profileForm) });
  submit.disabled = false;
  submit.textContent = 'Start chat';
  if (status === 402) return openRecharge();
  if (!ok) {
    err.textContent = data.error ?? 'Something went wrong.';
    return;
  }
  sessionStorage.removeItem(PENDING_Q);
  profileForm.reset();
  threads.unshift(data.thread);
  openThread(data.thread);
});
$('profile-cancel').addEventListener('click', () => threads[0] && openThread(threads[0]));
$('new-thread').addEventListener('click', () => showProfile());
$('menu').addEventListener('click', () => appView.classList.toggle('menu-open'));

$('logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  location.href = '/';
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && current) poll();
});

async function boot(): Promise<void> {
  const me = await api<{ user: { name: string; email: string }; packs: Pack[]; maxChars: number; purchased: boolean }>('/api/me');
  if (!me.ok) {
    landingView.hidden = false;
    appView.hidden = true;
    renderPrices();
    return;
  }
  landingView.hidden = true;
  appView.hidden = false;
  packs = me.data.packs;
  hasPurchased = me.data.purchased;
  updateComposer();
  $('me-name').textContent = me.data.user.name;
  $('me-email').textContent = me.data.user.email;
  $('me-avatar').textContent = me.data.user.name.slice(0, 1).toUpperCase();
  askInput.maxLength = me.data.maxChars;
  const { data } = await api<{ threads: Thread[] }>('/api/threads');
  threads = data.threads ?? [];
  const pendingQ = sessionStorage.getItem(PENDING_Q);
  const wanted = threads.find((t) => t.id === new URLSearchParams(location.search).get('t'));
  if (wanted) openThread(wanted);
  else if (pendingQ || !threads.length) showProfile(pendingQ ?? '');
  else openThread(threads[0]);
}

boot();
