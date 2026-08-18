export interface BalanceInfo { id: number; amount: number; currency: string; type: 'real' | 'demo' }
export interface ActiveInfo {
  id: number; ticker: string; name: string
  isOtc: boolean
  availableBinary: boolean
  availableDigital: boolean
}

export interface TradeRecord {
  id: string; strategy: string; direction: 'CALL' | 'PUT'
  amount: number; enteredAt: number; result: 'WIN' | 'LOSS' | 'PENDING'; profit: number
}

export interface BotStatus {
  running: boolean; activeId: number; activeTicker: string; instrument: string
  balanceStart: number; balanceCurrent: number; totalPnl: number
  wins: number; losses: number; consecLosses: number; winRate: number
  trades: TradeRecord[]
  currency?: string
  balanceId?: number
}

export interface BotConfig {
  activeId: number; activeTicker: string; instrument: 'binary' | 'digital'
  balanceId: number; entryAmount: number
  strategies: { q5: boolean; alt: boolean; last2: boolean; hard: boolean }
  stopLoss: number; stopWin: number; stopConsecLosses: number
  galeEnabled: boolean; galeRounds: number
  sorosEnabled: boolean; sorosMaxLevel: number
}

export interface UpdateCheckResult {
  ok: boolean
  needs_update?: boolean
  latest_version?: string
  download_url?: string
  changelog?: string
  is_mandatory?: boolean
  min_supported_version?: string | null
  published_at?: string
  error?: string
}

declare global {
  interface Window {
    claudePro: {
      /** Plataforma (`darwin`, `win32`, `web`). */
      appPlatform: string
      brokerStartAuth: () => Promise<{ ok: boolean; error?: string }>
      brokerExchangeCode: (code: string) => Promise<{ ok: boolean; error?: string }>
      brokerDisconnect: () => Promise<{ ok: boolean; error?: string }>
      brokerLogout: () => Promise<{ ok: boolean; error?: string }>
      brokerIsConnected: () => Promise<{ connected: boolean }>
      sdkBalances:     () => Promise<{ ok: boolean; balances?: BalanceInfo[]; error?: string }>
      sdkActives: (instrument?: 'binary' | 'digital') => Promise<{ ok: boolean; actives?: ActiveInfo[]; error?: string }>
      botStart:        (config: BotConfig) => Promise<{ ok: boolean; error?: string }>
      botStop:         () => Promise<{ ok: boolean; error?: string }>
      botGetStatus:    () => Promise<BotStatus>
      botChartSnapshot: () => Promise<Array<{ from: number; open: number; close: number; min: number; max: number }>>
      appGetVersion:   () => Promise<{ version: string; platform: 'mac' | 'win' | 'linux' }>
      appSetLocale:    (locale: string) => Promise<{ ok: boolean; locale: string }>
      appCheckUpdate:  () => Promise<UpdateCheckResult>
      appOpenExternal: (url: string) => Promise<{ ok: boolean; error?: string }>
      appClearStorage: () => Promise<{ ok: boolean }>
      setUserEmail:    (email: string) => Promise<{ ok: boolean; userId?: string; error?: string }>
      appGetUserId:    () => Promise<{ userId: string | null; email: string | null }>
      appGetEmbedOrigin: () => Promise<{ origin: string; pageUrl: string }>
      on: (channel: string, cb: (...args: any[]) => void) => () => void
    }
  }
}
