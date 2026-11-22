import test from 'node:test';
import assert from 'node:assert/strict';
import E from '../engine.js';
const doc=(id,text)=>({id,company:`测试${id}有限公司`,pages:[{no:1,text}],fields:E.extract([{no:1,text}]),images:[]});
const phrase=Array.from({length:90},(_,i)=>String.fromCharCode(0x4e00+i)).join('');
const repeats=p=>p.evidence.filter(e=>e.category==='连续重复');
test('连续重复严格超过60字符，保留标点并支持换行',()=>{
 assert.equal(repeats(E.compare(doc(1,phrase.slice(0,60)),doc(2,phrase.slice(0,60)))).length,0);
 const p=E.compare(doc(1,'甲乙'+phrase.slice(0,61)),doc(2,'前言不同'+phrase.slice(0,30)+'\n'+phrase.slice(30,61)));
 assert.equal(repeats(p)[0].matchLength,61);
});
test('公共文本和手工排除不进入连续重复提示',()=>{
 assert.equal(repeats(E.compare(doc(1,phrase),doc(2,phrase),phrase)).length,0);
 assert.equal(repeats(E.compare(doc(1,phrase),doc(2,phrase),'',[phrase.slice(0,15)])).length,0);
});
test('身份证候选和另一投标人名称可追溯，不将公司名称线索计分',()=>{
 const p=E.compare(doc(1,'身份证号：110101199001011234\n历史供应商 测试2有限公司'),doc(2,'身份证号：110101199001011234'));
 assert.ok(p.evidence.some(e=>e.category==='身份证号'));
 assert.equal(p.evidence.find(e=>e.category==='公司名称交叉出现').weight,0);
});
test('近似图片去重，人工排除后共同异常提示同步变化',()=>{
 const p={evidence:[{kind:'image',a:{hash:'abc'},active:true},{kind:'image',a:{hash:'abc'},active:true},{kind:'error',title:'共同错误',active:true}]};
 assert.equal(E.referenceSummary(p).commonCandidates,2);
 p.evidence[2].active=false;
 assert.equal(E.referenceSummary(p).commonCandidates,1);
});
const priceDoc=(id,values)=>({...doc(id,''),pages:values.map((v,i)=>({no:i+2,text:`项目${['甲','乙','丙'][i]} 单价：${v} 元/次`}))});
const price=p=>p.evidence.find(e=>e.kind==='price');
test('三项报价一致、固定差额、固定比例保留每项页码原文',()=>{
 for(const [values,title] of [[[100,230,410],'多项报价一致'],[[110,240,420],'固定差额'],[[110,253,451],'固定比例']]){
 const e=price(E.compare(priceDoc(1,[100,230,410]),priceDoc(2,values)));
 assert.ok(e.title.includes(title));assert.equal(e.rows.length,3);assert.equal(e.rows[2].a.page,4);assert.equal(e.rows[0].b.source,`项目甲 单价：${values[0]} 元/次`);
 }
});
test('不足三项、非规律、公共报价和不同单位不提示',()=>{
 assert.equal(price(E.compare(priceDoc(1,[100,230]),priceDoc(2,[100,230]))),undefined);
 assert.equal(price(E.compare(priceDoc(1,[100,230,410]),priceDoc(2,[110,250,600]))),undefined);
 const a=priceDoc(1,[100,230,410]),b=priceDoc(2,[100,230,410]);
 assert.equal(price(E.compare(a,b,a.pages.map(p=>p.text).join('\n'))),undefined);
 b.pages[0].text=b.pages[0].text.replace('/次','/年');assert.equal(price(E.compare(a,b)),undefined);
});
test('不猜测多数字表格，重复行跳过，万元正确换算',()=>{
 assert.equal(E.prices([{no:1,text:'项目甲 单价：100 数量 2 合计 200 元'}]).length,0);
 const a=priceDoc(1,[100,230,410]),b=priceDoc(2,[.01,.023,.041]);b.pages.forEach(p=>p.text=p.text.replace(' 元',' 万元'));
 assert.ok(price(E.compare(a,b)));a.pages.push({...a.pages[0]});assert.equal(price(E.compare(a,b)),undefined);
});
test('最后保存者排除通用名称与原模板，作者不能代替保存者',()=>{
 for(const name of ['admin','Administer','user','111','123','aaa','abc','']){
 const a=doc(1,''),b=doc(2,'');a.metadata=b.metadata={lastSavedBy:name};assert.ok(!E.compare(a,b).evidence.some(e=>e.category==='最后保存者'));
 }
 const a=doc(1,''),b=doc(2,'');a.metadata=b.metadata={lastSavedBy:'测试编制人',lastSavedSource:'docProps/core.xml · cp:lastModifiedBy'};
 const evidence=E.compare(a,b).evidence.find(e=>e.category==='最后保存者');assert.equal(evidence.a.page,'文件属性（无页码）');assert.ok(evidence.a.source.includes('cp:lastModifiedBy'));
 assert.ok(!E.compare(a,b,'',[],{templateSaver:'测试编制人'}).evidence.some(e=>e.category==='最后保存者'));
 a.metadata=b.metadata={author:'测试编制人'};assert.ok(!E.compare(a,b).evidence.some(e=>e.category==='最后保存者'));
});
