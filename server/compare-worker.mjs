import { parentPort,workerData } from 'node:worker_threads';
import E from '../engine.js';
try{const pairs=[];for(let i=0;i<workerData.docs.length;i++)for(let j=i+1;j<workerData.docs.length;j++)pairs.push(E.compare(workerData.docs[i],workerData.docs[j],workerData.baseline,workerData.ignores,workerData.options));parentPort.postMessage({pairs})}catch(e){parentPort.postMessage({error:'分析计算失败'})}
