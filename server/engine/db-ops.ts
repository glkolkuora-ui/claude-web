import { randomUUID } from 'crypto'
import { FEATURE_FLAGS, SUPABASE_URL, SUPABASE_ANON_KEY } from './feature-flags'
import { requirePool } from './db'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function tsOrNow(v: unknown): Date {
  if (typeof v === 'string') {
    const t = Date.parse(v)
    if (!Number.isNaN(t)) return new Date(t)
  }
  return new Date()
}

function asText(v: unknown): string | null {
  if (v == null) return null
  const s = String(v)
  return s.length ? s : null
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v as T : null
}

export async function upsertUserByEmail(email: string): Promise<string> {
  const clean = email.trim().toLowerCase()
  if (!EMAIL_RE.test(clean)) throw new Error('invalid_email')
  const db = requirePool()

  const existing = await db.query<{ id: string }>(
    'SELECT id FROM public.profiles WHERE email = $1 LIMIT 1',
    [clean],
  )
  if (existing.rows[0]) return existing.rows[0].id

  const id = randomUUID()
  const now = new Date()
  try {
    await db.query(
      `INSERT INTO auth.users (
         id, instance_id, aud, role, email, encrypted_password,
         email_confirmed_at, created_at, updated_at,
         raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous
       ) VALUES (
         $1, '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', $2, crypt($3, gen_salt('bf')),
         $4, $4, $4, $5::jsonb, $6::jsonb, false, false
       )`,
      [
        id,
        clean,
        randomUUID(),
        now,
        JSON.stringify({ provider: 'email', providers: ['email'] }),
        JSON.stringify({ source: 'claude-web' }),
      ],
    )
    await db.query(
      `INSERT INTO public.profiles (id, email, license_status, plan, role, is_banned, created_at, updated_at)
       VALUES ($1, $2, 'trial', 'free', 'user', false, $3, $3)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, updated_at = EXCLUDED.updated_at`,
      [id, clean, now],
    )
    return id
  } catch (err) {
    const retry = await db.query<{ id: string }>(
      'SELECT id FROM public.profiles WHERE email = $1 LIMIT 1',
      [clean],
    )
    if (retry.rows[0]) return retry.rows[0].id
    throw err
  }
}

export async function verifyLicense(input: {
  email: string
  appVersion?: string
  clientIp?: string
  userAgent?: string
}): Promise<{ authorized: boolean; user_id?: string; message?: string }> {
  const email = input.email.trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return { authorized: false, message: 'invalid_email' }
  const db = requirePool()

  let authorized = FEATURE_FLAGS.LICENSE_OPEN_ACCESS
  if (!authorized) {
    const white = await db.query(
      `SELECT 1 FROM public.license_email_whitelist
       WHERE email = $1 AND is_active = true LIMIT 1`,
      [email],
    )
    if ((white.rowCount ?? 0) > 0) authorized = true
  }
  if (!authorized) {
    const profile = await db.query<{ id: string }>(
      `SELECT id FROM public.profiles
       WHERE email = $1
         AND is_banned = false
         AND license_status IN ('active', 'trial')
         AND (license_expires_at IS NULL OR license_expires_at > now())
       LIMIT 1`,
      [email],
    )
    authorized = Boolean(profile.rows[0])
  }

  await db.query(
    `INSERT INTO public.license_checks
       (email, authorized, products_count, has_claude_pro, client_ip, user_agent, app_version)
     VALUES ($1, $2, 0, $2, $3, $4, $5)`,
    [email, authorized, input.clientIp ?? null, input.userAgent ?? null, input.appVersion ?? 'web'],
  )

  if (!authorized) return { authorized: false, message: 'denied' }
  const userId = await upsertUserByEmail(email)
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/verify-license`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ email, app_version: input.appVersion ?? 'web' }),
    })
  } catch {
    /* refresh de token ainda usa a Edge; falha aqui não bloqueia o web */
  }
  return { authorized: true, user_id: userId }
}

interface TelemetryEvent {
  event_name?: unknown
  event_data?: Record<string, unknown> | null
  created_at?: unknown
}

export async function ingestTelemetry(
  userId: string,
  events: TelemetryEvent[],
): Promise<{ processed: number; errors: string[] }> {
  if (!UUID_RE.test(userId)) throw new Error('invalid_user_id')
  const db = requirePool()
  let processed = 0
  const errors: string[] = []

  for (const ev of events) {
    const name = String(ev?.event_name ?? '')
    const d = (ev?.event_data ?? {}) as Record<string, any>
    const at = tsOrNow(ev?.created_at)
    try {
      if (name === 'session_start') {
        if (!d.local_session_id) throw new Error('missing local_session_id')
        await db.query(
          `INSERT INTO public.user_sessions
             (user_id, local_session_id, app_version, os_platform, os_version, session_start)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (local_session_id) DO UPDATE SET
             user_id = EXCLUDED.user_id,
             app_version = COALESCE(EXCLUDED.app_version, public.user_sessions.app_version),
             os_platform = COALESCE(EXCLUDED.os_platform, public.user_sessions.os_platform),
             os_version = COALESCE(EXCLUDED.os_version, public.user_sessions.os_version)`,
          [userId, String(d.local_session_id), asText(d.app_version), asText(d.os_platform), asText(d.os_release ?? d.os_version), at],
        )
      } else if (name === 'session_end') {
        if (!d.local_session_id) throw new Error('missing local_session_id')
        await db.query(
          `UPDATE public.user_sessions SET session_end = $2 WHERE local_session_id = $1`,
          [String(d.local_session_id), at],
        )
      } else if (name === 'bot_start') {
        if (!d.local_run_id) throw new Error('missing local_run_id')
        await db.query(
          `INSERT INTO public.bot_runs
             (user_id, local_run_id, active_ticker, instrument, strategies, base_amount,
              account_type, starting_balance, started_at, weekday, hour_of_day)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (local_run_id) DO UPDATE SET
             active_ticker = EXCLUDED.active_ticker,
             instrument = EXCLUDED.instrument,
             strategies = EXCLUDED.strategies,
             base_amount = EXCLUDED.base_amount`,
          [
            userId,
            String(d.local_run_id),
            asText(d.active_ticker),
            oneOf(d.instrument, ['binary', 'digital'] as const),
            d.strategies == null ? null : JSON.stringify(d.strategies),
            d.base_amount ?? null,
            oneOf(d.account_type, ['demo', 'real'] as const),
            d.starting_balance ?? null,
            at,
            d.weekday ?? null,
            d.hour_of_day ?? null,
          ],
        )
      } else if (name === 'bot_stop') {
        if (!d.local_run_id) throw new Error('missing local_run_id')
        await db.query(
          `UPDATE public.bot_runs SET
             stopped_at = $2, ending_balance = $3, wins = $4, losses = $5,
             total_trades = $6, pnl = $7, stopped_reason = $8
           WHERE local_run_id = $1`,
          [
            String(d.local_run_id),
            at,
            d.ending_balance ?? null,
            d.wins ?? 0,
            d.losses ?? 0,
            d.total_trades ?? 0,
            d.pnl ?? 0,
            asText(d.stopped_reason),
          ],
        )
      } else if (name === 'trade_entered') {
        if (!d.local_trade_id) throw new Error('missing local_trade_id')
        let botRunId: string | null = null
        if (d.local_run_id) {
          const run = await db.query<{ id: string }>(
            'SELECT id FROM public.bot_runs WHERE local_run_id = $1 LIMIT 1',
            [String(d.local_run_id)],
          )
          botRunId = run.rows[0]?.id ?? null
        }
        await db.query(
          `INSERT INTO public.trades
             (user_id, bot_run_id, local_trade_id, external_id, active_ticker,
              instrument, strategy, direction, amount, result, entered_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING', $10)
           ON CONFLICT (local_trade_id) DO UPDATE SET
             external_id = COALESCE(EXCLUDED.external_id, public.trades.external_id),
             amount = COALESCE(EXCLUDED.amount, public.trades.amount)`,
          [
            userId,
            botRunId,
            String(d.local_trade_id),
            asText(d.external_id),
            asText(d.active_ticker),
            asText(d.instrument),
            oneOf(d.strategy, ['Q5', 'ALT', 'LAST2', 'HARD'] as const),
            oneOf(d.direction, ['CALL', 'PUT'] as const),
            d.amount ?? null,
            at,
          ],
        )
      } else if (name === 'trade_result') {
        if (!d.local_trade_id) throw new Error('missing local_trade_id')
        await db.query(
          `UPDATE public.trades SET
             result = COALESCE($2, result), profit = COALESCE($3, profit), resolved_at = $4
           WHERE local_trade_id = $1`,
          [
            String(d.local_trade_id),
            oneOf(d.result, ['WIN', 'LOSS', 'PENDING'] as const),
            d.profit ?? 0,
            at,
          ],
        )
      } else {
        await db.query(
          `INSERT INTO public.telemetry_events (user_id, event_name, event_data, created_at)
           VALUES ($1, $2, $3::jsonb, $4)`,
          [userId, name.slice(0, 100), JSON.stringify(d ?? {}), at],
        )
      }
      processed++
    } catch (e: any) {
      errors.push(`${name}: ${e?.message ?? String(e)}`)
    }
  }

  return { processed, errors }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

export async function checkUpdate(platform: string, currentVersion: string) {
  const db = requirePool()
  const platforms = platform === 'web' ? ['all'] : [platform, 'all']
  const { rows } = await db.query<{
    version: string
    platform: string
    download_url: string | null
    changelog: string | null
    is_mandatory: boolean
    min_supported_version: string | null
    published_at: string
  }>(
    `SELECT version, platform, download_url, changelog, is_mandatory, min_supported_version, published_at
     FROM public.app_versions
     WHERE platform = ANY($1::text[])`,
    [platforms],
  )
  const publishable = rows.filter((r) => typeof r.download_url === 'string' && r.download_url.trim())
  if (publishable.length === 0) {
    return { latest_version: currentVersion, needs_update: false, message: 'Nenhuma versão publicada' }
  }
  const latest = publishable.reduce((best, row) =>
    compareVersions(row.version, best.version) > 0 ? row : best,
  )
  const needsUpdate = compareVersions(latest.version, currentVersion) > 0
  const mandatory =
    latest.is_mandatory ||
    (latest.min_supported_version != null && compareVersions(currentVersion, latest.min_supported_version) < 0)
  return {
    latest_version: latest.version,
    download_url: latest.download_url,
    changelog: latest.changelog,
    is_mandatory: mandatory,
    min_supported_version: latest.min_supported_version,
    published_at: latest.published_at,
    needs_update: needsUpdate,
  }
}

export async function listLessonCatalog() {
  const db = requirePool()
  const [mods, lessons, materials] = await Promise.all([
    db.query(`SELECT * FROM public.modules WHERE is_published = true ORDER BY order_index ASC`),
    db.query(`SELECT * FROM public.lessons WHERE is_published = true ORDER BY order_index ASC`),
    db.query(`SELECT * FROM public.lesson_materials ORDER BY order_index ASC`),
  ])
  return {
    modules: mods.rows,
    lessons: lessons.rows,
    materials: materials.rows,
  }
}

export async function listLessonProgress(userId: string): Promise<string[]> {
  if (!UUID_RE.test(userId)) return []
  const db = requirePool()
  const { rows } = await db.query<{ lesson_id: string }>(
    `SELECT lesson_id FROM public.lesson_progress WHERE user_id = $1 AND is_watched = true`,
    [userId],
  )
  return rows.map((r) => r.lesson_id)
}

export async function markLessonProgress(userId: string, lessonId: string, isWatched: boolean) {
  if (!UUID_RE.test(userId) || !UUID_RE.test(lessonId)) throw new Error('invalid_id')
  const db = requirePool()
  const now = new Date()
  await db.query(
    `INSERT INTO public.lesson_progress (user_id, lesson_id, is_watched, watched_at, updated_at)
     VALUES ($1, $2, $3, $4, $4)
     ON CONFLICT (user_id, lesson_id) DO UPDATE SET
       is_watched = EXCLUDED.is_watched,
       watched_at = EXCLUDED.watched_at,
       updated_at = EXCLUDED.updated_at`,
    [userId, lessonId, isWatched, isWatched ? now : null],
  )
}

export async function listNotifications(userId: string | null) {
  const db = requirePool()
  const uid = userId && UUID_RE.test(userId) ? userId : null
  const { rows } = await db.query(
    `SELECT id, user_id, title, message, type, is_read, action_url, created_at, expires_at
     FROM public.notifications
     WHERE (expires_at IS NULL OR expires_at > now())
       AND (${uid ? 'user_id = $1 OR user_id IS NULL' : 'user_id IS NULL'})
     ORDER BY created_at DESC
     LIMIT 30`,
    uid ? [uid] : [],
  )

  const dismissed_keys: string[] = []
  let notifications = rows
  if (uid) {
    const dismissed = await db.query<{ notification_id: string | null; item_key: string | null }>(
      `SELECT notification_id, item_key FROM public.notification_dismissals WHERE user_id = $1`,
      [uid],
    )
    const hiddenIds = new Set<string>()
    for (const row of dismissed.rows) {
      if (row.notification_id) hiddenIds.add(row.notification_id)
      if (row.item_key) dismissed_keys.push(row.item_key)
    }
    notifications = notifications.filter((n) => !hiddenIds.has(n.id))
  }
  return { notifications, dismissed_keys }
}

export async function markNotificationRead(input: {
  userId: string | null
  notificationId?: string
  itemKey?: string
}): Promise<{ ok: boolean; error?: string }> {
  const db = requirePool()
  const userId = input.userId && UUID_RE.test(input.userId) ? input.userId : null
  const itemKey = input.itemKey?.trim() ?? ''
  const notificationId = input.notificationId ?? ''

  if (!notificationId && !itemKey) return { ok: false, error: 'notification_id ou item_key obrigatório' }

  if (itemKey) {
    if (!userId) return { ok: false, error: 'user_id obrigatório para item_key' }
    await db.query(
      `INSERT INTO public.notification_dismissals (user_id, notification_id, item_key)
       VALUES ($1, NULL, $2)
       ON CONFLICT (user_id, item_key) WHERE item_key IS NOT NULL DO NOTHING`,
      [userId, itemKey],
    )
    return { ok: true }
  }

  const row = await db.query<{ id: string; user_id: string | null }>(
    `SELECT id, user_id FROM public.notifications WHERE id = $1`,
    [notificationId],
  )
  const found = row.rows[0]
  if (!found) return { ok: false, error: 'not_found' }

  if (found.user_id == null) {
    if (!userId) return { ok: false, error: 'user_id obrigatório para broadcast' }
    await db.query(
      `INSERT INTO public.notification_dismissals (user_id, notification_id, item_key)
       VALUES ($1, $2, NULL)
       ON CONFLICT (user_id, notification_id) WHERE notification_id IS NOT NULL DO NOTHING`,
      [userId, notificationId],
    )
    return { ok: true }
  }

  if (userId && found.user_id !== userId) return { ok: false, error: 'forbidden' }
  await db.query(
    `UPDATE public.notifications SET is_read = true WHERE id = $1 AND user_id = $2`,
    [notificationId, found.user_id],
  )
  return { ok: true }
}

export async function clearNotifications(userId: string, dismissKeys: string[]) {
  if (!UUID_RE.test(userId)) throw new Error('invalid_user_id')
  const db = requirePool()
  const broadcasts = await db.query<{ id: string }>(
    `SELECT id FROM public.notifications
     WHERE user_id IS NULL AND (expires_at IS NULL OR expires_at > now())`,
  )
  for (const row of broadcasts.rows) {
    await db.query(
      `INSERT INTO public.notification_dismissals (user_id, notification_id, item_key)
       VALUES ($1, $2, NULL)
       ON CONFLICT (user_id, notification_id) WHERE notification_id IS NOT NULL DO NOTHING`,
      [userId, row.id],
    )
  }
  for (const key of dismissKeys) {
    await db.query(
      `INSERT INTO public.notification_dismissals (user_id, notification_id, item_key)
       VALUES ($1, NULL, $2)
       ON CONFLICT (user_id, item_key) WHERE item_key IS NOT NULL DO NOTHING`,
      [userId, key],
    )
  }
  const deleted = await db.query(
    `DELETE FROM public.notifications WHERE user_id = $1 RETURNING id`,
    [userId],
  )
  return { ok: true, cleared: (deleted.rowCount ?? 0) + broadcasts.rows.length + dismissKeys.length }
}
