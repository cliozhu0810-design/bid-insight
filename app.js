const $=id=>document.getElementById(id),E=BidEngine;let docs=[],pairs=[],busy=false,editing=null,ocrWorker=null,serial=0,demoMode=false,cancelUpload=false,phase='upload';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
pdfjsLib.GlobalWorkerOptions.workerSrc='vendor/pdf.worker.min.js';
function renderSteps(){
  const current=phase==='upload'?1:phase==='review'?2:3;
  for(let i=1;i<=3;i++){
    const el=$('step-'+i),done=i<current;
    el.className='step'+(done?' completed':'')+(i===current?' current':'');
    if(i===current)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');
    el.querySelector('.step-number').textContent=done?'✓':String(i);
    $('step-label-'+i).textContent=done?'已完成':i!==current?'待进行':phase==='analyzing'?'分析中':phase==='results'?'分析完成':phase==='upload'&&busy?'正在解析':'当前阶段';
  }
}
function status(t){$('status').textContent=t}function invalidate(){pairs=[];$('results').hidden=true;phase=docs.length?'review':'upload';renderSteps()}function renderDocs(){renderSteps();$('count').textContent=docs.length+' 份标书';$('documents').innerHTML=docs.map(d=>`<div class="doc"><div><strong>${esc(d.company)}</strong><p>${esc(d.name)} · ${d.pages.length} ${d.unit} · ${d.fields.length} 个候选字段 · ${d.images.length} 张图片${d.low?' · '+d.low+' 页文字不足，需复核':''}${d.warning?' · '+esc(d.warning):''}</p></div><div class="doc-actions"><button data-edit="${d.id}">核对 / 校正</button><button data-remove="${d.id}">移除</button></div></div>`).join('');$('analyze').disabled=busy||docs.length<2;$('files').disabled=busy;$('choose-files').disabled=busy;$('review-disclaimer').disabled=busy;$('ocr').disabled=busy;$('baseline').disabled=busy;$('exclude').disabled=busy;$('documents').querySelectorAll('button').forEach(b=>b.disabled=busy)}
function imageData(canvas,page){const w=canvas.width,h=canvas.height;if(w<80||h<80)return null;const c=document.createElement('canvas');c.width=17;c.height=16;const cx=c.getContext('2d');cx.fillStyle='white';cx.fillRect(0,0,17,16);cx.drawImage(canvas,0,0,17,16);const data=cx.getImageData(0,0,17,16).data;let lum=[],hash='';for(let i=0;i<data.length;i+=4)lum.push(data[i]*.299+data[i+1]*.587+data[i+2]*.114);const avg=lum.reduce((a,b)=>a+b,0)/lum.length;if(lum.reduce((s,v)=>s+(v-avg)**2,0)/lum.length<150)return null;for(let y=0;y<16;y++)for(let x=0;x<16;x++)hash+=lum[y*17+x]>lum[y*17+x+1]?'1':'0';const preview=document.createElement('canvas');preview.width=Math.min(320,w,320*w/h);preview.height=Math.round(h*preview.width/w);preview.getContext('2d').drawImage(canvas,0,0,preview.width,preview.height);return {hash,ratio:w/h,page,src:preview.toDataURL('image/jpeg',.75),source:`内嵌图片 ${w} × ${h} 像素；需检查是否为公用印章、证照、模板或现场照片。`}}
async function pdfImages(page,no){
  const out=[],ops=await page.getOperatorList(),seen=new Set;
  for(let i=0;i<ops.fnArray.length;i++){
    if(cancelUpload)break;
    const fn=ops.fnArray[i];
    if(![pdfjsLib.OPS.paintImageXObject,pdfjsLib.OPS.paintInlineImageXObject].includes(fn))continue;
    const id=ops.argsArray[i][0];if(seen.has(id))continue;seen.add(id);
    const img=typeof id==='string'?await new Promise(resolve=>page.objs.get(id,resolve)):id;
    if(!img||img.width<80||img.height<80)continue;
    const scale=Math.min(1,640/Math.max(img.width,img.height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(80,Math.round(img.width*scale));canvas.height=Math.max(80,Math.round(img.height*scale));
    const ctx=canvas.getContext('2d');
    if(img.bitmap)ctx.drawImage(img.bitmap,0,0,canvas.width,canvas.height);
    else{
      const rgba=new Uint8ClampedArray(canvas.width*canvas.height*4);
      for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
        const sy=Math.min(img.height-1,Math.floor(y*img.height/canvas.height)),sx=Math.min(img.width-1,Math.floor(x*img.width/canvas.width));
        const p=sy*img.width+sx,q=(y*canvas.width+x)*4;
        if(img.kind===3){rgba.set(img.data.subarray(p*4,p*4+4),q)}
        else if(img.kind===2){rgba[q]=img.data[p*3];rgba[q+1]=img.data[p*3+1];rgba[q+2]=img.data[p*3+2];rgba[q+3]=255}
        else{const v=(img.data[sy*Math.ceil(img.width/8)+(sx>>3)]>>(7-sx%8)&1)*255;rgba[q]=rgba[q+1]=rgba[q+2]=v;rgba[q+3]=255}
      }
      ctx.putImageData(new ImageData(rgba,canvas.width,canvas.height),0,0);
    }
    const data=imageData(canvas,no);canvas.width=canvas.height=0;
    if(data){data.ratio=img.width/img.height;data.source=`内嵌图片 ${img.width} × ${img.height} 像素（缩略预览）；需检查是否为公用印章、证照、模板或现场照片。`;out.push(data)}
    if(out.length%10===0)await new Promise(r=>setTimeout(r,0));
  }
  return out;
}
async function readFile(file){BidLimits.validateBatch([file]);status(`正在读取 ${file.name}（${(file.size/1024/1024).toFixed(1)} MB）…`);const ext=file.name.split('.').pop().toLowerCase();const buffer=await file.arrayBuffer();const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(b=>b.toString(16).padStart(2,'0')).join('');if(docs.some(d=>d.digest===digest))throw Error('相同文件已添加');const d={id:++serial,name:file.name,pages:[],images:[],unit:ext==='pdf'?'页':'段',digest,low:0};if(ext==='pdf'){const pdf=await pdfjsLib.getDocument({data:buffer,isEvalSupported:false,cMapUrl:new URL('vendor/cmaps/',location.href).href,cMapPacked:true,standardFontDataUrl:new URL('vendor/standard_fonts/',location.href).href}).promise;if(pdf.numPages>BidLimits.MAX_PDF_PAGES){await pdf.destroy();throw Error('超过 1,000 页限制，请拆分后上传')}try{const metadata=await pdf.getMetadata();d.metadata={author:metadata.info.Author||'',creator:metadata.info.Creator||'',producer:metadata.info.Producer||'',created:metadata.info.CreationDate||''};for(let n=1;n<=pdf.numPages;n++){if(cancelUpload)throw Error('处理已停止，本文件未加入分析');await new Promise(r=>setTimeout(r,0));status(`正在解析 ${file.name} · ${n} / ${pdf.numPages} 页`);const page=await pdf.getPage(n);const content=await page.getTextContent();let text='',lastY=null;for(const item of content.items){if(lastY!==null&&Math.abs(lastY-item.transform[5])>5)text+='\n';text+=item.str+(item.hasEOL?'\n':' ');lastY=item.transform[5]}text=text.replace(/([\u4e00-\u9fff]) +(?=[\u4e00-\u9fff])/g,'$1');let source='文字层';if(E.norm(text).length<30&&$('ocr').checked){if(!ocrWorker){status('正在加载本地 OCR 模型，首次可能需要片刻…');ocrWorker=await Tesseract.createWorker('chi_sim+eng',1,{workerPath:new URL('vendor/worker.min.js',location.href).href,corePath:new URL('vendor/tesseract-core-lstm.wasm.js',location.href).href,langPath:new URL('vendor/',location.href).href,workerBlobURL:false})}const baseView=page.getViewport({scale:1});const view=page.getViewport({scale:Math.min(1.8,Math.sqrt(4000000/(baseView.width*baseView.height)))}),canvas=document.createElement('canvas');canvas.width=view.width;canvas.height=view.height;await page.render({canvasContext:canvas.getContext('2d'),viewport:view}).promise;status(`扫描识别 ${file.name} · 第 ${n} 页`);const result=await ocrWorker.recognize(canvas);canvas.width=canvas.height=0;text=result.data.text.replace(/([\u4e00-\u9fff]) +(?=[\u4e00-\u9fff])/g,'$1');source='OCR，待核对';d.warning='含 OCR 页，文字可能有误，需人工校正'}if(E.norm(text).length<30)d.low++;d.pages.push({no:n,text,source});try{d.images.push(...await pdfImages(page,n));}catch{d.warning='部分内嵌图片提取失败'}page.cleanup();await pdf.cleanup()}}finally{await pdf.destroy()}}
else if(ext==='docx'){const result=await mammoth.extractRawText({arrayBuffer:buffer});d.pages=result.value.split(/\n\s*\n/).filter(Boolean).map((text,i)=>({no:i+1,text,source:'DOCX 段落'}));d.warning='Word 图片未参与比对；如需图片分析请导出 PDF'}else{const text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);d.pages=text.split(/\n\s*\n/).filter(Boolean).map((text,i)=>({no:i+1,text,source:'TXT 段落'}))}if(!d.pages.length)throw Error('未提取到文本');d.company=E.company(d.pages,d.name);d.fields=E.extract(d.pages);return d}
async function upload(files){
  if(!BidAccess.confirmed||busy||!files.length)return;
  try{BidLimits.validateBatch(files,demoMode?0:docs.length)}catch(error){status(error.message);return}
  if(demoMode){docs=[];demoMode=false}
  busy=true;cancelUpload=false;invalidate();phase='upload';renderDocs();$('cancel-upload').hidden=false;$('cancel-upload').disabled=false;let errors=[];
  try{for(const f of files){if(cancelUpload)break;try{const d=await readFile(f);if(!cancelUpload)docs.push(d)}catch(e){errors.push(f.name+'：'+e.message)}renderDocs()}}
  finally{
    try{if(ocrWorker)await ocrWorker.terminate()}finally{ocrWorker=null;busy=false;phase=docs.length?'review':'upload';$('cancel-upload').hidden=true;renderDocs();$('files').value='';status((errors.length?errors.join('\n')+'\n':'')+(cancelUpload?'已停止。已完成的文件保留，未完成的文件未加入分析。':'材料已处理。请核对公司名称、字段归属和扫描识别完整性后开始分析。'))}
  }
}
$('cancel-upload').onclick=()=>{cancelUpload=true;$('cancel-upload').disabled=true;status('正在停止：当前页面或文件读取结束后停止，保留已完成的文件。')};
$('choose-files').onclick=()=>{if(BidAccess.confirmed&&!busy)$('files').click()};
$('files').onchange=e=>upload([...e.target.files]);$('drop').ondragover=e=>{e.preventDefault();$('drop').classList.add('over')};$('drop').ondragleave=()=>$('drop').classList.remove('over');$('drop').ondrop=e=>{e.preventDefault();$('drop').classList.remove('over');upload([...e.dataTransfer.files])};
$('documents').onclick=e=>{if(busy)return;const b=e.target.closest('button');if(!b)return;if(b.dataset.remove){docs=docs.filter(d=>d.id!==+b.dataset.remove);invalidate();renderDocs()}else if(b.dataset.edit){editing=docs.find(d=>d.id===+b.dataset.edit);phase='review';renderSteps();$('edit-title').textContent='核对提取内容';$('company-edit').value=editing.company;$('page-select').innerHTML=editing.pages.map(p=>`<option value="${p.no}">${editing.unit} ${p.no} · ${esc(p.source)}</option>`).join('');showPage();fields();$('editor').showModal()}};
function showPage(){$('page-edit').value=editing.pages.find(p=>p.no===+$('page-select').value).text}function fields(){$('field-list').innerHTML='<b>候选字段 · 取消勾选可排除采购人、业主和无关字段</b>'+editing.fields.map((f,i)=>`<div class="field"><label><input type="checkbox" data-field="${i}" ${f.excluded?'':'checked'}> ${esc(f.type)}：${esc(f.value)} <span class="tag">${editing.unit} ${f.page}</span></label><p>${esc(f.source)}</p></div>`).join('')}
$('page-select').onchange=showPage;$('field-list').onchange=e=>{if(e.target.dataset.field!==undefined){editing.fields[+e.target.dataset.field].excluded=!e.target.checked;invalidate()}};$('save-page').onclick=()=>{const excluded=new Set(editing.fields.filter(f=>f.excluded).map(f=>f.key));editing.pages.find(p=>p.no===+$('page-select').value).text=$('page-edit').value;editing.company=$('company-edit').value.trim()||editing.name;editing.fields=E.extract(editing.pages).map(f=>({...f,excluded:excluded.has(f.key)}));fields();invalidate();renderDocs();$('save-page').textContent='已保存校正';setTimeout(()=>$('save-page').textContent='保存校正',1400)};
$('baseline').oninput=invalidate;$('exclude').oninput=invalidate;
function getDoc(id){return docs.find(d=>d.id===id)}
function quote(x,d){return `<div class="quote"><small>${esc(d.company)} · ${d.unit} ${x.page}</small>${x.src?`<img src="${x.src}" alt="来源图片，${esc(d.unit)} ${x.page}">`:''}${esc(x.source)}</div>`}
function results(){const scores=pairs.map(E.score).filter(s=>s!==null),evidenceCount=pairs.reduce((s,p)=>s+p.evidence.filter(e=>e.active).length,0);$('results').hidden=false;$('results').innerHTML=`<div class="panel-title"><h2>关联分析结果 ${demoMode?'<span class="tag warn">虚构演示数据</span>':''}</h2><div><button id="export">导出 JSON 报告</button> <button id="print">打印 / 存为 PDF</button></div></div><div class="metrics"><div class="metric"><b>${pairs.length}</b><span>组标书对比</span></div><div class="metric"><b class="risk">${scores.length?Math.max(...scores):'—'}<small style="font-size:14px"> / 100</small></b><span>最高关联线索分 · 非概率</span></div><div class="metric"><b>${evidenceCount}</b><span>条有效关联线索</span></div></div><div class="note">${demoMode?'当前为虚构数据，不涉及真实企业。 ':''}<strong>分析结果仅供参考，不作围标或违法认定。</strong> 结果仅覆盖已识别内容。${docs.some(d=>d.low||d.warning)?'存在文字不足页或图片提取限制，请先补充校正。 ':''}同一模板、公共联系人、证照和图库素材都可能造成相似。请逐条核查并排除无关证据。参考标准原适用范围为华电集团境内采购；硬件识别码、最后保存者、报价规律、保证金流水及材料真伪尚未自动核验，需补充核查。</div>`+pairs.map((p,pi)=>{const a=getDoc(p.a),b=getDoc(p.b),s=E.score(p),ref=E.referenceSummary(p);return `<article class="panel"><div class="pair-title"><div><span class="tag ${s>=30?'warn':''}">${p.duplicate?'疑似重复材料':s>=60?'优先核查':s>=30?'建议核查':'当前线索有限'}</span><h3>${esc(a.company)}<br><span style="color:#8c9b95;font-size:12px">与</span> ${esc(b.company)}</h3></div><div class="score">${s===null?'—':s}<small> / 100</small></div></div>${p.duplicate?'<p class="note">公司名称或文件内容相同，不能视为两个独立投标人。请核对企业名称或移除重复版本。</p>':''}<p class="note">参考标准核查：超过 60 字符的连续重复 ${ref.continuous} 处；共同异常 / 近似图片候选 ${ref.commonCandidates} 项${ref.commonCandidates>=2?'（达到 2 项提示，请核实是否为相同异常并排除公共来源）':''}；其他投标人名称 ${ref.crossNames} 处。仅统计当前计入的已展示线索。</p>${p.evidence.length?p.evidence.map((e,ei)=>`<div class="evidence" style="opacity:${e.active?1:.45}"><div class="evidence-head"><b>${esc(e.title)}</b><label><input type="checkbox" data-pair="${pi}" data-evidence="${ei}" ${e.active?'checked':''}> 计入分析</label></div>${e.kind==='image'?'<p>仅提示重复素材 / 近似构图，不证明同一地点或拍摄者。请比较背景、光影、物体位置与裁剪范围。</p>':''}<div class="quotes">${quote(e.a,a)}${quote(e.b,b)}</div></div>`).join(''):'<div class="no-match">在已识别内容中未发现满足当前规则的共同线索。这不排除其他关联。</div>'}<label style="font-size:13px">人工复核记录<textarea data-notes="${pi}" placeholder="记录照片中的相同背景、建筑标识、车辆、拍摄角度、光影、公共素材来源，以及核查结论…">${esc(p.notes||'')}</textarea></label></article>`}).join('');$('export').onclick=exportReport;$('print').onclick=()=>window.print()}
$('analyze').onclick=async()=>{
  if(!BidAccess.confirmed||busy||!await BidBilling.beforeAnalysis(demoMode))return;
  busy=true;phase='analyzing';renderDocs();status('正在计算字段、文本和图片关联…');let worker;
  try{
    const ignores=$('exclude').value.split(/[,，\n]/).map(s=>s.trim()).filter(Boolean);
    const compactDocs=docs.map(d=>({...d,images:d.images.map((im,imageIndex)=>({...im,src:undefined,imageIndex}))}));
    const payload={docs:compactDocs,baseline:$('baseline').value,ignores};
    if(BidBilling.live&&!demoMode){pairs=await BidBilling.analyze(payload)}else{
    worker=new Worker('analysis-worker.js?v=20261122-5');
    pairs=await new Promise((resolve,reject)=>{
      worker.onmessage=({data})=>{if(data.type==='progress')status(data.message);else if(data.type==='done')resolve(data.pairs);else reject(Error(data.message))};
      worker.onerror=()=>reject(Error('分析进程未能完成。请减少文件或关闭其他浏览器标签后重试。'));
      worker.postMessage(payload);
    });
    }
    for(const pair of pairs)for(const e of pair.evidence)if(e.kind==='image'){e.a=getDoc(pair.a).images[e.a.imageIndex];e.b=getDoc(pair.b).images[e.b.imageIndex]}
    phase='results';results();renderSteps();status('分析完成，结果仅供参考。可取消勾选不适用的证据，分数会随之更新。');$('results').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(error){phase='review';status('分析未完成：'+error.message)}finally{worker?.terminate();busy=false;renderDocs()}
};
$('results').oninput=e=>{if(e.target.dataset.notes!==undefined)pairs[+e.target.dataset.notes].notes=e.target.value};
$('results').onchange=e=>{if(e.target.dataset.pair!==undefined){pairs[+e.target.dataset.pair].evidence[+e.target.dataset.evidence].active=e.target.checked;const y=window.scrollY;results();window.scrollTo(0,y)}};
function exportReport(){const report={title:'标书关联性线索报告',generated:new Date().toISOString(),demo:demoMode,notice:'分析结果仅供参考，不作围标、串标或违法认定，不应作为处罚或取消资格的唯一依据。规则分数不是围标概率或违法认定。需核实公共来源、OCR误差、字段归属和公司身份。图片不证明同一地点或拍摄者。',method:$('method').textContent,baseline:$('baseline').value,exclusions:$('exclude').value,documents:docs.map(d=>({name:d.name,company:d.company,digest:d.digest,pages:d.pages.length,unit:d.unit,metadata:d.metadata,lowTextPages:d.low,warning:d.warning,fields:d.fields})),pairs:pairs.map(p=>({...p,score:E.score(p),referenceSummary:E.referenceSummary(p),companyA:getDoc(p.a).company,companyB:getDoc(p.b).company}))};const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='标书关联线索报告.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
