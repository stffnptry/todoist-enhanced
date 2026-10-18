/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Where this copy is served from, ending with `/`. Set with PUBLIC_URL at build time (vite.config.ts). */
declare const __PUBLIC_URL__: string;
/** The development address Todoist also returns to, listed in oauth/client.json. */
declare const __OAUTH_DEV_REDIRECT__: string;

interface Window {
  /** Present only inside the desktop app (desktop/), which adds it in its preload script. */
  enhancedDesktop?: {
    hideQuickAdd: () => void;
    /** Hands the app the notifications to show for due tasks (newer desktop builds only). */
    setReminders?: (list: Array<{
      key: string; itemId: string; at: number; title: string; body: string;
      /** Labels of the buttons, in the order done, +15 min, +1 hour; then the close button. */
      actions?: string[]; closeText?: string;
    }>) => void;
    /** The Mac's calendars, through the desktop app's EventKit helper (newer desktop builds only). */
    calendar?: (command: string, input?: Record<string, unknown>) => Promise<{ ok: boolean; error?: string; [key: string]: unknown }>;
    /** E-Mails als Aufgaben (components/MailDrop.tsx; neuere Mac-App-Versionen). */
    mail?: {
      /** Betreff, Absender, Datum und Text einer Mail aus Apple Mail, über ihre Message-ID. */
      fromAppleMail: (messageId: string) => Promise<{ ok: boolean; error?: string; subject?: string; from?: string; date?: string; body?: string }>;
      /** Was auf der Drag-Ablage des Systems liegt: Typen, Dateipfade, Text, HTML. */
      dragPasteboard: () => Promise<{ ok: boolean; error?: string; types?: string[]; files?: string[]; text?: string | null; html?: string | null }>;
      /** Eine .eml-Datei lesen, deren Pfad auf der Drag-Ablage lag. */
      readEml: (file: string) => Promise<{ ok: boolean; error?: string; text?: string }>;
    };
    /** Claude through the Claude CLI on this Mac (newer desktop builds only). */
    claude?: {
      available: () => Promise<boolean>;
      ask: (request: { requestId: string; message: string; system: string; sessionId: string | null }) => void;
      cancel: (requestId: string) => void;
      /** Keep facts the person agreed to in Claude's memory (newer desktop builds only). */
      remember?: (lines: string[]) => void;
      /** Record which proposals the person accepted or declined (newer desktop builds only). */
      log?: (lines: string[]) => void;
      onEvent: (listener: (event: {
        requestId: string; type: 'delta' | 'done' | 'error' | 'cancelled';
        text?: string; error?: string; sessionId?: string;
      }) => void) => () => void;
    };
  };
}
