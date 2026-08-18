// ════════════════════════════════════════════════════════════════════
// Feature flags — DUPLICADAS também em src/feature-flags.ts.
// Mantenha os dois arquivos em sincronia ao mudar valores.
// (Electron main e renderer não compartilham módulos por padrão
// neste setup; um dia migramos pra um pacote shared, mas por ora
// a duplicação é só 6 linhas e evita refactor.)
// ════════════════════════════════════════════════════════════════════

export const FEATURE_FLAGS = {
  /** ⚠️ MUDAR PARA true QUANDO FOR COMERCIALIZAR.
   *  Enquanto false: app abre direto, sem login Supabase.
   *  Telemetria fica em arquivo JSON local.
   *  Notificações ficam escondidas.
   *  Credenciais Broker10 continuam em config.ts. */
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
