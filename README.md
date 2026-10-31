# Harshith Mohan Kumar — Personal Website

Source for my personal website: a photographic homepage, a gallery of favorite pictures, and a professional page for research and engineering. The existing Quarto blog and article URLs remain available.

**Visit the site:** [harsh188.github.io](https://harsh188.github.io/)

## Local development

Clone the repository, sync the portfolio, and preview the published files with Python 3:

```sh
git clone https://github.com/Harsh188/harsh188.github.io.git
cd harsh188.github.io
python3 scripts/sync-portfolio.py
python3 -m http.server 8765 --directory docs
```

Open [localhost:8765](http://localhost:8765). Edit the HTML, CSS, JavaScript, or assets in `portfolio/`, then rerun the sync command and refresh the browser. The sync is additive: it leaves the blog and other existing pages in place.

To edit the blog or other Quarto pages, install the [Quarto CLI](https://quarto.org/docs/get-started/), update the relevant `.qmd` files, and render:

```sh
quarto render
```

The output directory is `docs/`, as configured in `_quarto.yml`. Its post-render hook automatically runs the portfolio sync, so a Quarto build keeps the new homepage and updates the search index.

## Project structure

| Path | Purpose |
| --- | --- |
| `portfolio/index.html` | Personal homepage and featured photographs |
| `portfolio/pictures.html` | Photography gallery with an image viewer |
| `portfolio/work.html` | Professional background, publications, and writing |
| `portfolio/assets/` | Approved website photographs, research image, and resume |
| `scripts/sync-portfolio.py` | Copies the portfolio into `docs/` and refreshes search entries |
| `index.qmd` | Legacy homepage source; replaced by the portfolio after rendering |
| `publications.qmd` | Legacy research publications page |
| `blog.qmd` | Blog listing |
| `blog/` | Individual blog posts and their assets |
| `experience/` | Experience page sources |
| `about.qmd`, `fun.qmd` | Additional page sources |
| `images/` | Profile photo, favicon, and other images |
| `resumes/` | Resume PDFs |
| `_quarto.yml` | Site navigation, themes, and render configuration |
| `_sandstone.scss` | Stylesheet referenced by the HTML configuration |
| `docs/` | Published website files, including the preserved blog |

## Updating the site

1. Edit `portfolio/` for the homepage, pictures, and work pages, or the relevant `.qmd` files for the blog.
2. Run `python3 scripts/sync-portfolio.py` for portfolio changes, or `quarto render` for Quarto changes.
3. Preview `docs/` locally and review the affected pages.
4. Commit both the source changes and `docs/`, then push to `master`.

GitHub Pages publishes this repository's `master` branch from the `/docs` folder. The public address remains [harsh188.github.io](https://harsh188.github.io/); no redirect to another host is needed.

## Offline gallery and photo viewer

On the Pictures page, **Save gallery offline** downloads the published photographs, previews, homepage, gallery, fonts, and viewer to that browser. Wait for **31 photos ready offline** (the count follows the current gallery) before leaving the connection. Keep the page open during the download. A saved gallery refreshes when the site is revisited online; failed updates retain the previous complete copy. **Remove offline copy** clears the saved collection from that device. Browser storage can be cleared or evicted, so check the ready status before relying on offline access.

The viewer supports pinch/trackpad zoom, double-tap/double-click zoom, dragging to pan, a 90° rotation button, reset, and hiding controls. Swipe changes photos at fit size; dragging pans when zoomed. Keyboard: arrows navigate, `+`/`−` zoom, `0` fits, `r` rotates, and Escape closes. Rotating is temporary and never edits the photograph.

`scripts/sync-portfolio.py` generates `docs/gallery-manifest.json` from the visible gallery and local dependencies, including content hashes and byte counts. Originals and retired/unreferenced pictures are not added to this download. The service worker verifies downloaded bytes before activating a new saved collection. No backend or third-party CDN is required. Viewer.js 1.15.2 and the existing Google Fonts are vendored with their licenses.

After changes, run `python3 scripts/sync-portfolio.py` and `node scripts/test-gallery-offline.mjs`. For browser verification, save locally, stop the preview server, reopen the gallery and homepage, and inspect photos that were not previously opened. Check rotation, zoom, keyboard focus, and a narrow phone viewport before publishing.
