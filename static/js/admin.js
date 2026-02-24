document.addEventListener("DOMContentLoaded", ()=>{
  const CENTER = [48.5231, 35.8707];
  const map = L.map('map', {zoomControl:true}).setView(CENTER, 11);
  setTimeout(()=>{ try{ map.invalidateSize(); map.setView(CENTER, 11);}catch(_){ } }, 250);

  const baseOSM = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, attribution:'&copy; OpenStreetMap'});
  const baseDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {maxZoom:19, attribution:'&copy; OpenStreetMap & CARTO'});
  baseOSM.addTo(map);
  setIconTheme("dark");

  L.control.layers({"Схема": baseOSM, "Темна": baseDark}, {}, {collapsed:true}).addTo(map);
  map.on("baselayerchange", (e)=>{
    setIconTheme(e.name === "Темна" ? "light" : "dark");
    reload();
  });

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
  const elDirVal=document.getElementById("dirVal");
  const elNote=document.getElementById("note");
  const elList=document.getElementById("list");
  const btnDelete=document.getElementById("delete");

  function setDir(v){
    let n=parseInt(v,10); if(Number.isNaN(n)) n=0;
    n=((n%360)+360)%360;
    elDir.value=n; elDirVal.textContent=`${n}°`;
  }
  elDir.addEventListener("input", ()=>setDir(elDir.value));
  document.getElementById("minus5").addEventListener("click", ()=>setDir(parseInt(elDir.value,10)-5));
  document.getElementById("plus5").addEventListener("click", ()=>setDir(parseInt(elDir.value,10)+5));
  document.getElementById("minus15").addEventListener("click", ()=>setDir(parseInt(elDir.value,10)-15));
  document.getElementById("plus15").addEventListener("click", ()=>setDir(parseInt(elDir.value,10)+15));
  document.querySelectorAll("[data-dir]").forEach(b=> b.addEventListener("click", ()=>setDir(b.getAttribute("data-dir"))));

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
    elLat.value=""; elLng.value=""; elNote.value="";
    setDir(0);
  }
  function fillForm(t){
    selectedId=t.id; btnDelete.style.display="inline-block";
    elType.value=t.type;
    elLat.value=Number(t.lat).toFixed(5);
    elLng.value=Number(t.lng).toFixed(5);
    elNote.value=t.note||"";
    setDir(t.direction||0);
    map.setView([t.lat,t.lng], Math.max(map.getZoom(), 12));
  }

  function escapeHtml(s){ return (s||"").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m])); }

  function itemRow(t){
    const note=(t.note||"").trim();
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML=`<div class="meta">
      <div class="t">${t.type.toUpperCase()} <span style="color:#94a3b8;font-weight:600">• ${t.direction}°</span></div>
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
      m.on("dragend", (e)=>{ if(selectedId===t.id){ const p=e.target.getLatLng(); elLat.value=p.lat.toFixed(5); elLng.value=p.lng.toFixed(5);} });
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

  async function reload(){
    const data=await apiGet("/api/targets");
    const list=(data.targets||[]);
    elList.innerHTML="";
    list.slice().reverse().forEach(t=> elList.appendChild(itemRow(t)));
    syncLive(list);
  }

  document.getElementById("save").addEventListener("click", async ()=>{
    const ll=latLngFromInputs();
    if(!ll){alert("Ткни на мапі або введи координати"); return;}
    const payload={type:elType.value, lat:ll.lat, lng:ll.lng, direction:parseInt(elDir.value,10)||0, note:elNote.value||""};
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
});