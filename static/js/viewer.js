document.addEventListener("DOMContentLoaded", ()=>{
  const CENTER = [48.5231, 35.8707]; // Pavлоград (центр)
  const CITY_NEAR_M = 15000;   // "підлітає"
  const CITY_ALERT_M = 7000;   // "наближається"
  const CITY_DANGER_M = 3000;  // "дуже близько"

  // MUST exist before applyTheme()/refreshIcons() is called
  const markers = new Map(); // id -> {marker,line,trajLine,base,dest,dir,phase,prog,type,note,created_at,speed_kmh,last_anim_ms,active,prox}

  const map = L.map('map', { zoomControl:true }).setView(CENTER, 11);

  const baseLight = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, attribution:'&copy; OpenStreetMap'});
  const baseDark  = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {maxZoom:19, attribution:'&copy; OpenStreetMap & CARTO'});

  const targetsLayer = L.layerGroup().addTo(map);
  const linesLayer   = L.layerGroup().addTo(map);
  const launchLayer  = L.layerGroup().addTo(map);

  // Scale bar
  try{ L.control.scale({imperial:false, maxWidth:140}).addTo(map); }catch(_){}

  function refreshIcons(){
    // Rebuild icons to match theme / proximity / effects
    for(const o of markers.values()){
      const prox = getProxFlags(o.base);
      const effectsOn = !document.body.classList.contains("effects-off");
      o.marker.setIcon(makeIconAnimated(o.type, o.dir, true, {
        pulse: effectsOn && o.active,
        pop: false,
        near: prox.near,
        danger: prox.danger
      }));
    }
  }

  function applyTheme(theme){
    const th = (theme==="dark") ? "dark" : "light";
    localStorage.setItem("pvls_map_theme", th);
    document.documentElement.setAttribute("data-theme", th);

    if(th==="dark"){
      if(map.hasLayer(baseLight)) map.removeLayer(baseLight);
      if(!map.hasLayer(baseDark)) baseDark.addTo(map);
      setIconTheme("light"); // dark map -> light icons
      const wm=document.getElementById("wmLayer"); if(wm) wm.dataset.theme="light";
      const btn=document.getElementById("themeBtn"); if(btn) btn.textContent="☀";
    }else{
      if(map.hasLayer(baseDark)) map.removeLayer(baseDark);
      if(!map.hasLayer(baseLight)) baseLight.addTo(map);
      setIconTheme("dark"); // light map -> dark icons
      const wm=document.getElementById("wmLayer"); if(wm) wm.dataset.theme="dark";
      const btn=document.getElementById("themeBtn"); if(btn) btn.textContent="☾";
    }
    refreshIcons();
  }

  const themeBtn=document.getElementById("themeBtn");
  if(themeBtn){
    themeBtn.addEventListener("click", ()=>{
      const cur=localStorage.getItem("pvls_map_theme")||"light";
      applyTheme(cur==="light" ? "dark" : "light");
    });
  }
  applyTheme(localStorage.getItem("pvls_map_theme")||"light");

  // Watermark overlay
  const wm = document.getElementById("wmLayer");
  if (wm){ wm.style.pointerEvents="none"; }

  setTimeout(()=>{ try{ map.invalidateSize(); map.setView(CENTER, 11); }catch(_){ } }, 250);

  function applyActiveClass(marker, active){
    const el = marker && marker.getElement ? marker.getElement() : null;
    if(!el) return;
    el.classList.toggle("t-active", !!active);
    el.classList.toggle("t-inactive", !active);
  }

  // ---------------- UI (drawers / effects / filters / feed) ----------------
  const drawerFilters = document.getElementById("drawerFilters");
  const drawerLegend  = document.getElementById("drawerLegend");
  const filtersBtn    = document.getElementById("filtersBtn");
  const legendBtn     = document.getElementById("legendBtn");
  const effectsToggle = document.getElementById("effectsToggle");
  const onlyActiveEl  = document.getElementById("onlyActive");
  const showRoutesEl  = document.getElementById("showRoutes");
  const feedList      = document.getElementById("feedList");
  const feedClear     = document.getElementById("feedClear");

  function openDrawer(el){
    if(!el) return;
    el.classList.add("open");
  }
  function closeDrawer(el){
    if(!el) return;
    el.classList.remove("open");
  }
  function closeAllDrawers(){
    closeDrawer(drawerFilters);
    closeDrawer(drawerLegend);
  }

  if(filtersBtn) filtersBtn.addEventListener("click", ()=>{
    const open = drawerFilters && drawerFilters.classList.contains("open");
    closeAllDrawers();
    if(!open) openDrawer(drawerFilters);
  });
  if(legendBtn) legendBtn.addEventListener("click", ()=>{
    const open = drawerLegend && drawerLegend.classList.contains("open");
    closeAllDrawers();
    if(!open) openDrawer(drawerLegend);
  });

  document.querySelectorAll("[data-close]").forEach((btn)=>{
    btn.addEventListener("click", ()=>{
      const id = btn.getAttribute("data-close");
      const el = document.getElementById(id);
      closeDrawer(el);
    });
  });

  // Close drawers on Esc
  document.addEventListener("keydown", (e)=>{
    if(e.key==="Escape"){
      closeAllDrawers();
      if(measureMode) setMeasureMode(false);
    }
  });

  // Effects toggle (persist)
  const effectsKey="pvls_map_effects";
  const savedEff = localStorage.getItem(effectsKey);
  const effectsOn = (savedEff===null) ? true : (savedEff==="1");
  if(!effectsOn) document.body.classList.add("effects-off");
  if(effectsToggle) effectsToggle.checked = effectsOn;
  if(effectsToggle){
    effectsToggle.addEventListener("change", ()=>{
      const on = !!effectsToggle.checked;
      localStorage.setItem(effectsKey, on ? "1":"0");
      document.body.classList.toggle("effects-off", !on);
      refreshIcons();
    });
  }

  // Filters (persist)
  const fltKey="pvls_map_filters";
  const defaultFilters = ["shahed","gerbera","recon","fpv","cruise","ballistic","aircraft","unknown"];
  let filters = new Set(defaultFilters);
  try{
    const raw = localStorage.getItem(fltKey);
    if(raw){
      const arr = JSON.parse(raw);
      if(Array.isArray(arr) && arr.length) filters = new Set(arr);
    }
  }catch(_){}

  // set checkbox state
  document.querySelectorAll("input.flt").forEach((cb)=>{
    cb.checked = filters.has(cb.value);
    cb.addEventListener("change", ()=>{
      if(cb.checked) filters.add(cb.value); else filters.delete(cb.value);
      localStorage.setItem(fltKey, JSON.stringify(Array.from(filters)));
      applyFilters();
    });
  });

  const onlyActiveKey="pvls_map_onlyActive";
  const showRoutesKey="pvls_map_showRoutes";

  const onlyActiveSaved = localStorage.getItem(onlyActiveKey);
  const showRoutesSaved = localStorage.getItem(showRoutesKey);
  if(onlyActiveEl) onlyActiveEl.checked = (onlyActiveSaved===null) ? true : (onlyActiveSaved==="1");
  if(showRoutesEl) showRoutesEl.checked = (showRoutesSaved===null) ? true : (showRoutesSaved==="1");

  if(onlyActiveEl){
    onlyActiveEl.addEventListener("change", ()=>{
      localStorage.setItem(onlyActiveKey, onlyActiveEl.checked ? "1":"0");
      applyFilters();
    });
  }
  if(showRoutesEl){
    showRoutesEl.addEventListener("change", ()=>{
      localStorage.setItem(showRoutesKey, showRoutesEl.checked ? "1":"0");
      applyFilters();
    });
  }

  // Feed
  const FEED_MAX = 20;
  let feed = []; // {id, ts, title, sub, latlng?}
  function pushFeed(title, sub="", latlng=null, targetId=null){
    const item = { key: `${Date.now()}_${Math.random().toString(16).slice(2)}`, ts: new Date(), title, sub, latlng, targetId };
    feed.unshift(item);
    if(feed.length>FEED_MAX) feed.length=FEED_MAX;
    renderFeed();
  }
  function renderFeed(){
    if(!feedList) return;
    feedList.innerHTML = "";
    for(const ev of feed){
      const el=document.createElement("div");
      el.className="feed-item";
      el.dataset.key=ev.key;
      el.innerHTML = `<div class="t">${escapeHtml(ev.title)}</div><span class="s">${escapeHtml(ev.sub||formatClock(ev.ts))}</span>`;
      el.addEventListener("click", ()=>{
        try{
          if(ev.latlng){
            map.flyTo(ev.latlng, Math.max(map.getZoom(), 12), {duration:0.6});
          }
          if(ev.targetId && markers.has(ev.targetId)){
            const m = markers.get(ev.targetId).marker;
            try{ m.openTooltip(); }catch(_){}
          }
        }catch(_){}
      });
      feedList.appendChild(el);
    }
  }
  if(feedClear){
    feedClear.addEventListener("click", ()=>{
      feed=[]; renderFeed();
    });
  }

  // ---------------- Modal ----------------
  const infoBtn=document.getElementById("infoBtn");
  const modalBack=document.getElementById("modalBack");
  const closeModal=document.getElementById("closeModal");
  function showModal(on){
    if(!modalBack) return;
    modalBack.style.display = on ? "flex" : "none";
  }
  if(infoBtn) infoBtn.addEventListener("click", ()=>showModal(true));
  if(closeModal) closeModal.addEventListener("click", ()=>showModal(false));
  if(modalBack) modalBack.addEventListener("click", (e)=>{ if(e.target===modalBack) showModal(false); });

  // ---------------- Presence ping (online counter) ----------------
  async function postPresence(){
    try{
      const r=await fetch("/api/presence",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sid:getSid()})});
      if(!r.ok) throw new Error("bad");
      const data=await r.json();
      const dot=document.getElementById("onlineDot");
      const cnt=document.getElementById("onlineCount");
      if(dot) dot.style.background = "#33ff99";
      if(cnt) cnt.textContent = `${data.count || 1} глядачів`;
    }catch(_){
      const dot=document.getElementById("onlineDot");
      const cnt=document.getElementById("onlineCount");
      if(dot) dot.style.background = "#ff3b5b";
      if(cnt) cnt.textContent = "нема даних";
    }
  }
  postPresence();
  setInterval(postPresence, 20000);

  // ---------------- Targets render ----------------
  function getProxFlags(latlng){
    const d = haversineMetersLatLng(latlng, {lat:CENTER[0], lng:CENTER[1]});
    return {
      dist: d,
      near: d<=CITY_ALERT_M && d> CITY_DANGER_M,
      danger: d<=CITY_DANGER_M
    };
  }

  function makeTooltip(t){
    const title = escapeHtml(t.title || t.name || "");
    const note = escapeHtml(t.note || "");
    const sp   = (t.speed_kmh ? ` • ${escapeHtml(String(t.speed_kmh))} км/год` : "");
    return `<b>${title || "Ціль"}</b>${sp}${note ? `<br><span style="opacity:.85">${note}</span>`:""}`;
  }

  function ensureLayers(o, shouldShow, showRoutes){
    // Marker
    if(shouldShow){
      if(!targetsLayer.hasLayer(o.marker)) targetsLayer.addLayer(o.marker);
    }else{
      if(targetsLayer.hasLayer(o.marker)) targetsLayer.removeLayer(o.marker);
    }
    // Line/trajectory
    const showL = shouldShow && showRoutes;
    if(showL){
      if(!linesLayer.hasLayer(o.line)) linesLayer.addLayer(o.line);
      if(o.trajLine && !linesLayer.hasLayer(o.trajLine)) linesLayer.addLayer(o.trajLine);
    }else{
      if(linesLayer.hasLayer(o.line)) linesLayer.removeLayer(o.line);
      if(o.trajLine && linesLayer.hasLayer(o.trajLine)) linesLayer.removeLayer(o.trajLine);
    }
  }

  function applyFilters(){
    const onlyActive = onlyActiveEl ? !!onlyActiveEl.checked : true;
    const showRoutes = showRoutesEl ? !!showRoutesEl.checked : true;

    for(const [id,o] of markers.entries()){
      const okType = filters.has(o.type);
      const okActive = onlyActive ? !!o.active : true;
      ensureLayers(o, okType && okActive, showRoutes);
    }
  }

  function upsert(t, isNew=false){
    const id = String(t.id ?? t._id ?? t.key ?? Math.random());
    const lat = (typeof t.lat==="number" ? t.lat : t.latitude);
    const lng = (typeof t.lng==="number" ? t.lng : t.lon ?? t.longitude);
    if(typeof lat!=="number" || typeof lng!=="number") return;

    const dirRaw = (t.direction ?? t.dir ?? t.course ?? t.bearing ?? t.azimuth ?? 0);
const dirNum = (typeof dirRaw==="number" ? dirRaw : parseFloat(dirRaw));
const dir = (Number.isFinite(dirNum) ? dirNum : 0);
    const active = (t.active===undefined ? true : !!t.active);

    const base = {lat, lng};
    const dest = (typeof t.dest_lat==="number" && typeof t.dest_lng==="number") ? {lat:t.dest_lat, lng:t.dest_lng} : null;

    if(markers.has(id)){
      const o = markers.get(id);
      o.type = t.type || o.type || "unknown";
      o.note = t.note || o.note || "";
      o.dir = normDeg(dir);
      o.active = active;
      o.speed_kmh = t.speed_kmh || o.speed_kmh || 0;
      o.dest = dest;
      // do not snap base backwards if animation moved forward: keep the newest known point as "base floor"
      o.base = {lat, lng};

      // update icon (no pop)
      const prox = getProxFlags(o.base);
      const effectsOn = !document.body.classList.contains("effects-off");
      o.marker.setIcon(makeIconAnimated(o.type, o.dir, true, {
        pop:false,
        pulse: effectsOn && o.active,
        near: prox.near,
        danger: prox.danger
      }));
      o.marker.setTooltipContent(makeTooltip(t));
      setTimeout(()=>applyActiveClass(o.marker, o.active), 0);

    }else{
      const prox = getProxFlags(base);
      const effectsOn = !document.body.classList.contains("effects-off");
      const icon = makeIconAnimated(t.type || "unknown", normDeg(dir), true, {
        pop: effectsOn && isNew,
        pulse: effectsOn && active,
        near: prox.near,
        danger: prox.danger
      });

      const m = L.marker([lat,lng], {icon}).addTo(targetsLayer);
      setTimeout(()=>applyActiveClass(m, active), 0);
      m.bindTooltip(makeTooltip(t), {direction:"top", offset:[0,-10], opacity:0.95});

      const line = L.polyline(arrowPolyline({lat, lng}, normDeg(dir)), {
        color: "#ffffff",
        weight: 2,
        opacity: 0.55
      }).addTo(linesLayer);

      // optional trajectory line
      let trajLine = null;
      if(dest){
        trajLine = L.polyline([{lat, lng}, dest], {color:"#ff3b5b", weight:2, opacity:0.35, dashArray:"6 8"}).addTo(linesLayer);
      }

      markers.set(id, {
        marker:m,
        line,
        trajLine,
        base,
        dest,
        dir:normDeg(dir),
        phase:0,
        type: t.type || "unknown",
        note: t.note || "",
        created_at: t.created_at || "",
        speed_kmh: t.speed_kmh || 0,
        last_anim_ms: Date.now(),
        active,
        prox: null
      });

      // feed event
      const title = `Додано: ${typeUa(t.type || "unknown")}`;
      const sub = prox.danger ? "дуже близько до Павлограда" : (prox.near ? "наближається до Павлограда" : "");
      pushFeed(title, sub || "нова ціль на мапі", [lat,lng], id);
    }
  }

  function typeUa(type){
    const map = {
      shahed: "Шахед",
      gerbera: "Гербера",
      fpv: "FPV-дрон",
      cruise: "Крилата ракета",
      ballistic: "Балістична ракета",
      aircraft: "Літак",
      recon: "Розвід-дрон",
      unknown: "Невідомо"
    };
    return map[type] || "Невідомо";
  }

  function sync(list){
    const alive = new Set();
    for(const t of (list||[])){
      const id = String(t.id ?? t._id ?? t.key ?? "");
      if(!id) continue;
      alive.add(id);
      const isNew = !markers.has(id);
      upsert(t, isNew);
    }

    // remove missing
    for(const [id,o] of markers.entries()){
      if(!alive.has(id)){
        try{ targetsLayer.removeLayer(o.marker); }catch(_){}
        try{ linesLayer.removeLayer(o.line); }catch(_){}
        try{ if(o.trajLine) linesLayer.removeLayer(o.trajLine); }catch(_){}
        markers.delete(id);
        pushFeed("Ціль знято", "прибрано з мапи");
      }
    }

    const n = (list||[]).length;
    const c1 = document.getElementById("count");
    if(c1) c1.textContent = `Цілі: ${n}`;

    applyFilters();
  }

  async function tick(){
    try{
      const data = await apiGet("/api/targets");
      const u = document.getElementById("updated");
      if(u){
        const ts = data.updated_at || "";
        u.textContent = ts ? `Оновлено: ${formatTs(ts)}` : "Оновлено: —";
      }
      sync(data.targets || []);

      // точки запуску (показуємо тільки активні)
      try{
        const ls=await apiGet("/api/launchsites");
        launchLayer.clearLayers();
        for(const s of (ls.sites||[])){
          if(!s || !s.active) continue;
          if(typeof s.lat!=="number" || typeof s.lng!=="number") continue;
          const m=L.circleMarker([s.lat,s.lng],{radius:6,weight:2,opacity:0.9,fillOpacity:0.35,color:"#ff3b5b"}).addTo(launchLayer);
          m.bindTooltip(`Пуск: ${escapeHtml(s.name||"")}`,{direction:"top",offset:[0,-6]});
        }
      }catch(_){ /* ignore */ }

    }catch(_){
      const u=document.getElementById("updated");
      if(u) u.textContent="Оновлено: помилка";
    }
  }

  // Motion: drift forward by speed (km/h) from last update
  let lastProxCheck = 0;
  function animate(){
    const now=Date.now();
    for(const [id,o] of markers.entries()){
      const speedKmh = parseFloat(o.speed_kmh||0) || 0;
      const mps = (speedKmh>0 ? speedKmh*1000/3600 : 0);
      let base = o.base;
      let pos = base;

      // integrate in small steps so it never snaps back on refresh
      const last = o.last_anim_ms || now;
      const dt = Math.min(2.0, Math.max(0, (now-last)/1000.0));
      o.last_anim_ms = now;

      if(mps>0 && dt>0){
        const step = mps*dt;
        if(o.dest){
          const remaining = haversineMetersLatLng(base, o.dest);
          if(remaining <= step){
            base = o.dest;
          }else{
            const br = bearingDeg(base, o.dest);
            base = offset(base, br, step);
          }
        }else{
          base = offset(base, o.dir, step); // no distance limit
        }
        o.base = base;
        pos = base;
      }

      // small wobble for drones only
      if(o.type==="shahed" || o.type==="gerbera" || o.type==="recon" || o.type==="fpv"){
        o.phase=(o.phase||0)+0.04;
        const wobble=Math.sin(o.phase)*10;
        pos = offset(pos,(o.dir+90)%360,wobble);
      }

      try{
        o.marker.setLatLng(pos);
        o.line.setLatLngs(arrowPolyline(pos,o.dir));
        if(o.trajLine && o.dest){
          o.trajLine.setLatLngs([pos, o.dest]);
        }
      }catch(_){}
    }

    // proximity check (1/sec)
    if(now - lastProxCheck > 1000){
      lastProxCheck = now;
      for(const [id,o] of markers.entries()){
        const prox = getProxFlags(o.base);
        const level = prox.danger ? "danger" : (prox.near ? "near" : "ok");
        if(o.prox !== level){
          o.prox = level;

          // update icon flags (keep pulse)
          const effectsOn = !document.body.classList.contains("effects-off");
          o.marker.setIcon(makeIconAnimated(o.type, o.dir, true, {
            pop:false,
            pulse: effectsOn && o.active,
            near: prox.near,
            danger: prox.danger
          }));

          if(level==="near") pushFeed("Наближається до Павлограда", `${typeUa(o.type)} • ~${fmtDist(prox.dist)}`, [o.base.lat, o.base.lng], id);
          if(level==="danger") pushFeed("Дуже близько до Павлограда", `${typeUa(o.type)} • ~${fmtDist(prox.dist)}`, [o.base.lat, o.base.lng], id);
        }
      }
    }

    requestAnimationFrame(animate);
  }

  // ---------------- Measure tool ----------------
  const measureHud  = document.getElementById("measureHud");
  const measureText = document.getElementById("measureText");
  const measureUndo = document.getElementById("measureUndo");
  const measureClear= document.getElementById("measureClear");
  const measureDone = document.getElementById("measureDone");

  let measureMode=false;
  let measurePts=[];
  let measureLine=null;
  let measureMarkers=[];
  let measureLabel=null;

  function setMeasureMode(on){
    measureMode = !!on;
    if(measureBtn){
      measureBtn.classList.toggle("active", measureMode);
      measureBtn.textContent = measureMode ? "✕" : "📏";
    }
    if(measureHud){
      measureHud.classList.toggle("show", measureMode);
      measureHud.setAttribute("aria-hidden", measureMode ? "false":"true");
    }
    if(!measureMode){
      clearMeasure();
      closeAllDrawers();
    }else{
      closeAllDrawers();
      updateMeasureText();
      pushFeed("Лінійка увімкнена", "став точки на мапі");
    }
  }

  const measureBtn=document.getElementById("measureBtn");
  if(measureBtn){
    measureBtn.addEventListener("click", ()=>{
      setMeasureMode(!measureMode);
    });
  }

  function updateMeasureText(){
    if(!measureText) return;
    if(measurePts.length===0) measureText.textContent="Торкнись мапи, щоб поставити першу точку";
    else if(measurePts.length===1) measureText.textContent="Постав ще одну точку, щоб порахувати відстань";
    else measureText.textContent=`Відстань: ${fmtDist(totalDistance(measurePts))}`;
  }

  function clearMeasure(){
    measurePts=[];
    if(measureLine){ try{ map.removeLayer(measureLine);}catch(_){} measureLine=null; }
    if(measureLabel){ try{ map.removeLayer(measureLabel);}catch(_){} measureLabel=null; }
    for(const mm of measureMarkers){ try{ map.removeLayer(mm);}catch(_){} }
    measureMarkers=[];
    updateMeasureText();
  }

  function rebuildMeasure(){
    if(measureLine){ try{ map.removeLayer(measureLine);}catch(_){} }
    if(measureLabel){ try{ map.removeLayer(measureLabel);}catch(_){} }

    if(measurePts.length>=2){
      measureLine = L.polyline(measurePts, {color:"#ff3b5b", weight:3, opacity:0.85}).addTo(map);
      const dist = totalDistance(measurePts);
      const last = measurePts[measurePts.length-1];
      measureLabel = L.marker(last, {
        icon: L.divIcon({
          className:"pvls-divicon",
          html:`<div style="padding:6px 10px;border-radius:14px;border:1px solid rgba(255,255,255,.18);background:rgba(18,22,36,.55);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);font-weight:950;font-size:12px;color:rgba(255,255,255,.92)">${escapeHtml(fmtDist(dist))}</div>`,
          iconAnchor:[10,28]
        })
      }).addTo(map);
    }else if(measurePts.length===1){
      // just a marker
    }
    updateMeasureText();
  }

  function addMeasurePoint(latlng){
    measurePts.push(latlng);
    const mm = L.circleMarker(latlng, {radius:6, weight:2, color:"#ffffff", fillColor:"#ff3b5b", fillOpacity:0.85, opacity:0.9}).addTo(map);
    measureMarkers.push(mm);
    rebuildMeasure();
  }

  if(measureUndo){
    measureUndo.addEventListener("click", ()=>{
      if(measurePts.length===0) return;
      measurePts.pop();
      const mm=measureMarkers.pop();
      if(mm){ try{ map.removeLayer(mm);}catch(_){} }
      rebuildMeasure();
    });
  }
  if(measureClear){
    measureClear.addEventListener("click", ()=>clearMeasure());
  }
  if(measureDone){
    measureDone.addEventListener("click", ()=>setMeasureMode(false));
  }

  map.on("click", (e)=>{
    if(!measureMode) return;
    addMeasurePoint(e.latlng);
  });
  map.on("dblclick", (e)=>{
    if(!measureMode) return;
    // finish on double click
    setMeasureMode(false);
  });

  // ---------------- Start loops ----------------
  tick();
  setInterval(tick, 15000);
  requestAnimationFrame(animate);

  // ---------------- helpers ----------------
  function formatClock(d){
    const hh = String(d.getHours()).padStart(2,"0");
    const mm = String(d.getMinutes()).padStart(2,"0");
    return `${hh}:${mm}`;
  }

  function fmtDist(m){
    if(!isFinite(m)) return "—";
    if(m<1000) return `${Math.round(m)} м`;
    const km = m/1000;
    if(km<10) return `${km.toFixed(1)} км`;
    return `${Math.round(km)} км`;
  }

  function totalDistance(pts){
    let sum=0;
    for(let i=1;i<pts.length;i++){
      sum += haversineMetersLatLng(pts[i-1], pts[i]);
    }
    return sum;
  }

  function haversineMetersLatLng(a,b){
    const A = {lat: (a.lat!==undefined ? a.lat : a[0]), lng:(a.lng!==undefined ? a.lng : a[1])};
    const B = {lat: (b.lat!==undefined ? b.lat : b[0]), lng:(b.lng!==undefined ? b.lng : b[1])};
    const R=6371000;
    const dLat=(B.lat-A.lat)*Math.PI/180;
    const dLon=(B.lng-A.lng)*Math.PI/180;
    const la1=A.lat*Math.PI/180;
    const la2=B.lat*Math.PI/180;
    const x=Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.min(1,Math.sqrt(x)));
  }

  function bearingDeg(a,b){
    const lat1=a.lat*Math.PI/180, lon1=a.lng*Math.PI/180;
    const lat2=b.lat*Math.PI/180, lon2=b.lng*Math.PI/180;
    const y = Math.sin(lon2-lon1)*Math.cos(lat2);
    const x = Math.cos(lat1)*Math.sin(lat2) - Math.sin(lat1)*Math.cos(lat2)*Math.cos(lon2-lon1);
    return (Math.atan2(y,x)*180/Math.PI + 360) % 360;
  }

  function offset(p, bearing, meters){
    const R=6371000;
    const br = bearing*Math.PI/180;
    const lat1=p.lat*Math.PI/180;
    const lon1=p.lng*Math.PI/180;
    const lat2 = Math.asin(Math.sin(lat1)*Math.cos(meters/R) + Math.cos(lat1)*Math.sin(meters/R)*Math.cos(br));
    const lon2 = lon1 + Math.atan2(Math.sin(br)*Math.sin(meters/R)*Math.cos(lat1), Math.cos(meters/R)-Math.sin(lat1)*Math.sin(lat2));
    return {lat: lat2*180/Math.PI, lng: lon2*180/Math.PI};
  }

  function escapeHtml(s){
    return String(s||"").replace(/[&<>"']/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  }
  function formatTs(ts){
    // supports ISO strings
    try{
      const d = new Date(ts);
      if(isNaN(d.getTime())) return String(ts);
      const dd = String(d.getDate()).padStart(2,"0");
      const mm = String(d.getMonth()+1).padStart(2,"0");
      const hh = String(d.getHours()).padStart(2,"0");
      const mi = String(d.getMinutes()).padStart(2,"0");
      return `${dd}.${mm} ${hh}:${mi}`;
    }catch(_){
      return String(ts||"");
    }
  }
  function getSid(){
    const k="pvls_map_sid";
    let v = localStorage.getItem(k);
    if(!v){
      v = Math.random().toString(16).slice(2) + Date.now().toString(16);
      localStorage.setItem(k, v);
    }
    return v;
  }

});