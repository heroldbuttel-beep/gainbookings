import pg from 'pg';

const { Pool } = pg;
let pool;
function getPool(){
  if(!process.env.POSTGRES_URL) throw new Error('Database is not configured.');
  if(!pool) pool=new Pool({connectionString:process.env.POSTGRES_URL,ssl:{rejectUnauthorized:false},max:3,idleTimeoutMillis:10000,connectionTimeoutMillis:10000});
  return pool;
}
function bodyOf(req){
  if(req.body && typeof req.body==='object') return req.body;
  if(typeof req.body==='string'){
    try{return JSON.parse(req.body)}catch{return {}}
  }
  return {};
}
function authorized(req){
  const expected=(process.env.DASHBOARD_PASSWORD||'').trim();
  if(!expected) return false;
  const body=bodyOf(req);
  const supplied=typeof body.password==='string' ? body.password.trim() : '';
  const header=typeof req.headers['x-dashboard-password']==='string' ? req.headers['x-dashboard-password'].trim() : '';
  return (supplied.length>0 && supplied===expected) || (header.length>0 && header===expected);
}
async function schema(db){
  await db.query(`
    CREATE TABLE IF NOT EXISTS ai_conversations(
      id UUID PRIMARY KEY, visitor_id TEXT, page_url TEXT, language TEXT, name TEXT, email TEXT, business TEXT,
      status TEXT NOT NULL DEFAULT 'new', lead_intent TEXT NOT NULL DEFAULT 'unknown', audit_requested BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS ai_messages(
      id BIGSERIAL PRIMARY KEY, conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}
export default async function handler(req,res){
  if(req.method==='GET' && req.query?.check==='1'){
    return res.status(200).json({configured:Boolean(process.env.DASHBOARD_PASSWORD),length:(process.env.DASHBOARD_PASSWORD||'').trim().length});
  }
  if(req.method==='GET'){
    return res.status(405).json({error:'Use dashboard access form'});
  }
  if(!authorized(req)){return res.status(401).json({error:'Unauthorized'});}
  try{
    const db=getPool(); await schema(db);
    if(req.method==='PATCH'){
      const body=bodyOf(req); const id=String(body.id||''); const status=String(body.status||'');
      if(!id||!['new','contacted','audit_requested','client'].includes(status)) return res.status(400).json({error:'Invalid update'});
      await db.query('UPDATE ai_conversations SET status=$1,updated_at=NOW() WHERE id=$2',[status,id]);
      return res.status(200).json({ok:true});
    }
    if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
    const id=typeof req.query?.id==='string'?req.query.id:'';
    if(id){
      const c=await db.query('SELECT * FROM ai_conversations WHERE id=$1',[id]);
      if(!c.rows[0]) return res.status(404).json({error:'Not found'});
      const m=await db.query('SELECT id,role,content,created_at FROM ai_messages WHERE conversation_id=$1 ORDER BY created_at ASC',[id]);
      return res.status(200).json({conversation:c.rows[0],messages:m.rows});
    }
    const c=await db.query('SELECT * FROM ai_conversations ORDER BY updated_at DESC LIMIT 200');
    return res.status(200).json({conversations:c.rows});
  }catch(error){console.error('dashboard error',error);return res.status(500).json({error:'Dashboard error'});}
}