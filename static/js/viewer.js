document.addEventListener("DOMContentLoaded", ()=>{
  const CENTER = [48.5231, 35.8707];

  const map = L.map('map', { zoomControl:true }).setView(CENTER, 11);

  const baseLight = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, attribution:'&copy; OpenStreetMap'});
  const baseDark  = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {maxZoom:19, attribution:'&copy; OpenStreetMap & CARTO'});

  baseLight.addTo(map);
  setIconTheme("dark"); // light map -> dark icons
  const wm = document.getElementById("wmLayer");
  if (wm) wm.dataset.theme = "dark";
  setWatermarkTheme("dark"); // light map -> dark watermark

  const layers = L.control.layers({"Схема": baseLight, "Темна": baseDark}, {}, {collapsed:true});
  layers.addTo(map);

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
    }catch(_){}
  }
  presencePing();
  setInterval(presencePing, 15000);

  const markers = new Map(); // id -> {marker,line,base,dir,phase,prog,type,note,created_at}

  function escapeHtml(s){return (s||"").replace(/[&<>"']/g,m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));}

  function popupHtml(t){
    const name=TYPE_UA[t.type]||"Ціль";
    const note=(t.note||"").trim();
    return `<div style="min-width:200px">
      <div style="font-weight:1000;margin-bottom:6px">${name}</div>
      <div style="color:rgba(255,255,255,.70);font-size:12px;font-weight:800">Напрямок: ${t.direction}°</div>
      ${note? `<div style="margin-top:8px;font-weight:800">${escapeHtml(note)}</div>`:""}
      <div style="color:rgba(255,255,255,.55);font-size:11px;font-weight:800;margin-top:10px">${escapeHtml(t.created_at||"")}</div>
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
    const icon=makeIcon(t.type);

    if(markers.has(t.id)){
      const o=markers.get(t.id);
      o.base=base; o.dir=dir; o.type=t.type; o.note=t.note; o.created_at=t.created_at;
      o.marker.setIcon(icon);
      o.marker.setRotationAngle(dir);
      o.marker.setPopupContent(popupHtml(t));
    }else{
      const m=L.marker(base,{icon,rotationAngle:dir,rotationOrigin:"center center"}).addTo(map);
      const line=L.polyline(arrowPolyline(base,dir),{weight:4,opacity:0.92,color:"#ff3b5b"}).addTo(map);
      m.bindPopup(popupHtml(t));
      markers.set(t.id,{marker:m,line,base,dir,phase:Math.random()*Math.PI*2,prog:Math.random()*700,type:t.type,note:t.note,created_at:t.created_at});
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
      if(u) u.textContent=`Оновлено: ${data.updated_at}`;
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

  // Premium motion: subtle forward drift (visual only)
  let last=performance.now();
  function animate(){
    const now=performance.now();
    const dt=(now-last)/1000.0;
    last=now;
    for(const o of markers.values()){
      o.prog=(o.prog||0)+dt*55;   // m/s
      if(o.prog>1200) o.prog=0;
      o.phase=(o.phase||0)+dt*1.25;
      const pos=offset(o.base,o.dir,o.prog);
      const wobble=Math.sin(o.phase)*16;
      const pos2=offset(pos,(o.dir+90)%360,wobble);
      o.marker.setLatLng(pos2);
      o.line.setLatLngs(arrowPolyline(pos2,o.dir));
    }
    requestAnimationFrame(animate);
  }

  tick();
  setInterval(tick, 15000);
  requestAnimationFrame(animate);
});