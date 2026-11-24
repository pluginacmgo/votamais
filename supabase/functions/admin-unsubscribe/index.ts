import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, digest, json } from '../_shared/http.ts'

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  if(req.method!=='POST')return json({error:'Método não permitido.'},405)
  const url=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!
  const authorization=req.headers.get('Authorization');if(!authorization)return json({error:'Não autorizado.'},401)
  const userDb=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}})
  const {data:userResult,error:userError}=await userDb.auth.getUser();if(userError||!userResult.user)return json({error:'Não autorizado.'},401)
  const {data:allowed}=await userDb.rpc('is_admin');if(!allowed)return json({error:'Acesso administrativo necessário.'},403)
  let leadId:string;try{leadId=(await req.json()).lead_id}catch{return json({error:'Contato inválido.'},400)}
  if(typeof leadId!=='string'||!/^[0-9a-f-]{36}$/i.test(leadId))return json({error:'Contato inválido.'},400)
  const db=createClient(url,service,{auth:{persistSession:false}})
  const {data:lead}=await db.from('leads').select('email').eq('id',leadId).maybeSingle();if(!lead)return json({error:'Contato não encontrado.'},404)
  const now=new Date().toISOString();const {error}=await db.from('leads').update({status:'unsubscribed',unsubscribed_at:now}).eq('id',leadId)
  if(error)return json({error:'Não foi possível cancelar a inscrição.'},500)
  await db.from('lead_consents').update({revoked_at:now}).eq('lead_id',leadId).is('revoked_at',null)
  await db.from('suppression_list').upsert({email_hash:await digest(lead.email),reason:'admin_unsubscribed'},{onConflict:'email_hash',ignoreDuplicates:true})
  await db.from('campaign_recipients').update({status:'cancelled'}).eq('lead_id',leadId).in('status',['queued','failed'])
  await db.from('automation_executions').update({status:'cancelled'}).eq('lead_id',leadId).eq('status','active')
  await db.from('audit_logs').insert({admin_id:userResult.user.id,action:'unsubscribe_lead',resource_type:'lead',resource_id:leadId})
  return json({success:true})
})
