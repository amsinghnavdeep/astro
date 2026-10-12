/** Purchase disclaimer: the customer must tick the box before any checkout opens. */
const BASE = "Kaal's readings are astrological guidance for personal reflection only. They are not medical, legal, financial or other professional advice, and predictions are not guaranteed. All sales are final — no refunds.";

export const CONSENT = {
  chat: {
    text: `${BASE} Chat questions expire 3 months after purchase.`,
    label: 'I understand: guidance only, no refunds, and questions expire 3 months after purchase.',
  },
  api: {
    text: `${BASE} API credits expire 6 months after purchase.`,
    label: 'I understand: guidance only, no refunds, and credits expire 6 months after purchase.',
  },
} as const;

export function confirmPurchase(area: keyof typeof CONSENT, price: string): Promise<boolean> {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'consent-dialog';
    d.innerHTML = `<form method="dialog">
      <h2>Before you pay</h2>
      <p class="consent-text"></p>
      <label class="consent-check"><input type="checkbox"> <span></span></label>
      <div class="consent-actions">
        <button type="button" class="consent-cancel">Cancel</button>
        <button type="submit" class="consent-pay" disabled></button>
      </div>
    </form>`;
    d.querySelector('.consent-text')!.textContent = CONSENT[area].text;
    d.querySelector('.consent-check span')!.textContent = CONSENT[area].label;
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
