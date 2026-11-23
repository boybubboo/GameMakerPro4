import * as THREE from 'three';
import type {
  BuildingBlockConfig,
  BuildingMaterialId,
  BuildingShapeId,
  DoorConfig,
  GameLevel,
  LevelEntity,
} from '../types/maker';
import { getTerrainTextureAtlas } from './proceduralTextures';

export interface BuildingMaterialMeta {
  id: BuildingMaterialId;
  label: string;
  swatch: string;
  roughness: number;
  metalness: number;
  category: 'stone' | 'earth' | 'wood' | 'metal';
}

export const BUILDING_MATERIALS: BuildingMaterialMeta[] = [
  { id: 'hewnStone', label: 'Hewn Stone', swatch: '#7D828F', roughness: 0.88, metalness: 0.04, category: 'stone' },
  { id: 'randomCobble', label: 'Cobblestone', swatch: '#767D73', roughness: 0.9, metalness: 0.03, category: 'stone' },
  { id: 'squareFlagstone', label: 'Flagstone', swatch: '#59606D', roughness: 0.86, metalness: 0.04, category: 'stone' },
  { id: 'crackedSlate', label: 'Cracked Slate', swatch: '#454B59', roughness: 0.84, metalness: 0.06, category: 'stone' },
  { id: 'masonryBrick', label: 'Masonry Brick', swatch: '#9A5140', roughness: 0.88, metalness: 0.02, category: 'stone' },
  { id: 'packedDirt', label: 'Packed Dirt', swatch: '#7D6147', roughness: 0.96, metalness: 0.0, category: 'earth' },
  { id: 'timberPlank', label: 'Timber Plank', swatch: '#8B5A34', roughness: 0.82, metalness: 0.02, category: 'wood' },
  { id: 'roundLogs', label: 'Cabin Logs', swatch: '#70482A', roughness: 0.9, metalness: 0.0, category: 'wood' },
  { id: 'rustedIron', label: 'Forged Iron', swatch: '#464C54', roughness: 0.52, metalness: 0.72, category: 'metal' },
];

export interface BuildingShapeMeta {
  id: BuildingShapeId;
  label: string;
  defaultName: string;
  defaultMaterial: BuildingMaterialId;
  stackHeight: number;
  blurb: string;
}

export const BUILDING_SHAPES: BuildingShapeMeta[] = [
  { id: 'wallCube', label: 'Wall Cube', defaultName: 'Stone Wall Cube', defaultMaterial: 'hewnStone', stackHeight: 2.0, blurb: '2×2×2m stackable masonry block' },
  { id: 'halfWall', label: 'Half Wall', defaultName: 'Low Wall', defaultMaterial: 'hewnStone', stackHeight: 1.0, blurb: '2×1m parapet & ledge wall' },
  { id: 'pillar', label: 'Pillar', defaultName: 'Stone Pillar', defaultMaterial: 'hewnStone', stackHeight: 2.0, blurb: '2m column with plinth & capital' },
  { id: 'floorTile', label: 'Floor Tile', defaultName: 'Floor Slab', defaultMaterial: 'squareFlagstone', stackHeight: 0.24, blurb: '2×2m walkable floor tile' },
  { id: 'stairsStraight', label: 'Stairs', defaultName: 'Stone Stairs', defaultMaterial: 'hewnStone', stackHeight: 2.0, blurb: 'Walkable 2m-tall staircase' },
  { id: 'stairsSpiral', label: 'Spiral Stairs', defaultName: 'Spiral Stairs', defaultMaterial: 'hewnStone', stackHeight: 2.0, blurb: 'Turning column & radial steps' },
  { id: 'archway', label: 'Archway', defaultName: 'Stone Archway', defaultMaterial: 'hewnStone', stackHeight: 2.4, blurb: 'Walk-through arched/rect gate' },
  { id: 'windowWall', label: 'Window Wall', defaultName: 'Window Wall', defaultMaterial: 'hewnStone', stackHeight: 2.0, blurb: 'Wall with open, barred or shuttered window' },
  { id: 'trapdoor', label: 'Trapdoor', defaultName: 'Floor Trapdoor', defaultMaterial: 'timberPlank', stackHeight: 0.14, blurb: 'Interactive hinged floor hatch' },
  { id: 'wallTorch', label: 'Wall Torch', defaultName: 'Wall Sconce', defaultMaterial: 'rustedIron', stackHeight: 0.6, blurb: 'Mounted torch with flicker light' },
];

export const DEFAULT_DOOR_CONFIG: DoorConfig = {
  frameShape: 'arched',
  leafStyle: 'woodPlank',
  openMode: 'hingedSide',
  slotStyle: 'none',
  frameMaterial: 'hewnStone',
  requiresKey: false,
};

interface CachedMaterialTexturePair {
  map: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
}

const extraMaterialTextures = new Map<string, CachedMaterialTexturePair>();

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(size = 256): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx];
}

function toColorTex(canvas: HTMLCanvasElement, repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function toDataTex(canvas: HTMLCanvasElement, repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function getTimberPlankTextures(): CachedMaterialTexturePair {
  const cached = extraMaterialTextures.get('timberPlank');
  if (cached) return cached;
  const size = 256;
  const [c, ctx] = makeCanvas(size);
  const [b, bCtx] = makeCanvas(size);
  const rand = mulberry32(4101);

  ctx.fillStyle = '#4B2E19';
  ctx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#303030';
  bCtx.fillRect(0, 0, size, size);

  const planks = 5;
  const ph = size / planks;
  for (let p = 0; p < planks; p++) {
    const y = p * ph + 2;
    const h = ph - 4;
    const baseR = 132 + Math.round((rand() - 0.5) * 26);
    const baseG = 86 + Math.round((rand() - 0.5) * 18);
    const baseB = 48 + Math.round((rand() - 0.5) * 12);
    ctx.fillStyle = `rgb(${baseR}, ${baseG}, ${baseB})`;
    ctx.fillRect(0, y, size, h);
    bCtx.fillStyle = '#C8C8C8';
    bCtx.fillRect(0, y, size, h);

    // Longitudinal grain streaks
    for (let g = 0; g < 22; g++) {
      const gy = y + 3 + rand() * (h - 6);
      const bright = rand() > 0.5;
      ctx.strokeStyle = bright ? 'rgba(204, 152, 102, 0.28)' : 'rgba(56, 32, 16, 0.34)';
      ctx.lineWidth = 1.2 + rand() * 1.4;
      bCtx.strokeStyle = bright ? 'rgba(220,220,220,0.35)' : 'rgba(90,90,90,0.35)';
      bCtx.lineWidth = ctx.lineWidth;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.bezierCurveTo(size * 0.33, gy + (rand() - 0.5) * 5, size * 0.66, gy + (rand() - 0.5) * 5, size, gy);
      ctx.stroke();
      bCtx.beginPath();
      bCtx.moveTo(0, gy);
      bCtx.lineTo(size, gy);
      bCtx.stroke();
    }

    // Iron nails at plank joint
    const jointX = ((p * 97 + 42) % (size - 24)) + 12;
    ctx.fillStyle = 'rgba(28, 20, 14, 0.85)';
    ctx.fillRect(jointX, y, 2, h);
    bCtx.fillStyle = '#242424';
    bCtx.fillRect(jointX, y, 2, h);
    for (const ny of [y + h * 0.28, y + h * 0.72]) {
      ctx.fillStyle = '#2B2F36';
      ctx.beginPath();
      ctx.arc(jointX - 7, ny, 2.2, 0, Math.PI * 2);
      ctx.arc(jointX + 8, ny, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const pair = { map: toColorTex(c), bump: toDataTex(b) };
  extraMaterialTextures.set('timberPlank', pair);
  return pair;
}

function getRoundLogsTextures(): CachedMaterialTexturePair {
  const cached = extraMaterialTextures.get('roundLogs');
  if (cached) return cached;
  const size = 256;
  const [c, ctx] = makeCanvas(size);
  const [b, bCtx] = makeCanvas(size);
  const rand = mulberry32(4202);

  ctx.fillStyle = '#332012';
  ctx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#222222';
  bCtx.fillRect(0, 0, size, size);

  const logs = 4;
  const lh = size / logs;
  for (let l = 0; l < logs; l++) {
    const y0 = l * lh;
    const grad = ctx.createLinearGradient(0, y0, 0, y0 + lh);
    const tone = Math.round((rand() - 0.5) * 14);
    grad.addColorStop(0.0, '#362112');
    grad.addColorStop(0.18, `rgb(${112 + tone}, ${72 + tone}, ${42})`);
    grad.addColorStop(0.45, `rgb(${138 + tone}, ${90 + tone}, ${52})`);
    grad.addColorStop(0.82, `rgb(${84 + tone}, ${52 + tone}, ${30})`);
    grad.addColorStop(1.0, '#2C1A0E');
    ctx.fillStyle = grad;
    ctx.fillRect(0, y0, size, lh);

    const bGrad = bCtx.createLinearGradient(0, y0, 0, y0 + lh);
    bGrad.addColorStop(0.0, '#282828');
    bGrad.addColorStop(0.45, '#EAEAEA');
    bGrad.addColorStop(1.0, '#282828');
    bCtx.fillStyle = bGrad;
    bCtx.fillRect(0, y0, size, lh);

    // Rustic bark grain lines
    for (let g = 0; g < 26; g++) {
      const gy = y0 + 6 + rand() * (lh - 12);
      ctx.strokeStyle = rand() > 0.4 ? 'rgba(42, 24, 12, 0.36)' : 'rgba(176, 124, 80, 0.22)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(size, gy + (rand() - 0.5) * 4);
      ctx.stroke();
    }
  }
  const pair = { map: toColorTex(c), bump: toDataTex(b) };
  extraMaterialTextures.set('roundLogs', pair);
  return pair;
}

function getMasonryBrickTextures(): CachedMaterialTexturePair {
  const cached = extraMaterialTextures.get('masonryBrick');
  if (cached) return cached;
  const size = 256;
  const [c, ctx] = makeCanvas(size);
  const [b, bCtx] = makeCanvas(size);
  const rand = mulberry32(4303);

  ctx.fillStyle = '#736C62';
  ctx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#383838';
  bCtx.fillRect(0, 0, size, size);

  const rows = 8;
  const cols = 4;
  const bh = size / rows;
  const bw = size / cols;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (bw * 0.5);
    for (let col = -1; col <= cols; col++) {
      const x = col * bw + off + 2;
      const y = r * bh + 2;
      const w = bw - 4;
      const h = bh - 4;
      const red = Math.round(138 + rand() * 38);
      const grn = Math.round(68 + rand() * 24);
      const blu = Math.round(52 + rand() * 18);
      ctx.fillStyle = `rgb(${red}, ${grn}, ${blu})`;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(255, 215, 190, 0.14)';
      ctx.fillRect(x, y, w, 3);
      ctx.fillStyle = 'rgba(30, 12, 10, 0.25)';
      ctx.fillRect(x, y + h - 3, w, 3);

      const bv = Math.round(170 + rand() * 48);
      bCtx.fillStyle = `rgb(${bv}, ${bv}, ${bv})`;
      bCtx.fillRect(x, y, w, h);
    }
  }
  const pair = { map: toColorTex(c), bump: toDataTex(b) };
  extraMaterialTextures.set('masonryBrick', pair);
  return pair;
}

function getCrackedSlateTextures(): CachedMaterialTexturePair {
  const cached = extraMaterialTextures.get('crackedSlate');
  if (cached) return cached;
  const size = 256;
  const [c, ctx] = makeCanvas(size);
  const [b, bCtx] = makeCanvas(size);
  const rand = mulberry32(4404);

  ctx.fillStyle = '#2B303A';
  ctx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#404040';
  bCtx.fillRect(0, 0, size, size);

  const rows = 4;
  const cols = 3;
  const bh = size / rows;
  const bw = size / cols;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (bw * 0.35);
    for (let col = -1; col <= cols; col++) {
      const x = col * bw + off + 2;
      const y = r * bh + 2;
      const w = bw - 4;
      const h = bh - 4;
      const lum = Math.round(62 + rand() * 28);
      ctx.fillStyle = `rgb(${lum}, ${lum + 4}, ${lum + 13})`;
      ctx.fillRect(x, y, w, h);
      bCtx.fillStyle = `rgb(${155 + Math.round(rand() * 50)}, 175, 175)`;
      bCtx.fillRect(x, y, w, h);

      // Sharp angular fracture lines
      if (rand() > 0.35) {
        ctx.strokeStyle = 'rgba(18, 20, 28, 0.72)';
        ctx.lineWidth = 1.6;
        bCtx.strokeStyle = '#1E1E1E';
        bCtx.lineWidth = 2.0;
        const sx = x + w * (0.15 + rand() * 0.65);
        const sy = y + h * (0.1 + rand() * 0.35);
        const mx = sx + (rand() - 0.5) * 28;
        const my = sy + h * 0.38;
        const ex = mx + (rand() - 0.5) * 22;
        const ey = y + h - 3;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(mx, my);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        bCtx.beginPath();
        bCtx.moveTo(sx, sy);
        bCtx.lineTo(mx, my);
        bCtx.lineTo(ex, ey);
        bCtx.stroke();
      }
    }
  }
  const pair = { map: toColorTex(c), bump: toDataTex(b) };
  extraMaterialTextures.set('crackedSlate', pair);
  return pair;
}

function getRustedIronTextures(): CachedMaterialTexturePair {
  const cached = extraMaterialTextures.get('rustedIron');
  if (cached) return cached;
  const size = 256;
  const [c, ctx] = makeCanvas(size);
  const [b, bCtx] = makeCanvas(size);
  const rand = mulberry32(4505);

  ctx.fillStyle = '#4B525B';
  ctx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#B8B8B8';
  bCtx.fillRect(0, 0, size, size);

  // Subtle hammered iron mottling & warm oxidation spots
  for (let i = 0; i < 120; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const rad = 6 + rand() * 18;
    const isRust = rand() > 0.62;
    ctx.fillStyle = isRust ? 'rgba(128, 66, 36, 0.24)' : 'rgba(98, 108, 120, 0.24)';
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
    bCtx.fillStyle = isRust ? 'rgba(84, 84, 84, 0.3)' : 'rgba(190, 190, 190, 0.25)';
    bCtx.beginPath();
    bCtx.arc(x, y, rad * 0.8, 0, Math.PI * 2);
    bCtx.fill();
  }

  // Border plate seam + corner rivets
  ctx.strokeStyle = 'rgba(22, 24, 28, 0.8)';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, size - 4, size - 4);
  bCtx.strokeStyle = '#383838';
  bCtx.lineWidth = 5;
  bCtx.strokeRect(2, 2, size - 4, size - 4);

  const rivetCoords = [18, size * 0.5, size - 18];
  for (const rx of rivetCoords) {
    for (const ry of rivetCoords) {
      if (rx === size * 0.5 && ry === size * 0.5) continue;
      ctx.fillStyle = '#6E7684';
      ctx.beginPath();
      ctx.arc(rx, ry, 5, 0, Math.PI * 2);
      ctx.fill();
      bCtx.fillStyle = '#FFFFFF';
      bCtx.beginPath();
      bCtx.arc(rx, ry, 5, 0, Math.PI * 2);
      bCtx.fill();
    }
  }
  const pair = { map: toColorTex(c), bump: toDataTex(b) };
  extraMaterialTextures.set('rustedIron', pair);
  return pair;
}

export function createBuildingSurfaceMaterial(materialId: BuildingMaterialId): THREE.MeshStandardMaterial {
  const atlas = getTerrainTextureAtlas();
  const meta = BUILDING_MATERIALS.find((m) => m.id === materialId) ?? BUILDING_MATERIALS[0];
  let map: THREE.Texture | null = null;
  let bumpMap: THREE.Texture | null = null;
  let bumpScale = 0.08;
  let color = '#FFFFFF';

  switch (materialId) {
    case 'hewnStone':
      map = atlas.castleWall;
      bumpMap = atlas.castleWall;
      bumpScale = 0.08;
      color = '#D8DCE6';
      break;
    case 'randomCobble':
      map = atlas.cobble;
      bumpMap = atlas.cobble;
      bumpScale = 0.11;
      color = '#DFDDD6';
      break;
    case 'squareFlagstone':
      map = atlas.dungeonFlagstone;
      bumpMap = atlas.dungeonFlagstone;
      bumpScale = 0.09;
      color = '#D2D8E4';
      break;
    case 'crackedSlate': {
      const pair = getCrackedSlateTextures();
      map = pair.map;
      bumpMap = pair.bump;
      bumpScale = 0.12;
      break;
    }
    case 'masonryBrick': {
      const pair = getMasonryBrickTextures();
      map = pair.map;
      bumpMap = pair.bump;
      bumpScale = 0.1;
      break;
    }
    case 'packedDirt':
      map = atlas.dirt;
      bumpMap = atlas.dirt;
      bumpScale = 0.06;
      color = '#C9B296';
      break;
    case 'timberPlank': {
      const pair = getTimberPlankTextures();
      map = pair.map;
      bumpMap = pair.bump;
      bumpScale = 0.09;
      break;
    }
    case 'roundLogs': {
      const pair = getRoundLogsTextures();
      map = pair.map;
      bumpMap = pair.bump;
      bumpScale = 0.14;
      break;
    }
    case 'rustedIron': {
      const pair = getRustedIronTextures();
      map = pair.map;
      bumpMap = pair.bump;
      bumpScale = 0.08;
      break;
    }
    default:
      map = atlas.castleWall;
      color = meta.swatch;
      break;
  }

  return new THREE.MeshStandardMaterial({
    color,
    map,
    bumpMap,
    bumpScale,
    roughness: meta.roughness,
    metalness: meta.metalness,
  });
}

function createIronHardwareMaterial(): THREE.MeshStandardMaterial {
  const pair = getRustedIronTextures();
  return new THREE.MeshStandardMaterial({
    color: '#9AA2B0',
    map: pair.map,
    bumpMap: pair.bump,
    bumpScale: 0.06,
    roughness: 0.42,
    metalness: 0.8,
  });
}

function createDarkWoodMaterial(): THREE.MeshStandardMaterial {
  const pair = getTimberPlankTextures();
  return new THREE.MeshStandardMaterial({
    color: '#D6C2AA',
    map: pair.map,
    bumpMap: pair.bump,
    bumpScale: 0.07,
    roughness: 0.8,
    metalness: 0.04,
  });
}

function enableShadows(mesh: THREE.Object3D): void {
  mesh.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
}

/**
 * Builds a modular structural dungeon / cabin building block mesh with
 * subdivided geometries compatible with Wear Intensity denting & Vertex Paint.
 */
export function buildBuildingBlockMesh(config: BuildingBlockConfig): THREE.Group {
  const group = new THREE.Group();
  const mat = createBuildingSurfaceMaterial(config.material);
  const ironMat = createIronHardwareMaterial();
  const trimWoodMat = createDarkWoodMaterial();

  switch (config.shape) {
    case 'wallCube': {
      const cube = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.0, 2.0, 6, 6, 6), mat);
      cube.position.y = 1.0;
      group.add(cube);
      break;
    }

    case 'halfWall': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.9, 0.68, 6, 4, 3), mat);
      body.position.y = 0.45;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.12, 0.76, 6, 1, 2), mat);
      cap.position.y = 0.95;
      group.add(body, cap);
      break;
    }

    case 'pillar': {
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.24, 0.88, 3, 2, 3), mat);
      plinth.position.y = 0.12;
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 1.54, 10, 6), mat);
      shaft.position.y = 1.01;
      const capital = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.22, 0.84, 3, 2, 3), mat);
      capital.position.y = 1.89;
      group.add(plinth, shaft, capital);
      break;
    }

    case 'floorTile': {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.24, 2.0, 6, 2, 6), mat);
      slab.position.y = 0.12;
      group.add(slab);
      break;
    }

    case 'stairsStraight': {
      const stepCount = 8;
      const totalRun = 2.0;
      const totalRise = 2.0;
      const stepDepth = totalRun / stepCount;
      const stepHeight = totalRise / stepCount;
      for (let i = 0; i < stepCount; i++) {
        const h = stepHeight * (i + 1);
        const zCenter = 1.0 - stepDepth * (i + 0.5);
        const tread = new THREE.Mesh(
          new THREE.BoxGeometry(1.96, h, stepDepth + 0.01, 5, Math.max(2, Math.ceil(h * 2)), 2),
          mat
        );
        tread.position.set(0, h * 0.5, zCenter);
        group.add(tread);
      }
      break;
    }

    case 'stairsSpiral': {
      const column = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 2.1, 10, 6), mat);
      column.position.y = 1.05;
      group.add(column);

      const stepCount = 10;
      const totalRise = 2.0;
      const totalTurn = Math.PI * 1.25;
      for (let i = 0; i < stepCount; i++) {
        const frac = (i + 1) / stepCount;
        const yaw = i * (totalTurn / stepCount);
        const h = 0.18;
        const yCenter = frac * totalRise - h * 0.5;
        const pivot = new THREE.Group();
        pivot.position.y = yCenter;
        pivot.rotation.y = yaw;
        const tread = new THREE.Mesh(new THREE.BoxGeometry(1.18, h, 0.44, 4, 2, 2), mat);
        tread.position.x = 0.72;
        pivot.add(tread);
        group.add(pivot);
      }
      break;
    }

    case 'archway': {
      const jambGeo = new THREE.BoxGeometry(0.42, 1.92, 0.7, 3, 6, 3);
      const jambL = new THREE.Mesh(jambGeo, mat);
      jambL.position.set(-0.79, 0.96, 0);
      const jambR = new THREE.Mesh(jambGeo, mat);
      jambR.position.set(0.79, 0.96, 0);
      group.add(jambL, jambR);

      if (config.archStyle === 'rectangular') {
        const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.46, 0.76, 6, 3, 3), mat);
        lintel.position.y = 2.15;
        group.add(lintel);
      } else {
        // 5-voussoir stone arch spanning x = -0.79 .. +0.79
        for (let i = 0; i < 5; i++) {
          const theta = Math.PI * 0.12 + (i / 4) * Math.PI * 0.76;
          const block = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.42, 0.74, 3, 2, 3), mat);
          block.position.set(-Math.cos(theta) * 0.76, 1.72 + Math.sin(theta) * 0.62, 0);
          block.rotation.z = theta - Math.PI / 2;
          group.add(block);
        }
      }
      break;
    }

    case 'windowWall': {
      const sill = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.84, 0.56, 6, 3, 3), mat);
      sill.position.y = 0.42;
      const pierGeo = new THREE.BoxGeometry(0.52, 0.84, 0.56, 3, 4, 3);
      const pierL = new THREE.Mesh(pierGeo, mat);
      pierL.position.set(-0.74, 1.26, 0);
      const pierR = new THREE.Mesh(pierGeo, mat);
      pierR.position.set(0.74, 1.26, 0);
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.34, 0.56, 6, 2, 3), mat);
      lintel.position.y = 1.85;
      const sillLedge = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.66, 4, 1, 2), mat);
      sillLedge.position.y = 0.86;
      group.add(sill, pierL, pierR, lintel, sillLedge);

      const wStyle = config.windowStyle ?? 'barred';
      if (wStyle === 'barred') {
        for (const bx of [-0.28, 0, 0.28]) {
          const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.84, 8), ironMat);
          bar.position.set(bx, 1.26, 0);
          group.add(bar);
        }
        const cross = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.05, 0.07), ironMat);
        cross.position.set(0, 1.26, 0);
        group.add(cross);
      } else if (wStyle === 'shuttered') {
        const shutterGeo = new THREE.BoxGeometry(0.46, 0.8, 0.06, 2, 3, 1);
        const sL = new THREE.Mesh(shutterGeo, trimWoodMat);
        sL.position.set(-0.46, 1.26, 0.32);
        sL.rotation.y = -0.95;
        const sR = new THREE.Mesh(shutterGeo, trimWoodMat);
        sR.position.set(0.46, 1.26, 0.32);
        sR.rotation.y = 0.95;
        group.add(sL, sR);
      }
      break;
    }

    case 'trapdoor': {
      // Heavy frame rim around a recessed shadow pit + hinged leaf
      const rimMat = ironMat;
      const frameN = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.14, 0.18, 4, 1, 1), rimMat);
      frameN.position.set(0, 0.07, -0.74);
      const frameS = frameN.clone();
      frameS.position.z = 0.74;
      const frameW = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 1.32, 1, 1, 4), rimMat);
      frameW.position.set(-0.74, 0.07, 0);
      const frameE = frameW.clone();
      frameE.position.x = 0.74;

      const pit = new THREE.Mesh(
        new THREE.PlaneGeometry(1.3, 1.3),
        new THREE.MeshBasicMaterial({ color: '#090A0E' })
      );
      pit.rotation.x = -Math.PI / 2;
      pit.position.y = 0.02;

      const pivot = new THREE.Group();
      pivot.position.set(0, 0.12, -0.66);
      pivot.userData.trapdoorPivot = true;
      const hatch = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.08, 1.32, 4, 1, 4), mat);
      hatch.position.set(0, 0.0, 0.66);
      const strap1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 1.24), rimMat);
      strap1.position.set(-0.36, 0.01, 0.66);
      const strap2 = strap1.clone();
      strap2.position.x = 0.36;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.024, 6, 12), rimMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, 0.07, 1.12);
      pivot.add(hatch, strap1, strap2, ring);

      group.add(frameN, frameS, frameW, frameE, pit, pivot);
      break;
    }

    case 'wallTorch': {
      const backplate = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.56, 0.08, 2, 2, 1), ironMat);
      backplate.position.set(0, 1.25, -0.2);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.38), ironMat);
      arm.position.set(0, 1.22, -0.02);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.09, 0.12, 8), ironMat);
      collar.position.set(0, 1.28, 0.16);
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.04, 0.64, 8), trimWoodMat);
      stick.position.set(0, 1.36, 0.2);
      stick.rotation.x = 0.28;
      const flameMat = new THREE.MeshStandardMaterial({
        color: '#FFB732',
        emissive: '#FF6A00',
        emissiveIntensity: 1.75,
        roughness: 0.25,
      });
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.36, 8), flameMat);
      flame.position.set(0, 1.78, 0.3);
      flame.userData.torchFlame = true;
      flame.userData.baseY = 1.78;
      group.add(backplate, arm, collar, stick, flame);
      group.userData.hasWallTorchLight = true;
      break;
    }
  }

  enableShadows(group);
  return group;
}

function buildDoorLeafContent(
  leafStyle: DoorConfig['leafStyle'],
  slotStyle: DoorConfig['slotStyle'],
  width: number,
  height: number,
  woodMat: THREE.MeshStandardMaterial,
  ironMat: THREE.MeshStandardMaterial
): THREE.Group {
  const leaf = new THREE.Group();
  const isOpenGrille = leafStyle === 'ironBars' || leafStyle === 'jailCage';

  if (isOpenGrille) {
    const railMat = ironMat;
    const topRail = new THREE.Mesh(new THREE.BoxGeometry(width, 0.09, 0.1, 3, 1, 1), railMat);
    topRail.position.y = height - 0.045;
    const botRail = new THREE.Mesh(new THREE.BoxGeometry(width, 0.09, 0.1, 3, 1, 1), railMat);
    botRail.position.y = 0.045;
    const midRail = new THREE.Mesh(new THREE.BoxGeometry(width, 0.08, 0.09, 3, 1, 1), railMat);
    midRail.position.y = height * 0.5;
    const stileL = new THREE.Mesh(new THREE.BoxGeometry(0.08, height, 0.1, 1, 4, 1), railMat);
    stileL.position.set(-width * 0.5 + 0.04, height * 0.5, 0);
    const stileR = stileL.clone();
    stileR.position.x = width * 0.5 - 0.04;
    leaf.add(topRail, botRail, midRail, stileL, stileR);

    const barCount = leafStyle === 'jailCage' ? Math.max(4, Math.round(width * 6.2)) : Math.max(3, Math.round(width * 4.2));
    for (let i = 1; i < barCount; i++) {
      const bx = -width * 0.5 + (i / barCount) * width;
      const bar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.026, 0.026, height - 0.08, 8),
        railMat
      );
      bar.position.set(bx, height * 0.5, 0);
      leaf.add(bar);
    }

    if (leafStyle === 'jailCage') {
      for (const hy of [height * 0.26, height * 0.74]) {
        const cross = new THREE.Mesh(new THREE.BoxGeometry(width, 0.055, 0.075, 3, 1, 1), railMat);
        cross.position.y = hy;
        leaf.add(cross);
      }
      const lockPlate = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.24, 0.14), railMat);
      lockPlate.position.set(width * 0.25, height * 0.48, 0);
      leaf.add(lockPlate);
    }
    return leaf;
  }

  const baseMat = leafStyle === 'solidMetal' ? ironMat : woodMat;
  const trimMat = ironMat;
  const thickness = 0.14;

  if (slotStyle === 'none') {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(width, height, thickness, 4, 6, 2), baseMat);
    slab.position.y = height * 0.5;
    leaf.add(slab);
  } else {
    // Build solid door around an actual see-through cutout at eye height
    const slitH = slotStyle === 'peepSlot' ? 0.14 : 0.44;
    const slitW = Math.min(width * 0.58, slotStyle === 'peepSlot' ? 0.42 : 0.46);
    const slitY = slotStyle === 'peepSlot' ? 1.48 : 1.42;
    const botH = slitY - slitH * 0.5;
    const topH = Math.max(0.15, height - (slitY + slitH * 0.5));
    const sideW = Math.max(0.06, (width - slitW) * 0.5);

    const lower = new THREE.Mesh(new THREE.BoxGeometry(width, botH, thickness, 4, 4, 2), baseMat);
    lower.position.y = botH * 0.5;
    const upper = new THREE.Mesh(new THREE.BoxGeometry(width, topH, thickness, 4, 2, 2), baseMat);
    upper.position.y = height - topH * 0.5;
    const sideL = new THREE.Mesh(new THREE.BoxGeometry(sideW, slitH, thickness, 2, 2, 1), baseMat);
    sideL.position.set(-width * 0.5 + sideW * 0.5, slitY, 0);
    const sideR = sideL.clone();
    sideR.position.x = width * 0.5 - sideW * 0.5;
    leaf.add(lower, upper, sideL, sideR);

    // Frame & iron grille inside the cutout
    const rimTop = new THREE.Mesh(new THREE.BoxGeometry(slitW + 0.06, 0.04, thickness + 0.03), trimMat);
    rimTop.position.set(0, slitY + slitH * 0.5, 0);
    const rimBot = rimTop.clone();
    rimBot.position.y = slitY - slitH * 0.5;
    leaf.add(rimTop, rimBot);

    const bars = slotStyle === 'peepSlot' ? 2 : 3;
    for (let i = 1; i <= bars; i++) {
      const bx = -slitW * 0.5 + (i / (bars + 1)) * slitW;
      const grilleBar = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, slitH, 6), trimMat);
      grilleBar.position.set(bx, slitY, 0);
      leaf.add(grilleBar);
    }
  }

  // Iron reinforcing bands & handle ring
  for (const by of [0.42, height - 0.34]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(width + 0.01, 0.09, thickness + 0.03, 4, 1, 1), trimMat);
    band.position.y = by;
    leaf.add(band);
  }
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.08, 0.02, 6, 12),
    new THREE.MeshStandardMaterial({ color: '#D4A838', roughness: 0.32, metalness: 0.85 })
  );
  ring.position.set(width * 0.32, 0.94, thickness * 0.6);
  leaf.add(ring);

  return leaf;
}

export interface DoorAnimationControl {
  openMode: DoorConfig['openMode'];
  pivotLeft?: THREE.Group;
  pivotRight?: THREE.Group;
  slidingLeaf?: THREE.Group;
  openProgress: number;
}

/**
 * Builds a modular doorway with rectangular/arched masonry frame, selectable leaf style
 * (wood plank, metal, iron bars, jail cage), window/peep slot, and animated hinge/split/slide pivots.
 */
export function buildModularDoorMesh(doorConfig: DoorConfig): THREE.Group {
  const group = new THREE.Group();
  const frameMat = createBuildingSurfaceMaterial(doorConfig.frameMaterial ?? 'hewnStone');
  const woodMat = createDarkWoodMaterial();
  const ironMat = createIronHardwareMaterial();

  // Frame jambs (outer width ~2.0m, inner clear doorway 1.28m wide × 2.02m tall)
  const jambGeo = new THREE.BoxGeometry(0.36, 2.06, 0.56, 3, 6, 3);
  const jambL = new THREE.Mesh(jambGeo, frameMat);
  jambL.position.set(-0.82, 1.03, 0);
  const jambR = new THREE.Mesh(jambGeo, frameMat);
  jambR.position.set(0.82, 1.03, 0);
  group.add(jambL, jambR);

  if (doorConfig.frameShape === 'arched') {
    for (let i = 0; i < 5; i++) {
      const theta = Math.PI * 0.14 + (i / 4) * Math.PI * 0.72;
      const block = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.38, 0.6, 3, 2, 2), frameMat);
      block.position.set(-Math.cos(theta) * 0.78, 1.82 + Math.sin(theta) * 0.52, 0);
      block.rotation.z = theta - Math.PI / 2;
      group.add(block);
    }
  } else {
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.38, 0.6, 6, 2, 2), frameMat);
    lintel.position.y = 2.22;
    group.add(lintel);
  }

  const clearW = 1.28;
  const clearH = 2.02;
  const control: DoorAnimationControl = {
    openMode: doorConfig.openMode,
    openProgress: 0,
  };

  if (doorConfig.openMode === 'doubleSplit') {
    const halfW = clearW * 0.5 - 0.01;
    const pivotL = new THREE.Group();
    pivotL.position.set(-clearW * 0.5, 0, 0);
    const leafL = buildDoorLeafContent(doorConfig.leafStyle, doorConfig.slotStyle, halfW, clearH, woodMat, ironMat);
    leafL.position.x = halfW * 0.5;
    pivotL.add(leafL);

    const pivotR = new THREE.Group();
    pivotR.position.set(clearW * 0.5, 0, 0);
    const leafR = buildDoorLeafContent(doorConfig.leafStyle, doorConfig.slotStyle, halfW, clearH, woodMat, ironMat);
    leafR.position.x = -halfW * 0.5;
    leafR.scale.x = -1;
    pivotR.add(leafR);

    group.add(pivotL, pivotR);
    control.pivotLeft = pivotL;
    control.pivotRight = pivotR;
  } else if (doorConfig.openMode === 'sliding') {
    const slideGroup = new THREE.Group();
    const leaf = buildDoorLeafContent(doorConfig.leafStyle, doorConfig.slotStyle, clearW, clearH, woodMat, ironMat);
    slideGroup.add(leaf);
    group.add(slideGroup);
    control.slidingLeaf = slideGroup;
  } else {
    const pivotL = new THREE.Group();
    pivotL.position.set(-clearW * 0.5, 0, 0);
    const leaf = buildDoorLeafContent(doorConfig.leafStyle, doorConfig.slotStyle, clearW, clearH, woodMat, ironMat);
    leaf.position.x = clearW * 0.5;
    pivotL.add(leaf);
    group.add(pivotL);
    control.pivotLeft = pivotL;
  }

  if (doorConfig.requiresKey) {
    const lock = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.22, 0.22),
      new THREE.MeshStandardMaterial({ color: '#F2C230', metalness: 0.85, roughness: 0.25 })
    );
    lock.position.set(doorConfig.openMode === 'doubleSplit' ? 0 : 0.42, 0.96, 0.04);
    (control.pivotLeft ?? control.slidingLeaf ?? group).add(lock);
  }

  group.userData.doorControl = control;
  enableShadows(group);
  return group;
}

export function applyDoorOpenAnimation(root: THREE.Object3D, isOpen: boolean, dt: number): void {
  const control = root.userData?.doorControl as DoorAnimationControl | undefined;
  if (control) {
    const target = isOpen ? 1 : 0;
    const speed = Math.min(1, dt * 8.5);
    control.openProgress += (target - control.openProgress) * speed;
    const p = control.openProgress;
    if (control.openMode === 'sliding' && control.slidingLeaf) {
      control.slidingLeaf.position.y = p * 2.02;
    } else if (control.openMode === 'doubleSplit') {
      if (control.pivotLeft) control.pivotLeft.rotation.y = -p * (Math.PI * 0.52);
      if (control.pivotRight) control.pivotRight.rotation.y = p * (Math.PI * 0.52);
    } else if (control.pivotLeft) {
      control.pivotLeft.rotation.y = -p * (Math.PI * 0.52);
    }
    return;
  }

  // Fallback for legacy wooden castle doors + trapdoors
  root.traverse((child) => {
    if (child.userData?.doorLeaf) {
      child.visible = !isOpen;
    }
    if (child.userData?.trapdoorPivot) {
      const targetRot = isOpen ? -Math.PI * 0.48 : 0;
      child.rotation.x += (targetRot - child.rotation.x) * Math.min(1, dt * 9);
    }
  });
}

export function getBuildingShapeStackHeight(shape: BuildingShapeId): number {
  return BUILDING_SHAPES.find((s) => s.id === shape)?.stackHeight ?? 2.0;
}

/**
 * Computes exact walkable floor height across modular floor tiles, wall cube tops,
 * straight stairs, spiral stairs, and closed trapdoors using a step-up ceiling guard
 * so multi-story interiors allow walking underneath upper floors without snapping up!
 */
export function sampleBuildingSurfaceY(
  ent: LevelEntity,
  wx: number,
  wz: number,
  baseY: number,
  actorX: number,
  actorZ: number,
  actorY: number,
  isOpened = false
): number | null {
  const bb = ent.buildingBlock;
  if (!bb) return null;
  const s = Math.max(0.25, ent.scale ?? 1);
  const yaw = ((ent.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const dx = actorX - wx;
  const dz = actorZ - wz;
  // Rotate world delta into entity local space (inverse Y rotation)
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;
  const maxStepUp = 0.78;

  switch (bb.shape) {
    case 'floorTile': {
      const half = 1.04 * s;
      if (Math.abs(lx) <= half && Math.abs(lz) <= half) {
        const topY = baseY + 0.24 * s;
        if (topY <= actorY + maxStepUp) return topY;
      }
      return null;
    }
    case 'wallCube': {
      const half = 1.0 * s;
      if (Math.abs(lx) <= half && Math.abs(lz) <= half) {
        const topY = baseY + 2.0 * s;
        if (topY <= actorY + maxStepUp) return topY;
      }
      return null;
    }
    case 'halfWall': {
      if (Math.abs(lx) <= 1.02 * s && Math.abs(lz) <= 0.38 * s) {
        const topY = baseY + 1.01 * s;
        if (topY <= actorY + maxStepUp) return topY;
      }
      return null;
    }
    case 'trapdoor': {
      if (isOpened) return null;
      const half = 0.82 * s;
      if (Math.abs(lx) <= half && Math.abs(lz) <= half) {
        const topY = baseY + 0.16 * s;
        if (topY <= actorY + maxStepUp) return topY;
      }
      return null;
    }
    case 'stairsStraight': {
      const halfW = 1.04 * s;
      const halfD = 1.08 * s;
      if (Math.abs(lx) <= halfW && Math.abs(lz) <= halfD) {
        // Front bottom at lz = +1.0*s, top step at lz = -1.0*s
        const t = THREE.MathUtils.clamp((1.0 * s - lz) / (2.0 * s), 0, 1);
        const stairY = baseY + (0.12 + t * 1.9) * s;
        if (stairY <= actorY + 0.95) return stairY;
      }
      return null;
    }
    case 'stairsSpiral': {
      const r = Math.hypot(lx, lz);
      if (r >= 0.22 * s && r <= 1.38 * s) {
        // Steps start at angle 0 (+X) and wind 225° counter-clockwise
        let ang = Math.atan2(-lz, lx);
        if (ang < -0.35) ang += Math.PI * 2;
        const maxTurn = Math.PI * 1.25;
        if (ang >= -0.35 && ang <= maxTurn + 0.35) {
          const t = THREE.MathUtils.clamp(ang / maxTurn, 0, 1);
          const stairY = baseY + (0.14 + t * 1.88) * s;
          if (stairY <= actorY + 0.95) return stairY;
        }
      }
      return null;
    }
    default:
      return null;
  }
}
