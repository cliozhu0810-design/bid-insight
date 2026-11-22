import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function page(name,url){let definition,navigated='';vm.runInNewContext(fs.readFileSync(new URL('../wechat/miniprogram/pages/'+name+'/'+name+'.js',import.meta.url),'utf8'),{require:()=>({analysisUrl:url}),Page:p=>definition=p,wx:{navigateTo:({url})=>navigated=url}});definition.setData=data=>Object.assign(definition.data,data);return {definition,navigated:()=>navigated}}
test('小程序未配置地址时不能打开空白分析页',()=>{const p=page('home','');p.definition.start();assert.ok(p.definition.data.error);assert.equal(p.navigated(),'')});
test('小程序分析地址固定来自配置，不接受外部页面参数',()=>{const p=page('analysis','https://bid.example.com/');p.definition.onLoad({url:'https://evil.example/'});assert.equal(p.definition.data.src,'https://bid.example.com/?edition=free');p.definition.failed();assert.equal(p.definition.data.src,'')});
