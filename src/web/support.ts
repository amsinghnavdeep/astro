type Msg = { id: string; author: 'customer' | 'support'; body: string; createdAt: string };
type Ticket = { id: number; number: string; topic: string; subject: string; status: string; updatedAt: string; messages: Msg[] };
type ThreadLite = { id: string; fullName: string; createdAt: string };

const TOPICS: [string, string][] = [
  ['prediction', 'Prediction or answer'], ['payment', 'Payment or refund'], ['account', 'Account or sign-in'], ['api', 'API'], ['other', 'Something else'],
];
const STATUS: Record<string, string> = { open: 'Waiting for reply', answered: 'Replied', forwarded: 'Forwarded to our team', closed: 'Closed' };

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const esc = (s: string): string => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const fmt = (iso: string): string => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

async function api<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

let signedIn = false;
let poll: number | undefined;
const openIds = new Set<number>();

function renderTickets(list: Ticket[], waiting: boolean): void {
  $('my-tickets').hidden = !list.length;
  $('ticket-list').innerHTML = list.map((t) => `
    <details class="d-card s-ticket" data-id="${t.id}"${openIds.has(t.id) ? ' open' : ''}>
      <summary><span class="s-num">${esc(t.number)}</span><span class="s-subj">${esc(t.subject)}</span>
        <span class="s-badge ${esc(t.status)}">${esc(STATUS[t.status] ?? t.status)}</span><span class="d-small d-muted">${fmt(t.updatedAt)}</span></summary>
      <div class="s-msgs">${t.messages.map((m) => `<div class="s-msg ${m.author}"><div class="s-who">${m.author === 'support' ? 'Kaalera support' : 'You'} · ${fmt(m.createdAt)}</div><div class="s-body">${esc(m.body)}</div></div>`).join('')}
      ${t.status === 'open' ? '<div class="s-typing">Our team is looking into this…</div>' : ''}</div>
      ${t.status !== 'closed' ? `<form class="s-reply" data-id="${t.id}"><textarea rows="3" maxlength="4000" placeholder="Add a reply…"></textarea><button class="d-btn" type="submit">Send</button></form>` : ''}
    </details>`).join('');
  window.clearTimeout(poll);
  if (waiting) poll = window.setTimeout(loadTickets, 6000);
}

async function loadTickets(): Promise<void> {
  const r = await api<{ tickets: Ticket[]; waiting: boolean }>('/api/support/tickets');
  if (r.ok) renderTickets(r.data.tickets, r.data.waiting);
}

$('ticket-list').addEventListener('toggle', (e) => {
  const d = e.target as HTMLDetailsElement;
  const id = Number(d.dataset.id);
  if (d.open) openIds.add(id); else openIds.delete(id);
}, true);

$('ticket-list').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const box = form.querySelector('textarea')!;
  const btn = form.querySelector('button')!;
  if (box.value.trim().length < 2) return;
  btn.disabled = true;
  const r = await api(`/api/support/tickets/${form.dataset.id}/messages`, { method: 'POST', body: JSON.stringify({ message: box.value }) });
  btn.disabled = false;
  if (r.ok) await loadTickets();
  else box.setCustomValidity(r.data.error ?? 'Could not send.');
});

$('t-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('t-error').textContent = '';
  const btn = $<HTMLButtonElement>('t-submit');
  const body: Record<string, string> = {
    topic: $<HTMLSelectElement>('t-topic').value,
    subject: $<HTMLInputElement>('t-subject').value,
    message: $<HTMLTextAreaElement>('t-message').value,
  };
  if (!signedIn) body.email = $<HTMLInputElement>('t-email').value;
  const thread = $<HTMLSelectElement>('t-thread').value;
  if (thread) body.threadId = thread;
  btn.disabled = true;
  btn.textContent = 'Submitting…';
  const r = await api<{ ticket: { id: number; number: string } }>('/api/support/tickets', { method: 'POST', body: JSON.stringify(body) });
  btn.disabled = false;
  btn.textContent = 'Submit ticket';
  if (!r.ok) {
    $('t-error').textContent = r.data.error ?? 'Could not submit the ticket. Please try again.';
    return;
  }
  $('t-num').textContent = r.data.ticket.number;
  $('t-done-text').textContent = signedIn
    ? "We'll analyse it and reply below and by email."
    : "We'll analyse it and reply to you by email.";
  $<HTMLFormElement>('t-form').reset();
  $('t-form').hidden = true;
  $('t-done').hidden = false;
  if (signedIn) {
    openIds.add(r.data.ticket.id);
    await loadTickets();
  }
});

$('t-another').addEventListener('click', () => {
  $('t-done').hidden = true;
  $('t-form').hidden = false;
});

async function boot(): Promise<void> {
  $<HTMLSelectElement>('t-topic').replaceChildren(...TOPICS.map(([v, l]) => new Option(l, v)));
  const me = await api<{ user: { email: string } }>('/api/me');
  if (!me.ok) {
    $('signin-hint').hidden = false;
    return;
  }
  signedIn = true;
  $('t-email-row').hidden = true;
  const th = await api<{ threads: ThreadLite[] }>('/api/threads');
  if (th.ok && th.data.threads.length) {
    $<HTMLSelectElement>('t-thread').append(...th.data.threads.map((t) => new Option(`${t.fullName} · ${new Date(t.createdAt).toLocaleDateString()}`, t.id)));
    $('t-thread-row').hidden = false;
  }
  await loadTickets();
}

void boot();
