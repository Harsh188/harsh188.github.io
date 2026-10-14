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
