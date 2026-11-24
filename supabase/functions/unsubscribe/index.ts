import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, digest, json } from '../_shared/http.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method === 'GET') {
    const token = new URL(req.url).searchParams.get('token')
    if (!token) return json({ error: 'Link inválido.' }, 400)
    return Response.redirect(`${Deno.env.get('APP_URL') ?? 'http://localhost:5173'}/descadastrar?token=${encodeURIComponent(token)}`, 302)
  }
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)
  let token: unknown
  try {
    const urlToken = new URL(req.url).searchParams.get('token')
    token = urlToken ?? (req.headers.get('content-type')?.includes('application/x-www-form-urlencoded') ? new URLSearchParams(await req.text()).get('token') : (await req.json()).token)
  } catch { return json({ error: 'Link inválido.' }, 400) }
  if (typeof token !== 'string' || token.length < 32 || token.length > 100) return json({ error: 'Link inválido.' }, 400)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: record } = await db.from('signup_tokens').select('id,lead_id').eq('token_hash', await digest(token)).eq('kind', 'unsubscribe').is('used_at', null).maybeSingle()
  if (!record) return json({ success: true })
  const { data: lead } = await db.from('leads').select('email').eq('id', record.lead_id).maybeSingle()
  if (!lead?.email) return json({ success: true })
  const now = new Date().toISOString()
  const { error } = await db.from('leads').update({ status: 'unsubscribed', unsubscribed_at: now }).eq('id', record.lead_id)
  if (error) return json({ error: 'Não foi possível processar.' }, 500)
  await db.from('lead_consents').update({ revoked_at: now }).eq('lead_id', record.lead_id).is('revoked_at', null)
  await db.from('suppression_list').upsert({ email_hash: await digest(lead.email), reason: 'unsubscribed' }, { onConflict: 'email_hash', ignoreDuplicates: true })
  await db.from('campaign_recipients').update({ status: 'cancelled' }).eq('lead_id', record.lead_id).in('status', ['queued','failed'])
  await db.from('automation_executions').update({ status: 'cancelled' }).eq('lead_id', record.lead_id).eq('status', 'active')
  await db.from('signup_tokens').update({ used_at: now }).eq('id', record.id)
  return json({ success: true })
})
