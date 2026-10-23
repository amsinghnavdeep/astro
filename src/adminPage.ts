/** Owner-only admin dashboard HTML: funnel, revenue and the people list. */
import { escapeHtml as h } from './email.js';
import { DEFAULT_KAAL_PROMPTS } from './devin.js';
import { AUDIENCES, FROM_IDS, fromAddress, MAX_RECIPIENTS, type BroadcastRow, type Draft } from './broadcast.js';
import type { Coupon } from './coupons.js';
import { KAAL_FIELDS, KAAL_MAX_CHARS, type KaalField, type KaalVersion } from './kaalPrompt.js';

export type Person = {
  name: string; email: string; account_type: string; business_name: string | null;
  created_at: string; last_seen_at: string | null; web: number; api: number; cents: number; asked: string | null; chats_left?: number;
};
export type Filters = { q: string; pain: string; via: string; acct: string; chats: string; paid: string; active: string; sort: string; dir: string };
export type AdminData = {
  days: number; f: Filters; totals: Record<string, number>;
  revenue: { day: string; cents: number; n: number }[];
  all: { users: number; payments: number; cents: number };
  people: Person[];
};
export type Row = Person & { pains: string[]; via: string; chats: number };
export const FILTER_KEYS: (keyof Filters)[] = ['q', 'pain', 'via', 'acct', 'chats', 'paid', 'active', 'sort', 'dir'];

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

const DAY_MS = 86_400_000;
export function toRows(people: Person[]): Row[] {
  return people.map((p) => ({ ...p, pains: painPoints(p.asked), chats: p.web + p.api, via: p.web && p.api ? 'Both' : p.api ? 'API' : p.web ? 'Website chat' : 'None' }));
}

export function filterRows(rows: Row[], f: Filters): Row[] {
  const q = f.q.toLowerCase();
  const now = Date.now();
  const out = rows.filter((r) => {
    const last = Date.parse(r.last_seen_at ?? r.created_at);
    if (q && !`${r.name} ${r.email} ${r.business_name ?? ''}`.toLowerCase().includes(q)) return false;
    if (f.pain && (f.pain === 'Not asked yet' ? r.pains.length > 0 : !r.pains.includes(f.pain))) return false;
    if (f.via && r.via.toLowerCase().split(' ')[0] !== f.via) return false;
    if (f.acct && r.account_type !== f.acct) return false;
    if (f.chats === '0' && r.chats !== 0) return false;
    if (f.chats && f.chats !== '0' && r.chats < Number(f.chats)) return false;
    if (f.paid === 'paid' && !r.cents) return false;
    if (f.paid === 'free' && r.cents) return false;
    if (/^\d+$/.test(f.paid) && r.cents < Number(f.paid) * 100) return false;
    if (f.active === 'today' && now - last > DAY_MS) return false;
    if (/^\d+$/.test(f.active) && now - last > Number(f.active) * DAY_MS) return false;
    if (f.active === 'older' && now - last <= 30 * DAY_MS) return false;
    return true;
  });
  const key: Record<string, (r: Row) => string | number> = {
    pain: (r) => r.pains[0] ?? '~', name: (r) => (r.business_name || r.name).toLowerCase(), via: (r) => r.via,
    chats: (r) => r.chats, paid: (r) => r.cents, active: (r) => Date.parse(r.last_seen_at ?? r.created_at),
  };
  const k = key[f.sort] ?? key.active;
  const dir = f.dir === 'asc' ? 1 : -1;
  return out.sort((a, b) => (k(a) > k(b) ? dir : k(a) < k(b) ? -dir : 0));
}

const csvCell = (v: string | number) => {
  const s = String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export function peopleCsv(rows: Row[]): string {
  const head = ['Name', 'Business name', 'Email', 'Account', 'Pain point', 'Via', 'Chats', 'Money paid (USD)', 'Last active', 'Signed up'];
  return [head, ...rows.map((r) => [r.name, r.business_name ?? '', r.email, r.account_type, r.pains.join(' / ') || 'Not asked yet', r.via, r.chats,
    (r.cents / 100).toFixed(2), (r.last_seen_at ?? '').slice(0, 16).replace('T', ' '), r.created_at.slice(0, 10)])]
    .map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const TABS: [string, string][] = [['people', 'Overview & people'], ['blog', 'Blog'], ['prices', 'Prices'], ['festivals', 'Festivals'], ['kaal', 'Kaal'], ['email', 'Email'], ['coupons', 'Coupons']];
function shell(tab: string, inner: string, days = 30, notice = ''): string {
  const range = tab === 'people' ? `<nav class="range">${[7, 30, 90, 365].map((x) => `<a class="${x === days ? 'sel' : ''}" href="/admin?days=${x}">${x}d</a>`).join('')}</nav>` : '';
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

nav.tabs{display:flex;gap:6px;margin:0 0 18px;flex-wrap:wrap}nav.tabs a{color:var(--muted);text-decoration:none;padding:8px 16px;border-radius:10px;border:1px solid var(--line);background:var(--card);font-size:14px}nav.tabs a.sel{color:#1a0f02;background:var(--saffron);border-color:var(--saffron);font-weight:600}
.filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:12px}.filters label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;display:flex;flex-direction:column;gap:4px}
select,input,textarea{background:#0f0d16;border:1px solid var(--line);color:var(--text);border-radius:10px;padding:9px 10px;font-size:14px;font-family:inherit}textarea{width:100%;min-height:340px;line-height:1.5}
.btn{display:inline-block;background:var(--saffron);border:0;color:#1a0f02;font-weight:600;border-radius:10px;padding:10px 18px;cursor:pointer;text-decoration:none;font-size:14px}.btn.ghost{background:transparent;color:var(--text);border:1px solid var(--line)}.btn.danger{background:transparent;color:#ff8a80;border:1px solid #5a2320}
.bar-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}th a{color:inherit;text-decoration:none}th a.on{color:var(--gold)}
.form{display:grid;gap:12px}.form label{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--muted)}.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:700px){.two{grid-template-columns:1fr}}
.note{padding:10px 14px;border-radius:10px;margin-bottom:14px;font-size:14px}.ok{background:#1d2a22;color:#8fdcab}.err{background:#3a1a18;color:#ff8a80}
.status{font-size:11px;padding:2px 8px;border-radius:999px}.st-published{background:#1d2a22;color:#8fdcab}.st-draft{background:#2a2638;color:var(--muted)}
.inline{display:inline}.switch{display:flex;gap:8px;align-items:center}
</style></head><body><main>
<header><img src="/kaal-mark-dark.svg" alt=""><h1>Kaalera <span>admin</span></h1>${range}</header>
<nav class="tabs">${TABS.map(([id, label]) => `<a class="${id === tab ? 'sel' : ''}" href="/admin${id === 'people' ? '' : `?tab=${id}`}">${label}</a>`).join('')}</nav>
${notice}${inner}</main></body></html>`;
}
export const noticeHtml = (ok: string, err: string) => (err ? `<div class="note err">${h(err)}</div>` : ok ? `<div class="note ok">${h(ok)}</div>` : '');

const opt = (val: string, cur: string, label: string) => `<option value="${h(val)}"${val === cur ? ' selected' : ''}>${h(label)}</option>`;

export function adminPage(d: AdminData, notice = ''): string {
  const t = d.totals;
  const f = d.f;
  const rev = d.revenue.reduce((a, r) => a + r.cents, 0);
  const pays = d.revenue.reduce((a, r) => a + r.n, 0);
  const qs = (o: Partial<Filters> & { days?: number }) => '?' + new URLSearchParams(Object.entries({ days: d.days, ...f, ...o })
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
  const daysList = Array.from({ length: span }, (_, i) => new Date(Date.now() - (span - 1 - i) * DAY_MS).toISOString().slice(0, 10));
  const max = Math.max(1, ...daysList.map((x) => byDay.get(x) ?? 0));
  const bw = 600 / span;
  const chart = `<svg viewBox="0 0 600 140" class="chart" role="img" aria-label="Revenue by day">${daysList.map((x, i) => {
    const v = byDay.get(x) ?? 0; const bh = v ? Math.max(3, (v / max) * 118) : 2;
    return `<rect x="${(i * bw + 2).toFixed(1)}" y="${(124 - bh).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${bh.toFixed(1)}" rx="3" class="${v ? 'on' : 'off'}"><title>${x}: ${usd(v)}</title></rect>`;
  }).join('')}<text x="0" y="138">${daysList[0]}</text><text x="600" y="138" text-anchor="end">today</text></svg>`;

  const rows = toRows(d.people);
  const counts = new Map<string, number>();
  for (const r of rows) for (const x of r.pains.length ? r.pains : ['Not asked yet']) counts.set(x, (counts.get(x) ?? 0) + 1);
  const painChips = [...counts].sort((a, b) => b[1] - a[1]).map(([x, n]) =>
    `<a class="chip${f.pain === x ? ' sel' : ''}" href="${qs({ pain: f.pain === x ? '' : x })}">${h(x)} <b>${n}</b></a>`).join('');
  const shown = filterRows(rows, f);
  const people = shown.map((r) => {
    const pain = r.pains.length ? r.pains.map((x) => `<span class="pain">${h(x)}</span>`).join(' ') : '<span class="dim">not asked yet</span>';
    return `<tr><td>${pain}</td>
<td><div class="who"><span class="av" style="background:hsl(${hue(r.email)} 55% 32%)">${h(initials(r.name))}</span><div><b>${h(r.business_name || r.name)}</b>${r.account_type === 'business' ? ' <span class="badge biz">Business</span>' : ''}<small>${h(r.email)}</small></div></div></td>
<td>${r.via === 'None' ? '<span class="dim">–</span>' : `<span class="via via-${r.via === 'API' ? 'api' : r.via === 'Both' ? 'both' : 'web'}">${r.via}</span>`}</td>
<td class="num">${r.chats}</td>
<td class="num">${r.cents ? `<b class="paid">${usd(r.cents)}</b>` : '<span class="dim">free only</span>'}</td>
<td title="${h(r.last_seen_at ?? '')}">${h(ago(r.last_seen_at ?? r.created_at))}</td>
<td><form method="post" action="/admin/people/gift" class="switch"><input type="hidden" name="email" value="${h(r.email)}"><span class="dim" title="Chats left">${r.chats_left ?? 0} left</span><input name="n" type="number" min="1" max="20" value="1" style="width:58px;padding:6px"><button class="btn ghost" style="padding:6px 10px">Give</button></form></td></tr>`;
  }).join('');
  const th = (key: string, label: string, cls = '') => {
    const on = f.sort === key;
    const dir = on && f.dir !== 'asc' ? 'asc' : 'desc';
    return `<th class="${cls}"><a class="${on ? 'on' : ''}" href="${qs({ sort: key, dir })}">${label}${on ? (f.dir === 'asc' ? ' ▲' : ' ▼') : ''}</a></th>`;
  };
  const pains = ['', ...PAINS.map(([n]) => n), 'Not asked yet'];
  const filters = `<form method="get" class="filters"><input type="hidden" name="days" value="${d.days}">${f.sort ? `<input type="hidden" name="sort" value="${h(f.sort)}"><input type="hidden" name="dir" value="${h(f.dir)}">` : ''}
<label>Name or email<input name="q" value="${h(f.q)}" placeholder="Search"></label>
<label>Pain point<select name="pain">${pains.map((x) => opt(x, f.pain, x || 'Any')).join('')}</select></label>
<label>Via<select name="via">${opt('', f.via, 'Any')}${opt('website', f.via, 'Website chat')}${opt('api', f.via, 'API')}${opt('both', f.via, 'Both')}${opt('none', f.via, 'None yet')}</select></label>
<label>Account<select name="acct">${opt('', f.acct, 'Any')}${opt('personal', f.acct, 'Personal')}${opt('business', f.acct, 'Business')}</select></label>
<label>Chats<select name="chats">${opt('', f.chats, 'Any')}${opt('0', f.chats, '0')}${opt('1', f.chats, '1 or more')}${opt('3', f.chats, '3 or more')}</select></label>
<label>Money paid<select name="paid">${opt('', f.paid, 'Any')}${opt('paid', f.paid, 'Paid')}${opt('free', f.paid, 'Free only')}${opt('20', f.paid, '$20+')}${opt('100', f.paid, '$100+')}</select></label>
<label>Last active<select name="active">${opt('', f.active, 'Any')}${opt('today', f.active, 'Today')}${opt('7', f.active, 'Last 7 days')}${opt('30', f.active, 'Last 30 days')}${opt('older', f.active, 'Over 30 days ago')}</select></label>
<label>&nbsp;<button class="btn">Apply</button></label></form>`;
  const csvHref = '/admin/people.csv' + qs({}).replace(/^\?$/, '');
  const tile = (label: string, v: string | number, sub = '') => `<div class="tile"><span>${h(label)}</span><b>${h(String(v))}</b>${sub ? `<small>${h(sub)}</small>` : ''}</div>`;
  const paying = rows.filter((r) => r.cents > 0).length;

  return shell('people', `<section class="tiles">${tile('Revenue', usd(rev), `${pays} payment${pays === 1 ? '' : 's'}`)}${tile('Visitors', t.home_view ?? 0, 'real browsers, no bots')}${tile('Sign-ups', t.signup ?? 0)}${tile('Paying people', paying, `of ${d.all.users} accounts`)}${tile('All-time revenue', usd(d.all.cents), `${d.all.payments} payments`)}</section>
<section class="grid"><div class="card"><h2>FUNNEL · LAST ${d.days} DAYS</h2>${funnel}</div><div class="card"><h2>REVENUE BY DAY</h2>${chart}<p class="foot">${t.leads_abandoned ?? 0} typed an email but didn't sign up · ${t.leads_opted_in ?? 0} opted in to emails</p></div></section>
<section class="card" style="margin-top:14px"><h2>PEOPLE · ${shown.length}${shown.length !== rows.length ? ` of ${rows.length}` : ''}</h2>
<div class="chips">${painChips}</div>${filters}
<div class="bar-row"><a class="btn ghost" href="${h(csvHref)}">⬇ Export CSV (${shown.length})</a>${shown.length !== rows.length || f.sort ? `<a class="btn ghost" href="/admin?days=${d.days}">Clear filters</a>` : ''}</div>
<div class="tw"><table><tr>${th('pain', 'Pain point')}${th('name', 'Name')}${th('via', 'Via')}${th('chats', 'Chats', 'num')}${th('paid', 'Money paid', 'num')}${th('active', 'Last active')}<th>Free chats</th></tr>${people || '<tr><td colspan="7" class="dim">No one matches.</td></tr>'}</table></div>
<p class="foot">Pain point is worked out from the words in each person's questions. Chat text and birth details are not shown here. The export has emails, so keep the file private.</p></section>`, d.days, notice);
}

export type PostRow = { id: string; slug: string; title: string; summary: string; cover_url: string | null; body: string; status: string; updated_at: string; published_at: string | null };
export function blogTab(posts: PostRow[], edit: PostRow | null | 'new', notice = ''): string {
  if (edit) {
    const p = edit === 'new' ? null : edit;
    return shell('blog', `<section class="card"><h2>${p ? 'EDIT POST' : 'NEW POST'}</h2>
<form method="post" action="/admin/blog${p ? `/${h(p.id)}` : ''}" class="form">
<label>Title<input name="title" required maxlength="160" value="${h(p?.title ?? '')}"></label>
<div class="two"><label>Link (kaalera.com/blog/…) leave empty to make one from the title<input name="slug" maxlength="80" value="${h(p?.slug ?? '')}"></label>
<label>Cover image link (https://…, optional)<input name="coverUrl" maxlength="500" value="${h(p?.cover_url ?? '')}"></label></div>
<label>Summary (shown on the blog list and in Google)<input name="summary" maxlength="300" value="${h(p?.summary ?? '')}"></label>
<label>Text: use ## for headings, - for bullet points, **bold**<textarea name="body" required>${h(p?.body ?? '')}</textarea></label>
<div class="bar-row"><button class="btn" name="status" value="published">Publish</button><button class="btn ghost" name="status" value="draft">Save as draft</button><a class="btn ghost" href="/admin?tab=blog">Cancel</a>${p?.status === 'published' ? `<a class="btn ghost" href="/blog/${h(p.slug)}" target="_blank" rel="noopener">View live ↗</a>` : ''}</div>
</form>${p ? `<form method="post" action="/admin/blog/${h(p.id)}/delete" class="inline"><button class="btn danger">Delete this post</button></form>` : ''}</section>`, 30, notice);
  }
  const list = posts.map((p) => `<tr><td><b>${h(p.title)}</b><small class="dim" style="display:block">/blog/${h(p.slug)}</small></td><td><span class="status st-${p.status === 'published' ? 'published' : 'draft'}">${p.status === 'published' ? 'Published' : 'Draft'}</span></td>
<td>${h((p.published_at ?? p.updated_at).slice(0, 10))}</td><td><a class="btn ghost" href="/admin?tab=blog&edit=${h(p.id)}">Edit</a>${p.status === 'published' ? ` <a class="btn ghost" href="/blog/${h(p.slug)}" target="_blank" rel="noopener">View ↗</a>` : ''}</td></tr>`).join('');
  return shell('blog', `<section class="card"><div class="bar-row"><h2 style="margin:0;flex:1">BLOG POSTS · ${posts.length}</h2><a class="btn" href="/admin?tab=blog&edit=new">+ Write a new post</a></div>
<div class="tw"><table><tr><th>Title</th><th>Status</th><th>Date</th><th></th></tr>${list || '<tr><td colspan="4" class="dim">No posts yet.</td></tr>'}</table></div></section>`, 30, notice);
}

export const PRICE_FIELDS: { key: string; label: string; money: boolean; help: string }[] = [
  { key: 'chatPackCents', label: 'Consultation start price', money: true, help: 'Before taxes & fees. Business pays 10% less.' },
  { key: 'extraQuestionCents', label: 'Extra question price', money: true, help: 'Before taxes & fees. Auto-reload adds 2 at this price.' },
  { key: 'chatPackQuestions', label: 'Questions in a consultation', money: false, help: 'How many questions the start price includes.' },
  { key: 'freeQuestions', label: 'Free questions for new Personal accounts', money: false, help: '' },
  { key: 'quickWords', label: 'Quick answer word limit', money: false, help: 'Quick answers cost half an extra question (2 quick answers per question).' },
  { key: 'taxFeePercent', label: 'Taxes & fees %', money: false, help: 'Added on top at checkout.' },
  { key: 'apiMinRechargeCents', label: 'Business activation minimum', money: true, help: 'First wallet payment needed to use the API.' },
];
export function pricesTab(prices: Record<string, number>, history: { key: string; old_value: string | null; new_value: string; changed_by: string; changed_at: string }[], notice = ''): string {
  const fields = PRICE_FIELDS.map((x) => `<label>${h(x.label)}${x.money ? ' (USD)' : ''}<input name="${x.key}" type="number" min="0" step="${x.money ? '0.01' : '1'}" value="${x.money ? (prices[x.key] / 100).toFixed(2) : prices[x.key]}">${x.help ? `<small class="dim">${h(x.help)}</small>` : ''}</label>`).join('');
  const label = (k: string) => PRICE_FIELDS.find((x) => x.key === k || x.key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`) === k)?.label ?? k;
  const hist = history.map((r) => `<tr><td>${h(r.changed_at.slice(0, 16).replace('T', ' '))}</td><td>${h(label(r.key))}</td><td>${h(r.old_value ?? '–')} → <b>${h(r.new_value)}</b></td></tr>`).join('');
  return shell('prices', `<section class="card"><h2>PRICES</h2><form method="post" action="/admin/prices" class="form"><div class="two">${fields}</div>
<div class="bar-row"><button class="btn">Save prices</button><span class="dim">Changes apply to new checkouts right away.</span></div></form></section>
<section class="card" style="margin-top:14px"><h2>CHANGE LOG</h2><div class="tw"><table><tr><th>When (UTC)</th><th>What</th><th>Change</th></tr>${hist || '<tr><td colspan="3" class="dim">No changes yet.</td></tr>'}</table></div></section>`, 30, notice);
}

export function festivalsTab(list: { id: string; name: string; festival_date: string; starts_on: string; ends_on: string; percent: number; enabled: number }[], notice = ''): string {
  const today = new Date().toISOString().slice(0, 10);
  const rows = list.map((x) => {
    const live = x.enabled && x.percent > 0 && x.starts_on <= today && x.ends_on >= today;
    return `<tr><td><b>${h(x.name)}</b>${live ? ' <span class="status st-published">Running now</span>' : ''}</td><td>${h(x.festival_date)}</td><td class="dim">${h(x.starts_on)} → ${h(x.ends_on)}</td>
<td><form method="post" action="/admin/festivals/${h(x.id)}" class="switch"><input name="percent" type="number" min="0" max="50" value="${x.percent}" style="width:70px">%
<select name="enabled">${opt('1', String(x.enabled), 'On')}${opt('0', String(x.enabled), 'Off')}</select><button class="btn ghost">Save</button></form></td></tr>`;
  }).join('');
  return shell('festivals', `<section class="card"><h2>FESTIVAL OFFERS (PERSONAL ONLY, BUSINESS NEVER GETS OFFERS)</h2>
<div class="tw"><table><tr><th>Festival</th><th>Date</th><th>Offer runs</th><th>Discount</th></tr>${rows || '<tr><td colspan="4" class="dim">No festivals.</td></tr>'}</table></div></section>`, 30, notice);
}

const LOCKED_RULES = [
  'Never mentions Devin, the AI behind it, code, servers, prompts or how Kaalera works',
  'Tricks hidden in customer messages are ignored and can’t change these instructions',
  'Astrology only (app builders are pointed to the Kaalera API)',
  'No death or lifespan predictions, no guarantees',
  'No politics or religious debate',
  'Never writes “chart” or “Vedic”',
  'Exactly one answer per question, in the customer’s language',
  'The customer’s Kundli, periods and transits are always sent from the site',
];
export function kaalTab(fields: KaalField[], history: KaalVersion[], notice = '', loaded: KaalVersion | null = null): string {
  const label = (k: string) => KAAL_FIELDS.find((f) => f.key === k)?.label ?? k;
  const when = (iso: string) => h(iso.slice(0, 16).replace('T', ' '));
  const cards = fields.map((f) => {
    const load = loaded && loaded.key === f.key ? loaded : null;
    const body = load ? load.body || DEFAULT_KAAL_PROMPTS[f.key] : f.body;
    const status = load
      ? `<span class="status st-draft">Opened version from ${when(load.changed_at)}. Not live until you press Save.</span>`
      : f.isOriginal ? '<span class="status st-published">Original</span>'
        : `<span class="status st-published">Edited ${when(f.updatedAt ?? '')} UTC by ${h(f.updatedBy ?? '')}</span>`;
    return `<section class="card" id="k-${f.key}" style="margin-top:14px"><h2>${h(f.label.toUpperCase())}</h2><p class="dim">${h(f.help)} ${status}</p>
<form method="post" action="/admin/kaal/${f.key}" class="form"><textarea name="body" maxlength="${KAAL_MAX_CHARS}" required>${h(body)}</textarea>
<div class="bar-row"><button class="btn" name="action" value="save">Save</button>${f.isOriginal && !load ? '' : '<button class="btn ghost" name="action" value="original" formnovalidate>Restore original</button>'}<span class="dim">Applies to new consultations only. Ongoing ones keep what they started with.</span></div></form></section>`;
  }).join('');
  const rows = history.map((r) => `<tr><td>${when(r.changed_at)}</td><td>${h(label(r.key))}</td><td class="dim" style="white-space:normal;min-width:260px">${r.body ? h(r.body.slice(0, 110)) + (r.body.length > 110 ? '…' : '') : 'Original (built-in)'}</td><td class="dim">${h(r.changed_by)}</td>
<td><a class="btn ghost" href="/admin?tab=kaal&load=${r.id}#k-${h(r.key)}">Open</a> <form method="post" action="/admin/kaal/restore/${r.id}" class="inline"><button class="btn ghost">Restore</button></form></td></tr>`).join('');
  return shell('kaal', `<section class="card"><h2>LOCKED RULES (IN CODE, ALWAYS ON)</h2><ul class="dim" style="margin:0;padding-left:18px;line-height:1.7">${LOCKED_RULES.map((x) => `<li>${h(x)}</li>`).join('')}</ul></section>
${cards}
<section class="card" style="margin-top:14px"><h2>VERSION HISTORY</h2><div class="tw"><table><tr><th>When (UTC)</th><th>Section</th><th>Text</th><th>By</th><th></th></tr>${rows || '<tr><td colspan="5" class="dim">No changes yet. Kaal uses the original text.</td></tr>'}</table></div></section>`, 30, notice);
}

export interface EmailTabOpts {
  draft?: Draft; log: BroadcastRow[]; tokenInfo: { updated_at: string } | null; newToken?: string; notice?: string;
  preview?: { html: string; subject: string; count: number; skipped: number; sample: string } | null;
}
const EMAIL_HELP = '## Heading · **bold** · - list item · [text](https://link) · [button: Open Kaalera](https://kaalera.com) · {{name}} = first name';
export function emailTab(o: EmailTabOpts): string {
  const d: Draft = o.draft ?? { from: 'kaal', kind: 'service', audience: 'emails', emails: '', subject: '', body: 'Hi {{name}},\n\n\n\n[button: Open Kaalera](https://kaalera.com/?app=1)\n\nWarm regards,\nKaal' };
  const radio = (v: string, label: string, help: string) => `<label class="switch" style="flex-direction:row;color:var(--text)"><input type="radio" name="kind" value="${v}"${d.kind === v ? ' checked' : ''}> ${h(label)} <small class="dim">${h(help)}</small></label>`;
  const pv = o.preview
    ? `<section class="card" style="margin-top:14px"><h2>PREVIEW · WILL SEND TO ${o.preview.count}${o.preview.skipped ? ` · ${o.preview.skipped} SKIPPED` : ''}</h2>
<p class="dim">Subject: <b style="color:var(--text)">${h(o.preview.subject)}</b> · shown as it looks for ${h(o.preview.sample)}.${o.preview.skipped ? ' Skipped people have no marketing consent, unsubscribed, are Business accounts or aren\u2019t Kaalera users (promotions only).' : ''}</p>
<iframe sandbox srcdoc="${h(o.preview.html)}" style="width:100%;height:720px;border:0;border-radius:14px;background:#f4efe6"></iframe></section>` : '';
  const log = o.log.map((r) => `<tr><td>${h(r.created_at.slice(0, 16).replace('T', ' '))}</td><td style="white-space:normal;min-width:220px"><b>${h(r.subject)}</b><small class="dim" style="display:block">${h(r.from_addr)}</small></td>
<td><span class="status ${r.kind === 'promo' ? 'st-draft' : 'st-published'}">${r.kind === 'promo' ? 'Promotion' : 'Service'}</span></td><td>${h(AUDIENCES[r.audience as keyof typeof AUDIENCES] ?? r.audience)}</td>
<td class="num">${r.sent}/${r.total}${r.failed ? ` <span style="color:#ff8a80" title="${h(r.error ?? '')}">${r.failed} failed</span>` : ''}</td><td class="dim">${h(r.via === 'api' ? 'API' : r.created_by)}</td></tr>`).join('');
  const token = o.newToken
    ? `<div class="note ok">New API token (shown only now, copy it): <code style="user-select:all;word-break:break-all">${h(o.newToken)}</code></div>`
    : `<p class="dim">${o.tokenInfo ? `Token created ${h(o.tokenInfo.updated_at.slice(0, 16).replace('T', ' '))} UTC. Making a new one stops the old one.` : 'No API token yet.'}</p>`;
  return shell('email', `<section class="card"><h2>WRITE AN EMAIL</h2>
<form method="post" action="/admin/email" class="form">
<div class="two"><label>From<select name="from">${FROM_IDS.map((f) => opt(f, d.from, fromAddress(f))).join('')}</select></label>
<label>To<select name="audience">${Object.entries(AUDIENCES).map(([k, v]) => opt(k, d.audience, v)).join('')}</select></label></div>
<label>Emails (only for \u201cEmails I type below\u201d): separate with commas or new lines, up to ${MAX_RECIPIENTS}<textarea name="emails" style="min-height:70px">${h(d.emails)}</textarea></label>
<div style="display:grid;gap:6px">${radio('service', 'Service message', 'a correction, account or order news. Goes to anyone you pick.')}${radio('promo', 'Promotion', 'offers, news, deals. Only Personal accounts with consent; adds an Unsubscribe link.')}</div>
<label>Subject<input name="subject" required maxlength="200" value="${h(d.subject)}"></label>
<label>Body <small class="dim">${h(EMAIL_HELP)}</small><textarea name="body" required maxlength="50000">${h(d.body)}</textarea></label>
<div class="bar-row"><button class="btn ghost" name="action" value="preview">Preview</button><button class="btn ghost" name="action" value="test">Send test to me</button>
<label class="switch" style="flex-direction:row;margin-left:auto"><input type="checkbox" name="confirm"> I checked the preview</label><button class="btn" name="action" value="send">Send</button></div>
</form></section>${pv}
<section class="card" style="margin-top:14px"><h2>SENT EMAILS</h2><div class="tw"><table><tr><th>When (UTC)</th><th>Subject</th><th>Type</th><th>To</th><th class="num">Sent</th><th>By</th></tr>${log || '<tr><td colspan="6" class="dim">Nothing sent yet.</td></tr>'}</table></div></section>
<section class="card" style="margin-top:14px"><h2>OWNER TOKEN · EMAIL API</h2><p class="dim">The same token also opens every admin page and action (header <code>Authorization: Bearer …</code>), so Devin can run admin for you. Make a new one to cut off the old one.</p>
<p class="dim">Send the same emails from your own tools: <code>POST https://kaalera.com/api/owner/email</code> with header <code>Authorization: Bearer YOUR_TOKEN</code> and JSON <code>{"from":"kaal","kind":"service","to":["name@example.com"],"subject":"Hi {{name}}","body":"Hello **{{name}}**"}</code>. Use <code>"audience":"paid"</code> (all, paid, free, business, optin) instead of <code>to</code> for a list, and <code>"dryRun":true</code> to only count.</p>
${token}<form method="post" action="/admin/email/token" class="inline"><button class="btn ghost">${o.tokenInfo ? 'Make a new token' : 'Create API token'}</button></form></section>`, 30, o.notice ?? '');
}

export function couponsTab(list: Coupon[], site: string, notice = ''): string {
  const rows = list.map((c) => {
    const left = c.max_uses === null ? 'no limit' : `${Math.max(0, c.max_uses - c.uses)} left`;
    const expired = !!c.expires_on && c.expires_on < new Date().toISOString().slice(0, 10);
    const link = `${site}/redeem?code=${encodeURIComponent(c.code)}`;
    return `<tr><td><b style="font-family:ui-monospace,monospace;letter-spacing:.5px">${h(c.code)}</b>${c.note ? `<small class="dim" style="display:block">${h(c.note)}</small>` : ''}</td>
<td>${c.kind === 'percent' ? `${c.value}% off next purchase` : `${c.value} free ${c.value === 1 ? 'chat' : 'chats'}`}</td>
<td class="num">${c.uses} used · ${left}</td><td>${c.expires_on ? h(c.expires_on) : '<span class="dim">never</span>'}</td>
<td><span class="status ${c.enabled && !expired ? 'st-published' : 'st-draft'}">${expired ? 'Expired' : c.enabled ? 'On' : 'Off'}</span></td>
<td><code style="user-select:all;font-size:12px">${h(link)}</code></td>
<td><form method="post" action="/admin/coupons/${encodeURIComponent(c.code)}" class="inline"><input type="hidden" name="enabled" value="${c.enabled ? '0' : '1'}"><button class="btn ghost">${c.enabled ? 'Turn off' : 'Turn on'}</button></form></td></tr>`;
  }).join('');
  return shell('coupons', `<section class="card"><h2>NEW COUPON</h2>
<form method="post" action="/admin/coupons" class="form">
<div class="two"><label>Code (letters, numbers, - or _)<input name="code" required pattern="[A-Za-z0-9][A-Za-z0-9_\\-]{2,23}" maxlength="24" placeholder="DIWALI20" style="text-transform:uppercase"></label>
<label>Gives<select name="kind">${opt('percent', 'percent', '% off the next purchase')}${opt('chats', 'percent', 'Free chats')}</select></label></div>
<div class="two"><label>Amount (% off: 1–90 · free chats: 1–20)<input name="value" type="number" min="1" max="90" required value="10"></label>
<label>Max people (empty = no limit)<input name="max_uses" type="number" min="1" max="100000"></label></div>
<div class="two"><label>Last day (empty = never ends)<input name="expires_on" type="date"></label><label>Note (only you see it)<input name="note" maxlength="200" placeholder="Influencer X, apology, Diwali..."></label></div>
<div class="bar-row"><button class="btn">Create coupon</button></div>
<p class="dim">Each person can use a code once. Business accounts can't use codes. Share the link next to each code, or customers type it at kaalera.com/redeem. A % code is used on their next purchase and doesn't add to a festival offer: they get the bigger of the two.</p>
</form></section>
<section class="card" style="margin-top:14px"><h2>COUPONS</h2><div class="tw"><table><tr><th>Code</th><th>Gives</th><th class="num">Used</th><th>Last day</th><th>Status</th><th>Share link</th><th></th></tr>${rows || '<tr><td colspan="7" class="dim">No coupons yet.</td></tr>'}</table></div></section>`, 30, notice);
}
