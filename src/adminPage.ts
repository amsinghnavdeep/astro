/** Owner-only admin dashboard HTML: funnel, revenue and the people list. */
import { escapeHtml as h } from './email.js';

export type Person = {
  name: string; email: string; account_type: string; business_name: string | null;
  created_at: string; last_seen_at: string | null; web: number; api: number; cents: number; asked: string | null;
};
export type AdminData = {
  days: number; q: string; pain: string; totals: Record<string, number>;
  revenue: { day: string; cents: number; n: number }[];
  all: { users: number; payments: number; cents: number };
  people: Person[];
};

const PAINS: [string, RegExp][] = [
  ['Govt job', /sarkari|govt|government job|upsc|ssc|\bpsc\b|bank po|railway|prelims|civil service/g],
  ['Job / career', /\bjobs?\b|career|promotion|interview|\bboss\b|office|salary|layoff|resign|naukri/g],
  ['Marriage', /marriage|marry|shaadi|shadi|wedding|spouse|husband|wife|kundli match|manglik|rishta/g],
  ['Love / ex', /\blove\b|\bex\b|breakup|break up|boyfriend|girlfriend|relationship|come back/g],
  ['Money / business', /money|business|finance|debt|loan|wealth|invest|profit|income|paisa/g],
  ['Visa / abroad', /visa|abroad|foreign|canada|australia|immigration|\bpr\b|green card|settle in/g],
  ['Family', /family|mother|father|parents|in-law|brother|sister|ghar me/g],
  ['Studies', /exam|study|studies|college|admission|education|neet|jee|board/g],
  ['Health', /health|illness|disease|surgery|hospital|pregnan|bimari/g],
  ['Home / property', /house|flat|property|\bland\b|apartment|buy a home|plot/g],
  ['Sade Sati', /sade ?sati|shani|saturn/g],
];

export function painPoints(text: string | null): string[] {
  if (!text) return [];
  const t = text.toLowerCase();
  return PAINS.map(([name, re]) => [name, (t.match(re) ?? []).length] as const)
    .filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([name]) => name);
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  const d = Math.round(m / 1440);
  return d < 31 ? `${d} days ago` : iso.slice(0, 10);
};
const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase() || '?';
const hue = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

export function adminPage(d: AdminData): string {
  const t = d.totals;
  const rev = d.revenue.reduce((a, r) => a + r.cents, 0);
  const pays = d.revenue.reduce((a, r) => a + r.n, 0);
  const qs = (o: Record<string, string | number>) => '?' + new URLSearchParams(Object.entries({ days: d.days, q: d.q, pain: d.pain, ...o })
    .filter(([, v]) => v !== '' && v !== undefined).map(([k, v]) => [k, String(v)])).toString();

  const steps: [string, number][] = [
    ['Visitors', t.home_view ?? 0], ['Sign-ups', t.signup ?? 0], ['Free question', t.free_question ?? 0],
    ['Checkout opened', t.checkout_opened ?? 0], ['Paid', (t.first_payment ?? 0) + (t.repeat_payment ?? 0)],
  ];
  const top = Math.max(1, steps[0][1]);
  const funnel = steps.map(([label, n], i) => {
    const prev = i ? steps[i - 1][1] : 0;
    const conv = i ? (prev ? `${Math.round((n / prev) * 100)}%` : '–') : '';
    return `<div class="step"><div class="bar" style="width:${Math.max(4, (n / top) * 100)}%"></div><span class="lbl">${h(label)}</span><b>${n}</b>${conv ? `<em>${conv} of previous</em>` : ''}</div>`;
  }).join('');

  const byDay = new Map(d.revenue.map((r) => [r.day, r.cents]));
  const span = Math.min(d.days, 30);
  const daysList = Array.from({ length: span }, (_, i) => new Date(Date.now() - (span - 1 - i) * 86_400_000).toISOString().slice(0, 10));
  const max = Math.max(1, ...daysList.map((x) => byDay.get(x) ?? 0));
  const bw = 600 / span;
  const chart = `<svg viewBox="0 0 600 140" class="chart" role="img" aria-label="Revenue by day">${daysList.map((x, i) => {
    const v = byDay.get(x) ?? 0; const bh = v ? Math.max(3, (v / max) * 118) : 2;
    return `<rect x="${(i * bw + 2).toFixed(1)}" y="${(124 - bh).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${bh.toFixed(1)}" rx="3" class="${v ? 'on' : 'off'}"><title>${x}: ${usd(v)}</title></rect>`;
  }).join('')}<text x="0" y="138">${daysList[0]}</text><text x="600" y="138" text-anchor="end">today</text></svg>`;

  const rows = d.people.map((p) => ({ ...p, pains: painPoints(p.asked) }));
  const counts = new Map<string, number>();
  for (const r of rows) for (const x of r.pains.length ? r.pains : ['Not asked yet']) counts.set(x, (counts.get(x) ?? 0) + 1);
  const painChips = [...counts].sort((a, b) => b[1] - a[1]).map(([x, n]) =>
    `<a class="chip${d.pain === x ? ' sel' : ''}" href="${qs({ pain: d.pain === x ? '' : x })}">${h(x)} <b>${n}</b></a>`).join('');

  const q = d.q.toLowerCase();
  const shown = rows.filter((r) => (!q || r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q))
    && (!d.pain || (d.pain === 'Not asked yet' ? !r.pains.length : r.pains.includes(d.pain))));
  const people = shown.map((r) => {
    const via = r.web && r.api ? 'Both' : r.api ? 'API' : r.web ? 'Website chat' : '–';
    const pain = r.pains.length ? r.pains.map((x) => `<span class="pain">${h(x)}</span>`).join(' ') : '<span class="dim">not asked yet</span>';
    return `<tr><td>${pain}</td>
<td><div class="who"><span class="av" style="background:hsl(${hue(r.email)} 55% 32%)">${h(initials(r.name))}</span><div><b>${h(r.business_name || r.name)}</b>${r.account_type === 'business' ? ' <span class="badge biz">Business</span>' : ''}<small>${h(r.email)}</small></div></div></td>
<td><span class="via via-${via === 'API' ? 'api' : via === 'Both' ? 'both' : 'web'}">${via}</span></td>
<td class="num">${r.web + r.api}</td>
<td class="num">${r.cents ? `<b class="paid">${usd(r.cents)}</b>` : '<span class="dim">free only</span>'}</td>
<td title="${h(r.last_seen_at ?? '')}">${h(ago(r.last_seen_at ?? r.created_at))}</td></tr>`;
  }).join('');

  const range = [7, 30, 90, 365].map((x) => `<a class="${x === d.days ? 'sel' : ''}" href="${qs({ days: x })}">${x}d</a>`).join('');
  const tile = (label: string, v: string | number, sub = '') => `<div class="tile"><span>${h(label)}</span><b>${h(String(v))}</b>${sub ? `<small>${h(sub)}</small>` : ''}</div>`;
  const paying = rows.filter((r) => r.cents > 0).length;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Admin · Kaalera</title>
<style>
:root{--bg:#0b0a12;--card:#15131f;--line:#2a2638;--text:#f3efe8;--muted:#9a93a8;--saffron:#e8871e;--gold:#f5b85c}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,sans-serif;color:var(--text);background:radial-gradient(1200px 500px at 80% -10%,#2b1a3d 0%,transparent 60%),radial-gradient(900px 400px at -10% 10%,#3a2310 0%,transparent 55%),var(--bg);min-height:100vh}
body::before{content:'';position:fixed;inset:0;pointer-events:none;background-image:radial-gradient(1px 1px at 12% 18%,#fff8 50%,transparent),radial-gradient(1px 1px at 72% 9%,#fff6 50%,transparent),radial-gradient(1.5px 1.5px at 40% 30%,#fff5 50%,transparent),radial-gradient(1px 1px at 88% 40%,#fff7 50%,transparent),radial-gradient(1px 1px at 25% 70%,#fff4 50%,transparent),radial-gradient(1px 1px at 60% 85%,#fff5 50%,transparent)}
main{position:relative;max-width:1180px;margin:0 auto;padding:28px 20px 60px}
header{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:22px}header img{width:38px;height:38px}header h1{font-size:22px;margin:0;letter-spacing:.3px}header h1 span{color:var(--saffron)}
.range{margin-left:auto;display:flex;gap:4px;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:4px}.range a{color:var(--muted);text-decoration:none;padding:5px 12px;border-radius:999px;font-size:13px}.range a.sel{background:var(--saffron);color:#1a0f02;font-weight:600}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}.tile{background:linear-gradient(160deg,#1c1928,#13111b);border:1px solid var(--line);border-radius:16px;padding:16px}.tile span{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px}.tile b{display:block;font-size:28px;margin-top:6px;color:var(--gold)}.tile small{color:var(--muted);font-size:12px}
.grid{display:grid;grid-template-columns:1.1fr 1fr;gap:14px;margin-top:14px}@media(max-width:820px){.grid{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px}.card h2{margin:0 0 14px;font-size:15px;color:var(--muted);font-weight:600;letter-spacing:.4px}
.step{position:relative;display:flex;align-items:center;gap:10px;padding:10px 12px;margin-bottom:8px;border-radius:10px;overflow:hidden;background:#1d1a29}.step .bar{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,#e8871e55,#e8871e22);border-right:2px solid var(--saffron)}.step>*{position:relative}.step .lbl{flex:1;font-size:14px}.step b{font-size:17px}.step em{font-style:normal;font-size:11px;color:var(--muted);min-width:96px;text-align:right}
.chart{width:100%;height:auto}.chart rect.on{fill:url(#g);fill:var(--saffron)}.chart rect.off{fill:#2a2638}.chart text{fill:var(--muted);font-size:10px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 14px}.chip{color:var(--text);text-decoration:none;background:#1d1a29;border:1px solid var(--line);padding:6px 12px;border-radius:999px;font-size:13px}.chip b{color:var(--gold);margin-left:4px}.chip.sel{border-color:var(--saffron);background:#e8871e22}
form.search{display:flex;gap:8px;margin-bottom:12px}form.search input{flex:1;background:#0f0d16;border:1px solid var(--line);color:var(--text);border-radius:10px;padding:10px 12px;font-size:14px}form.search button{background:var(--saffron);border:0;color:#1a0f02;font-weight:600;border-radius:10px;padding:0 18px;cursor:pointer}
.tw{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:14px}th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}td{padding:10px;border-bottom:1px solid #201d2c;vertical-align:middle;white-space:nowrap}tr:hover td{background:#1a1724}
.who{display:flex;align-items:center;gap:10px}.who small{display:block;color:var(--muted);font-size:12px}.av{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font-size:13px;font-weight:700;color:#fff;flex:none}
.pain{display:inline-block;background:#2a1a0b;color:var(--gold);border:1px solid #5a3510;border-radius:999px;padding:3px 10px;font-size:12px}
.badge{font-size:10px;padding:2px 7px;border-radius:999px;vertical-align:middle}.biz{background:#23314d;color:#9cc3ff}
.via{font-size:12px;padding:3px 9px;border-radius:6px}.via-web{background:#1d2a22;color:#8fdcab}.via-api{background:#23314d;color:#9cc3ff}.via-both{background:#33244a;color:#d2b0ff}
.num{text-align:right}.paid{color:#8fdcab}.dim{color:var(--muted);font-size:12px}.foot{color:var(--muted);font-size:12px;margin-top:14px}
</style></head><body><main>
<header><img src="/kaal-mark-dark.svg" alt=""><h1>Kaalera <span>admin</span></h1><nav class="range">${range}</nav></header>
<section class="tiles">${tile('Revenue', usd(rev), `${pays} payment${pays === 1 ? '' : 's'}`)}${tile('Visitors', t.home_view ?? 0, 'real browsers, no bots')}${tile('Sign-ups', t.signup ?? 0)}${tile('Paying people', paying, `of ${d.all.users} accounts`)}${tile('All-time revenue', usd(d.all.cents), `${d.all.payments} payments`)}</section>
<section class="grid"><div class="card"><h2>FUNNEL · LAST ${d.days} DAYS</h2>${funnel}</div><div class="card"><h2>REVENUE BY DAY</h2>${chart}<p class="foot">${t.leads_abandoned ?? 0} typed an email but didn't sign up · ${t.leads_opted_in ?? 0} opted in to emails</p></div></section>
<section class="card" style="margin-top:14px"><h2>PEOPLE · ${shown.length}${shown.length !== rows.length ? ` of ${rows.length}` : ''}</h2>
<div class="chips">${painChips}</div>
<form class="search" method="get"><input type="hidden" name="days" value="${d.days}">${d.pain ? `<input type="hidden" name="pain" value="${h(d.pain)}">` : ''}<input name="q" value="${h(d.q)}" placeholder="Search name or email"><button>Search</button></form>
<div class="tw"><table><tr><th>Pain point</th><th>Name</th><th>Via</th><th class="num">Chats</th><th class="num">Money paid</th><th>Last active</th></tr>${people || '<tr><td colspan="6" class="dim">No one matches.</td></tr>'}</table></div>
<p class="foot">Pain point is worked out from the words in each person's questions. Chat text and birth details are not shown here.</p></section>
</main></body></html>`;
}
