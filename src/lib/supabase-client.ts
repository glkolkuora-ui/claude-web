// ════════════════════════════════════════════════════════════════════
// Cliente Supabase para o RENDERER (React).
// Usa localStorage para persistir a sessão de auth.
// ════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../feature-flags'

export { SUPABASE_URL, SUPABASE_ANON_KEY }

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    storageKey: 'claudepro-auth',
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})
