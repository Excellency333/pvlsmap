document.addEventListener("DOMContentLoaded", ()=>{
  const CENTER = [48.5231, 35.8707];
  const map = L.map('map', {zoomControl:true}).setView(CENTER, 11);
  setTimeout(()=>{ try{ map.invalidateSize(); map.setView(CENTER, 11);}catch(_){ } }, 250);

  const baseOSM = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, attribution:'&copy; OpenStreetMap'});
  const baseVoyager = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {maxZoom:20, attribution:'&copy; OpenStreetMap & CARTO'});
  const baseCyclOSM = L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', {maxZoom:20, attribution:'&copy; OpenStreetMap contributors • CyclOSM'});
  const baseTopo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {maxZoom:17, attribution:'&copy; OpenStreetMap contributors • OpenTopoMap'});
  const baseHOT = L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {maxZoom:20, attribution:'&copy; OpenStreetMap contributors • HOT'});
  const baseDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {maxZoom:20, attribution:'&copy; OpenStreetMap & CARTO'});


  // MapTiler basemap. Prefer the vector Leaflet plugin (Ukrainian labels),
  // but always keep a raster fallback so the layer never disappears from the menu.
  function createPvlsMapTilerLayer(){
    const key = String(window.PVLS_MAPTILER_KEY || "").trim();
    if(!key) return null;

    try{
      const factory =
        (L.maptiler && typeof L.maptiler.maptilerLayer === "function" && L.maptiler.maptilerLayer.bind(L.maptiler)) ||
        (window.leafletmaptilersdk && typeof window.leafletmaptilersdk.maptilerLayer === "function" && window.leafletmaptilersdk.maptilerLayer.bind(window.leafletmaptilersdk)) ||
        (typeof L.maptilerLayer === "function" && L.maptilerLayer.bind(L));

      if(factory){
        const lang =
          (L.MaptilerLanguage && L.MaptilerLanguage.UKRAINIAN) ||
          (window.leafletmaptilersdk && window.leafletmaptilersdk.MaptilerLanguage && window.leafletmaptilersdk.MaptilerLanguage.UKRAINIAN) ||
          "uk";
        const style =
          (L.MaptilerStyle && L.MaptilerStyle.STREETS) ||
          (window.leafletmaptilersdk && window.leafletmaptilersdk.MaptilerStyle && window.leafletmaptilersdk.MaptilerStyle.STREETS) ||
          "streets-v4";

        const layer = factory({
          apiKey:key,
          style,
          language:lang,
          navigationControl:false,
          geolocateControl:false,
          terrainControl:false,
          scaleControl:false,
          fullscreenControl:false,
          maptilerLogo:true,
          logoPosition:"top-right",
        });
        if(layer && typeof layer.on === "function"){
          layer.on("ready", ()=>{
            try{ if(typeof layer.setLanguage === "function") layer.setLanguage(lang); }catch(_){ }
            enhancePvlsMapTilerLabels(layer);
          });
        }
        if(layer) return layer;
      }
    }catch(err){
      console.warn("MapTiler vector layer unavailable; using raster fallback", err);
    }

    // Official MapTiler raster fallback: no plugin dependency.
    // This keeps the basemap selectable even if the vector CDN is blocked.
    return L.tileLayer(`https://api.maptiler.com/maps/streets-v4/256/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`, {
      minZoom:1,
      maxZoom:20,
      crossOrigin:true,
      attribution:'&copy; MapTiler &copy; OpenStreetMap contributors'
    });
  }

  function enhancePvlsMapTilerLabels(layer){
    try{
      const mt = layer && layer.getMaptilerMap ? layer.getMaptilerMap() : null;
      if(!mt || mt.__pvlsLabelsEnhanced) return;
      mt.__pvlsLabelsEnhanced = true;
      const style = mt.getStyle ? mt.getStyle() : null;
      const layers = style && Array.isArray(style.layers) ? style.layers : [];
      for(const sl of layers){
        if(!sl || sl.type !== "symbol" || !sl.layout || sl.layout["text-field"] == null) continue;
        const id = String(sl.id || "");
        // We mainly strengthen geographic/place labels, not road shields/icons.
        const placeLabel = /(place|settlement|city|town|village|hamlet|locality|country|state|region|municip|poi-label)/i.test(id);
        if(!placeLabel) continue;
        try{ mt.setPaintProperty(id, "text-halo-color", "rgba(255,255,255,0.94)"); }catch(_){ }
        try{ mt.setPaintProperty(id, "text-halo-width", 2.1); }catch(_){ }
        try{ mt.setPaintProperty(id, "text-halo-blur", 0.35); }catch(_){ }
        try{ mt.setPaintProperty(id, "text-opacity", 1); }catch(_){ }

        const oldSize = sl.layout["text-size"];
        if(oldSize != null){
          const factor = /(city|town|settlement|place)/i.test(id) ? 1.18 : 1.10;
          try{
            if(typeof oldSize === "number") mt.setLayoutProperty(id, "text-size", oldSize * factor);
            else if(Array.isArray(oldSize)) mt.setLayoutProperty(id, "text-size", ["*", oldSize, factor]);
          }catch(_){ }
        }
      }
    }catch(err){
      console.warn("MapTiler label enhancement skipped", err);
    }
  }

  const baseMapTiler = createPvlsMapTilerLayer();

  const baseLayers = {
    'Стандартна OSM': baseOSM,
    'Voyager (детальна)': baseVoyager,
    'CyclOSM': baseCyclOSM,
    'Топографічна': baseTopo,
    'Гуманітарна': baseHOT,
    'Темна CARTO': baseDark,
  };
  if(baseMapTiler) baseLayers['MapTiler 🇺🇦 (чіткі назви)'] = baseMapTiler;
  const allBaseLayers = Object.values(baseLayers);
  const btnTheme = document.getElementById('btnTheme');
  let uiTheme = (localStorage.getItem('pvls_theme') || 'dark');
  let currentBase = (uiTheme === 'dark') ? baseDark : baseOSM;

  function setBaseLayer(layer){
    for(const b of allBaseLayers){ if(map.hasLayer(b)) map.removeLayer(b); }
    currentBase = layer;
    currentBase.addTo(map);
    const isDark = (currentBase === baseDark);
    uiTheme = isDark ? 'dark' : 'light';
    localStorage.setItem('pvls_theme', uiTheme);
    if(btnTheme) btnTheme.textContent = isDark ? 'Темна' : 'Світла';
    setIconTheme(isDark ? 'light' : 'dark');
    try{ lastAdminUpdated=null; reload(); }catch(_){ }
  }

  currentBase.addTo(map);
  setIconTheme(uiTheme === 'dark' ? 'light' : 'dark');
  if(btnTheme) btnTheme.textContent = (uiTheme === 'dark') ? 'Темна' : 'Світла';
  L.control.layers(baseLayers, {}, {position:'topleft', collapsed:true}).addTo(map);
  map.on('baselayerchange', (e)=>{
    currentBase = e.layer;
    const isDark = (currentBase === baseDark);
    uiTheme = isDark ? 'dark' : 'light';
    localStorage.setItem('pvls_theme', uiTheme);
    if(btnTheme) btnTheme.textContent = isDark ? 'Темна' : 'Світла';
    setIconTheme(isDark ? 'light' : 'dark');
    try{ lastAdminUpdated=null; reload(); }catch(_){ }
  });

  if(btnTheme){
    btnTheme.addEventListener('click', ()=>{
      setBaseLayer(currentBase === baseDark ? baseOSM : baseDark);
    });
  }

  // Info modal
  const back = document.getElementById("modalBack");
  const infoBtn = document.getElementById("infoBtn");
  const closeBtn = document.getElementById("closeModal");
  if(infoBtn && back) infoBtn.addEventListener("click", ()=> back.style.display="flex");
  if(closeBtn && back) closeBtn.addEventListener("click", ()=> back.style.display="none");
  if(back) back.addEventListener("click", (e)=>{ if(e.target === back) back.style.display="none"; });

  function toast(message){
    let el=document.getElementById("pvlsAdminToast");
    if(!el){
      el=document.createElement("div");
      el.id="pvlsAdminToast";
      el.style.cssText="position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:99999;background:rgba(10,14,20,.94);color:#fff;border:1px solid rgba(255,255,255,.16);border-radius:14px;padding:10px 14px;font-weight:900;box-shadow:0 10px 30px rgba(0,0,0,.4);opacity:0;transition:opacity .15s";
      document.body.appendChild(el);
    }
    el.textContent=String(message||"");
    el.style.opacity="1";
    clearTimeout(el._timer);
    el._timer=setTimeout(()=>{el.style.opacity="0";},1800);
  }

  let selectedId = null;
  let lastAdminUpdated = null;
  const liveMarkers = new Map();
  // ballistic destination helpers
  let ballisticLine = null;
  let ballisticDestMarker = null;
  let awaitingBallisticDest = false;

  // threat zones
  let threatZones = [];
  let selectedZoneId = null;
  let placingThreatZone = false;
  const zoneObjects = new Map(); // id -> {circle,center,z}
  const zoneSaveQueues = new Map(); // serialize saves per zone, prevents stale response snap-back
  const zoneRevisions = new Map(); // local geometry revision per zone

  function touchZoneLocal(id){
    if(!id) return 0;
    const rev=(zoneRevisions.get(id)||0)+1;
    zoneRevisions.set(id,rev);
    return rev;
  }

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
    if(placingThreatZone || selectedLaunchName) return;
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
    selectZone(null);
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
      const selectCurrentTarget = ()=>{
        const current = liveMarkers.get(t.id);
        fillForm((current && current.t) ? current.t : t);
      };
      m.on("click", selectCurrentTarget);
      m.on("dragstart", selectCurrentTarget);
      m.on("drag", (e)=>{ if(selectedId===t.id){ const p=e.target.getLatLng(); elLat.value=p.lat.toFixed(5); elLng.value=p.lng.toFixed(5);} });
      m.on("dragend", async (e)=>{
        if(selectedId!==t.id) return;
        const p=e.target.getLatLng();
        elLat.value=p.lat.toFixed(5); elLng.value=p.lng.toFixed(5);
        try{
          const saved = await saveTarget();
          if(saved){
            upsertMarker(saved);
            fillForm(saved);
          }
        }catch(_){ }
      });
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
    const url = lastAdminUpdated ? (`/api/targets?since=${encodeURIComponent(lastAdminUpdated)}`) : "/api/targets";
    const data=await apiGet(url);
    if(data && data.updated_at) lastAdminUpdated = data.updated_at;
    if(!data.targets) return;
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
      row.querySelector('[data-act="select"]').addEventListener('click',()=>{placingThreatZone=false; if(zoneNew){zoneNew.classList.remove('armed');zoneNew.textContent='+ Нова зона';} selectedLaunchName=s.name; toast(`Вибрано: ${s.name}. Тепер клікни на мапі.`);});
      row.querySelector('[data-act="toggle"]').addEventListener('click',async()=>{
        await apiPost('/api/launchsites',{name:s.name,lat:s.lat,lng:s.lng,active:!s.active});
        await loadLaunch();
      });
      launchList.appendChild(row);
    }
  }

  map.on('click', async (e)=>{
    if(placingThreatZone) return;
    if(!selectedLaunchName) return;
    const s=launchSites.find(x=>x.name===selectedLaunchName);
    const active=s?!!s.active:false;
    await apiPost('/api/launchsites',{name:selectedLaunchName,lat:e.latlng.lat,lng:e.latlng.lng,active});
    const savedLaunchName=selectedLaunchName;
    await loadLaunch();
    selectedLaunchName=null;
    toast(`Координати для ${savedLaunchName} збережено`);
  });

  // ---------------- Threat zones ----------------
  const zoneNew=document.getElementById('zoneNew');
  const zoneDelete=document.getElementById('zoneDelete');
  const zoneDeleteAll=document.getElementById('zoneDeleteAll');
  const zoneRadius=document.getElementById('zoneRadius');
  const zoneRadiusVal=document.getElementById('zoneRadiusVal');
  const zoneRadiusNum=document.getElementById('zoneRadiusNum');
  const zoneList=document.getElementById('zoneList');

  function zoneCenterIcon(){
    return L.divIcon({
      className:'zone-center-icon',
      html:'<div class="zone-center-dot"></div>',
      iconSize:[24,24],
      iconAnchor:[12,12]
    });
  }

  function zoneRadiusHandleIcon(){
    return L.divIcon({
      className:'zone-radius-handle-icon',
      html:'<div class="zone-radius-handle-dot"></div>',
      iconSize:[22,22],
      iconAnchor:[11,11]
    });
  }

  function formatKm(km){
    const n=Number(km||0);
    return `${Number.isInteger(n)? n.toFixed(0): n.toFixed(1)} км`;
  }

  function syncZoneRadiusInputs(km){
    const safe=Math.max(0.5, Math.min(100, Number(km||10)));
    if(zoneRadius) zoneRadius.value=String(safe);
    if(zoneRadiusNum) zoneRadiusNum.value=String(safe);
    if(zoneRadiusVal) zoneRadiusVal.textContent=formatKm(safe);
  }

  function currentRadiusM(){
    const raw = parseFloat((zoneRadiusNum?.value || zoneRadius?.value || '10'));
    const km=Math.max(0.5, Math.min(100, Number.isFinite(raw)? raw : 10));
    return km*1000;
  }

  function updateZoneRadiusLabel(){
    syncZoneRadiusInputs((parseFloat(zoneRadiusNum?.value || zoneRadius?.value || '10')||10));
  }

  function zoneEdgePoint(latlng, radiusM){
    const R=6371000;
    const brng=Math.PI/2;
    const lat1=latlng.lat*Math.PI/180;
    const lon1=latlng.lng*Math.PI/180;
    const ang=radiusM/R;
    const lat2=Math.asin(Math.sin(lat1)*Math.cos(ang)+Math.cos(lat1)*Math.sin(ang)*Math.cos(brng));
    const lon2=lon1+Math.atan2(Math.sin(brng)*Math.sin(ang)*Math.cos(lat1), Math.cos(ang)-Math.sin(lat1)*Math.sin(lat2));
    return L.latLng(lat2*180/Math.PI, lon2*180/Math.PI);
  }

  function refreshZoneHandles(o){
    if(!o) return;
    const isSelected = !!selectedZoneId && selectedZoneId===o.z.id;
    const edge = zoneEdgePoint(L.latLng(Number(o.z.lat), Number(o.z.lng)), Math.max(500, Number(o.z.radius_m||10000)));
    try{ o.radiusHandle.setLatLng(edge); }catch(_){ }
    if(isSelected){
      if(!map.hasLayer(o.radiusHandle)) o.radiusHandle.addTo(map);
      try{ o.center.setZIndexOffset(950); o.radiusHandle.setZIndexOffset(940); }catch(_){ }
    }else{
      try{ if(map.hasLayer(o.radiusHandle)) map.removeLayer(o.radiusHandle); }catch(_){ }
      try{ o.center.setZIndexOffset(700); }catch(_){ }
    }
  }

  function selectZone(id){
    selectedZoneId=id || null;
    for(const [zid,o] of zoneObjects.entries()){
      const selected=(zid===selectedZoneId);
      try{o.circle.setStyle({weight:selected?4:2, opacity:selected?0.98:0.9, fillOpacity:selected?0.26:0.18});}catch(_){ }
      refreshZoneHandles(o);
    }
    const z=threatZones.find(x=>x.id===selectedZoneId);
    if(z){
      syncZoneRadiusInputs(Number(z.radius_m||10000)/1000);
    }else{
      syncZoneRadiusInputs(parseFloat(zoneRadius?.value||'10')||10);
    }
    if(zoneDelete) zoneDelete.disabled=!selectedZoneId;
    renderZoneList();
  }

  async function persistZone(z){
    if(!z || !z.id) return null;
    const id=z.id;
    const rev=zoneRevisions.get(id)||0;
    const snapshot={
      lat:Number(z.lat),
      lng:Number(z.lng),
      radius_m:Number(z.radius_m)
    };

    // Strictly serialize writes for this zone. An older HTTP response can never
    // overwrite a newer local drag/radius change anymore.
    const previous=zoneSaveQueues.get(id) || Promise.resolve();
    const job=previous.catch(()=>null).then(async()=>{
      const saved=await apiPost(`/api/zones/${id}`, snapshot);
      const currentRev=zoneRevisions.get(id)||0;

      // Only accept geometry from this response when nothing newer was edited.
      if(currentRev===rev){
        const local={...saved, lat:snapshot.lat, lng:snapshot.lng, radius_m:snapshot.radius_m};
        const idx=threatZones.findIndex(x=>x.id===id);
        if(idx>=0) threatZones[idx]=local; else threatZones.push(local);
        const o=zoneObjects.get(id);
        if(o){
          o.z=local;
          // Do NOT call upsertZone() here: the marker/circle are already at the
          // correct local position and reapplying server geometry caused jumps.
          refreshZoneHandles(o);
        }
        renderZoneList();
      }
      return saved;
    });
    zoneSaveQueues.set(id,job);
    try{
      return await job;
    }finally{
      if(zoneSaveQueues.get(id)===job) zoneSaveQueues.delete(id);
    }
  }

  function upsertZone(z){
    if(!z || !z.id) return;
    if(!zoneRevisions.has(z.id)) zoneRevisions.set(z.id,0);
    const ll=L.latLng(Number(z.lat),Number(z.lng));
    const radius=Math.max(500,Number(z.radius_m||10000));
    if(zoneObjects.has(z.id)){
      const o=zoneObjects.get(z.id);
      o.z=z;
      o.circle.setLatLng(ll); o.circle.setRadius(radius);
      o.center.setLatLng(ll);
      refreshZoneHandles(o);
    }else{
      const circle=L.circle(ll,{
        radius,
        color:'#ff2146',
        weight:2,
        opacity:.9,
        fillColor:'#ff2146',
        fillOpacity:.18,
        interactive:false,
        bubblingMouseEvents:false
      }).addTo(map);
      const center=L.marker(ll,{icon:zoneCenterIcon(),draggable:true,zIndexOffset:700}).addTo(map);
      const radiusHandle=L.marker(zoneEdgePoint(ll, radius),{icon:zoneRadiusHandleIcon(),draggable:true,zIndexOffset:690}).addTo(map);
      const pick=()=>selectZone(z.id);
      center.on('click',(e)=>{try{L.DomEvent.stopPropagation(e);}catch(_){ } pick();});
      radiusHandle.on('click',(e)=>{try{L.DomEvent.stopPropagation(e);}catch(_){ } pick();});
      center.on('dragstart',pick);
      center.on('drag',(e)=>{
        const p=e.target.getLatLng();
        circle.setLatLng(p);
        const o=zoneObjects.get(z.id);
        if(!o) return;
        o.z.lat=p.lat; o.z.lng=p.lng;
        touchZoneLocal(z.id);
        refreshZoneHandles(o);
        renderZoneList();
      });
      center.on('dragend',async(e)=>{
        const p=e.target.getLatLng();
        const o=zoneObjects.get(z.id);
        if(!o) return;
        o.z.lat=p.lat; o.z.lng=p.lng;
        touchZoneLocal(z.id);
        renderZoneList();
        try{await persistZone(o.z);}catch(err){console.error(err);}
      });
      radiusHandle.on('dragstart',pick);
      radiusHandle.on('drag',(e)=>{
        const p=e.target.getLatLng();
        const o=zoneObjects.get(z.id);
        if(!o) return;
        const centerLL=o.center.getLatLng();
        const r=Math.max(500, map.distance(centerLL, p));
        o.z.radius_m=r;
        touchZoneLocal(z.id);
        try{o.circle.setRadius(r);}catch(_){ }
        syncZoneRadiusInputs(r/1000);
        renderZoneList();
      });
      radiusHandle.on('dragend',async(e)=>{
        const p=e.target.getLatLng();
        const o=zoneObjects.get(z.id);
        if(!o) return;
        const centerLL=o.center.getLatLng();
        o.z.radius_m=Math.max(500, map.distance(centerLL, p));
        touchZoneLocal(z.id);
        refreshZoneHandles(o);
        renderZoneList();
        try{await persistZone(o.z);}catch(err){console.error(err);}
      });
      zoneObjects.set(z.id,{circle,center,radiusHandle,z});
      refreshZoneHandles(zoneObjects.get(z.id));
    }
    if(selectedZoneId===z.id) selectZone(z.id);
  }

  function renderZoneList(){
    if(!zoneList) return;
    zoneList.innerHTML='';
    threatZones.forEach((z,idx)=>{
      const row=document.createElement('div');
      row.className='item zone-item'+(z.id===selectedZoneId?' is-selected':'');
      row.innerHTML=`<div class="meta"><div class="t">🔴 Зона ${idx+1}</div><div class="s">Радіус ${formatKm(Number(z.radius_m||0)/1000)} • ${Number(z.lat).toFixed(4)}, ${Number(z.lng).toFixed(4)}</div></div><div class="actions"><button class="btn small" data-act="select">Вибрати</button><button class="btn small danger" data-act="del">Видалити</button></div>`;
      row.querySelector('[data-act="select"]').addEventListener('click',()=>selectZone(z.id));
      row.querySelector('[data-act="del"]').addEventListener('click',async()=>{
        removeZoneLocal(z.id);
        toast('Зону видалено');
        try{ await apiDelete(`/api/zones/${z.id}`); }catch(err){ console.error(err); await loadZones(); }
      });
      zoneList.appendChild(row);
    });
  }

  function syncZones(list){
    const alive=new Set((list||[]).map(z=>z.id));
    for(const [id,o] of zoneObjects.entries()){
      if(!alive.has(id)){
        try{map.removeLayer(o.circle);}catch(_){ }
        try{map.removeLayer(o.center);}catch(_){ }
        try{if(o.radiusHandle) map.removeLayer(o.radiusHandle);}catch(_){ }
        zoneObjects.delete(id);
      }
    }
    threatZones=(list||[]).slice();
    threatZones.forEach(upsertZone);
    if(selectedZoneId && !alive.has(selectedZoneId)) selectedZoneId=null;
    if(zoneDelete) zoneDelete.disabled=!selectedZoneId;
    renderZoneList();
  }


  function removeZoneLocal(id){
    if(!id) return;
    threatZones = threatZones.filter(z=>z.id!==id);
    const o = zoneObjects.get(id);
    if(o){
      try{map.removeLayer(o.circle);}catch(_){ }
      try{map.removeLayer(o.center);}catch(_){ }
      try{if(o.radiusHandle) map.removeLayer(o.radiusHandle);}catch(_){ }
      zoneObjects.delete(id);
    }
    zoneRevisions.delete(id);
    zoneSaveQueues.delete(id);
    if(selectedZoneId===id) selectedZoneId=null;
    renderZoneList();
    if(zoneDelete) zoneDelete.disabled=!selectedZoneId;
  }

  async function loadZones(){
    try{
      const d=await apiGet('/api/zones');
      syncZones(d.zones||[]);
    }catch(err){console.error('zones load failed',err);}
  }

  if(zoneNew){
    zoneNew.addEventListener('click',()=>{
      placingThreatZone=!placingThreatZone;
      selectedLaunchName=null;
      zoneNew.classList.toggle('armed',placingThreatZone);
      zoneNew.textContent=placingThreatZone?'Скасувати':'+ Нова зона';
      if(placingThreatZone) toast('Клікни на мапі — це буде центр зони');
    });
  }

  map.on('click',async(e)=>{
    if(!placingThreatZone) return;
    placingThreatZone=false;
    if(zoneNew){zoneNew.classList.remove('armed');zoneNew.textContent='+ Нова зона';}
    try{
      const saved=await apiPost('/api/zones',{lat:e.latlng.lat,lng:e.latlng.lng,radius_m:currentRadiusM()});
      threatZones.push(saved);
      upsertZone(saved);
      selectZone(saved.id);
      toast('Зону загрози додано');
    }catch(err){console.error(err);}
  });

  async function applyRadiusControls(commit=false){
    syncZoneRadiusInputs(parseFloat(zoneRadius?.value||'10')||10);
    if(!selectedZoneId) return;
    const o=zoneObjects.get(selectedZoneId);
    if(!o) return;
    o.z.radius_m=currentRadiusM();
    touchZoneLocal(selectedZoneId);
    try{o.circle.setRadius(o.z.radius_m);}catch(_){ }
    refreshZoneHandles(o);
    renderZoneList();
    if(commit){
      try{await persistZone(o.z);}catch(err){console.error(err);}
    }
  }

  if(zoneRadius){
    zoneRadius.addEventListener('input',()=>{
      if(zoneRadiusNum) zoneRadiusNum.value=zoneRadius.value;
      applyRadiusControls(false);
    });
    zoneRadius.addEventListener('change',()=>applyRadiusControls(true));
  }
  if(zoneRadiusNum){
    zoneRadiusNum.addEventListener('input',()=>{
      let v=parseFloat(zoneRadiusNum.value||'10');
      if(!Number.isFinite(v)) v=10;
      v=Math.max(0.5, Math.min(100, v));
      zoneRadiusNum.value=String(v);
      if(zoneRadius) zoneRadius.value=String(v);
      applyRadiusControls(false);
    });
    zoneRadiusNum.addEventListener('change',()=>applyRadiusControls(true));
  }

  document.querySelectorAll('.zone-radius-preset').forEach(btn=>{
    btn.addEventListener('click',()=>{
      if(!zoneRadius) return;
      const val=String(btn.dataset.km||'10');
      zoneRadius.value=val;
      if(zoneRadiusNum) zoneRadiusNum.value=val;
      zoneRadius.dispatchEvent(new Event('input'));
      zoneRadius.dispatchEvent(new Event('change'));
    });
  });

  if(zoneDelete){
    zoneDelete.addEventListener('click',async()=>{
      if(!selectedZoneId) return;
      const id=selectedZoneId;
      removeZoneLocal(id);
      toast('Зону видалено');
      try{ await apiDelete(`/api/zones/${id}`); }catch(err){ console.error(err); await loadZones(); }
    });
  }

  if(zoneDeleteAll){
    zoneDeleteAll.addEventListener('click',async()=>{
      if(!confirm('Видалити всі зони загрози?')) return;
      syncZones([]);
      selectedZoneId=null;
      toast('Всі зони видалені');
      try{ await apiDelete('/api/zones'); }catch(err){ console.error(err); await loadZones(); }
    });
  }
  syncZoneRadiusInputs(parseFloat(zoneRadius?.value||'10')||10);

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
  loadZones();
});