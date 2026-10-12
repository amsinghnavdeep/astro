"""Generates the Kaalera trishul mark (7 hexagons joined by bars) and the inline chat loader."""
import glob, math, re, sys

R = 86
N = {'tl': (203, 300), 'bl': (203, 572), 'tc': (445, 170), 'mc': (445, 432), 'bc': (445, 695), 'tr': (686, 300), 'br': (686, 572)}
EDGES = [('tl', 'bl'), ('tc', 'mc'), ('mc', 'bc'), ('tr', 'br'), ('bl', 'bc'), ('br', 'bc')]
GROUP = {'p1': ['tl', 'bl'], 'p2': ['tc', 'mc', 'bc'], 'p3': ['tr', 'br']}
SAFFRON, BLACK, GOLD = ('#ffa53a', '#ec6d0a'), ('#3a3a3a', '#0b0b0b'), ('#ffc94d', '#f08a12')
VARIANTS = {
    'a': {k: SAFFRON if k in ('tc', 'mc', 'bc') else BLACK for k in N},   # saffron centre prong, black sides
    'b': {k: SAFFRON if k in ('tl', 'tc', 'tr') else BLACK for k in N},   # saffron prong tips, black body
}
EDGE = '#f59e0b'

def hexpts(cx, cy, r):
    return ' '.join(f"{cx + r * math.cos(math.radians(a)):.1f},{cy + r * math.sin(math.radians(a)):.1f}" for a in range(-90, 270, 60))

def svg(col, p, cls=None, standalone=True):
    d, out = [], []
    for k, (a, b) in col.items():
        x, y = N[k]
        d.append(f'<linearGradient id="{p}{k}" gradientUnits="userSpaceOnUse" x1="{x-R}" y1="{y-R}" x2="{x+R}" y2="{y+R}"><stop offset="0" stop-color="{a}"/><stop offset="1" stop-color="{b}"/></linearGradient>')
    d.append(f'<linearGradient id="{p}bar" gradientUnits="userSpaceOnUse" x1="200" y1="170" x2="690" y2="700"><stop offset="0" stop-color="{GOLD[0]}"/><stop offset="1" stop-color="{GOLD[1]}"/></linearGradient>')
    bars = ''.join(f'<line x1="{N[a][0]}" y1="{N[a][1]}" x2="{N[b][0]}" y2="{N[b][1]}"/>' for a, b in EDGES)
    out.append(f'<g stroke="url(#{p}bar)" stroke-width="34" stroke-linecap="round">{bars}</g>')
    for g, ks in GROUP.items():
        parts = []
        for k in ks:
            parts.append(f'<polygon points="{hexpts(*N[k], R-9)}" fill="url(#{p}{k})" stroke="url(#{p}{k})"/>')
            if col[k] == BLACK:
                parts.append(f'<polygon points="{hexpts(*N[k], R-3)}" fill="none" stroke="{EDGE}" stroke-width="7"/>')
        out.append(f'<g class="piece {g}" stroke-width="18" stroke-linejoin="round">{"".join(parts)}</g>')
    attrs = (' xmlns="http://www.w3.org/2000/svg"' if standalone else '') + (f' class="{cls}"' if cls else '')
    attrs += ' role="img" aria-label="Kaalera"' if standalone else ' aria-hidden="true"'
    return f'<svg{attrs} viewBox="88 66 714 714"><defs>{"".join(d)}</defs>{"".join(out)}</svg>'

if __name__ == '__main__':
    live = sys.argv[1] if len(sys.argv) > 1 else 'a'
    alt = 'b' if live == 'a' else 'a'
    open('public/kaal-mark.svg', 'w').write(svg(VARIANTS[live], 'k'))
    open('public/kaal-mark-alt.svg', 'w').write(svg(VARIANTS[alt], 'k'))
    for f in glob.glob('public/**/*.html', recursive=True):
        s = open(f).read()
        n = re.sub(r'<svg[^>]*class="loader-mark".*?</svg>', lambda m: svg(VARIANTS[live], 'l', 'loader-mark', False), s, flags=re.S)
        if n != s:
            open(f, 'w').write(n)
