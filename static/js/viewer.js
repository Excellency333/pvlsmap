document.addEventListener("DOMContentLoaded", ()=>{
  const CENTER = [48.5231, 35.8707];

  // MUST exist before applyTheme()/refreshIcons() is called
  const markers = new Map(); // id -> {marker,line,base,dir,phase,prog,type,note,created_at}

  const map = L.map('map', { zoomControl:true }).setView(CENTER, 11);

  const baseLight = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, attribution:'&copy; OpenStreetMap'});
  const baseDark  = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {maxZoom:19, attribution:'&copy; OpenStreetMap & CARTO'});

  function refreshIcons(){
    for(const o of markers.values()){
      o.marker.setIcon(makeIcon(o.type, 0, false, o.active));
    }
  }

  function applyTheme(theme){
    const th = (theme==="dark") ? "dark" : "light";
    localStorage.setItem("pvls_map_theme", th);
    if(th==="dark"){
      if(map.hasLayer(baseLight)) map.removeLayer(baseLight);
      if(!map.hasLayer(baseDark)) baseDark.addTo(map);
      setIconTheme("light"); // dark map -> light icons
      const wm=document.getElementById("wmLayer"); if(wm) wm.dataset.theme="light";
      const b=document.body; if(b) b.dataset.theme="dark";
      const btn=document.getElementById("themeBtn"); if(btn) btn.textContent="☀";
    }else{
      if(map.hasLayer(baseDark)) map.removeLayer(baseDark);
      if(!map.hasLayer(baseLight)) baseLight.addTo(map);
      setIconTheme("dark"); // light map -> dark icons
      const wm=document.getElementById("wmLayer"); if(wm) wm.dataset.theme="dark";
      const b=document.body; if(b) b.dataset.theme="light";
      const btn=document.getElementById("themeBtn"); if(btn) btn.textContent="☾";
    }
    // safe now: markers exists
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

  // theme is applied below
  const wm = document.getElementById("wmLayer");
  if (wm){ wm.dataset.theme="dark"; wm.style.pointerEvents="none"; }
  setWatermarkTheme("dark"); // light map -> dark watermark

  const layers = L.control.layers({"Схема": baseLight, "Темна": baseDark}, {}, {collapsed:true});
  layers.addTo(map);

  const launchLayer = L.layerGroup().addTo(map);

  // Fix initial sizing (prevents "world view" bug on first render)
  setTimeout(()=>{ try{ map.invalidateSize(); map.setView(CENTER, 11); }catch(_){ } }, 250);

  map.on("baselayerchange", (e)=>{
    // dark basemap -> light icons; light basemap -> dark icons
    const iconTheme = (e.name === "Темна" ? "light" : "dark");
    setIconTheme(iconTheme);
    setWatermarkTheme(iconTheme);
    refreshIcons();
  });

  const TYPE_UA = {
    shahed: "Шахед",
    gerbera: "Гербера",
    fpv: "FPV-дрон",
    cruise: "Крилата ракета",
    ballistic: "Балістична ракета",
    aircraft: "Літак",
    recon: "Розвід-дрон",
    unknown: "Невідомо"
  };

  function setWatermarkTheme(theme){
    const wm=document.getElementById("wmLayer");
    if(!wm) return;
    const img = (theme === "light") ? '/static/img/watermark_light.png' : '/static/img/watermark_dark.png';
    wm.style.backgroundImage = `url("${img}")`;
    wm.style.opacity = (theme === "light") ? "0.20" : "0.26";
  }

  // Modal
  const back = document.getElementById("modalBack");
  const infoBtn = document.getElementById("infoBtn");
  const closeBtn = document.getElementById("closeModal");
  infoBtn?.addEventListener("click", ()=> back.style.display="flex");
  closeBtn?.addEventListener("click", ()=> back.style.display="none");
  back?.addEventListener("click", (e)=>{ if(e.target === back) back.style.display="none"; });

  // Online presence
  function getSid(){
    const k="pvls_map_sid";
    let sid=localStorage.getItem(k);
    if(!sid){
      sid="s"+Math.random().toString(16).slice(2)+Date.now().toString(16);
      localStorage.setItem(k,sid);
    }
    return sid;
  }
  async function presencePing(){
    try{
      const r=await fetch("/api/presence",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sid:getSid()})});
      if(!r.ok) return;
      const j=await r.json();
      const el=document.getElementById("onlineCount");
      if(el) el.textContent=String(j.online);
      const dot=document.getElementById("onlineDot");
      if(dot){ dot.classList.remove("off"); dot.classList.add("on"); }
    }catch(_){
      const dot=document.getElementById("onlineDot");
      if(dot){ dot.classList.remove("on"); dot.classList.add("off"); }
    }
  }
  presencePing();
  setInterval(presencePing, 15000);

  function escapeHtml(s){return (s||"").replace(/[&<>"']/g,m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));}

function formatTs(s){
  const ms = Date.parse(s||"");
  if(isNaN(ms)) return String(s||"");
  try{
    const d = new Date(ms);
    return d.toLocaleString('uk-UA', {timeZone:'Europe/Kyiv', hour:'2-digit', minute:'2-digit', second:'2-digit', day:'2-digit', month:'2-digit'}) ;
  }catch(_){
    return new Date(ms).toISOString();
  }
}

  function popupHtml(t){
  const name = TYPE_UA[t.type] || "Ціль";
  const note = (t.note || "").trim();
  const dir = normDeg(t.direction||0);
  const dirTxt = dirToShort(dir);
  const sp = (t.speed_kmh ?? 0);
  const created = t.created_at ? formatTs(t.created_at) : "";
  return `
    <div style="min-width:220px; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;">
      <div style="font-weight:900;font-size:14px;margin-bottom:6px;color:#111">${escapeHtml(name)}</div>
      <div style="font-size:12px;line-height:1.35;color:#222">
        <div><b>Напрямок:</b> ${escapeHtml(dirTxt)} • ${dir}°</div>
        <div style="margin-top:2px"><b>Швидкість:</b> ${escapeHtml(String(sp))} км/год</div>
        ${note ? `<div style="margin-top:6px"><b>Нотатка:</b> ${escapeHtml(note)}</div>` : ``}
        ${created ? `<div style="margin-top:8px;color:#555;font-size:11px">Додано: ${escapeHtml(created)}</div>` : ``}
      </div>
    </div>`;
}

  function offset(latlng, deg, meters){
    const rad=deg*Math.PI/180;
    const dLat=(meters*Math.cos(rad))/111320.0;
    const dLng=(meters*Math.sin(rad))/(111320.0*Math.cos(latlng.lat*Math.PI/180));
    return L.latLng(latlng.lat+dLat, latlng.lng+dLng);
  }

  function haversineMeters(a,b){
    const R=6371000;
    const lat1=a.lat*Math.PI/180, lat2=b.lat*Math.PI/180;
    const dLat=(b.lat-a.lat)*Math.PI/180;
    const dLng=(b.lng-a.lng)*Math.PI/180;
    const s=Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
    return 2*R*Math.asin(Math.min(1,Math.sqrt(s)));
  }

  function bearingDeg(a,b){
    const lat1=a.lat*Math.PI/180, lat2=b.lat*Math.PI/180;
    const dLng=(b.lng-a.lng)*Math.PI/180;
    const y=Math.sin(dLng)*Math.cos(lat2);
    const x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLng);
    const brng=Math.atan2(y,x)*180/Math.PI;
    return (brng+360)%360;
  }

  function upsert(t){
    const base=L.latLng(t.lat,t.lng);
    const dir=parseInt(t.direction||0,10)||0;
    const icon=makeIcon(t.type, 0, false, t.active);
    const serverUpdated = Date.parse(t.updated_at||t.created_at)||Date.now();
    const dest = (typeof t.dest_lat==="number" && typeof t.dest_lng==="number") ? L.latLng(t.dest_lat,t.dest_lng) : null;

    if(markers.has(t.id)){
      const o=markers.get(t.id);
      // only reset position if server actually changed this target
      if((o.server_updated_ms||0) < serverUpdated-500){
        o.base=base;
        o.last_anim_ms=Date.now();
        o.server_updated_ms=serverUpdated;
      }
      o.dir=dir;
      o.type=t.type;
      o.note=t.note;
      o.created_at=t.created_at;
      o.speed_kmh=t.speed_kmh||0;
      o.dest=dest;
      o.active = (t.active === undefined) ? true : !!t.active;
      o.marker.setIcon(icon);
      o.marker.setRotationAngle(dir);
      o.marker.setPopupContent(popupHtml(t));

      // ballistic trajectory line
      if(o.trajLine){
        if(!(o.type==="ballistic" && o.dest)){
          map.removeLayer(o.trajLine);
          o.trajLine=null;
        }
      }
      if(!o.trajLine && o.type==="ballistic" && o.dest){
        o.trajLine = L.polyline([o.base, o.dest],{weight:3,opacity:0.6,color:"#ff3b5b",dashArray:"8 10"}).addTo(map);
      }
    }else{
      const m=L.marker(base,{icon,rotationAngle:dir,rotationOrigin:"center center"}).addTo(map);
      const line=L.polyline(arrowPolyline(base,dir),{weight:4,opacity:0.92,color:"#ff3b5b"}).addTo(map);
      const trajLine = (t.type==="ballistic" && dest) ? L.polyline([base,dest],{weight:3,opacity:0.6,color:"#ff3b5b",dashArray:"8 10"}).addTo(map) : null;
      m.bindPopup(popupHtml(t));
      markers.set(t.id,{
        marker:m,
        line,
        trajLine,
        base,
        dir,
        phase:Math.random()*Math.PI*2,
        type:t.type,
        note:t.note,
        created_at:t.created_at,
        speed_kmh:t.speed_kmh||0,
        active: (t.active === undefined) ? true : !!t.active,
        dest,
        server_updated_ms:serverUpdated,
        last_anim_ms:Date.now(),
      });
    }
  }

  function sync(list){
    const alive=new Set((list||[]).map(x=>x.id));
    for(const [id,o] of markers.entries()){
      if(!alive.has(id)){ map.removeLayer(o.marker); map.removeLayer(o.line); markers.delete(id); }
    }
    for(const t of (list||[])) upsert(t);
    
const n = (list||[]).length;
const c1 = document.getElementById("count");
const c2 = document.getElementById("countTargets");
const c3 = document.getElementById("targetsCount");
if(c1) c1.textContent = `Цілі: ${n}`;
if(c2) c2.textContent = String(n);
if(c3) c3.textContent = `Цілі: ${n}`;
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
          m.bindTooltip(`Пуск: ${escapeHtml(s.name)}`,{direction:"top",offset:[0,-6]});
        }
      }catch(_){ /* ignore */ }
    }catch(_){
      const u=document.getElementById("updated");
      if(u) u.textContent="Оновлено: помилка";
    }
  }

  // Motion: drift forward by speed (km/h) from last update
  function animate(){
    const now=Date.now();
    for(const o of markers.values()){
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
          const remaining = haversineMeters(base, o.dest);
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
      o.marker.setLatLng(pos);
      o.line.setLatLngs(arrowPolyline(pos,o.dir));
      if(o.trajLine && o.dest){
        o.trajLine.setLatLngs([pos, o.dest]);
      }
    }
    requestAnimationFrame(animate);
  }

  tick();
  setInterval(tick, 15000);
  requestAnimationFrame(animate);
});
