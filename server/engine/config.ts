/**
 * BROKER CONFIGURATION
 * Fica APENAS no processo principal do Electron.
 * O usuário jamais vê essas credenciais.
 */
export const BROKER_CONFIG = {
  /** Deve coincidir com broker10_client_id no Supabase Vault (Edge broker-auth-*). */
  clientId:     342200290751980,
  /**
   * NÃO embutir o client_secret no bundle. Com USE_EDGE_AUTH=true (padrão),
   * o exchange/refresh do OAuth é feito pelas Edge Functions, que leem o
   * secret do Supabase Vault (broker10_client_secret). Este campo só é usado
   * pelo caminho legado (USE_EDGE_AUTH=false) e pode ser fornecido por env.
   */
  clientSecret: process.env.BROKER_CLIENT_SECRET ?? '',
  platformId:   482,
  wsUrl:        'wss://ws.trade.broker10.com/echo/websocket',
  apiUrl:       'https://api.trade.broker10.com',
  redirectUri:  process.env.BROKER_REDIRECT_URI ?? 'https://claudepro.online/claudeplus/auth/callback',
  scope:        'full offline_access',
}
