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
