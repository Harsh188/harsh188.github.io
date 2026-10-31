#!/usr/bin/env python3
"""Overlay the static portfolio without deleting Quarto's existing blog pages."""

import json
import hashlib
import os
import re
from html.parser import HTMLParser
from pathlib import Path
from shutil import copy2
from urllib.parse import quote, urljoin, urlsplit
from xml.etree import ElementTree as ET


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


class GalleryFiles(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = set()
        self.photos = []
        self.current_photo = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'script' and attrs.get('src'):
            self.urls.add(attrs['src'])
        if tag == 'link' and attrs.get('rel') in {'stylesheet', 'icon'}:
            self.urls.add(attrs['href'])
        if tag == 'button' and attrs.get('data-photo'):
            self.current_photo = {'source': attrs['data-photo']}
            self.urls.add(attrs['data-photo'])
        if tag == 'img' and attrs.get('src'):
            self.urls.add(attrs['src'])
            if self.current_photo:
                self.current_photo['preview'] = attrs['src']
                self.photos.append(self.current_photo)
                self.current_photo = None


def gallery_manifest(output):
    """Version only visible, approved photos and their offline page dependencies."""
    urls = {'index.html', 'pictures.html'}
    photos = []
    for name in ('index.html', 'pictures.html'):
        parser = GalleryFiles()
        parser.feed((output / name).read_text())
        urls.update(parser.urls)
        if name == 'pictures.html':
            photos = parser.photos
    pending = list(urls)
    checked = set()
    resources = []
    while pending:
        url = pending.pop()
        if url in checked:
            continue
        checked.add(url)
        parsed = urlsplit(url)
        if parsed.scheme or parsed.netloc or url.startswith('/') or '..' in Path(parsed.path).parts:
            raise SystemExit(f'Offline resource must be a local portfolio file: {url}')
        path = output / parsed.path
        if not path.is_file():
            raise SystemExit(f'Missing offline resource: {path}')
        contents = path.read_bytes()
        resources.append({'url': url, 'bytes': len(contents), 'sha256': hashlib.sha256(contents).hexdigest()})
        if path.suffix == '.css':
            for dependency in re.findall(r'url\([\s\"\']*([^\)\"\']+)[\s\"\']*\)', contents.decode()):
                if not dependency.startswith('data:'):
                    pending.append(urljoin(parsed.path, dependency.strip()))
    resources.sort(key=lambda resource: resource['url'])
    revision = hashlib.sha256(json.dumps({'resources': resources, 'photos': photos}, sort_keys=True).encode()).hexdigest()[:20]
    manifest = {'version': 1, 'revision': revision, 'photoCount': len(photos),
                'totalBytes': sum(resource['bytes'] for resource in resources), 'photos': photos, 'resources': resources}
    (output / 'gallery-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Offline gallery: {len(photos)} photos, {manifest["totalBytes"] / 1e6:.2f} MB, revision {revision}.')


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
    gallery_manifest(output)

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

    namespace = "http://www.sitemaps.org/schemas/sitemap/0.9"
    ET.register_namespace("", namespace)
    sitemap = ET.Element(f"{{{namespace}}}urlset")
    for page in sorted(output.rglob("*.html")):
        relative = page.relative_to(output)
        if "site_libs" in relative.parts:
            continue
        path = relative.as_posix()
        if page.name == "index.html":
            path = path[:-len("index.html")]
        url = ET.SubElement(sitemap, f"{{{namespace}}}url")
        ET.SubElement(url, f"{{{namespace}}}loc").text = "https://harsh188.github.io/" + quote(path)
    ET.indent(sitemap, space="  ")
    ET.ElementTree(sitemap).write(output / "sitemap.xml", encoding="utf-8", xml_declaration=True)
    print(f"Synced {len(files)} portfolio files to {output}; existing blog files retained.")


if __name__ == "__main__":
    main()
