"""Builds /privacy/ and /terms/ from the Privacy Policy and Terms that ship
inside the Mike app, so the website and the app can never say different things.

    python3 scripts/build_legal.py [path/to/NavAI/docs/legal]

Defaults to ../navai/docs/legal. The documents are Markdown with a few
{placeholders}; they're filled with the same values the app uses. The Privacy
Policy gets one extra section here, about the website itself and the
in-browser preview, which the app's copy has no reason to describe.
"""
from __future__ import annotations

import html
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / "navai" / "docs" / "legal"

LEGAL_VERSION = "2026-09-25"
VALUES = {
    "publisher": "Huddlecode",
    "website": "https://huddlecode.com",
    "version": "1.0.0",
    "updated": date.fromisoformat(LEGAL_VERSION).strftime("%-d %B %Y"),
    "data_dir": "%LOCALAPPDATA%\\Mike",
    "contact": "visit https://huddlecode.com",
    "account_terms": "You don't need an account to use Mike.",
}

WEBSITE_SECTION = """## This website and the browser preview

This section is about huddlecode.com, not the Mike app.

- **Hosting.** The website is served by Cloudflare. Like any web host, it
  processes standard request information (such as your IP address and browser)
  to deliver pages and protect the site from abuse.
- **No tracking.** The website uses no cookies, no analytics and no
  advertising.
- **The browser preview ("Try Mike").** Unlike the desktop app, the preview
  runs on a cloud AI model. When you send a message there, the conversation is
  sent to a hosted AI service to generate Mike's reply: Cloudflare Workers AI
  first, with NVIDIA's hosted models as a backup. That provider's own terms and
  privacy policy apply to it. We don't store preview conversations:
  they're kept only in your browser tab and disappear when you close it. Your
  IP address is used, briefly, to limit how many messages can be sent each
  minute. Please don't enter anything sensitive in the preview.
"""


def fill(text: str) -> str:
    for k, v in VALUES.items():
        text = text.replace("{" + k + "}", v)
    return text


def inline(s: str) -> str:
    s = html.escape(s, quote=False)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<![\w*])\*([^*\n]+)\*(?![\w*])", r"<em>\1</em>", s)
    s = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", r'<a href="\2" rel="noopener">\1</a>', s)
    s = re.sub(r"(?<![\"'>/])\b(https?://[^\s<)]+[^\s<).,])", r'<a href="\1" rel="noopener">\1</a>', s)
    return s


def slug(text: str) -> str:
    s = re.sub(r"<[^>]+>", "", text).lower()
    s = re.sub(r"^\d+\.\s*", "", s)
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def markdown(md: str) -> tuple[str, str, list[tuple[str, str]]]:
    """(title, body html, table of contents)."""
    lines = md.splitlines()
    out: list[str] = []
    toc: list[tuple[str, str]] = []
    title = ""
    para: list[str] = []
    items: list[str] | None = None
    list_tag = ""
    table: list[str] = []

    def flush_para():
        nonlocal para
        if para:
            out.append("<p>" + inline(" ".join(para)) + "</p>")
            para = []

    def flush_list():
        nonlocal items
        if items is not None:
            out.append(f"<{list_tag}>" + "".join(f"<li>{inline(i)}</li>" for i in items) + f"</{list_tag}>")
            items = None

    def flush_table():
        nonlocal table
        if table:
            rows = [[c.strip() for c in r.strip().strip("|").split("|")] for r in table]
            head, body = rows[0], [r for r in rows[2:]]
            out.append('<div class="table"><table><thead><tr>' + "".join(f"<th>{inline(c)}</th>" for c in head)
                       + "</tr></thead><tbody>" + "".join(
                           "<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in body)
                       + "</tbody></table></div>")
            table = []

    for raw in lines:
        line = raw.rstrip()
        if line.startswith("|"):
            flush_para(); flush_list()
            table.append(line)
            continue
        flush_table()
        m_h = re.match(r"^(#{1,3})\s+(.*)$", line)
        m_ul = re.match(r"^[-*]\s+(.*)$", line)
        m_ol = re.match(r"^\d+\.\s+(.*)$", line)
        if m_h:
            flush_para(); flush_list()
            level, text = len(m_h.group(1)), m_h.group(2)
            if level == 1:
                title = text
                continue
            sid = slug(text)
            if text.startswith("This website"):
                sid = "preview"
            if level == 2:
                toc.append((sid, re.sub(r"^\d+\.\s*", "", text)))
            out.append(f'<h{level} id="{sid}">{inline(text)}</h{level}>')
        elif m_ul or m_ol:
            flush_para()
            tag = "ul" if m_ul else "ol"
            if items is None or list_tag != tag:
                flush_list()
                items, list_tag = [], tag
            items.append((m_ul or m_ol).group(1))
        elif not line.strip():
            flush_para(); flush_list()
        elif items is not None and raw.startswith((" ", "\t")):
            items[-1] += " " + line.strip()
        else:
            flush_list()
            para.append(line.strip())
    flush_para(); flush_list(); flush_table()
    return title, "\n".join(out), toc


PAGE = """<!doctype html>
<html lang="en" class="no-js">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>{title} — Mike</title>
<meta name="description" content="{description}" />
<meta name="theme-color" content="#faf9f7" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#1a1917" media="(prefers-color-scheme: dark)" />
<link rel="canonical" href="https://huddlecode.com/{path}/" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,500;0,8..60,600;1,8..60,400&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/assets/site.css" />
<link rel="stylesheet" href="/assets/legal.css" />
<script>document.documentElement.classList.remove("no-js")</script>
</head>
<body>
{sprite}
<nav class="nav" aria-label="Main">
  <div class="nav__inner">
    <a class="brand" href="/" aria-label="Mike home">
      <svg class="nibmark" aria-hidden="true"><use href="#nib"/></svg>
      <span class="brand__name">Mike</span>
    </a>
    <div class="nav__links">
      <a class="hide-sm" href="/privacy/"{privacy_current}>Privacy</a>
      <a class="hide-sm" href="/terms/"{terms_current}>Terms</a>
      <a href="/chat/">Try Mike</a>
      <a class="btn btn--ink btn--sm" href="/#download">Download</a>
    </div>
  </div>
</nav>
<main class="legal wrap">
  <header class="legal__head">
    <p class="eyebrow">Legal</p>
    <h1>{title}</h1>
    <p class="legal__meta">Last updated {updated} · Applies to Mike {version} and huddlecode.com</p>
  </header>
  <div class="legal__grid">
    <aside class="legal__toc" aria-label="On this page">
      <p>On this page</p>
      <ol>{toc}</ol>
    </aside>
    <article class="legal__body">
{body}
    </article>
  </div>
</main>
<footer class="footer">
  <div class="footer__legal">
    <span>© 2026 Huddlecode</span>
    <span><a href="/privacy/">Privacy Policy</a> · <a href="/terms/">Terms of Use</a> · <a href="/">Home</a></span>
  </div>
</footer>
<script src="/assets/site.js" defer></script>
</body>
</html>
"""

SPRITE = """<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <mask id="nib-cut" maskUnits="userSpaceOnUse" x="-1" y="-1" width="2" height="2">
      <path d="M0 0C.07 .13 .2 .3 .19 .46L.13 .68H-.13L-.19 .46C-.2 .3-.07 .13 0 0Z" fill="#fff"/>
      <circle cy=".45" r=".045"/><rect x="-.011" y=".08" width=".022" height=".36"/>
    </mask>
    <symbol id="nib" viewBox="0 0 100 100">
      <g transform="translate(24.76 17.69) rotate(-38) scale(120.588)">
        <path d="M0 0C.07 .13 .2 .3 .19 .46L.13 .68H-.13L-.19 .46C-.2 .3-.07 .13 0 0Z" style="fill:var(--nib)" mask="url(#nib-cut)"/>
        <path d="M-.1518 .6H.1518L.13 .68H-.13Z" style="fill:var(--collar)"/>
      </g>
    </symbol>
  </defs>
</svg>"""


def build(name: str, path: str, description: str, extra: str = "") -> None:
    md = fill((SRC / name).read_text(encoding="utf-8"))
    # The app's "Last updated" line becomes the page's own header.
    md = re.sub(r"^\*\*Last updated:.*$\n?", "", md, flags=re.M)
    if extra:
        md = md.replace("## Changes to this policy", extra + "\n## Changes to this policy", 1) \
            if "## Changes to this policy" in md else md + "\n" + extra
    title, body, toc = markdown(md)
    page = PAGE.format(
        title=title, description=description, path=path, sprite=SPRITE,
        updated=VALUES["updated"], version=VALUES["version"],
        toc="".join(f'<li><a href="#{sid}">{html.escape(t)}</a></li>' for sid, t in toc),
        body=body,
        privacy_current=' aria-current="page"' if path == "privacy" else "",
        terms_current=' aria-current="page"' if path == "terms" else "",
    )
    out = ROOT / "public" / path / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page, encoding="utf-8")
    print("wrote", out.relative_to(ROOT))


if __name__ == "__main__":
    build("PRIVACY.md", "privacy", "What Mike keeps, where it keeps it, and the few times it uses the internet.",
          WEBSITE_SECTION)
    build("TERMS.md", "terms", "The terms for using Mike.")
