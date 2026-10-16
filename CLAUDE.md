# CLAUDE.md – Web-App (Enhanced for Todoist DE)

Dieser Ordner ist die Web-App der deutschen Mac-App. **Die eigentliche Übergabe liegt
eine Ebene höher:** [../CLAUDE.md](../CLAUDE.md) (Architektur, Bauen, Testen, Nutzer),
[../VERLAUF.md](../VERLAUF.md), [../README.md](../README.md).

Kurz für Arbeiten hier:
- Branch `deutsch`; Original-Repo `julesvbertolino/todoist-enhanced` – nicht dorthin pushen.
- Jeder neue UI-Text: Schlüssel in `src/i18n/en.ts`, `fr.ts` **und** `de.ts` (Du-Form).
- Prüfen: `npx tsc -b --noEmit && npx vitest run && npx eslint src`.
- Desktop-Funktionen (Kalender, Claude, Mitteilungen) laufen über `window.enhancedDesktop`
  (Typen in `src/vite-env.d.ts`) und existieren nur in der Mac-App.
- Ergebnis ansehen: `../install.sh --build` oder Testlauf wie in `../CLAUDE.md` beschrieben.
