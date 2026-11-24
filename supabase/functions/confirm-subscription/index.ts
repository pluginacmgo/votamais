import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, digest, json } from '../_shared/http.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)
  let token: unknown
  try { token = (await req.json()).token } catch { return json({ error: 'Link inválido ou expirado.' }, 400) }
  if (typeof token !== 'string' || token.length < 32 || token.length > 100) return json({ error: 'Link inválido ou expirado.' }, 400)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: record } = await db.from('signup_tokens').select('id,lead_id').eq('token_hash', await digest(token)).eq('kind', 'confirm').is('used_at', null).gt('expires_at', new Date().toISOString()).maybeSingle()
  if (!record) return json({ error: 'Link inválido ou expirado.' }, 400)
  const now = new Date().toISOString()
  const { error } = await db.from('leads').update({ status: 'active', confirmed_at: now }).eq('id', record.lead_id).eq('status', 'pending')
  if (error) return json({ error: 'Não foi possível confirmar.' }, 500)
  await db.from('signup_tokens').update({ used_at: now }).eq('id', record.id)
  return json({ success: true })
})
