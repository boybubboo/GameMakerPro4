import type {
  GameLevel,
  GameProject,
  TerrainData,
  WorldLandRegion,
  WorldMapData,
} from '../types/maker';
import {
  IslandTerrain,
  createDefaultDirtAndRoadConfig,
  createDefaultMountainConfig,
  createInitialTerrain,
  uid,
} from './terrain';

export const WORLD_TERRAIN_YELLOW = '#E5C67E';
export const WORLD_BORDER_GRAY = '#6E7582';

export const LAND_REGION_PALETTE = [
  '#20B46A', // Emerald Meadow
  '#F2545B', // Ember Coral
  '#0EA5E9', // Azure Coast
  '#A855F7', // Mystic Violet
  '#F59E0B', // Sunstone Gold
  '#EC4899', // Blossom Rose
  '#14B8A6', // Seafoam Vale
  '#6366F1', // Twilight Indigo
  '#84CC16', // Moss Highlands
  '#F97316', // Canyon Ochre
];

export type WorldMapBrushMode = 'terrain' | 'eraseTerrain' | 'paintLand' | 'clearLand';

export function createEmptyWorldMap(): WorldMapData {
  const size = IslandTerrain.gridSize;
  const count = (size + 1) * (size + 1);
  return {
    gridSize: size,
    landMask: new Array(count).fill(0),
    regionGrid: new Array(count).fill(0),
    regions: [],
    revision: 1,
  };
}

export function createScratchOceanTerrain(): TerrainData {
  const size = IslandTerrain.gridSize;
  const count = (size + 1) * (size + 1);
  return {
    size,
    heights: new Array(count).fill(IslandTerrain.seaFloor),
    layers: new Array(count).fill(1),
    scatter: [],
    caves: [],
    mountainConfig: createDefaultMountainConfig(),
    waterBodies: [],
    dirtAndRoadConfig: createDefaultDirtAndRoadConfig(),
    roads: [],
    freeformWorld: true,
    revision: 1,
  };
}

export function ensureWorldMapForProject(project: GameProject): WorldMapData {
  const size = IslandTerrain.gridSize;
  const expectedLen = (size + 1) * (size + 1);
  if (
    project.worldMap &&
    project.worldMap.gridSize === size &&
    project.worldMap.landMask.length === expectedLen &&
    project.worldMap.regionGrid.length === expectedLen
  ) {
    return project.worldMap;
  }

  const firstOpenLevel =
    project.levels.find((l) => !l.environmentType || l.environmentType === 'openWorld') ??
    project.levels[0];

  const landMask = new Array<number>(expectedLen).fill(0);
  const regionGrid = new Array<number>(expectedLen).fill(0);
  const regions: WorldLandRegion[] = [];

  if (firstOpenLevel) {
    const srcTerrain = firstOpenLevel.terrain ?? createInitialTerrain();
    const regionCode = 1;
    regions.push({
      id: `region-${firstOpenLevel.id}`,
      code: regionCode,
      name: firstOpenLevel.name || 'Land 1',
      colorHex: LAND_REGION_PALETTE[0],
      levelId: firstOpenLevel.id,
    });
    if (srcTerrain.heights.length === expectedLen) {
      for (let i = 0; i < expectedLen; i++) {
        if (srcTerrain.heights[i] > IslandTerrain.waterLevel - 0.15) {
          landMask[i] = 1;
          regionGrid[i] = regionCode;
        }
      }
    }
  }

  return {
    gridSize: size,
    landMask,
    regionGrid,
    regions,
    revision: 1,
  };
}

export function sampleWorldMapAtWorld(
  worldMap: WorldMapData | undefined,
  x: number,
  z: number
): { land: number; regionCode: number; isBorder: boolean } {
  if (!worldMap || worldMap.landMask.length === 0) {
    return { land: 0, regionCode: 0, isBorder: false };
  }
  const size = worldMap.gridSize;
  const width = size + 1;
  const r = IslandTerrain.radius;
  const col = Math.max(0, Math.min(size, Math.round(((x + r) / (2 * r)) * size)));
  const row = Math.max(0, Math.min(size, Math.round(((z + r) / (2 * r)) * size)));
  const idx = row * width + col;
  const land = worldMap.landMask[idx] ?? 0;
  const regionCode = worldMap.regionGrid[idx] ?? 0;

  let isBorder = false;
  if (land === 1) {
    const neighbors = [
      row > 0 ? (row - 1) * width + col : -1,
      row < size ? (row + 1) * width + col : -1,
      col > 0 ? row * width + (col - 1) : -1,
      col < size ? row * width + (col + 1) : -1,
    ];
    for (const ni of neighbors) {
      if (ni < 0) continue;
      if (worldMap.landMask[ni] === 0 || worldMap.regionGrid[ni] !== regionCode) {
        isBorder = true;
        break;
      }
    }
  }

  return { land, regionCode, isBorder };
}

export function applyWorldMapStroke(
  worldMap: WorldMapData,
  mode: WorldMapBrushMode,
  x: number,
  z: number,
  radius: number,
  regionCode?: number,
  autoFillOcean = false
): WorldMapData {
  const size = worldMap.gridSize;
  const width = size + 1;
  const worldRadius = IslandTerrain.radius;
  const step = (2 * worldRadius) / size;
  const r = Math.max(2, radius);

  const minCol = Math.max(1, Math.floor(((x - r + worldRadius) / (2 * worldRadius)) * size) - 1);
  const maxCol = Math.min(size - 1, Math.ceil(((x + r + worldRadius) / (2 * worldRadius)) * size) + 1);
  const minRow = Math.max(1, Math.floor(((z - r + worldRadius) / (2 * worldRadius)) * size) - 1);
  const maxRow = Math.min(size - 1, Math.ceil(((z + r + worldRadius) / (2 * worldRadius)) * size) + 1);

  const landMask = [...worldMap.landMask];
  const regionGrid = [...worldMap.regionGrid];
  let changed = false;

  for (let row = minRow; row <= maxRow; row++) {
    const vz = -worldRadius + row * step;
    for (let col = minCol; col <= maxCol; col++) {
      const vx = -worldRadius + col * step;
      if (Math.hypot(vx - x, vz - z) > r) continue;
      const idx = row * width + col;

      if (mode === 'terrain') {
        if (landMask[idx] !== 1) {
          landMask[idx] = 1;
          changed = true;
        }
        if (regionCode && regionCode > 0 && regionGrid[idx] !== regionCode) {
          regionGrid[idx] = regionCode;
          changed = true;
        }
      } else if (mode === 'eraseTerrain') {
        if (landMask[idx] !== 0 || regionGrid[idx] !== 0) {
          landMask[idx] = 0;
          regionGrid[idx] = 0;
          changed = true;
        }
      } else if (mode === 'paintLand' && regionCode && regionCode > 0) {
        if (landMask[idx] === 1 || autoFillOcean) {
          if (landMask[idx] !== 1) {
            landMask[idx] = 1;
            changed = true;
          }
          if (regionGrid[idx] !== regionCode) {
            regionGrid[idx] = regionCode;
            changed = true;
          }
        }
      } else if (mode === 'clearLand') {
        if (regionGrid[idx] !== 0) {
          regionGrid[idx] = 0;
          changed = true;
        }
      }
    }
  }

  if (!changed) return worldMap;

  return {
    ...worldMap,
    landMask,
    regionGrid,
    revision: worldMap.revision + 1,
  };
}

export function syncLevelTerrainWithWorldMap(
  rawTerrain: TerrainData | undefined,
  worldMap: WorldMapData,
  activeRegionCode?: number
): TerrainData {
  const base = rawTerrain && rawTerrain.size === worldMap.gridSize
    ? rawTerrain
    : createScratchOceanTerrain();
  const size = base.size;
  const width = size + 1;
  const heights = [...base.heights];
  const layers = [...base.layers];

  for (let row = 0; row <= size; row++) {
    for (let col = 0; col <= size; col++) {
      const idx = row * width + col;
      const hasLand = worldMap.landMask[idx] === 1;

      if (!hasLand) {
        if (heights[idx] > IslandTerrain.waterLevel - 0.6) {
          // Gentle underwater transition if touching a land cell
          const touchesLand =
            (row > 0 && worldMap.landMask[(row - 1) * width + col] === 1) ||
            (row < size && worldMap.landMask[(row + 1) * width + col] === 1) ||
            (col > 0 && worldMap.landMask[row * width + (col - 1)] === 1) ||
            (col < size && worldMap.landMask[row * width + (col + 1)] === 1);
          heights[idx] = touchesLand ? IslandTerrain.waterLevel - 0.7 : IslandTerrain.seaFloor;
        } else {
          heights[idx] = Math.min(heights[idx], IslandTerrain.waterLevel - 0.65);
        }
        layers[idx] = 1;
        continue;
      }

      const cellCode = worldMap.regionGrid[idx] ?? 0;
      const isCoast =
        row === 0 ||
        row === size ||
        col === 0 ||
        col === size ||
        worldMap.landMask[(row - 1) * width + col] === 0 ||
        worldMap.landMask[(row + 1) * width + col] === 0 ||
        worldMap.landMask[row * width + (col - 1)] === 0 ||
        worldMap.landMask[row * width + (col + 1)] === 0;

      const isOtherLand =
        activeRegionCode !== undefined &&
        activeRegionCode > 0 &&
        cellCode !== activeRegionCode;

      if (isOtherLand) {
        // Keep neighboring / bordering lands visible as calm landmass (rendered gray in 2D & 3D)
        if (heights[idx] < IslandTerrain.waterLevel + 0.1) {
          heights[idx] = isCoast ? 0.25 : IslandTerrain.baseTop;
        }
      } else {
        // Active land: preserve sculpted height above sea, raise newly added terrain cells
        if (heights[idx] < IslandTerrain.waterLevel - 0.15) {
          heights[idx] = isCoast ? 0.3 : IslandTerrain.baseTop;
          layers[idx] = isCoast ? 1 : 0;
        }
      }
    }
  }

  return {
    ...base,
    heights,
    layers,
    freeformWorld: true,
    revision: (base.revision ?? 1) + 1,
  };
}

export function computeRegionCentroids(
  worldMap: WorldMapData
): Map<number, { x: number; z: number; cellCount: number }> {
  const size = worldMap.gridSize;
  const width = size + 1;
  const r = IslandTerrain.radius;
  const step = (2 * r) / size;
  const accum = new Map<number, { sx: number; sz: number; count: number }>();

  for (let row = 0; row <= size; row++) {
    const vz = -r + row * step;
    for (let col = 0; col <= size; col++) {
      if (worldMap.landMask[row * width + col] !== 1) continue;
      const code = worldMap.regionGrid[row * width + col] ?? 0;
      if (code <= 0) continue;
      const vx = -r + col * step;
      const entry = accum.get(code);
      if (entry) {
        entry.sx += vx;
        entry.sz += vz;
        entry.count += 1;
      } else {
        accum.set(code, { sx: vx, sz: vz, count: 1 });
      }
    }
  }

  const out = new Map<number, { x: number; z: number; cellCount: number }>();
  accum.forEach((v, code) => {
    if (v.count > 0) {
      out.set(code, {
        x: v.sx / v.count,
        z: v.sz / v.count,
        cellCount: v.count,
      });
    }
  });
  return out;
}

export function findNextRegionCode(regions: WorldLandRegion[]): number {
  const used = new Set(regions.map((r) => r.code));
  for (let c = 1; c < 255; c++) {
    if (!used.has(c)) return c;
  }
  return regions.length + 1;
}

export function pickNextRegionColor(regions: WorldLandRegion[]): string {
  const used = new Set(regions.map((r) => r.colorHex.toUpperCase()));
  for (const hex of LAND_REGION_PALETTE) {
    if (!used.has(hex.toUpperCase())) return hex;
  }
  return LAND_REGION_PALETTE[regions.length % LAND_REGION_PALETTE.length];
}

export function createLandLevelFromTemplate(
  baseLevel: GameLevel | undefined,
  name: string,
  worldMap: WorldMapData,
  regionCode: number
): GameLevel {
  const levelId = uid();
  const terrain = syncLevelTerrainWithWorldMap(createScratchOceanTerrain(), worldMap, regionCode);
  return {
    id: levelId,
    name,
    style: 'openWorld',
    environmentType: 'openWorld',
    visualStyle: baseLevel?.visualStyle ?? 'painterlyPBR',
    biome: baseLevel?.biome ?? 'meadow',
    sky: baseLevel?.sky ?? 'sunny',
    sunAngle: baseLevel?.sunAngle ?? 38,
    timeOfDay: baseLevel?.timeOfDay,
    fog: baseLevel?.fog ?? 0.25,
    hasStart: true,
    hasPortal: true,
    completeCondition: 'reachPortal',
    requiredCount: 0,
    objectives: [
      { id: uid(), text: `Explore ${name}`, isOptional: false },
    ],
    entities: [],
    terrain,
    grass: baseLevel?.grass
      ? { ...baseLevel.grass }
      : {
          enabled: true,
          quality: 'lush',
          viewDistance: 55,
          bladeHeight: 0.72,
          bladeWidth: 0.09,
          windWaveStrength: 0.85,
          tipGlow: 0.22,
          interactiveParting: true,
        },
    audio: baseLevel?.audio
      ? { ...baseLevel.audio }
      : {
          mood: 'adventure',
          coin: 'coin',
          hit: 'hit',
          door: 'creak',
          portal: 'chime',
          jump: 'jump',
          step: 'step',
        },
    weather: 'none',
    vistaPreset: 'coastalArchipelago',
    vistaDensity: 0.7,
    canopyEngine: baseLevel?.canopyEngine ? JSON.parse(JSON.stringify(baseLevel.canopyEngine)) : undefined,
    wind: baseLevel?.wind ?? 0.45,
    canSwim: true,
    notes: '',
    startPoint: { x: 0.5, y: 0.55 },
    portalPoint: { x: 0.56, y: 0.44 },
  };
}
