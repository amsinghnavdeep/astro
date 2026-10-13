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

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** First day of a predicted window, e.g. "Nov 2026 – Jan 2027" → 1 Nov 2026. */
export function windowStart(when: string): Date | null {
  const year = when.match(/\b(20\d{2})\b/)?.[1];
  if (!year) return null;
  const m = when.toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
  const month = m ? MONTHS.indexOf(m[1]) : /\blate\b/i.test(when) ? 8 : /\bmid\b/i.test(when) ? 5 : 0;
  return new Date(Number(year), month, 1);
}

export interface UpNext { area: string; when: string; kind: string; days: number }

/** The nearest predicted window across Kaal's answers that starts this month or later. */
export function nextWindow(answers: string[], now = new Date()): UpNext | null {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  let best: (Omit<UpNext, 'days'> & { at: number }) | null = null;
  for (const a of answers) {
    for (const p of parseAnswer(a).timeline) {
      const at = windowStart(p.when)?.getTime();
      if (at === undefined || at < monthStart) continue;
      if (!best || at < best.at) best = { ...p, at };
    }
  }
  return best && { area: best.area, when: best.when, kind: best.kind, days: Math.ceil((best.at - now.getTime()) / 86400000) };
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
