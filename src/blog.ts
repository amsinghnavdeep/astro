import type { D1Database } from '@cloudflare/workers-types';
import { renderMarkdown } from './markdown.js';
import { breadcrumbLd, ctaBlock, esc, layout, organizationLd, SITE_NAME, TOPIC_LINKS } from './seo/layout.js';

export interface Post {
  id: string; slug: string; title: string; summary: string; cover_url: string | null; body: string;
  status: 'draft' | 'published'; created_at: string; updated_at: string; published_at: string | null;
}
export interface PostInput { slug: string; title: string; summary: string; coverUrl: string | null; body: string; status: Post['status'] }

const nowIso = (): string => new Date().toISOString();
export const slugify = (s: string): string =>
  s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

export const listPosts = async (db: D1Database, publishedOnly: boolean): Promise<Post[]> =>
  (await db.prepare(`SELECT * FROM blog_posts ${publishedOnly ? "WHERE status = 'published'" : ''}
    ORDER BY COALESCE(published_at, updated_at) DESC LIMIT 500`).all<Post>()).results;
export const getPublishedPost = (db: D1Database, slug: string) =>
  db.prepare("SELECT * FROM blog_posts WHERE slug = ? AND status = 'published'").bind(slug).first<Post>();
export const getPost = (db: D1Database, id: string) => db.prepare('SELECT * FROM blog_posts WHERE id = ?').bind(id).first<Post>();

export async function savePost(db: D1Database, id: string | null, p: PostInput): Promise<{ post?: Post; error?: 'not_found' | 'slug_taken' }> {
  const now = nowIso();
  const old = id ? await getPost(db, id) : null;
  if (id && !old) return { error: 'not_found' };
  const taken = await db.prepare('SELECT id FROM blog_posts WHERE slug = ?').bind(p.slug).first<{ id: string }>();
  if (taken && taken.id !== id) return { error: 'slug_taken' };
  const publishedAt = p.status === 'published' ? (old?.published_at ?? now) : (old?.published_at ?? null);
  const post: Post = {
    id: old?.id ?? crypto.randomUUID(), slug: p.slug, title: p.title, summary: p.summary, cover_url: p.coverUrl, body: p.body,
    status: p.status, created_at: old?.created_at ?? now, updated_at: now, published_at: publishedAt,
  };
  await db.batch([
    db.prepare(`INSERT INTO blog_posts (id, slug, title, summary, cover_url, body, status, created_at, updated_at, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, title = excluded.title, summary = excluded.summary, cover_url = excluded.cover_url,
        body = excluded.body, status = excluded.status, updated_at = excluded.updated_at, published_at = excluded.published_at`)
      .bind(post.id, post.slug, post.title, post.summary, post.cover_url, post.body, post.status, post.created_at, post.updated_at, post.published_at),
    bumpStmt(db),
  ]);
  versionCache = null;
  return { post };
}

export async function deletePost(db: D1Database, id: string): Promise<boolean> {
  const [r] = await db.batch([db.prepare('DELETE FROM blog_posts WHERE id = ?').bind(id), bumpStmt(db)]);
  versionCache = null;
  return (r.meta?.changes ?? 0) > 0;
}

/* Edge-cache key version: bumped on every blog change, so cached pages refresh everywhere within seconds. */
const bumpStmt = (db: D1Database) =>
  db.prepare(`INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('blog_version', ?, ?, 'blog')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(String(Date.now()), nowIso());
let versionCache: { at: number; v: string } | null = null;
export async function blogVersion(db: D1Database): Promise<string> {
  if (versionCache && Date.now() - versionCache.at < 15_000) return versionCache.v;
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'blog_version'").first<{ value: string }>();
  versionCache = { at: Date.now(), v: row?.value ?? '0' };
  return versionCache.v;
}

/* ---------- rendering ---------- */

const fmtDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '';
const minutes = (body: string): number => Math.max(1, Math.round(body.split(/\s+/).length / 200));

const card = (p: Post): string => `
<article class="w-card">
  ${p.cover_url ? `<a href="/blog/${esc(p.slug)}"><img class="w-card-img" src="${esc(p.cover_url)}" alt="" loading="lazy"></a>` : ''}
  <h2><a href="/blog/${esc(p.slug)}">${esc(p.title)}</a></h2>
  <p>${esc(p.summary)}</p>
  <p class="w-meta"><time datetime="${esc(p.published_at ?? '')}">${fmtDate(p.published_at)}</time> · ${minutes(p.body)} min read</p>
</article>`;

export function blogIndexPage(site: string, posts: Post[]): string {
  return layout({
    site, path: '/blog', title: 'Vedic Astrology Blog — Kundli, Dasha, Sade Sati & Remedies | Kaalera',
    description: 'Plain-English guides to Vedic astrology: Kundli, Mahadasha, Sade Sati, Manglik dosha, Rahu and Ketu, remedies, and building with an AI astrology API.',
    jsonLd: [organizationLd(site), breadcrumbLd(site, [['Home', '/'], ['Blog', '/blog']]), {
      '@context': 'https://schema.org', '@type': 'Blog', name: 'Kaalera blog', url: `${site}/blog`,
      blogPost: posts.slice(0, 50).map((p) => ({ '@type': 'BlogPosting', headline: p.title, url: `${site}/blog/${p.slug}`, datePublished: p.published_at })),
    }],
  }, `
<section class="w-hero">
  <p class="w-kicker">Kaalera blog</p>
  <h1>Vedic astrology, explained simply</h1>
  <p class="w-lead">Guides to your Kundli, planetary periods, doshas and remedies, plus notes for developers building with the Kaalera astrology API.</p>
</section>
<div class="w-grid">${posts.map(card).join('') || '<p>No posts yet.</p>'}</div>
${ctaBlock()}`);
}

export function blogPostPage(site: string, p: Post, more: Post[]): string {
  const path = `/blog/${p.slug}`;
  return layout({
    site, path, title: `${p.title} | Kaalera`, description: p.summary || p.title, image: p.cover_url, type: 'article',
    published: p.published_at, modified: p.updated_at,
    jsonLd: [breadcrumbLd(site, [['Home', '/'], ['Blog', '/blog'], [p.title, path]]), {
      '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title, description: p.summary,
      image: p.cover_url || `${site}/og.png`, datePublished: p.published_at, dateModified: p.updated_at,
      author: { '@type': 'Organization', name: SITE_NAME, url: site },
      publisher: { '@type': 'Organization', name: SITE_NAME, logo: { '@type': 'ImageObject', url: `${site}/kaal-mark.svg` } },
      mainEntityOfPage: `${site}${path}`, wordCount: p.body.split(/\s+/).length,
    }],
  }, `
<article class="w-article">
  <nav class="w-crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/blog">Blog</a></nav>
  <h1>${esc(p.title)}</h1>
  <p class="w-meta"><time datetime="${esc(p.published_at ?? '')}">${fmtDate(p.published_at)}</time> · ${minutes(p.body)} min read · By Kaalera</p>
  ${p.cover_url ? `<img class="w-cover" src="${esc(p.cover_url)}" alt="">` : ''}
  ${p.summary ? `<p class="w-lead">${esc(p.summary)}</p>` : ''}
  <div class="w-prose">${renderMarkdown(p.body)}</div>
</article>
${ctaBlock()}
${more.length ? `<section class="w-more"><h2>More from the blog</h2><div class="w-grid">${more.map(card).join('')}</div></section>` : ''}`);
}

/* ---------- crawler files ---------- */

const STATIC_PAGES = ['/', '/blog', '/contact', '/affiliates', '/influencers', '/terms', '/privacy', '/developers', '/docs', '/docs/quickstart', '/docs/authentication', '/docs/consultations-create',
  '/docs/consultations-get', '/docs/questions-create', '/docs/balance', '/docs/languages', '/docs/errors', '/docs/pricing', '/support'];

export function sitemapXml(site: string, posts: Post[]): string {
  const urls = [
    ...[...STATIC_PAGES, ...TOPIC_LINKS.map(([h]) => h)].map((p) => `<url><loc>${site}${p}</loc></url>`),
    ...posts.map((p) => `<url><loc>${site}/blog/${esc(p.slug)}</loc><lastmod>${p.updated_at.slice(0, 10)}</lastmod></url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export function rssXml(site: string, posts: Post[]): string {
  const items = posts.slice(0, 50).map((p) => `<item><title>${esc(p.title)}</title><link>${site}/blog/${esc(p.slug)}</link>
<guid isPermaLink="true">${site}/blog/${esc(p.slug)}</guid><pubDate>${new Date(p.published_at ?? p.updated_at).toUTCString()}</pubDate>
<description>${esc(p.summary)}</description></item>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>Kaalera blog</title><link>${site}/blog</link>
<description>Vedic astrology guides and AI astrology API notes from Kaalera.</description><language>en</language>
${items.join('\n')}
</channel></rss>\n`;
}

export function robotsTxt(site: string): string {
  const privateRules = ['Disallow: /admin', 'Disallow: /api/', 'Disallow: /auth/', 'Disallow: /v1/'];
  const bots = ['*', 'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Bingbot'];
  return `${bots.map((b) => `User-agent: ${b}\nAllow: /\n${privateRules.join('\n')}`).join('\n\n')}\n\nSitemap: ${site}/sitemap.xml\n`;
}

export function llmsTxt(site: string, posts: Post[]): string {
  return `# Kaalera

> Kaalera is an AI Vedic astrology service. Its AI astrologer, Kaal, reads a person's Kundli from their birth date, time and place and answers questions about marriage, career, money, health and family with dated predictions, one short line on the main planetary issue, and 1-2 remedies. The first question is free; paid packs add more questions. Kaalera also offers a public REST API so developers can add an AI astrology agent to their own apps.

## For people
- [Ask Kaal (chat)](${site}/): ask a question about your future; first question free.
${TOPIC_LINKS.map(([h, l]) => `- [${l}](${site}${h})`).join('\n')}

## For developers (AI astrology agent API)
- [Developers](${site}/developers): create API keys, top up a prepaid USD wallet, try the API.
- [API quickstart](${site}/docs/quickstart): create a consultation and ask questions over HTTPS with a Bearer key.
- [Full API reference for AI assistants](${site}/llms-full.txt)
- Base URL: ${site}/v1 · Auth: \`Authorization: Bearer kal_live_...\` · Business & API pricing 10% below standard: $9 to start a consultation, $6.30 per follow-up, $100 minimum first recharge.

## Blog
${posts.map((p) => `- [${p.title}](${site}/blog/${p.slug}): ${p.summary}`).join('\n')}

## Notes
- Readings are astrological guidance for reflection only, not medical, legal or financial advice. All sales are final.
`;
}
