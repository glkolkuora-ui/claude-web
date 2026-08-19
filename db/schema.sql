-- Replica do schema public + auth.users do Claude Pro (Supabase).
-- O projeto original no Supabase permanece intacto.

CREATE SCHEMA IF NOT EXISTS auth;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS auth.users (
  instance_id uuid,
  id uuid PRIMARY KEY,
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  confirmation_token varchar(255),
  confirmation_sent_at timestamptz,
  recovery_token varchar(255),
  recovery_sent_at timestamptz,
  email_change_token_new varchar(255),
  email_change varchar(255),
  email_change_sent_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  is_super_admin boolean,
  created_at timestamptz,
  updated_at timestamptz,
  phone text DEFAULT NULL,
  phone_confirmed_at timestamptz,
  phone_change text DEFAULT '',
  phone_change_token varchar(255) DEFAULT '',
  phone_change_sent_at timestamptz,
  confirmed_at timestamptz GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED,
  email_change_token_current varchar(255) DEFAULT '',
  email_change_confirm_status smallint DEFAULT 0,
  banned_until timestamptz,
  reauthentication_token varchar(255) DEFAULT '',
  reauthentication_sent_at timestamptz,
  is_sso_user boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  is_anonymous boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  phone text,
  license_status text DEFAULT 'inactive' CHECK (license_status IN ('active','inactive','expired','trial')),
  license_expires_at timestamptz,
  plan text DEFAULT 'free' CHECK (plan IN ('free','pago')),
  purchase_email text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  role text DEFAULT 'user' CHECK (role IN ('user','admin')),
  is_banned boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  session_start timestamptz DEFAULT now(),
  session_end timestamptz,
  app_version text,
  os_platform text,
  os_version text,
  local_session_id text
);

CREATE TABLE IF NOT EXISTS public.bot_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.user_sessions(id) ON DELETE SET NULL,
  started_at timestamptz DEFAULT now(),
  stopped_at timestamptz,
  active_ticker text,
  instrument text CHECK (instrument IN ('binary','digital')),
  strategies jsonb,
  base_amount numeric,
  account_type text CHECK (account_type IN ('demo','real')),
  starting_balance numeric,
  ending_balance numeric,
  wins int DEFAULT 0,
  losses int DEFAULT 0,
  total_trades int DEFAULT 0,
  pnl numeric DEFAULT 0,
  stopped_reason text,
  weekday int,
  hour_of_day int,
  local_run_id text
);

CREATE TABLE IF NOT EXISTS public.trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  bot_run_id uuid REFERENCES public.bot_runs(id) ON DELETE CASCADE,
  external_id text,
  active_ticker text,
  instrument text,
  strategy text CHECK (strategy IN ('Q5','ALT','LAST2','HARD')),
  direction text CHECK (direction IN ('CALL','PUT')),
  amount numeric,
  result text CHECK (result IN ('WIN','LOSS','PENDING')),
  profit numeric DEFAULT 0,
  entered_at timestamptz DEFAULT now(),
  resolved_at timestamptz,
  local_trade_id text
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  type text DEFAULT 'info' CHECK (type IN ('info','warning','update','promo','critical')),
  is_read boolean DEFAULT false,
  action_url text,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  broadcast_id uuid
);

CREATE TABLE IF NOT EXISTS public.app_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE,
  platform text DEFAULT 'all' CHECK (platform IN ('mac','win','linux','all')),
  download_url text,
  changelog text,
  is_mandatory boolean DEFAULT false,
  min_supported_version text,
  published_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.telemetry_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  event_data jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.license_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  authorized boolean NOT NULL,
  products_count int DEFAULT 0,
  has_claude_pro boolean DEFAULT false,
  client_ip text,
  user_agent text,
  app_version text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.license_email_whitelist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  note text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT license_email_whitelist_email_unique UNIQUE (email),
  CONSTRAINT license_email_whitelist_email_lower CHECK (email = lower(trim(email)))
);

CREATE TABLE IF NOT EXISTS public.modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  order_index int NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id uuid REFERENCES public.modules(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  youtube_url text NOT NULL,
  youtube_video_id text NOT NULL,
  duration_seconds int,
  order_index int NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lesson_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid REFERENCES public.lessons(id) ON DELETE CASCADE,
  title text NOT NULL,
  url text NOT NULL,
  type text DEFAULT 'link' CHECK (type IN ('pdf','sheet','link','video','document','other')),
  order_index int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lesson_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  lesson_id uuid REFERENCES public.lessons(id) ON DELETE CASCADE,
  is_watched boolean NOT NULL DEFAULT false,
  watched_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS public.cronograma_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  ig_options jsonb NOT NULL DEFAULT '[]'::jsonb,
  yt_options jsonb NOT NULL DEFAULT '[]'::jsonb,
  yt_weekly_target int NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cronograma_schedule_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES public.cronograma_operations(id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  time text NOT NULL,
  category text NOT NULL,
  content_html text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cronograma_daily_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES public.cronograma_operations(id) ON DELETE CASCADE,
  schedule_item_id uuid NOT NULL REFERENCES public.cronograma_schedule_items(id) ON DELETE CASCADE,
  completion_date date NOT NULL DEFAULT CURRENT_DATE,
  completed_at timestamptz NOT NULL DEFAULT now(),
  session_id text,
  UNIQUE (schedule_item_id, completion_date)
);

CREATE TABLE IF NOT EXISTS public.cronograma_weekly_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES public.cronograma_operations(id) ON DELETE CASCADE,
  week_iso text NOT NULL,
  day_index int NOT NULL CHECK (day_index >= 0 AND day_index <= 6),
  ig_option_index int,
  yt_option_index int,
  ig_posted boolean NOT NULL DEFAULT false,
  yt_posted boolean NOT NULL DEFAULT false,
  UNIQUE (operation_id, week_iso, day_index)
);

CREATE TABLE IF NOT EXISTS public.rate_limits (
  key text PRIMARY KEY,
  count int NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email_unique ON public.profiles (email);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles (role);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sessions_local_id ON public.user_sessions (local_session_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON public.user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_start ON public.user_sessions (session_start DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_runs_local_id ON public.bot_runs (local_run_id);
CREATE INDEX IF NOT EXISTS idx_bot_runs_session_id ON public.bot_runs (session_id);
CREATE INDEX IF NOT EXISTS idx_bot_runs_started ON public.bot_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_runs_user_id ON public.bot_runs (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_local_id ON public.trades (local_trade_id);
CREATE INDEX IF NOT EXISTS idx_trades_bot_run_id ON public.trades (bot_run_id);
CREATE INDEX IF NOT EXISTS idx_trades_entered_at ON public.trades (entered_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_result ON public.trades (result);
CREATE INDEX IF NOT EXISTS idx_trades_strategy ON public.trades (strategy);
CREATE INDEX IF NOT EXISTS idx_trades_user_id ON public.trades (user_id);
CREATE TABLE IF NOT EXISTS public.notification_dismissals (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_id uuid,
  item_key text,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_dismissals_target_check CHECK (
    (notification_id IS NOT NULL AND item_key IS NULL)
    OR (notification_id IS NULL AND item_key IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_dismissals_user_notif
  ON public.notification_dismissals (user_id, notification_id)
  WHERE notification_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_dismissals_user_item
  ON public.notification_dismissals (user_id, item_key)
  WHERE item_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notification_dismissals_user
  ON public.notification_dismissals (user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_broadcast_id ON public.notifications (broadcast_id) WHERE broadcast_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_created ON public.notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_app_versions_platform ON public.app_versions (platform);
CREATE INDEX IF NOT EXISTS idx_telemetry_created ON public.telemetry_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_event_name ON public.telemetry_events (event_name);
CREATE INDEX IF NOT EXISTS idx_telemetry_user_id ON public.telemetry_events (user_id);
CREATE INDEX IF NOT EXISTS idx_license_checks_authorized ON public.license_checks (authorized);
CREATE INDEX IF NOT EXISTS idx_license_checks_created_at ON public.license_checks (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_license_checks_email ON public.license_checks (email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_license_email_whitelist_email_active ON public.license_email_whitelist (email) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_modules_order ON public.modules (order_index);
CREATE INDEX IF NOT EXISTS idx_modules_published ON public.modules (is_published);
CREATE INDEX IF NOT EXISTS idx_lessons_module ON public.lessons (module_id);
CREATE INDEX IF NOT EXISTS idx_lessons_order ON public.lessons (module_id, order_index);
CREATE INDEX IF NOT EXISTS idx_lessons_published ON public.lessons (is_published);
CREATE INDEX IF NOT EXISTS idx_materials_lesson ON public.lesson_materials (lesson_id);
CREATE INDEX IF NOT EXISTS idx_progress_lesson ON public.lesson_progress (lesson_id);
CREATE INDEX IF NOT EXISTS idx_progress_user ON public.lesson_progress (user_id);
CREATE INDEX IF NOT EXISTS idx_progress_watched ON public.lesson_progress (user_id, is_watched);
CREATE INDEX IF NOT EXISTS idx_cronograma_schedule_items_operation ON public.cronograma_schedule_items (operation_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_cronograma_completions_op_date ON public.cronograma_daily_completions (operation_id, completion_date);
CREATE INDEX IF NOT EXISTS idx_cronograma_weekly_plans_op_week ON public.cronograma_weekly_plans (operation_id, week_iso);

CREATE OR REPLACE VIEW public.user_stats AS
SELECT
  p.id,
  p.email,
  p.full_name,
  p.license_status,
  p.plan,
  count(DISTINCT br.id) AS total_bot_runs,
  count(DISTINCT t.id) AS total_trades,
  sum(CASE WHEN t.result = 'WIN' THEN 1 ELSE 0 END) AS total_wins,
  sum(CASE WHEN t.result = 'LOSS' THEN 1 ELSE 0 END) AS total_losses,
  sum(t.profit) AS total_pnl,
  max(us.session_start) AS last_seen
FROM public.profiles p
LEFT JOIN public.user_sessions us ON us.user_id = p.id
LEFT JOIN public.bot_runs br ON br.user_id = p.id
LEFT JOIN public.trades t ON t.user_id = p.id
GROUP BY p.id;

CREATE OR REPLACE VIEW public.trades_by_weekday AS
SELECT
  user_id,
  extract(dow FROM entered_at)::int AS weekday,
  count(*) AS trades,
  sum(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END) AS wins,
  sum(profit) AS pnl
FROM public.trades
GROUP BY user_id, extract(dow FROM entered_at);

CREATE OR REPLACE VIEW public.trades_by_hour AS
SELECT
  user_id,
  extract(hour FROM entered_at)::int AS hour,
  count(*) AS trades,
  sum(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END) AS wins,
  sum(profit) AS pnl
FROM public.trades
GROUP BY user_id, extract(hour FROM entered_at);

CREATE OR REPLACE VIEW public.license_stats AS
SELECT
  date_trunc('day', created_at) AS day,
  count(*) AS total_attempts,
  sum(CASE WHEN authorized THEN 1 ELSE 0 END)::int AS authorized,
  sum(CASE WHEN NOT authorized THEN 1 ELSE 0 END)::int AS denied,
  count(DISTINCT email) AS unique_emails
FROM public.license_checks
GROUP BY date_trunc('day', created_at)
ORDER BY date_trunc('day', created_at) DESC;

CREATE OR REPLACE VIEW public.lesson_stats AS
SELECT
  l.id AS lesson_id,
  l.title,
  l.module_id,
  count(DISTINCT lp.user_id) FILTER (WHERE lp.is_watched = true) AS watched_count,
  (SELECT count(*) FROM public.profiles WHERE license_status = ANY (ARRAY['active'::text, 'trial'::text])) AS total_eligible_users
FROM public.lessons l
LEFT JOIN public.lesson_progress lp ON lp.lesson_id = l.id
GROUP BY l.id, l.title, l.module_id;

CREATE TABLE IF NOT EXISTS public.web_broker_tokens (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  refresh_token text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
