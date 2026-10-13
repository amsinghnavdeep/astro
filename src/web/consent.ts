/** Purchase disclaimer: the customer must tick the box before any checkout opens. */

import { disclaimer, type AutoPrices } from '../disclaimer.js';

const LABEL = {
  chat: 'I agree to the Terms, no refunds, and auto-charge of extra questions (I can turn it off any time).',
  api: 'I agree to the Terms, no refunds, and auto-recharge (I can change or turn it off any time).',
} as const;

export function confirmPurchase(area: keyof typeof LABEL, price: string, prices: AutoPrices): Promise<boolean> {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'consent-dialog';
    d.innerHTML = `<form method="dialog">
      <h2>Before you pay</h2>
      <p class="consent-text"></p>
      <p class="consent-links"><a href="/terms" target="_blank" rel="noopener">Terms &amp; Conditions</a> · <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a></p>
      <label class="consent-check"><input type="checkbox"> <span></span></label>
      <div class="consent-actions">
        <button type="button" class="consent-cancel">Cancel</button>
        <button type="submit" class="consent-pay" disabled></button>
      </div>
    </form>`;
    d.querySelector('.consent-text')!.textContent = disclaimer(area, prices);
    d.querySelector('.consent-check span')!.textContent = LABEL[area];
    const box = d.querySelector<HTMLInputElement>('.consent-check input')!;
    const pay = d.querySelector<HTMLButtonElement>('.consent-pay')!;
    pay.textContent = `Agree and pay ${price}`;
    box.addEventListener('change', () => { pay.disabled = !box.checked; });
    d.querySelector('.consent-cancel')!.addEventListener('click', () => d.close(''));
    d.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      if (box.checked) d.close('ok');
    });
    d.addEventListener('close', () => {
      resolve(d.returnValue === 'ok');
      d.remove();
    });
    document.body.append(d);
    d.showModal();
  });
}
