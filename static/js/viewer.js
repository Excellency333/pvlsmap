// viewer.js — fixed: light popup + nice time + unlimited flight + mobile friendly
document.addEventListener("DOMContentLoaded", ()=>{
  const markers = new Map();
 
  const CENTER = [48.5231, 35.8707];

  const map = L.map('map', { zoomControl:true }).setView(CENTER, 11);

  const baseLight = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, attribution:'&copy; OpenStreetMap'});
  const baseDark  = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {maxZoom:19, attribution:'&copy; OpenStreetMap & CARTO'});

  // helpers from common.js are expected: apiGet, makeIcon, setIconTheme, dirToShort, normDeg, arrowPolyline

  function setWatermarkTheme(theme){
    const wm=document.getElementById("wmLayer");
    if(!wm) return;
    const img = (theme === "light") ? '/static/img/watermark_light.png' : '/static/img/watermark_dark.png';
    wm.style.backgroundImage = `url("${img}")`;
    wm.style.opacity = (theme === "light") ? "0.20" : "0.26";
  }

  function applyTheme(theme){
    const th = (theme==="dark") ? "dark" : "light";
    localStorage.setItem("pvls_map_theme", th);

    if(th==="dark"){
      if(map.hasLayer(baseLight)) map.removeLayer(baseLight);
      if(!map.hasLayer(baseDark)) baseDark.addTo(map);
      setIconTheme("light");
      setWatermarkTheme("light");
      document.body?.setAttribute("data-theme","dark");
      const btn=document.getElementById("themeBtn"); if(btn) btn.textContent="☀";
    }else{
      if(map.hasLayer(baseDark)) map.removeLayer(baseDark);
      if(!map.hasLayer(baseLight)) baseLight.addTo(map);
      setIconTheme("dark");
      setWatermarkTheme("dark");
      document.body?.setAttribute("data-theme","light");
      const btn=document.getElementById("themeBtn"); if(btn) btn.textContent="☾";
    }
    refreshIcons();
  }

  const themeBtn=document.getElementById("themeBtn");
  themeBtn?.addEventListener("click", ()=>{
    const cur=localStorage.getItem("pvls_map_theme")||"light";
    applyTheme(cur==="light" ? "dark" : "light");
  });
  applyTheme(localStorage.getItem("pvls_map_theme")||"light");

  const layers = L.control.layers({"Світла": baseLight, "Темна": baseDark}, {}, {collapsed:true});
  layers.addTo(map);

  setTimeout(()=>{ try{ map.invalidateSize(); map.setView(CENTER, 11); }catch(_){ } }, 250);

  map.on("baselayerchange", (e)=>{
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
      if(!r.ok) throw new Error("presence");
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

  function fmtTime(ts){
    const d = new Date(ts);
    if(Number.isNaN(d.getTime())) return "";
    const dd = String(d.getDate()).padStart(2,"0");
    const mm = String(d.getMonth()+1).padStart(2,"0");
    const hh = String(d.getHours()).padStart(2,"0");
    const mi = String(d.getMinutes()).padStart(2,"0");
    const ss = String(d.getSeconds()).padStart(2,"0");
    return `${dd}.${mm} ${hh}:${mi}:${ss}`;
  }

  function popupHtml(t){
    const name=TYPE_UA[t.type]||"Ціль";
    const note=(t.note||"").trim();
    const sp = (typeof t.speed_kmh === "number") ? t.speed_kmh : (parseFloat(t.speed_kmh||0)||0);
    const added = t.created_at ? fmtTime(t.created_at) : "";
    return `<div class="pvls-popup">
      <div class="pvls-popup__title">${escapeHtml(name)}</div>
      <div class="pvls-popup__row"><b>Напрямок:</b> ${escapeHtml(dirToShort(t.direction||0))} • ${escapeHtml(String(normDeg(t.direction||0)))}°</div>
      <div class="pvls-popup__row"><b>Швидкість:</b> ${escapeHtml(String(sp))} км/год</div>
      ${note? `<div class="pvls-popup__note">${escapeHtml(note)}</div>`:""}
      ${added? `<div class="pvls-popup__time">Додано: ${escapeHtml(added)}</div>`:""}
    </div>`;
  }

  function offset(latlng, deg, meters){
    const rad=deg*Math.PI/180;
    const dLat=(meters*Math.cos(rad))/111320.0;
    const dLng=(meters*Math.sin(rad))/(111320.0*Math.cos(latlng.lat*Math.PI/180));
    return L.latLng(latlng.lat+dLat, latlng.lng+dLng);
  }

  function upsert(t){
    const base=L.latLng(t.lat,t.lng);
    const dir=parseInt(t.direction||0,10)||0;

    if(markers.has(t.id)){
      const o=markers.get(t.id);
      o.base=base; o.dir=dir; o.type=t.type; o.note=t.note; o.created_at=t.created_at;
      o.speed_kmh = (typeof t.speed_kmh === "number") ? t.speed_kmh : (parseFloat(t.speed_kmh||0)||0);
      o.updated_ms = Date.parse(t.updated_at||t.created_at)||Date.now();
      o.dest = (t.dest_lat!=null && t.dest_lng!=null) ? L.latLng(t.dest_lat, t.dest_lng) : null;
      o.anim_pos = base;
      o.last_anim_ms = Date.now();
      o.marker.setIcon(makeIcon(t.type));
      o.marker.setRotationAngle(dir);
      o.marker.setPopupContent(popupHtml(t));
    }else{
      const m=L.marker(base,{icon:makeIcon(t.type),rotationAngle:dir,rotationOrigin:"center center"}).addTo(map);
      const line=L.polyline(arrowPolyline(base,dir),{weight:4,opacity:0.92,color:"#ff3b5b"}).addTo(map);
      m.bindPopup(popupHtml(t), {closeButton:true, autoPan:true});
      markers.set(t.id,{
        marker:m,line,base,dir,
        phase:Math.random()*Math.PI*2,
        type:t.type,note:t.note,created_at:t.created_at,
        speed_kmh:(typeof t.speed_kmh === "number") ? t.speed_kmh : (parseFloat(t.speed_kmh||0)||0),
        dest:(t.dest_lat!=null && t.dest_lng!=null) ? L.latLng(t.dest_lat, t.dest_lng) : null,
        anim_pos: base,
        last_anim_ms: Date.now(),
        updated_ms:Date.parse(t.updated_at||t.created_at)||Date.now()
      });
    }
  }

  function sync(list){
    const alive=new Set((list||[]).map(x=>x.id));
    for(const [id,o] of markers.entries()){
      if(!alive.has(id)){ map.removeLayer(o.marker); map.removeLayer(o.line); markers.delete(id); }
    }
    for(const t of (list||[])) upsert(t);

    const c=document.getElementById("count");
    if(c) c.textContent=`Цілі: ${(list||[]).length}`;
  }

  async function tick(){
    try{
      const data=await apiGet("/api/targets");
      const u=document.getElementById("updated");
      if(u) u.textContent=`Оновлено: ${fmtTime(data.updated_at||Date.now())}`;
      sync(data.targets||[]);
    }catch(_){
      const u=document.getElementById("updated");
      if(u) u.textContent="Оновлено: помилка";
    }
  }

  function refreshIcons(){
    for(const o of markers.values()){
      o.marker.setIcon(makeIcon(o.type));
    }
  }

  // ✅ Unlimited flight: removed distance cap
  function haversineMeters(a,b){
    const R=6371000;
    const toRad=(x)=>x*Math.PI/180;
    const dLat=toRad(b.lat-a.lat);
    const dLng=toRad(b.lng-a.lng);
    const s1=Math.sin(dLat/2), s2=Math.sin(dLng/2);
    const q=s1*s1 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*s2*s2;
    return 2*R*Math.asin(Math.min(1,Math.sqrt(q)));
  }

  function animate(){
    const now=Date.now();
    for(const o of markers.values()){
      const speedKmh = parseFloat(o.speed_kmh||0) || 0;
      const mps = (speedKmh>0 ? speedKmh*1000/3600 : 0);

      if(!o.anim_pos) o.anim_pos = o.base;
      if(!o.last_anim_ms) o.last_anim_ms = now;
      const dt = Math.min(1.2, Math.max(0, (now - o.last_anim_ms)/1000.0));
      o.last_anim_ms = now;

      let pos = o.anim_pos;

      if(mps>0 && dt>0){
        const step = mps*dt;
        if(o.type==="ballistic" && o.dest){
          const rem = haversineMeters(pos, o.dest);
          if(rem <= step){
            pos = o.dest;
          }else{
            // move along current direction (admin sets direction to destination)
            pos = offset(pos, o.dir, step);
          }
        }else{
          pos = offset(pos, o.dir, step);
        }
      }

      // small wobble for drones only
      if(o.type==="shahed" || o.type==="gerbera" || o.type==="recon" || o.type==="fpv"){
        o.phase=(o.phase||0)+0.04;
        const wobble=Math.sin(o.phase)*10;
        pos = offset(pos,(o.dir+90)%360,wobble);
      }

      o.anim_pos = pos;
      o.marker.setLatLng(pos);
      // for ballistic show dashed line to destination if set
      if(o.type==="ballistic" && o.dest){
        o.line.setLatLngs([pos, o.dest]);
        o.line.setStyle({dashArray:"6 8"});
      }else{
        o.line.setLatLngs(arrowPolyline(pos,o.dir));
        o.line.setStyle({dashArray:null});
      }
    }
    requestAnimationFrame(animate);
  }
  }

  tick();
  setInterval(tick, 15000);
  requestAnimationFrame(animate);
});