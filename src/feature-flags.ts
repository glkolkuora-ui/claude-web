// ════════════════════════════════════════════════════════════════════
// Feature flags — espelho de electron/main/feature-flags.ts.
// Mantenha os dois arquivos em sincronia ao mudar valores.
// ════════════════════════════════════════════════════════════════════

export const FEATURE_FLAGS = {
  /** ⚠️ MUDAR PARA true QUANDO FOR COMERCIALIZAR. */
  LOGIN_REQUIRED: false,
  /** Gate de email antes do login Broker10 (tela inicial). */
  LICENSE_REQUIRED: true,
  /** true = qualquer email válido passa sem consultar Misespay (modo aberto). */
  LICENSE_OPEN_ACCESS: true,
  TELEMETRY_ENABLED: true,
  NOTIFICATIONS_ENABLED: true,
  UPDATE_CHECK_ENABLED: false,
  /** Soros (reinvestimento em cadeia). Mudar para true para reativar. */
  SOROS_ENABLED: false,
  /** Fase A — auth Broker10 via Edge Functions (desligado; login local permanece padrão). */
  USE_EDGE_AUTH: true,
}

export const SUPABASE_URL = 'https://jjuaimvimahumlxnmula.supabase.co'
export const SUPABASE_ANON_KEY = 'sb_publishable_DOUAg6FoQjBMFNKwlM4JJQ_XDoG7PON'
