/** Locale do renderer, usado em logs, diálogos e erros visíveis na UI. */

export type AppLocale = 'pt' | 'en' | 'es'

const BCP47: Record<AppLocale, string> = {
  pt: 'pt-BR',
  en: 'en-US',
  es: 'es-ES',
}

export type AppMsgKey =
  | 'started' | 'stopped' | 'sleep' | 'resume'
  | 'resubFail' | 'standbyTrade'
  | 'warmup' | 'hardRecovered' | 'unlockStuck'
  | 'ignoredOpen' | 'hardRetryPending' | 'hardRetryDiscard'
  | 'releasing' | 'entry' | 'entryRetry' | 'entryFail'
  | 'result' | 'stopLoss' | 'stopWin' | 'consecLosses'
  | 'hardGiveUp' | 'hardRetryWait' | 'inFlight' | 'timeout2min'
  | 'reasonM1' | 'reasonRejected'
  | 'brokerRejected' | 'missingOrderId' | 'noM1'
  | 'botAlreadyRunning' | 'hardConflict'
  | 'authStartFirst' | 'urlNoCode' | 'balanceNotFound'
  | 'reconnectFail' | 'loginRefused'
  | 'emailNotSet' | 'oauthFail' | 'oauthNotInit' | 'notAuthenticated'
  | 'notConnected' | 'emptyOAuthCode' | 'noRefreshToken'
  | 'activeNotFoundBinary' | 'activeClosedBinary' | 'noBinaryInstrument'
  | 'binaryNoM1' | 'noBinaryM1Safe'
  | 'activeNotDigital' | 'noDigitalInstrument' | 'noDigitalM1Safe'
  | 'invalidAmount' | 'balanceUnreadable' | 'insufficientBalance' | 'belowMinimum'
  | 'errCode' | 'errDetail'
  | 'dialogCancel' | 'dialogClear' | 'dialogTitle' | 'dialogMessage' | 'dialogDetail'

const MSG: Record<AppLocale, Record<AppMsgKey, string>> = {
  pt: {
    started: '🟢 Bot iniciado',
    stopped: '🔴 Bot parado',
    sleep: '💤 Sistema dormindo — bot pausado',
    resume: '☀️ Sistema voltou — bot retomado',
    resubFail: '⚠️ Falha ao re-subscrever após standby: {msg}',
    standbyTrade: '⚠️ Operação {id} pode ter fechado durante standby — verifique o extrato',
    warmup: '✅ Aquecimento concluído — monitorando ao vivo',
    hardRecovered: '⚠️ HARD: operação travada recuperada',
    unlockStuck: '🔓 Liberando lock travado: {id}',
    ignoredOpen: '⏸️ {strategy} ignorado: operação {id} ainda aberta',
    hardRetryPending: '⏸️ HARD ignorado: já há retry agendado',
    hardRetryDiscard: '⏸️ HARD reagendado descartado: operação anterior ainda aberta',
    releasing: '⚠️ {reason}: liberando operação {id}',
    entry: '📍 {strategy}: {direction} | {ticker} | {stake} {cur}',
    entryRetry: '❌ Erro ao entrar: {detail} · motivo: {reason} — vou tentar de novo',
    entryFail: '❌ Erro ao entrar: {detail}',
    result: '{icon} {result} | {strategy} | {direction} | {profit}',
    stopLoss: '🛑 Stop Loss atingido: {pnl}',
    stopWin: '🏆 Stop Win atingido: +{pnl}',
    consecLosses: '🛑 {n} losses consecutivos',
    hardGiveUp: '❌ HARD: desistindo após {n} tentativas — {reason}',
    hardRetryWait: '⏳ HARD: {reason} — tentativa {n}/{max} na janela segura (em {sec}s)',
    inFlight: 'em voo',
    timeout2min: 'Timeout 2min',
    reasonM1: 'instrumento M1 indisponível neste instante',
    reasonRejected: 'corretora recusou a ordem (pode ser timing ou ativo)',
    brokerRejected:
      'A corretora recusou a ordem. Verifique saldo, se o ativo está aberto e se o valor é permitido — tente a mesma operação manualmente no site da Broker10.',
    missingOrderId: '{label}: corretora não retornou ID da ordem.',
    noM1: 'Nenhum instrumento M1 com duração aceitável (≥30s)',
    botAlreadyRunning: 'Bot já está rodando',
    hardConflict: 'HARD não pode coexistir com Q5/ALT/LAST2',
    authStartFirst: 'Inicie o fluxo de autenticação primeiro',
    urlNoCode: 'URL sem código de autorização (parâmetro code)',
    balanceNotFound: 'Saldo não encontrado',
    reconnectFail: 'Falha ao reconectar após standby: {msg}',
    loginRefused:
      'A Broker10 recusou o login. Clique em "Entrar com Broker10" de novo, faça login no navegador e cole a URL nova em até 1 minuto (cada link só vale uma vez).',
    emailNotSet: 'Email do usuário não definido — passe pelo LicenseGate antes do login Broker10',
    oauthFail: 'Falha ao iniciar OAuth',
    oauthNotInit: 'OAuth não inicializado — clique em "Entrar com Broker10" e tente de novo',
    notAuthenticated: 'Não autenticado',
    notConnected: 'Não conectado',
    emptyOAuthCode: 'Código OAuth vazio',
    noRefreshToken: 'Sem refresh_token disponível',
    activeNotFoundBinary: 'Ativo {id} não encontrado em Binary',
    activeClosedBinary: 'Ativo {id} fechado em Binary',
    noBinaryInstrument: 'Nenhum instrumento Binary disponível',
    binaryNoM1:
      'Binary não oferece M1 (60s) para este ativo. Durações disponíveis: [{sizes}]. Use Digital ou troque de ativo.',
    noBinaryM1Safe: 'Nenhum instrumento Binary M1 (60s) disponível com margem segura',
    activeNotDigital: 'Ativo {id} não disponível em Digital',
    noDigitalInstrument: 'Nenhum instrumento Digital disponível',
    noDigitalM1Safe: 'Nenhum instrumento Digital M1 (60s) disponível com margem segura',
    invalidAmount: 'Valor de entrada inválido.',
    balanceUnreadable: 'Não foi possível ler o saldo da conta.',
    insufficientBalance:
      'Saldo insuficiente: disponível {available} {cur}, entrada {stake} {cur}.',
    belowMinimum:
      'Valor abaixo do mínimo estimado ({min} {cur}). Aumente o valor base no painel.',
    errCode: 'cód',
    errDetail: 'detalhe',
    dialogCancel: 'Cancelar',
    dialogClear: 'Limpar e reiniciar',
    dialogTitle: 'Limpar dados do app',
    dialogMessage: 'Apagar licença salva, login e cookies deste app?',
    dialogDetail: 'O app será recarregado. Será necessário validar o email de licença novamente.',
  },
  en: {
    started: '🟢 Bot started',
    stopped: '🔴 Bot stopped',
    sleep: '💤 System sleeping — bot paused',
    resume: '☀️ System back — bot resumed',
    resubFail: '⚠️ Failed to resubscribe after standby: {msg}',
    standbyTrade: '⚠️ Trade {id} may have closed during standby — check the statement',
    warmup: '✅ Warm-up complete — monitoring live',
    hardRecovered: '⚠️ HARD: stuck trade recovered',
    unlockStuck: '🔓 Releasing stuck lock: {id}',
    ignoredOpen: '⏸️ {strategy} skipped: trade {id} still open',
    hardRetryPending: '⏸️ HARD skipped: a retry is already scheduled',
    hardRetryDiscard: '⏸️ HARD reschedule dropped: previous trade still open',
    releasing: '⚠️ {reason}: releasing trade {id}',
    entry: '📍 {strategy}: {direction} | {ticker} | {stake} {cur}',
    entryRetry: '❌ Entry error: {detail} · reason: {reason} — retrying',
    entryFail: '❌ Entry error: {detail}',
    result: '{icon} {result} | {strategy} | {direction} | {profit}',
    stopLoss: '🛑 Stop Loss hit: {pnl}',
    stopWin: '🏆 Stop Win hit: +{pnl}',
    consecLosses: '🛑 {n} consecutive losses',
    hardGiveUp: '❌ HARD: giving up after {n} attempts — {reason}',
    hardRetryWait: '⏳ HARD: {reason} — attempt {n}/{max} in the safe window (in {sec}s)',
    inFlight: 'in flight',
    timeout2min: '2min timeout',
    reasonM1: 'M1 instrument unavailable right now',
    reasonRejected: 'broker rejected the order (timing or asset)',
    brokerRejected:
      'The broker rejected the order. Check your balance, whether the asset is open, and whether the stake is allowed — try the same trade manually on the Broker10 site.',
    missingOrderId: '{label}: broker did not return an order ID.',
    noM1: 'No M1 instrument with acceptable duration (≥30s)',
    botAlreadyRunning: 'Bot is already running',
    hardConflict: 'HARD cannot run together with Q5/ALT/LAST2',
    authStartFirst: 'Start the authentication flow first',
    urlNoCode: 'URL has no authorization code (code parameter)',
    balanceNotFound: 'Balance not found',
    reconnectFail: 'Failed to reconnect after standby: {msg}',
    loginRefused:
      'Broker10 refused the login. Click "Sign in with Broker10" again, sign in in the browser, and paste the new URL within 1 minute (each link works only once).',
    emailNotSet: 'User email is not set — go through LicenseGate before Broker10 login',
    oauthFail: 'Failed to start OAuth',
    oauthNotInit: 'OAuth is not initialized — click "Sign in with Broker10" and try again',
    notAuthenticated: 'Not authenticated',
    notConnected: 'Not connected',
    emptyOAuthCode: 'Empty OAuth code',
    noRefreshToken: 'No refresh_token available',
    activeNotFoundBinary: 'Asset {id} not found in Binary',
    activeClosedBinary: 'Asset {id} is closed in Binary',
    noBinaryInstrument: 'No Binary instrument available',
    binaryNoM1:
      'Binary does not offer M1 (60s) for this asset. Available durations: [{sizes}]. Use Digital or switch assets.',
    noBinaryM1Safe: 'No Binary M1 (60s) instrument available with a safe margin',
    activeNotDigital: 'Asset {id} not available in Digital',
    noDigitalInstrument: 'No Digital instrument available',
    noDigitalM1Safe: 'No Digital M1 (60s) instrument available with a safe margin',
    invalidAmount: 'Invalid stake amount.',
    balanceUnreadable: 'Could not read the account balance.',
    insufficientBalance:
      'Insufficient balance: available {available} {cur}, stake {stake} {cur}.',
    belowMinimum:
      'Amount below the estimated minimum ({min} {cur}). Increase the base amount in the panel.',
    errCode: 'code',
    errDetail: 'detail',
    dialogCancel: 'Cancel',
    dialogClear: 'Clear and restart',
    dialogTitle: 'Clear app data',
    dialogMessage: 'Erase saved license, login, and cookies from this app?',
    dialogDetail: 'The app will reload. You will need to validate the license email again.',
  },
  es: {
    started: '🟢 Bot iniciado',
    stopped: '🔴 Bot detenido',
    sleep: '💤 Sistema en reposo — bot pausado',
    resume: '☀️ Sistema de vuelta — bot reanudado',
    resubFail: '⚠️ Fallo al re-suscribir tras standby: {msg}',
    standbyTrade: '⚠️ La operación {id} pudo cerrarse en standby — revisa el extracto',
    warmup: '✅ Calentamiento listo — monitoreando en vivo',
    hardRecovered: '⚠️ HARD: operación trabada recuperada',
    unlockStuck: '🔓 Liberando lock trabado: {id}',
    ignoredOpen: '⏸️ {strategy} ignorado: operación {id} aún abierta',
    hardRetryPending: '⏸️ HARD ignorado: ya hay un retry agendado',
    hardRetryDiscard: '⏸️ HARD reprogramado descartado: operación anterior aún abierta',
    releasing: '⚠️ {reason}: liberando operación {id}',
    entry: '📍 {strategy}: {direction} | {ticker} | {stake} {cur}',
    entryRetry: '❌ Error al entrar: {detail} · motivo: {reason} — reintentando',
    entryFail: '❌ Error al entrar: {detail}',
    result: '{icon} {result} | {strategy} | {direction} | {profit}',
    stopLoss: '🛑 Stop Loss alcanzado: {pnl}',
    stopWin: '🏆 Stop Win alcanzado: +{pnl}',
    consecLosses: '🛑 {n} losses consecutivos',
    hardGiveUp: '❌ HARD: se desiste tras {n} intentos — {reason}',
    hardRetryWait: '⏳ HARD: {reason} — intento {n}/{max} en la ventana segura (en {sec}s)',
    inFlight: 'en vuelo',
    timeout2min: 'Timeout 2min',
    reasonM1: 'instrumento M1 no disponible en este instante',
    reasonRejected: 'el broker rechazó la orden (puede ser timing o activo)',
    brokerRejected:
      'El broker rechazó la orden. Revisa el saldo, si el activo está abierto y si el valor está permitido — prueba la misma operación manualmente en el sitio de Broker10.',
    missingOrderId: '{label}: el broker no devolvió el ID de la orden.',
    noM1: 'Ningún instrumento M1 con duración aceptable (≥30s)',
    botAlreadyRunning: 'El bot ya está en marcha',
    hardConflict: 'HARD no puede coexistir con Q5/ALT/LAST2',
    authStartFirst: 'Inicia el flujo de autenticación primero',
    urlNoCode: 'URL sin código de autorización (parámetro code)',
    balanceNotFound: 'Saldo no encontrado',
    reconnectFail: 'Fallo al reconectar tras standby: {msg}',
    loginRefused:
      'Broker10 rechazó el login. Haz clic en "Entrar con Broker10" de nuevo, inicia sesión en el navegador y pega la URL nueva en menos de 1 minuto (cada enlace solo vale una vez).',
    emailNotSet: 'Email del usuario no definido — pasa por LicenseGate antes del login Broker10',
    oauthFail: 'Fallo al iniciar OAuth',
    oauthNotInit: 'OAuth no inicializado — haz clic en "Entrar con Broker10" e inténtalo de nuevo',
    notAuthenticated: 'No autenticado',
    notConnected: 'No conectado',
    emptyOAuthCode: 'Código OAuth vacío',
    noRefreshToken: 'Sin refresh_token disponible',
    activeNotFoundBinary: 'Activo {id} no encontrado en Binary',
    activeClosedBinary: 'Activo {id} cerrado en Binary',
    noBinaryInstrument: 'Ningún instrumento Binary disponible',
    binaryNoM1:
      'Binary no ofrece M1 (60s) para este activo. Duraciones disponibles: [{sizes}]. Usa Digital o cambia de activo.',
    noBinaryM1Safe: 'Ningún instrumento Binary M1 (60s) disponible con margen seguro',
    activeNotDigital: 'Activo {id} no disponible en Digital',
    noDigitalInstrument: 'Ningún instrumento Digital disponible',
    noDigitalM1Safe: 'Ningún instrumento Digital M1 (60s) disponible con margen seguro',
    invalidAmount: 'Valor de entrada inválido.',
    balanceUnreadable: 'No se pudo leer el saldo de la cuenta.',
    insufficientBalance:
      'Saldo insuficiente: disponible {available} {cur}, entrada {stake} {cur}.',
    belowMinimum:
      'Valor por debajo del mínimo estimado ({min} {cur}). Aumenta el valor base en el panel.',
    errCode: 'cód',
    errDetail: 'detalle',
    dialogCancel: 'Cancelar',
    dialogClear: 'Limpiar y reiniciar',
    dialogTitle: 'Limpiar datos de la app',
    dialogMessage: '¿Borrar licencia guardada, login y cookies de esta app?',
    dialogDetail: 'La app se recargará. Será necesario validar el email de licencia otra vez.',
  },
}

let current: AppLocale = 'pt'

export function setAppLocale(next: string): AppLocale {
  if (next === 'en' || next === 'es' || next === 'pt') current = next
  return current
}

export function getAppLocale(): AppLocale {
  return current
}

export function logTime(): string {
  return new Date().toLocaleTimeString(BCP47[current])
}

export function tApp(key: AppMsgKey, vars?: Record<string, string | number>): string {
  let s = MSG[current][key]
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (_, k: string) =>
    vars[k] == null ? `{${k}}` : String(vars[k]),
  )
}
