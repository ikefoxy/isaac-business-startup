# BYU ByteBack — functional MVP

Turn community tech waste into educational opportunity for Provo-area college students. A welcoming homepage and a guided four-step app connect donors and students. The design uses warm paper colors, clear next steps, and personal notes from the donor to the next student.

**Independent academic project; not affiliated with, sponsored by, or endorsed by Brigham Young University.**

## Run it

Requires Python 3.10+ and a modern browser. No package installation or build step is required.

```sh
python3 server.py
```

On Windows, use `py server.py`. Open **http://localhost:4173/app.html** for the app or **http://localhost:4173/** for the landing page. VS Code's **Terminal → Run Task → Preview BYU ByteBack on localhost** runs the same server.

If port 4173 is already occupied, use another port:

```sh
PORT=4174 PUBLIC_URL=http://localhost:4174 python3 server.py
```

On Windows, set `PORT` and `PUBLIC_URL` in `.env` instead. Use the exact `PUBLIC_URL` hostname in your browser (localhost and 127.0.0.1 are different origins).

The full app needs `server.py`. Live Server, `python -m http.server`, opening an HTML file directly, and GitHub Pages can display the landing page but cannot run accounts, orders, or shipping. The app explains this if its backend is unavailable.

## What works

- **Magic-link accounts:** 15-minute, single-use links; hashed tokens; 24-hour HttpOnly sessions; CSRF and same-origin checks; sign-out and per-account order access.
- **Device selection:** visual laptop/desktop/tablet selector, condition checklist, charger option, battery-safety confirmation, 10-device basket, removal, data-wipe pledge, and estimated device-weight impact.
- **Handoff:** drop-off or shipping selection, return-address format validation, package dimensions and weight, and optional notes. EasyPost verifies addresses before live label creation.
- **Shipping labels:** printable mock labels in local demo mode; configurable EasyPost USPS/FedEx rating and label purchasing in live mode. An organizer-defined spending ceiling applies. Carrier test labels are identified as test postage.
- **Tracking:** saved activity timeline with dashboard refresh every 15 seconds. Carrier data is retrieved at most once per minute per active shipment. Carrier transit status and organizer-verified refurbishment progress remain separate.
- **Management:** saved orders, edit notes/address before processing, cancel eligible orders, QR drop-off/pickup passes, printable summaries, unique receipts, and share prompts.
- **Email:** automatic order/action receipts in a test inbox; STARTTLS SMTP delivery when live mode is configured. Failed delivery is visible and can be retried.
- **Student flow:** searchable/sortable refurbished computer catalog, student eligibility acknowledgement, reservation, pickup pass, cancellation/restocking, and organizer-confirmed collection. Listed prices are due at pickup; no online payment processing.
- **Custom donor reward:** choose a personal $20 ByteBack credit or a $20 code to give to a friend. One code is issued per collected device, never just for submitting a donation. Personal codes work only for the donor; gift codes work for another student. Codes apply up to $20 to a priced reservation, have no cash value or remaining balance, are held during reservation, restored on cancellation, and used on collection. Demo credits are explicitly labeled.
- **Personal touches:** optional first name and a note to the next student, with an explicit notice that these appear in the catalog. Donors receive a named welcome and a reward email after collection. No fabricated testimonials or campus partnerships.
- **Organizer workflow:** configured organizer accounts can advance verified processing stages. A donation reaching “Ready for student” adds its devices to the catalog. Before publishing, the organizer enters verified specifications and a whole-dollar pickup price from $0 to $500; $0 makes the device free. Legacy API callers without listing details retain the free default. All devices in a donation must be collected before the donation is complete.

Device selection and reward preference are saved in localStorage; addresses and login tokens are not. The current step, return address, and optional personal note are kept in this tab’s sessionStorage so a refresh does not erase an unfinished donation. The draft resets after successful submission. Submitted orders, sessions, inventory, rewards, and receipt copies are stored server-side in SQLite under `.data/`. Restarting the server preserves them. No account data or credentials are committed to Git or exposed by the static file server.

## A five-minute classroom walkthrough

1. Open **Donate a device**. Add a fictional laptop, confirm its battery is safe, and continue.
2. Choose drop-off or shipping. For shipping, enter a fictional US address and package measurements.
3. Choose whether to keep your $20 thank-you or give it to a friend. Optionally add your first name and a note to the next student. Review, accept the data-wipe pledge, and sign in with a fictional email address. Click **Open demo sign-in link** in the dialog, then confirm the donation.
4. View its QR pass or generate/print a **test** shipping label. Open **My ByteBack**, then expand **Email & receipts** to see the automatic receipt. Reload to demonstrate persistence.
5. Expand **Classroom demo controls** to simulate receiving, verified erasure, and refurbishment. At the final step, add verified specifications and a pickup price, then publish to the catalog. These controls are intentionally visible only in local demo mode; live status changes require an organizer account.
6. Sign out and sign in with a second fictional email. Open **Find a computer**, locate the donated model, and reserve it. Confirm collection with the test control.
7. Sign back into the donor account. The collected donation now shows a $20 reward code under **Your rewards**. Try it on a priced reservation from the donor account for a personal code, or from a different account for a gift code. A second browser context can demonstrate dashboard polling.
8. To test cancellation, reserve another device and cancel before collection; it returns to the catalog. To test email retries, use **Resend receipt**.

**Demo mode is local-only, binds to 127.0.0.1, and never sends external email or buys postage.** The demo sign-in link is visible to the person requesting it, so fictional email addresses are not verified identities in this mode. Do not expose the demo server publicly or enter sensitive personal information. No real drop-off location, available hardware, partner reward, physical data wipe, or refurbishment service is claimed.

## Connect real services

Copy `.env.example` to `.env` and fill the commented settings. Do not put secrets in frontend JavaScript or commit `.env`.

For real email and account ownership verification, set `BYTEBACK_MODE=live`, an HTTPS `PUBLIC_URL`, the SMTP host/user/password/from address, `ADMIN_EMAILS`, and a confirmed `DROPOFF_DESCRIPTION`. Live startup requires these settings. SMTP uses port 587 with STARTTLS by default. Run behind an HTTPS reverse proxy; the bundled HTTP server is a small local/pilot implementation, not a production hosting platform.

Use a **separate `BYTEBACK_DB`** for live operation so test orders and identities are not carried over. Sample inventory is only seeded and shown in demo mode. Real inventory is created through organizer-verified donations. Log in as an email listed in `ADMIN_EMAILS` to access **Organizer workspace**.

For postage, configure `EASYPOST_API_KEY`, a real receiving address in `SHIP_TO_JSON`, and `MAX_LABEL_USD`. Use an EasyPost test key first; production keys spend real money from the organizer’s shipping account. Shipping remains disabled without a key. The app verifies the sender address, obtains USPS/FedEx rates, selects the lowest USD rate within the limit, and stores the shipment ID before purchasing. Retrying an interrupted request retrieves the existing shipment rather than creating another. Once a carrier shipment exists, editing/cancellation requires organizer handling outside the app; carrier refunds/voiding are not implemented.

Integration reference: [EasyPost shipments](https://docs.easypost.com/docs/shipments), [carrier trackers](https://docs.easypost.com/docs/trackers). Carrier events are polled rather than delivered through webhooks. No paid postage or real SMTP delivery was exercised during local verification; those require service credentials and a sandbox acceptance test.

Email receipts acknowledge orders, not charitable contributions. Tax-deduction receipts, SMS, campus maps, cash payouts, payment collection, courier pickup, partial-batch rejection/recycling, and shipping refund administration are outside this MVP. There are no invented tax valuations or campus partnerships. Inventory reservations persist until collection or cancellation; automatic expiry is not implemented.

## Verification

Run the independent HTTP/SQLite tests:

```sh
python3 -m unittest discover -s tests -v
node --check app.js
```

Tests cover single-use authentication, unauthorized access, CSRF, origin validation, private-file protection, invalid donations/addresses, idempotent submissions, competing reservations, cancellation/restocking, order editing, mock labels and receipts, live role enforcement, and the full donation → catalog → reservation → collection → donor-reward lifecycle, personal/gift-code access, discount application, cancellation restoration, and organizer pricing. Tests use a temporary database and never alter your app data.

Browser checks exercised donation, sign-in, reservation, cancellation, reload persistence, QR rendering, and screen widths of 320, 375, 768, and 1440 pixels. Checked donation and dashboard screens had no automated WCAG 2 A/AA or WCAG 2.1 AA violations. Automated checks do not constitute accessibility certification.

## Files

- `index.html`, `brand.css`: redesigned responsive homepage and shared visual system. `styles.css` and `script.js` are retained legacy assets; the new homepage does not load them.
- `app.html`, `app.css`, `app.js`: functional app, donation wizard, catalog, dashboard, dialogs, and print layouts.
- `server.py`: dependency-free HTTP backend, SQLite persistence, authentication, SMTP, and EasyPost adapter.
- `.env.example`: local/live configuration template.
- `tests/test_server.py`: isolated backend integration tests.
- `qr.js`: vendored qrcode-generator 1.4.4, MIT licensed (see `assets/QR-LICENSE.txt`). QR codes contain the pass identifier only, never account credentials.
- `assets/`: original artwork, favicon, social card, self-hosted Manrope font and licenses.

Keep `.data/` backed up if preserving pilot orders. To reset a disposable local demo, stop the server, move `.data/byteback.sqlite3` and any matching WAL/SHM files aside, and restart. Use a new `BYTEBACK_DB` path for a fresh test without deleting anything.
