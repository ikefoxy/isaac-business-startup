# BYU ByteBack

A responsive, single-page landing site for a proposed student initiative that gives unused technology a second life. Built with plain HTML, CSS, and JavaScript. No framework, build process, backend, or external runtime services are required.

## Preview in VS Code

1. Open this project folder in VS Code.
2. If you use the **Live Server** extension, right-click `index.html` and choose **Open with Live Server**.
3. Alternatively, open **Terminal → New Terminal** and run:

   ```sh
   python3 -m http.server 4173 --bind 127.0.0.1
   ```

4. Visit **http://127.0.0.1:4173**. Stop the server with **Ctrl+C**.

You can also open `index.html` directly, though some browsers restrict local storage on `file://` pages. A local server provides the most reliable form preview.

## Files

- `index.html` — Semantic page sections, navigation, form, FAQ, and search/social metadata.
- `styles.css` — Responsive layouts, visual treatments, reduced-motion support, and focus states.
- `script.js` — Mobile navigation, CTA interest selection, accessible form validation, local request storage, and scroll reveals.
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
