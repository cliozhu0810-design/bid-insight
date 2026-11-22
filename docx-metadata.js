(function(root){
// Read only the bounded core-properties ZIP member, never the entire archive.
async function read(buffer){
 const v=new DataView(buffer),bytes=new Uint8Array(buffer);let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50&&i+22+v.getUint16(i+20,true)===bytes.length){end=i;break}
 if(end<0)throw Error('未找到 DOCX 属性目录');
 let pos=v.getUint32(end+16,true),count=v.getUint16(end+10,true);
 for(let n=0;n<count;n++){
 if(pos+46>bytes.length||v.getUint32(pos,true)!==0x02014b50)throw Error('DOCX 属性目录损坏');
 const size=v.getUint32(pos+20,true),raw=v.getUint32(pos+24,true),nameLen=v.getUint16(pos+28,true),extra=v.getUint16(pos+30,true),comment=v.getUint16(pos+32,true),method=v.getUint16(pos+10,true),flags=v.getUint16(pos+8,true),offset=v.getUint32(pos+42,true);
 const name=new TextDecoder().decode(bytes.subarray(pos+46,pos+46+nameLen));pos+=46+nameLen+extra+comment;
 if(name!=='docProps/core.xml')continue;
 if(flags&1||size>1048576||raw>1048576||offset+30>bytes.length||v.getUint32(offset,true)!==0x04034b50)throw Error('DOCX 属性不可读取');
 const start=offset+30+v.getUint16(offset+26,true)+v.getUint16(offset+28,true);if(start+size>bytes.length)throw Error('DOCX 属性不完整');
 let data=bytes.slice(start,start+size);
 if(method===8){const reader=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(),parts=[];let total=0;try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>1048576)throw Error('DOCX 属性过大');parts.push(value)}}finally{await reader.cancel()}data=new Uint8Array(total);let at=0;for(const part of parts){data.set(part,at);at+=part.length}}
 else if(method!==0)throw Error('不支持此 DOCX 属性压缩格式');
 const xml=new DOMParser().parseFromString(new TextDecoder().decode(data),'application/xml');if(xml.getElementsByTagName('parsererror').length)throw Error('DOCX 属性 XML 损坏');
 const get=(ns,key)=>xml.getElementsByTagNameNS(ns,key)[0]?.textContent?.trim()||'';
 return {lastSavedBy:get('http://schemas.openxmlformats.org/package/2006/metadata/core-properties','lastModifiedBy'),lastSavedSource:'docProps/core.xml · cp:lastModifiedBy',author:get('http://purl.org/dc/elements/1.1/','creator')};
 }
 return {lastSavedBy:'',lastSavedSource:'DOCX 未提供最后保存者属性'};
}
root.BidDocxMetadata={read};
})(typeof window==='undefined'?globalThis:window);
