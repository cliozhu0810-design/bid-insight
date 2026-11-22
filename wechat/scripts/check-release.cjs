const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const project=JSON.parse(fs.readFileSync(path.join(root,'project.config.json')));
const config=require('../miniprogram/config');let errors=[];
if(!/^wx[0-9a-f]{16}$/i.test(project.appid))errors.push('填写企业小程序 AppID');
try{const u=new URL(config.analysisUrl);if(u.protocol!=='https:'||u.search||u.hash||u.username||u.password||u.hostname.endsWith('.github.io')||u.hostname==='localhost')throw Error()}catch{errors.push('配置自有且已校验的 HTTPS 业务域名，不使用 GitHub Pages 默认域名作为正式地址')}
if(errors.length){console.error('尚不可提审：\n'+errors.map(e=>'• '+e).join('\n'));process.exitCode=1}else console.log('本地配置检查通过；仍须核查业务域名、备案、隐私声明、实际免费模式及 iOS/Android 实机测试记录。此检查不代表微信审核通过。');
