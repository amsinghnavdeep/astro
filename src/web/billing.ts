/** Saved-card auto-charge (chat) / auto-recharge (API): one-time notice after the first payment and settings calls. */
export type BillingInfo = {
  card: { last4: string } | null; chatAutoCharge: boolean; chatAutoChargeAcked: boolean; chatAutoDailyMax: number;
  apiAutoRecharge: boolean; apiAutoRechargeAcked: boolean; apiAutoRechargeCredits: number; apiAutoRechargeCapCents: number; apiLowCredits: number;
};
export type BillingPatch = Partial<Pick<BillingInfo, 'chatAutoCharge' | 'apiAutoRecharge' | 'apiAutoRechargeCredits' | 'apiAutoRechargeCapCents'>> & { ack?: 'chat' | 'api' };

export async function saveBilling(patch: BillingPatch): Promise<BillingInfo | null> {
  const res = await fetch('/api/billing', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(patch) });
  if (!res.ok) return null;
  return ((await res.json()) as { billing: BillingInfo }).billing;
}

/** Shown once, right after the card is first saved. Resolves with the updated settings. */
export function autoChargeNotice(area: 'chat' | 'api', b: BillingInfo, text: string): Promise<BillingInfo | null> {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'consent-dialog';
    d.innerHTML = `<form method="dialog">
      <h2></h2><p class="consent-text"></p>
      <p class="consent-links"><a href="/terms" target="_blank" rel="noopener">Terms &amp; Conditions</a></p>
      <div class="consent-actions"><button type="button" class="consent-cancel"></button><button type="submit" class="consent-pay"></button></div>
    </form>`;
    d.querySelector('h2')!.textContent = area === 'chat' ? 'Auto-charge is on' : 'Auto-recharge is on';
    d.querySelector('.consent-text')!.textContent = `Your card ending ${b.card?.last4 ?? '••••'} is saved. ${text} All sales are final.`;
    const off = d.querySelector<HTMLButtonElement>('.consent-cancel')!;
    const keep = d.querySelector<HTMLButtonElement>('.consent-pay')!;
    off.textContent = 'Turn off';
    keep.textContent = area === 'chat' ? 'Keep auto-charge on' : 'Keep auto-recharge on';
    const done = async (on: boolean, btn: HTMLButtonElement) => {
      btn.disabled = true;
      btn.classList.add('is-busy');
      const r = await saveBilling(area === 'chat' ? { ack: 'chat', chatAutoCharge: on } : { ack: 'api', apiAutoRecharge: on });
      d.close();
      resolve(r);
    };
    off.addEventListener('click', () => void done(false, off));
    d.querySelector('form')!.addEventListener('submit', (e) => { e.preventDefault(); void done(true, keep); });
    d.addEventListener('cancel', (e) => e.preventDefault());
    document.body.append(d);
    d.showModal();
  });
}
