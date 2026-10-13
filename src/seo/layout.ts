/** Server-rendered public pages (blog, topic pages): full HTML, meta tags and structured data for search and AI crawlers. */
export const SITE_NAME = 'Kaalera';
export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const ldJson = (o: unknown): string => JSON.stringify(o).replace(/</g, '\\u003c');

export interface PageMeta {
  site: string;
  path: string;
  title: string;
  description: string;
  image?: string | null;
  type?: 'website' | 'article';
  jsonLd?: unknown[];
  published?: string | null;
  modified?: string | null;
}

export const TOPIC_LINKS: [string, string][] = [
  ['/kundli', 'Free Kundli online'],
  ['/marriage-prediction', 'Marriage prediction'],
  ['/career-astrology', 'Career astrology'],
  ['/sade-sati', 'Sade Sati check'],
  ['/manglik-dosha', 'Manglik dosha'],
  ['/ai-astrologer', 'AI astrologer'],
];

export const organizationLd = (site: string) => ({
  '@context': 'https://schema.org', '@type': 'Organization', name: SITE_NAME, url: site,
  logo: `${site}/kaal-mark.svg`, email: 'hello@kaalera.com',
});

export const breadcrumbLd = (site: string, items: [string, string][]) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${site}${path}` })),
});

export const faqLd = (faqs: [string, string][]) => ({
  '@context': 'https://schema.org', '@type': 'FAQPage',
  mainEntity: faqs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
});

export function layout(m: PageMeta, main: string): string {
  const url = `${m.site}${m.path}`;
  const image = m.image || `${m.site}/og.png`;
  const article = m.type === 'article';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(m.title)}</title>
<meta name="description" content="${esc(m.description)}">
<link rel="canonical" href="${esc(url)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:type" content="${article ? 'article' : 'website'}">
<meta property="og:title" content="${esc(m.title)}">
<meta property="og:description" content="${esc(m.description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(m.title)}">
<meta name="twitter:description" content="${esc(m.description)}">
<meta name="twitter:image" content="${esc(image)}">
${article && m.published ? `<meta property="article:published_time" content="${esc(m.published)}">` : ''}
${article && m.modified ? `<meta property="article:modified_time" content="${esc(m.modified)}">` : ''}
<link rel="alternate" type="application/rss+xml" title="Kaalera blog" href="${m.site}/blog/rss.xml">
<link rel="icon" href="/kaal-mark.svg" type="image/svg+xml">
<link rel="stylesheet" href="/site.css">
<script src="/theme.js"></script>
${(m.jsonLd ?? []).map((o) => `<script type="application/ld+json">${ldJson(o)}</script>`).join('\n')}
</head>
<body>
<header class="w-top">
  <a class="w-brand" href="/"><img src="/kaal-mark.svg" alt="" width="26" height="26"> Kaalera</a>
  <nav class="w-nav" aria-label="Main">
    <a href="/kundli">Kundli</a><a href="/blog">Blog</a><a href="/developers">Developers</a><a href="/docs">API docs</a><a href="/contact">Contact</a>
    <button class="theme-toggle" type="button" aria-label="Switch dark or light mode"></button>
    <a class="w-cta" href="/">Ask Kaal</a>
  </nav>
</header>
<main class="w-main">
${main}
</main>
<footer class="w-foot">
  <nav aria-label="Topics">${TOPIC_LINKS.map(([href, label]) => `<a href="${href}">${esc(label)}</a>`).join('')}</nav>
  <nav aria-label="Site"><a href="/">Ask Kaal</a><a href="/blog">Blog</a><a href="/developers">Astrology API</a><a href="/docs">API docs</a><a href="/support">Support</a><a href="/contact">Contact</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a></nav>
  <p>Kaalera — AI Vedic astrology. Guidance for reflection only, not professional advice.</p>
</footer>
</body>
</html>`;
}

export const ctaBlock = (heading = 'Ask Kaal about your own future') => `
<aside class="w-ctabox">
  <h2>${esc(heading)}</h2>
  <p>Enter your birth date, time and place. Kaal reads your Kundli and gives dated predictions with remedies. Your first question is free.</p>
  <a class="w-cta big" href="/">Ask Kaal free</a>
</aside>`;
