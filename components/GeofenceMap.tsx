"use client";

interface GeofenceMapProps {
  lat: number;
  lng: number;
  radius: number;
  zoom: number;
  onLocationChange: (lat: number, lng: number) => void;
  onZoomChange: (zoom: number) => void;
  size?: number;
}

const TILE_SIZE = 256;
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

export default function GeofenceMap({
  lat,
  lng,
  radius,
  zoom,
  onLocationChange,
  onZoomChange,
  size = 300,
}: GeofenceMapProps) {
  const cx = size / 2;
  const cy = size / 2;

  const frac = latLngToTileFrac(lat, lng, zoom);
  const tileX = Math.floor(frac.x);
  const tileY = Math.floor(frac.y);
  const offX = (frac.x - tileX) * TILE_SIZE;
  const offY = (frac.y - tileY) * TILE_SIZE;

  const mpp = metersPerPixel(lat, zoom);
  const radiusPx = Math.min(radius / mpp, size * 2);

  const halfTiles = Math.ceil(size / TILE_SIZE / 2) + 1;
  const maxTile = Math.pow(2, zoom) - 1;
  const tiles: Array<{ tx: number; ty: number; left: number; top: number; key: string }> = [];
  for (let dy = -halfTiles; dy <= halfTiles; dy++) {
    for (let dx = -halfTiles; dx <= halfTiles; dx++) {
      const ty = tileY + dy;
      if (ty < 0 || ty > maxTile) continue;
      const tx = ((tileX + dx) % (maxTile + 1) + (maxTile + 1)) % (maxTile + 1);
      tiles.push({
        tx,
        ty,
        left: Math.round(cx - offX + dx * TILE_SIZE),
        top: Math.round(cy - offY + dy * TILE_SIZE),
        key: `${zoom}-${tileX + dx}-${ty}`,
      });
    }
  }

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const dx = (clickX - cx) / TILE_SIZE;
    const dy = (clickY - cy) / TILE_SIZE;
    const { lat: newLat, lng: newLng } = tileFracToLatLng(frac.x + dx, frac.y + dy, zoom);
    onLocationChange(
      Math.max(-85, Math.min(85, newLat)),
      Math.max(-180, Math.min(180, newLng)),
    );
  }

  return (
    <div
      className="relative rounded-xl overflow-hidden border border-slate-700"
      style={{ width: size, height: size }}
    >
      <div
        className="absolute inset-0 cursor-crosshair"
        onClick={handleClick}
        style={{ userSelect: "none" }}
      >
        {tiles.map(({ tx, ty, left, top, key }) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={key}
            src={`https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`}
            alt=""
            draggable={false}
            style={{
              position: "absolute",
              left,
              top,
              width: TILE_SIZE,
              height: TILE_SIZE,
              userSelect: "none",
            }}
          />
        ))}

        <svg
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
          width={size}
          height={size}
        >
          <circle
            cx={cx}
            cy={cy}
            r={radiusPx}
            fill="rgba(99,102,241,0.18)"
            stroke="#6366f1"
            strokeWidth={2}
          />
          <circle cx={cx} cy={cy} r={7} fill="#6366f1" />
          <circle cx={cx} cy={cy} r={3} fill="white" />
        </svg>
      </div>

      <div className="absolute top-2 right-2 flex flex-col gap-1.5 z-10">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onZoomChange(Math.min(MAX_ZOOM, zoom + 1));
          }}
          className="size-11 rounded-xl bg-slate-900/95 border border-slate-600 text-slate-100 text-2xl font-bold flex items-center justify-center cursor-pointer shadow-lg active:scale-95 transition-transform"
        >
          +
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onZoomChange(Math.max(MIN_ZOOM, zoom - 1));
          }}
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
