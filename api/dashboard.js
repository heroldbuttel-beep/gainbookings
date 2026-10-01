import pg from 'pg';

const { Pool } = pg;
let pool;
function getPool(){
  if(!process.env.POSTGRES_URL) throw new Error('Database is not configured.');
  if(!pool) pool=new Pool({connectionString:process.env.POSTGRES_URL,ssl:{rejectUnauthorized:false},max:3,idleTimeoutMillis:10000,connectionTimeoutMillis:10000});
  return pool;
}
function authorized(req){
  const expected=process.env.DASHBOARD_PASSWORD;
  if(!expected) return false;
  const header=req.headers.authorization||'';
  if(!header.startsWith('Basic ')) return false;
  try{
    const decoded=Buffer.from(header.slice(6),'base64').toString('utf8');
    return decoded.startsWith('dashboard:') && decoded.slice(10)===expected;
  }catch{return false}
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
  if(!authorized(req)){res.setHeader('WWW-Authenticate','Basic realm="GainBookings Dashboard"');return res.status(401).json({error:'Unauthorized'});}
  try{
    const db=getPool(); await schema(db);
    if(req.method==='PATCH'){
      const body=req.body||{}; const id=String(body.id||''); const status=String(body.status||'');
      if(!id||!['new','contacted','audit_requested','client'].includes(status)) return res.status(400).json({error:'Invalid update'});
      await db.query('UPDATE ai_conversations SET status=$1,updated_at=NOW() WHERE id=$2',[status,id]);
      return res.status(200).json({ok:true});
    }
    if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
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