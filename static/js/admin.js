document.addEventListener("DOMContentLoaded", ()=>{
  const CENTER = [48.5231, 35.8707];
  const map = L.map('map', {zoomControl:true}).setView(CENTER, 11);
  setTimeout(()=>{ try{ map.invalidateSize(); map.setView(CENTER, 11);}catch(_){ } }, 250);

  const baseOSM = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, attribution:'&copy; OpenStreetMap'});
  const baseDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {maxZoom:19, attribution:'&copy; OpenStreetMap & CARTO'});

  const btnTheme = document.getElementById('btnTheme');
  let uiTheme = (localStorage.getItem('pvls_theme') || 'dark');
  let currentBase = (uiTheme === 'dark') ? baseDark : baseOSM;
  currentBase.addTo(map);
  setIconTheme(uiTheme === 'dark' ? 'light' : 'dark');
  if(btnTheme) btnTheme.textContent = (uiTheme === 'dark') ? 'Темна' : 'Світла';

  if(btnTheme){
    btnTheme.addEventListener('click', ()=>{
      const next = (uiTheme === 'dark') ? 'light' : 'dark';
      uiTheme = next;
      localStorage.setItem('pvls_theme', uiTheme);

      // switch tiles
      if(uiTheme === 'dark'){
        if(map.hasLayer(baseOSM)) map.removeLayer(baseOSM);
        if(!map.hasLayer(baseDark)) map.addLayer(baseDark);
      }else{
        if(map.hasLayer(baseDark)) map.removeLayer(baseDark);
        if(!map.hasLayer(baseOSM)) map.addLayer(baseOSM);
      }

      if(btnTheme) btnTheme.textContent = (uiTheme === 'dark') ? 'Темна' : 'Світла';
      setIconTheme(uiTheme === 'dark' ? 'light' : 'dark');
      reload();
    });
  }

  // Info modal
  const back = document.getElementById("modalBack");
  const infoBtn = document.getElementById("infoBtn");
  const closeBtn = document.getElementById("closeModal");
  if(infoBtn && back) infoBtn.addEventListener("click", ()=> back.style.display="flex");
  if(closeBtn && back) closeBtn.addEventListener("click", ()=> back.style.display="none");
  if(back) back.addEventListener("click", (e)=>{ if(e.target === back) back.style.display="none"; });

  let selectedId = null;
  const liveMarkers = new Map();
  // ballistic destination helpers
  let ballisticLine = null;
  let ballisticDestMarker = null;
  let awaitingBallisticDest = false;

  const elType=document.getElementById("type");

  const TYPE_OPTIONS = [
    {value:"shahed",   label:"Шахед"},
    {value:"gerbera",  label:"Гербера"},
    {value:"fpv",      label:"FPV-дрон"},
    {value:"cruise",   label:"Крилата ракета"},
    {value:"ballistic",label:"Балістика"},
    {value:"aircraft", label:"Літак"},
    {value:"recon",    label:"Розвіддрон"},
    {value:"unknown",  label:"Невідомо"},
  ];
  function initTypeSelect(){
    elType.innerHTML = "";
    TYPE_OPTIONS.forEach(o=>{
      const opt=document.createElement("option");
      opt.value=o.value; opt.textContent=o.label;
      elType.appendChild(opt);
    });
    if(!elType.value) elType.value="shahed";
  }

  const elLat=document.getElementById("lat");
  const elLng=document.getElementById("lng");
  const elDestWrap=document.getElementById("destWrap");
  const elDestLat=document.getElementById("destLat");
  const elDestLng=document.getElementById("destLng");
  const elDir=document.getElementById("dir");
  const elSpeed=document.getElementById("speed");
  const elCourseText=document.getElementById("courseText");
  const elCompass=document.getElementById("compass");
  const elNeedle=document.getElementById("needle");
  const elKnob=document.getElementById("knob");
  const elDirVal=document.getElementById("dirVal");
  const elNote=document.getElementById("note");
  // Active flag (for targets like UAV launches etc.)
  const elActive=document.getElementById("active");
  const elList=document.getElementById("list");
  const btnDelete=document.getElementById("delete");
  const listEls = new Map(); // id -> row element (fast updates)

  function refreshActiveHint(){
    if(!elActive) return;
    const wrap = elActive.closest('.active-row') || elActive.parentElement;
    if(wrap) wrap.classList.toggle('is-active', !!elActive.checked);
  }
  if(elActive){
    elActive.addEventListener('change', ()=>{
      refreshActiveHint();
      // live preview of marker color
      if(selectedId && liveMarkers.has(selectedId)){
        const o = liveMarkers.get(selectedId);
        o.t.active = !!elActive.checked;
        const iconEl = o.m.getElement();
        if(iconEl){
          iconEl.classList.toggle('danger', !!elActive.checked);
          iconEl.classList.toggle('ok', !elActive.checked);
        }
      }
    });
    refreshActiveHint();
  }

  const DIR16=[
    {k:'Пн',d:0},{k:'ПнПнСх',d:22.5},{k:'ПнСх',d:45},{k:'СхПнСх',d:67.5},
    {k:'Сх',d:90},{k:'СхПдСх',d:112.5},{k:'ПдСх',d:135},{k:'ПдПдСх',d:157.5},
    {k:'Пд',d:180},{k:'ПдПдЗх',d:202.5},{k:'ПдЗх',d:225},{k:'ЗхПдЗх',d:247.5},
    {k:'Зх',d:270},{k:'ЗхПнЗх',d:292.5},{k:'ПнЗх',d:315},{k:'ПнПнЗх',d:337.5},
  ];
  function degToText(deg){
    const a=((deg%360)+360)%360;
    const idx=Math.round(a/22.5)%16;
    return DIR16[idx].k;
  }
  function textToDeg(txt){
    const f=DIR16.find(x=>x.k===txt);
    return f?f.d:0;
  }
  if(elCourseText){
    elCourseText.innerHTML=DIR16.map(x=>`<option value="${x.k}">${x.k}</option>`).join('');
    elCourseText.addEventListener('change', ()=>setDir(textToDeg(elCourseText.value), true));
  }

  function setDir(v, fromText=false){
    let n=Number(v); if(Number.isNaN(n)) n=0;
    n=((n%360)+360)%360;
    const ni=Math.round(n);
    elDir.value=ni; elDirVal.textContent=`${ni}°`;
    if(!fromText && elCourseText) elCourseText.value=degToText(n);
    if(elNeedle) elNeedle.style.transform=`translate(-50%,-100%) rotate(${n}deg)`;
    if(elCompass && elKnob){
      const r=72;
      const rad=(n-90)*Math.PI/180;
      const x=Math.cos(rad)*r;
      const y=Math.sin(rad)*r;
      elKnob.style.transform=`translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    }

    // live update selected marker direction
    if(selectedId && liveMarkers.has(selectedId)){
      const o=liveMarkers.get(selectedId);
      o.t.direction=ni;
      o.m.setRotationAngle(ni);
      o.l.setLatLngs(arrowPolyline(o.m.getLatLng(),ni));
    }
  }
  elDir.addEventListener("input", ()=>setDir(elDir.value));
  document.getElementById("minus5").addEventListener("click", ()=>setDir(parseInt(elDir.value,10)-5));
  document.getElementById("plus5").addEventListener("click", ()=>setDir(parseInt(elDir.value,10)+5));
  document.getElementById("minus15").addEventListener("click", ()=>setDir(parseInt(elDir.value,10)-15));
  document.getElementById("plus15").addEventListener("click", ()=>setDir(parseInt(elDir.value,10)+15));
  // (optional old quick buttons)
  document.querySelectorAll("[data-dir]").forEach(b=> b.addEventListener("click", ()=>setDir(b.getAttribute("data-dir"))));

  // compass drag (circle)
  function pointerToDeg(ev){
    const rect=elCompass.getBoundingClientRect();
    const cx=rect.left+rect.width/2;
    const cy=rect.top+rect.height/2;
    const p = ev.touches ? ev.touches[0] : ev;
    const x=(p.clientX - cx);
    const y=(p.clientY - cy);
    const ang=Math.atan2(y,x)*180/Math.PI + 90;
    return ((ang%360)+360)%360;
  }
  if(elCompass){
    let dragging=false;
    const start=(e)=>{dragging=true; setDir(pointerToDeg(e)); e.preventDefault();};
    const move=(e)=>{if(!dragging) return; setDir(pointerToDeg(e)); e.preventDefault();};
    const end=()=>{dragging=false;};
    elCompass.addEventListener('mousedown', start);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    elCompass.addEventListener('touchstart', start, {passive:false});
    window.addEventListener('touchmove', move, {passive:false});
    window.addEventListener('touchend', end);
  }

  function latLngFromInputs(){
    const lat=parseFloat(elLat.value), lng=parseFloat(elLng.value);
    if(Number.isNaN(lat)||Number.isNaN(lng)) return null;
    return L.latLng(lat,lng);
  }

  function isBallistic(){ return elType.value === "ballistic"; }

  function clearBallisticDraw(){
    awaitingBallisticDest=false;
    if(elDestLat) elDestLat.value="";
    if(elDestLng) elDestLng.value="";
    if(ballisticLine){ map.removeLayer(ballisticLine); ballisticLine=null; }
    if(ballisticDestMarker){ map.removeLayer(ballisticDestMarker); ballisticDestMarker=null; }
  }

  function updateBallisticUI(){
    if(!elDestWrap) return;
    if(isBallistic()){
      elDestWrap.style.display="block";
      awaitingBallisticDest = !!(elLat.value && elLng.value && !(elDestLat && elDestLat.value) && !(elDestLng && elDestLng.value));
    }else{
      elDestWrap.style.display="none";
      clearBallisticDraw();
    }
  }

  function drawBallisticLine(){
    if(!isBallistic()) return;
    const start=latLngFromInputs();
    const dlat=parseFloat(elDestLat?.value||"");
    const dlng=parseFloat(elDestLng?.value||"");
    if(!start || Number.isNaN(dlat) || Number.isNaN(dlng)) return;
    const end=L.latLng(dlat,dlng);
    if(ballisticLine){ map.removeLayer(ballisticLine); }
    ballisticLine=L.polyline([start,end],{weight:4,opacity:0.9,color:"#ff3b5b"}).addTo(map);
    if(ballisticDestMarker){ map.removeLayer(ballisticDestMarker); }
    ballisticDestMarker=L.circleMarker(end,{radius:7,weight:2,opacity:0.9,fillOpacity:0.35,color:"#ff3b5b"}).addTo(map);
    ballisticDestMarker.bindTooltip("Кінцева точка",{direction:"top",offset:[0,-8]});
  }

  elType.addEventListener("change", ()=>{
    updateBallisticUI();
    // changing type resets destination visuals
    if(!isBallistic()) clearBallisticDraw();
  });

  map.on("click",(e)=>{
    // Ballistic: second click sets destination
    if(isBallistic() && elLat.value && elLng.value && awaitingBallisticDest){
      if(elDestLat) elDestLat.value=e.latlng.lat.toFixed(5);
      if(elDestLng) elDestLng.value=e.latlng.lng.toFixed(5);
      awaitingBallisticDest=false;
      drawBallisticLine();
      return;
    }
    // normal: set start
    elLat.value=e.latlng.lat.toFixed(5);
    elLng.value=e.latlng.lng.toFixed(5);
    if(isBallistic()){
      clearBallisticDraw();
      awaitingBallisticDest=true;
    }
    updateBallisticUI();
  });

  function clearForm(){
    selectedId=null; btnDelete.style.display="none";
    elLat.value=""; elLng.value=""; elNote.value=""; elSpeed.value="";
    if(elActive) elActive.checked=true; refreshActiveHint && refreshActiveHint();
    clearBallisticDraw();
    setDir(0);
    updateBallisticUI();
  }
  function fillForm(t){
    selectedId=t.id; btnDelete.style.display="inline-block";
    elType.value=t.type;
    elLat.value=Number(t.lat).toFixed(5);
    elLng.value=Number(t.lng).toFixed(5);
    elNote.value=t.note||"";
    elSpeed.value=(t.speed_kmh!=null? String(t.speed_kmh): "");
    if(elActive) elActive.checked=(t.active!==false); refreshActiveHint && refreshActiveHint();
    if(elDestLat) elDestLat.value=(t.dest_lat!=null? Number(t.dest_lat).toFixed(5): "");
    if(elDestLng) elDestLng.value=(t.dest_lng!=null? Number(t.dest_lng).toFixed(5): "");
    setDir(t.direction||0);
    map.setView([t.lat,t.lng], Math.max(map.getZoom(), 12));
    updateBallisticUI();
    clearBallisticDraw();
    if(t.type==="ballistic" && t.dest_lat!=null && t.dest_lng!=null){
      drawBallisticLine();
    }else if(t.type==="ballistic"){
      awaitingBallisticDest=true;
    }
  }

  function escapeHtml(s){ return String((s ?? "")).replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m])); }

  function itemRow(t){
    const note=(t.note||"").trim();
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML=`<div class="meta">
      <div class="t"><span class="dot ${t.active===false? "dot-off":"dot-on"}"></span> ${t.type.toUpperCase()} <span style="color:#94a3b8;font-weight:600">• ${degToText(t.direction||0)} (${t.direction||0}°) • ${Number(t.speed_kmh||0)} км/год</span></div>
      <div class="s">${Number(t.lat).toFixed(4)}, ${Number(t.lng).toFixed(4)}</div>
      ${note? `<div class="s">${escapeHtml(note)}</div>`:""}
      <div class="s">${escapeHtml(t.created_at||"")}</div>
    </div>
    <div class="actions">
      <button class="btn small" data-act="edit">Змінити</button>
      <button class="btn small danger" data-act="del">Видалити</button>
    </div>`;
    div.querySelector('[data-act="edit"]').addEventListener("click", ()=>fillForm(t));
    div.querySelector('[data-act="del"]').addEventListener("click", async ()=>{
      if(!confirm("Видалити ціль?")) return;
      await apiDelete(`/api/targets/${t.id}`);
      await reload();
      if(selectedId===t.id) clearForm();
    });
    return div;
  }

  function upsertRow(t, prepend=false){
    if(!elList) return;
    const row = itemRow(t);
    row.dataset.id = t.id;
    if(listEls.has(t.id)){
      const old = listEls.get(t.id);
      try{ old.replaceWith(row); }catch(_){ }
    }else{
      if(prepend) elList.prepend(row);
      else elList.appendChild(row);
    }
    listEls.set(t.id, row);
  }

  function removeTargetUI(id){
    // list
    if(listEls.has(id)){
      const el = listEls.get(id);
      try{ el.remove(); }catch(_){ }
      listEls.delete(id);
    }
    // marker
    if(liveMarkers.has(id)){
      const o = liveMarkers.get(id);
      try{ map.removeLayer(o.m); }catch(_){ }
      try{ map.removeLayer(o.l); }catch(_){ }
      liveMarkers.delete(id);
    }
    if(selectedId===id) clearForm();
  }

  function applyActiveClass(marker, active){
    const el = marker && marker.getElement ? marker.getElement() : null;
    if(!el) return;
    el.classList.toggle("t-active", !!active);
    el.classList.toggle("t-inactive", !active);
  }

  function upsertMarker(t){
    const ll=L.latLng(t.lat,t.lng);
    const icon=makeIcon(t.type);
    const ang=parseInt(t.direction||0,10)||0;

    if(liveMarkers.has(t.id)){
      const o=liveMarkers.get(t.id);
      o.t=t;
      o.m.setLatLng(ll); o.m.setIcon(icon); o.m.setRotationAngle(ang);
      setTimeout(()=>applyActiveClass(o.m, t.active!==false), 0);
      o.l.setLatLngs(arrowPolyline(ll,ang));
    }else{
      const m=L.marker(ll,{icon,rotationAngle:ang,rotationOrigin:'center center',draggable:true}).addTo(map);
      setTimeout(()=>applyActiveClass(m, t.active!==false), 0);
      const l=L.polyline(arrowPolyline(ll,ang),{weight:3,opacity:0.75}).addTo(map);
      m.on("click", ()=>fillForm(t));
      m.on("dragstart", ()=>fillForm(t));
      m.on("drag", (e)=>{ if(selectedId===t.id){ const p=e.target.getLatLng(); elLat.value=p.lat.toFixed(5); elLng.value=p.lng.toFixed(5);} });
      m.on("dragend", async (e)=>{ if(selectedId===t.id){ const p=e.target.getLatLng(); elLat.value=p.lat.toFixed(5); elLng.value=p.lng.toFixed(5); try{ await saveTarget(); }catch(_){ } } });
      liveMarkers.set(t.id,{m,l,t});
    }
  }

  function syncLive(list){
    const alive=new Set(list.map(x=>x.id));
    for(const [id,o] of liveMarkers.entries()){
      if(!alive.has(id)){ map.removeLayer(o.m); map.removeLayer(o.l); liveMarkers.delete(id); }
    }
    list.forEach(upsertMarker);
  }

  // compass handled by drag in setDir();

  async function reload(){
    const data=await apiGet("/api/targets");
    const list=(data.targets||[]);
    elList.innerHTML="";
    list.slice().reverse().forEach(t=> elList.appendChild(itemRow(t)));
    syncLive(list);
  }

  // launch sites (UAV bases)
  let launchSites=[];
  let selectedLaunchName=null;
  const launchList=document.getElementById('launchList');

  async function loadLaunch(){
    try{
      const d=await apiGet('/api/launchsites');
      launchSites=d.sites||[];
    }catch(_){launchSites=[];}
    renderLaunchList();
  }

  function renderLaunchList(){
    if(!launchList) return;
    launchList.innerHTML='';
    for(const s of launchSites){
      const row=document.createElement('div');
      row.className='item';
      row.innerHTML=`<div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
          <div style="font-weight:900">${escapeHtml(s.name)}</div>
          <div class="pill ${s.active?'':'muted'}" style="min-width:84px;text-align:center">${s.active?'🟢 актив':'🔴 офф'}</div>
        </div>
        <div style="opacity:.7;font-weight:800;margin-top:6px;font-size:12px">${(typeof s.lat==='number'&&typeof s.lng==='number')?`${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`:'координати не задані'}</div>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          <button class="btn small" data-act="select">Вибрати</button>
          <button class="btn small" data-act="toggle">Статус</button>
        </div>`;
      row.querySelector('[data-act="select"]').addEventListener('click',()=>{selectedLaunchName=s.name; toast(`Вибрано: ${s.name}. Тепер клікни на мапі.`);});
      row.querySelector('[data-act="toggle"]').addEventListener('click',async()=>{
        await apiPost('/api/launchsites',{name:s.name,lat:s.lat,lng:s.lng,active:!s.active});
        await loadLaunch();
      });
      launchList.appendChild(row);
    }
  }

  map.on('click', async (e)=>{
    if(!selectedLaunchName) return;
    const s=launchSites.find(x=>x.name===selectedLaunchName);
    const active=s?!!s.active:false;
    await apiPost('/api/launchsites',{name:selectedLaunchName,lat:e.latlng.lat,lng:e.latlng.lng,active});
    await loadLaunch();
    toast(`Координати для ${selectedLaunchName} збережено`);
  });

  async function saveTarget(){
    const ll=latLngFromInputs();
    if(!ll){alert("Ткни на мапі або введи координати"); return null;}
    const payload={
      type:elType.value,
      lat:ll.lat,
      lng:ll.lng,
      direction:parseInt(elDir.value,10)||0,
      speed_kmh: parseFloat(elSpeed.value||'0')||0,
      note:elNote.value||"",
      dest_lat: (isBallistic() && elDestLat && elDestLat.value)? (parseFloat(elDestLat.value)||null) : null,
      dest_lng: (isBallistic() && elDestLng && elDestLng.value)? (parseFloat(elDestLng.value)||null) : null,
      active: elActive? !!elActive.checked : true,
    };
    let saved;
    if(selectedId) saved = await apiPost(`/api/targets/${selectedId}`, payload);
    else saved = await apiPost("/api/targets", payload);
    return saved;
  }

  document.getElementById("save").addEventListener("click", async ()=>{
    const wasNew = !selectedId;
    const saved = await saveTarget();
    if(!saved) return;
    // fast UI update: no full reload
    upsertMarker(saved);
    // in list newest on top
    upsertRow(saved, wasNew);
    fillForm(saved);
  });
  document.getElementById("new").addEventListener("click", ()=>clearForm());
  btnDelete.addEventListener("click", async ()=>{
    if(!selectedId) return;
    if(!confirm("Видалити ціль?")) return;
    await apiDelete(`/api/targets/${selectedId}`);
    await reload(); clearForm();
  });

  // Delete all targets
  const btnDeleteAll = document.getElementById('deleteAll');
  if (btnDeleteAll) {
    btnDeleteAll.addEventListener('click', async ()=>{
      if(!confirm('Видалити всі цілі?')) return;
      await apiDelete('/api/targets');
      // fast clear
      for(const [id,_] of Array.from(listEls.entries())) removeTargetUI(id);
      if(elList) elList.innerHTML='';
      listEls.clear();
      clearForm();
      toast('Всі цілі видалені');
    });
  }

  initTypeSelect();
  reload();
  loadLaunch();
});