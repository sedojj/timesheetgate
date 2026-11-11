// A few well-attested quotes for the PTO note — a small joke, kept offline on purpose.
export const QUOTES: [string, string][] = [
  ["Take rest; a field that has rested gives a bountiful crop.", "Ovid"],
  ["Rest is not idleness.", "John Lubbock"],
  ["The cure for anything is salt water: sweat, tears or the sea.", "Isak Dinesen"],
  ["Not all those who wander are lost.", "J. R. R. Tolkien"],
  ["To travel is to live.", "Hans Christian Andersen"],
  ["Life is either a daring adventure or nothing.", "Helen Keller"],
  ["Leisure is the mother of philosophy.", "Thomas Hobbes"],
  ["Time you enjoy wasting is not wasted time.", "Marthe Troly-Curtin"],
  ["In every walk with nature one receives far more than he seeks.", "John Muir"],
  ["Happiness is thought to depend on leisure.", "Aristotle"],
];

export function quoteNote(random: () => number = Math.random): string {
  const [text, author] = QUOTES[Math.floor(random() * QUOTES.length)];
  return `“${text}” — ${author}`;
}
