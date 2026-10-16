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
    setReminders?: (list: Array<{ key: string; itemId: string; at: number; title: string; body: string }>) => void;
    /** The Mac's calendars, through the desktop app's EventKit helper (newer desktop builds only). */
    calendar?: (command: string, input?: Record<string, unknown>) => Promise<{ ok: boolean; error?: string; [key: string]: unknown }>;
    /** Claude through the Claude CLI on this Mac (newer desktop builds only). */
    claude?: {
      available: () => Promise<boolean>;
      ask: (request: { requestId: string; message: string; system: string; sessionId: string | null }) => void;
      cancel: (requestId: string) => void;
      onEvent: (listener: (event: {
        requestId: string; type: 'delta' | 'done' | 'error' | 'cancelled';
        text?: string; error?: string; sessionId?: string;
      }) => void) => () => void;
    };
  };
}
