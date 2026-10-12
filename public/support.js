// src/web/support.ts
var TOPICS = [
  ["prediction", "Prediction or answer"],
  ["payment", "Payment or refund"],
  ["account", "Account or sign-in"],
  ["api", "API"],
  ["other", "Something else"]
];
var STATUS = { open: "Waiting for reply", answered: "Replied", forwarded: "Forwarded to our team", closed: "Closed" };
var $ = (id) => document.getElementById(id);
var esc = (s) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
var fmt = (iso) => new Date(iso).toLocaleString(void 0, { dateStyle: "medium", timeStyle: "short" });
async function api(path, init) {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers ?? {} } });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}
var signedIn = false;
var poll;
var openIds = /* @__PURE__ */ new Set();
function renderTickets(list, waiting) {
  $("my-tickets").hidden = !list.length;
  $("ticket-list").innerHTML = list.map((t) => `
    <details class="d-card s-ticket" data-id="${t.id}"${openIds.has(t.id) ? " open" : ""}>
      <summary><span class="s-num">${esc(t.number)}</span><span class="s-subj">${esc(t.subject)}</span>
        <span class="s-badge ${esc(t.status)}">${esc(STATUS[t.status] ?? t.status)}</span><span class="d-small d-muted">${fmt(t.updatedAt)}</span></summary>
      <div class="s-msgs">${t.messages.map((m) => `<div class="s-msg ${m.author}"><div class="s-who">${m.author === "support" ? "Kaalera support" : "You"} \xB7 ${fmt(m.createdAt)}</div><div class="s-body">${esc(m.body)}</div></div>`).join("")}
      ${t.status === "open" ? '<div class="s-typing">Our team is looking into this\u2026</div>' : ""}</div>
      ${t.status !== "closed" ? `<form class="s-reply" data-id="${t.id}"><textarea rows="3" maxlength="4000" placeholder="Add a reply\u2026"></textarea><button class="d-btn" type="submit">Send</button></form>` : ""}
    </details>`).join("");
  window.clearTimeout(poll);
  if (waiting) poll = window.setTimeout(loadTickets, 6e3);
}
async function loadTickets() {
  const r = await api("/api/support/tickets");
  if (r.ok) renderTickets(r.data.tickets, r.data.waiting);
}
$("ticket-list").addEventListener("toggle", (e) => {
  const d = e.target;
  const id = Number(d.dataset.id);
  if (d.open) openIds.add(id);
  else openIds.delete(id);
}, true);
$("ticket-list").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const box = form.querySelector("textarea");
  const btn = form.querySelector("button");
  if (box.value.trim().length < 2) return;
  btn.disabled = true;
  const r = await api(`/api/support/tickets/${form.dataset.id}/messages`, { method: "POST", body: JSON.stringify({ message: box.value }) });
  btn.disabled = false;
  if (r.ok) await loadTickets();
  else box.setCustomValidity(r.data.error ?? "Could not send.");
});
$("t-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("t-error").textContent = "";
  const btn = $("t-submit");
  const body = {
    topic: $("t-topic").value,
    subject: $("t-subject").value,
    message: $("t-message").value
  };
  if (!signedIn) body.email = $("t-email").value;
  const thread = $("t-thread").value;
  if (thread) body.threadId = thread;
  btn.disabled = true;
  btn.textContent = "Submitting\u2026";
  const r = await api("/api/support/tickets", { method: "POST", body: JSON.stringify(body) });
  btn.disabled = false;
  btn.textContent = "Submit ticket";
  if (!r.ok) {
    $("t-error").textContent = r.data.error ?? "Could not submit the ticket. Please try again.";
    return;
  }
  $("t-num").textContent = r.data.ticket.number;
  $("t-done-text").textContent = signedIn ? "We'll analyse it and reply below and by email." : "We'll analyse it and reply to you by email.";
  $("t-form").reset();
  $("t-form").hidden = true;
  $("t-done").hidden = false;
  if (signedIn) {
    openIds.add(r.data.ticket.id);
    await loadTickets();
  }
});
$("t-another").addEventListener("click", () => {
  $("t-done").hidden = true;
  $("t-form").hidden = false;
});
async function boot() {
  $("t-topic").replaceChildren(...TOPICS.map(([v, l]) => new Option(l, v)));
  const me = await api("/api/me");
  if (!me.ok) {
    $("signin-hint").hidden = false;
    return;
  }
  signedIn = true;
  $("t-email-row").hidden = true;
  const th = await api("/api/threads");
  if (th.ok && th.data.threads.length) {
    $("t-thread").append(...th.data.threads.map((t) => new Option(`${t.fullName} \xB7 ${new Date(t.createdAt).toLocaleDateString()}`, t.id)));
    $("t-thread-row").hidden = false;
  }
  await loadTickets();
}
void boot();
