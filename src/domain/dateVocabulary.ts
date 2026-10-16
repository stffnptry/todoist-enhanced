/**
 * The words for the months and the days of the week, in both interface
 * languages, written once for every reader of dates.
 *
 * Folded (lower case, no accents) and written as regex alternatives, longest
 * forms and abbreviations side by side: `'september|sept|sep'`. A reader adds
 * its own boundary after them, because "mar" is March and also the start of
 * "marrons", and "mai" is May and also the start of "maisons" (#123). The
 * repeat-rule reader and the date reader both draw on these lists, so a word
 * is a month in both or in neither.
 */

/** Twelve entries, January first. */
export const MONTH_WORDS: Record<'en' | 'fr' | 'de', string[]> = {
  en: ['january|jan', 'february|feb', 'march|mar', 'april|apr', 'may', 'june|jun',
    'july|jul', 'august|aug', 'september|sept|sep', 'october|oct', 'november|nov',
    'december|dec'],
  fr: ['janvier|janv', 'fevrier|fevr', 'mars', 'avril|avr', 'mai', 'juin',
    'juillet|juil', 'aout', 'septembre|sept', 'octobre|oct', 'novembre|nov',
    'decembre|dec'],
  /* Deutsch nur für das Lesen von Fälligkeitsdaten; Wiederholungen werden
     (noch) nicht auf Deutsch gelesen. „märz“ ist gefaltet „marz“. */
  de: ['januar|jan', 'februar|feb', 'marz|maerz|mrz', 'april|apr', 'mai', 'juni|jun',
    'juli|jul', 'august|aug', 'september|sept|sep', 'oktober|okt', 'november|nov',
    'dezember|dez'],
};

/** Seven entries, Sunday first, as `Date.getDay()` counts them. */
export const WEEKDAY_WORDS: Record<'en' | 'fr', string[]> = {
  en: ['sunday|sun', 'monday|mon', 'tuesday|tues|tue', 'wednesday|weds|wed',
    'thursday|thurs|thur|thu', 'friday|fri', 'saturday|sat'],
  fr: ['dimanches?|dim', 'lundis?|lun', 'mardis?|mar', 'mercredis?|mer',
    'jeudis?|jeu', 'vendredis?|ven', 'samedis?|sam'],
};
