// Removes phone numbers, emails, calendar/token URLs and long digit runs from any string.
export function scrub(s: string): string {
  return s
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[number]");
}
