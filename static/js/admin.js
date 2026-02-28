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

  const layerCtl = L.control.layers({"Схема": baseOSM, "Темна": baseDark}, {}, {collapsed:true}).addTo(map);
  map.on("baselayerchange", (e)=>{
    uiTheme = (e.name === "Темна") ? 'dark' : 'light';
    localStorage.setItem('pvls_theme', uiTheme);
    if(btnTheme) btnTheme.textContent = (uiTheme === 'dark') ? 'Темна' : 'Світла';
    setIconTheme(uiTheme === "dark" ? "light" : "dark");
    reload();
  });

  if(btnTheme){
    btnTheme.addEventListener('click', ()=>{
      // toggle base layer
      const next = (uiTheme === 'dark') ? 'light' : 'dark';
      if(next === 'dark'){
        map.addLayer(baseDark);
        map.removeLayer(baseOSM);
      }else{
        map.addLayer(baseOSM);
        map.removeLayer(baseDark);
      }
      // baselayerchange will handle the rest
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
  const elDir=document.getElementById("dir");
  const elSpeed=document.getElementById("speed");
  const elCourseText=document.getElementById("courseText");
  const elCompass=document.getElementById("compass");
  const elNeedle=document.getElementById("needle");
  const elKnob=document.getElementById("knob");
  const elDirVal=document.getElementById("dirVal");
  const elNote=document.getElementById("note");
  const elList=document.getElementById("list");
  const btnDelete=document.getElementById("delete");

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

  map.on("click",(e)=>{
    elLat.value=e.latlng.lat.toFixed(5);
    elLng.value=e.latlng.lng.toFixed(5);
  });

  function clearForm(){
    selectedId=null; btnDelete.style.display="none";
    elLat.value=""; elLng.value=""; elNote.value=""; elSpeed.value="";
    setDir(0);
  }
  function fillForm(t){
    selectedId=t.id; btnDelete.style.display="inline-block";
    elType.value=t.type;
    elLat.value=Number(t.lat).toFixed(5);
    elLng.value=Number(t.lng).toFixed(5);
    elNote.value=t.note||"";
    elSpeed.value=(t.speed_kmh!=null? String(t.speed_kmh): "");
    setDir(t.direction||0);
    map.setView([t.lat,t.lng], Math.max(map.getZoom(), 12));
  }

  function escapeHtml(s){ return String((s ?? "")).replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m])); }

  function itemRow(t){
    const note=(t.note||"").trim();
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML=`<div class="meta">
      <div class="t">${t.type.toUpperCase()} <span style="color:#94a3b8;font-weight:600">• ${degToText(t.direction||0)} (${t.direction||0}°) • ${Number(t.speed_kmh||0)} км/год</span></div>
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

  function upsertMarker(t){
    const ll=L.latLng(t.lat,t.lng);
    const icon=makeIcon(t.type);
    const ang=parseInt(t.direction||0,10)||0;

    if(liveMarkers.has(t.id)){
      const o=liveMarkers.get(t.id);
      o.t=t;
      o.m.setLatLng(ll); o.m.setIcon(icon); o.m.setRotationAngle(ang);
      o.l.setLatLngs(arrowPolyline(ll,ang));
    }else{
      const m=L.marker(ll,{icon,rotationAngle:ang,rotationOrigin:'center center',draggable:true}).addTo(map);
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

  document.getElementById("save").addEventListener("click", async ()=>{
    const ll=latLngFromInputs();
    if(!ll){alert("Ткни на мапі або введи координати"); return;}
    const payload={
      type:elType.value,
      lat:ll.lat,
      lng:ll.lng,
      direction:parseInt(elDir.value,10)||0,
      speed_kmh: parseFloat(elSpeed.value||'0')||0,
      note:elNote.value||""
    };
    if(selectedId) await apiPost(`/api/targets/${selectedId}`, payload);
    else await apiPost("/api/targets", payload);
    await reload(); clearForm();
  });
  document.getElementById("new").addEventListener("click", ()=>clearForm());
  btnDelete.addEventListener("click", async ()=>{
    if(!selectedId) return;
    if(!confirm("Видалити ціль?")) return;
    await apiDelete(`/api/targets/${selectedId}`);
    await reload(); clearForm();
  });

  initTypeSelect();
  reload();
  loadLaunch();
});