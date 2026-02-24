import json
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

APP_DIR = Path(__file__).resolve().parent
DATA_PATH = APP_DIR / "targets.json"

# Admin access (set ADMIN_PASSWORD in environment on Render)
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "19982007")
ADMIN_COOKIE = "pvls_admin"

def _is_admin(request: Request) -> bool:
    # Accept: cookie, header, or query param (handy for first login link)
    if request.cookies.get(ADMIN_COOKIE) == ADMIN_PASSWORD:
        return True
    if request.headers.get('x-admin-key') == ADMIN_PASSWORD:
        return True
    if request.query_params.get('key') == ADMIN_PASSWORD:
        return True
    return False

def _require_admin(request: Request) -> None:
    if not _is_admin(request):
        raise HTTPException(status_code=403, detail="Access denied")

def _load_targets() -> list:
    try:
        if not DATA_PATH.exists():
            return []
        with open(DATA_PATH, "r", encoding="utf-8") as f:
            return json.load(f) or []
    except Exception:
        return []

def _save_targets(items: list) -> None:
    tmp = str(DATA_PATH) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    os.replace(tmp, DATA_PATH)

def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")

class TargetIn(BaseModel):
    type: str = Field(..., pattern=r"^[a-z0-9_]+$")
    lat: float
    lng: float
    direction: int = Field(0, ge=0, le=359)
    note: Optional[str] = None

app = FastAPI(title="Pavlograd Sky Tactical Map")
app.mount("/static", StaticFiles(directory=str(APP_DIR / "static")), name="static")

presence = {}

@app.post("/api/presence")
def presence_ping(payload: dict):
    sid = str(payload.get("sid") or "")[:80]
    if not sid:
        return JSONResponse({"online": 0})
    now = datetime.now().timestamp()
    presence[sid] = now
    cutoff = now - 60
    for k in list(presence.keys()):
        if presence.get(k, 0) < cutoff:
            presence.pop(k, None)
    return JSONResponse({"online": len(presence)})

@app.get("/", response_class=HTMLResponse)
def root():
    return viewer()

@app.get("/viewer", response_class=HTMLResponse)
def viewer():
    return HTMLResponse((APP_DIR / "templates" / "viewer.html").read_text(encoding="utf-8"))

@app.get("/admin", response_class=HTMLResponse)
def admin(request: Request):
    # open as /admin?key=YOUR_PASSWORD (first time), then cookie will work
    _require_admin(request)
    resp = HTMLResponse((APP_DIR / "templates" / "admin.html").read_text(encoding="utf-8"))
    # keep simple cookie-based session
    resp.set_cookie(ADMIN_COOKIE, ADMIN_PASSWORD, httponly=True, samesite="lax")
    return resp

@app.get("/api/targets")
def get_targets():
    return JSONResponse({"updated_at": _now_iso(), "targets": _load_targets()})

@app.post("/api/targets")
def add_target(t: TargetIn, request: Request):
    _require_admin(request)
    items = _load_targets()
    new_id = f"t{int(datetime.now().timestamp()*1000)}_{len(items)+1}"
    item = {
        "id": new_id,
        "type": t.type,
        "lat": float(t.lat),
        "lng": float(t.lng),
        "direction": int(t.direction),
        "note": (t.note or "").strip()[:140] if t.note else "",
        "created_at": _now_iso(),
    }
    items.append(item)
    _save_targets(items)
    return JSONResponse(item)

@app.delete("/api/targets/{target_id}")
def delete_target(target_id: str, request: Request):
    _require_admin(request)
    items = _load_targets()
    new_items = [x for x in items if x.get("id") != target_id]
    if len(new_items) == len(items):
        raise HTTPException(status_code=404, detail="not found")
    _save_targets(new_items)
    return JSONResponse({"ok": True})

@app.post("/api/targets/{target_id}")
def update_target(target_id: str, t: TargetIn, request: Request):
    _require_admin(request)
    items = _load_targets()
    found = None
    for x in items:
        if x.get("id") == target_id:
            found = x
            break
    if not found:
        raise HTTPException(status_code=404, detail="not found")
    found["type"] = t.type
    found["lat"] = float(t.lat)
    found["lng"] = float(t.lng)
    found["direction"] = int(t.direction)
    found["note"] = (t.note or "").strip()[:140] if t.note else ""
    _save_targets(items)
    return JSONResponse(found)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8080, reload=False)