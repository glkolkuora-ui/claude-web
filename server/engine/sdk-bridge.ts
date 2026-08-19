/**
 * Ponte de trading — SDK JavaScript publicado no npm para a stack da corretora.
 * O identificador do pacote no `package.json` é fixo; não renomear sem substituir a dependência.
 */
import {
  ClientSdk,
  OAuthMethod,
  OAuthTokensStorage,
  BinaryOptionsDirection,
  DigitalOptionsDirection,
  BalanceType,
  InstrumentType,
  WsConnectionStateEnum,
} from '@quadcode-tech/client-sdk-js'
import { BROKER_CONFIG } from './config'
import { FEATURE_FLAGS, SUPABASE_URL, SUPABASE_ANON_KEY } from './feature-flags'
import {
  TradeOrderError,
  minStakeForCurrency,
  parseBrokerOrderError,
} from './trade-errors'
import { tApp } from './locale'

const EDGE_BASE = `${SUPABASE_URL}/functions/v1`
const BROKER_TOKEN_PATH = '/auth/oauth.v5/token'

/**
 * Placeholder só para o guard interno do SDK em authenticateWsApiClient
 * (`!clientSecret` bloqueia refresh). Nunca vai à Broker — exchange/refresh são override Edge.
 */
const EDGE_OAUTH_SDK_SECRET_GUARD = '__edge_delegated__'

function formatEdgeAuthError(
  fallback: string,
  payload: { error?: string; detail?: unknown; error_description?: string },
): string {
  if (typeof payload.error_description === 'string' && payload.error_description.trim()) {
    return payload.error_description
  }
  const detail = payload.detail
  if (detail && typeof detail === 'object' && detail !== null) {
    const d = detail as Record<string, unknown>
    if (typeof d.error_description === 'string') return d.error_description
    if (typeof d.message === 'string') return d.message
    if (typeof d.error === 'string') return d.error
  }
  if (typeof detail === 'string' && detail.trim()) return detail
  if (payload.error === 'upstream_error') {
    return tApp('loginRefused')
  }
  return payload.error || fallback
}

// ─── Edge OAuth (Fase A — USE_EDGE_AUTH) ───────────────────────────────────

class EdgeOAuthMethod extends OAuthMethod {
  private readonly edgeRedirectUri: string
  private readonly edgeTokensStorage: OAuthTokensStorage
  private readonly edgeUserEmail: string
  private refreshInFlight: Promise<{
    accessToken: string
    expiresIn: number
    refreshToken?: string
  }> | null = null

  constructor(
    apiBaseUrl: string,
    clientId: number,
    redirectUri: string,
    scope: string,
    userEmail: string,
    accessToken: string | undefined,
    refreshToken: string | undefined,
    tokensStorage: OAuthTokensStorage,
  ) {
    super(
      apiBaseUrl,
      clientId,
      redirectUri,
      scope,
      EDGE_OAUTH_SDK_SECRET_GUARD,
      accessToken,
      refreshToken,
      undefined,
      undefined,
      undefined,
      tokensStorage,
    )
    this.edgeRedirectUri = redirectUri
    this.edgeTokensStorage = tokensStorage
    this.edgeUserEmail = userEmail
  }

  async issueAccessTokenWithAuthCode(code: string, codeVerifier: string): Promise<{
    accessToken: string
    expiresIn: number
    refreshToken?: string
  }> {
    const tokenUrl = `${BROKER_CONFIG.apiUrl.replace(/\/+$/, '')}${BROKER_TOKEN_PATH}`
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.edgeRedirectUri,
        client_id: BROKER_CONFIG.clientId,
        code_verifier: codeVerifier,
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string; detail?: unknown; error_description?: string }
      throw new Error(formatEdgeAuthError(`broker-auth-exchange falhou (${res.status})`, err))
    }
    const data = await res.json() as {
      access_token: string
      refresh_token?: string
      expires_in: number
    }
    await this.edgeTokensStorage.set({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
    })
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    }
  }

  async refreshAccessToken(): Promise<{
    accessToken: string
    expiresIn: number
    refreshToken?: string
  }> {
    if (this.refreshInFlight) return this.refreshInFlight

    this.refreshInFlight = (async () => {
      try {
        const current = await this.edgeTokensStorage.get()
        const refreshToken = current.refreshToken
        if (!refreshToken) throw new Error(tApp('noRefreshToken'))

        const res = await fetch(`${EDGE_BASE}/broker-token-refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
          body: JSON.stringify({
            refresh_token: refreshToken,
            email: this.edgeUserEmail,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string; detail?: unknown }
          throw new Error(formatEdgeAuthError(`broker-token-refresh falhou (${res.status})`, err))
        }
        const data = await res.json() as {
          access_token: string
          refresh_token?: string
          expires_in: number
        }
        await this.edgeTokensStorage.set({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
        })
        return {
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresIn: data.expires_in,
        }
      } finally {
        this.refreshInFlight = null
      }
    })()

    return this.refreshInFlight
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ActiveInfo {
  id: number
  ticker: string
  name: string
  isOtc: boolean
  availableBinary: boolean
  availableDigital: boolean
}

export interface BalanceInfo {
  id: number
  amount: number
  currency: string
  type: 'real' | 'demo'
}

export interface TradeParams {
  activeId: number
  direction: 'CALL' | 'PUT'
  amount: number
  balanceId: number
  instrument: 'binary' | 'digital'
}

export interface TradePlaceMeta {
  activeTicker?: string
}

// ─── Forex whitelist (pares de moeda) ─────────────────────────────────────

const FOREX_CURRENCIES = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD',
  'BRL', 'MXN', 'ZAR', 'TRY', 'NOK', 'SEK', 'DKK', 'SGD',
  'HKD', 'COP', 'CZK', 'HUF', 'PLN', 'RON', 'CNH', 'INR',
])

function isCurrencyPair(ticker: string): boolean {
  const clean = ticker
    .replace(/\(OTC\)/gi, '')
    .replace(/[-/\s()]/g, '')
    .replace(/OTC$/i, '')
    .replace(/op$/i, '')
    .toUpperCase()
    .trim()
  if (clean.length !== 6) return false
  const base = clean.slice(0, 3)
  const quote = clean.slice(3, 6)
  return FOREX_CURRENCIES.has(base) && FOREX_CURRENCIES.has(quote)
}

// ─── Token Storage ────────────────────────────────────────────────────────

class InMemoryTokenStorage {
  private tokens = { accessToken: '', refreshToken: undefined as string | undefined }
  async get() { return this.tokens }
  async set(t: { accessToken: string; refreshToken?: string }) {
    this.tokens.accessToken = t.accessToken
    this.tokens.refreshToken = t.refreshToken
    this.onChange?.(this.snapshot())
  }
  snapshot() {
    return { accessToken: this.tokens.accessToken, refreshToken: this.tokens.refreshToken }
  }
  onChange: ((tokens: { accessToken: string; refreshToken?: string }) => void) | null = null
}

// ─── SdkBridge ────────────────────────────────────────────────────────────

export class SdkBridge {
  private sdk: ClientSdk | null = null
  private oauth: OAuthMethod | null = null
  private tokenStorage = new InMemoryTokenStorage()
  private userEmail: string | null = null
  private oauthRedirectUri = BROKER_CONFIG.redirectUri
  private wsState: 'connected' | 'disconnected' = 'disconnected'
  private wsStateUnsub: (() => void) | null = null
  private reconnecting = false
  private exchangeInFlight: Promise<void> | null = null
  private lastExchangedCode: string | null = null

  private binaryOptionsInstance: any = null
  private digitalOptionsInstance: any = null
  private balancesInstance: any = null
  private positionsInstance: any = null

  private static readonly M1_DURATION_SEC = 60
  /** Margem mínima antes do deadtime (latência WS + RTT). */
  private static readonly MIN_REMAINING_MS = 6000
  private static readonly TARGET_DURATION_MS = 60_000
  private static readonly MIN_ACCEPTABLE_DURATION_MS = 30_000
  private static readonly MAX_ACCEPTABLE_REAL_DURATION_SEC = 90

  /** Relógio do broker via WebSocket; fallback para relógio local. */
  private brokerNow(): Date {
    try {
      const t = this.sdk?.currentTime?.()
      if (t instanceof Date && !Number.isNaN(t.getTime())) return t
    } catch {
      /* ignore */
    }
    return new Date()
  }

  private remainingForPurchase(instr: any, now: Date): number {
    if (typeof instr.durationRemainingForPurchase === 'function') {
      const rem = instr.durationRemainingForPurchase(now)
      if (typeof rem === 'number' && Number.isFinite(rem)) return rem
    }
    const exp: Date | undefined =
      instr.expiredAt instanceof Date ? instr.expiredAt
        : instr.expiration instanceof Date ? instr.expiration
          : undefined
    if (!exp) return -1
    const deadtimeMs = (instr.deadtime ?? 0) * 1000
    return exp.getTime() - deadtimeMs - now.getTime()
  }

  private pickBestM1Instrument(
    candidates: any[],
    now: Date,
    expirationOf: (i: any) => Date,
  ): any {
    const acceptable = candidates.filter((i) => {
      const dur = expirationOf(i).getTime() - now.getTime()
      return dur >= SdkBridge.MIN_ACCEPTABLE_DURATION_MS
    })
    if (!acceptable.length) {
      throw new TradeOrderError(tApp('noM1'), { code: 'm1_unavailable' })
    }
    return acceptable.sort((a, b) => {
      const durA = expirationOf(a).getTime() - now.getTime()
      const durB = expirationOf(b).getTime() - now.getTime()
      return Math.abs(durA - SdkBridge.TARGET_DURATION_MS)
        - Math.abs(durB - SdkBridge.TARGET_DURATION_MS)
    })[0]
  }

  private requireOrderId(result: any, label: string): string {
    const raw = result?.id ?? result?.externalId
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      throw new TradeOrderError(
        tApp('missingOrderId', { label }),
        { code: 'missing_order_id' },
      )
    }
    return String(raw)
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  setUserEmail(email: string): void {
    this.userEmail = String(email ?? '').trim().toLowerCase() || null
  }

  onTokens(cb: (tokens: { accessToken: string; refreshToken?: string }) => void): void {
    this.tokenStorage.onChange = cb
  }

  async exportTokens(): Promise<{ accessToken: string; refreshToken?: string } | null> {
    const t = await this.tokenStorage.get()
    if (!t.accessToken && !t.refreshToken) return null
    return { accessToken: t.accessToken, refreshToken: t.refreshToken }
  }

  async hasTokens(): Promise<boolean> {
    const t = await this.tokenStorage.get()
    return Boolean(t.accessToken || t.refreshToken)
  }

  async restoreFromTokens(tokens: { accessToken: string; refreshToken?: string }): Promise<void> {
    await this.tokenStorage.set(tokens)
    if (!this.userEmail) throw new Error(tApp('emailNotSet'))
    this.initOAuth()
  }

  setRedirectUri(uri: string): void {
    const clean = String(uri ?? '').trim()
    if (clean.startsWith('http')) this.oauthRedirectUri = clean
  }

  getRedirectUri(): string {
    return this.oauthRedirectUri
  }

  private initOAuth(): void {
    if (FEATURE_FLAGS.USE_EDGE_AUTH) {
      if (!this.userEmail) {
        throw new Error(tApp('emailNotSet'))
      }
      this.oauth = new EdgeOAuthMethod(
        BROKER_CONFIG.apiUrl,
        BROKER_CONFIG.clientId,
        this.oauthRedirectUri,
        BROKER_CONFIG.scope,
        this.userEmail,
        undefined,
        undefined,
        this.tokenStorage,
      )
      return
    }
    this.oauth = new OAuthMethod(
      BROKER_CONFIG.apiUrl,
      BROKER_CONFIG.clientId,
      this.oauthRedirectUri,
      BROKER_CONFIG.scope,
      BROKER_CONFIG.clientSecret,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      this.tokenStorage,
    )
  }

  async createAuthUrl(): Promise<{ url: string; codeVerifier: string }> {
    console.log('[AUTH-START] Gerando OAuthMethod e URL de autorização...')
    this.initOAuth()
    if (!this.oauth) throw new Error(tApp('oauthFail'))
    const { url, codeVerifier } = await this.oauth.createAuthorizationUrl()
    let authUrl = url
    try {
      const u = new URL(url)
      u.searchParams.set('prompt', 'login')
      authUrl = u.toString()
    } catch {
      /* mantém a URL original se não for parseável */
    }
    console.log('[AUTH-START] verifier (preview):', codeVerifier?.slice(0, 20) + '...')
    console.log('[AUTH-START] codeChallenge: (não exposto pelo SDK — PKCE interno)')
    console.log('[AUTH-START] Abrindo URL:', authUrl?.slice(0, 80) + '...')
    return { url: authUrl, codeVerifier }
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<void> {
    const normalizedCode = String(code ?? '').trim()
    if (!normalizedCode) throw new Error(tApp('emptyOAuthCode'))

    if (this.lastExchangedCode === normalizedCode) {
      console.log('[EXCHANGE] code já trocado nesta sessão — ignorando duplicata')
      return
    }
    if (this.exchangeInFlight) {
      console.log('[EXCHANGE] troca já em andamento — aguardando...')
      await this.exchangeInFlight
      if (this.lastExchangedCode === normalizedCode) return
    }

    this.exchangeInFlight = this.performExchange(normalizedCode, codeVerifier)
    try {
      await this.exchangeInFlight
      this.lastExchangedCode = normalizedCode
    } finally {
      this.exchangeInFlight = null
    }
  }

  private async performExchange(code: string, codeVerifier: string): Promise<void> {
    console.log('[EXCHANGE] ═══════════════════════════════')
    console.log('[EXCHANGE] Iniciando troca de code por token')
    console.log('[EXCHANGE] code:', code?.slice(0, 20) + '...')
    console.log('[EXCHANGE] codeVerifier disponível:', !!codeVerifier)
    console.log('[EXCHANGE] codeVerifier preview:', codeVerifier?.slice(0, 20) + '...')
    console.log('[EXCHANGE] clientId:', BROKER_CONFIG.clientId)
    console.log('[EXCHANGE] redirectUri:', this.oauthRedirectUri)
    console.log('[EXCHANGE] USE_EDGE_AUTH:', FEATURE_FLAGS.USE_EDGE_AUTH)
    console.log('[EXCHANGE] this.oauth inicializado:', !!this.oauth)

    try {
      if (!this.oauth) {
        console.warn('[EXCHANGE] oauth ausente — recriando sessão OAuth (fallback manual)')
        this.initOAuth()
      }
      if (!this.oauth) {
        throw new Error(tApp('oauthNotInit'))
      }
      console.log('[EXCHANGE] Chamando issueAccessTokenWithAuthCode (SDK)...')
      await this.oauth.issueAccessTokenWithAuthCode(code, codeVerifier)
      console.log('[EXCHANGE] ✅ issueAccessTokenWithAuthCode concluiu (tokens no storage do SDK)')
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err))
      console.error('[EXCHANGE] ❌ ERRO:', e.message)
      console.error('[EXCHANGE] ❌ Stack:', e.stack)
      throw e
    }
  }

  async connect(): Promise<void> {
    console.log('[CONNECT] Iniciando conexão SDK...')
    if (!this.oauth) throw new Error(tApp('notAuthenticated'))
    console.log('[CONNECT] Criando ClientSdk...')
    this.sdk = await ClientSdk.create(
      BROKER_CONFIG.wsUrl,
      BROKER_CONFIG.platformId,
      this.oauth
    )
    console.log('[CONNECT] ClientSdk.create OK')
    console.log('[CONNECT] Obtendo binaryOptions()...')
    this.binaryOptionsInstance = await this.sdk.binaryOptions()
    console.log('[CONNECT] Obtendo digitalOptions()...')
    this.digitalOptionsInstance = await this.sdk.digitalOptions()
    console.log('[CONNECT] Obtendo balances()...')
    this.balancesInstance = await this.sdk.balances()
    console.log('[CONNECT] Obtendo positions()...')
    this.positionsInstance = await this.sdk.positions()
    console.log('[CONNECT] Assinando estado WebSocket...')
    await this.subscribeWsState()
    console.log('[CONNECT] ✅ connect() concluído')
  }

  private async subscribeWsState(): Promise<void> {
    if (!this.sdk) return
    try {
      const wsState = await this.sdk.wsConnectionState()
      const cb = (state: WsConnectionStateEnum) => {
        this.wsState = state === WsConnectionStateEnum.Connected ? 'connected' : 'disconnected'
        console.log(`[WS] Estado da conexão: ${this.wsState}`)
      }
      wsState.subscribeOnStateChanged(cb)
      this.wsStateUnsub = () => {
        try { wsState.unsubscribeOnStateChanged(cb) } catch { /* ignore */ }
      }
      this.wsState = 'connected'
    } catch (e) {
      console.warn('[WS] Não foi possível assinar wsConnectionState:', e)
    }
  }

  async disconnect(): Promise<void> {
    try { this.wsStateUnsub?.() } catch { /* ignore */ }
    this.wsStateUnsub = null
    this.wsState = 'disconnected'
    this.sdk                    = null
    this.binaryOptionsInstance  = null
    this.digitalOptionsInstance = null
    this.balancesInstance       = null
    this.positionsInstance      = null
    this.oauth                  = null
    this.lastExchangedCode      = null
  }

  isConnected(): boolean {
    return this.sdk !== null && this.wsState === 'connected'
  }

  /**
   * Logout completo: encerra a sessão e DESCARTA os tokens em memória, forçando
   * uma nova autenticação (email/senha) no próximo login — útil p/ trocar de conta.
   */
  async logout(): Promise<void> {
    await this.disconnect()
    await this.tokenStorage.set({ accessToken: '', refreshToken: undefined })
    this.lastExchangedCode = null
  }

  async reconnect(): Promise<void> {
    if (this.reconnecting) return
    this.reconnecting = true
    try {
      if (this.sdk) {
        try { this.wsStateUnsub?.() } catch { /* ignore */ }
        this.wsStateUnsub = null
        try { await this.sdk.shutdown() } catch { /* ignore */ }
        this.sdk = null
      }
      this.binaryOptionsInstance  = null
      this.digitalOptionsInstance = null
      this.balancesInstance       = null
      this.positionsInstance      = null
      if (!this.oauth) {
        if (!this.userEmail) throw new Error(tApp('notAuthenticated'))
        this.initOAuth()
      }
      await this.connect()
      console.log('[WS] Reconexão concluída')
    } finally {
      this.reconnecting = false
    }
  }

  // ── Balances ──────────────────────────────────────────────────────────────

  async getBalances(): Promise<BalanceInfo[]> {
    if (!this.balancesInstance) throw new Error(tApp('notConnected'))
    return this.balancesInstance.getBalances().map((b: any) => ({
      id: b.id,
      amount: b.amount,
      currency: b.currency,
      type: b.type === BalanceType.Real ? 'real' : 'demo',
    }))
  }

  subscribeBalanceUpdate(balanceId: number, cb: (amount: number) => void): void {
    const balance = this.balancesInstance?.getBalanceById(balanceId)
    if (balance) balance.subscribeOnUpdate((b: any) => cb(b.amount))
  }

  getBalanceSnapshot(balanceId: number): { amount: number; currency: string; type: 'real' | 'demo' } | null {
    const balance = this.balancesInstance?.getBalanceById(balanceId)
    if (!balance) return null
    return {
      amount: balance.amount,
      currency: String(balance.currency ?? 'USD'),
      type: balance.type === BalanceType.Real ? 'real' : 'demo',
    }
  }

  // ── Actives ────────────────────────────────────────────────────────────────

  async getAvailableActives(instrument: 'binary' | 'digital'): Promise<ActiveInfo[]> {
    if (instrument === 'binary' && !this.binaryOptionsInstance) throw new Error(tApp('notConnected'))
    if (instrument === 'digital' && !this.digitalOptionsInstance) throw new Error(tApp('notConnected'))
    const now = new Date()
    const result: ActiveInfo[] = []
    const seen = new Set<number>()

    if (instrument === 'binary') {
      const binActives = this.binaryOptionsInstance?.getActives() ?? []
      for (const a of binActives) {
        const ticker = a.ticker ?? ''
        const isOtc = /otc/i.test(ticker) && !/-op$/i.test(ticker)
        if (!seen.has(a.id) && isCurrencyPair(ticker)) {
          seen.add(a.id)
          result.push({
            id: a.id,
            ticker: ticker.replace(/\(OTC\)/gi, '').replace(/[-\s]OTC$/i, '').trim(),
            name: a.name ?? ticker,
            isOtc,
            availableBinary: a.canBeBoughtAt(now),
            availableDigital: false,
          })
        }
      }
    } else {
      // Acessa TODOS os underlyings via campo interno do SDK (inclui OTC + mercado regular)
      const allUnderlyings: any[] = Array.from(
        (this.digitalOptionsInstance as any).underlyings?.values() ?? []
      )

      for (const u of allUnderlyings) {
        // Digital não tem campo ticker — usar name diretamente
        const ticker = u.name ?? ''
        const isOtc = /otc/i.test(ticker) && !/-op$/i.test(ticker)

        if (!seen.has(u.activeId) && isCurrencyPair(ticker)) {
          seen.add(u.activeId)
          const availableNow = !u.isSuspended && u.isAvailableForTradingAt(new Date())

          result.push({
            id: u.activeId,
            ticker,
            name: ticker,
            isOtc,
            availableBinary: false,
            availableDigital: availableNow,
          })
        }
      }
    }

    return result.sort((a, b) => {
      if (a.isOtc !== b.isOtc) return a.isOtc ? 1 : -1
      return a.ticker.localeCompare(b.ticker)
    })
  }

  // ── Chart ─────────────────────────────────────────────────────────────────

  async subscribeCandles(
    activeId: number,
    onCandle: (
      c: { from: number; open: number; close: number; min: number; max: number },
      isLive: boolean
    ) => void
  ): Promise<() => void> {
    if (!this.sdk) throw new Error(tApp('notConnected'))
    const layer = await this.sdk.realTimeChartDataLayer(activeId, 60)
    // 6h de histórico M1 (~360 velas) para preencher a largura do gráfico mesmo
    // com a janela maximizada, evitando espaço vazio à esquerda.
    const HISTORY_WINDOW_SEC = 6 * 60 * 60
    const from = Math.floor(Date.now() / 1000) - HISTORY_WINDOW_SEC
    const hist = await layer.fetchAllCandles(from)

    for (const c of hist) {
      onCandle(
        { from: c.from as number, open: c.open, close: c.close, min: c.min, max: c.max },
        false
      )
    }

    const liveHandler = (c: any) => {
      onCandle(
        { from: c.from as number, open: c.open, close: c.close, min: c.min, max: c.max },
        true
      )
    }

    layer.subscribeOnLastCandleChanged(liveHandler)

    return () => {
      try {
        layer.unsubscribeOnLastCandleChanged(liveHandler)
      } catch {
        /* ignore */
      }
      try {
        ;(layer as any).close?.()
      } catch {
        /* ignore */
      }
    }
  }

  // ── Trading ───────────────────────────────────────────────────────────────

  async placeTrade(
    params: TradeParams,
    meta?: TradePlaceMeta,
  ): Promise<{ id: string; expiration: number }> {
    if (!this.sdk) throw new Error(tApp('notConnected'))
    const balance = this.balancesInstance.getBalanceById(params.balanceId)
    if (!balance) throw new Error(tApp('balanceNotFound'))

    this.validateStake(params.amount, balance)

    const tradeContext: Record<string, unknown> = {
      activeId: params.activeId,
      activeTicker: meta?.activeTicker,
      direction: params.direction,
      amount: params.amount,
      instrument: params.instrument,
      balanceId: params.balanceId,
      balanceAmount: balance.amount,
      currency: balance.currency,
      balanceType: balance.type === BalanceType.Real ? 'real' : 'demo',
    }

    try {
      return params.instrument === 'binary'
        ? await this.placeBinary(params, balance)
        : await this.placeDigital(params, balance)
    } catch (err) {
      if (err instanceof TradeOrderError) throw err
      throw parseBrokerOrderError(err, tradeContext)
    }
  }

  private validateStake(amount: number, balance: { amount: number; currency?: string }): void {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new TradeOrderError(tApp('invalidAmount'), { code: 'invalid_amount' })
    }

    const available = Number(balance.amount)
    const currency = String(balance.currency ?? 'USD')

    if (!Number.isFinite(available)) {
      throw new TradeOrderError(tApp('balanceUnreadable'), { code: 'balance_unavailable' })
    }

    if (amount > available) {
      throw new TradeOrderError(
        tApp('insufficientBalance', {
          available: available.toFixed(2),
          stake: amount.toFixed(2),
          cur: currency,
        }),
        {
          code: 'insufficient_balance',
          details: { available, requested: amount, currency },
        },
      )
    }

    const min = minStakeForCurrency(currency)
    if (amount < min) {
      throw new TradeOrderError(
        tApp('belowMinimum', { min, cur: currency }),
        {
          code: 'below_minimum',
          details: { min, requested: amount, currency },
        },
      )
    }
  }

  private async placeBinary(params: TradeParams, balance: any) {
    const now = this.brokerNow()

    const active = this.binaryOptionsInstance.getActives()
      .find((a: any) => a.id === params.activeId)
    if (!active) throw new Error(tApp('activeNotFoundBinary', { id: params.activeId }))
    if (!active.canBeBoughtAt(now)) throw new Error(tApp('activeClosedBinary', { id: params.activeId }))

    const instruments = await active.instruments()
    const available = instruments.getAvailableForBuyAt(now)
    if (!available.length) throw new Error(tApp('noBinaryInstrument'))

    const m1Candidates = available.filter((i: any) => {
      if (!(i.expiredAt instanceof Date)) return false
      if (i.expirationSize !== SdkBridge.M1_DURATION_SEC) return false
      return this.remainingForPurchase(i, now) >= SdkBridge.MIN_REMAINING_MS
    })

    if (!m1Candidates.length) {
      const sizes = Array.from(new Set(available.map((i: any) => i.expirationSize))).sort()
      throw new Error(tApp('binaryNoM1', { sizes: sizes.join(', ') }))
    }

    const instr = this.pickBestM1Instrument(
      m1Candidates,
      now,
      (i) => i.expiredAt as Date,
    )

    // Re-check imediatamente antes do buy (evita TOCTOU por latência)
    if (this.remainingForPurchase(instr, this.brokerNow()) < SdkBridge.MIN_REMAINING_MS) {
      throw new Error(tApp('noBinaryM1Safe'))
    }

    const dir = params.direction === 'CALL'
      ? BinaryOptionsDirection.Call
      : BinaryOptionsDirection.Put

    const result = await this.binaryOptionsInstance.buy(instr, dir, params.amount, balance)
    const returnedId = this.requireOrderId(result, 'Binary')

    if (result.openedAt instanceof Date && result.expiredAt instanceof Date) {
      const realDurationS = (result.expiredAt.getTime() - result.openedAt.getTime()) / 1000
      if (realDurationS > SdkBridge.MAX_ACCEPTABLE_REAL_DURATION_SEC) {
        console.warn(`[BINARY] ⚠️ Duração entregue ${realDurationS.toFixed(1)}s ≠ esperado ~60s`)
      } else {
        console.log(`[BINARY] ✅ Duração real: ${realDurationS.toFixed(1)}s`)
      }
    }

    return {
      id: returnedId,
      expiration: result.expiredAt instanceof Date
        ? result.expiredAt.getTime()
        : instr.expiredAt.getTime(),
    }
  }

  private async placeDigital(params: TradeParams, balance: any) {
    const now = this.brokerNow()

    const underlyings = this.digitalOptionsInstance.getUnderlyingsAvailableForTradingAt(now)
    const underlying = underlyings.find((u: any) => u.activeId === params.activeId)
    if (!underlying) throw new Error(tApp('activeNotDigital', { id: params.activeId }))

    const instruments = await underlying.instruments()
    const available = instruments.getAvailableForBuyAt(now)
    if (!available.length) throw new Error(tApp('noDigitalInstrument'))

    const m1Candidates = available.filter((i: any) => {
      if (!(i.expiration instanceof Date)) return false
      if (i.period !== SdkBridge.M1_DURATION_SEC) return false
      return this.remainingForPurchase(i, now) >= SdkBridge.MIN_REMAINING_MS
    })

    if (!m1Candidates.length) {
      throw new Error(tApp('noDigitalM1Safe'))
    }

    const instr = this.pickBestM1Instrument(
      m1Candidates,
      now,
      (i) => i.expiration as Date,
    )

    // Re-check imediatamente antes do buy (evita TOCTOU por latência)
    if (this.remainingForPurchase(instr, this.brokerNow()) < SdkBridge.MIN_REMAINING_MS) {
      throw new Error(tApp('noDigitalM1Safe'))
    }

    const dir = params.direction === 'CALL'
      ? DigitalOptionsDirection.Call
      : DigitalOptionsDirection.Put

    const result = await this.digitalOptionsInstance
      .buySpotStrike(instr, dir, params.amount, balance)

    const buyNow = this.brokerNow()
    const expectedDurationS = (instr.expiration.getTime() - buyNow.getTime()) / 1000
    const returnedId = this.requireOrderId(result, 'Digital')
    console.log(`[DIGITAL] ✅ M1 entry ok | duration=${expectedDurationS.toFixed(1)}s | id=${returnedId}`)

    return {
      id: returnedId,
      expiration: instr.expiration.getTime(),
    }
  }

  // ── Positions ─────────────────────────────────────────────────────────────

  subscribePositions(onResult: (ids: string[], isWin: boolean, profit: number) => void): () => void {
    const positions = this.positionsInstance
    if (!positions) return () => {}

    const listener = (pos: any) => {
      const isOption =
        pos.instrumentType === InstrumentType.BinaryOption  ||
        pos.instrumentType === InstrumentType.DigitalOption ||
        pos.instrumentType === InstrumentType.BlitzOption

      const closedLike = pos.status === 'closed'
                      || pos.status === 'expired'
                      || pos.status === 'finished'
                      || pos.status === 'sold'

      if (!isOption || !closedLike) return  // silencioso: ticks de open são muito frequentes

      const ids: string[] = []
      const push = (v: unknown) => {
        if (v === null || v === undefined) return
        const s = String(v)
        if (s && !ids.includes(s)) ids.push(s)
      }
      // Caminhos confiáveis: orderIds (bate com buy().id) + externalId (position)
      const orderIds = (pos as any).orderIds
      if (Array.isArray(orderIds)) orderIds.forEach(push)
      push(pos.externalId)
      push(pos.id)
      push((pos as any).orderId)
      push((pos as any).internalId)
      const rawEvent = (pos as any).rawEvent
      if (rawEvent && typeof rawEvent === 'object') {
        push(rawEvent.order_id)
        push(rawEvent.external_id)
        push(rawEvent.id)
        const rawOrders = rawEvent.order_ids ?? rawEvent.orderIds
        if (Array.isArray(rawOrders)) rawOrders.forEach(push)
      }

      const pnl =
        pos.pnlRealized
        ?? pos.sellProfit
        ?? pos.closeProfit
        ?? pos.pnlNet
        ?? (pos as any).pnl
        ?? 0
      const isWin = pnl > 0

      console.log(`[POSITION-CLOSED] ids=${JSON.stringify(ids)} pnl=${pnl} status=${pos.status}`)

      onResult(ids, isWin, pnl)
    }

    positions.subscribeOnUpdatePosition(listener)
    return () => {
      try {
        positions.unsubscribeOnUpdatePosition(listener)
      } catch {
        /* ignore */
      }
    }
  }

  getSdk(): ClientSdk | null { return this.sdk }
}