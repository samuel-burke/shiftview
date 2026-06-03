"use client";

import { useState, useRef, useEffect } from "react";

interface GeofenceMapProps {
  lat: number;
  lng: number;
  radius: number;
  zoom: number;
  onLocationChange: (lat: number, lng: number) => void;
  onZoomChange: (zoom: number) => void;
}

const TILE_SIZE = 256;
const MAP_HEIGHT = 280;
const MIN_ZOOM = 12;
const MAX_ZOOM = 19;

function latLngToTileFrac(lat: number, lng: number, zoom: number) {
  const scale = Math.pow(2, zoom);
  const x = ((lng + 180) / 360) * scale;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return { x, y };
}

function tileFracToLatLng(tx: number, ty: number, zoom: number) {
  const scale = Math.pow(2, zoom);
  const lng = (tx / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * ty) / scale;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { lat, lng };
}

function metersPerPixel(lat: number, zoom: number) {
  return (
    (40075016.686 * Math.abs(Math.cos((lat * Math.PI) / 180))) /
    (TILE_SIZE * Math.pow(2, zoom))
  );
}

function applyDelta(lat: number, lng: number, dx: number, dy: number, zoom: number) {
  const frac = latLngToTileFrac(lat, lng, zoom);
  const { lat: newLat, lng: newLng } = tileFracToLatLng(
    frac.x - dx / TILE_SIZE,
    frac.y - dy / TILE_SIZE,
    zoom,
  );
  return {
    lat: Math.max(-85, Math.min(85, newLat)),
    lng: Math.max(-180, Math.min(180, newLng)),
  };
}

export default function GeofenceMap({
  lat,
  lng,
  radius,
  zoom,
  onLocationChange,
  onZoomChange,
}: GeofenceMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapWidth, setMapWidth] = useState(320);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setMapWidth(el.offsetWidth);
    const ro = new ResizeObserver(([e]) => setMapWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // View position: tracks live during drag, propagated to parent on release
  const [viewLat, setViewLat] = useState(lat);
  const [viewLng, setViewLng] = useState(lng);
  useEffect(() => { setViewLat(lat); }, [lat]);
  useEffect(() => { setViewLng(lng); }, [lng]);

  const dragRef = useRef<{ sx: number; sy: number; sLat: number; sLng: number } | null>(null);
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  const touchesRef = useRef(new Map<number, { x: number; y: number }>());

  const cx = mapWidth / 2;
  const cy = MAP_HEIGHT / 2;

  const frac = latLngToTileFrac(viewLat, viewLng, zoom);
  const tileX = Math.floor(frac.x);
  const tileY = Math.floor(frac.y);
  const offX = (frac.x - tileX) * TILE_SIZE;
  const offY = (frac.y - tileY) * TILE_SIZE;

  const mpp = metersPerPixel(viewLat, zoom);
  const radiusPx = Math.min(radius / mpp, Math.max(mapWidth, MAP_HEIGHT) * 2);

  const maxTile = Math.pow(2, zoom) - 1;
  const halfX = Math.ceil(mapWidth / TILE_SIZE / 2) + 1;
  const halfY = Math.ceil(MAP_HEIGHT / TILE_SIZE / 2) + 1;
  const tiles: Array<{ tx: number; ty: number; left: number; top: number; key: string }> = [];
  for (let dy = -halfY; dy <= halfY; dy++) {
    for (let dx = -halfX; dx <= halfX; dx++) {
      const ty = tileY + dy;
      if (ty < 0 || ty > maxTile) continue;
      const tx = ((tileX + dx) % (maxTile + 1) + (maxTile + 1)) % (maxTile + 1);
      tiles.push({
        tx, ty,
        left: Math.round(cx - offX + dx * TILE_SIZE),
        top:  Math.round(cy - offY + dy * TILE_SIZE),
        key: `${zoom}-${tileX + dx}-${ty}`,
      });
    }
  }

  // ── Mouse ────────────────────────────────────────────────────────────────────
  function onMouseDown(e: React.MouseEvent) {
    dragRef.current = { sx: e.clientX, sy: e.clientY, sLat: viewLat, sLng: viewLng };
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!dragRef.current) return;
    const p = applyDelta(dragRef.current.sLat, dragRef.current.sLng, e.clientX - dragRef.current.sx, e.clientY - dragRef.current.sy, zoom);
    setViewLat(p.lat);
    setViewLng(p.lng);
  }
  function onMouseUp() {
    if (!dragRef.current) return;
    onLocationChange(viewLat, viewLng);
    dragRef.current = null;
  }

  // ── Touch (touch-none on container = no passive scroll interference) ─────────
  function onTouchStart(e: React.TouchEvent) {
    for (const t of Array.from(e.changedTouches))
      touchesRef.current.set(t.identifier, { x: t.clientX, y: t.clientY });

    if (touchesRef.current.size === 1) {
      const [t] = Array.from(touchesRef.current.values());
      dragRef.current = { sx: t.x, sy: t.y, sLat: viewLat, sLng: viewLng };
    } else if (touchesRef.current.size === 2) {
      dragRef.current = null;
      const [a, b] = Array.from(touchesRef.current.values());
      pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  }
  function onTouchMove(e: React.TouchEvent) {
    for (const t of Array.from(e.changedTouches))
      touchesRef.current.set(t.identifier, { x: t.clientX, y: t.clientY });

    if (touchesRef.current.size === 1 && dragRef.current) {
      const [t] = Array.from(touchesRef.current.values());
      const p = applyDelta(dragRef.current.sLat, dragRef.current.sLng, t.x - dragRef.current.sx, t.y - dragRef.current.sy, zoom);
      setViewLat(p.lat);
      setViewLng(p.lng);
    } else if (touchesRef.current.size === 2 && pinchRef.current) {
      const [a, b] = Array.from(touchesRef.current.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM,
        Math.round(pinchRef.current.zoom + Math.log2(dist / pinchRef.current.dist)),
      ));
      if (newZoom !== zoom) onZoomChange(newZoom);
    }
  }
  function onTouchEnd(e: React.TouchEvent) {
    for (const t of Array.from(e.changedTouches))
      touchesRef.current.delete(t.identifier);

    if (touchesRef.current.size === 0) {
      if (dragRef.current) { onLocationChange(viewLat, viewLng); dragRef.current = null; }
      pinchRef.current = null;
    } else if (touchesRef.current.size === 1) {
      // Finger lifted from pinch — restart drag from current position
      const [t] = Array.from(touchesRef.current.values());
      dragRef.current = { sx: t.x, sy: t.y, sLat: viewLat, sLng: viewLng };
      pinchRef.current = null;
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full rounded-xl overflow-hidden border border-slate-700"
      style={{ height: MAP_HEIGHT }}
    >
      <div
        className="absolute inset-0 touch-none cursor-grab"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {tiles.map(({ tx, ty, left, top, key }) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={key}
            src={`https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`}
            alt=""
            draggable={false}
            style={{ position: "absolute", left, top, width: TILE_SIZE, height: TILE_SIZE, userSelect: "none" }}
          />
        ))}

        <svg
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
          width={mapWidth}
          height={MAP_HEIGHT}
        >
          <circle cx={cx} cy={cy} r={radiusPx} fill="rgba(99,102,241,0.18)" stroke="#6366f1" strokeWidth={2} />
          <circle cx={cx} cy={cy} r={8} fill="#6366f1" />
          <circle cx={cx} cy={cy} r={3.5} fill="white" />
        </svg>
      </div>

      <div className="absolute top-2 right-2 flex flex-col gap-1.5 z-10">
        <button
          onClick={(e) => { e.stopPropagation(); onZoomChange(Math.min(MAX_ZOOM, zoom + 1)); }}
          className="size-11 rounded-xl bg-slate-900/95 border border-slate-600 text-slate-100 text-2xl font-bold flex items-center justify-center cursor-pointer shadow-lg active:scale-95 transition-transform"
        >
          +
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onZoomChange(Math.max(MIN_ZOOM, zoom - 1)); }}
          className="size-11 rounded-xl bg-slate-900/95 border border-slate-600 text-slate-100 text-2xl font-bold flex items-center justify-center cursor-pointer shadow-lg active:scale-95 transition-transform"
        >
          −
        </button>
      </div>

      <div className="absolute bottom-0.5 right-1 z-10 text-[9px] text-slate-300/70 bg-slate-900/60 px-1 rounded pointer-events-none">
        © OpenStreetMap contributors
      </div>
    </div>
  );
}
