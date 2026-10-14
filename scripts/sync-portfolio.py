#!/usr/bin/env python3
"""Overlay the static portfolio without deleting Quarto's existing blog pages."""

import json
import os
from html.parser import HTMLParser
from pathlib import Path
from shutil import copy2


class PageText(HTMLParser):
    """Collect the title and visible main content for Quarto's search index."""

    def __init__(self):
        super().__init__()
        self.in_title = False
        self.in_main = False
        self.hidden_depth = 0
        self.title = []
        self.text = []

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self.in_title = True
        elif tag == "main":
            self.in_main = True
        if tag in {"script", "style", "dialog"}:
            self.hidden_depth += 1

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        elif tag == "main":
            self.in_main = False
        if tag in {"script", "style", "dialog"}:
            self.hidden_depth -= 1

    def handle_data(self, data):
        if self.in_title:
            self.title.append(data)
        if self.in_main and not self.hidden_depth:
            self.text.append(data)


def main():
    root = Path(__file__).resolve().parent.parent
    source = root / "portfolio"
    output = root / os.environ.get("QUARTO_PROJECT_OUTPUT_DIR", "docs")
    output.mkdir(parents=True, exist_ok=True)

    files = sorted(path for path in source.rglob("*") if path.is_file())
    if not (source / "index.html").is_file():
        raise SystemExit("Missing portfolio/index.html; nothing was copied.")
    for path in files:
        target = output / path.relative_to(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        copy2(path, target)
    (output / ".nojekyll").touch()

    search_path = output / "search.json"
    entries = json.loads(search_path.read_text()) if search_path.exists() else []
    pages = sorted(source.glob("*.html"))
    names = {page.name for page in pages}
    entries = [entry for entry in entries if entry["href"].split("#")[0] not in names]
    for page in pages:
        parser = PageText()
        parser.feed(page.read_text())
        entries.append({
            "objectID": page.name,
            "href": page.name,
            "title": "".join(parser.title).strip(),
            "section": "",
            "text": " ".join(" ".join(parser.text).split()),
        })
    search_path.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n")
    print(f"Synced {len(files)} portfolio files to {output}; existing blog files retained.")


if __name__ == "__main__":
    main()
