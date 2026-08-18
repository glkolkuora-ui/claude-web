// ════════════════════════════════════════════════════════════════════
// Cliente Supabase para o processo MAIN do Electron.
// Não usa storage persistente (main não tem localStorage).
// Quando LOGIN_REQUIRED=true, o JWT do usuário será fornecido pelo
// renderer via IPC para as chamadas que exigem auth.
// ════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './feature-flags'

export const supabaseMain = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

/** Helper: faz fetch numa Edge Function com JWT opcional. */
export async function callEdgeFunction(
  name: string,
  body: unknown,
  jwt?: string,
): Promise<{ ok: boolean; status: number; data?: any; error?: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    const data = text ? JSON.parse(text) : null
    if (!res.ok) {
      return { ok: false, status: res.status, error: data?.error ?? `HTTP ${res.status}`, data }
    }
    return { ok: true, status: res.status, data }
  } catch (e: any) {
    return { ok: false, status: 0, error: e?.message ?? 'network_error' }
  }
}
