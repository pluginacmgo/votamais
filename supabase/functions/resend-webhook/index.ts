import { Webhook } from 'npm:svix@1'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, digest, json } from '../_shared/http.ts'

const typeMap: Record<string,string> = { 'email.sent':'sent','email.delivered':'delivered','email.delivery_delayed':'delayed','email.bounced':'bounced','email.complained':'complained','email.opened':'opened','email.clicked':'clicked' }
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)
  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET')
  if (!secret) return json({ error: 'Webhook indisponível.' }, 503)
  let payload: { type?: string; created_at?: string; data?: { email_id?: string; to?: string[]; [key:string]: unknown } }
  try { payload = new Webhook(secret).verify(await req.text(), { 'svix-id': req.headers.get('svix-id') ?? '', 'svix-timestamp': req.headers.get('svix-timestamp') ?? '', 'svix-signature': req.headers.get('svix-signature') ?? '' }) as typeof payload }
  catch { return json({ error: 'Assinatura inválida.' }, 400) }
  const eventType = payload.type && typeMap[payload.type], providerId = req.headers.get('svix-id'), emailId = payload.data?.email_id
  if (!eventType || !providerId || !emailId) return json({ error: 'Evento não suportado.' }, 400)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: recipient } = await db.from('campaign_recipients').select('id,lead_id,leads(email)').eq('provider_email_id', emailId).maybeSingle()
  const { error: inserted } = await db.from('email_events').insert({ recipient_id: recipient?.id ?? null, provider_event_id: providerId, provider_email_id: emailId, event_type: eventType, metadata: payload.data ?? {} })
  if (inserted?.code === '23505') return json({ success: true, duplicate: true })
  if (inserted) return json({ error: 'Não foi possível registrar o evento.' }, 500)
  if (!recipient) return json({ success: true })
  const now = new Date().toISOString()
  if (eventType === 'delivered') await db.from('campaign_recipients').update({ status:'delivered', delivered_at:now }).eq('id',recipient.id)
  if (['bounced','complained'].includes(eventType)) {
    await db.from('campaign_recipients').update({ status:eventType }).eq('id',recipient.id)
    const leadData = recipient.leads as unknown as { email:string } | null
    if (leadData?.email) {
      await db.from('leads').update({ status:eventType }).eq('id',recipient.lead_id)
      await db.from('campaign_recipients').update({status:'cancelled'}).eq('lead_id',recipient.lead_id).in('status',['queued','failed'])
      await db.from('suppression_list').upsert({email_hash:await digest(leadData.email),reason:eventType},{onConflict:'email_hash',ignoreDuplicates:true})
    }
  }
  return json({ success:true })
})
