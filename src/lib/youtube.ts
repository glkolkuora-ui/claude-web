/** ID válido do YouTube (11 caracteres). */
const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/

const YOUTUBE_ID_IN_TEXT = [
  /(?:youtube\.com\/embed\/|youtube-nocookie\.com\/embed\/)([a-zA-Z0-9_-]{11})/i,
  /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/i,
  /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/i,
  /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/i,
  /youtu\.be\/([a-zA-Z0-9_-]{11})/i,
  /[?&]v=([a-zA-Z0-9_-]{11})/i,
]

function isValidVideoId(id: string): boolean {
  return YOUTUBE_ID_RE.test(id)
}

/** Extrai o ID do vídeo a partir de URL do YouTube, embed ou ID cru. */
export function extractYoutubeVideoId(input: string | null | undefined): string | null {
  const raw = input?.trim()
  if (!raw) return null

  if (isValidVideoId(raw)) return raw

  for (const pattern of YOUTUBE_ID_IN_TEXT) {
    const match = raw.match(pattern)
    if (match?.[1] && isValidVideoId(match[1])) return match[1]
  }

  try {
    const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase()

    if (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com' ||
      host === 'youtube-nocookie.com'
    ) {
      const embedMatch = parsed.pathname.match(/^\/embed\/([^/?]+)/)
      if (embedMatch?.[1] && isValidVideoId(embedMatch[1])) return embedMatch[1]

      const shortsMatch = parsed.pathname.match(/^\/shorts\/([^/?]+)/)
      if (shortsMatch?.[1] && isValidVideoId(shortsMatch[1])) return shortsMatch[1]

      const liveMatch = parsed.pathname.match(/^\/live\/([^/?]+)/)
      if (liveMatch?.[1] && isValidVideoId(liveMatch[1])) return liveMatch[1]

      const v = parsed.searchParams.get('v')
      if (v && isValidVideoId(v)) return v
    }

    if (host === 'youtu.be') {
      const id = parsed.pathname.replace(/^\//, '').split('/')[0]?.split('?')[0]
      if (id && isValidVideoId(id)) return id
    }
  } catch {
    /* URL inválida */
  }

  return null
}

/** Prioriza youtube_url (admin); fallback em youtube_video_id. */
export function resolveLessonVideoId(lesson: {
  youtube_url?: string | null
  youtube_video_id?: string | null
}): string | null {
  const fromUrl = extractYoutubeVideoId(lesson.youtube_url)
  if (fromUrl) return fromUrl
  return extractYoutubeVideoId(lesson.youtube_video_id)
}

export function youtubeWatchUrl(videoId: string): string {
  const id = extractYoutubeVideoId(videoId) ?? videoId
  return `https://www.youtube.com/watch?v=${id}`
}

export type YoutubeEmbedOptions = {
  origin?: string
  pageUrl?: string
}

function resolveEmbedContext(opts: YoutubeEmbedOptions = {}): { origin: string; pageUrl: string } {
  const origin =
    opts.origin ??
    (typeof window !== 'undefined' && window.location?.origin && window.location.protocol !== 'file:'
      ? window.location.origin
      : 'http://127.0.0.1')

  const pageUrl =
    opts.pageUrl ??
    (typeof window !== 'undefined' && window.location?.href && window.location.protocol !== 'file:'
      ? window.location.href
      : `${origin}/index.html`)

  return { origin, pageUrl }
}

/**
 * Embed direto (um único iframe) — evita tela preta ao dar play/seek no Electron.
 */
export function youtubeEmbedSrc(videoId: string, opts: YoutubeEmbedOptions = {}): string {
  const id = extractYoutubeVideoId(videoId) ?? (isValidVideoId(videoId) ? videoId : null)
  if (!id) return 'about:blank'

  const { origin, pageUrl } = resolveEmbedContext(opts)

  const params = new URLSearchParams({
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
    fs: '1',
    origin,
    widget_referrer: pageUrl,
  })

  return `https://www.youtube.com/embed/${id}?${params.toString()}`
}
