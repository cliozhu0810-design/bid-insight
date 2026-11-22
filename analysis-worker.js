importScripts('engine.js');
self.onmessage=({data})=>{
  try {
    const pairs=[];
    for(let i=0;i<data.docs.length;i++)for(let j=i+1;j<data.docs.length;j++){
      self.postMessage({type:'progress',message:`正在比较第 ${i+1} 与第 ${j+1} 份标书…`});
      pairs.push(BidEngine.compare(data.docs[i],data.docs[j],data.baseline,data.ignores));
    }
    self.postMessage({type:'done',pairs});
  } catch(error){ self.postMessage({type:'error',message:error.message}); }
};
