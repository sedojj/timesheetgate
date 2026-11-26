"""PRIVACY.md -> docs/privacy.html, the page GitHub Pages serves for the store listing.

Run after changing PRIVACY.md: python3 scripts/privacy_html.py
Handles only what PRIVACY.md uses: headings, paragraphs, bullet lists, bold, code, links.
"""

from __future__ import annotations

import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>
body {{ font: 16px/1.6 system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #1f2933; }}
h1 {{ font-size: 28px; }} h2 {{ font-size: 20px; margin-top: 28px; }}
code {{ background: #f1f3f6; padding: 1px 4px; border-radius: 3px; }}
</style>
</head>
<body>
{body}
</body>
</html>
"""


def _inline(text: str) -> str:
    t = html.escape(text, quote=False)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", r'<a href="\2">\1</a>', t)
    return re.sub(r'(?<!href=")(?<!">)(https?://[^\s<)]+[^\s<).,])', r'<a href="\1">\1</a>', t)


def render(md: str) -> str:
    out: list[str] = []
    blocks = re.split(r"\n\s*\n", md.strip())
    title = "Privacy policy"
    for block in blocks:
        lines = block.splitlines()
        if lines[0].startswith("#"):
            level = len(lines[0]) - len(lines[0].lstrip("#"))
            text = lines[0][level:].strip()
            if level == 1:
                title = text
            out.append(f"<h{level}>{_inline(text)}</h{level}>")
        elif lines[0].startswith("- "):
            items: list[str] = []
            for line in lines:
                if line.startswith("- "):
                    items.append(line[2:].strip())
                else:
                    items[-1] += " " + line.strip()
            out.append("<ul>\n" + "\n".join(f"<li>{_inline(i)}</li>" for i in items) + "\n</ul>")
        else:
            out.append(f"<p>{_inline(' '.join(line.strip() for line in lines))}</p>")
    return PAGE.format(title=html.escape(title), body="\n".join(out))


if __name__ == "__main__":
    target = ROOT / "docs" / "privacy.html"
    target.write_text(render((ROOT / "PRIVACY.md").read_text(encoding="utf-8")), encoding="utf-8")
    (ROOT / "docs" / ".nojekyll").touch()
    print(target.relative_to(ROOT))
    sys.exit(0)
