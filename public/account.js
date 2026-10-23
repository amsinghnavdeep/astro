// src/web/billing.ts
async function saveBilling(patch) {
  const res = await fetch("/api/billing", { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(patch) });
  if (!res.ok) return null;
  return (await res.json()).billing;
}

// src/disclaimer.ts
var taxFeeNote = (percent) => percent > 0 ? " + taxes & fees" : "";

// src/web/account.ts
var RELOAD = 2;
var $ = (id) => document.getElementById(id);
var money = (cents, currency) => new Intl.NumberFormat(currency === "inr" ? "en-IN" : "en-US", {
  style: "currency",
  currency: currency.toUpperCase(),
  minimumFractionDigits: cents % 100 ? 2 : 0
}).format(cents / 100);
var me;
var reloadPrice = () => {
  const base = me.pricing.extraQuestionCents * RELOAD;
  return `${money(base, me.pricing.currency)}${taxFeeNote(me.pricing.taxFeePercent)}`;
};
function render() {
  const b = me.billing;
  const biz = me.user.accountType === "business";
  $("a-name").textContent = me.user.businessName ?? me.user.name;
  $("a-email").textContent = me.user.email;
  $("a-type").textContent = biz ? "Business account" : "Personal account";
  const text = $("a-reload-text");
  const on = $("a-on");
  const off = $("a-off");
  on.hidden = off.hidden = true;
  if (biz) {
    text.textContent = `When you run out of questions, ${RELOAD} more are paid from your Business wallet at the Business price.`;
    $("a-reload-note").textContent = "Top up or change wallet auto-recharge on the Developers page under Credits & billing.";
    return;
  }
  if (!b.card) {
    text.textContent = `No saved card yet. Your card is saved at your first payment, and after that ${RELOAD} more questions are added automatically whenever you run out.`;
    $("a-reload-note").textContent = "";
    return;
  }
  if (b.chatAutoCharge) {
    text.innerHTML = 'Auto-reload <span class="a-on-badge">On</span>';
    $("a-reload-note").textContent = `When you run out, ${RELOAD} questions are added for ${reloadPrice()} on card \u2022\u2022\u2022\u2022 ${b.card.last4}, up to ${b.chatAutoDailyMax} questions a day. A receipt is emailed every time.`;
    off.hidden = false;
  } else {
    text.innerHTML = "Auto-reload is off";
    $("a-reload-note").textContent = `Your chat stops each time you run out of questions until you pay again. Turn it on to keep going: ${RELOAD} questions for ${reloadPrice()} on card \u2022\u2022\u2022\u2022 ${b.card.last4}.`;
    on.hidden = false;
  }
}
function dialog(html) {
  const d = document.createElement("dialog");
  d.className = "a-dialog";
  d.innerHTML = html;
  d.addEventListener("close", () => d.remove());
  document.body.append(d);
  d.showModal();
  return d;
}
async function save(chatAutoCharge) {
  $("a-error").textContent = "";
  const r = await saveBilling({ chatAutoCharge, ack: "chat" });
  if (!r) {
    $("a-error").textContent = "Could not save. Please try again.";
    return;
  }
  me.billing = r;
  render();
}
function askReason() {
  const d = dialog(`<h3>Why are you turning it off?</h3><p>This helps us improve Kaal.</p>
    <div class="a-reasons">
      <button class="d-btn" data-r="price" type="button">It's too expensive</button>
      <button class="d-btn" data-r="unused" type="button">I'm not using it much</button>
      <button class="d-btn" data-r="other" type="button">Something else</button>
    </div>
    <button class="a-keep" type="button">Keep auto-reload on</button>
    <button class="a-link a-skip" type="button">Skip and turn off</button>`);
  const finish = async (reason) => {
    d.querySelectorAll("button").forEach((x) => {
      x.disabled = true;
    });
    if (reason) void fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: `autoreload_off_${reason}` }) }).catch(() => void 0);
    await save(false);
    d.close();
  };
  d.querySelectorAll("[data-r]").forEach((x) => x.addEventListener("click", () => void finish(x.dataset.r)));
  d.querySelector(".a-skip").addEventListener("click", () => void finish(null));
  d.querySelector(".a-keep").addEventListener("click", () => d.close());
}
$("a-off").addEventListener("click", () => {
  const d = dialog(`<h3>Turn off auto-reload?</h3>
    <p>Each time you run out of questions, your chat with Kaal will stop until you go through checkout and pay again.</p>
    <button class="a-keep" type="button">Keep auto-reload on</button>
    <button class="a-link a-confirm" type="button">Turn off</button>`);
  d.querySelector(".a-keep").addEventListener("click", () => d.close());
  d.querySelector(".a-confirm").addEventListener("click", () => {
    d.close();
    askReason();
  });
});
$("a-on").addEventListener("click", async () => {
  const btn = $("a-on");
  btn.disabled = true;
  await save(true);
  btn.disabled = false;
});
(async () => {
  const res = await fetch("/api/me", { credentials: "same-origin" });
  if (!res.ok) {
    $("a-signin").hidden = false;
    return;
  }
  me = await res.json();
  $("a-body").hidden = false;
  render();
})();
