const SYMBOLS: Record<string, string> = {
  USD: '$',
  BRL: 'R$',
  EUR: '€',
  GBP: '£',
  ARS: '$',
  MXN: '$',
}

const LOCALES: Record<string, string> = {
  USD: 'en-US',
  BRL: 'pt-BR',
  EUR: 'de-DE',
  GBP: 'en-GB',
}

export function currencySymbol(code?: string): string {
  if (!code) return '$'
  return SYMBOLS[code.toUpperCase()] ?? code.toUpperCase() + ' '
}

export function formatCurrency(value: number, code?: string): string {
  const loc = LOCALES[code?.toUpperCase() ?? ''] ?? 'en-US'
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  return `${sign}${currencySymbol(code)} ${abs.toLocaleString(loc, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}
