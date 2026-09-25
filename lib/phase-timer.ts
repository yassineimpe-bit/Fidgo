/**
 * Chronométrage par phase d'une route, écrit uniquement dans les journaux
 * serveur et seulement si `LOGIN_TIMING_LOG=1` : aucune durée n'est renvoyée
 * au navigateur (un temps de réponse détaillé pourrait servir d'oracle).
 * Les journaux ne contiennent ni e-mail, ni identifiant, ni IP.
 */
export function createPhaseTimer(label: string, enabled = process.env.LOGIN_TIMING_LOG === "1") {
  const started = performance.now();
  let mark = started;
  const phases: Record<string, number> = {};
  return {
    lap(name: string) {
      if (!enabled) return;
      const now = performance.now();
      phases[name] = Math.round((phases[name] ?? 0) + now - mark);
      mark = now;
    },
    done(outcome: string) {
      if (!enabled) return null;
      const entry = { outcome, ...phases, totalMs: Math.round(performance.now() - started) };
      console.info(label, JSON.stringify(entry));
      return entry;
    },
  };
}
