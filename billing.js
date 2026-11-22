(function(){
  const live=window.BID_BILLING?.mode==='live';
  const modal=document.getElementById('billing-dialog'),message=document.getElementById('billing-message'),action=document.getElementById('billing-action'),check=document.getElementById('billing-check');
  let account=null,pendingConsent=null,orderId=sessionStorage.getItem('bid.pendingOrder')||'',working=false;
  async function api(path,options={}){const r=await fetch('/api/'+path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(150000)});const d=await r.json();if(!r.ok){const e=Error(d.error||'服务暂不可用');e.status=r.status;throw e}return d}
  function notice(text){message.textContent=text}
  function update(){const state=document.getElementById('billing-state');state.textContent=!live?'当前免费体验 · 收费尚未开通':!account?'微信登录后可用':account.trialRemaining?'剩余免费试用 1 次':`可用付费次数 ${account.credits} 次`;document.getElementById('billing-open').textContent=live?'我的次数':'收费说明'}
  async function refresh(){if(live){try{account=await api('account')}catch(e){if(e.status===401)account=null;else throw e}}update();return account}
  function show(){if(!modal.open)modal.showModal();check.hidden=true;action.hidden=false;action.disabled=false;
    if(!live){notice('收费功能尚未开通，当前网页仍可免费体验，不会扣款，也不会消耗未来的正式免费试用次数。');action.hidden=true;return}
    if(!account){notice('请在微信内打开本网站并登录。正式服务会用同一公众号下的微信账号标识记录试用与购买次数。');action.textContent='微信登录';action.onclick=()=>{if(!/MicroMessenger/i.test(navigator.userAgent)){notice('请复制网页地址到微信中打开，再进行微信登录。');return}location.href='/api/auth/wechat/start'};return}
    if(account.trialRemaining||account.credits){notice((account.trialRemaining?'本次使用免费试用，成功后剩余 0 次免费试用。':'本次消耗 1 次已购买次数，不会再次付款。')+' 原始文件和图片留在本机；开始分析将把提取文字、字段与图片指纹提交到服务端比对，分析内容不写入计费数据库。失败不扣次数。');action.textContent=pendingConsent?'确认并开始分析':'知道了';action.onclick=()=>{const consent=pendingConsent;pendingConsent=null;modal.close();consent?.(true)};return}
    notice('免费试用已使用。支付 5 元可获得 1 次分析次数，每次最多 5 份标书。仅分析成功后扣除次数；支付取消不会增加或扣除次数。');action.textContent='微信支付 ¥5.00';action.onclick=pay;check.hidden=!orderId;
  }
  async function confirmOrder(){if(!orderId)return;const result=await api('orders/'+encodeURIComponent(orderId));if(['paid','used'].includes(result.state)){sessionStorage.removeItem('bid.pendingOrder');orderId='';await refresh();show();return true}return false}
  async function pay(){if(working)return;working=true;action.disabled=true;try{
    if(!window.WeixinJSBridge){notice('请在微信内打开网页，才能发起支付。');return}
    const order=await api('orders',{method:'POST',body:'{}'});if(order.alreadyPaid){await refresh();show();return}
    orderId=order.orderId;sessionStorage.setItem('bid.pendingOrder',orderId);check.hidden=false;
    const result=await new Promise(resolve=>window.WeixinJSBridge.invoke('getBrandWCPayRequest',order.payment,resolve));
    if(result.err_msg==='get_brand_wcpay_request:cancel'){notice('已取消支付，未扣除分析次数。若已扣款，请点击查询支付结果。');return}
    notice('正在由服务器核实支付结果，请勿重复支付…');
    for(let i=0;i<8;i++){if(await confirmOrder())return;await new Promise(r=>setTimeout(r,1500))}
    notice('支付结果仍在确认中，请稍后点击“查询支付结果”。不要重复付款。');
  }catch(error){notice(error.message)}finally{working=false;action.disabled=false}}
  check.onclick=async()=>{check.disabled=true;try{if(!await confirmOrder())notice('尚未确认支付成功，请稍后再查询。')}catch(error){notice(error.message)}finally{check.disabled=false}};
  document.getElementById('billing-open').onclick=async()=>{try{await refresh();show()}catch(e){show();notice(e.message)}};
  modal.addEventListener('close',()=>{pendingConsent?.(false);pendingConsent=null});
  window.BidBilling={live,
    async beforeAnalysis(demo){if(!live||demo)return true;if(pendingConsent)return false;try{await refresh()}catch(e){show();notice(e.message);return false}return new Promise(resolve=>{pendingConsent=resolve;show()})},
    async analyze(payload){const encoded=JSON.stringify(payload);const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(encoded)))].map(n=>n.toString(16).padStart(2,'0')).join('');const result=await api('analysis',{method:'POST',body:JSON.stringify({...payload,requestId:digest})});account=result.account;update();return result.pairs}
  };
  if(live){document.getElementById('privacy-note').textContent='原始文件留在本机 · 分析时提交提取内容';document.getElementById('entry-privacy').textContent='原始文件及图片留在本机。正式分析会在另行确认后提交提取文字、字段与图片指纹到服务端，不写入计费数据库。请仅使用你有权处理的文件。'}
  update();
})();
