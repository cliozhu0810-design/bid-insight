import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync,sign,createCipheriv,randomBytes } from 'node:crypto';
import { Ledger,PRICE_FEN } from '../server/ledger.mjs';
import { WeChat } from '../server/wechat.mjs';
const config={appId:'test_app',mchId:'test_merchant'};
function fixture(t){const l=new Ledger();l.user('wx_a');t.after(()=>l.close());return l}
function event(o,extra={}){return {out_trade_no:o.id,trade_state:'SUCCESS',appid:config.appId,mchid:config.mchId,amount:{total:500,currency:'CNY'},payer:{openid:o.user_id},transaction_id:'wx_tx_'+o.id,...extra}}
test('每个微信账号只有一次成功试用，重新登录不重置',t=>{const l=fixture(t);assert.equal(l.begin('wx_a','request_a','hash_a').source,'trial');l.finish('wx_a','request_a');l.user('wx_a');assert.equal(l.account('wx_a').trialRemaining,0);assert.throws(()=>l.begin('wx_a','request_b','hash_b'),e=>e.status===402);l.user('wx_b');assert.equal(l.account('wx_b').trialRemaining,1)});
test('并发请求不能重复领取试用',t=>{const l=fixture(t);l.begin('wx_a','request_a','hash_a');assert.throws(()=>l.begin('wx_a','request_b','hash_b'),/正在执行/);l.fail('wx_a','request_a');assert.equal(l.begin('wx_a','request_b','hash_b').source,'trial')});
test('重复提交成功任务不重复计费，换材料不允许沿用请求号',t=>{const l=fixture(t);l.begin('wx_a','request_a','hash_a');l.finish('wx_a','request_a');assert.equal(l.begin('wx_a','request_a','hash_a').replay,true);assert.throws(()=>l.begin('wx_a','request_a','other'),/不同分析材料/)});
test('固定金额为500分，重复支付通知只入账一次',t=>{const l=fixture(t),o=l.createOrder('wx_a');assert.equal(o.amount,PRICE_FEN);assert.equal(l.createOrder('wx_a').id,o.id);l.paid(event(o),config);l.paid(event(o),config);assert.equal(l.account('wx_a').credits,1)});
test('错误金额、币种、付款人、商户和状态都拒绝入账',t=>{const l=fixture(t),o=l.createOrder('wx_a');for(const extra of [{amount:{total:1,currency:'CNY'}},{amount:{total:500,currency:'USD'}},{payer:{openid:'wx_b'}},{mchid:'wrong'},{appid:'wrong'},{trade_state:'NOTPAY'}])assert.throws(()=>l.paid(event(o,extra),config),/核验失败/);assert.equal(l.account('wx_a').credits,0)});
test('付费分析失败保留次数，成功只消费一次',t=>{const l=fixture(t);l.begin('wx_a','free','freehash');l.finish('wx_a','free');const o=l.createOrder('wx_a');l.paid(event(o),config);l.begin('wx_a','paid','paidhash');l.fail('wx_a','paid');assert.equal(l.account('wx_a').credits,1);l.begin('wx_a','paid','paidhash');l.finish('wx_a','paid');assert.equal(l.account('wx_a').credits,0);l.paid(event(o),config);assert.equal(l.account('wx_a').credits,0);assert.equal(l.begin('wx_a','paid','paidhash').replay,true)});
test('订单所有权隔离',t=>{const l=fixture(t),o=l.createOrder('wx_a');l.user('wx_b');assert.throws(()=>l.order(o.id,'wx_b'),e=>e.status===404)});
test('重启保留试用状态，释放未完成任务',()=>{const dir=mkdtempSync(join(tmpdir(),'bid-billing-'));try{let l=new Ledger(join(dir,'data.sqlite'));l.user('wx_a');l.begin('wx_a','r1','h1');l.finish('wx_a','r1');const o=l.createOrder('wx_a');l.paid(event(o),config);l.begin('wx_a','r2','h2');l.close();l=new Ledger(join(dir,'data.sqlite'));l.recoverInterrupted();assert.equal(l.account('wx_a').trialRemaining,0);assert.equal(l.account('wx_a').credits,1);l.close()}finally{rmSync(dir,{recursive:true})}});
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
function verifier(){const wx=Object.create(WeChat.prototype);wx.publicKey=keys.publicKey;wx.publicId='PUB_KEY_TEST';wx.apiKey=randomBytes(32);return wx}
function signed(raw,ts=String(Math.floor(Date.now()/1000))){const nonce='test_nonce';return {'wechatpay-timestamp':ts,'wechatpay-nonce':nonce,'wechatpay-serial':'PUB_KEY_TEST','wechatpay-signature':sign('RSA-SHA256',Buffer.from(`${ts}\n${nonce}\n${raw}\n`),keys.privateKey).toString('base64')}}
test('支付响应验签拒绝篡改、过期和错误公钥ID',()=>{const wx=verifier(),raw='{"ok":true}',headers=signed(raw);assert.doesNotThrow(()=>wx.verify(raw,headers));assert.throws(()=>wx.verify('{"ok":false}',headers),/验签失败/);assert.throws(()=>wx.verify(raw,signed(raw,'1')),/无效/);assert.throws(()=>wx.verify(raw,{...headers,'wechatpay-serial':'wrong'}),/无效/)});
test('回调先验签再解密并校验GCM认证标签',()=>{const wx=verifier(),nonce='123456789012',aad='transaction';const cipher=createCipheriv('aes-256-gcm',wx.apiKey,Buffer.from(nonce));cipher.setAAD(Buffer.from(aad));const content={trade_state:'SUCCESS',amount:{total:500}};const encrypted=Buffer.concat([cipher.update(JSON.stringify(content)),cipher.final(),cipher.getAuthTag()]).toString('base64');const raw=JSON.stringify({event_type:'TRANSACTION.SUCCESS',resource:{algorithm:'AEAD_AES_256_GCM',nonce,associated_data:aad,ciphertext:encrypted}});assert.deepEqual(wx.notification(raw,signed(raw)),content);const altered=JSON.stringify({event_type:'TRANSACTION.SUCCESS',resource:{algorithm:'AEAD_AES_256_GCM',nonce,associated_data:'tampered',ciphertext:encrypted}});assert.throws(()=>wx.notification(altered,signed(altered)))});
test('缺少正式配置时禁止启用支付',()=>assert.throws(()=>new WeChat({}),/缺少配置/));
