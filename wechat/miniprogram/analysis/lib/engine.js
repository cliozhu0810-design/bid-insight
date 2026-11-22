(function(root){
const norm=s=>s.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
const rules=[['电话',/(?<![\dA-Z])(?:1[3-9]\d{9}|0\d{2,3}[-－ ]?\d{7,8})(?!\d)/g,30],['邮箱',/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,20],['信用代码',/(?<![A-Z0-9])[0-9A-HJ-NPQRTUWXY]{18}(?![A-Z0-9])/g,30],['银行账号',/(?:银行账号|银行账户|收款账号|开户账号|账号)\s*[:：]?\s*([\d -]{12,30})/g,30],['身份证号',/(?:身份证号码|身份证号)\s*[:：]?\s*(\d{17}[\dXx])(?!\d)/g,30],['人员',/(?:联系人|项目负责人|技术负责人|负责人|项目经理|投标授权人|授权委托人|经办人|代理人|法定代表人|姓名)\s*[:：]?\s*([\u4e00-\u9fff]{2,4}?)(?=性别|职务|年龄|[\s（(，,。]|$)/g,15],['地址',/(?:法定地址|注册地址|办公地址|通讯地址|公司地址|住所)\s*[:：]?\s*([^\n；;]{8,70})/g,15]];
function extract(pages){let out=[];for(const p of pages){for(const [type,re,weight] of rules){re.lastIndex=0;for(const m of p.text.matchAll(re)){const val=(m[1]||m[0]).trim();if(type==='人员'&&/签字|签章|资格|证明|授权|公司|姓名|代表/.test(val))continue;out.push({type,value:val,key:type+':'+norm(val).replace(type==='电话'||type==='银行账号'?/[-－]/g:/$^/g,''),weight,page:p.no,source:p.text.slice(Math.max(0,m.index-35),m.index+m[0].length+65),excluded:false});}}}return out.filter((f,i,a)=>a.findIndex(x=>x.key===f.key)===i)}
function company(pages,fallback){const t=pages.map(p=>p.text).join('\n');return t.match(/(?:报价人名称|报价人|投标人名称|投标人|法定名称)\s*[:：]?\s*([\u4e00-\u9fff（）()A-Za-z]{4,50}(?:有限公司|合作社|事务所))/)?.[1]||fallback.replace(/\.[^.]+$/,'')}
function segments(pages){return pages.flatMap(p=>p.text.split(/[。；;！？\n]/).map(s=>({text:s.trim(),n:norm(s),page:p.no})).filter(s=>s.n.length>=20&&s.n.length<=400&&(s.n.match(/[\u4e00-\u9fff]/g)||[]).length>=12))}
function grams(s){let x=new Set;for(let i=0;i<s.length-3;i++)x.add(s.slice(i,i+4));return x}
function similarity(a,b){let n=0;for(const x of a)if(b.has(x))n++;return a.size+b.size?2*n/(a.size+b.size):0}
function hashSimilarity(a,b){return a.length===b.length?1-[...a].filter((v,i)=>v!==b[i]).length/a.length:0}
// Compare within extracted pages/paragraphs; retain punctuation and letter case.
function exactRepeats(ap,bp,ignored){
 const clean=s=>s.replace(/\s+/g,''),index=new Map(),out=[],seen=new Set;
 for(const p of bp){const n=clean(p.text);for(let i=0;i+31<=n.length;i+=31){const key=n.slice(i,i+31);if(!index.has(key))index.set(key,[]);index.get(key).push({p,n,i})}}
 for(const p of ap){const n=clean(p.text);let covered=0;
 for(let i=0;i+31<=n.length;i++){if(i<covered)continue;let best=null;
 for(const hit of index.get(n.slice(i,i+31))||[]){let l=0,r=31;while(i-l>0&&hit.i-l>0&&n[i-l-1]===hit.n[hit.i-l-1])l++;while(i+r<n.length&&hit.i+r<hit.n.length&&n[i+r]===hit.n[hit.i+r])r++;
 if(l+r>60&&(!best||l+r>best.text.length))best={text:n.slice(i-l,i+r),p:hit.p,end:i+r};}
 if(best){covered=best.end;if(!seen.has(best.text)&&!ignored(best.text)){seen.add(best.text);out.push({kind:'text',category:'连续重复',title:'连续重复 '+best.text.length+' 字符（去空白后，待核对原文）',weight:5,a:{page:p.no,source:best.text.slice(0,2000)},b:{page:best.p.no,source:best.text.slice(0,2000)},matchLength:best.text.length,active:true});if(out.length>=12)return out}}}}
 return out;
}
function referenceSummary(pair){const es=pair.evidence.filter(e=>e.active),anomalies=new Set(es.filter(e=>e.kind==='error').map(e=>e.title)),images=new Set(es.filter(e=>e.kind==='image').map(e=>e.a.hash));return {continuous:es.filter(e=>e.category==='连续重复').length,commonCandidates:anomalies.size+images.size,crossNames:es.filter(e=>e.category==='公司名称交叉出现').length}}
function prices(pages){const rows=[];
 // Conservative labelled prices. Ambiguous multi-number rows and unlabelled table cells are skipped.
 for(const p of pages)for(const line of p.text.split(/\n/)){
 const m=line.trim().match(/^(.{2,80}?)(单价|总价|报价|金额)\s*[:：=]?\s*(?:人民币\s*)?([¥￥])?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,4})?)\s*(万元|元)(?:\s*[/／]\s*([^\s，。；;]{1,12}))?\s*[，。；;]?$/);
 if(!m)continue;const label=m[1].replace(/^\s*\d+[、.．)）]\s*/, '').trim(),value=Number(m[4].replace(/,/g,''))*(m[5]==='万元'?10000:1);
 if(!value||!Number.isFinite(value))continue;rows.push({key:norm(label)+':'+m[2]+':'+(m[6]||''),value,page:p.no,source:line.trim(),label:label+m[2]});
 }return rows;
}
function priceEvidence(a,b,ignored){const aa=prices(a.pages),bb=prices(b.pages),matches=[];
 for(const x of aa){if(ignored(x.source)||aa.filter(t=>t.key===x.key).length!==1)continue;const hits=bb.filter(y=>y.key===x.key&&!ignored(y.source));if(hits.length===1)matches.push({a:x,b:hits[0]})}
 if(matches.length<3)return [];
 const close=(x,y,tol)=>Math.abs(x-y)<=tol,delta=matches[0].b.value-matches[0].a.value,ratio=matches[0].b.value/matches[0].a.value;
 let title='';if(matches.every(x=>close(x.a.value,x.b.value,.005)))title='多项报价一致';
 else if(matches.every(x=>close(x.b.value-x.a.value,delta,.01)))title='报价固定差额：B − A = '+delta.toFixed(2)+' 元';
 else if(matches.every(x=>close(x.b.value,x.a.value*ratio,Math.max(.01,Math.abs(x.b.value)*.0001))))title='报价固定比例：B / A ≈ '+ratio.toFixed(6);
 if(!title)return [];
 return [{kind:'price',category:'报价规律',title:title+'（'+matches.length+' 项同名同口径候选，待核查）',weight:0,a:matches[0].a,b:matches[0].b,rows:matches,active:true}];
}
function genericSaver(s){const n=norm(s);return !n||/^(administer|administrator|admin|user\d*|default|owner|test|unknown|wps|microsoft|用户|管理员|使用者|作者|默认用户|电脑用户|无|未知|abc|testuser)$/.test(n)||/^\d+$/.test(n)||/^(.)\1+$/.test(n)}
function saverEvidence(a,b,options){const av=a.metadata?.lastSavedBy||'',bv=b.metadata?.lastSavedBy||'';
 if(genericSaver(av)||norm(av)!==norm(bv)||norm(av)===norm(options.templateSaver||''))return [];
 return [{kind:'meta',category:'最后保存者',title:'最后保存者相同：'+av+'（文件属性，可修改，待核查）',weight:0,a:{page:'文件属性（无页码）',source:(a.metadata.lastSavedSource||'最后保存者')+'：'+av},b:{page:'文件属性（无页码）',source:(b.metadata.lastSavedSource||'最后保存者')+'：'+bv},active:true}];
}
function compare(a,b,baseline='',ignore=[],options={}){const bn=norm(baseline),ignored=x=>ignore.some(t=>norm(x).includes(norm(t)))||(bn&&bn.includes(norm(x)));let ev=[...saverEvidence(a,b,options),...priceEvidence(a,b,ignored)];const duplicate=(a.digest&&a.digest===b.digest)||norm(a.company)===norm(b.company);
for(const fa of a.fields.filter(f=>!f.excluded&&!ignored(f.value))){const fb=b.fields.find(f=>f.key===fa.key&&!f.excluded);if(fb)ev.push({kind:'entity',category:fa.type,title:fa.type+'相同：'+fa.value,weight:fa.weight,a:fa,b:fb,active:true})}
ev.push(...exactRepeats(a.pages,b.pages,ignored));
for(const [source,target,reverse] of [[a,b,false],[b,a,true]]){if(!duplicate&&target.company&&norm(target.company).length>=4&&!ignored(target.company)){const page=source.pages.find(p=>norm(p.text).includes(norm(target.company)));if(page){const entry={page:page.no,source:page.text.slice(Math.max(0,page.text.indexOf(target.company)-40),Math.max(0,page.text.indexOf(target.company))+target.company.length+100)},owner={page:'企业信息',source:target.company};ev.push({kind:'meta',category:'公司名称交叉出现',title:'出现另一投标人名称：'+target.company+'（核查是否误写，不计分）',weight:0,a:reverse?owner:entry,b:reverse?entry:owner,active:true})}}}
const sa=segments(a.pages).filter(s=>!ignored(s.text)),sb=segments(b.pages).filter(s=>!ignored(s.text));let candidates=[];
const inverted=new Map;sb.forEach((s,i)=>{s.g=grams(s.n);for(const g of s.g){if(!inverted.has(g))inverted.set(g,new Set);inverted.get(g).add(i)}});
const seen=new Set;for(const s of sa){if(seen.has(s.n))continue;seen.add(s.n);const gs=grams(s.n),counts=new Map;for(const g of gs)for(const i of inverted.get(g)||[])counts.set(i,(counts.get(i)||0)+1);let best=null,bestScore=0;for(const [i,n] of counts){const t=sb[i],v=2*n/(gs.size+t.g.size);if(v>=.82&&v>bestScore){best=t;bestScore=v}}if(best)candidates.push({s,t:best,v:bestScore})}
candidates.sort((x,y)=>y.s.n.length-x.s.n.length);for(const c of candidates.filter(c=>!ev.some(e=>e.category==='连续重复'&&e.a.page===c.s.page&&e.b.page===c.t.page)).slice(0,12))ev.push({kind:'text',category:'相似措辞',title:'相似片段 · '+Math.round(c.v*100)+'% 字符片段重合',weight:5,a:{page:c.s.page,source:c.s.text},b:{page:c.t.page,source:c.t.text},active:true});
for(const bad of ['错误！未定义书签','错误!未定义书签','无迹像','二回事','帐户','按排','资质证名']){const ap=a.pages.find(p=>norm(p.text).includes(norm(bad))),bp=b.pages.find(p=>norm(p.text).includes(norm(bad)));if(ap&&bp&&!ignored(bad))ev.push({kind:'error',category:'编辑异常',title:'共同编辑痕迹：'+bad,weight:2,a:{page:ap.no,source:bad},b:{page:bp.no,source:bad},active:true})}
for(const [key,label] of [['author','文档作者'],['creator','制作软件'],['producer','PDF生成器']]){if(a.metadata?.[key]&&a.metadata[key]===b.metadata?.[key])ev.push({kind:'meta',category:'文档属性',title:label+'一致（仅参考，不计分）',weight:0,a:{page:'文件属性',source:a.metadata[key]},b:{page:'文件属性',source:b.metadata[key]},active:true})}
for(const ia of a.images){let best=null,v=0;for(const ib of b.images){if(Math.abs(ia.ratio-ib.ratio)>.15)continue;const sim=hashSimilarity(ia.hash,ib.hash);if(sim>v){best=ib;v=sim}}if(best&&v>=.94)ev.push({kind:'image',category:'近似图片',title:'近似视觉素材 · '+Math.round(v*100)+'% 感知哈希相似',weight:5,a:ia,b:best,active:true})}
return {a:a.id,b:b.id,duplicate,evidence:ev.slice(0,80)};
}
function score(pair){if(pair.duplicate)return null;const es=pair.evidence.filter(e=>e.active);let types=new Map;es.filter(e=>e.kind==='entity').forEach(e=>types.set(e.category,e.weight));return Math.min(70,[...types.values()].reduce((a,b)=>a+b,0))+Math.min(15,es.filter(e=>e.kind==='text').reduce((s,e)=>s+e.weight,0))+Math.min(10,es.filter(e=>e.kind==='image').reduce((s,e)=>s+e.weight,0))+Math.min(5,es.filter(e=>e.kind==='error').reduce((s,e)=>s+e.weight,0))}
root.BidEngine={norm,extract,company,compare,score,hashSimilarity,referenceSummary,prices,genericSaver};if(typeof module!=='undefined')module.exports=root.BidEngine;
})({});
