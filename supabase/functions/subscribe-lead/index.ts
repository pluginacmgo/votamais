import { createClient } from 'npm:@supabase/supabase-js@2'
import { z } from 'npm:zod@4'
import { corsHeaders, digest, json, verifyTurnstile } from '../_shared/http.ts'

const schema = z.object({
  email: z.string().trim().email().max(254), first_name: z.string().trim().max(80).nullable().optional(),
  consent: z.literal(true), consent_text: z.string().max(500), turnstile_token: z.string().min(1),
})
const consent = 'Desejo receber conteúdos, novidades, promoções e ofertas de produtos digitais por e-mail. Posso cancelar minha inscrição a qualquer momento.'
const generic = { message: 'Se o endereço puder ser inscrito, enviaremos um e-mail com os próximos passos.' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)
  let parsed: ReturnType<typeof schema.safeParse>
  try { parsed = schema.safeParse(await req.json()) } catch { return json({ error: 'Dados inválidos.' }, 400) }
  if (!parsed.success || parsed.data.consent_text !== consent) return json({ error: 'Revise os dados e o consentimento.' }, 400)
  if (!await verifyTurnstile(parsed.data.turnstile_token, req.headers.get('cf-connecting-ip'))) return json({ error: 'Verificação de segurança necessária.' }, 403)
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), resend = Deno.env.get('RESEND_API_KEY'), from = Deno.env.get('EMAIL_FROM'), appUrl = Deno.env.get('APP_URL')
  if (!url || !key || !resend || !from || !appUrl) return json({ error: 'Serviço temporariamente indisponível.' }, 503)
  const db = createClient(url, key, { auth: { persistSession: false } })
  const email = parsed.data.email.toLowerCase()
  const { data: suppression } = await db.from('suppression_list').select('id').eq('email_hash', await digest(email)).maybeSingle()
  if (suppression) return json(generic)
  const { data: existing } = await db.from('leads').select('id,status').eq('email', email).maybeSingle()
  if (existing) return json(generic)
  const { data: lead, error: leadError } = await db.from('leads').insert({ email, first_name: parsed.data.first_name || null, status: 'pending' }).select('id').single()
  if (leadError || !lead) return json(generic)
  const { error: consentError } = await db.from('lead_consents').insert({ lead_id: lead.id, consent_type: 'commercial_email', consent_text: consent, policy_version: '1.0' })
  if (consentError) { await db.from('leads').delete().eq('id', lead.id); return json(generic) }
  const rawToken = `${crypto.randomUUID()}${crypto.randomUUID().replaceAll('-', '')}`
  const { error: tokenError } = await db.from('signup_tokens').insert({ lead_id: lead.id, token_hash: await digest(rawToken), kind: 'confirm', expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() })
  if (tokenError) return json(generic)
  const confirmUrl = `${appUrl.replace(/\/$/, '')}/confirmar-inscricao?token=${encodeURIComponent(rawToken)}`
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${resend}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [email], subject: 'Confirme sua inscrição no Vota Mais', html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#193b2b"><h1>Confirme sua inscrição</h1><p>Para receber conteúdos e novidades do Vota Mais, confirme seu endereço:</p><p><a href="${confirmUrl}" style="display:inline-block;padding:13px 20px;background:#a9db6b;color:#173b2b;text-decoration:none;border-radius:8px">Confirmar inscrição</a></p><p>Se você não fez esta solicitação, pode ignorar esta mensagem.</p></div>` }) })
  if (!response.ok) return json(generic)
  return json(generic)
})
