import json
import os
import base64
import hmac
import hashlib
import time
from datetime import datetime
from pathlib import Path
from typing import Optional
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# Optional Postgres (Render/Supabase)
try:
    import psycopg2  # type: ignore
    from psycopg2.extras import RealDictCursor  # type: ignore
except Exception:
    psycopg2 = None
    RealDictCursor = None

APP_DIR = Path(__file__).resolve().parent
DATA_PATH = APP_DIR / "targets.json"
LAUNCH_PATH = APP_DIR / "launch_sites.json"

DEFAULT_LAUNCH_NAMES = [
    "Шаталово",
    "Орел",
    "Орел-Південний",
    "Халино",
    "Навля",
    "Міллерово",
    "Приморсько-Ахтарськ",
    "Чауда",
    "Гвардійське",
    "Донецьк",
    "Бердянськ",
    "Цимбулова",
    "Сеща",
    "Приморськ",
    "Кача",
    "Балаклава",
    "Шахти",
    "Асовиця",
    "Макіївка",
]


def _now_iso() -> str:
    return datetime.now().isoformat(t
# -----------------------------
# Admin auth (signed cookie session, ENV-configured)
# -----------------------------
# Set these in Render → Service → Environment:
#   ADMIN_USER = moglot
#   ADMIN_SALT = <random base64>
#   ADMIN_PWHASH = <pbkdf2 sha256 base64>
#   ADMIN_SECRET = <random long string>
#
# Optional (less secure) fallback:
#   ADMIN_PASSWORD = 12344321
#
DEFAULT_ADMIN_USER = "moglot"
DEFAULT_ADMIN_PASS = "12344321"

ADMIN_USER = os.getenv("ADMIN_USER", DEFAULT_ADMIN_USER)
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
ADMIN_SALT_B64 = os.getenv("ADMIN_SALT", "")
ADMIN_PWHASH_B64 = os.getenv("ADMIN_PWHASH", "")
ADMIN_SECRET = os.getenv("ADMIN_SECRET", "") or os.getenv("SECRET_KEY", "")

ADMIN_COOKIE = "pvls_admin"
ADMIN_SESSION_HOURS = int(os.getenv("ADMIN_SESSION_HOURS", "6"))
ADMIN_REMEMBER_DAYS = int(os.getenv("ADMIN_REMEMBER_DAYS", "30"))

def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")

def _b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode((s + pad).encode("utf-8"))

def _pbkdf2_hash(password: str, salt: bytes, iters: int = 200_000) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iters)

def _check_password(password: str) -> bool:
    # 1) Preferred: PBKDF2 hash
    if ADMIN_SALT_B64 and ADMIN_PWHASH_B64:
        try:
            salt = _b64url_decode(ADMIN_SALT_B64)
            target = _b64url_decode(ADMIN_PWHASH_B64)
            got = _pbkdf2_hash(password, salt)
            return hmac.compare_digest(got, target)
        except Exception:
            return False

    # 2) Fallback: plaintext env
    if ADMIN_PASSWORD:
        return hmac.compare_digest(password, ADMIN_PASSWORD)

    # 3) Dev fallback (keeps local working if you forgot ENV)
    return (ADMIN_USER == DEFAULT_ADMIN_USER) and hmac.compare_digest(password, DEFAULT_ADMIN_PASS)

def _sign(payload: str) -> str:
    secret = (ADMIN_SECRET or "dev-admin-secret-change").encode("utf-8")
    sig = hmac.new(secret, payload.encode("utf-8"), hashlib.sha256).digest()
    return _b64url(sig)

def _make_cookie(username: str, remember: bool) -> str:
    now = int(time.time())
    exp = now + (ADMIN_REMEMBER_DAYS * 86400 if remember else ADMIN_SESSION_HOURS * 3600)
    payload = f"{username}|{exp}"
    return f"{_b64url(payload.encode('utf-8'))}.{_sign(payload)}"

def _verify_cookie(value: str) -> bool:
    if not value or "." not in value:
        return False
    try:
        p_b64, sig = value.split(".", 1)
        payload = _b64url_decode(p_b64).decode("utf-8")
        if not hmac.compare_digest(sig, _sign(payload)):
            return False
        user, exp_s = payload.split("|", 1)
        if user != ADMIN_USER:
            return False
        if int(exp_s) < int(time.time()):
            return False
        return True
    except Exception:
        return False

def _is_admin(request: Request) -> bool:
    return _verify_cookie(request.cookies.get(ADMIN_COOKIE) or "")

def _require_admin(request: Request):
    if not _is_admin(request):
        raise HTTPException(status_code=401, detail="Unauthorized")


class LoginReq(BaseModel):
    username: str
    password: str
    remember: bool = False


@app.get("/admin", response_class=HTMLResponse)
def admin(request: Request):
    if _is_admin(request):
        return HTMLResponse((APP_DIR / "templates" / "admin.html").read_text(encoding="utf-8"))
    return HTMLResponse((APP_DIR / "templates" / "login.html").read_text(encoding="utf-8"))


@app.post("/admin/login")
def admin_login(req: LoginReq):
    if req.username != ADMIN_USER or not _check_password(req.password):
        return JSONResponse({"ok": False, "error": "Невірний логін або пароль"}, status_code=401)

    resp = JSONResponse({"ok": True})
    resp.set_cookie(
        key=ADMIN_COOKIE,
        value=_make_cookie(req.username, req.remember),
        max_age=(ADMIN_REMEMBER_DAYS * 86400 if req.remember else ADMIN_SESSION_HOURS * 3600),
        httponly=True,
        samesite="lax",
        secure=bool(os.getenv("RENDER")) or bool(os.getenv("HTTPS", "")),
    )
    return resp


@app.get("/admin/logout")
def admin_logout():
    resp = RedirectResponse(url="/admin", status_code=303)
    resp.delete_cookie(ADMIN_COOKIE)
    return resp

    resp.delete_cookie(ADMIN_COOKIE)
    return resp

@app.get("/api/targets")
def get_targets():
    return JSONResponse({"updated_at": _now_iso(), "targets": _load_targets()})


@app.get("/api/launchsites")
def get_launch_sites():
    return JSONResponse({"updated_at": _now_iso(), "sites": _load_launch_sites()})


@app.post("/api/launchsites")
def upsert_launch_site(request: Request, s: LaunchSiteIn):
    _require_admin(request)
    name = (s.name or "").strip()[:80]
    if not name:
        raise HTTPException(status_code=400, detail="name required")

    site = {
        "name": name,
        "lat": float(s.lat) if s.lat is not None else None,
        "lng": float(s.lng) if s.lng is not None else None,
        "active": bool(s.active),
    }

    if os.getenv("DATABASE_URL") and psycopg2 is not None:
        _db_upsert_launchsite(site)
        site["updated_at"] = _now_iso()
        return JSONResponse(site)

    items = _load_launch_sites()
    found = None
    for x in items:
        if x.get("name") == name:
            found = x
            break
    if not found:
        found = {"name": name, "lat": None, "lng": None, "active": False}
        items.append(found)
    found.update(site)
    found["updated_at"] = _now_iso()
    _save_launch_sites(items)
    return JSONResponse(found)


@app.post("/api/targets")
def add_target(request: Request, t: TargetIn):
    _require_admin(request)
    new_id = f"t{int(datetime.now().timestamp()*1000)}_{uuid.uuid4().hex[:6]}"
    item = {
        "id": new_id,
        "type": t.type,
        "lat": float(t.lat),
        "lng": float(t.lng),
        "direction": int(t.direction),
        "note": (t.note or "").strip()[:140] if t.note else "",
        "speed_kmh": float(t.speed_kmh or 0),
        "dest_lat": float(t.dest_lat) if t.dest_lat is not None else None,
        "dest_lng": float(t.dest_lng) if t.dest_lng is not None else None,
        "active": bool(getattr(t, "active", True)),
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    if os.getenv("DATABASE_URL") and psycopg2 is not None:
        _db_upsert_target(item)
    else:
        items = _load_targets()
        items.append(item)
        _save_targets(items)
    return JSONResponse(item)


@app.delete("/api/targets")
def clear_targets(request: Request):
    _require_admin(request)
    if os.getenv("DATABASE_URL") and psycopg2 is not None:
        _db_clear_targets()
        return JSONResponse({"ok": True})
    _save_targets([])
    return JSONResponse({"ok": True})


@app.delete("/api/targets/{target_id}")
def delete_target(request: Request, target_id: str):
    _require_admin(request)
    if os.getenv("DATABASE_URL") and psycopg2 is not None:
        _db_delete_target(target_id)
        return JSONResponse({"ok": True})

    items = _load_targets()
    new_items = [x for x in items if x.get("id") != target_id]
    if len(new_items) == len(items):
        raise HTTPException(status_code=404, detail="not found")
    _save_targets(new_items)
    return JSONResponse({"ok": True})


@app.post("/api/targets/{target_id}")
def update_target(request: Request, target_id: str, t: TargetIn):
    _require_admin(request)
    item = {
        "id": target_id,
        "type": t.type,
        "lat": float(t.lat),
        "lng": float(t.lng),
        "direction": int(t.direction),
        "note": (t.note or "").strip()[:140] if t.note else "",
        "speed_kmh": float(t.speed_kmh or 0),
        "dest_lat": float(t.dest_lat) if t.dest_lat is not None else None,
        "dest_lng": float(t.dest_lng) if t.dest_lng is not None else None,
        "active": bool(getattr(t, "active", True)),
        "updated_at": _now_iso(),
    }

    if os.getenv("DATABASE_URL") and psycopg2 is not None:
        _db_upsert_target(item)
        return JSONResponse(item)

    items = _load_targets()
    found = None
    for x in items:
        if x.get("id") == target_id:
            found = x
            break
    if not found:
        raise HTTPException(status_code=404, detail="not found")

    found.update(item)
    _save_targets(items)
    return JSONResponse(found)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8080, reload=False)