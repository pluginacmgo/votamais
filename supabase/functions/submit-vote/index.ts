import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeadersFor, json, verifyTurnstile } from '../_shared/http.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeadersFor(req) })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405, req)
  let body: { poll_option_id?: unknown; turnstile_token?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Solicitação inválida.' }, 400, req) }
  if (typeof body.poll_option_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.poll_option_id)) return json({ error: 'Opção inválida.' }, 400, req)
  if (!await verifyTurnstile(body.turnstile_token, req.headers.get('cf-connecting-ip'))) return json({ error: 'Verificação de segurança necessária.' }, 403, req)
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return json({ error: 'Serviço temporariamente indisponível.' }, 503, req)
  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const { data, error } = await supabase.rpc('record_anonymous_vote', { p_option_id: body.poll_option_id })
  if (error) return json({ error: 'Enquete indisponível.' }, 409, req)
  return json({ success: true, results: data ?? [] }, 200, req)
})
