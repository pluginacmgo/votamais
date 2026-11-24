import { createClient } from 'npm:@supabase/supabase-js@2'
import sanitizeHtml from 'npm:sanitize-html@2'
import { corsHeaders, json } from '../_shared/http.ts'

const esc=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  if(req.method!=='POST')return json({error:'Método não permitido.'},405)
  const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,resend=Deno.env.get('RESEND_API_KEY')!
  const authorization=req.headers.get('Authorization')
  if(!authorization)return json({error:'Não autorizado.'},401)
  const userDb=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}})
  const {data:userResult,error:userError}=await userDb.auth.getUser()
  if(userError||!userResult.user?.email)return json({error:'Não autorizado.'},401)
  const {data:allowed}=await userDb.rpc('is_admin')
  if(!allowed)return json({error:'Acesso administrativo necessário.'},403)
  let campaignId:string
  try{campaignId=(await req.json()).campaign_id}catch{return json({error:'Campanha inválida.'},400)}
  if(typeof campaignId!=='string'||!/^[0-9a-f-]{36}$/i.test(campaignId))return json({error:'Campanha inválida.'},400)
  if(!resend)return json({error:'Envio de teste não configurado.'},503)
  const db=createClient(url,service,{auth:{persistSession:false}})
  const {data:campaign,error}=await db.from('campaigns').select('subject,preheader,sender_name,sender_email,reply_to,content_html').eq('id',campaignId).maybeSingle()
  if(error||!campaign)return json({error:'Campanha não encontrada.'},404)
  const from=`${campaign.sender_name.replace(/[<>\r\n]/g,'').slice(0,100)} <${campaign.sender_email}>`
  const safe=sanitizeHtml(campaign.content_html,{allowedTags:['p','br','strong','b','em','i','u','s','ol','ul','li','h1','h2','h3','blockquote','a','img','span','hr'],allowedAttributes:{a:['href','target','rel','style'],img:['src','alt','width','height'],span:['style'],p:['style'],h1:['style'],h2:['style'],h3:['style']},allowedSchemes:['https','mailto'],allowProtocolRelative:false})
  const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(campaign.subject)}</title></head><body style="margin:0;background:#f6f7f4;font-family:Arial,sans-serif;color:#203629"><div style="padding:9px 15px;background:#fff3cd;color:#705600;text-align:center;font-size:12px">Prévia de teste enviada apenas para o administrador.</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="600" style="max-width:600px;width:100%;background:white"><tr><td style="padding:28px 32px;font-size:15px;line-height:1.65"><div style="display:none;max-height:0;overflow:hidden">${esc(campaign.preheader??'')}</div>${safe}</td></tr></table></td></tr></table></body></html>`
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${resend}`,'Content-Type':'application/json','Idempotency-Key':`test-${campaignId}-${crypto.randomUUID()}`},body:JSON.stringify({from,to:[userResult.user.email],subject:`[TESTE] ${campaign.subject}`,html,reply_to:campaign.reply_to||undefined})})
  if(!response.ok)return json({error:'O provedor não aceitou o e-mail de teste.'},502)
  return json({success:true,message:`E-mail de teste enviado para ${userResult.user.email}.`})
})
