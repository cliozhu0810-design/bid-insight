// Local, paginated raster PDF: system canvas paints CJK fonts, JPEG pages are embedded.
// No server, external font, network resource, or executable PDF action is used.
const E = require('./engine');
const WIDTH = 595, HEIGHT = 842, MARGIN = 42, BOTTOM = 786, MAX_PAGES = 160;
const ascii = s => Uint8Array.from(s, c => c.charCodeAt(0));
function join(parts) { const out = new Uint8Array(parts.reduce((n,p)=>n+p.byteLength,0)); let at=0; for(const p of parts){out.set(new Uint8Array(p.buffer||p,p.byteOffset||0,p.byteLength),at);at+=p.byteLength} return out; }
class PDFWriter {
 constructor(){this.parts=[ascii('%PDF-1.4\n% Local evidence report\n')];this.offsets=[0];this.length=this.parts[0].length;this.pages=[];this.next=3;}
 add(part){this.parts.push(part);this.length+=part.byteLength;if(this.length>40*1024*1024)throw Error('报告超过40 MB，请减少材料或线索后导出');}
 object(id,parts){this.offsets[id]=this.length;this.add(ascii(id+' 0 obj\n'));for(const p of parts)this.add(typeof p==='string'?ascii(p):p);this.add(ascii('\nendobj\n'));}
 page(jpeg,width,height){if(this.pages.length>=MAX_PAGES)throw Error('报告超过160页，请分组分析后导出；未生成不完整报告');const b=new Uint8Array(jpeg.buffer||jpeg,jpeg.byteOffset||0,jpeg.byteLength);if(b[0]!==255||b[1]!==216)throw Error('画布未返回有效 JPEG');const id=this.next++,im=this.next++,content=this.next++;this.pages.push(id);this.object(im,['<< /Type /XObject /Subtype /Image /Width '+width+' /Height '+height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+b.length+' >>\nstream\n',b,'\nendstream']);const commands='q 595 0 0 842 0 0 cm /Im0 Do Q';this.object(content,['<< /Length '+commands.length+' >>\nstream\n'+commands+'\nendstream']);this.object(id,['<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 '+im+' 0 R >> >> /Contents '+content+' 0 R >>']);}
 finish(){if(!this.pages.length)throw Error('报告没有页面');this.object(1,['<< /Type /Catalog /Pages 2 0 R >>']);this.object(2,['<< /Type /Pages /Count '+this.pages.length+' /Kids ['+this.pages.map(n=>n+' 0 R').join(' ')+'] >>']);const start=this.length;let x='xref\n0 '+this.next+'\n0000000000 65535 f \n';for(let i=1;i<this.next;i++)x+=String(this.offsets[i]).padStart(10,'0')+' 00000 n \n';this.add(ascii(x+'trailer\n<< /Size '+this.next+' /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF\n'));return join(this.parts).buffer;}
}
function blocks(documents,pairs,options={}){
 const rows=[],text=(s,style='body')=>rows.push({text:String(s==null?'':s),style});
 text('标鉴 · 标书关联核查报告','title');text(options.demo?'虚构材料演示报告':'本地生成 · 人工核查用','subtitle');
 text('生成时间：'+(options.generated||new Date().toLocaleString()));
 text('结果仅供参考。关联分不是围标概率，不作违法认定。仅覆盖已识别内容；低分或无匹配不能排除关联。','notice');
 text('本报告按页绘制，中文和图片已固化，适合阅读与打印；正文不可搜索或复制。需要结构化数据时同时导出 JSON。','small');
 text('一、材料与识别范围','section');
 for(const d of documents){text(d.company,'heading');text(d.name);text('编号 '+d.id+' · '+d.pages.length+' '+d.unit+' · '+d.fields.length+' 个候选字段 · '+d.images.length+' 张图片');text('文件指纹（SHA-1，仅用于重复检测）：'+(d.digest||'未取得'),'small');text('最后保存者：'+(d.metadata.lastSavedBy||'未提供')+'；作者：'+(d.metadata.author||'未提供'),'small');const excluded=d.fields.filter(f=>f.excluded);if(excluded.length)text('已人工排除字段：'+excluded.map(f=>f.type+' '+f.value).join('；'),'notice');if(d.pages.some(p=>p.edited))text('含人工修改的识别文本，请对照原文件复核。','notice');if(d.warnings.length)text('识别提示：'+d.warnings.join('；'),'notice');}
 text('二、核查设置','section');text('PDF定位为物理页码；Word/TXT为段落。文件属性无正文页码。图片相似不证明同一设备、地点或拍摄者。');text('实体分上限70，文本15，图片10，编辑异常5；报价和保存者不加分。相同企业或相同文件不作为独立投标人计分。');
 text('公共文本基准：'+(options.baseline||'未提供'));text('排除关键词/字段：'+(options.exclude||'未提供'));text('原模板最后保存者：'+(options.templateSaver||'未提供'));
 text('三、两两比对摘要','section');
 for(const p of pairs){const a=documents.find(d=>d.id===p.a),b=documents.find(d=>d.id===p.b);text(a.company+' × '+b.company,'heading');text((p.duplicate?'疑似重复材料，不计分':'线索分 '+E.score(p))+'；纳入 '+p.evidence.filter(e=>e.active).length+' 条，人工排除 '+p.evidence.filter(e=>!e.active).length+' 条');}
 text('四、证据明细','section');
 for(let pi=0;pi<pairs.length;pi++){const p=pairs[pi],a=documents.find(d=>d.id===p.a),b=documents.find(d=>d.id===p.b);text((pi+1)+'. '+a.company+' × '+b.company,'section');if(!p.evidence.length)text('已识别内容中未发现匹配线索，不代表不存在关联。','notice');for(let ei=0;ei<p.evidence.length;ei++){const e=p.evidence[ei];text((pi+1)+'.'+(ei+1)+' '+e.title,'heading');text(e.active?'状态：纳入结果':'状态：已人工排除（本报告保留供复核）',e.active?'small':'notice');for(const pair of e.rows||[{a:e.a,b:e.b}])for(const [q,d] of [[pair.a,a],[pair.b,b]]){text(d.company+' · '+(typeof q.page==='number'?d.unit+' '+q.page:q.page||'来源未提供'),'label');text(q.source||'未提供原文','quote');if(q.src)rows.push({image:q.src,ratio:q.ratio||1,caption:'提取缩略图；完整细节请查看原文件'});}}text('人工核查备注：'+(p.notes||'未填写'));}
 text('五、使用说明','section');text('本报告是可修改的数据副本，不构成司法鉴定或真实性证明。公共模板、第三方共用材料、识别错误均可能产生误报或漏报。应由有权限的人员结合原文件及其他证据复核。');text('文件及分析在设备本地处理；主动分享报告会把报告中的企业、联系方式、原文和图片发送给所选接收方。');return rows;
}
function wrap(ctx,text,width){const lines=[];for(const para of String(text).replace(/\r/g,'').split('\n')){let line='';for(const c of Array.from(para)){if(line&&ctx.measureText(line+c).width>width){lines.push(line);line=c}else line+=c}lines.push(line)}return lines;}
const styles={title:{size:27,gap:18,color:'#173b35',bold:true},subtitle:{size:14,gap:16,color:'#176e5d'},section:{size:17,gap:16,color:'#176e5d',bold:true},heading:{size:13,gap:9,color:'#173b35',bold:true},body:{size:11,gap:9,color:'#273e38'},notice:{size:10.5,gap:10,color:'#855819'},small:{size:9,gap:8,color:'#64736e'},label:{size:10,gap:4,color:'#176e5d',bold:true},quote:{size:10,gap:10,color:'#31423d'}};
async function generate(documents,pairs,options,adapter){
 const canvas=adapter.canvas,ctx=canvas.getContext('2d'),writer=new PDFWriter();let y=0,page=0;canvas.width=1190;canvas.height=1684;
 const check=()=>{if(adapter.check)adapter.check()};
 function start(){page++;canvas.width=1190;canvas.height=1684;ctx.setTransform(2,0,0,2,0,0);ctx.fillStyle='#ffffff';ctx.fillRect(0,0,WIDTH,HEIGHT);ctx.textBaseline='top';ctx.font='9px sans-serif';ctx.fillStyle='#64736e';ctx.fillText('标鉴 / 本地关联核查 / 仅供参考',MARGIN,23);ctx.fillStyle='#dce7e3';ctx.fillRect(MARGIN,40,WIDTH-2*MARGIN,1);y=58;}
 async function flush(){check();ctx.font='9px sans-serif';ctx.fillStyle='#64736e';ctx.fillText('第 '+page+' 页 · 请结合原文件人工复核',MARGIN,810);writer.page(await adapter.jpeg(canvas),canvas.width,canvas.height);if(adapter.progress)adapter.progress('正在本地生成 PDF · 第 '+page+' 页');await new Promise(r=>setTimeout(r,0));}
 async function room(h){if(y+h>BOTTOM){await flush();start()}}
 start();for(const block of blocks(documents,pairs,options)){check();if(block.image){const w=Math.min(220,Math.max(100,180*block.ratio)),h=Math.min(200,w/block.ratio);await room(h+35);try{const im=await adapter.image(block.image,canvas);ctx.drawImage(im,MARGIN,y,w,h);y+=h+5;ctx.font='9px sans-serif';ctx.fillStyle='#64736e';ctx.fillText(block.caption,MARGIN,y);y+=23}catch(e){throw Error('报告图片读取失败，请重新解析材料后导出：'+(e.message||'未知错误'))}continue}
 const s=styles[block.style]||styles.body,leading=Math.ceil(s.size*1.65);ctx.font=(s.bold?'bold ':'')+s.size+'px sans-serif';const lines=wrap(ctx,block.text,WIDTH-2*MARGIN);await room(Math.min(lines.length,2)*leading+s.gap);for(const line of lines){await room(leading);ctx.font=(s.bold?'bold ':'')+s.size+'px sans-serif';ctx.fillStyle=s.color;ctx.fillText(line,MARGIN,y);y+=leading}y+=s.gap;}
 await flush();return {data:writer.finish(),pages:page};
}
module.exports={generate,blocks,wrap,PDFWriter};
