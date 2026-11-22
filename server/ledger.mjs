import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
export const PRICE_FEN=500;
export class BillingError extends Error{constructor(message,status=409){super(message);this.status=status}}
export class Ledger {
  constructor(path=':memory:'){
    this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,trial_used INTEGER NOT NULL DEFAULT 0 CHECK(trial_used IN (0,1)));
      CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),amount INTEGER NOT NULL CHECK(amount=500),state TEXT NOT NULL DEFAULT 'pending',transaction_id TEXT UNIQUE,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(user_id TEXT NOT NULL REFERENCES users(id),request_id TEXT NOT NULL,batch_hash TEXT NOT NULL,state TEXT NOT NULL,source TEXT NOT NULL,order_id TEXT REFERENCES orders(id),updated INTEGER NOT NULL,PRIMARY KEY(user_id,request_id));
      CREATE UNIQUE INDEX IF NOT EXISTS one_running_per_user ON runs(user_id) WHERE state='running';
      CREATE UNIQUE INDEX IF NOT EXISTS one_use_per_order ON runs(order_id) WHERE state IN ('running','done');`);
  }
  tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result}catch(e){this.db.exec('ROLLBACK');throw e}}
  user(id){this.db.prepare('INSERT OR IGNORE INTO users(id) VALUES(?)').run(id);return this.account(id)}
  account(id){const u=this.db.prepare('SELECT * FROM users WHERE id=?').get(id);if(!u)throw new BillingError('请先使用微信登录',401);const credit=this.db.prepare("SELECT COUNT(*) AS n FROM orders o WHERE user_id=? AND state='paid' AND NOT EXISTS(SELECT 1 FROM runs r WHERE r.order_id=o.id AND r.state IN ('running','done'))").get(id).n;return {trialRemaining:u.trial_used?0:1,credits:credit,priceFen:PRICE_FEN}}
  createOrder(id){this.account(id);return this.tx(()=>{const pending=this.db.prepare("SELECT * FROM orders WHERE user_id=? AND state='pending' ORDER BY created DESC LIMIT 1").get(id);if(pending)return pending;const order={id:'BJ'+randomBytes(15).toString('hex'),user_id:id,amount:PRICE_FEN,state:'pending',created:Date.now()};this.db.prepare('INSERT INTO orders(id,user_id,amount,created) VALUES(?,?,?,?)').run(order.id,id,order.amount,order.created);return order})}
  order(id,user){const order=this.db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(id,user);if(!order)throw new BillingError('订单不存在',404);return order}
  paid(event,config){return this.tx(()=>{
    const o=this.db.prepare('SELECT * FROM orders WHERE id=?').get(event.out_trade_no);
    if(!o||event.trade_state!=='SUCCESS'||event.appid!==config.appId||event.mchid!==config.mchId||event.amount?.total!==PRICE_FEN||event.amount?.currency!=='CNY'||event.payer?.openid!==o.user_id||!event.transaction_id)throw new BillingError('支付信息核验失败',400);
    if(o.transaction_id){if(o.transaction_id!==event.transaction_id)throw new BillingError('交易号不匹配',400);return o}
    if(o.state!=='pending')throw new BillingError('订单状态不允许入账');
    this.db.prepare("UPDATE orders SET state='paid',transaction_id=? WHERE id=?").run(event.transaction_id,o.id);return this.order(o.id,o.user_id);
  })}
  begin(user,requestId,batchHash){return this.tx(()=>{
    const old=this.db.prepare('SELECT * FROM runs WHERE user_id=? AND request_id=?').get(user,requestId);
    if(old&&old.batch_hash!==batchHash)throw new BillingError('同一请求编号不可用于不同分析材料');
    if(old?.state==='done')return {...old,replay:true};
    if(this.db.prepare("SELECT 1 FROM runs WHERE user_id=? AND state='running'").get(user))throw new BillingError('已有分析正在执行，请勿重复提交');
    const account=this.account(user);let source='trial',orderId=null;
    if(!account.trialRemaining){source='paid';orderId=this.db.prepare("SELECT o.id FROM orders o WHERE user_id=? AND state='paid' AND NOT EXISTS(SELECT 1 FROM runs r WHERE r.order_id=o.id AND r.state IN ('running','done')) ORDER BY created LIMIT 1").get(user)?.id;if(!orderId)throw new BillingError('免费试用已使用，请支付 5 元获取一次分析次数',402)}
    this.db.prepare("INSERT INTO runs(user_id,request_id,batch_hash,state,source,order_id,updated) VALUES(?,?,?,'running',?,?,?) ON CONFLICT(user_id,request_id) DO UPDATE SET state='running',source=excluded.source,order_id=excluded.order_id,updated=excluded.updated").run(user,requestId,batchHash,source,orderId,Date.now());return {source,replay:false};
  })}
  finish(user,requestId){return this.tx(()=>{const r=this.db.prepare('SELECT * FROM runs WHERE user_id=? AND request_id=?').get(user,requestId);if(!r||r.state!=='running')throw new BillingError('分析状态不匹配');if(r.source==='trial')this.db.prepare('UPDATE users SET trial_used=1 WHERE id=?').run(user);else this.db.prepare("UPDATE orders SET state='used' WHERE id=? AND state='paid'").run(r.order_id);this.db.prepare("UPDATE runs SET state='done',updated=? WHERE user_id=? AND request_id=?").run(Date.now(),user,requestId)})}
  fail(user,requestId){this.db.prepare("UPDATE runs SET state='failed',updated=? WHERE user_id=? AND request_id=? AND state='running'").run(Date.now(),user,requestId)}
  recoverInterrupted(){this.db.exec("UPDATE runs SET state='failed' WHERE state='running'")}
  close(){this.db.close()}
}
