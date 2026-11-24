import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)
  const url = Deno.env.get('SUPABASE_URL')!, serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const auth = req.headers.get('Authorization')
  if (!auth) return json({ error: 'Não autorizado.' }, 401)
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) return json({ error: 'Não autorizado.' }, 401)
  const { data: allowed } = await userClient.rpc('is_admin')
  if (!allowed) return json({ error: 'Acesso administrativo necessário.' }, 403)
  let campaignId: unknown
  try { campaignId = (await req.json()).campaign_id } catch { return json({ error: 'Solicitação inválida.' }, 400) }
  if (typeof campaignId !== 'string' || !/^[0-9a-f-]{36}$/i.test(campaignId)) return json({ error: 'Campanha inválida.' }, 400)
  const db = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: campaign } = await db.from('campaigns').select('id,status,audience_filters,scheduled_at,subject,content_html,sender_email').eq('id', campaignId).maybeSingle()
  if (!campaign || !['draft','scheduled','failed'].includes(campaign.status)) return json({ error: 'Campanha indisponível para envio.' }, 409)
  if (!campaign.subject.trim() || !campaign.content_html.replace(/<[^>]*>/g,'').trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(campaign.sender_email)) return json({ error: 'Revise o assunto, o conteúdo e o remetente antes de preparar o envio.' }, 400)
  const filters = campaign.audience_filters as { tag_id?: string; created_after?: string; created_before?: string }
  let leadsQuery = db.from('leads').select('id').eq('status','active')
  if (filters?.created_after) leadsQuery = leadsQuery.gte('created_at', filters.created_after)
  if (filters?.created_before) leadsQuery = leadsQuery.lte('created_at', filters.created_before)
  if (filters?.tag_id) {
    const { data: tagged } = await db.from('lead_tags').select('lead_id').eq('tag_id', filters.tag_id)
    const ids = (tagged ?? []).map((x) => x.lead_id)
    if (!ids.length) return json({ error: 'A audiência elegível está vazia.' }, 409)
    leadsQuery = leadsQuery.in('id', ids)
  }
  const { data: leads, error } = await leadsQuery.limit(10000)
  if (error || !leads?.length) return json({ error: 'A audiência elegível está vazia.' }, 409)
  const rows = leads.map((lead) => ({ campaign_id: campaignId, lead_id: lead.id, status: 'queued' }))
  const { error: insertError } = await db.from('campaign_recipients').upsert(rows, { onConflict: 'campaign_id,lead_id', ignoreDuplicates: true })
  if (insertError) return json({ error: 'Não foi possível preparar a fila.' }, 500)
  const status=campaign.scheduled_at&&new Date(campaign.scheduled_at).getTime()>Date.now()?'scheduled':'queued'
  await db.from('campaigns').update({ status }).eq('id', campaignId)
  await db.from('audit_logs').insert({ admin_id: userData.user.id, action: 'queue_campaign', resource_type: 'campaign', resource_id: campaignId, metadata: { recipients: leads.length } })
  return json({ success: true, recipients: leads.length })
})
