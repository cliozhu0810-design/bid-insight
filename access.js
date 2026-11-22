(function(){
  let confirmed=false;
  const gate=document.getElementById('entry-gate'),shell=document.getElementById('app-shell');
  window.BidAccess={get confirmed(){return confirmed}};
  function showGate(){
    document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());
    confirmed=false;shell.hidden=true;shell.inert=true;gate.hidden=false;
    document.getElementById('confirm-entry').textContent='已确认，进入标鉴';
    window.scrollTo(0,0);document.getElementById('disclaimer-title').focus({preventScroll:true});
  }
  document.getElementById('confirm-entry').onclick=()=>{
    confirmed=true;gate.hidden=true;shell.hidden=false;shell.inert=false;
    // Old links may contain #method. Confirmation should always enter at the upload area.
    if(location.hash){document.querySelector('.method-details').open=false;history.replaceState(null,'',location.pathname+location.search)}
    window.scrollTo(0,0);document.getElementById('app-title').focus({preventScroll:true});
  };
  document.getElementById('review-disclaimer').onclick=showGate;
  // A restored tab also requires confirmation; keep its in-memory materials intact.
  window.addEventListener('pageshow',event=>{if(event.persisted)showGate()});
  showGate();
})();
