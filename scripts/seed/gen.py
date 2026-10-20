"""Generates migrations/0009_seed_posts.sql from posts_a.py + posts_b.py."""
import sys, uuid, datetime, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from posts_a import POSTS as A
from posts_b import POSTS as B
q = lambda s: "'" + s.replace("'", "''") + "'"
start = datetime.datetime(2026, 9, 28, 9, 0, tzinfo=datetime.timezone.utc)
out = ["-- Starter blog posts (editable or removable in /admin)."]
for i, (slug, title, summary, body) in enumerate(A + B):
    assert 'chart' not in (title + summary + body).lower(), slug
    ts = (start + datetime.timedelta(days=i)).isoformat().replace('+00:00', '.000Z')
    pid = str(uuid.uuid5(uuid.NAMESPACE_URL, 'kaalera-post:' + slug))
    out.append(f"INSERT INTO blog_posts (id, slug, title, summary, cover_url, body, status, created_at, updated_at, published_at) VALUES ({q(pid)}, {q(slug)}, {q(title)}, {q(summary)}, NULL, {q(body)}, 'published', {q(ts)}, {q(ts)}, {q(ts)}) ON CONFLICT(slug) DO NOTHING;")
p = pathlib.Path(__file__).parents[2] / 'migrations' / '0009_seed_posts.sql'
p.write_text('\n'.join(out) + '\n'); print(p, len(A + B), 'posts')
