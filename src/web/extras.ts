import { renderMarkdown } from '../markdown.js';

const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?';
const WHEN = new RegExp(`(?:(?:early|mid|late)\\s+)?${MONTH}\\s*(?:\\d{4})?\\s*(?:[–-]|to)\\s*${MONTH}\\s+\\d{4}|(?:(?:early|mid|late)\\s+)?${MONTH}\\s+\\d{4}|\\b20\\d{2}\\s*[–-]\\s*20\\d{2}\\b|\\b20\\d{2}\\b`, 'i');

const ICONS: [RegExp, string][] = [
  [/job|career|work|promotion|business|offer|naukri/i, 'career'],
  [/marri|wedding|spouse|partner|love|relationship|vivah|shaadi/i, 'love'],
  [/money|income|wealth|finance|property|house|home|land/i, 'money'],
  [/health|illness|surgery|stress/i, 'health'],
  [/travel|abroad|foreign|visa|relocat/i, 'travel'],
  [/child|baby|family|parent|education|study|exam/i, 'family'],
];
const iconFor = (area: string): string => ICONS.find(([re]) => re.test(area))?.[1] ?? 'star';

export interface Parsed { main: string; next: string[]; timeline: { area: string; when: string; kind: string }[] }

/** Splits Kaal's Markdown into the main answer, the "Ask me next" suggestions and dated timeline points. */
export function parseAnswer(md: string): Parsed {
  const lines = md.split('\n');
  const i = lines.findIndex((l) => /^\s*(?:#+\s*)?\**\s*ask me next\b/i.test(l));
  let next: string[] = [];
  let mainLines = lines;
  if (i >= 0) {
    mainLines = lines.slice(0, i);
    next = lines.slice(i + 1)
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/\*\*/g, '').replace(/^["“]|["”]$/g, '').trim())
      .filter((l) => l.length > 3 && l.length < 220)
      .slice(0, 3);
  }
  const timeline: Parsed['timeline'] = [];
  let inPast = false;
  for (const l of mainLines) {
    if (/from your past/i.test(l)) inPast = true;
    else if (/\*\*predictions\*\*/i.test(l)) inPast = false;
    const m = /^\s*[-*•]\s*\*\*([^*]{2,40}?):?\*\*:?\s*(.*)$/.exec(l);
    if (!m || inPast) continue;
    const w = WHEN.exec(m[2]);
    if (w) timeline.push({ area: m[1].replace(/:$/, '').trim(), when: w[0].replace(/\s+/g, ' ').trim(), kind: iconFor(m[1]) });
  }
  return { main: mainLines.join('\n').trimEnd(), next, timeline: timeline.length >= 2 ? timeline.slice(0, 6) : [] };
}

export const isPdfRequest = (text: string): boolean =>
  text.length <= 120 && /\bpdf\b|पीडीएफ/i.test(text);

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Opens a printable report so the customer can "Save as PDF". */
export function openReport(o: { name: string; birth: string; msgs: { role: string; body: string; createdAt: string }[] }): void {
  const w = window.open('', '_blank');
  if (!w) return;
  const qa = o.msgs.map((m) => m.role === 'user'
    ? `<div class="q">${esc(m.body)}</div>`
    : `<div class="a">${renderMarkdown(parseAnswer(m.body).main)}</div>`).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Kaalera reading — ${esc(o.name)}</title>
<style>
body{font:15px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1410;max-width:720px;margin:32px auto;padding:0 20px}
.cover{border-bottom:2px solid #e8892b;padding-bottom:16px;margin-bottom:24px}
.brand{color:#e8892b;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:12px}
h1{margin:6px 0 4px;font-size:26px}.meta{color:#6b5d50;font-size:13px}
.q{background:#f6efe7;border-radius:10px;padding:10px 14px;margin:20px 0 8px;font-weight:600}
.a{page-break-inside:auto}.a strong{color:#000}
footer{margin-top:32px;border-top:1px solid #ddd;padding-top:12px;color:#6b5d50;font-size:12px}
@media print{body{margin:0}}
</style></head><body>
<div class="cover"><div class="brand">Kaalera · Reading by Kaal</div><h1>${esc(o.name)}</h1>
<div class="meta">${esc(o.birth)} · Prepared ${esc(new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }))}</div></div>
${qa}
<footer>Astrological guidance for personal reflection only — not medical, legal, financial or other professional advice. Predictions are not guaranteed. Continue your consultation at kaalera.com.</footer>
<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>
</body></html>`);
  w.document.close();
}

const MON = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?';
const DAY_MON = `(?:(?:[Ee]arly|[Mm]id|[Ll]ate)[\\s-]+)?(?:\\d{1,2}\\s+)?${MON}`;
const DATE_RE = new RegExp(
  `\\b(?:${DAY_MON}(?:\\s+\\d{4})?\\s*(?:[–—-]|to)\\s*${DAY_MON}\\s+\\d{4}|${DAY_MON}\\s+\\d{4}|20\\d{2}\\s*[–—-]\\s*20\\d{2})\\b`,
  'g',
);

/** Wraps predicted dates and windows ("Nov 2026 – Jan 2027", "31 Oct 2026") in highlighted chips. */
export function markDates(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('code, pre, a, .k-date') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  for (const node of nodes) {
    const text = node.data;
    DATE_RE.lastIndex = 0;
    if (!DATE_RE.test(text)) continue;
    DATE_RE.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(DATE_RE)) {
      const at = m.index ?? 0;
      if (at > last) frag.append(text.slice(last, at));
      const chip = document.createElement('span');
      chip.className = 'k-date';
      chip.textContent = m[0];
      frag.append(chip);
      last = at + m[0].length;
    }
    if (last < text.length) frag.append(text.slice(last));
    node.replaceWith(frag);
  }
}
