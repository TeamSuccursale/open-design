/**
 * The splash text shown while the app bundle loads. It renders before the i18n dictionaries exist, so it cannot use
 * them; importing them here would put all 19 locales in the first chunk the splash is there to hide. Italian is the
 * team's language, so it is the one language named here, from the browser's own preference list.
 */
export function startupLabel(languages: readonly string[]): string {
  return languages[0]?.toLowerCase().startsWith('it') ? 'Avvio di MelilloDesign…' : 'Loading MelilloDesign…';
}
