import { saveBilling, type BillingInfo } from './billing.js';
import { taxFeeNote } from '../disclaimer.js';

type Me = {
  user: { name: string; email: string; accountType: 'personal' | 'business'; businessName: string | null };
  pricing: { extraQuestionCents: number; taxFeePercent: number; currency: string };
  billing: BillingInfo;
};

const RELOAD = 2;
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
let me: Me;

const reloadPrice = (): string => {
  const base = me.pricing.extraQuestionCents * RELOAD;
  return `${usd(base)}${taxFeeNote(me.pricing.taxFeePercent)}`;
};

function render(): void {
  const b = me.billing;
  const biz = me.user.accountType === 'business';
  $('a-name').textContent = me.user.businessName ?? me.user.name;
  $('a-email').textContent = me.user.email;
  $('a-type').textContent = biz ? 'Business account' : 'Personal account';
  const text = $('a-reload-text');
  const on = $<HTMLButtonElement>('a-on');
  const off = $<HTMLButtonElement>('a-off');
  on.hidden = off.hidden = true;
  if (biz) {
    text.textContent = `When you run out of questions, ${RELOAD} more are paid from your Business wallet at the Business price.`;
    $('a-reload-note').textContent = 'Top up or change wallet auto-recharge on the Developers page under Credits & billing.';
    return;
  }
  if (!b.card) {
    text.textContent = `No saved card yet. Your card is saved at your first payment, and after that ${RELOAD} more questions are added automatically whenever you run out.`;
    $('a-reload-note').textContent = '';
    return;
  }
  if (b.chatAutoCharge) {
    text.innerHTML = 'Auto-reload <span class="a-on-badge">On</span>';
    $('a-reload-note').textContent = `When you run out, ${RELOAD} questions are added for ${reloadPrice()} on card •••• ${b.card.last4}, up to ${b.chatAutoDailyMax} questions a day. A receipt is emailed every time.`;
    off.hidden = false;
  } else {
    text.innerHTML = 'Auto-reload is off';
    $('a-reload-note').textContent = `Your chat stops each time you run out of questions until you pay again. Turn it on to keep going: ${RELOAD} questions for ${reloadPrice()} on card •••• ${b.card.last4}.`;
    on.hidden = false;
  }
}

function dialog(html: string): HTMLDialogElement {
  const d = document.createElement('dialog');
  d.className = 'a-dialog';
  d.innerHTML = html;
  d.addEventListener('close', () => d.remove());
  document.body.append(d);
  d.showModal();
  return d;
}

async function save(chatAutoCharge: boolean): Promise<void> {
  $('a-error').textContent = '';
  const r = await saveBilling({ chatAutoCharge, ack: 'chat' });
  if (!r) { $('a-error').textContent = 'Could not save. Please try again.'; return; }
  me.billing = r;
  render();
}

function askReason(): void {
  const d = dialog(`<h3>Why are you turning it off?</h3><p>This helps us improve Kaal.</p>
    <div class="a-reasons">
      <button class="d-btn" data-r="price" type="button">It's too expensive</button>
      <button class="d-btn" data-r="unused" type="button">I'm not using it much</button>
      <button class="d-btn" data-r="other" type="button">Something else</button>
    </div>
    <button class="a-keep" type="button">Keep auto-reload on</button>
    <button class="a-link a-skip" type="button">Skip and turn off</button>`);
  const finish = async (reason: string | null) => {
    d.querySelectorAll('button').forEach((x) => { x.disabled = true; });
    if (reason) void fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: `autoreload_off_${reason}` }) }).catch(() => undefined);
    await save(false);
    d.close();
  };
  d.querySelectorAll<HTMLButtonElement>('[data-r]').forEach((x) => x.addEventListener('click', () => void finish(x.dataset.r!)));
  d.querySelector('.a-skip')!.addEventListener('click', () => void finish(null));
  d.querySelector('.a-keep')!.addEventListener('click', () => d.close());
}

$('a-off').addEventListener('click', () => {
  const d = dialog(`<h3>Turn off auto-reload?</h3>
    <p>Each time you run out of questions, your chat with Kaal will stop until you go through checkout and pay again.</p>
    <button class="a-keep" type="button">Keep auto-reload on</button>
    <button class="a-link a-confirm" type="button">Turn off</button>`);
  d.querySelector('.a-keep')!.addEventListener('click', () => d.close());
  d.querySelector('.a-confirm')!.addEventListener('click', () => { d.close(); askReason(); });
});

$('a-on').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('a-on');
  btn.disabled = true;
  await save(true);
  btn.disabled = false;
});

(async () => {
  const res = await fetch('/api/me', { credentials: 'same-origin' });
  if (!res.ok) { $('a-signin').hidden = false; return; }
  me = (await res.json()) as Me;
  $('a-body').hidden = false;
  render();
})();
