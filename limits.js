(function(root){
  const MAX_FILES=5, MAX_FILE_BYTES=200*1024*1024, MAX_PDF_PAGES=1000;
  function validateBatch(files,existingCount=0){
    if(existingCount+files.length>MAX_FILES)throw Error(`最多添加 ${MAX_FILES} 份标书；当前已有 ${existingCount} 份，本次选择 ${files.length} 份。请减少文件后重试。`);
    for(const file of files){
      if(!/\.(pdf|docx|txt)$/i.test(file.name))throw Error(`${file.name}：仅支持 PDF、DOCX、TXT`);
      if(file.size>MAX_FILE_BYTES)throw Error(`${file.name}：文件超过 200 MB，请拆分后上传。`);
    }
  }
  root.BidLimits={MAX_FILES,MAX_FILE_BYTES,MAX_PDF_PAGES,validateBatch};
  if(typeof module!=='undefined')module.exports=root.BidLimits;
})(typeof window==='undefined'?globalThis:window);
