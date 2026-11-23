import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Eraser,
  Flower2,
  MousePointer2,
  Mountain,
  RotateCcw,
  Route,
  Shrub,
  Trees,
  Umbrella,
  Waves,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { MakerStore } from '../../store/useMakerStore';
import {
  IslandTerrain,
  type Overview2DBrushId,
  createDefaultWaterBodies,
  createInitialTerrain,
  levelBoardToWorld,
  sampleTerrainHeight,
} from '../../utils/terrain';
import { MAKER_ASSET_DRAG_MIME } from './LeftAssetsPanel';

type Painter2DTool = Overview2DBrushId | 'inspect';

interface BrushMeta {
  id: Painter2DTool;
  label: string;
  accent: string;
  Icon: React.FC<{ size?: number; className?: string }>;
}

const PAINTER_2D_TOOLS: BrushMeta[] = [
  { id: 'inspect', label: 'Select', accent: '#7C5CFF', Icon: MousePointer2 },
  { id: 'coniferWoods', label: 'Conifers', accent: '#1F5C36', Icon: Trees },
  { id: 'deciduousWoods', label: 'Deciduous', accent: '#4EA343', Icon: Trees },
  { id: 'bushes', label: 'Bushes', accent: '#20B46A', Icon: Shrub },
  { id: 'wildflowers', label: 'Flowers', accent: '#EC4899', Icon: Flower2 },
  { id: 'rocks', label: 'Rocks', accent: '#64748B', Icon: Mountain },
  { id: 'hills', label: 'Hills', accent: '#F59E0B', Icon: Mountain },
  { id: 'beaches', label: 'Beach', accent: '#E5C67E', Icon: Umbrella },
  { id: 'lakes', label: 'Lake', accent: '#0EA5E9', Icon: Waves },
  { id: 'rivers', label: 'Creek', accent: '#2A9D8F', Icon: Waves },
  { id: 'caves', label: 'Cave', accent: '#A855F7', Icon: Mountain },
  { id: 'roads', label: 'Trail', accent: '#C2854E', Icon: Route },
  { id: 'erase', label: 'Erase', accent: '#F2545B', Icon: Eraser },
];

const LAYER_COLORS = [
  '#4EA343', // 0 grass
  '#E5C67E', // 1 sand
  '#7D828F', // 2 rock
  '#E2E8F0', // 3 snow
  '#5D7B3B', // 4 moss
  '#8C939E', // 5 cobble
  '#9C6F44', // 6 dirt
];

export interface Overview2DPainterProps {
  store: MakerStore;
  activePlacementAssetId: string | null;
  onPlaceCustomAssetAtWorldPoint: (assetId: string, worldX: number, worldZ: number) => void;
  onSelectEntityFrom2D: (entityId: string) => void;
}

export const Overview2DPainter: React.FC<Overview2DPainterProps> = ({
  store,
  activePlacementAssetId,
  onPlaceCustomAssetAtWorldPoint,
  onSelectEntityFrom2D,
}) => {
  const { currentLevel } = store;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [tool, setTool] = useState<Painter2DTool>('coniferWoods');
  const [brushRadius, setBrushRadius] = useState<number>(11);
  const [density, setDensity] = useState<number>(0.65);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<[number, number]>([0, 0]);
  const [hoverWorld, setHoverWorld] = useState<[number, number] | null>(null);

  const paintingRef = useRef(false);
  const panningRef = useRef<{ startX: number; startY: number; origPan: [number, number] } | null>(
    null
  );
  const lastStrokeMsRef = useRef(0);

  const terrain = useMemo(
    () => currentLevel?.terrain ?? createInitialTerrain(),
    [currentLevel?.terrain]
  );

  const screenToWorld = useCallback(
    (clientX: number, clientY: number): [number, number] => {
      const canvas = canvasRef.current;
      if (!canvas) return [0, 0];
      const rect = canvas.getBoundingClientRect();
      const cx = rect.width * 0.5 + pan[0];
      const cy = rect.height * 0.5 + pan[1];
      const halfSpan = (Math.min(rect.width, rect.height) * 0.45) * zoom;
      const wx = ((clientX - rect.left - cx) / Math.max(1, halfSpan)) * IslandTerrain.shoreRadius;
      const wz = ((clientY - rect.top - cy) / Math.max(1, halfSpan)) * IslandTerrain.shoreRadius;
      return [wx, wz];
    },
    [pan, zoom]
  );

  // Render interactive top-down world map canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !currentLevel) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(320, container.clientWidth);
    const h = Math.max(240, container.clientHeight);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Deep ocean backdrop
    ctx.fillStyle = '#0D2438';
    ctx.fillRect(0, 0, w, h);

    const cx = w * 0.5 + pan[0];
    const cy = h * 0.5 + pan[1];
    const halfSpan = Math.min(w, h) * 0.45 * zoom;
    const toPx = (wx: number, wz: number): [number, number] => [
      cx + (wx / IslandTerrain.shoreRadius) * halfSpan,
      cy + (wz / IslandTerrain.shoreRadius) * halfSpan,
    ];
    const scaleM = halfSpan / IslandTerrain.shoreRadius;

    // Subtle ocean ripple rings
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.14)';
    ctx.lineWidth = 1.5;
    for (const rMul of [1.02, 1.12, 1.24]) {
      ctx.beginPath();
      ctx.arc(cx, cy, IslandTerrain.shoreRadius * scaleM * rMul, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Island base circle shadow
    ctx.fillStyle = '#18364A';
    ctx.beginPath();
    ctx.arc(cx, cy, IslandTerrain.shoreRadius * scaleM, 0, Math.PI * 2);
    ctx.fill();

    // Render terrain cells
    const size = terrain.size;
    const width = size + 1;
    const stepM = (2 * IslandTerrain.radius) / size;
    const cellPx = Math.max(1.5, stepM * scaleM + 0.6);

    for (let row = 0; row < size; row++) {
      const vz = -IslandTerrain.radius + (row + 0.5) * stepM;
      for (let col = 0; col < size; col++) {
        const vx = -IslandTerrain.radius + (col + 0.5) * stepM;
        const dist = Math.hypot(vx, vz);
        if (dist > IslandTerrain.shoreRadius * 0.99) continue;
        const idx = row * width + col;
        const height = terrain.heights[idx];
        const layer = terrain.layers[idx] ?? 0;

        let color = LAYER_COLORS[layer] ?? LAYER_COLORS[0];
        if (height <= IslandTerrain.waterLevel - 0.15) {
          color = '#1B6B93';
        } else if (height > (terrain.mountainConfig?.snowStartHeight ?? 10.5)) {
          color = '#E2E8F0';
        } else if (height > (terrain.mountainConfig?.rockStartHeight ?? 5.5) && layer === 0) {
          color = '#767D89';
        }

        const [px, py] = toPx(vx, vz);
        ctx.fillStyle = color;
        ctx.fillRect(px - cellPx * 0.5, py - cellPx * 0.5, cellPx, cellPx);

        // Hilltop shading contour boost
        if (height > 2.2 && height > IslandTerrain.waterLevel) {
          const shadeAlpha = Math.min(0.32, (height - 2.2) * 0.025);
          ctx.fillStyle = `rgba(255,255,255,${shadeAlpha.toFixed(3)})`;
          ctx.fillRect(px - cellPx * 0.5, py - cellPx * 0.5, cellPx, cellPx);
        }
      }
    }

    // Water bodies overlay
    const waterBodies = terrain.waterBodies ?? createDefaultWaterBodies();
    for (const wb of waterBodies) {
      const selected = store.selectedWaterBodyId === wb.id;
      ctx.save();
      ctx.fillStyle = wb.waterColor || '#2E86AB';
      ctx.globalAlpha = 0.72;
      ctx.strokeStyle = selected ? '#FFFFFF' : 'rgba(186,230,253,0.75)';
      ctx.lineWidth = selected ? 2.5 : 1.2;

      if (wb.points && wb.points.length >= 2) {
        ctx.beginPath();
        wb.points.forEach((pt, idx) => {
          const [px, py] = toPx(pt[0], pt[1]);
          if (idx === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = wb.waterColor || '#2E86AB';
        ctx.lineWidth = Math.max(3, wb.width * scaleM);
        ctx.stroke();
      } else {
        const [px, py] = toPx(wb.center[0], wb.center[1]);
        ctx.beginPath();
        ctx.ellipse(
          px,
          py,
          Math.max(4, wb.radiusX * scaleM),
          Math.max(4, wb.radiusZ * scaleM),
          0,
          0,
          Math.PI * 2
        );
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    // Roads / Trails overlay
    for (const road of terrain.roads ?? []) {
      if (road.points.length < 2) continue;
      const selected = store.selectedRoadId === road.id;
      ctx.save();
      ctx.beginPath();
      road.points.forEach((pt, idx) => {
        const [px, py] = toPx(pt[0], pt[1]);
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.strokeStyle = selected ? '#FBBF24' : '#B87C4C';
      ctx.lineWidth = Math.max(2.5, road.width * scaleM);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();
    }

    // Scatter foliage/rock dots
    for (const item of terrain.scatter) {
      const [px, py] = toPx(item.x, item.z);
      if (item.kind === 'pine') {
        ctx.fillStyle = '#154D2B';
        ctx.beginPath();
        ctx.arc(px, py, Math.max(1.8, 1.5 * scaleM), 0, Math.PI * 2);
        ctx.fill();
      } else if (item.kind === 'oak' || item.kind === 'birch' || item.kind === 'tree') {
        ctx.fillStyle = item.kind === 'birch' ? '#85CC4E' : '#2D7A36';
        ctx.beginPath();
        ctx.arc(px, py, Math.max(2.0, 1.7 * scaleM), 0, Math.PI * 2);
        ctx.fill();
      } else if (item.kind === 'bush' || item.kind === 'berryBush') {
        ctx.fillStyle = '#38A169';
        ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
      } else if (item.kind === 'flower') {
        ctx.fillStyle = '#F472B6';
        ctx.fillRect(px - 1, py - 1, 2, 2);
      } else if (item.kind === 'rock') {
        ctx.fillStyle = '#94A3B8';
        ctx.fillRect(px - 1.8, py - 1.8, 3.6, 3.6);
      } else if (item.kind === 'custom') {
        ctx.fillStyle = '#A855F7';
        ctx.beginPath();
        ctx.arc(px, py, 2.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Caves
    for (const cave of terrain.caves ?? []) {
      const [px, py] = toPx(cave.x, cave.z);
      const selected = store.selectedCaveId === cave.id;
      ctx.fillStyle = '#1F1B2E';
      ctx.strokeStyle = selected ? '#FFFFFF' : '#A855F7';
      ctx.lineWidth = selected ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.arc(px, py, Math.max(5, 4.2 * (cave.scale ?? 1) * scaleM), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Placed Entities
    for (const ent of currentLevel.entities) {
      const [wx, wz] = levelBoardToWorld(currentLevel, ent.position);
      const [px, py] = toPx(wx, wz);
      const isSelected = store.selectedEntityID === ent.id;
      ctx.fillStyle =
        ent.kind === 'baddie'
          ? '#F2545B'
          : ent.kind === 'npc'
          ? ent.isBuddy
            ? '#20B46A'
            : '#7C5CFF'
          : ent.buildingBlock || ent.kind === 'door'
          ? '#F59E0B'
          : '#38BDF8';
      ctx.beginPath();
      ctx.arc(px, py, isSelected ? 5.5 : 3.8, 0, Math.PI * 2);
      ctx.fill();
      if (isSelected) {
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // Hover brush ring
    if (hoverWorld && tool !== 'inspect') {
      const [px, py] = toPx(hoverWorld[0], hoverWorld[1]);
      const activeMeta = PAINTER_2D_TOOLS.find((t) => t.id === tool);
      ctx.strokeStyle = activePlacementAssetId ? '#20B46A' : activeMeta?.accent ?? '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(
        px,
        py,
        activePlacementAssetId ? 10 : Math.max(6, brushRadius * scaleM),
        0,
        Math.PI * 2
      );
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }, [
    currentLevel,
    terrain,
    zoom,
    pan,
    hoverWorld,
    tool,
    brushRadius,
    activePlacementAssetId,
    store.selectedEntityID,
    store.selectedWaterBodyId,
    store.selectedCaveId,
    store.selectedRoadId,
  ]);

  const applyStrokeAtPoint = useCallback(
    (wx: number, wz: number, isStart: boolean) => {
      if (activePlacementAssetId) {
        if (isStart) {
          onPlaceCustomAssetAtWorldPoint(activePlacementAssetId, wx, wz);
        }
        return;
      }

      if (tool === 'inspect' && currentLevel) {
        if (!isStart) return;
        // Pick closest entity, cave, or water body near click
        let bestDist = 10;
        let hitEntityId: string | null = null;
        for (const ent of currentLevel.entities) {
          const [ex, ez] = levelBoardToWorld(currentLevel, ent.position);
          const d = Math.hypot(ex - wx, ez - wz);
          if (d < bestDist) {
            bestDist = d;
            hitEntityId = ent.id;
          }
        }
        if (hitEntityId) {
          onSelectEntityFrom2D(hitEntityId);
          return;
        }
        for (const cave of terrain.caves ?? []) {
          if (Math.hypot(cave.x - wx, cave.z - wz) < 12) {
            store.setSelectedCaveId(cave.id);
            store.setActiveWorldDomain('caves');
            return;
          }
        }
        for (const wb of terrain.waterBodies ?? []) {
          if (Math.hypot(wb.center[0] - wx, wb.center[1] - wz) < Math.max(wb.radiusX, 12)) {
            store.setSelectedWaterBodyId(wb.id);
            store.setActiveWorldDomain('water');
            return;
          }
        }
        return;
      }

      if (tool === 'inspect') return;
      const now = performance.now();
      if (!isStart && now - lastStrokeMsRef.current < 65) return;
      lastStrokeMsRef.current = now;
      store.apply2DOverviewStroke(tool, wx, wz, brushRadius, density, isStart, isStart);
    },
    [
      activePlacementAssetId,
      brushRadius,
      currentLevel,
      density,
      onPlaceCustomAssetAtWorldPoint,
      onSelectEntityFrom2D,
      store,
      terrain.caves,
      terrain.waterBodies,
      tool,
    ]
  );

  if (!currentLevel) return null;

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative bg-[#0D2438] select-none overflow-hidden"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(MAKER_ASSET_DRAG_MIME)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(e) => {
        const assetId = e.dataTransfer.getData(MAKER_ASSET_DRAG_MIME);
        if (!assetId) return;
        e.preventDefault();
        const [wx, wz] = screenToWorld(e.clientX, e.clientY);
        onPlaceCustomAssetAtWorldPoint(assetId, wx, wz);
      }}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full block cursor-crosshair touch-none"
        onPointerDown={(e) => {
          if (e.button === 1 || e.button === 2 || e.shiftKey) {
            panningRef.current = {
              startX: e.clientX,
              startY: e.clientY,
              origPan: [...pan] as [number, number],
            };
            return;
          }
          paintingRef.current = true;
          const [wx, wz] = screenToWorld(e.clientX, e.clientY);
          setHoverWorld([wx, wz]);
          applyStrokeAtPoint(wx, wz, true);
        }}
        onPointerMove={(e) => {
          if (panningRef.current) {
            const dx = e.clientX - panningRef.current.startX;
            const dy = e.clientY - panningRef.current.startY;
            setPan([panningRef.current.origPan[0] + dx, panningRef.current.origPan[1] + dy]);
            return;
          }
          const [wx, wz] = screenToWorld(e.clientX, e.clientY);
          setHoverWorld([wx, wz]);
          if (paintingRef.current) {
            applyStrokeAtPoint(wx, wz, false);
          }
        }}
        onPointerUp={() => {
          paintingRef.current = false;
          panningRef.current = null;
        }}
        onPointerLeave={() => {
          paintingRef.current = false;
          panningRef.current = null;
          setHoverWorld(null);
        }}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={(e) => {
          e.preventDefault();
          const factor = e.deltaY < 0 ? 1.12 : 0.89;
          setZoom((z) => Math.max(0.65, Math.min(3.5, z * factor)));
        }}
      />

      {/* Generic 2D World Blocking Palette */}
      <div className="absolute left-3 bottom-3 right-3 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="pointer-events-auto flex flex-wrap items-center gap-1 p-1.5 rounded-2xl bg-[#111521]/95 border border-white/15 shadow-xl max-w-3xl">
          {PAINTER_2D_TOOLS.map((item) => {
            const Icon = item.Icon;
            const active = !activePlacementAssetId && tool === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTool(item.id)}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-xl text-[11px] font-bold transition-colors whitespace-nowrap ${
                  active
                    ? 'text-white shadow-xs'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
                style={active ? { backgroundColor: item.accent } : undefined}
              >
                <Icon size={12} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Brush Radius / Density / Zoom */}
        <div className="pointer-events-auto flex items-center gap-2.5 px-3 py-1.5 rounded-2xl bg-[#111521]/95 border border-white/15 text-white text-[11px] font-bold shadow-xl">
          <label className="inline-flex items-center gap-1.5">
            <span className="text-slate-400">Size</span>
            <input
              type="range"
              min={3}
              max={28}
              step={1}
              value={brushRadius}
              onChange={(e) => setBrushRadius(Number(e.target.value))}
              className="w-16 accent-[#F59E0B]"
            />
            <span className="tabular-nums w-7">{brushRadius}m</span>
          </label>
          <label className="inline-flex items-center gap-1.5">
            <span className="text-slate-400">Density</span>
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={density}
              onChange={(e) => setDensity(Number(e.target.value))}
              className="w-14 accent-[#20B46A]"
            />
          </label>
          <div className="flex items-center gap-0.5 pl-1 border-l border-white/15">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.65, z * 0.85))}
              className="p-1 rounded hover:bg-white/10"
              title="Zoom Out"
            >
              <ZoomOut size={13} />
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(3.5, z * 1.15))}
              className="p-1 rounded hover:bg-white/10"
              title="Zoom In"
            >
              <ZoomIn size={13} />
            </button>
            <button
              type="button"
              onClick={() => {
                setZoom(1);
                setPan([0, 0]);
              }}
              className="p-1 rounded hover:bg-white/10"
              title="Reset Pan & Zoom"
            >
              <RotateCcw size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Hover world coordinates + elevation readout */}
      {hoverWorld && (
        <div className="pointer-events-none absolute bottom-16 left-3 px-2.5 py-1 rounded-lg bg-black/70 text-white text-[10px] font-mono tabular-nums">
          X {hoverWorld[0].toFixed(1)}m · Z {hoverWorld[1].toFixed(1)}m · Y{' '}
          {sampleTerrainHeight(terrain, hoverWorld[0], hoverWorld[1]).toFixed(1)}m
        </div>
      )}
    </div>
  );
};
