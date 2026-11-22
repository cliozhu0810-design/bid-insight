import { createServer } from 'node:http';
import { createHash,randomBytes,timingSafeEqual } from 'node:crypto';
import { readFile,mkdir } from 'node:fs/promises';
import { resolve,extname,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { Ledger,BillingError } from './ledger.mjs';
import { WeChat } from './wechat.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const live=process.env.BILLING_ENABLED==='true';
const provider=live?new WeChat(process.env):null;
const origin=provider?.origin||'http://127.0.0.1:'+(process.env.PORT||8980);
const hash=s=>createHash('sha256').update(s).digest('hex');
await mkdir(resolve(root,'server/data'),{recursive:true});
const ledger=new Ledger(process.env.DATABASE_PATH||resolve(root,'server/data/billing.sqlite'));
ledger.recoverInterrupted(); // Single-process deployment; never run this on a multi-replica shared database.
ledger.db.exec('CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS oauth(state_hash TEXT PRIMARY KEY,expires INTEGER NOT NULL)');
let activeJobs=0;
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))}
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(v=>v.trim().split('=')))}
function cookie(name,value,age){return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${live?'; Secure':''}`}
function user(req){const token=cookies(req).bj_session||'';const row=ledger.db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires>?').get(hash(token),Date.now());if(!row)throw new BillingError('请先使用微信登录',401);return row.user_id}
async function body(req,max=20*1024*1024){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>max)throw new BillingError('提取后的文本过大，请拆分标书后重试',413);chunks.push(chunk)}return Buffer.concat(chunks).toString('utf8')}
function validatePayload(p){
  if(!p||!Array.isArray(p.docs)||p.docs.length<2||p.docs.length>5)throw new BillingError('每次需要 2 至 5 份标书',400);
  if(typeof p.requestId!=='string'||!/^[-\w]{16,80}$/.test(p.requestId))throw new BillingError('请求编号无效',400);
  if(typeof p.baseline!=='string'||p.baseline.length>2000000||!Array.isArray(p.ignores)||p.ignores.length>1000||p.ignores.some(x=>typeof x!=='string'||x.length>1000))throw new BillingError('排除项格式无效',400);
  const ids=new Set();let textSize=0;
  for(const d of p.docs){
    if(!Number.isSafeInteger(d.id)||ids.has(d.id)||typeof d.company!=='string'||d.company.length>500||!Array.isArray(d.pages)||d.pages.length<1||d.pages.length>1000||!Array.isArray(d.fields)||d.fields.length>20000||!Array.isArray(d.images)||d.images.length>10000)throw new BillingError('分析材料格式无效',400);
    ids.add(d.id);
    for(const page of d.pages){if(typeof page.text!=='string'||!Number.isSafeInteger(page.no))throw new BillingError('页面格式无效',400);textSize+=page.text.length}
    for(const f of d.fields)if(typeof f.value!=='string'||typeof f.key!=='string'||typeof f.type!=='string'||typeof f.source!=='string'||!Number.isFinite(f.weight)||f.weight<0||f.weight>30)throw new BillingError('字段格式无效',400);
    for(const im of d.images)if(typeof im.hash!=='string'||!/^[01]{256}$/.test(im.hash)||!Number.isFinite(im.ratio)||im.ratio<=0||!Number.isSafeInteger(im.imageIndex)||typeof im.source!=='string'||im.src)throw new BillingError('只允许提交图片指纹，不接收原图',400);
  }
  if(textSize>10000000)throw new BillingError('提取文字超过本次分析上限，请拆分后重试',413);
}
function compare(payload){return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./compare-worker.mjs',import.meta.url),{workerData:payload,resourceLimits:{maxOldGenerationSizeMb:512}});
  const timer=setTimeout(()=>{worker.terminate();reject(new BillingError('分析超时，次数未扣除，请缩小材料后重试',503))},120000);
  const done=fn=>value=>{clearTimeout(timer);worker.terminate();fn(value)};
  worker.once('message',done(data=>data.error?reject(new Error(data.error)):resolve(data.pairs)));
  worker.once('error',done(reject));worker.once('exit',code=>{if(code!==0){clearTimeout(timer);reject(new Error('分析进程终止'))}});
})}
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,origin),path=url.pathname;
    if(path==='/billing-config.js'){res.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'no-store'});return res.end(`window.BID_BILLING=${JSON.stringify({mode:live?'live':'preview',apiBase:''})};`)}
    if(path.startsWith('/api/')){
      if(path==='/api/billing/config')return send(res,200,{enabled:live,priceFen:500,trialCount:1,maxFiles:5});
      if(!live)throw new BillingError('微信登录与支付尚未开通，当前不收款',503);
      if(path==='/api/payments/wechat/notify'&&req.method==='POST'){
        let event;try{event=provider.notification(await body(req,1024*1024),req.headers)}catch{throw new BillingError('支付回调校验失败',400)}
        ledger.paid(event,provider);return send(res,200,{code:'SUCCESS',message:'成功'});
      }
      if(req.method==='POST'&&req.headers.origin!==origin)throw new BillingError('请求来源无效',403);
      if(path==='/api/auth/wechat/start'&&req.method==='GET'){
        ledger.db.prepare('DELETE FROM oauth WHERE expires<?').run(Date.now());
        const state=randomBytes(24).toString('hex');ledger.db.prepare('INSERT INTO oauth VALUES(?,?)').run(hash(state),Date.now()+300000);
        res.writeHead(302,{Location:provider.oauthURL(state),'Set-Cookie':cookie('bj_oauth',state,300),'Cache-Control':'no-store'});return res.end();
      }
      if(path==='/api/auth/wechat/callback'&&req.method==='GET'){
        const state=url.searchParams.get('state')||'',stored=cookies(req).bj_oauth||'',code=url.searchParams.get('code');
        if(!state||state.length!==stored.length||!timingSafeEqual(Buffer.from(state),Buffer.from(stored))||!code)throw new BillingError('微信授权状态无效，请重新登录',400);
        const valid=ledger.db.prepare('DELETE FROM oauth WHERE state_hash=? AND expires>? RETURNING state_hash').get(hash(state),Date.now());if(!valid)throw new BillingError('授权已过期',400);
        const id=await provider.exchange(code);ledger.user(id);const token=randomBytes(32).toString('hex');ledger.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());ledger.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token),id,Date.now()+7*86400000);
        res.writeHead(302,{Location:'/', 'Set-Cookie':[cookie('bj_session',token,7*86400),cookie('bj_oauth','',0)],'Cache-Control':'no-store'});return res.end();
      }
      const id=user(req);
      if(path==='/api/account'&&req.method==='GET')return send(res,200,ledger.account(id));
      if(path==='/api/orders'&&req.method==='POST'){
        const account=ledger.account(id);if(account.trialRemaining||account.credits)throw new BillingError('已有可用次数，无需再次支付');
        const order=ledger.createOrder(id),payment=await provider.createOrder(order);return send(res,200,{orderId:order.id,priceFen:500,payment});
      }
      if(/^\/api\/orders\/BJ[a-f0-9]{30}$/.test(path)&&req.method==='GET'){
        const order=ledger.order(path.split('/').at(-1),id);
        if(order.state==='pending'){const transaction=await provider.query(order.id);if(transaction.trade_state==='SUCCESS')ledger.paid(transaction,provider)}
        const current=ledger.order(order.id,id);return send(res,200,{orderId:current.id,state:current.state,account:ledger.account(id)});
      }
      if(path==='/api/analysis'&&req.method==='POST'){
        if(activeJobs>=2)throw new BillingError('分析任务繁忙，请稍后重试；次数未扣除',503);
        const p=JSON.parse(await body(req));validatePayload(p);
        if(activeJobs>=2)throw new BillingError('分析任务繁忙，请稍后重试；次数未扣除',503);
        const batchHash=hash(JSON.stringify({docs:p.docs,baseline:p.baseline,ignores:p.ignores}));const reservation=ledger.begin(id,p.requestId,batchHash);activeJobs++;
        try{const pairs=await compare(p);if(!reservation.replay)ledger.finish(id,p.requestId);return send(res,200,{pairs,account:ledger.account(id),replay:reservation.replay})}
        catch(e){if(!reservation.replay)ledger.fail(id,p.requestId);throw e}finally{activeJobs--}
      }
      throw new BillingError('接口不存在',404);
    }
    if(req.method!=='GET'&&req.method!=='HEAD')throw new BillingError('请求方法不支持',405);
    const relative=decodeURIComponent(path).replace(/^\//,'')||'index.html';
    const allowed=new Set(['index.html','app.js','engine.js','style.css','limits.js','billing.js','analysis-worker.js']);
    if(!allowed.has(relative)&&!relative.startsWith('vendor/'))throw new BillingError('页面不存在',404);
    const file=resolve(root,relative);if(!file.startsWith(root+'/'))throw new BillingError('页面不存在',404);
    const data=await readFile(file);const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.gz':'application/gzip'};
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache','Referrer-Policy':'same-origin'});res.end(req.method==='HEAD'?undefined:data);
  }catch(e){if(!res.headersSent)send(res,e.status||500,{error:e instanceof BillingError?e.message:'服务暂时不可用，请重试；未完成的分析不扣次数'})}
});
server.requestTimeout=180000;server.headersTimeout=10000;
server.listen(Number(process.env.PORT||8980),process.env.HOST||'127.0.0.1',()=>console.log(`标鉴服务启动：${origin}；收费${live?'已启用':'未启用'}`));
