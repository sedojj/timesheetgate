# Timesheetgate — privacy policy

Last updated: 2026-11-20

Timesheetgate is a Chrome extension that keeps your hour entries in a local file and saves
them into your SuiteProjects Pro (SPP) timesheet when you click **Sync**. It is not made by,
affiliated with or endorsed by Oracle NetSuite or Google.

## What the extension handles

- **Your timesheet in SPP.** On an open SPP timesheet page (`*.netsuitesuiteprojectspro.com`)
  it reads the week: projects, tasks, time types, hours, descriptions and notes, and your
  project list. When you click Sync it saves changed hours through the page itself, with your
  own login. It never submits a timesheet.
- **Your files.** It reads and writes the folder you choose (for example `~/Timesheetgate`):
  your hour entries (`entries.csv`), your project list, the state of the last Sync, and your
  calendar meetings (`calendar/`).
- **Your Google Calendar, only if you set it up.** It calls the Apps Script you deploy in your
  own Google account, with your Google login in Chrome. The script returns your meetings of the
  week (time, title, description, guests' email addresses, your answer, who created them) and
  the public holidays in your calendar list. The script has read-only access.
- **Settings in Chrome.** The address of your calendar script (`chrome.storage.local`), the
  folder you chose (IndexedDB), and display choices (`localStorage`).

## Where it goes

Nowhere else. The extension has no server, no analytics and no tracking. It sends your data
only to your own SPP timesheet (when you click Sync) and receives your calendar from your own
Apps Script. Nothing is sold, shared with third parties, or used for anything other than
filling your timesheet.

## Deleting it

Delete the files in the folder you chose, and remove the extension in `chrome://extensions`;
that also removes its settings. Your calendar script stays in your Google account until you
delete it at script.google.com.

## Questions

Open an issue at https://github.com/sedojj/timesheetgate/issues.
