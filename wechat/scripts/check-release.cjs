const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),mp=path.join(root,'miniprogram');
const project=JSON.parse(fs.readFileSync(path.join(root,'project.config.json'))),app=JSON.parse(fs.readFileSync(path.join(mp,'app.json')));let errors=[];
if(!/^wx[0-9a-f]{16}$/i.test(project.appid))errors.push('缺少正式 AppID');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(f=>f.isDirectory()?files(path.join(dir,f.name)):[path.join(dir,f.name)])}
for(const f of files(mp)){if(!/\.(js|wxml)$/.test(f)||f.includes('/lib/'))continue;const s=fs.readFileSync(f,'utf8');if(/<web-view|wx\.(request|uploadFile|connectSocket|requestPayment)\s*\(|wx\.cloud/.test(s))errors.push('发现非本地功能：'+path.relative(mp,f))}
const packages=[{name:'主包',paths:files(mp).filter(f=>!app.subpackages.some(p=>f.startsWith(path.join(mp,p.root)+'/')))},...app.subpackages.map(p=>({name:p.root,paths:files(path.join(mp,p.root))}))];
for(const p of packages){const size=p.paths.reduce((sum,f)=>sum+fs.statSync(f).size,0);console.log(p.name+' 原始资源 '+(size/1024).toFixed(1)+' KB');if(size>2*1024*1024)errors.push(p.name+' 超过 2 MB，需检查微信实际打包体积')}
if(errors.length){console.error(errors.join('\n'));process.exitCode=1}else console.log('本地工程检查通过：原生页面，无业务域名或云服务配置。正式发布仍需完成平台要求及真机测试；此检查不代表审核通过。');
