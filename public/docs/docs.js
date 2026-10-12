/* Kaalera API docs: shared chrome (top bar, sidebar, TOC, pager), code tabs, copy buttons. */
(() => {
  const NAV = [
    { group: 'Getting started', items: [
      ['index', 'Introduction'],
      ['quickstart', 'Quickstart'],
      ['authentication', 'Authentication'],
    ] },
    { group: 'Consultations', items: [
      ['consultations-create', 'Create a consultation', 'post'],
      ['consultations-get', 'Get a consultation', 'get'],
      ['questions-create', 'Ask a follow-up', 'post'],
    ] },
    { group: 'Account', items: [
      ['balance', 'Get balance', 'get'],
    ] },
    { group: 'Reference', items: [
      ['languages', 'Languages'],
      ['pricing', 'Pricing & credits'],
      ['errors', 'Errors & limits'],
    ] },
  ];
  const BASE = location.origin;
  const href = (slug) => (slug === 'index' ? '/docs' : `/docs/${slug}`);
  const flat = NAV.flatMap((g) => g.items);
  const page = document.body.dataset.page || 'index';
  const idx = Math.max(0, flat.findIndex(([s]) => s === page));
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const el = (tag, attrs = {}, html = '') => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    n.innerHTML = html;
    return n;
  };

  /* ---------- chrome ---------- */
  const article = document.querySelector('.d-article');
  const top = el('header', { class: 'd-top' }, `
    <button class="d-menu" type="button" aria-label="Open navigation">&#9776;</button>
    <a class="d-brand" href="/docs"><span class="d-logo">ॐ</span>Kaalera <span class="d-pill">Docs</span></a>
    <nav class="d-top-links">
      <a href="/docs">API reference</a>
      <a href="/">App</a>
      <a class="cta" href="/developers">Dashboard</a>
    </nav>`);
  const side = el('aside', { class: 'd-side' }, NAV.map((g) => `<h5>${g.group}</h5>` + g.items.map(([s, label, m]) =>
    `<a href="${href(s)}"${s === page ? ' class="active" aria-current="page"' : ''}>${m ? `<span class="m ${m}">${m.toUpperCase()}</span>` : ''}${label}</a>`,
  ).join('')).join(''));
  const main = el('main', { class: 'd-main' });
  const toc = el('aside', { class: 'd-toc' });
  const shell = el('div', { class: 'd-shell' });
  const scrim = el('div', { class: 'd-scrim' });
  article.replaceWith(shell);
  shell.append(side, main, toc);
  main.append(article);
  document.body.prepend(top);
  document.body.append(scrim);

  const group = NAV.find((g) => g.items.some(([s]) => s === page));
  if (group) article.prepend(el('p', { class: 'd-eyebrow' }, group.group));

  const prev = flat[idx - 1];
  const next = flat[idx + 1];
  article.append(el('nav', { class: 'pager' },
    (prev ? `<a class="prev" href="${href(prev[0])}"><small>&larr; Previous</small><strong>${prev[1]}</strong></a>` : '') +
    (next ? `<a class="next" href="${href(next[0])}"><small>Next &rarr;</small><strong>${next[1]}</strong></a>` : '')));
  article.append(el('footer', { class: 'd-foot' }, `<span>&copy; ${new Date().getFullYear()} Kaalera</span><span><a href="/developers">Manage API keys</a></span>`));

  const toggleNav = (open) => document.body.classList.toggle('nav-open', open);
  top.querySelector('.d-menu').addEventListener('click', () => toggleNav(!document.body.classList.contains('nav-open')));
  scrim.addEventListener('click', () => toggleNav(false));

  /* ---------- base URL ---------- */
  document.querySelectorAll('.base').forEach((n) => { n.textContent = BASE; });
  document.querySelectorAll('pre code').forEach((n) => { n.textContent = n.textContent.replaceAll('{BASE}', BASE); });

  /* ---------- syntax highlight (tiny, grayscale) ---------- */
  const RULES = {
    json: /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?\b)/g,
    code: /((?<=^|\s)(?:\/\/|#)[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(const|let|await|async|import|from|return|if|while|for|def|print|curl|new|function|in|not|True|False|None)\b/gm,
  };
  const highlight = (code, lang) => {
    const src = code.textContent;
    const json = lang === 'json' || /^response|^json|^\d{3}/i.test(lang);
    let out = '';
    let last = 0;
    const re = new RegExp(json ? RULES.json : RULES.code);
    for (let m; (m = re.exec(src));) {
      out += esc(src.slice(last, m.index));
      if (json) {
        if (m[1] && m[2]) out += `<span class="tok-k">${esc(m[1])}</span>${m[2]}`;
        else if (m[1]) out += `<span class="tok-s">${esc(m[1])}</span>`;
        else out += `<span class="tok-n">${esc(m[0])}</span>`;
      } else if (m[1]) out += `<span class="tok-c">${esc(m[1])}</span>`;
      else if (m[2]) out += `<span class="tok-s">${esc(m[2])}</span>`;
      else out += `<span class="tok-f">${esc(m[0])}</span>`;
      last = m.index + m[0].length;
    }
    code.innerHTML = out + esc(src.slice(last));
  };

  /* ---------- code groups ---------- */
  const PREF = 'kaalera-docs-lang';
  const groups = [];
  document.querySelectorAll('.code').forEach((box) => {
    const pres = [...box.querySelectorAll(':scope > pre')];
    const head = el('div', { class: 'code-head' });
    const tabbed = pres.length > 1;
    if (!tabbed) head.append(el('span', { class: 'code-title' }, esc(box.dataset.title || pres[0]?.dataset.lang || '')));
    const tabs = pres.map((pre, i) => {
      const code = pre.querySelector('code') || pre;
      highlight(code, pre.dataset.lang || box.dataset.title || '');
      if (!tabbed) return null;
      const b = el('button', { class: 'code-tab', type: 'button' }, esc(pre.dataset.lang || `Tab ${i + 1}`));
      b.addEventListener('click', () => { select(i); localStorage.setItem(PREF, pre.dataset.lang || ''); syncAll(pre.dataset.lang); });
      head.append(b);
      return b;
    });
    const copy = el('button', { class: 'code-copy', type: 'button', 'aria-label': 'Copy code' }, 'Copy');
    head.append(copy);
    box.prepend(head);
    let current = 0;
    const select = (i) => {
      current = i;
      pres.forEach((p, j) => { p.hidden = j !== i; });
      tabs.forEach((t, j) => t && t.classList.toggle('active', j === i));
    };
    copy.addEventListener('click', async () => {
      const text = pres[current].textContent;
      try { await navigator.clipboard.writeText(text); } catch {
        const ta = el('textarea'); ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy'; }, 1400);
    });
    groups.push({ pres, select });
    select(0);
  });
  const syncAll = (lang) => groups.forEach((g) => {
    const i = g.pres.findIndex((p) => p.dataset.lang === lang);
    if (i >= 0) g.select(i);
  });
  const saved = localStorage.getItem(PREF);
  if (saved) syncAll(saved);

  /* ---------- headings, TOC, scrollspy ---------- */
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const heads = [...article.querySelectorAll('h2, h3')].filter((h) => !h.closest('.pager'));
  heads.forEach((h) => {
    if (!h.id) h.id = slug(h.textContent);
    h.append(el('a', { class: 'anchor', href: `#${h.id}`, 'aria-hidden': 'true' }, '#'));
  });
  if (heads.length) {
    toc.innerHTML = '<h6>On this page</h6>' + heads.map((h) =>
      `<a href="#${h.id}"${h.tagName === 'H3' ? ' class="sub"' : ''}>${esc(h.textContent.replace(/#$/, ''))}</a>`).join('');
    const links = [...toc.querySelectorAll('a')];
    const spy = () => {
      let active = 0;
      heads.forEach((h, i) => { if (h.getBoundingClientRect().top < 120) active = i; });
      links.forEach((a, i) => a.classList.toggle('active', i === active));
    };
    addEventListener('scroll', spy, { passive: true });
    spy();
  }
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
})();
