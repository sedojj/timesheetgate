"""docs/privacy.html (GitHub Pages, linked from the store listing) is PRIVACY.md as HTML."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("privacy_html", ROOT / "scripts" / "privacy_html.py")
privacy_html = importlib.util.module_from_spec(spec)
spec.loader.exec_module(privacy_html)


def test_published_page_matches_privacy_md():
    expected = privacy_html.render((ROOT / "PRIVACY.md").read_text(encoding="utf-8"))
    assert (ROOT / "docs" / "privacy.html").read_text(encoding="utf-8") == expected, \
        "run: python3 scripts/privacy_html.py"


def test_markdown_becomes_html():
    html = privacy_html.render("# Title\n\nSome **bold** and `code`, see [repo](https://x.test).\n\n- one\n- two\n")
    assert "<h1>Title</h1>" in html
    assert "<p>Some <strong>bold</strong> and <code>code</code>, see <a href=\"https://x.test\">repo</a>.</p>" in html
    assert "<ul>\n<li>one</li>\n<li>two</li>\n</ul>" in html
    assert (ROOT / "docs" / ".nojekyll").exists()  # GitHub Pages serves the file as is
