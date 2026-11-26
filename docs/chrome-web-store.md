# Publishing to the Chrome Web Store (unlisted)

For colleagues only: the listing is **Unlisted** (installable by anyone with the link, not
shown in search). Google reviews it like any other item; site access to SPP and Apps Script
makes it an in-depth review (days to weeks).

## 1. Build the upload

```bash
cd extension && npm ci && npm run build:store
```

This writes `extension/dist-store/` and `extension/timesheetgate-<version>.zip`: the same code
as `dist/`, without the `"key"` field (the store assigns its own extension ID). Keep using
`dist/` for your own unpacked install; the store version is a separate extension with its own
ID, so its data folder and "Allow on every visit" are set up once more after installing.

Every upload needs a higher version; the build uses `0.<git commit count>`, so commit first.

## 2. Dashboard → Store listing

- **Name:** Timesheetgate — Make Minutes Multiply
- **Summary** (max 132 characters): Keep your hours in a local file and sync them into your
  SuiteProjects Pro timesheet with one click. Never submits.
- **Description:**

  > Timesheetgate shows your SuiteProjects Pro (SPP) week in Chrome's side panel next to the
  > open timesheet, from a local file (`entries.csv`) that you, scripts or AI agents can edit.
  > Click Sync to save your hours into SPP — it only saves, it never submits.
  >
  > - Week view grouped by project; add lines and projects in the panel.
  > - Optional: your Google Calendar meetings for the week, through an Apps Script you deploy
  >   in your own account (read-only); drag a meeting onto a line to log it.
  > - Public holidays from your calendar, one click to enter them.
  > - Everything stays on your computer; no server, no tracking.
  >
  > Setup: https://github.com/sedojj/timesheetgate#install
  >
  > Not affiliated with or endorsed by Oracle NetSuite or Google.

- **Category:** Productivity → Workflow & Planning
- **Language:** English
- **Icon:** `extension/icons/icon-128.png`
- **Screenshots:** `docs/store/screenshot-week.jpg` and `docs/store/screenshot-meetings.jpg`
  (1280×800 JPEG, no alpha). They show the real panel with made-up data; regenerate after UI
  changes with `cd extension && node demo/shoot.js` (needs Google Chrome). Never use a
  screenshot of your real timesheet: it shows customer and project names.

## 3. Dashboard → Privacy practices

- **Single purpose:** Fill in SuiteProjects Pro timesheets from a local file of hour entries
  (optionally from the user's own calendar), saving changes into the open timesheet on the
  user's click.
- **Permission justifications:**
  - `sidePanel`: the week view lives in Chrome's side panel next to the open timesheet.
  - `storage`: keeps the address of the user's own calendar script.
  - Host `https://*.netsuitesuiteprojectspro.com/*`: reads the open timesheet and saves the
    user's changes through the page, with the user's own login; SPP accounts use different
    subdomains.
  - Host `https://script.google.com/*`, `https://script.googleusercontent.com/*`: fetches the
    user's own calendar from the Apps Script web app they deployed ("Only myself"); Google
    serves the answer from googleusercontent.com.
- **Remote code:** No. The calendar script returns data (JSON), not code.
- **Data usage:** tick what the extension handles — *Personally identifiable information*
  (guests' email addresses in calendar meetings) and *Website content* (the timesheet page).
  Certify all three: not sold, not used for unrelated purposes, not used for creditworthiness.
- **Privacy policy URL:** https://sedojj.github.io/timesheetgate/privacy.html (GitHub Pages from
  `docs/`, generated from `PRIVACY.md`: after editing it run `python3 scripts/privacy_html.py`;
  a test fails if the page is out of date)

## 4. Distribution

- **Visibility:** Unlisted.
- **Regions:** all (or the countries your colleagues are in).

Submit for review. After approval, share the store link; colleagues install it, choose their
data folder, and follow the README for the optional `timelog` command and calendar script.
