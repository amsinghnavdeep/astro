export const prerender = false;
import type { APIRoute } from 'astro';

const origin = 'https://siddhjyotish.com';
const lastmod = new Date().toISOString().slice(0, 10);

const urls = [
  { loc: `${origin}/`, changefreq: 'weekly', priority: '1.0' },
  { loc: `${origin}/contact`, changefreq: 'monthly', priority: '0.6' },
  { loc: `${origin}/returning`, changefreq: 'monthly', priority: '0.7' },
];

export const GET: APIRoute = () => {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (url) => `  <url>
    <loc>${url.loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>
  </url>`,
  )
  .join('\n')}
</urlset>`;

  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
