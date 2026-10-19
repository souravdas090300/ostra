export type Language = { code: string; name: string; native: string; rtl?: boolean };

// All European languages plus Arabic. "nb" is Norwegian (Bokmål).
export const LANGUAGES: Language[] = [
  { code: "sq", name: "Albanian", native: "Shqip" },
  { code: "ar", name: "Arabic", native: "العربية", rtl: true },
  { code: "hy", name: "Armenian", native: "Հայերեն" },
  { code: "eu", name: "Basque", native: "Euskara" },
  { code: "be", name: "Belarusian", native: "Беларуская" },
  { code: "bs", name: "Bosnian", native: "Bosanski" },
  { code: "bg", name: "Bulgarian", native: "Български" },
  { code: "ca", name: "Catalan", native: "Català" },
  { code: "hr", name: "Croatian", native: "Hrvatski" },
  { code: "cs", name: "Czech", native: "Čeština" },
  { code: "da", name: "Danish", native: "Dansk" },
  { code: "nl", name: "Dutch", native: "Nederlands" },
  { code: "en", name: "English", native: "English" },
  { code: "et", name: "Estonian", native: "Eesti" },
  { code: "fi", name: "Finnish", native: "Suomi" },
  { code: "fr", name: "French", native: "Français" },
  { code: "gl", name: "Galician", native: "Galego" },
  { code: "ka", name: "Georgian", native: "ქართული" },
  { code: "de", name: "German", native: "Deutsch" },
  { code: "el", name: "Greek", native: "Ελληνικά" },
  { code: "hu", name: "Hungarian", native: "Magyar" },
  { code: "is", name: "Icelandic", native: "Íslenska" },
  { code: "ga", name: "Irish", native: "Gaeilge" },
  { code: "it", name: "Italian", native: "Italiano" },
  { code: "lv", name: "Latvian", native: "Latviešu" },
  { code: "lt", name: "Lithuanian", native: "Lietuvių" },
  { code: "lb", name: "Luxembourgish", native: "Lëtzebuergesch" },
  { code: "mk", name: "Macedonian", native: "Македонски" },
  { code: "mt", name: "Maltese", native: "Malti" },
  { code: "nb", name: "Norwegian", native: "Norsk" },
  { code: "pl", name: "Polish", native: "Polski" },
  { code: "pt", name: "Portuguese", native: "Português" },
  { code: "ro", name: "Romanian", native: "Română" },
  { code: "ru", name: "Russian", native: "Русский" },
  { code: "sr", name: "Serbian", native: "Српски" },
  { code: "sk", name: "Slovak", native: "Slovenčina" },
  { code: "sl", name: "Slovenian", native: "Slovenščina" },
  { code: "es", name: "Spanish", native: "Español" },
  { code: "sv", name: "Swedish", native: "Svenska" },
  { code: "tr", name: "Turkish", native: "Türkçe" },
  { code: "uk", name: "Ukrainian", native: "Українська" },
  { code: "cy", name: "Welsh", native: "Cymraeg" },
];

export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code) as [string, ...string[]];

const ALIASES: Record<string, string> = { no: "nb", nn: "nb", iw: "he" };

/** "pt-BR" -> "pt", "NO" -> "nb". Returns null if unsupported. */
export function normaliseLanguage(input?: string | null): string | null {
  if (!input) return null;
  const base = input.trim().toLowerCase().split(/[-_]/)[0];
  const code = ALIASES[base] ?? base;
  return LANGUAGE_CODES.includes(code) ? code : null;
}

export function getLanguage(code?: string | null): Language | undefined {
  const c = normaliseLanguage(code);
  return LANGUAGES.find((l) => l.code === c);
}

export const isRtl = (code?: string | null) => !!getLanguage(code)?.rtl;
