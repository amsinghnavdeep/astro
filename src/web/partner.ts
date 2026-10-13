/** Signed-in panel on /affiliates and /influencers: share link, code creation, stats and payouts. */
type Payout = { amountCents: number; period: string; paidAt: string };
type State = {
  referral: { link: string; invited: number; rewards: number; earnedQuestions: number; monthlyMax: number };
  influencer: null | {
    code: string; status: string; percent: number; link: string; payoutsEnabled: boolean; payoutsStarted: boolean;
    clicks: number; signups: number; paying: number; pendingCents: number; availableCents: number; paidCents: number; payouts: Payout[];
  };
  rules: { payoutMinCents: number; holdDays: number };
};

const root = document.getElementById('partner-app');
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const stat = (label: string, v: string | number) => `<div class="p-stat"><div class="p-num">${esc(String(v))}</div><div class="p-label">${esc(label)}</div></div>`;
const share = (link: string, text: string) => `
  <div class="p-link"><input readonly value="${esc(link)}" aria-label="Your link"><button class="p-btn" type="button" data-copy="${esc(link)}">Copy</button>
  <a class="p-btn primary" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`${text} ${link}`)}">Share on WhatsApp</a></div>`;

async function load(): Promise<void> {
  if (!root) return;
  root.innerHTML = '<p class="p-muted">Loading your dashboard…</p>';
  const r = await fetch('/api/partner', { credentials: 'same-origin' });
  if (r.status === 401) {
    root.innerHTML = '';
    return;
  }
  if (!r.ok) {
    root.innerHTML = '<p class="p-muted">Could not load your dashboard. Please refresh.</p>';
    return;
  }
  render((await r.json()) as State);
}

function render(s: State): void {
  if (!root) return;
  document.querySelectorAll<HTMLElement>('.p-signed-out').forEach((el) => (el.hidden = true));
  if (root.dataset.kind === 'affiliates') {
    const a = s.referral;
    root.innerHTML = `<section class="p-card"><h2>Your link</h2>
      ${share(a.link, 'Ask Kaal, the AI Vedic astrologer. We both get 2 free questions:')}
      <div class="p-stats">${stat('Friends joined', a.invited)}${stat('Friends who paid', a.rewards)}${stat('Questions earned', a.earnedQuestions)}</div>
      <p class="p-muted">Up to ${a.monthlyMax} rewards a month. Reward questions expire after 3 months.</p></section>`;
    return;
  }
  const i = s.influencer;
  if (!i) {
    root.innerHTML = `<section class="p-card"><h2>Create your code</h2>
      <form id="p-code" class="p-link"><input name="code" required minlength="3" maxlength="20" pattern="[A-Za-z0-9]{3,20}" placeholder="e.g. PRIYA" aria-label="Your code">
      <button class="p-btn primary" type="submit">Create code</button></form><p id="p-err" class="p-err" role="alert"></p></section>`;
    document.getElementById('p-code')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      const btn = f.querySelector('button')!;
      btn.disabled = true;
      btn.textContent = 'Creating…';
      const res = await fetch('/api/partner/code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: new FormData(f).get('code') }) });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        document.getElementById('p-err')!.textContent = d.error ?? 'Could not create the code.';
        btn.disabled = false;
        btn.textContent = 'Create code';
        return;
      }
      void load();
    });
    return;
  }
  const payouts = i.payoutsEnabled
    ? '<p class="p-ok">Payouts are set up.</p>'
    : `<button id="p-connect" class="p-btn primary" type="button">${i.payoutsStarted ? 'Finish payout setup' : 'Set up payouts'}</button>`;
  root.innerHTML = `<section class="p-card"><h2>Your code: ${esc(i.code)}${i.status === 'paused' ? ' <span class="p-err">(paused)</span>' : ''}</h2>
    ${share(i.link, `Use my code ${i.code} on Kaalera for 2 free questions with Kaal:`)}
    <div class="p-stats">${stat('Clicks', i.clicks)}${stat('Sign-ups', i.signups)}${stat('Paying customers', i.paying)}</div>
    <div class="p-stats">${stat(`On hold (${s.rules.holdDays} days)`, usd(i.pendingCents))}${stat('Available', usd(i.availableCents))}${stat('Paid', usd(i.paidCents))}</div>
    <p class="p-muted">You earn ${i.percent}% of each customer's first paid consultation. Paid on the 1st of each month once at least ${usd(s.rules.payoutMinCents)} is available.</p>
    ${payouts}
    ${i.payouts.length ? `<h3>Payouts</h3><table class="p-table"><tr><th>Month</th><th>Amount</th></tr>${i.payouts.map((p) => `<tr><td>${esc(p.period)}</td><td>${usd(p.amountCents)}</td></tr>`).join('')}</table>
    <p><a href="/api/partner/payouts.csv">Download CSV</a></p>` : ''}</section>`;
  document.getElementById('p-connect')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Opening Stripe…';
    const res = await fetch('/api/partner/connect', { method: 'POST' });
    const d = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (d.url) location.href = d.url;
    else {
      btn.disabled = false;
      btn.textContent = d.error ?? 'Could not open payout setup. Try again.';
    }
  });
}

document.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-copy]');
  if (!b) return;
  void navigator.clipboard.writeText(b.dataset.copy ?? '').then(() => {
    b.textContent = 'Copied';
    setTimeout(() => (b.textContent = 'Copy'), 1500);
  });
});
void load();
