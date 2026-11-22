const streams=require('./streams');
class Decoder {
 constructor(label='utf-8',options={}){this.label=label.toLowerCase();this.fatal=!!options.fatal}
 decode(data){const a=data?new Uint8Array(data.buffer||data,data.byteOffset||0,data.byteLength):new Uint8Array();let out='';
 if(this.label==='utf-16be'||this.label==='utf-16le'){for(let i=0;i+1<a.length;i+=2)out+=String.fromCharCode(this.label==='utf-16le'?a[i]|a[i+1]<<8:a[i]<<8|a[i+1]);return out.replace(/^\ufeff/,'')}
 if(this.label==='ascii'||this.label==='latin1'){for(const c of a)out+=String.fromCharCode(c);return out}
 for(let i=0;i<a.length;){const first=a[i++];let c=first,n=0,min=0;if(first<128){}else if(first>=194&&first<=223){c=first&31;n=1;min=128}else if(first>=224&&first<=239){c=first&15;n=2;min=2048}else if(first>=240&&first<=244){c=first&7;n=3;min=65536}else {if(this.fatal)throw Error('UTF-8 编码无效');out+='\ufffd';continue}
 let valid=i+n<=a.length;for(let j=0;j<n&&valid;j++){if((a[i]&192)!==128){valid=false;break}c=(c<<6)|(a[i++]&63)}if(!valid||c<min||c>0x10ffff||c>=0xd800&&c<=0xdfff){if(this.fatal)throw Error('UTF-8 编码无效');out+='\ufffd'}else out+=String.fromCodePoint(c)}return out.replace(/^\ufeff/,'');
 }
}
function clone(x,opts,seen=new Map()) {if(x===null||typeof x!=='object')return x;if(seen.has(x))return seen.get(x);if(x instanceof ArrayBuffer)return x.slice(0);if(ArrayBuffer.isView(x))return x instanceof DataView?new DataView(x.buffer.slice(x.byteOffset,x.byteOffset+x.byteLength)):new x.constructor(x);if(x instanceof Error){const e=new Error(x.message);e.name=x.name;return e}if(x instanceof Set)return new Set([...x].map(v=>clone(v,null,seen)));if(x instanceof Map)return new Map([...x].map(([k,v])=>[clone(k,null,seen),clone(v,null,seen)]));const out=Array.isArray(x)?[]:{};seen.set(x,out);for(const k of Object.keys(x))out[k]=clone(x[k],null,seen);return out}
class LocalURL { constructor(){throw Error('本地模式不解析网络地址')} }
module.exports={URL:LocalURL,scope:{},TextDecoder:Decoder,ReadableStream:streams.ReadableStream,clone};
