import json
import os
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

APP_DIR = Path(__file__).resolve().parent
DATA_PATH = APP_DIR / "targets.json"

# Admin access (set ADMIN_PASSWORD in Render environment variables)
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "19982007")
ADMIN_COOKIE = "pvls_admin"


def _is_admin(request: Request) -> bool:
    # Cookie auth (after first login), or header/query for convenience
    if request.cookies.get(ADMIN_COOKIE) == ADMIN_PASSWORD:
        return True
    if request.headers.get("x-admin-key") == ADMIN_PASSWORD:
        return True
    if request.query_params.get("key") == ADMIN_PASSWORD:
        return True
    return False


def _require_admin(request: Request) -> None:
    if not _is_admin(request):
        raise HTTPException(status_code=403, detail="Access denied")


def _load_targets() -> List[Dict[str, Any]]:
    try:
        if not DATA_PATH.exists():
            return []
        with open(DATA_PATH, "r", encoding="utf-8") as f:
            return json.load(f) or []
    except Exception:
        return []


def _save_targets(items: List[Dict[str, Any]]) -> None:
    tmp = str(DATA_PATH) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    os.replace(tmp, DATA_PATH)


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


class TargetIn(BaseModel):
    # Max compatibility (pydantic v1/v2) — no regex Field
    type: str
    lat: float
    lng: float
    direction: int = 0  # 0..359
    note: Optional[str] = None


app = FastAPI(title="Pavlograd Sky Tactical Map")

static_dir = APP_DIR / "static"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

# very simple in-memory presence (single instance)
_presence: Dict[str, float] = {}


@app.post("/api/presence")
def presence_ping(payload: dict):
    sid = str(payload.get("sid") or "")[:80]
    if not sid:
        return JSONResponse({"online": 0})

    now = datetime.now().timestamp()
    _presence[sid] = now

    cutoff = now - 60  # keep last 60s
    for k in list(_presence.keys()):
        if _presence.get(k, 0) < cutoff:
            _presence.pop(k, None)

    return JSONResponse({"online": len(_presence)})


@app.get("/", response_class=HTMLResponse)
def root():
    return viewer()


@app.get("/viewer", response_class=HTMLResponse)
def viewer():
    return HTMLResponse((APP_DIR / "templates" / "viewer.html").read_text(encoding="utf-8"))


@app.get("/admin", response_class=HTMLResponse)
def admin(request: Request):
    # First time: open /admin?key=YOUR_PASSWORD
    _require_admin(request)
    resp = HTMLResponse((APP_DIR / "templates" / "admin.html").read_text(encoding="utf-8"))
    # Cookie session (so НЕ надо вводить пароль каждый раз в этом браузере)
    resp.set_cookie(
        ADMIN_COOKIE,
        ADMIN_PASSWORD,
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 24 * 30,  # 30 days
    )
    return resp


@app.get("/api/targets")
def get_targets():
    return JSONResponse({"updated_at": _now_iso(), "targets": _load_targets()})


@app.post("/api/targets")
def add_target(t: TargetIn, request: Request):
    _require_admin(request)

    t_type = (t.type or "").strip().lower()[:32]
    if not t_type:
        raise HTTPException(status_code=400, detail="type required")
    direction = int(t.direction) % 360

    items = _load_targets()
    new_id = f"t{int(datetime.now().timestamp()*1000)}_{len(items)+1}"

    item = {
        "id": new_id,
        "type": t_type,
        "lat": float(t.lat),
        "lng": float(t.lng),
        "direction": direction,
        "note": (t.note or "").strip()[:140],
        "created_at": _now_iso(),
    }
    items.append(item)
    _save_targets(items)
    return JSONResponse(item)


@app.post("/api/targets/{target_id}")
def update_target(target_id: str, t: TargetIn, request: Request):
    _require_admin(request)

    t_type = (t.type or "").strip().lower()[:32]
    if not t_type:
        raise HTTPException(status_code=400, detail="type required")
    direction = int(t.direction) % 360

    items = _load_targets()
    for x in items:
        if x.get("id") == target_id:
            x["type"] = t_type
            x["lat"] = float(t.lat)
            x["lng"] = float(t.lng)
            x["direction"] = direction
            x["note"] = (t.note or "").strip()[:140]
            _save_targets(items)
            return JSONResponse(x)

    raise HTTPException(status_code=404, detail="not found")


@app.delete("/api/targets/{target_id}")
def delete_target(target_id: str, request: Request):
    _require_admin(request)
    items = _load_targets()
    new_items = [x for x in items if x.get("id") != target_id]
    if len(new_items) == len(items):
        raise HTTPException(status_code=404, detail="not found")
    _save_targets(new_items)
    return JSONResponse({"ok": True})


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8080"))  # Render uses $PORT
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
