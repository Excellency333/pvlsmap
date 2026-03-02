let ICON_THEME = "dark";

const ICONS = {
  dark: {
    shahed: "/static/icons/shahed_dark.png",
    gerbera: "/static/icons/gerbera_dark.png",
    fpv: "/static/icons/fpv_dark.png",
    cruise: "/static/icons/cruise_dark.png",
    ballistic: "/static/icons/ballistic_dark.png",
    aircraft: "/static/icons/aircraft_dark.png",
    recon: "/static/icons/recon_dark.png",
    unknown: "/static/icons/unknown_dark.png",
  },
  light: {
    shahed: "/static/icons/shahed_light.png",
    gerbera: "/static/icons/gerbera_light.png",
    fpv: "/static/icons/fpv_light.png",
    cruise: "/static/icons/cruise_light.png",
    ballistic: "/static/icons/ballistic_light.png",
    aircraft: "/static/icons/aircraft_light.png",
    recon: "/static/icons/recon_light.png",
    unknown: "/static/icons/unknown_light.png",
  }
};

function setIconTheme(theme){
  ICON_THEME = (theme === "light") ? "light" : "dark";
}

function makeRotIcon(url, deg){
  const ang = normDeg(deg);
  const html = `<div class="rot-wrap"><img class="rot-img" src="${url}" style="transform:rotate(${ang}deg)" /></div>`;
  return L.divIcon({
    html,
    className: "pvls-rot-icon",
    iconSize:[48,48],
    iconAnchor:[24,24]
  });
}

// makeIcon(type, deg?, rotate?)
function makeIcon(type, deg=0, rotate=false){
  const url = (ICONS[ICON_THEME][type] || ICONS[ICON_THEME].unknown);
  if(rotate){
    return makeRotIcon(url, deg);
  }
  return L.icon({ iconUrl: url, iconSize:[48,48], iconAnchor:[24,24] });
}

function arrowPolyline(latlng, deg, lenMeters=1200){
  const rad = deg * Math.PI / 180;
  const dLat = (lenMeters * Math.cos(rad)) / 111320.0;
  const dLng = (lenMeters * Math.sin(rad)) / (111320.0 * Math.cos(latlng.lat*Math.PI/180));
  const end = {lat: latlng.lat + dLat, lng: latlng.lng + dLng};
  return [latlng, end];
}

async function apiGet(url){
  const r = await fetch(url, {cache:"no-store"});
  if(!r.ok) throw new Error("HTTP " + r.status);
  return await r.json();
}
async function apiPost(url, body){
  const r = await fetch(url, {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body)});
  if(!r.ok) throw new Error("HTTP " + r.status);
  return await r.json();
}
async function apiDelete(url){
  const r = await fetch(url, {method:"DELETE"});
  if(!r.ok) throw new Error("HTTP " + r.status);
  return await r.json();
}

function normDeg(deg){
  let d = parseInt(deg||0,10);
  if(!isFinite(d)) d=0;
  d = ((d%360)+360)%360;
  return d;
}
function dirToShort(deg){
  const d = normDeg(deg);
  // 0° = Пн (вгору), 90° = Сх (праворуч), 180° = Пд (вниз), 270° = Зх (ліворуч)
  const names = ["Пн","ПнСх","Сх","ПдСх","Пд","ПдЗх","Зх","ПнЗх"];
  const idx = Math.round(d/45) % 8;
  return names[idx];
}
function dirToText(deg){
  const d = normDeg(deg);
  const names = ["Північ","Північний схід","Схід","Південний схід","Південь","Південний захід","Захід","Північний захід"];
  const idx = Math.round(d/45) % 8;
  return names[idx];
}

// Viewer: animated divIcon with optional pop/pulse/near classes
function makeIconAnimated(type, deg=0, rotate=false, opts={}){
  const url = (ICONS[ICON_THEME][type] || ICONS[ICON_THEME].unknown);
  const classes = ["pvls-icon"];
  if(opts.pop) classes.push("pop");
  if(opts.pulse) classes.push("pulse");
  if(opts.near) classes.push("near");
  if(opts.danger) classes.push("danger");
  const ang = normDeg(deg);
  const rot = rotate ? `style="transform:rotate(${ang}deg)"` : "";
  const html = `<div class="${classes.join(" ")}"><span class="ring"></span><img src="${url}" ${rot}/></div>`;
  return L.divIcon({
    html,
    className: "pvls-divicon",
    iconSize:[48,48],
    iconAnchor:[24,24]
  });
}
