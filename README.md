# BYU ByteBack

**Independent academic project. BYU ByteBack is not affiliated with, sponsored by, or endorsed by Brigham Young University.**

A responsive, single-page landing site for a proposed student initiative that gives unused technology a second life. Built with plain HTML, CSS, and JavaScript. No framework, build process, backend, or external runtime services are required.

## Get a local copy

Anyone with the project files can run the site on their own computer. On GitHub, choose **Code → Download ZIP** and extract the folder, or clone it:

```sh
git clone https://github.com/ikefoxy/isaac-business-startup.git
cd isaac-business-startup
```

Open the folder containing `index.html` in VS Code. No `npm install`, account, API key, or build step is needed.

## Run on localhost in VS Code

With **Python 3** installed:

1. Choose **Terminal → Run Task**.
2. Select **Preview BYU ByteBack on localhost**.
3. Open **http://localhost:4173/** in your browser.

The included task uses `python3` on macOS/Linux and `py` on Windows. Keep its terminal running while viewing the site. Press **Ctrl+C** in that terminal to stop the server.

If you already use the **Live Server** extension, you can instead right-click `index.html` and choose **Open with Live Server**; use the local address it opens.

## Run on localhost from a terminal

From the folder containing `index.html`, run one of these commands.

**macOS / Linux:**

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

**Windows:**

```sh
py -m http.server 4173 --bind 127.0.0.1
```

Visit **http://localhost:4173/**. If port 4173 is already serving this project, use the running preview. Otherwise, replace `4173` with an unused port such as `4174` in both the command and browser address. If the Python command is unavailable, install Python 3 or use VS Code's Live Server option above.

`localhost` refers to the viewer's own computer. Sharing a localhost link does not share the website; each viewer needs a local copy and a running preview server. A public website would require a separate hosting step such as GitHub Pages.

You can also open `index.html` directly, though some browsers restrict local storage on `file://` pages. A local server provides the most reliable form preview. All fonts and artwork are included locally, so the site needs no internet connection once downloaded.

## Files

- `index.html` — Semantic page sections, navigation, form, FAQ, and search/social metadata.
- `styles.css` — Responsive layouts, visual treatments, reduced-motion support, and focus states.
- `script.js` — Mobile navigation, CTA interest selection, accessible form validation, local request storage, and scroll reveals.
- `.vscode/tasks.json` — Ready-to-run localhost preview task for VS Code.
- `assets/second-life.svg` — Original laptop and circular-economy illustration.
- `assets/favicon.svg` — Original circular-arrow brand mark.
- `assets/social-card.svg` — Editable social preview artwork.
- `assets/social-card.png` — Social preview image compatible with sharing services.
- `assets/manrope-variable.ttf` and `assets/FONT-LICENSE.txt` — Self-hosted Manrope font and its SIL Open Font License.

## Form behavior

The form requires a name, email, interest, and message. Organization is optional. Donation and partner buttons select the corresponding interest automatically. A successful submission saves the latest request in this browser's `localStorage` under `byu-byteback-prototype-request`, replacing the previous prototype request.

**No information is transmitted and no follow-up is promised.** The confirmation explicitly explains this and lets the visitor delete the saved request or start another. If local storage is unavailable, the page shows an error instead of claiming success. JavaScript must be enabled to submit; all page content and FAQ answers remain available without it.

## GitHub Pages readiness

All runtime files and links are relative, so the site can be hosted at a GitHub Pages repository URL without a build step.

When publication is authorized, GitHub Pages can serve these files from the repository root. Set the social image metadata to the final absolute public URL (for example, `https://ikefoxy.github.io/isaac-business-startup/assets/social-card.png`) and add `og:url` after confirming the deployment URL. The proposed domain **byubyteback.org** is displayed as a proposal; there is no `CNAME` file or claim that the domain is registered or active.

## Verification

Verified in Chrome at ten viewport widths from 320 to 1920 pixels with no horizontal page overflow. Browser checks covered navigation targets, mobile menu and keyboard controls, FAQ expansion, CTA interest selection, form validation, local saving and deletion, reload persistence, unavailable local storage, reduced motion, and use without JavaScript. Form submission triggered no network requests. No console errors or missing assets were found.

Automated axe checks reported no WCAG 2 A/AA or WCAG 2.1 AA violations on the checked desktop and mobile states. HTML structural validation and JavaScript syntax checks also passed. These automated checks supplement a visual review; they are not a claim of full accessibility certification.

## Project status

BYU ByteBack is a proposed student project created for an academic assignment. It is not affiliated with, sponsored by, or endorsed by Brigham Young University. Device collection, data erasure, refurbishment, distribution, and recycling describe the intended business model; this prototype does not operate those services or claim achieved impact.
