// Public holidays from a week's calendar file: the days off in Google's holiday calendars
// (ids like "en.czech#holiday@group.v.calendar.google.com") that the user has in their list.

export type Holiday = { date: string; title: string; country: string; flag: string };

/** Google's region words in holiday calendar ids; newer ids use the two-letter code itself. */
const REGIONS: Record<string, string> = {
  australian: "AU", austrian: "AT", belgian: "BE", brazilian: "BR", bulgarian: "BG", canadian: "CA",
  china: "CN", croatian: "HR", czech: "CZ", danish: "DK", dutch: "NL", finnish: "FI", french: "FR",
  german: "DE", greek: "GR", hong_kong: "HK", hungarian: "HU", indian: "IN", indonesian: "ID",
  irish: "IE", italian: "IT", japanese: "JP", latvian: "LV", lithuanian: "LT", malaysia: "MY",
  mexican: "MX", new_zealand: "NZ", norwegian: "NO", philippines: "PH", polish: "PL",
  portuguese: "PT", romanian: "RO", russian: "RU", sa: "ZA", singapore: "SG", slovak: "SK",
  slovenian: "SI", south_korea: "KR", spain: "ES", swedish: "SE", taiwan: "TW", thai: "TH",
  turkish: "TR", uk: "GB", ukrainian: "UA", usa: "US", vietnamese: "VN",
};

/** "CZ" from the calendar id, else the country from its name ("Holidays in Atlantis" → "Atlantis"). */
function country(calendarId: string, name: string): string {
  const region = calendarId.split("#")[0].split(".").pop() ?? "";
  if (/^[a-z]{2}$/.test(region)) return region.toUpperCase();
  return REGIONS[region] ?? name.replace(/^Holidays in /, "");
}

const flagOf = (code: string) =>
  /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "";

/** Days off only: Google marks them "Public holiday"; observances are working days. */
export function holidaysOf(calendar: { events: any[] } | null): Holiday[] {
  return (calendar?.events ?? [])
    .filter((e) => e.holiday && e.description === "Public holiday" && e.date)
    .map((e) => {
      const code = country(e.calendar_id ?? "", e.calendar ?? "");
      return { date: e.date, title: e.title, country: code, flag: flagOf(code) };
    });
}
