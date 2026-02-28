import json
import os
from datetime import datetime
from pathlib import Path
from typing import Optional
import uuid

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
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
    return datetime.now().isoformat(timespec="seconds")


# -----------------------------
# DB helpers
# -----------------------------
def _db_conn():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise RuntimeError("DATABASE_URL is not set")
    if psycopg2 is None:
        raise RuntimeError("psycopg2 is not installed")
    sslmode = os.getenv("DB_SSLMODE", "require")
    return psycopg2.connect(db_url, sslmode=sslmode)


def _db_init() -> None:
    """Create tables + ensure columns exist. Safe to call multiple times."""
    if not os.getenv("DATABASE_URL") or psycopg2 is None:
        return
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                create table if not exists pvls_targets (
                    id text primary key,
                    type text not null,
                    lat double precision not null,
                    lng double precision not null,
                    direction integer not null,
                    note text,
                    speed_kmh double precision,
                    dest_lat double precision,
                    dest_lng double precision,
                    created_at timestamptz default now(),
                    updated_at timestamptz default now()
                );
                """
            )
            # ensure columns exist for older deployments
            cur.execute("alter table pvls_targets add column if not exists speed_kmh double precision;")
            cur.execute("alter table pvls_targets add column if not exists dest_lat double precision;")
            cur.execute("alter table pvls_targets add column if not exists dest_lng double precision;")

            cur.execute(
                """
                create table if not exists pvls_launchsites (
                    name text primary key,
                    lat double precision,
                    lng double precision,
                    active boolean default false,
                    updated_at timestamptz default now()
                );
                """
            )
            cur.execute(
                """
                create table if not exists pvls_presence (
                    sid text primary key,
                    last_seen timestamptz not null
                );
                """
            )


def _db_fetch_targets() -> list[dict]:
    _db_init()
    with _db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                select id, type, lat, lng, direction, note, speed_kmh, dest_lat, dest_lng,
                       to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS') as created_at,
                       to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS') as updated_at
                from pvls_targets
                order by updated_at desc nulls last;
                """
            )
            rows = cur.fetchall()
            out: list[dict] = []
            for r in rows:
                out.append(
                    {
                        "id": r["id"],
                        "type": r["type"],
                        "lat": float(r["lat"]),
                        "lng": float(r["lng"]),
                        "direction": int(r["direction"]),
                        "note": (r.get("note") or ""),
                        "speed_kmh": float(r["speed_kmh"]) if r.get("speed_kmh") is not None else 0,
                        "dest_lat": float(r["dest_lat"]) if r.get("dest_lat") is not None else None,
                        "dest_lng": float(r["dest_lng"]) if r.get("dest_lng") is not None else None,
                        "created_at": r.get("created_at") or _now_iso(),
                        "updated_at": r.get("updated_at") or _now_iso(),
                    }
                )
            return out


def _db_upsert_target(t: dict) -> None:
    _db_init()
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into pvls_targets (id, type, lat, lng, direction, note, speed_kmh, dest_lat, dest_lng, updated_at)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s, now())
                on conflict (id) do update set
                    type=excluded.type,
                    lat=excluded.lat,
                    lng=excluded.lng,
                    direction=excluded.direction,
                    note=excluded.note,
                    speed_kmh=excluded.speed_kmh,
                    dest_lat=excluded.dest_lat,
                    dest_lng=excluded.dest_lng,
                    updated_at=now();
                """,
                (
                    t.get("id"),
                    t.get("type"),
                    t.get("lat"),
                    t.get("lng"),
                    t.get("direction"),
                    t.get("note") or "",
                    t.get("speed_kmh") or 0,
                    t.get("dest_lat"),
                    t.get("dest_lng"),
                ),
            )


def _db_delete_target(target_id: str) -> None:
    _db_init()
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("delete from pvls_targets where id=%s;", (target_id,))


def _db_fetch_launchsites() -> list[dict]:
    _db_init()
    with _db_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                select name, lat, lng, active,
                       to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS') as updated_at
                from pvls_launchsites
                order by name asc;
                """
            )
            rows = cur.fetchall()
            out: list[dict] = []
            for r in rows:
                out.append(
                    {
                        "name": r["name"],
                        "lat": float(r["lat"]) if r.get("lat") is not None else None,
                        "lng": float(r["lng"]) if r.get("lng") is not None else None,
                        "active": bool(r.get("active")),
                        "updated_at": r.get("updated_at") or _now_iso(),
                    }
                )
            return out


def _db_seed_launchsites_if_empty() -> None:
    """Seed launch sites once from json or defaults."""
    if not os.getenv("DATABASE_URL") or psycopg2 is None:
        return
    _db_init()
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("select count(*) from pvls_launchsites;")
            n = int(cur.fetchone()[0])
            if n > 0:
                return

            items = []
            if LAUNCH_PATH.exists():
                try:
                    items = json.load(open(LAUNCH_PATH, "r", encoding="utf-8")) or []
                except Exception:
                    items = []

            if not items:
                items = [{"name": n, "lat": None, "lng": None, "active": False} for n in DEFAULT_LAUNCH_NAMES]

            for s in items:
                name = (s.get("name") or "").strip()[:80]
                if not name:
                    continue
                cur.execute(
                    """
                    insert into pvls_launchsites (name, lat, lng, active, updated_at)
                    values (%s,%s,%s,%s, now())
                    on conflict (name) do nothing;
                    """,
                    (name, s.get("lat"), s.get("lng"), bool(s.get("active"))),
                )


def _db_upsert_launchsite(site: dict) -> None:
    _db_init()
    _db_seed_launchsites_if_empty()
    with _db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into pvls_launchsites (name, lat, lng, active, updated_at)
                values (%s,%s,%s,%s, now())
                on conflict (name) do update set
                    lat=excluded.lat,
                    lng=excluded.lng,
                    active=excluded.active,
                    updated_at=now();
                """,
                (site.get("name"), site.get("lat"), site.get("lng"), bool(site.get("active"))),
            )


# -----------------------------
# JSON fallback helpers
# -----------------------------
def _load_targets() -> list[dict]:
    try:
        if os.getenv("DATABASE_URL") and psycopg2 is not None:
            return _db_fetch_targets()
        if not DATA_PATH.exists():
            return []
        with open(DATA_PATH, "r", encoding="utf-8") as f:
            return json.load(f) or []
    except Exception:
        return []


def _save_targets(items: list[dict]) -> None:
    if os.getenv("DATABASE_URL") and psycopg2 is not None:
        for t in items:
            _db_upsert_target(t)
        return
    tmp = str(DATA_PATH) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    os.replace(tmp, DATA_PATH)


def _load_launch_sites() -> list[dict]:
    # DB first
    try:
        if os.getenv("DATABASE_URL") and psycopg2 is not None:
            _db_seed_launchsites_if_empty()
            return _db_fetch_launchsites()
    except Exception:
        pass

    # JSON fallback
    if not LAUNCH_PATH.exists():
        items = [{"name": n, "lat": None, "lng": None, "active": False} for n in DEFAULT_LAUNCH_NAMES]
        _save_launch_sites(items)
        return items

    try:
        with open(LAUNCH_PATH, "r", encoding="utf-8") as f:
            return json.load(f) or []
    except Exception:
        return [{"name": n, "lat": None, "lng": None, "active": False} for n in DEFAULT_LAUNCH_NAMES]


def _save_launch_sites(items: list[dict]) -> None:
    if os.getenv("DATABASE_URL") and psycopg2 is not None:
        for s in items:
            _db_upsert_launchsite(s)
        return
    tmp = str(LAUNCH_PATH) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    os.replace(tmp, LAUNCH_PATH)


# -----------------------------
# API models
# -----------------------------
class TargetIn(BaseModel):
    type: str = Field(..., pattern=r"^[a-z0-9_]+$")
    lat: float
    lng: float
    direction: int = Field(0, ge=0, le=359)
    note: Optional[str] = None
    speed_kmh: float = Field(0, ge=0, le=20000)
    dest_lat: Optional[float] = None
    dest_lng: Optional[float] = None


class LaunchSiteIn(BaseModel):
    name: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    active: bool = False


app = FastAPI(title="Pavlograd Sky Tactical Map")

@app.on_event("startup")
def _startup():
    try:
        _db_init()
        _db_seed_launchsites_if_empty()
    except Exception:
        pass

app.mount("/static", StaticFiles(directory=str(APP_DIR / "static")), name="static")


# Presence (in-memory; enough for Render single instance)
_presence: dict[str, float] = {}

@app.post("/api/presence")
def presence_ping(payload: dict):
    sid = str(payload.get("sid") or "")[:80]
    if not sid:
        return JSONResponse({"online": 0})
    now = datetime.now().timestamp()
    _presence[sid] = now
    cutoff = now - 60
    for k in list(_presence.keys()):
        if _presence.get(k, 0) < cutoff:
            _presence.pop(k, None)
    return JSONResponse({"online": len(_presence)})


@app.get("/api/stats")
def api_stats():
    now = datetime.now().timestamp()
    cutoff = now - 60
    for k in list(_presence.keys()):
        if _presence.get(k, 0) < cutoff:
            _presence.pop(k, None)

    last = None
    try:
        targets = _load_targets()
        if targets:
            # updated_at is ISO string
            last = max((t.get("updated_at") or t.get("created_at") or "") for t in targets)
    except Exception:
        last = None

    return JSONResponse({"online": len(_presence), "updated_at": last})


@app.get("/", response_class=HTMLResponse)
def root():
    return viewer()


@app.get("/viewer", response_class=HTMLResponse)
def viewer():
    return HTMLResponse((APP_DIR / "templates" / "viewer.html").read_text(encoding="utf-8"))


@app.get("/admin", response_class=HTMLResponse)
def admin():
    return HTMLResponse((APP_DIR / "templates" / "admin.html").read_text(encoding="utf-8"))


@app.get("/api/targets")
def get_targets():
    return JSONResponse({"updated_at": _now_iso(), "targets": _load_targets()})


@app.get("/api/launchsites")
def get_launch_sites():
    return JSONResponse({"updated_at": _now_iso(), "sites": _load_launch_sites()})


@app.post("/api/launchsites")
def upsert_launch_site(s: LaunchSiteIn):
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
def add_target(t: TargetIn):
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


@app.delete("/api/targets/{target_id}")
def delete_target(target_id: str):
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
def update_target(target_id: str, t: TargetIn):
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
