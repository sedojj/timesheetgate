// Timesheetgate calendar reader: an Apps Script web app that returns your meetings as JSON.
// Setup in the README ("Calendar"). Deploy as a web app with "Execute as: Me" and
// "Who has access: Only myself"; appsscript.json limits it to read-only access.
// The side panel calls it with ?start=<ISO>&end=<ISO> (the SPP week, Sunday to Sunday).
// Besides your default calendar it reads the public-holiday calendars in your list (Google's,
// ids ending in #holiday@group.v.calendar.google.com), so nobody edits this file per country.
const HOLIDAY_ID = "#holiday@group.v.calendar.google.com";

function doGet(e) {
  const start = new Date(e.parameter.start);
  const end = new Date(e.parameter.end);
  if (isNaN(start) || isNaN(end)) throw new Error("start and end must be ISO dates");
  const holidays = CalendarApp.getAllCalendars()
    .filter((c) => c.getId().endsWith(HOLIDAY_ID))
    .flatMap((c) => c.getEvents(start, end).map((ev) => ({
      id: ev.getId(),
      // The day itself, so no time zone can move a holiday to the wrong date.
      date: Utilities.formatDate(ev.getAllDayStartDate(), Session.getScriptTimeZone(), "yyyy-MM-dd"),
      start: ev.getStartTime().toISOString(),
      end: ev.getEndTime().toISOString(),
      all_day: ev.isAllDayEvent(),
      title: ev.getTitle(),
      description: ev.getDescription(), // "Public holiday" for days off
      holiday: true,
      calendar: c.getName(),
      calendar_id: c.getId(),
    })));
  const meetings = CalendarApp.getDefaultCalendar().getEvents(start, end).map((ev) => ({
    id: ev.getId(), // the same for every meeting of a recurring series
    start: ev.getStartTime().toISOString(),
    end: ev.getEndTime().toISOString(),
    all_day: ev.isAllDayEvent(),
    title: ev.getTitle(),
    description: ev.getDescription(),
    attendees: ev.getGuestList().map((g) => g.getEmail()),
    my_status: String(ev.getMyStatus()),
    recurring: ev.isRecurringEvent(),
  }));
  const events = meetings.concat(holidays);
  return ContentService.createTextOutput(
    JSON.stringify({ generated: new Date().toISOString(), start: start.toISOString(), end: end.toISOString(), events }),
  ).setMimeType(ContentService.MimeType.JSON);
}
