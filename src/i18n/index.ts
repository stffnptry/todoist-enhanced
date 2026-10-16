import { en, type TranslationKey } from './en';
import { fr } from './fr';
import { de } from './de';

export type Locale = 'en' | 'fr' | 'de';
export type { TranslationKey };

const dictionaries: Record<Locale, Record<TranslationKey, string>> = { en, fr, de };

/** Picks the interface language from the browser the first time the app runs. */
export function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  const lang = navigator.language.toLowerCase();
  if (lang.startsWith('fr')) return 'fr';
  if (lang.startsWith('de')) return 'de';
  return 'en';
}

/** The tag Intl formats dates and numbers with, for each interface language. */
export function intlLocale(locale: Locale): string {
  return locale === 'fr' ? 'fr-FR' : locale === 'de' ? 'de-DE' : 'en-GB';
}

/**
 * The language typed dates and repeat rules are read and written in. Only
 * English and French have a parser here; a German interface writes English
 * rules, which Todoist reads as well.
 */
export function textLang(locale: Locale): 'en' | 'fr' {
  return locale === 'fr' ? 'fr' : 'en';
}

export type TranslateValues = Record<string, string | number>;

/**
 * Looks up a string and fills in its placeholders.
 *
 * A key ending in a count uses the `_one` / `_other` pair, which is all the
 * plural handling English and French need here.
 */
export function translate(
  locale: Locale,
  key: TranslationKey,
  values?: TranslateValues,
): string {
  const dictionary = dictionaries[locale] ?? en;
  let template: string | undefined = dictionary[key];

  if (values && typeof values.count === 'number') {
    const plural = values.count === 1 ? `${key}_one` : `${key}_other`;
    const pluralised = (dictionary as Record<string, string>)[plural];
    if (pluralised) template = pluralised;
  }

  if (template === undefined) {
    // A missing string must never blank out the interface.
    return (en as Record<string, string>)[key] ?? key;
  }

  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}
