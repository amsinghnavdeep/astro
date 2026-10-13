import { confirmPurchase } from './consent.js';
import { taxFeeNote } from '../disclaimer.js';
import { autoChargeNotice, saveBilling, type BillingInfo } from './billing.js';
type Key = { id: string; name: string; prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null };
type Entry = { id: string; delta: number; reason: string; ref: string; api_key_id: string | null; thread_id: string | null; created_at: string };
type Pack = { id: string; credits: number; cents: number };
type Developer = { keys: Key[]; balance: number; ledger: Entry[]; packs: Pack[]; creditCents: number; taxFeePercent: number; billing?: BillingInfo; apiPrice?: { startCents: number; questionCents: number }; apiDiscountPercent?: number };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const TABS = ['keys', 'billing', 'usage'] as const;
type Tab = (typeof TABS)[number];

let state: Developer | null = null;
let revokeTarget: Key | null = null;
let signinPoll: number | undefined;

const usd2 = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const usd = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
const plural = (n: number, word: string) => `${n} ${word}${Math.abs(n) === 1 ? '' : 's'}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function fmtDate(iso: string | null, withTime = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return withTime
    ? d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function relative(iso: string | null): string {
  if (!iso) return 'Never';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return fmtDate(iso);
}

async function api<T>(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  return { ok: res.ok, status: res.status, data };
}

function showBanner(text: string): void {
  const b = $('banner');
  b.textContent = text;
  b.hidden = false;
  window.setTimeout(() => { b.hidden = true; }, 8000);
}

/* ---------- auth ---------- */

async function boot(): Promise<void> {
  const me = await api<{ user: { name: string | null; email: string } }>('/api/me');
  if (me.status === 401) return showSignin();
  window.clearInterval(signinPoll);
  $('signin-view').hidden = true;
  $('dash-view').hidden = false;
  const { email, name } = me.data.user;
  $('me-email').textContent = email;
  $('me-avatar').textContent = (name || email).slice(0, 1).toUpperCase();
  renderQuickstart();
  await confirmCheckout();
  await load();
  showTab();
}

function showSignin(): void {
  $('dash-view').hidden = true;
  $('signin-view').hidden = false;
  $('signin-email').focus();
}

$<HTMLFormElement>('signin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $<HTMLButtonElement>('signin-submit');
  $('signin-error').textContent = '';
  btn.disabled = true;
  const r = await api<{ sent: boolean; devLink?: string }>('/api/login', {
    method: 'POST', body: JSON.stringify({ email: $<HTMLInputElement>('signin-email').value }),
  });
  btn.disabled = false;
  if (!r.ok) {
    $('signin-error').textContent = r.data.error ?? 'Could not send the sign-in link.';
    return;
  }
  $('signin-sent').hidden = false;
  btn.textContent = 'Resend link';
  if (r.data.devLink) {
    $('signin-dev').hidden = false;
    $('signin-devlink').textContent = r.data.devLink;
  }
  window.clearInterval(signinPoll);
  signinPoll = window.setInterval(async () => {
    if ((await fetch('/api/me')).ok) void boot();
  }, 3000);
});

// The verify link redirects to the app; following it via fetch sets the session cookie and keeps us here.
$('signin-devbtn').addEventListener('click', async () => {
  await fetch($('signin-devlink').textContent ?? '', { credentials: 'same-origin' });
  void boot();
});

$('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/developers';
});

/* ---------- data ---------- */

async function load(): Promise<void> {
  const r = await api<Developer>('/api/developer');
  if (r.status === 401) return showSignin();
  if (!r.ok) return showBanner(r.data.error ?? 'Could not load your developer account.');
  state = r.data;
  renderKeys();
  renderBilling();
  renderUsage();
  void maybeApiNotice();
}

async function confirmCheckout(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const id = params.get('checkout');
  if (!id) return;
  params.delete('checkout');
  const qs = params.toString();
  history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}#billing`);
  const r = await api<{ paid: boolean }>(`/api/checkout/confirm?session_id=${encodeURIComponent(id)}`);
  if (r.ok && r.data.paid) showBanner('Payment received. Your credits have been added.');
  else if (r.ok) showBanner('Payment is still processing. Credits appear here as soon as it completes.');
  else showBanner(r.data.error ?? 'Could not confirm the payment.');
}

/* ---------- tabs ---------- */

function showTab(): void {
  const hash = location.hash.slice(1);
  const tab: Tab = (TABS as readonly string[]).includes(hash) ? (hash as Tab) : 'keys';
  for (const t of TABS) $(`tab-${t}`).hidden = t !== tab;
  document.querySelectorAll<HTMLAnchorElement>('[data-tab]').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  document.title = `${{ keys: 'API keys', billing: 'Credits & billing', usage: 'Usage' }[tab]} — Kaalera Developers`;
}
window.addEventListener('hashchange', showTab);

/* ---------- keys ---------- */

function renderKeys(): void {
  const keys = state?.keys ?? [];
  $('keys-empty').hidden = keys.length > 0;
  $('keys-body').innerHTML = keys.map((k) => `
    <tr class="${k.revoked_at ? 'revoked' : ''}">
      <td>${esc(k.name)}</td>
      <td class="d-mono">${esc(k.prefix)}…</td>
      <td>${fmtDate(k.created_at)}</td>
      <td title="${k.last_used_at ? esc(fmtDate(k.last_used_at, true)) : ''}">${relative(k.last_used_at)}</td>
      <td>${k.revoked_at
        ? `<span class="d-badge" title="Revoked ${esc(fmtDate(k.revoked_at, true))}">Revoked</span>`
        : '<span class="d-badge ok">Active</span>'}</td>
      <td class="d-num">${k.revoked_at ? '' : `<button class="d-btn sm" type="button" data-revoke="${esc(k.id)}">Revoke</button>`}</td>
    </tr>`).join('');
}

type Biz = { business?: boolean; businessName?: string | null; minRechargeCents?: number };
const biz = (): Biz => (state ?? {}) as Biz;
let bizPack = '';

function openBiz(packId?: string): void {
  const min = biz().minRechargeCents ?? 10000;
  const pack = (state?.packs ?? []).filter((p) => p.cents >= min).sort((a, b) => a.cents - b.cents)[0];
  bizPack = packId || pack?.id || '';
  const chosen = (state?.packs ?? []).find((p) => p.id === bizPack);
  $('biz-amount').textContent = usd(chosen?.cents ?? min);
  $<HTMLInputElement>('biz-name').value = biz().businessName ?? '';
  $('biz-error').textContent = '';
  $<HTMLDialogElement>('biz-modal').showModal();
}

$<HTMLFormElement>('biz-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $<HTMLButtonElement>('biz-submit');
  btn.disabled = true;
  const businessName = $<HTMLInputElement>('biz-name').value.trim();
  const taxId = $<HTMLInputElement>('biz-tax').value.trim();
  const r = await api('/api/account/business', { method: 'POST', body: JSON.stringify({ businessName, taxId }) });
  btn.disabled = false;
  if (!r.ok) {
    $('biz-error').textContent = r.data.error ?? 'Could not save your business details.';
    return;
  }
  (state as Biz).businessName = businessName;
  $<HTMLDialogElement>('biz-modal').close();
  location.hash = 'billing';
  document.querySelector<HTMLButtonElement>(`#packs [data-pack="${CSS.escape(bizPack)}"]`)?.click();
});

$('new-key').addEventListener('click', () => {
  if (!biz().business || !(state as { activated?: boolean }).activated) return openBiz();
  $<HTMLInputElement>('create-name').value = '';
  $('create-error').textContent = '';
  $<HTMLDialogElement>('create-modal').showModal();
});

$<HTMLFormElement>('create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $<HTMLButtonElement>('create-submit');
  btn.disabled = true;
  const r = await api<{ key: string; record: Key }>('/api/developer/keys', {
    method: 'POST', body: JSON.stringify({ name: $<HTMLInputElement>('create-name').value }),
  });
  btn.disabled = false;
  if (!r.ok) {
    $('create-error').textContent = r.data.error ?? 'Could not create the key.';
    return;
  }
  $<HTMLDialogElement>('create-modal').close();
  $('new-key-value').textContent = r.data.key;
  $('copy-key').textContent = 'Copy';
  $<HTMLDialogElement>('key-modal').showModal();
  await load();
});

$('copy-key').addEventListener('click', () => copy($('new-key-value').textContent ?? '', $('copy-key')));

// Clear the secret from the DOM once the modal is dismissed.
$<HTMLDialogElement>('key-modal').addEventListener('close', () => { $('new-key-value').textContent = ''; });

$('keys-body').addEventListener('click', (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>('[data-revoke]')?.dataset.revoke;
  revokeTarget = state?.keys.find((k) => k.id === id) ?? null;
  if (!revokeTarget) return;
  $('revoke-name').textContent = `${revokeTarget.name} (${revokeTarget.prefix}…)`;
  $('revoke-error').textContent = '';
  $<HTMLDialogElement>('revoke-modal').showModal();
});

$('revoke-confirm').addEventListener('click', async () => {
  if (!revokeTarget) return;
  const btn = $<HTMLButtonElement>('revoke-confirm');
  btn.disabled = true;
  const r = await api(`/api/developer/keys/${encodeURIComponent(revokeTarget.id)}`, { method: 'DELETE' });
  btn.disabled = false;
  if (!r.ok) {
    $('revoke-error').textContent = r.data.error ?? 'Could not revoke the key.';
    return;
  }
  $<HTMLDialogElement>('revoke-modal').close();
  await load();
});

/* ---------- billing ---------- */

function renderBilling(): void {
  if (!state) return;
  const { balance, packs } = state;
  const lots = (state as { creditLots?: { credits: number; expiresAt: string }[] }).creditLots ?? [];
  const ap = state.apiPrice ?? { startCents: 900, questionCents: 630 };
  $('balance').textContent = usd2(balance);
  $('side-balance').textContent = usd2(balance);
  $('balance-sub').textContent = `About ${plural(Math.floor(balance / ap.questionCents), 'follow-up question')} at ${usd2(ap.questionCents)} each`
    + (lots.length ? ` · ${usd2(lots[0].credits)} expires on ${new Date(lots[0].expiresAt).toLocaleDateString()}` : '');
  $('per-credit').textContent = `Start ${usd2(ap.startCents)} · follow-up ${usd2(ap.questionCents)} (${state.apiDiscountPercent ?? 10}% below standard)`;
  $('packs').innerHTML = packs.map((p) => `
    <div class="d-pack">
      <div class="d-pack-credits">${usd(p.cents)}</div>
      <div class="d-muted d-small">about ${plural(Math.floor(p.cents / ap.questionCents), 'question')}</div>
      <div class="d-pack-price">${usd(withFee(p.cents))}<span class="d-muted" style="font-size:12px;font-weight:400">${taxFeeNote(state?.taxFeePercent ?? 0)}</span></div>
      <button class="d-btn primary" type="button" data-pack="${esc(p.id)}">Add ${usd(p.cents)}</button>
    </div>`).join('');
  renderAutoRecharge();
}

$('packs').addEventListener('click', async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-pack]');
  if (!btn) return;
  if (!biz().businessName) return openBiz(btn.dataset.pack);
  if (!(await confirmPurchase('api', `${usd(withFee((state?.packs ?? []).find((p) => p.id === btn.dataset.pack)?.cents ?? 0))}${taxFeeNote(state?.taxFeePercent ?? 0)}`, { extraQuestionCents: 0, apiCreditCents: state?.creditCents ?? 0, taxFeePercent: state?.taxFeePercent ?? 0 }))) return;
  $('buy-error').textContent = '';
  btn.disabled = true;
  btn.textContent = 'Opening secure checkout…';
  const r = await api<{ checkoutUrl: string }>('/api/developer/checkout', {
    method: 'POST', body: JSON.stringify({ packId: btn.dataset.pack, agreed: true }),
  });
  if (r.ok && r.data.checkoutUrl) {
    location.href = r.data.checkoutUrl;
    return;
  }
  $('buy-error').textContent = r.data.error ?? 'Could not start checkout.';
  renderBilling();
});

/* ---------- auto-recharge ---------- */

const withFee = (cents: number) => cents + Math.round((cents * (state?.taxFeePercent ?? 0)) / 100);

function renderAutoRecharge(): void {
  const b = state?.billing;
  if (!b || !state) return;
  $('ar-card').textContent = b.card ? `Card •••• ${b.card.last4} saved` : 'Your card is saved with your first purchase.';
  $<HTMLInputElement>('ar-on').checked = b.apiAutoRecharge;
  $<HTMLInputElement>('ar-credits').value = String(Math.round(b.apiAutoRechargeCents / 100));
  $<HTMLInputElement>('ar-cap').value = String(Math.round(b.apiAutoRechargeCapCents / 100));
  $('ar-sub').textContent = arText(b);
}

const arText = (b: BillingInfo): string =>
  `When your wallet drops below ${usd(b.apiLowCents)}, we add ${usd(b.apiAutoRechargeCents)} to your wallet for ${usd(withFee(b.apiAutoRechargeCents))}${taxFeeNote(state?.taxFeePercent ?? 0)}, up to ${usd(b.apiAutoRechargeCapCents)} a month.`;

$('ar-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $<HTMLButtonElement>('ar-save');
  btn.disabled = true;
  btn.classList.add('is-busy');
  btn.textContent = 'Saving…';
  const r = await saveBilling({
    apiAutoRecharge: $<HTMLInputElement>('ar-on').checked, ack: 'api',
    apiAutoRechargeCents: Math.max(10, Math.min(1000, Math.round(Number($<HTMLInputElement>('ar-credits').value) || 100))) * 100,
    apiAutoRechargeCapCents: Math.max(0, Math.min(10000, Math.round(Number($<HTMLInputElement>('ar-cap').value) || 0))) * 100,
  });
  btn.disabled = false;
  btn.classList.remove('is-busy');
  btn.textContent = 'Save';
  if (r && state) state.billing = r;
  renderAutoRecharge();
  showBanner(r ? 'Auto-recharge settings saved.' : 'Could not save. Please try again.');
});

async function maybeApiNotice(): Promise<void> {
  const b = state?.billing;
  if (!b?.card || b.apiAutoRechargeAcked || !state) return;
  const r = await autoChargeNotice('api', b, `${arText(b)} Change or turn it off under Credits & billing.`);
  if (r && state) state.billing = r;
  renderAutoRecharge();
}

/* ---------- usage ---------- */

const REASONS: Record<string, string> = { purchase: 'Purchase', question: 'Question', refund: 'Refund' };

function consultationFor(e: Entry, ledger: Entry[]): string | null {
  if (e.thread_id) return e.thread_id;
  if (e.reason !== 'refund') return null;
  const original = ledger.find((x) => `refund:${x.ref}` === e.ref);
  return original?.thread_id ?? (e.ref.match(/^refund:consultation:(.+)$/)?.[1] ?? null);
}

function renderUsage(): void {
  const ledger = state?.ledger ?? [];
  const keyNames = new Map((state?.keys ?? []).map((k) => [k.id, k.name]));
  $('usage-empty').hidden = ledger.length > 0;
  $('usage-body').innerHTML = ledger.map((e) => {
    const thread = consultationFor(e, ledger);
    const key = e.api_key_id ? keyNames.get(e.api_key_id) ?? '—' : '—';
    return `
      <tr>
        <td>${fmtDate(e.created_at, true)}</td>
        <td>${esc(REASONS[e.reason] ?? e.reason)}</td>
        <td class="d-num ${e.delta > 0 ? 'd-pos' : ''}">${e.delta > 0 ? '+' : '−'}${usd2(Math.abs(e.delta))}</td>
        <td class="d-mono">${thread ? `<span title="${esc(thread)}">${esc(thread)}</span>` : '—'}</td>
        <td>${esc(key)}</td>
      </tr>`;
  }).join('');
}

$('refresh-usage').addEventListener('click', () => void load());

/* ---------- quickstart ---------- */

function renderQuickstart(): void {
  const base = location.origin;
  $('quickstart-code').textContent = `export KAALERA_API_KEY=kal_live_...

# 1. Start a consultation (2 credits)
curl -s ${base}/v1/consultations \\
  -H "Authorization: Bearer $KAALERA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "fullName": "Asha Verma",
    "gender": "Female",
    "dateOfBirth": "2 Sep 2016",
    "timeOfBirth": "5:24 PM",
    "placeOfBirth": "Etobicoke, Ontario, Canada",
    "timezone": "America/Toronto",
    "question": "What do her stars say about her studies?"
  }'

# 2. Poll until a message with "role": "kaal" arrives
curl -s ${base}/v1/consultations/<id> \\
  -H "Authorization: Bearer $KAALERA_API_KEY"`;
}

/* ---------- shared ---------- */

async function copy(text: string, btn: HTMLElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  const label = btn.textContent;
  btn.textContent = 'Copied';
  window.setTimeout(() => { btn.textContent = label === 'Copied' ? 'Copy' : label; }, 1500);
}

document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const copyId = t.closest<HTMLElement>('[data-copy]')?.dataset.copy;
  if (copyId) void copy($(copyId).textContent ?? '', t);
  if (t.closest('[data-close]')) t.closest('dialog')?.close();
});

void boot();
