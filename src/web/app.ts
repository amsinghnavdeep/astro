import { confirmPurchase } from './consent.js';
import { authorizedMonthlyPrice, authorizedPrice, planCouponConsent, taxFeeNote } from '../disclaimer.js';
import { renderMarkdown } from '../markdown.js';
import { isPdfRequest, markDates, openReport, parseAnswer } from './extras.js';
import { saveBilling, type BillingInfo } from './billing.js';
import type { Currency } from '../currency.js';

type Status = 'awaiting_payment' | 'starting' | 'active' | 'failed';
type Thread = {
  id: string; fullName: string; gender: string; dateOfBirth: string; timeOfBirth: string; placeOfBirth: string;
  language: string; status: Status; isFree: boolean; questionsLeft: number; questionsAllowed: number;
  expired: boolean; expiresAt: string | null; createdAt: string; kundliId: string | null; quickLeft?: number;
};
type Msg = { id: string; role: 'user' | 'pandit'; body: string; createdAt: string };
type Deal = { id?: string; name: string; percent: number; endsOn: string };
type Plan = { id: 'basic' | 'plus' | 'pro'; name: string; cents: number; consultations: number };
type SubscriptionState = {
  plan: Plan['id']; planName: string; status: string; priceCents: number;
  consultations: number; consultsLeft: number; trialEnd: string | null; renewsAt: string | null;
  pauseStartsAt: string | null;
  pausedUntil: string | null; cancelAtPeriodEnd: boolean; pendingPlan: Plan['id'] | null;
};
type SubscriptionData = {
  enabled: boolean; phoneEnabled: boolean; phoneVerified: boolean; phone: string | null;
  phoneSaved: boolean;
  trialEligible: boolean; trialDays: number; trialConsults: number; taxFeePercent: number; currency: Currency; plans: Plan[]; subscription: SubscriptionState | null;
};
type Pricing = { quickWords?: number; freeQuestions: number; packQuestions: number; packCents: number; consultationDays: number; currency: Currency; taxFeePercent: number; extraQuestionCents: number; deal?: Deal | null; business?: boolean; fullPackCents?: number; plans?: Plan[] };
type Me = { walletCents?: number | null; user: { name: string; email: string; accountType?: string; businessName?: string | null }; freeAvailable: boolean; chatCredits: { credits: number; expiresAt: string }[]; pricing: Pricing; languages: string[]; maxChars: number; billing?: BillingInfo };
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
let quickMode = false;
const lenButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-len]'));
for (const b of lenButtons) b.addEventListener('click', () => {
  quickMode = b.dataset.len === 'quick';
  for (const x of lenButtons) x.setAttribute('aria-pressed', String(x === b));
  renderState();
});
const askError = $('ask-error');
const statePanel = $('state-panel');
const banner = $('banner');
const langSelect = $<HTMLSelectElement>('lang-select');
const PENDING_Q = 'kaalera:pendingQuestion';
const STEPS = ['Casting your Kundli…', 'Reading the planets and houses…', 'Checking your dashas and transits…', "Writing Kaal's answer…"];

let me: Me | null = null;
let subscriptionInfo: SubscriptionData | null = null;
let subscriptionThreadId: string | null = null;
let overageThreadId: string | null = null;
let selectedPlanId: Plan['id'] = 'basic';
let couponPreviewCode = '';
let couponPreviewMonths = 0;
let couponPreviewSequence = 0;
let couponPreviewTimer: number | undefined;
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
  new Intl.NumberFormat(currency === 'inr' ? 'en-IN' : 'en-US', { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
const planAllowance = (sub: SubscriptionState) =>
  sub.status === 'trialing' ? subscriptionInfo?.trialConsults ?? sub.consultations : sub.consultations;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const pauseScheduleText = (startsAt: string | null, returnsAt: string | null) => {
  if (!startsAt || !returnsAt) return '';
  const start = new Date(startsAt).toLocaleDateString();
  const end = new Date(returnsAt).toLocaleDateString();
  return Date.parse(startsAt) <= Date.now()
    ? `Pause started on ${start}; your plan comes back on ${end}.`
    : `Pause starts on ${start}; your plan comes back on ${end}.`;
};
const RELOAD = 2;
const packLabel = (p: Pricing) => `Add ${RELOAD} questions — ${money(p.extraQuestionCents * RELOAD, p.currency)}${taxFeeNote(p.taxFeePercent)}`;

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

/** Business accounts pay chat from the wallet at pre-fee prices (taxes & fees were paid at top-up). */
const walletCovers = (cents: number): boolean => me?.user.accountType === 'business' && (me.walletCents ?? 0) >= cents;

const credTotal = (): number => (me?.chatCredits ?? []).reduce((n, l) => n + l.credits, 0);

async function goToCheckout(threadId: string, btn?: HTMLButtonElement, cents = me!.pricing.packCents): Promise<void> {
  if (!walletCovers(cents) && !(await confirmPurchase('chat', authorizedPrice(cents, me!.pricing.taxFeePercent, me!.pricing.currency), chatPrices()))) return;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Opening checkout…';
  }
  const { ok, data } = await api<{ checkoutUrl: string; paid?: boolean }>(`/api/threads/${encodeURIComponent(threadId)}/checkout`, { method: 'POST', body: JSON.stringify({ agreed: true }) });
  if (ok && data.paid) {
    location.href = `/?t=${encodeURIComponent(threadId)}`;
    return;
  }
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
  if (t.closest('[data-open-app]')) void enterApp();
  if (t.closest('#app-view a.brand')) { e.preventDefault(); showHome(); }
  if (t.closest('[data-close]')) (t.closest('dialog') as HTMLDialogElement | null)?.close();
  const add = t.closest<HTMLButtonElement>('[data-addq]');
  if (add && current) goToCheckout(current.id, add, me!.pricing.extraQuestionCents * RELOAD);
});

/* ---------- landing + sign-in ---------- */

function priceCard(name: string, amt: string, note: string): HTMLElement {
  const d = el('div', 'l-card price');
  d.append(el('h3', '', name), el('div', 'price-amt', amt), el('p', 'muted', note));
  return d;
}

function renderBiz(): void {
  const b = $<HTMLButtonElement>('biz-toggle');
  const name = me?.user.accountType === 'business' ? me.user.businessName : null;
  b.textContent = name ? `Business wallet: ${money(me?.walletCents ?? 0, me!.pricing.currency)}` : 'Switch to Business (10% off)';
  b.title = name ?? '';
  b.disabled = !!name;
}

function renderSubscriptionMenu(): void {
  const button = $<HTMLButtonElement>('account-plan');
  const cancel = $<HTMLButtonElement>('account-cancel');
  const resume = $<HTMLButtonElement>('account-resume');
  if (!me || me.user.accountType === 'business' || !subscriptionInfo?.enabled) {
    button.hidden = true;
    cancel.hidden = true;
    resume.hidden = true;
    return;
  }
  button.hidden = false;
  const sub = subscriptionInfo.subscription;
  if (!sub) {
    $('account-plan-label').textContent = 'Plan · Choose a plan';
    $('account-plan-detail').textContent = '';
    cancel.hidden = true;
    resume.hidden = true;
    return;
  }
  $('account-plan-label').textContent = `Plan · ${sub.planName}`;
  const pauseSchedule = pauseScheduleText(sub.pauseStartsAt, sub.pausedUntil);
  const until = pauseSchedule
    ? pauseSchedule
    : sub.cancelAtPeriodEnd && sub.renewsAt
      ? `Ends ${new Date(sub.renewsAt).toLocaleDateString()}`
    : sub.trialEnd && sub.status === 'trialing'
      ? `Trial ends ${new Date(sub.trialEnd).toLocaleDateString()}`
      : sub.renewsAt ? `Renews ${new Date(sub.renewsAt).toLocaleDateString()}` : sub.status;
  const pending = sub.pendingPlan && sub.renewsAt
    ? ` · Changes to ${sub.pendingPlan[0].toUpperCase()}${sub.pendingPlan.slice(1)} ${new Date(sub.renewsAt).toLocaleDateString()}`
    : '';
  $('account-plan-detail').textContent = `${sub.consultsLeft} of ${planAllowance(sub)} consultations left · ${until}${pending}`;
  const hasPlan = ['active', 'trialing', 'paused', 'past_due'].includes(sub.status);
  const pauseScheduled = !!(sub.pauseStartsAt && sub.pausedUntil);
  cancel.hidden = !hasPlan || sub.cancelAtPeriodEnd;
  resume.hidden = !hasPlan || !(sub.cancelAtPeriodEnd || sub.status === 'paused' || pauseScheduled);
  resume.textContent = sub.cancelAtPeriodEnd ? 'Resume plan' : 'Resume now';
}

async function refreshSubscription(): Promise<SubscriptionData | null> {
  if (!me || me.user.accountType === 'business') {
    subscriptionInfo = null;
    renderSubscriptionMenu();
    return null;
  }
  const { ok, data } = await api<SubscriptionData>('/api/subscription');
  if (ok) {
    subscriptionInfo = data;
    renderSubscriptionMenu();
  }
  return ok ? data : null;
}

$('biz-toggle').addEventListener('click', () => {
  $('biz-error').textContent = '';
  closeMenu();
  $<HTMLDialogElement>('biz-modal').showModal();
});

$<HTMLFormElement>('biz-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $<HTMLButtonElement>('biz-submit');
  btn.disabled = true;
  const businessName = $<HTMLInputElement>('biz-name').value.trim();
  const r = await api<{ ok: boolean }>('/api/account/business', {
    method: 'POST', body: JSON.stringify({ businessName, taxId: $<HTMLInputElement>('biz-tax').value.trim() }),
  });
  btn.disabled = false;
  if (!r.ok) {
    $('biz-error').textContent = (r.data as { error?: string }).error ?? 'Could not switch. Please try again.';
    return;
  }
  const pay = await api<{ checkoutUrl?: string; message?: string; error?: string }>('/api/developer/checkout', {
    method: 'POST', body: JSON.stringify({ packId: 'usd100', agreed: true, returnTo: 'app' }),
  });
  if (pay.ok && pay.data.checkoutUrl) {
    location.href = pay.data.checkoutUrl;
    return;
  }
  $('biz-error').textContent = pay.data.message ?? pay.data.error ?? 'Could not open checkout. Please try again.';
});

function showDeal(p: Pricing): void {
  const d = p.deal;
  const ends = d?.endsOn ? new Date(`${d.endsOn}T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', timeZone: 'UTC' }) : '';
  document.querySelectorAll<HTMLElement>('.deal-bar').forEach((b) => {
    b.hidden = !d;
    b.textContent = d?.id?.startsWith('coupon:') ? `${d.name}: ${d.percent}% off your next purchase${ends ? ` (until ${ends})` : ''}.` : d ? `${d.name} offer: ${d.percent}% off every consultation and question until ${ends}.` : '';
  });
}

const SHARE_SNOOZE_MS = 3 * 86_400_000;
let shareShown = false;
let shareThreadId = '';

/** Corner card asking to share a referral or influencer link: once per visit, 3-day snooze after closing, never while busy. */
async function maybeShare(kind: 'customer' | 'influencer'): Promise<void> {
  const key = `kaalera:share:${kind}`;
  if (shareShown || Date.now() - Number(localStorage.getItem(key) || 0) < SHARE_SNOOZE_MS) return;
  if (sending || !working.hidden || appView.hidden || askInput.value.trim()) return;
  const { ok, data } = await api<{ referral: { link: string }; influencer: { link: string; status: string; percent: number } | null }>('/api/partner');
  if (!ok || shareShown) return;
  const inf = data.influencer?.status === 'active' ? data.influencer : null;
  if (kind === 'influencer' && !inf) return;
  shareShown = true;
  const link = inf ? inf.link : data.referral.link;
  const text = inf ? 'Ask Kaal, the AI astrologer. Use my link for 2 free questions:' : 'Ask Kaal, the AI astrologer. You get 2 free questions with my link:';
  const card = el('div', 'share-pop');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Share Kaalera');
  const close = el('button', 'x', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  const snooze = () => { localStorage.setItem(key, String(Date.now())); card.remove(); };
  close.addEventListener('click', snooze);
  const wa = el('a', 'btn-s primary', 'WhatsApp');
  wa.href = `https://wa.me/?text=${encodeURIComponent(`${text} ${link}`)}`;
  wa.target = '_blank';
  wa.rel = 'noopener';
  wa.addEventListener('click', snooze);
  const more = el('button', 'btn-s', 'Share…');
  more.type = 'button';
  more.addEventListener('click', async () => {
    if (navigator.share) await navigator.share({ text, url: link }).then(snooze, () => undefined);
    else { await navigator.clipboard.writeText(link); more.textContent = 'Copied'; }
  });
  const copy = el('button', 'btn-s', 'Copy link');
  copy.type = 'button';
  copy.addEventListener('click', async () => { await navigator.clipboard.writeText(link); copy.textContent = 'Copied'; });
  const row = el('div', 'row');
  row.append(wa, more, copy);
  card.append(close, el('h4', '', inf ? 'Share your link today' : 'Share Kaal with a friend'),
    el('p', '', inf ? `Everyone who signs up through your link counts under you, and you earn ${inf.percent}% of their first paid consultation.`
      : 'Your friend gets 2 free questions. You get 2 more when they first pay.'), row);
  document.body.append(card);
}

async function renderPrices(): Promise<void> {
  const { ok, data } = await api<Pricing>('/api/plans');
  if (!ok) return;
  const p = data;
  showDeal(p);
  const isBusiness = me?.user.accountType === 'business';
  document.querySelectorAll<HTMLElement>('.personal-offer').forEach((n) => { n.hidden = isBusiness; });
  $('pricing-subtitle').textContent = isBusiness
    ? 'Pay for consultations from your Business wallet.'
    : 'Choose a monthly plan or pay for a consultation only.';
  const subscriptionCards = !isBusiness ? (p.plans ?? []).map((plan) =>
    priceCard(plan.name, `${money(plan.cents, p.currency)}/month`, `${plan.consultations} consultations each month${p.taxFeePercent ? ' + taxes & fees' : ''}.`),
  ) : [];
  $('l-prices').replaceChildren(
    ...(isBusiness ? [priceCard('Pay per consultation', money(p.packCents, p.currency),
      `Start a consultation and pay for additional help only if needed${p.taxFeePercent ? '. Plus taxes & fees' : ''}.`)] : subscriptionCards),
  );
}

const subscriptionModal = $<HTMLDialogElement>('subscription-modal');

function updatePlanChoice(): void {
  if (!subscriptionInfo) return;
  const plan = subscriptionInfo.plans.find((item) => item.id === selectedPlanId) ?? subscriptionInfo.plans[0];
  if (!plan) return;
  document.querySelectorAll<HTMLButtonElement>('[data-plan-id]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.planId === plan.id));
  });
  const code = $<HTMLInputElement>('subscription-coupon-input').value.trim().toUpperCase();
  const submit = $<HTMLButtonElement>('subscription-submit');
  const agreed = $<HTMLInputElement>('subscription-agreed');
  if (code) {
    $('subscription-trial-badge').hidden = true;
    submit.textContent = 'Start free with code';
    submit.disabled = couponPreviewCode !== code || couponPreviewMonths < 1;
    agreed.disabled = couponPreviewCode !== code || couponPreviewMonths < 1;
    $('subscription-consent-copy').textContent = couponPreviewCode === code && couponPreviewMonths > 0
      ? planCouponConsent({
        code, months: couponPreviewMonths, planName: plan.name, monthlyCents: plan.cents,
        taxFeePercent: subscriptionInfo.taxFeePercent, currency: subscriptionInfo.currency,
      })
      : 'I agree to the Terms. Check your code to see the free months and plan price.';
    return;
  }
  $('subscription-trial-badge').hidden = !subscriptionInfo.trialEligible;
  submit.disabled = false;
  agreed.disabled = false;
  submit.textContent = subscriptionInfo.trialEligible
    ? `Start ${subscriptionInfo.trialDays}-day free trial` : 'Subscribe';
  $('subscription-consent-copy').textContent = subscriptionInfo.trialEligible
    ? `I agree to the Terms and authorize ${authorizedMonthlyPrice(plan.cents, subscriptionInfo.taxFeePercent, subscriptionInfo.currency)} after my ${subscriptionInfo.trialDays}-day free trial. Cancel anytime from my account.`
    : `I agree to the Terms and authorize ${authorizedMonthlyPrice(plan.cents, subscriptionInfo.taxFeePercent, subscriptionInfo.currency)} starting today. Cancel anytime from my account.`;
}

async function openSubscriptionPlans(threadId: string | null = null): Promise<void> {
  const data = await refreshSubscription();
  if (!data?.enabled) return;
  subscriptionThreadId = threadId;
  $('subscription-choose').hidden = false;
  $('subscription-manage').hidden = true;
  $('subscription-error').textContent = '';
  $<HTMLInputElement>('subscription-agreed').checked = false;
  $<HTMLInputElement>('subscription-coupon-input').value = '';
  $('subscription-coupon-entry').hidden = true;
  $('subscription-coupon-toggle').textContent = 'Have a code?';
  couponPreviewSequence += 1;
  couponPreviewCode = '';
  couponPreviewMonths = 0;
  if (couponPreviewTimer !== undefined) window.clearTimeout(couponPreviewTimer);
  $('subscription-pay-only').hidden = !threadId;
  const phoneInput = $<HTMLInputElement>('subscription-phone-input');
  phoneInput.value = data.phone ?? '';
  phoneInput.placeholder = data.phoneEnabled ? '+14155550123' : '+91 98765 43210';
  $('subscription-phone').hidden = data.phoneEnabled ? data.phoneVerified : data.phoneSaved;
  $('subscription-phone-title').textContent = data.phoneEnabled ? 'Verify your phone' : 'Your mobile number';
  $('subscription-phone-hint').textContent = data.phoneEnabled
    ? 'Phone verification is required to start a plan.'
    : 'Include your country code, e.g. +91 98765 43210. One free trial per number.';
  $('subscription-phone-label').textContent = data.phoneEnabled ? 'Phone number' : 'Mobile number';
  $('subscription-phone-send').hidden = !data.phoneEnabled;
  if (!data.phoneEnabled) $('subscription-code-row').hidden = true;
  $('subscription-trial-badge').hidden = !data.trialEligible;
  $('subscription-trial-badge').textContent = data.trialEligible
    ? `${data.trialDays} days free · ${data.trialConsults} consultations · cancel anytime` : '';
  selectedPlanId = data.plans[0]?.id ?? 'basic';
  $('subscription-cards').replaceChildren(...data.plans.map((plan) => {
    const card = el('button', 'plan-card');
    card.type = 'button';
    card.dataset.planId = plan.id;
    card.setAttribute('aria-pressed', String(plan.id === selectedPlanId));
    card.append(
      el('strong', '', plan.name),
      el('span', 'plan-card-price', `${money(plan.cents, data.currency)}/month`),
      el('span', 'plan-card-consults', `${plan.consultations} consultations`),
      ...(data.taxFeePercent > 0 ? [el('span', 'plan-card-fee', '+ taxes & fees')] : []),
    );
    card.addEventListener('click', () => {
      if ($<HTMLInputElement>('subscription-coupon-input').value.trim()) $<HTMLInputElement>('subscription-agreed').checked = false;
      selectedPlanId = plan.id;
      updatePlanChoice();
    });
    return card;
  }));
  updatePlanChoice();
  if (!subscriptionModal.open) subscriptionModal.showModal();
}

$('subscription-coupon-toggle').addEventListener('click', () => {
  const entry = $('subscription-coupon-entry');
  entry.hidden = !entry.hidden;
  $('subscription-coupon-toggle').textContent = entry.hidden ? 'Have a code?' : 'Hide code';
  if (entry.hidden) {
    $<HTMLInputElement>('subscription-coupon-input').value = '';
    $<HTMLInputElement>('subscription-agreed').checked = false;
    couponPreviewSequence += 1;
    couponPreviewCode = '';
    couponPreviewMonths = 0;
    $('subscription-error').textContent = '';
    updatePlanChoice();
  } else {
    $<HTMLInputElement>('subscription-coupon-input').focus();
  }
});

$<HTMLInputElement>('subscription-coupon-input').addEventListener('input', () => {
  const input = $<HTMLInputElement>('subscription-coupon-input');
  const code = input.value.trim().toUpperCase();
  const sequence = ++couponPreviewSequence;
  $<HTMLInputElement>('subscription-agreed').checked = false;
  couponPreviewCode = '';
  couponPreviewMonths = 0;
  $('subscription-error').textContent = '';
  if (couponPreviewTimer !== undefined) window.clearTimeout(couponPreviewTimer);
  updatePlanChoice();
  if (code.length < 3) return;
  couponPreviewTimer = window.setTimeout(async () => {
    const { ok, data } = await api<{ months?: number; error?: string }>(`/api/plan-coupon?code=${encodeURIComponent(code)}`);
    if (sequence !== couponPreviewSequence || input.value.trim().toUpperCase() !== code) return;
    if (ok && data.months) {
      couponPreviewCode = code;
      couponPreviewMonths = data.months;
    } else {
      $('subscription-error').textContent = data.error ?? 'This code is not valid.';
    }
    updatePlanChoice();
  }, 250);
});

async function openSubscriptionManage(): Promise<void> {
  const data = await refreshSubscription();
  const sub = data?.subscription;
  if (!data?.enabled) return;
  if (!sub || !['active', 'trialing', 'paused', 'past_due'].includes(sub.status)) {
    await openSubscriptionPlans();
    return;
  }
  $('subscription-choose').hidden = true;
  $('subscription-manage').hidden = false;
  $('subscription-manage-error').textContent = '';
  $('subscription-manage-summary').textContent =
    `You have ${sub.consultsLeft} consultations left this month. Your ${sub.planName} plan is ${money(sub.priceCents, data.currency)}/month${taxFeeNote(data.taxFeePercent)}.`;
  const pauseSchedule = pauseScheduleText(sub.pauseStartsAt, sub.pausedUntil);
  $('subscription-manage-date').textContent = pauseSchedule
    ? pauseSchedule
    : sub.cancelAtPeriodEnd && sub.renewsAt
      ? `Your plan stays active until ${new Date(sub.renewsAt).toLocaleDateString()}.`
      : sub.pendingPlan && sub.renewsAt
        ? `Your plan will switch to ${sub.pendingPlan[0].toUpperCase()}${sub.pendingPlan.slice(1)} on ${new Date(sub.renewsAt).toLocaleDateString()}.`
      : sub.renewsAt ? `Renews ${new Date(sub.renewsAt).toLocaleDateString()}.` : '';
  $('subscription-pause').hidden = sub.status !== 'active' || !!sub.pauseStartsAt || sub.cancelAtPeriodEnd;
  $('subscription-basic').hidden = sub.plan === 'basic' || !!sub.pendingPlan || !['active', 'trialing'].includes(sub.status) || sub.cancelAtPeriodEnd;
  $('subscription-cancel').hidden = sub.cancelAtPeriodEnd;
  $('subscription-resume').hidden = !(sub.cancelAtPeriodEnd || sub.status === 'paused' || !!sub.pauseStartsAt);
  $('subscription-resume').textContent = sub.cancelAtPeriodEnd ? 'Resume plan' : 'Resume now';
  const note = $<HTMLInputElement>('cancel-note');
  note.value = '';
  note.hidden = true;
  document.querySelectorAll<HTMLInputElement>('input[name="cancel-reason"]').forEach((input) => { input.checked = false; });
  if (!subscriptionModal.open) subscriptionModal.showModal();
}

const cancellationDetails = () => ({
  reason: document.querySelector<HTMLInputElement>('input[name="cancel-reason"]:checked')?.value,
  note: $<HTMLInputElement>('cancel-note').value.trim() || undefined,
});

async function subscriptionAction(action: 'pause' | 'basic'): Promise<void> {
  const error = $('subscription-manage-error');
  error.textContent = '';
  const { ok, data } = await api<{ pauseStartsAt?: string; pausedUntil?: string; switchedTo?: string; renewsAt?: string; error?: string }>('/api/subscription/manage', {
    method: 'POST', body: JSON.stringify({ action, ...cancellationDetails() }),
  });
  if (!ok) { error.textContent = data.error ?? 'Could not update your plan.'; return; }
  await refreshSubscription();
  if (action === 'pause' && data.pauseStartsAt && data.pausedUntil) {
    $('subscription-manage-date').textContent = pauseScheduleText(data.pauseStartsAt, data.pausedUntil);
  }
  if (action === 'basic' && data.renewsAt) $('subscription-manage-date').textContent = `Your plan will switch to Basic on ${new Date(data.renewsAt).toLocaleDateString()}.`;
  await openSubscriptionManage();
}

$('account-plan').addEventListener('click', () => {
  closeMenu();
  void openSubscriptionManage();
});
$('account-cancel').addEventListener('click', () => {
  closeMenu();
  void openSubscriptionManage();
});

async function resumeSubscription(): Promise<void> {
  const { ok, data } = await api<{ error?: string }>('/api/subscription/resume', { method: 'POST', body: '{}' });
  if (!ok) { showBanner(data.error ?? 'Could not resume your plan.'); return; }
  await refreshSubscription();
  showBanner('Your plan is active again.', 6000);
  if (subscriptionModal.open) await openSubscriptionManage();
}
$('account-resume').addEventListener('click', () => { closeMenu(); void resumeSubscription(); });
$('subscription-resume').addEventListener('click', () => { void resumeSubscription(); });
$('subscription-pause').addEventListener('click', () => { void subscriptionAction('pause'); });
$('subscription-basic').addEventListener('click', () => { void subscriptionAction('basic'); });

$('subscription-cancel').addEventListener('click', async () => {
  const end = subscriptionInfo?.subscription?.renewsAt;
  const date = end ? new Date(end).toLocaleDateString() : 'the end of this billing period';
  if (!window.confirm(`Cancel your subscription? Your plan stays active until ${date}.`)) return;
  const { ok, data } = await api<{ canceledAt?: string; error?: string }>('/api/subscription/cancel', {
    method: 'POST', body: JSON.stringify(cancellationDetails()),
  });
  if (!ok) { $('subscription-manage-error').textContent = data.error ?? 'Could not cancel your plan.'; return; }
  await refreshSubscription();
  $('subscription-manage-date').textContent = `Your plan stays active until ${date}.`;
  showBanner(`Your plan stays active until ${date}.`, 7000);
  await openSubscriptionManage();
});

document.querySelectorAll<HTMLInputElement>('input[name="cancel-reason"]').forEach((input) => {
  input.addEventListener('change', () => {
    $<HTMLInputElement>('cancel-note').hidden = document.querySelector<HTMLInputElement>('input[name="cancel-reason"]:checked')?.value !== 'other';
  });
});

$('subscription-phone-send').addEventListener('click', async () => {
  const error = $('subscription-phone-error');
  error.textContent = '';
  const phone = $<HTMLInputElement>('subscription-phone-input').value.trim();
  const { ok, data } = await api<{ sent?: boolean; error?: string }>('/api/phone/start', {
    method: 'POST', body: JSON.stringify({ phone }),
  });
  if (!ok) { error.textContent = data.error ?? 'Could not send a verification code.'; return; }
  $('subscription-code-row').hidden = false;
  error.textContent = 'Code sent.';
});
$('subscription-phone-check').addEventListener('click', async () => {
  const error = $('subscription-phone-error');
  error.textContent = '';
  const { ok, data } = await api<{ verified?: boolean; error?: string }>('/api/phone/check', {
    method: 'POST',
    body: JSON.stringify({
      phone: $<HTMLInputElement>('subscription-phone-input').value.trim(),
      code: $<HTMLInputElement>('subscription-phone-code').value.trim(),
    }),
  });
  if (!ok) { error.textContent = data.error ?? 'Could not verify your phone.'; return; }
  const fresh = await refreshSubscription();
  $('subscription-phone').hidden = !!fresh?.phoneVerified;
  error.textContent = fresh?.phoneVerified ? 'Phone verified.' : '';
});

$('subscription-submit').addEventListener('click', async () => {
  const error = $('subscription-error');
  error.textContent = '';
  if (!$<HTMLInputElement>('subscription-agreed').checked) {
    error.textContent = 'Please accept the subscription terms to continue.';
    return;
  }
  if (subscriptionInfo?.phoneEnabled && !subscriptionInfo.phoneVerified) {
    error.textContent = 'Verify your phone number before subscribing.';
    return;
  }
  let phone: string | undefined;
  if (subscriptionInfo && !subscriptionInfo.phoneEnabled && !subscriptionInfo.phoneSaved) {
    phone = $<HTMLInputElement>('subscription-phone-input').value.replace(/[ \-().]/g, '');
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      error.textContent = 'Enter your mobile number with country code.';
      return;
    }
  }
  const coupon = $<HTMLInputElement>('subscription-coupon-input').value.trim().toUpperCase();
  if (coupon && (couponPreviewCode !== coupon || couponPreviewMonths < 1)) {
    error.textContent = 'Check your plan code before continuing.';
    return;
  }
  const button = $<HTMLButtonElement>('subscription-submit');
  button.disabled = true;
  const { ok, data } = await api<{ checkoutUrl?: string; error?: string }>('/api/subscribe', {
    method: 'POST',
    body: JSON.stringify({ plan: selectedPlanId, threadId: subscriptionThreadId ?? undefined, agreed: true, phone, coupon: coupon || undefined }),
  });
  button.disabled = !!coupon && (couponPreviewCode !== coupon || couponPreviewMonths < 1);
  if (!ok || !data.checkoutUrl) { error.textContent = data.error ?? 'Could not open checkout.'; return; }
  location.href = data.checkoutUrl;
});

$('subscription-pay-only').addEventListener('click', () => {
  if (!subscriptionThreadId) return;
  const threadId = subscriptionThreadId;
  subscriptionModal.close();
  void goToCheckout(threadId);
});

$('overage-cancel').addEventListener('click', () => $<HTMLDialogElement>('plan-used-up-modal').close());
$('overage-continue').addEventListener('click', () => {
  const id = overageThreadId;
  $<HTMLDialogElement>('plan-used-up-modal').close();
  if (id) void goToCheckout(id);
});

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
  if (me) void enterApp();
  else openSignin();
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

const loginEmail = $<HTMLFormElement>('login-form').querySelector<HTMLInputElement>('input[name=email]')!;
let lastLead = '';
loginEmail.addEventListener('blur', () => {
  const email = loginEmail.value.trim().toLowerCase();
  if (email === lastLead || !loginEmail.checkValidity() || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return;
  lastLead = email;
  const optin = $<HTMLFormElement>('login-form').querySelector<HTMLInputElement>('input[name=optin]')?.checked ?? false;
  void fetch('/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, optin }), keepalive: true }).catch(() => undefined);
});

const BIZ_SIGNUP = 'kaalera_biz_signup';
$<HTMLFormElement>('login-form').addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.name === 'acct') $('acct-biz-note').hidden = t.value !== 'business';
});

$<HTMLFormElement>('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const btn = $<HTMLButtonElement>('login-submit');
  const fd = new FormData(form);
  if (fd.get('acct') === 'business') localStorage.setItem(BIZ_SIGNUP, '1');
  else localStorage.removeItem(BIZ_SIGNUP);
  btn.disabled = true;
  const { ok, data } = await api<{ sent: boolean; devLink?: string }>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email: String(fd.get('email') ?? ''), name: String(fd.get('name') ?? '') || undefined, optin: fd.get('optin') === 'on' }),
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
  const sub = subscriptionInfo?.subscription;
  if (me!.user.accountType !== 'business' && credTotal() > 0) {
    const next = me!.chatCredits[0];
    note.innerHTML = '';
    note.append(el('strong', '', `${plural(credTotal(), 'consultation credit')} available.`),
      ` Your admin or coupon credit is used before your plan. Next expiry: ${new Date(next.expiresAt).toLocaleDateString()}.`);
    submit.textContent = 'Start consultation';
  } else if (me!.user.accountType !== 'business' && sub && ['active', 'trialing', 'paused'].includes(sub.status)) {
    note.innerHTML = '';
    note.append(el('strong', '', `${sub.consultsLeft} of ${planAllowance(sub)} consultations left on ${sub.planName}${sub.status === 'trialing' ? ' trial' : ''}.`),
      ` Each consultation includes ${p.packQuestions} ${p.packQuestions === 1 ? 'question' : 'questions'} and stays open for ${p.consultationDays} days.`);
    submit.textContent = 'Start consultation';
  } else if (me!.user.accountType !== 'business') {
    note.innerHTML = '';
    note.append(el('strong', '', 'Choose a monthly plan to start.'),
      ' Eligible Personal accounts get a 7-day free trial with 2 consultations. Pay per consultation is also available.');
    submit.textContent = 'Choose a plan';
  } else if (credTotal() > 0) {
    const next = me!.chatCredits[0];
    note.innerHTML = '';
    note.append(el('strong', '', `You have ${plural(credTotal(), 'question')} left.`),
      ` This consultation uses 1 now for the opening reading and your first answer. Open for ${p.consultationDays} days. Questions expire 3 months after purchase (next on ${new Date(next.expiresAt).toLocaleDateString()}).`);
    submit.textContent = 'Start consultation';
  } else if (walletCovers(p.packCents)) {
    note.innerHTML = '';
    note.append(el('strong', '', `${money(p.packCents, p.currency)} to start, paid from your Business wallet.`),
      ` An opening reading and the answer to your question, open for ${p.consultationDays} days. Extra questions come ${RELOAD} at a time for ${autoPrice()} from the wallet. Wallet balance: ${money(me!.walletCents ?? 0, p.currency)}.`);
    submit.textContent = `Start consultation — ${money(p.packCents, p.currency)} from wallet`;
  } else {
    note.innerHTML = '';
    note.append(el('strong', '', `${money(p.packCents, p.currency)}${taxFeeNote(p.taxFeePercent)} to start.`),
      ` An opening reading and the answer to your question, open for ${p.consultationDays} days. Extra questions come ${RELOAD} at a time for ${money(p.extraQuestionCents * RELOAD, p.currency)}${taxFeeNote(p.taxFeePercent)}. You'll pay securely by card.`);
    submit.textContent = `Continue to payment — ${money(p.packCents, p.currency)}${taxFeeNote(p.taxFeePercent)}`;
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
  const personal = me!.user.accountType !== 'business';
  const fromWallet = !personal && !me!.freeAvailable && credTotal() < 1 && walletCovers(me!.pricing.packCents);
  if (fromWallet) (body as Record<string, unknown>).agreed = true;
  else if (!personal && !me!.freeAvailable && credTotal() < 1) {
    if (!(await confirmPurchase('chat', authorizedPrice(me!.pricing.packCents, me!.pricing.taxFeePercent, me!.pricing.currency), chatPrices()))) return;
    (body as Record<string, unknown>).agreed = true;
  }
  const label = submit.textContent;
  submit.disabled = true;
  submit.textContent = personal || fromWallet || credTotal() > 0 ? 'Starting consultation…' : 'Opening checkout…';
  const { ok, status, data } = await api<{
    thread?: Thread; checkoutUrl?: string; plansRequired?: boolean; trialEligible?: boolean;
    code?: string; error?: string;
  }>('/api/threads', { method: 'POST', body: JSON.stringify(body) });
  if (data.checkoutUrl) {
    sessionStorage.removeItem(PENDING_Q);
    location.href = data.checkoutUrl;
    return;
  }
  submit.disabled = false;
  submit.textContent = label;
  if (data.plansRequired && data.thread) {
    upsertThread(data.thread);
    void openSubscriptionPlans(data.thread.id);
    return;
  }
  if (data.code === 'plan_used_up' && data.thread) {
    upsertThread(data.thread);
    void refreshSubscription();
    overageThreadId = data.thread.id;
    $<HTMLDialogElement>('plan-used-up-modal').showModal();
    return;
  }
  if (data.code === 'plan_paused' && data.thread) {
    upsertThread(data.thread);
    showBanner('Your plan is paused. Resume it to use your remaining consultations.');
    void openSubscriptionManage();
    return;
  }
  if (data.thread) {
    sessionStorage.removeItem(PENDING_Q);
    profileForm.reset();
    me!.freeAvailable = me!.freeAvailable && !data.thread.isFree;
    void refreshSubscription();
    void fetch('/api/me').then((r) => (r.ok ? r.json() : null)).then((m: Me | null) => { if (m) { me!.chatCredits = m.chatCredits; me!.walletCents = m.walletCents; renderBiz(); } });
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
  loadCard(t);
  loadReminders(t);
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
  const parsed = parseAnswer(m.body);
  if (parsed.timeline.length) {
    const tl = el('div', 'k-timeline');
    tl.setAttribute('aria-label', 'Prediction timeline');
    for (const p of parsed.timeline) {
      const item = el('div', 'k-tl-item');
      item.append(el('span', 'k-tl-dot', TL_GLYPH[p.kind] ?? '✦'), el('span', 'k-tl-area', p.area), el('span', 'k-tl-when', p.when), remindButton(p.area, p.when));
      tl.append(item);
    }
    div.append(who, tl);
  } else div.append(who);
  body.innerHTML = renderMarkdown(parsed.main);
  markDates(body);
  div.append(body);
  if (parsed.next.length) {
    const next = el('div', 'k-next');
    next.append(el('span', 'k-next-title', 'Ask Kaal next'));
    for (const q of parsed.next) {
      const chip = el('button', 'k-chip', q) as HTMLButtonElement;
      chip.type = 'button';
      chip.addEventListener('click', () => {
        askInput.value = q;
        autosize();
        askInput.focus();
      });
      next.append(chip);
    }
    div.append(next);
  }
  return div;
}

let reminders: { threadId: string; keys: Set<string> } | null = null;
const remKey = (area: string, when: string) => `${area}|${when}`;

function loadReminders(t: Thread): void {
  if (reminders?.threadId === t.id) return;
  reminders = { threadId: t.id, keys: new Set() };
  void api<{ reminders: { area: string; when: string }[] }>(`/api/threads/${encodeURIComponent(t.id)}/reminders`).then(({ ok, data }) => {
    if (!ok || reminders?.threadId !== t.id) return;
    reminders.keys = new Set(data.reminders.map((r) => remKey(r.area, r.when)));
    renderedKey = '';
    renderMessages(lastMsgs);
  });
}

function remindButton(area: string, when: string): HTMLElement {
  const set = reminders?.keys.has(remKey(area, when));
  const b = el('button', `k-tl-remind${set ? ' on' : ''}`, set ? '🔔 Reminder set' : '🔔 Remind me') as HTMLButtonElement;
  b.type = 'button';
  b.disabled = !!set;
  b.title = 'Email me when this window starts';
  b.addEventListener('click', async () => {
    if (!current) return;
    b.disabled = true;
    b.textContent = 'Saving…';
    const { ok, data } = await api<{ remindOn?: string; error?: string }>(`/api/threads/${encodeURIComponent(current.id)}/reminders`, {
      method: 'POST', body: JSON.stringify({ area, when }),
    });
    if (ok && data.remindOn) {
      reminders?.keys.add(remKey(area, when));
      b.classList.add('on');
      b.textContent = '🔔 Reminder set';
      showBanner(`We'll email you on ${fmtDate(data.remindOn)} when this window starts.`, 4000);
    } else {
      b.disabled = false;
      b.textContent = '🔔 Remind me';
      showBanner(data.error ?? 'Could not set the reminder.', 4000);
    }
  });
  return b;
}

const TL_GLYPH: Record<string, string> = { career: '▲', love: '♥', money: '◆', health: '✚', travel: '✈', family: '●', star: '✦' };

function pdfReply(t: Thread): HTMLElement {
  const div = el('div', 'msg kaal');
  const who = el('div', 'who');
  who.append(el('span', 'avatar kaal-av', 'K'), el('span', '', 'Kaal'));
  const body = el('div', 'body', 'Here is your reading as a PDF. Tap the button, then choose "Save as PDF".');
  const b = el('button', 'btn primary k-pdf', 'Download PDF') as HTMLButtonElement;
  b.type = 'button';
  b.addEventListener('click', () => openReport({
    name: t.fullName,
    birth: `${t.dateOfBirth}, ${t.timeOfBirth}, ${t.placeOfBirth}`,
    msgs: lastMsgs.map((m) => ({ role: m.role, body: m.body, createdAt: m.createdAt })),
  }));
  div.append(who, body, b);
  return div;
}

const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140;

type KundliCard = {
  ascendant: { sign: string; degree: number }; moonSign: string; sunSign: string;
  birthStar: { name: string; pada: number } | null;
  period: { maha: string; mahaEnd: string; sub: string | null; subEnd: string | null } | null;
};
let card: { threadId: string; data: KundliCard } | null = null;
const monthYear = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

function loadCard(t: Thread): void {
  if (card?.threadId === t.id) return;
  card = null;
  void api<KundliCard>(`/api/threads/${encodeURIComponent(t.id)}/card`).then(({ ok, data }) => {
    if (!ok || current?.id !== t.id) return;
    card = { threadId: t.id, data };
    renderedKey = '';
    renderMessages(lastMsgs);
  });
}

function cardNode(t: Thread, d: KundliCard): HTMLElement {
  const box = el('div', 'k-card');
  box.setAttribute('aria-label', 'Your exact Kundli');
  box.append(el('div', 'k-card-title', `${t.fullName}'s exact Kundli`));
  const grid = el('div', 'k-card-grid');
  const cell = (label: string, value: string, sub?: string) => {
    const c = el('div', 'k-card-cell');
    c.append(el('span', 'k-card-label', label), el('span', 'k-card-value', value));
    if (sub) c.append(el('span', 'k-card-sub', sub));
    grid.append(c);
  };
  cell('Ascendant (Lagna)', d.ascendant.sign, `${d.ascendant.degree}°`);
  cell('Moon sign (Rashi)', d.moonSign);
  if (d.birthStar) cell('Birth star (Nakshatra)', d.birthStar.name, `Pada ${d.birthStar.pada}`);
  cell('Sun sign', d.sunSign);
  if (d.period) {
    const p = d.period;
    cell('Current period (Dasha)', p.sub ? `${p.maha} – ${p.sub}` : p.maha, `until ${monthYear(p.subEnd ?? p.mahaEnd)}`);
  }
  box.append(grid, el('div', 'k-card-note', 'Calculated exactly for this birth date, time and place. Compare it with your family Kundli.'));
  return box;
}

const typed = new Set<string>();
let seen: { threadId: string; ids: Set<string> } | null = null;
let typingTimer = 0;
let typingQueue: string[] = [];
let typing: { id: string; done: number } | null = null;

/**
 * Reveals an answer word by word at reading pace, keeping the view pinned to the bottom.
 * Progress lives in `typing`, so a re-render resumes where it left off instead of jumping to the end.
 */
function typeOut(div: HTMLElement, state: { id: string; done: number }): void {
  const body = div.querySelector<HTMLElement>('.body');
  if (!body) return;
  type Step = { node: Text | null; words: string[]; block: HTMLElement };
  const steps: Step[] = [];
  for (const item of div.querySelectorAll<HTMLElement>('.k-tl-item')) {
    item.style.display = 'none';
    steps.push({ node: null, words: Array(6).fill(''), block: item });
  }
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    const block: HTMLElement = node.parentElement?.closest<HTMLElement>('p, li, h1, h2, h3, h4, blockquote, tr') ?? body;
    if (block !== body) block.style.display = 'none';
    steps.push({ node, words: node.data.match(/\S+\s*|\s+/g) ?? [], block });
    node.data = '';
  }
  let caretAt: HTMLElement | null = null;
  let i = 0;
  let w = 0;
  const advance = (): void => {
    const p = steps[i];
    if (p.block.style.display === 'none') p.block.style.display = '';
    if (p.node && caretAt !== p.block && p.block !== body) { caretAt?.classList.remove('k-caret'); caretAt = p.block; caretAt.classList.add('k-caret'); }
    if (w < p.words.length) { if (p.node) p.node.data += p.words[w]; w++; }
    if (w >= p.words.length) { i++; w = 0; }
  };
  for (let k = 0; k < state.done && i < steps.length; k++) advance();
  div.classList.add('typing');
  if (state.done === 0) div.classList.add('enter');
  const finish = (): void => {
    clearInterval(typingTimer);
    caretAt?.classList.remove('k-caret');
    div.classList.remove('typing');
    typed.add(state.id);
    typing = null;
    if (typingQueue.length) { renderedKey = ''; renderMessages(lastMsgs); }
    else if (nearBottom()) scroller.scrollTop = scroller.scrollHeight;
  };
  clearInterval(typingTimer);
  if (i >= steps.length) { finish(); return; }
  typingTimer = window.setInterval(() => {
    const stick = nearBottom();
    advance();
    state.done++;
    if (stick) scroller.scrollTop = scroller.scrollHeight;
    if (i >= steps.length) finish();
  }, 38);
}

let lastMsgs: Msg[] = [];
function renderMessages(msgs: Msg[]): void {
  lastMsgs = msgs;
  const key = msgs.map((m) => m.id).join(',');
  if (key === renderedKey) return;
  const stick = nearBottom() || !renderedKey || msgs.at(-1)?.role === 'user';
  renderedKey = key;
  const tid = current?.id ?? '';
  if (seen?.threadId !== tid) { typingQueue = []; typing = null; }
  const fresh = seen?.threadId === tid
    ? msgs.filter((m) => m.role !== 'user' && !seen!.ids.has(m.id) && !typed.has(m.id))
    : [];
  seen = { threadId: tid, ids: new Set(msgs.map((m) => m.id)) };
  typingQueue.push(...fresh.map((m) => m.id));
  clearInterval(typingTimer);
  const nodes = msgs.map(messageNode);
  if (!typing && typingQueue.length) typing = { id: typingQueue.shift()!, done: 0 };
  const typingAt = typing ? msgs.findIndex((m) => m.id === typing!.id) : -1;
  if (typing && typingAt < 0) typing = null;
  msgs.forEach((m, i) => { if (typingQueue.includes(m.id)) nodes[i].hidden = true; });
  const firstKaal = msgs.findIndex((m) => m.role !== 'user');
  if (typing && typingAt >= 0) typeOut(nodes[typingAt], typing);
  if (current && card?.threadId === current.id && firstKaal >= 0) {
    const c = cardNode(current, card.data);
    if (typingAt === firstKaal) c.classList.add('enter');
    nodes.splice(firstKaal, 0, c);
  }
  messagesEl.replaceChildren(...nodes);
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
    panel('Complete payment to start', `${money(p.packCents, p.currency)}${taxFeeNote(p.taxFeePercent)} for an opening reading and the answer to your question.`, btn('Complete payment to start', (b) => goToCheckout(t.id, b)));
  } else if (t.status === 'failed') {
    panel("Kaal couldn't start this consultation", 'Your question is saved and you were not charged for a failed start.', btn('Retry', retry));
  } else if (isLive && t.questionsLeft < 1 && !t.quickLeft && pending === 0 && !autoReload()) {
    const b = btn(packLabel(p), () => undefined);
    b.dataset.addq = '';
    panel("You've used all questions in this consultation", `Add ${RELOAD} more for ${money(p.extraQuestionCents * RELOAD, p.currency)}${taxFeeNote(p.taxFeePercent)}. After that, ${RELOAD} more are added automatically whenever you run out · ${timeLeft(t)} in this consultation.`, b);
  }
  askForm.hidden = !isLive || (t.questionsLeft < 1 && !t.quickLeft && !autoReload());
  askSubmit.disabled = sending;
  askInput.placeholder = pending > 0 ? 'Kaal is answering… you can type your next question.' : 'Ask a follow-up about career, marriage, health, money…';
  const left = t.questionsLeft < 1 ? `Next ${RELOAD} questions added when you ask (${autoPrice()})` : `${plural(t.questionsLeft, 'question')} left`;
  const quickNote = t.quickLeft ? '1 quick answer already paid' : `Quick: up to ${p.quickWords ?? 60} words, half price (1 question = 2 quick answers)`;
  $('composer-hint').textContent = quickMode ? `${quickNote} · ${left}` : `${left} · ${t.language}`;
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
    const prevLast = lastMsgs.at(-1)?.id;
    renderMessages(data.messages);
    const last = data.messages.at(-1);
    if (shareThreadId === id && last && last.role !== 'user' && last.id !== prevLast && data.pending === 0) window.setTimeout(() => void maybeShare('customer'), 4000);
    shareThreadId = id;
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
  if (isPdfRequest(text)) {
    messagesEl.append(messageNode({ id: 'tmp', role: 'user', body: text, createdAt: new Date().toISOString() }), pdfReply(current));
    askInput.value = '';
    autosize();
    scroller.scrollTop = scroller.scrollHeight;
    return;
  }
  sending = true;
  const t = current;
  messagesEl.append(messageNode({ id: 'tmp', role: 'user', body: text, createdAt: new Date().toISOString() }));
  scroller.scrollTop = scroller.scrollHeight;
  askInput.value = '';
  autosize();
  renderState();
  const { ok, status, data } = await api<{ message: Msg; thread: Thread }>(`/api/threads/${encodeURIComponent(t.id)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text, language: langSelect.value || t.language, kundliId: aboutSelect.value || undefined, quick: quickMode || undefined }),
  });
  sending = false;
  renderedKey = '';
  if (ok) {
    reloadFailed = false;
    if ((data as { autoCharged?: boolean }).autoCharged && me?.user.accountType === 'business') me.walletCents = (me.walletCents ?? 0) - me.pricing.extraQuestionCents * RELOAD;
    if ((data as { autoCharged?: boolean }).autoCharged) showBanner(me!.user.accountType === 'business' ? `${RELOAD} more questions added from your Business wallet.` : `${RELOAD} more questions added: ${autoPrice()} charged to card •••• ${me!.billing?.card?.last4 ?? ''}. Receipt emailed.`, 7000);
    pending = Math.max(pending, 1);
    upsertThread(data.thread);
  } else {
    askInput.value = text;
    autosize();
    if (status === 402) {
      reloadFailed = true;
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
  const { ok, data } = await api<{ paid: boolean; kind?: string; error?: string }>(`/api/checkout/confirm?session_id=${encodeURIComponent(sessionId)}`);
  const p = me!.pricing;
  if (!ok || !data.paid) showBanner(data.error ?? "We couldn't confirm the payment yet. If you were charged, it will appear shortly.");
  else if (data.kind === 'topup') showBanner(`Payment received — ${RELOAD} questions added. When they run out, ${RELOAD} more are added automatically.`, 6000);
  else if (data.kind === 'api_credits') showBanner('Payment received — you are now a Business account. Chat is 10% cheaper and paid from your wallet.', 8000);
  else if (data.kind === 'subscription') showBanner('Your plan is active. Kaal is starting your consultation.', 6000);
  else showBanner('Payment received — Kaal is starting your consultation.', 6000);
  const fresh = await api<Me>('/api/me');
  if (fresh.ok) me = fresh.data;
  await refreshSubscription();
  if (ok && data.paid) reloadFailed = false;
  renderBiz();
}

const chatPrices = () => ({ extraQuestionCents: me!.pricing.extraQuestionCents, taxFeePercent: me!.pricing.taxFeePercent, apiCreditCents: 0, currency: me!.pricing.currency as 'usd' | 'inr' });

const autoPrice = (): string => {
  const p = me!.pricing;
  if (me!.user.accountType === 'business') return money(p.extraQuestionCents * RELOAD, p.currency);
  return `${money(p.extraQuestionCents * RELOAD, p.currency)}${taxFeeNote(p.taxFeePercent)}`;
};

let reloadFailed = false;
/** True when running out of questions reloads automatically (saved card with auto-reload on, or a funded Business wallet). */
const autoReload = (): boolean => {
  if (!me || reloadFailed) return false;
  if (me.user.accountType === 'business') return (me.walletCents ?? 0) >= me.pricing.extraQuestionCents * RELOAD;
  return !!(me.billing?.card && me.billing.chatAutoCharge);
};

const trackHome = (): void => {
  if (sessionStorage.getItem('kaalera:hv')) return;
  sessionStorage.setItem('kaalera:hv', '1');
  void fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'home_view' }), keepalive: true }).catch(() => undefined);
};

let enteringApp = false;
let consoleStarted = false;
function startConsole(): void {
  if (consoleStarted) return;
  consoleStarted = true;
  void runConsole();
}

function showHome(): void {
  sessionStorage.removeItem(PENDING_Q);
  enteringApp = false;
  closeMenu();
  history.replaceState(null, '', '/');
  appView.hidden = true;
  landingView.hidden = false;
  document.querySelectorAll<HTMLElement>('[data-signin],[data-signup]').forEach((b) => { b.hidden = true; });
  document.querySelectorAll<HTMLElement>('[data-open-app]').forEach((b) => { b.hidden = false; });
  void renderPrices();
  startConsole();
  window.scrollTo(0, 0);
}
async function enterApp(): Promise<void> {
  enteringApp = true;
  await boot();
}

async function boot(): Promise<void> {
  setupTimezones();
  const params = new URLSearchParams(location.search);
  const res = await api<Me>('/api/me');
  $('boot').hidden = true;
  if (!res.ok) {
    landingView.hidden = false;
    appView.hidden = true;
    trackHome();
    renderPrices();
    startConsole();
    if (params.get('login') === 'expired') {
      history.replaceState(null, '', '/');
      openSignin(true);
    }
    return;
  }
  me = res.data;
  showDeal(me.pricing);
  await refreshSubscription();
  renderBiz();
  if (localStorage.getItem(BIZ_SIGNUP)) {
    localStorage.removeItem(BIZ_SIGNUP);
    if (me.user.accountType !== 'business') $('biz-toggle').click();
  }
  const deepLink = params.has('t') || params.has('checkout') || params.has('app') || !!sessionStorage.getItem(PENDING_Q);
  if (!deepLink && !enteringApp) {
    landingView.hidden = false;
    appView.hidden = true;
    renderPrices();
    startConsole();
    document.querySelectorAll<HTMLElement>('[data-signin],[data-signup]').forEach((b) => { b.hidden = true; });
    document.querySelectorAll<HTMLElement>('[data-open-app]').forEach((b) => { b.hidden = false; });
    return;
  }
  if (params.has('app') || params.has('account')) {
    const clean = new URLSearchParams(location.search);
    clean.delete('app');
    clean.delete('account');
    const query = clean.toString();
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
  }
  landingView.hidden = true;
  appView.hidden = false;
  window.setTimeout(() => void maybeShare('influencer'), 15000);
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
  if (params.get('account') === '1') void openSubscriptionManage();
  if (keepBanner) showBanner(keepBanner, 6000);
}

boot();

{
  const q = new URLSearchParams(location.search);
  const ref = q.get('ref'), code = q.get('code');
  if (ref || code) void fetch('/api/ref', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref, code }) });
}
