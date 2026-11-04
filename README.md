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

On the Pictures page, open **Take the gallery offline** below the photographs, then choose **Save gallery offline**. This downloads the published photographs, previews, homepage, gallery, fonts, and viewer to that browser. Wait for **35 photos ready offline** (the count follows the current gallery) before leaving the connection. Keep the page open during the download. A saved gallery refreshes when the site is revisited online; failed updates retain the previous complete copy. **Remove offline copy** clears the saved collection from that device. Browser storage can be cleared or evicted, so check the ready status before relying on offline access.

The charcoal viewer contains the photograph above a title, capture date, and rating tray. It supports pinch/trackpad zoom, double-tap/double-click zoom, dragging to pan, a 90° rotation button, fullscreen where supported, reset, and hiding controls. Enlarged photographs stay clipped to their viewing area so captions and stars remain readable. Swipe changes photos at fit size; dragging pans when zoomed. Keyboard: arrows navigate, `+`/`−` zoom, `0` fits, `r` rotates, and Escape closes. Rotating is temporary and never edits the photograph.

`scripts/sync-portfolio.py` generates `docs/gallery-manifest.json` from the visible gallery and local dependencies, including content hashes and byte counts. Originals and retired/unreferenced pictures are not added to this download. The service worker verifies downloaded bytes before activating a new saved collection. Offline browsing needs no backend or third-party CDN. Viewer.js 1.15.2 and the existing Google Fonts are vendored with their licenses.

After changes, run `python3 scripts/sync-portfolio.py` and `node scripts/test-gallery-offline.mjs`. For browser verification, save locally, stop the preview server, reopen the gallery and homepage, and inspect photos that were not previously opened. Check rotation, zoom, keyboard focus, and a narrow phone viewport before publishing.

## Collections and visitor favorites

The Pictures page opens with an editorial **Selected** view. **Collections** shows photographic covers that unfold into related series; **All photographs** keeps the complete archive in capture-date order. These views share one DOM trigger per photograph, preserving all 35 images in the viewer. Collections use native disclosures with explicit membership rather than grouping every photograph from the same day. Deep links reveal the enclosing collection. The viewer and offline save include all photos, including closed collections. Keep each `data-photo-id` stable when re-exporting an image.

Visitors can rate the currently enlarged photo from 1–5 stars without leaving the viewer or signing in. Gallery grids have no repeated voting panels. Moving to another photo during a save never changes the vote’s target. One random browser ID identifies a mutable vote per photo; tabs share that ID. The separate Sites/D1 service stores votes and computes the homepage favorites using a Bayesian score that accounts for vote counts. The homepage keeps its curated selection when there are no votes or the service is unavailable. Ratings require connectivity and are never queued in the offline cache.

The public endpoint is configured in `portfolio/ratings-config.js`. Backend source and maintenance instructions are in `ratings-service/README.md`; its separate Sites project is `appgprj_6aeac0be7e5081919f952eafb2b40cd5`. Publish backend changes through Sites while preserving that identity and the runtime `RATING_IP_SECRET`. The secret is stored only in Sites. Temporary HMAC hashes of IP addresses limit rapid voting; raw IP addresses are not stored by the application. Anonymous voting cannot enforce one person per vote across cleared browser storage or changing networks.

For a local browser check, run `python3 scripts/sync-portfolio.py`, then `node scripts/preview-gallery.mjs` with Node 22.13 or newer. It serves only `127.0.0.1:8791`, uses the real Worker with ephemeral SQLite, and overrides public rating configuration only in preview responses. Test votes disappear when the process stops and never reach production. `--vote-delay-ms=1500` can exercise navigation during a save.

Run `node scripts/test-gallery-ratings.mjs`, `node scripts/test-photo-viewer.mjs`, and `node --test ratings-service/tests/ratings.test.mjs` for the cross-tab, asynchronous refresh, SQL, ranking, and abuse-limit checks. When adding or removing photos, update the service allowlist and redeploy it alongside the gallery.
