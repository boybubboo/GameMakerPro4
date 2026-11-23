import React, { useMemo, useState } from 'react';
import {
  Box,
  Clock,
  Layers,
  Map as MapIcon,
  MessageCircle,
  Mountain,
  Move,
  Paintbrush,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Scaling,
  Sparkles,
  Trash2,
  Trees,
} from 'lucide-react';
import {
  BUILTIN_FX_EFFECT_LIBRARY,
  createCustomFxTemplate,
  loadCustomFxTemplates,
  saveCustomFxTemplates,
  type FxLibraryTemplate,
} from '../../data/fxEffectLibrary';
import { createDefaultFxEmitterConfig } from '../../data/fxEmitterPresets';
import {
  Biomes,
  CameraModes,
  CompleteConditions,
  EntityKindMeta,
  EnvironmentTypes,
  MusicMoodOptions,
  SkyPresets,
  StorybookThemeCatalog,
  VisualStyles,
  VistaPresets,
  VistaPropKinds,
  WeatherOptions,
  defaultStorybookConfig,
} from '../../data/registries';
import { DEFAULT_ROGUELIKE_CONFIG } from '../../data/roguelikeEngine';
import {
  DUNGEON_FLOOR_STYLE_META,
  DUNGEON_PROP_STYLE_META,
  DUNGEON_THEME_PRESETS,
  DUNGEON_TRAP_STYLE_META,
  DUNGEON_WALL_STYLE_META,
  DungeonGenerator,
  applyDungeonStyleToLevel,
  resolveDungeonStyle,
} from '../../services/DungeonGenerator';
import type { MakerStore } from '../../store/useMakerStore';
import type {
  BuildingMaterialId,
  BuildingShapeId,
  CameraMode,
  CarPresetId,
  CreatureBodyId,
  DoorConfig,
  DoorFrameShape,
  DoorLeafStyle,
  DoorOpenMode,
  DoorSlotStyle,
  DriverTypeId,
  DrivingCameraView,
  DrivingPhysicsId,
  DungeonFloorStyle,
  DungeonPropStyle,
  DungeonTrapStyle,
  DungeonWallStyle,
  EntityKind,
  EnvironmentType,
  GameplayMode,
  GrassFieldConfig,
  GrassQuality,
  PropPresetId,
  StorybookThemeId,
  TerrainBrush,
  ViewportTool,
  VisualStyleId,
  VistaPresetId,
  VistaPropItem,
  VistaPropKind,
} from '../../types/maker';
import {
  BUILDING_MATERIALS,
  BUILDING_SHAPES,
  DEFAULT_DOOR_CONFIG,
} from '../../three/buildingBlocks';
import {
  CAR_PRESETS,
  DRIVER_TYPES,
  DRIVING_CAMERA_VIEWS,
  DRIVING_PHYSICS_PRESETS,
} from '../../three/vehicleModels';
import { WEATHERING_PRESETS } from '../../three/nodeMaterialUtils';
import { resolveGrassConfig } from '../../three/stylizedGrassSystem';
import {
  applySlopeAutoWeathering,
  createInitialTerrain,
  getEnvironmentType,
  uid,
} from '../../utils/terrain';
import { CanopyTreeInspector } from '../shared/CanopyTreeInspector';
import { AssetThumbnail } from '../shared/AssetThumbnail';
import { ChatBubbleStudioModal } from '../shared/ChatBubbleStudioModal';
import { DialogueVoiceEditor } from '../shared/DialogueVoiceEditor';
import { EntityItemAssignPanel } from '../shared/EntityItemAssignPanel';
import { FxEmitterInspector } from '../shared/FxEmitterInspector';
import { MakerIcon } from '../shared/IconMap';
import { FieldLabel, MakerCard } from '../shared/MakerUI';
import { CanopyEngineModal } from '../world/CanopyEngineModal';
import { FxLibraryPanel } from '../world/FxLibraryPanel';
import { LevelMapModal } from '../world/LevelMapModal';
import { PostProcessingPanel } from '../world/PostProcessingPanel';
import { TextureStudioModal } from '../world/TextureStudioModal';
import { VertexPaintModal } from '../world/VertexPaintModal';
import { WorldViewport3D } from '../world/WorldViewport3D';

const TerrainBrushes: {
  id: TerrainBrush;
  title: string;
  group: 'shape' | 'paint' | 'degrade' | 'scatter';
}[] = [
  { id: 'raiseGround', title: 'Raise', group: 'shape' },
  { id: 'lowerGround', title: 'Lower', group: 'shape' },
  { id: 'smoothGround', title: 'Smooth', group: 'shape' },
  { id: 'flattenGround', title: 'Flatten', group: 'shape' },
  { id: 'plateauCliff', title: 'Cliff', group: 'shape' },
  { id: 'carveRiver', title: 'River', group: 'shape' },
  { id: 'carveCave', title: 'Cave', group: 'shape' },
  { id: 'paintGrass', title: 'Grass', group: 'paint' },
  { id: 'paintDirt', title: 'Dirt', group: 'paint' },
  { id: 'paintMoss', title: 'Moss', group: 'paint' },
  { id: 'paintCobble', title: 'Cobble', group: 'paint' },
  { id: 'paintSand', title: 'Sand', group: 'paint' },
  { id: 'paintRock', title: 'Rock', group: 'paint' },
  { id: 'paintSnow', title: 'Snow', group: 'paint' },
  { id: 'weatherCracks', title: 'Cracks', group: 'degrade' },
  { id: 'weatherErode', title: 'Erode Cliff', group: 'degrade' },
  { id: 'weatherMoss', title: 'Moss', group: 'degrade' },
  { id: 'weatherScorch', title: 'Scorch', group: 'degrade' },
  { id: 'weatherMud', title: 'Mud', group: 'degrade' },
  { id: 'weatherFrost', title: 'Frost', group: 'degrade' },
  { id: 'weatherClear', title: 'Clean', group: 'degrade' },
  { id: 'scatterTree', title: 'Trees', group: 'scatter' },
  { id: 'scatterRock', title: 'Rocks', group: 'scatter' },
  { id: 'scatterFlower', title: 'Flowers', group: 'scatter' },
  { id: 'scatterCustom', title: 'Custom GLB', group: 'scatter' },
];

const DropKinds: EntityKind[] = [
  'pickup',
  'baddie',
  'npc',
  'treasure',
  'key',
  'door',
  'trap',
  'puzzle',
  'platform',
  'prop',
  'scenery',
  'light',
  'fxEmitter',
  'checkpoint',
];

function formatClock(hour: number): string {
  const h = Math.floor(hour) % 24;
  const m = Math.round((hour - Math.floor(hour)) * 60) % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

export const WorldStage: React.FC<{ store: MakerStore }> = ({ store }) => {
  const { currentProject, currentLevel, currentEntity } = store;
  const tool = store.worldTool;
  const setTool = store.setWorldTool;
  const brush = store.terrainBrush;
  const setBrush = store.setTerrainBrush;
  const brushRadius = store.terrainBrushRadius;
  const setBrushRadius = store.setTerrainBrushRadius;
  const scatterAssetId = store.terrainScatterAssetId;
  const setScatterAssetId = store.setTerrainScatterAssetId;
  const brushGroup: 'shape' | 'paint' | 'degrade' | 'scatter' = useMemo(() => {
    const found = TerrainBrushes.find((b) => b.id === brush);
    return found?.group ?? 'shape';
  }, [brush]);
  const [dropKind, setDropKind] = useState<EntityKind>('treasure');
  const [dropCustomAssetId, setDropCustomAssetId] = useState<string>('');
  const [addPaletteMode, setAddPaletteMode] = useState<'blocks' | 'entities'>('blocks');
  const [activeBuildShape, setActiveBuildShape] = useState<BuildingShapeId | 'door'>('wallCube');
  const [activeBuildMaterial, setActiveBuildMaterial] = useState<BuildingMaterialId>('hewnStone');
  const [vistaCustomAssetId, setVistaCustomAssetId] = useState<string>('');
  const [showingMap, setShowingMap] = useState(false);
  const [newObjective, setNewObjective] = useState('');
  const [fxBurstSignal, setFxBurstSignal] = useState<{ entityId: string; nonce: number } | null>(
    null
  );
  const [showingFxLibrary, setShowingFxLibrary] = useState(true);
  const [showingCanopyEngine, setShowingCanopyEngine] = useState(false);
  const [showingTextureStudio, setShowingTextureStudio] = useState(false);
  const [chatBubbleTargetId, setChatBubbleTargetId] = useState<string | null>(null);
  const [vertexPaintTargetId, setVertexPaintTargetId] = useState<'forestTree' | string | null>(
    null
  );
  const [customFxTemplates, setCustomFxTemplates] = useState<FxLibraryTemplate[]>(
    loadCustomFxTemplates
  );
  const [draggingFxTemplate, setDraggingFxTemplate] = useState<FxLibraryTemplate | null>(null);
  const [placeFxTemplateId, setPlaceFxTemplateId] = useState<string | null>(null);

  const allFxTemplates = useMemo(
    () => [...BUILTIN_FX_EFFECT_LIBRARY, ...customFxTemplates],
    [customFxTemplates]
  );

  const activePlaceFxTemplate = useMemo(
    () => allFxTemplates.find((t) => t.id === placeFxTemplateId) ?? null,
    [allFxTemplates, placeFxTemplateId]
  );

  const triggerFxBurst = (entityId: string) =>
    setFxBurstSignal((prev) => ({ entityId, nonce: (prev?.nonce ?? 0) + 1 }));

  const handleDropFxTemplate = (templateId: string, pos: { x: number; y: number }) => {
    const tpl = allFxTemplates.find((t) => t.id === templateId);
    setDraggingFxTemplate(null);
    if (!tpl) return;
    store.addFxTemplateAtPoint(tpl, pos);
    setPlaceFxTemplateId(null);
    setTool('move');
  };

  const handleSaveEntityToFxLibrary = (ent: typeof currentEntity) => {
    if (!ent || ent.kind !== 'fxEmitter') return;
    const cfg = ent.fxEmitter ?? createDefaultFxEmitterConfig('fire');
    const customTpl = createCustomFxTemplate(ent.name, cfg, ent.scale);
    setCustomFxTemplates((prev) => {
      const next = [customTpl, ...prev];
      saveCustomFxTemplates(next);
      return next;
    });
    setShowingFxLibrary(true);
  };

  const handleDeleteCustomFxTemplate = (templateId: string) => {
    setCustomFxTemplates((prev) => {
      const next = prev.filter((t) => t.id !== templateId);
      saveCustomFxTemplates(next);
      return next;
    });
    if (placeFxTemplateId === templateId) {
      setPlaceFxTemplateId(null);
    }
  };

  const activeVistaAssetId = useMemo(
    () => vistaCustomAssetId || store.customAssets[0]?.id || '',
    [vistaCustomAssetId, store.customAssets]
  );

  const activeScatterAssetId = useMemo(
    () => scatterAssetId || store.customAssets[0]?.id || '',
    [scatterAssetId, store.customAssets]
  );

  if (!currentProject || !currentLevel) return null;

  const envType = getEnvironmentType(currentLevel);
  const visualStyle: VisualStyleId = currentLevel.visualStyle ?? 'painterlyPBR';
  const cameraMode: CameraMode =
    currentLevel.cameraMode ?? (envType === 'sideScroller' ? 'sideScroll' : 'front');
  const timeOfDay = currentLevel.timeOfDay ?? 12;
  const activeTool: ViewportTool = envType !== 'openWorld' && tool === 'terrain' ? 'move' : tool;

  const tools: { id: ViewportTool; label: string; icon: React.ReactNode }[] = [
    { id: 'move', label: 'Move', icon: <Move size={14} /> },
    { id: 'rotate', label: 'Turn', icon: <RotateCw size={14} /> },
    { id: 'scale', label: 'Resize', icon: <Scaling size={14} /> },
    ...(envType === 'openWorld'
      ? [{ id: 'terrain' as const, label: 'Ground', icon: <Mountain size={14} /> }]
      : []),
    { id: 'add', label: 'Drop', icon: <Plus size={14} /> },
  ];

  const handleAddObjective = () => {
    const clean = newObjective.trim();
    if (!clean) return;
    store.updateLevel('add goal', (lvl) => ({
      ...lvl,
      objectives: [...lvl.objectives, { id: uid(), text: clean, isOptional: false }],
    }));
    setNewObjective('');
  };

  const selectedEntityCustom = currentEntity?.customAssetId
    ? store.customAssets.find((a) => a.id === currentEntity.customAssetId)
    : null;

  const vistaPreset: VistaPresetId = currentLevel.vistaPreset ?? (envType === 'openWorld' || envType === 'castle' ? 'alpineValley' : 'none');
  const vistaDensity = currentLevel.vistaDensity ?? 0.85;
  const vistaItems = currentLevel.vistaItems ?? [];
  const vistaMinDist = envType === 'castle' ? 120 : 206;
  const vistaMaxDist = envType === 'castle' ? 280 : 380;

  const handleAddVistaItem = (kind: VistaPropKind, customAssetId?: string, label?: string) => {
    const defaultName =
      label ??
      (customAssetId
        ? store.customAssets.find((a) => a.id === customAssetId)?.name ?? 'Custom Landmark'
        : VistaPropKinds.find((k) => k.id === kind)?.title ?? 'Landmark');
    store.updateLevel('add vista landmark', (lvl) => {
      const existing = lvl.vistaItems ?? [];
      const nextItem: VistaPropItem = {
        id: uid(),
        kind,
        name: defaultName,
        angle: (existing.length * 53 + 28) % 360,
        distance: envType === 'castle' ? 148 : 238,
        scale: customAssetId ? 1.4 : kind === 'mountain' ? 1.15 : 1.35,
        ...(customAssetId ? { customAssetId } : {}),
      };
      return {
        ...lvl,
        vistaItems: [...existing, nextItem],
      };
    });
  };

  return (
    <div className="h-full min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden maker-scroll">
      {/* Left sidebar: Level settings */}
      <aside className="w-full lg:w-76 shrink-0 lg:h-full lg:min-h-0 bg-white dark:bg-[#171A23] border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-white/[0.08] lg:overflow-y-auto maker-scroll p-4 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-extrabold">Level world</h2>
          <button
            type="button"
            onClick={() => setShowingMap(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#7C5CFF]/15 text-[#7C5CFF] text-xs font-bold hover:bg-[#7C5CFF]/25"
          >
            <MapIcon size={13} />
            <span>Map</span>
          </button>
        </div>

        {/* Level name */}
        <div className="space-y-1.5">
          <FieldLabel text="Level name" />
          <input
            type="text"
            value={currentLevel.name}
            onChange={(e) =>
              store.updateLevel('rename level', (lvl) => ({ ...lvl, name: e.target.value }), false)
            }
            className="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-[#1F2430] border border-slate-200/60 dark:border-white/[0.06] text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]"
          />
        </div>

        {/* Scene Environment Type */}
        <div className="space-y-1.5">
          <FieldLabel text="Scene environment" />
          <div className="grid grid-cols-2 gap-1.5">
            {EnvironmentTypes.map((et) => {
              const active = envType === et.id;
              return (
                <button
                  key={et.id}
                  type="button"
                  title={et.blurb}
                  onClick={() => {
                    const nextEnv = et.id as EnvironmentType;
                    if (nextEnv !== 'openWorld' && tool === 'terrain') {
                      setTool('move');
                    }
                    store.updateLevel('change scene environment', (lvl) => {
                      const nextCam: CameraMode =
                        nextEnv === 'sideScroller'
                          ? 'sideScroll'
                          : lvl.cameraMode === 'sideScroll' || !lvl.cameraMode
                          ? 'front'
                          : lvl.cameraMode;
                      const nextSky =
                        nextEnv === 'dungeon'
                          ? 'cave'
                          : nextEnv === 'scifi'
                          ? 'night'
                          : lvl.sky === 'cave'
                          ? 'sunny'
                          : lvl.sky;
                      return {
                        ...lvl,
                        environmentType: nextEnv,
                        cameraMode: nextCam,
                        sky: nextSky,
                      };
                    });
                  }}
                  className={`px-2.5 py-2 rounded-xl text-[11px] font-bold border text-left transition-colors ${
                    active
                      ? 'border-[#7C5CFF] bg-[#7C5CFF]/15 text-[#7C5CFF]'
                      : 'border-transparent bg-slate-100 dark:bg-[#1F2430] text-slate-600 dark:text-[#949BB0] hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {et.title}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-500 dark:text-[#8E96AB] leading-snug">
            {EnvironmentTypes.find((e) => e.id === envType)?.blurb}
          </p>
        </div>

        {/* Visual Style */}
        <div className="space-y-1.5">
          <FieldLabel text="3D Visual Style" />
          <div className="grid grid-cols-3 gap-1.5">
            {VisualStyles.map((st) => {
              const active = visualStyle === st.id;
              return (
                <button
                  key={st.id}
                  type="button"
                  title={st.blurb}
                  onClick={() =>
                    store.updateLevel('change visual style', (lvl) => ({
                      ...lvl,
                      visualStyle: st.id,
                    }))
                  }
                  className={`px-2 py-2 rounded-xl text-[11px] font-bold border transition-colors ${
                    active
                      ? 'border-[#7C5CFF] bg-[#7C5CFF]/15 text-[#7C5CFF]'
                      : 'border-transparent bg-slate-100 dark:bg-[#1F2430] text-slate-600 dark:text-[#949BB0]'
                  }`}
                >
                  {st.title.split(' ')[0]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Time of Day & Day-Night Cycle */}
        <div className="space-y-2 p-3 rounded-2xl bg-slate-100 dark:bg-[#1F2430] border border-slate-200/70 dark:border-white/[0.06]">
          <div className="flex items-center justify-between">
            <FieldLabel text="Time of day" />
            <span className="inline-flex items-center gap-1 text-xs font-mono font-bold text-[#F59E0B]">
              <Clock size={11} />
              {currentLevel.timeOfDay !== undefined ? formatClock(timeOfDay) : 'Preset'}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={23.75}
            step={0.25}
            value={timeOfDay}
            onChange={(e) =>
              store.updateLevel(
                'set time of day',
                (lvl) => ({ ...lvl, timeOfDay: Number(e.target.value) }),
                false
              )
            }
            className="w-full accent-[#F59E0B]"
          />
          <div className="flex items-center justify-between text-[11px] font-semibold">
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(currentLevel.autoCycleTime)}
                onChange={(e) =>
                  store.updateLevel('toggle day night cycle', (lvl) => ({
                    ...lvl,
                    timeOfDay: lvl.timeOfDay ?? 12,
                    autoCycleTime: e.target.checked,
                  }))
                }
                className="accent-[#7C5CFF]"
              />
              <span>Auto Day / Night in Play</span>
            </label>
            {currentLevel.timeOfDay !== undefined && (
              <button
                type="button"
                onClick={() =>
                  store.updateLevel('use sky preset time', (lvl) => ({
                    ...lvl,
                    timeOfDay: undefined,
                    autoCycleTime: false,
                  }))
                }
                className="text-[#7C5CFF] hover:underline"
              >
                Use sky
              </button>
            )}
          </div>
        </div>

        {/* Biome */}
        <div className="space-y-2">
          <FieldLabel text="Biome" />
          <div className="grid grid-cols-4 gap-1.5">
            {Biomes.map((b) => {
              const active = currentLevel.biome === b.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => store.updateLevel('change biome', (lvl) => ({ ...lvl, biome: b.id }))}
                  className={`flex flex-col items-center gap-1 p-2 rounded-xl border text-[10px] font-bold transition-all ${
                    active
                      ? 'border-[#7C5CFF] bg-[#7C5CFF]/15 text-[#7C5CFF]'
                      : 'border-transparent bg-slate-100 dark:bg-[#1F2430] text-slate-600 dark:text-[#949BB0] hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <span
                    className="w-4 h-4 rounded-full border border-black/15"
                    style={{ backgroundColor: b.ground }}
                  />
                  <span className="truncate w-full text-center">{b.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Sky & Weather */}
        <div className="space-y-2">
          <FieldLabel text="Atmosphere & Weather" />
          <div className="grid grid-cols-3 gap-1.5">
            {SkyPresets.map((s) => {
              const active = currentLevel.sky === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() =>
                    store.updateLevel('change sky', (lvl) => ({
                      ...lvl,
                      sky: s.id,
                      timeOfDay: undefined,
                    }))
                  }
                  className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-[11px] font-semibold border ${
                    active
                      ? 'border-[#7C5CFF] bg-[#7C5CFF]/15 text-[#7C5CFF]'
                      : 'border-transparent bg-slate-100 dark:bg-[#1F2430] text-slate-600 dark:text-[#949BB0]'
                  }`}
                >
                  <MakerIcon symbol={s.symbol} size={12} color={active ? '#7C5CFF' : s.tint} />
                  <span className="truncate">{s.title.split(' ')[0]}</span>
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-3 gap-1.5 pt-1">
            {WeatherOptions.map((w) => {
              const active = currentLevel.weather === w.id;
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => store.updateLevel('change weather', (lvl) => ({ ...lvl, weather: w.id }))}
                  className={`flex items-center justify-center gap-1 py-1.5 px-2 rounded-xl text-[11px] font-semibold ${
                    active
                      ? 'bg-[#38BDF8]/18 text-[#38BDF8]'
                      : 'bg-slate-100 dark:bg-[#1F2430] text-slate-600 dark:text-[#949BB0]'
                  }`}
                >
                  <MakerIcon symbol={w.symbol} size={11} />
                  <span className="truncate">{w.title}</span>
                </button>
              );
            })}
          </div>
          <div className="pt-1 space-y-1">
            <div className="flex items-center justify-between text-[11px] font-semibold">
              <span className="text-slate-600 dark:text-[#949BB0]">Wind Strength</span>
              <span className="tabular-nums text-[#38BDF8] font-bold">
                {(currentLevel.wind ?? 0.45) <= 0.12
                  ? 'Calm'
                  : (currentLevel.wind ?? 0.45) <= 0.65
                  ? `Breeze (${Math.round((currentLevel.wind ?? 0.45) * 100)}%)`
                  : (currentLevel.wind ?? 0.45) <= 1.25
                  ? `Gusty (${Math.round((currentLevel.wind ?? 0.45) * 100)}%)`
                  : `Gale (${Math.round((currentLevel.wind ?? 0.45) * 100)}%)`}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={currentLevel.wind ?? 0.45}
              onChange={(e) =>
                store.updateLevel('adjust wind strength', (lvl) => ({
                  ...lvl,
                  wind: Number(e.target.value),
                }))
              }
              className="w-full accent-[#38BDF8]"
            />
          </div>
        </div>

        {/* Global Post-Processing (Bloom, Lens Flare, Color Grading) */}
        <PostProcessingPanel store={store} />

        {/* Stylized Grass & Camera-Frustum LOD (Open World) */}
        {envType === 'openWorld' && (() => {
          const grassCfg = resolveGrassConfig(currentLevel.grass);
          const patchGrass = (patch: Partial<GrassFieldConfig>, recordUndo = false) => {
            store.updateLevel(
              'adjust stylized grass',
              (lvl) => ({
                ...lvl,
                grass: {
                  ...resolveGrassConfig(lvl.grass),
                  ...patch,
                },
              }),
              recordUndo
            );
          };
          const activeQuality: GrassQuality = grassCfg.enabled ? grassCfg.quality : 'off';
          const qualities: { id: GrassQuality; label: string }[] = [
            { id: 'off', label: 'Off' },
            { id: 'light', label: 'Light' },
            { id: 'lush', label: 'Lush' },
            { id: 'dense', label: 'Dense' },
            { id: 'ultra', label: 'Ultra' },
          ];
          return (
            <div className="space-y-2.5 p-3 rounded-2xl bg-slate-100 dark:bg-[#1F2430] border border-slate-200/70 dark:border-white/[0.06]">
              <div className="flex items-center justify-between">
                <FieldLabel text="Stylized Grass & LOD" />
                <span className="text-[10px] font-bold text-[#20B46A] tabular-nums">
                  {activeQuality === 'off' ? 'Off' : `LOD ${Math.round(grassCfg.viewDistance)}m`}
                </span>
              </div>

              <div className="grid grid-cols-5 gap-1">
                {qualities.map((q) => {
                  const active = activeQuality === q.id;
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() =>
                        patchGrass(
                          q.id === 'off'
                            ? { enabled: false, quality: 'off' }
                            : { enabled: true, quality: q.id },
                          true
                        )
                      }
                      className={`py-1.5 rounded-xl text-[11px] font-bold border transition-colors ${
                        active
                          ? 'border-[#20B46A] bg-[#20B46A]/18 text-[#16A34A] dark:text-[#20B46A]'
                          : 'border-transparent bg-white dark:bg-[#171A23] text-slate-600 dark:text-[#949BB0]'
                      }`}
                    >
                      {q.label}
                    </button>
                  );
                })}
              </div>

              {activeQuality !== 'off' && (
                <div className="space-y-2 pt-1">
                  <div className="space-y-0.5">
                    <div className="flex justify-between text-[11px] font-semibold">
                      <span>View Distance (LOD)</span>
                      <span className="tabular-nums text-slate-500 dark:text-[#949BB0]">
                        {Math.round(grassCfg.viewDistance)}m
                      </span>
                    </div>
                    <input
                      type="range"
                      min={30}
                      max={85}
                      step={2}
                      value={grassCfg.viewDistance}
                      onChange={(e) => patchGrass({ viewDistance: Number(e.target.value) })}
                      className="w-full accent-[#20B46A]"
                    />
                  </div>

                  <div className="space-y-0.5">
                    <div className="flex justify-between text-[11px] font-semibold">
                      <span>Blade Height</span>
                      <span className="tabular-nums text-slate-500 dark:text-[#949BB0]">
                        {grassCfg.bladeHeight.toFixed(2)}m
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.35}
                      max={1.4}
                      step={0.05}
                      value={grassCfg.bladeHeight}
                      onChange={(e) => patchGrass({ bladeHeight: Number(e.target.value) })}
                      className="w-full accent-[#20B46A]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-0.5">
                      <div className="flex justify-between text-[10px] font-semibold">
                        <span>Wind Flow</span>
                        <span className="tabular-nums text-slate-500 dark:text-[#949BB0]">
                          {Math.round(grassCfg.windWaveStrength * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.2}
                        max={2.0}
                        step={0.1}
                        value={grassCfg.windWaveStrength}
                        onChange={(e) => patchGrass({ windWaveStrength: Number(e.target.value) })}
                        className="w-full accent-[#38BDF8]"
                      />
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex justify-between text-[10px] font-semibold">
                        <span>Sun Glow</span>
                        <span className="tabular-nums text-slate-500 dark:text-[#949BB0]">
                          {Math.round(grassCfg.tipGlow * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1.2}
                        step={0.05}
                        value={grassCfg.tipGlow}
                        onChange={(e) => patchGrass({ tipGlow: Number(e.target.value) })}
                        className="w-full accent-[#F59E0B]"
                      />
                    </div>
                  </div>

                  <label className="flex items-center justify-between text-[11px] font-semibold cursor-pointer pt-0.5">
                    <span>Part grass around hero</span>
                    <input
                      type="checkbox"
                      checked={grassCfg.interactiveParting}
                      onChange={(e) =>
                        patchGrass({ interactiveParting: e.target.checked }, true)
                      }
                      className="accent-[#20B46A]"
                    />
                  </label>
                </div>
              )}
            </div>
          );
        })()}

        {/* Unreachable Endless Vista (Open World & Castle Courtyard) */}
        {(envType === 'openWorld' || envType === 'castle') && (
          <div className="space-y-2.5 p-3 rounded-2xl bg-slate-100 dark:bg-[#1F2430] border border-slate-200/70 dark:border-white/[0.06]">
            <div className="flex items-center justify-between">
              <FieldLabel text="Distant Vista" />
              <span className="text-[10px] font-bold text-[#20B46A]">Horizon</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {VistaPresets.map((vp) => {
                const active = vistaPreset === vp.id;
                return (
                  <button
                    key={vp.id}
                    type="button"
                    title={vp.blurb}
                    onClick={() =>
                      store.updateLevel('change distant vista', (lvl) => ({
                        ...lvl,
                        vistaPreset: vp.id,
                      }))
                    }
                    className={`px-2 py-1.5 rounded-xl text-[11px] font-bold border text-left truncate transition-colors ${
                      active
                        ? 'border-[#7C5CFF] bg-[#7C5CFF]/15 text-[#7C5CFF]'
                        : 'border-transparent bg-white dark:bg-[#171A23] text-slate-600 dark:text-[#949BB0]'
                    }`}
                  >
                    {vp.title}
                  </button>
                );
              })}
            </div>

            {vistaPreset !== 'none' && (
              <div className="space-y-1 pt-0.5">
                <div className="flex justify-between text-[11px] font-semibold">
                  <span>Forest & peak density</span>
                  <span className="tabular-nums text-slate-500 dark:text-[#949BB0]">
                    {Math.round(vistaDensity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.2}
                  max={1}
                  step={0.05}
                  value={vistaDensity}
                  onChange={(e) =>
                    store.updateLevel(
                      'set vista density',
                      (lvl) => ({ ...lvl, vistaDensity: Number(e.target.value) }),
                      false
                    )
                  }
                  className="w-full accent-[#20B46A]"
                />
              </div>
            )}

            <div className="space-y-1.5 pt-1 border-t border-slate-200/70 dark:border-white/[0.06]">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#8E96AB]">
                Add to distant horizon
              </div>
              <div className="grid grid-cols-3 gap-1">
                {VistaPropKinds.map((vk) => (
                  <button
                    key={vk.id}
                    type="button"
                    onClick={() => handleAddVistaItem(vk.id)}
                    className="px-2 py-1 rounded-lg bg-white dark:bg-[#171A23] hover:bg-[#7C5CFF]/15 hover:text-[#7C5CFF] text-[10px] font-bold transition-colors"
                  >
                    + {vk.title}
                  </button>
                ))}
              </div>
              {store.customAssets.length > 0 && (
                <div className="flex gap-1 pt-0.5">
                  <select
                    value={activeVistaAssetId}
                    onChange={(e) => setVistaCustomAssetId(e.target.value)}
                    className="flex-1 min-w-0 px-2 py-1 rounded-lg bg-white dark:bg-[#171A23] text-[11px] font-semibold"
                  >
                    {store.customAssets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      if (activeVistaAssetId) handleAddVistaItem('custom', activeVistaAssetId);
                    }}
                    className="shrink-0 px-2.5 py-1 rounded-lg bg-[#20B46A] text-white text-[10px] font-bold"
                  >
                    + GLB
                  </button>
                </div>
              )}
            </div>

            {vistaItems.length > 0 && (
              <div className="space-y-2 pt-1 max-h-48 overflow-y-auto maker-scroll">
                {vistaItems.map((item) => (
                  <div
                    key={item.id}
                    className="p-2 rounded-xl bg-white dark:bg-[#171A23] space-y-1.5 border border-slate-200/60 dark:border-white/[0.06]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold truncate">{item.name}</span>
                      <button
                        type="button"
                        onClick={() =>
                          store.updateLevel('remove vista landmark', (lvl) => ({
                            ...lvl,
                            vistaItems: (lvl.vistaItems ?? []).filter((v) => v.id !== item.id),
                          }))
                        }
                        className="text-slate-400 hover:text-[#F2545B]"
                        title="Remove distant landmark"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 text-[10px] text-slate-500 dark:text-[#949BB0]">
                      <label className="space-y-0.5">
                        <span className="block">Dir {Math.round(item.angle)}°</span>
                        <input
                          type="range"
                          min={0}
                          max={359}
                          value={item.angle}
                          onChange={(e) =>
                            store.updateLevel(
                              'move vista landmark',
                              (lvl) => ({
                                ...lvl,
                                vistaItems: (lvl.vistaItems ?? []).map((v) =>
                                  v.id === item.id ? { ...v, angle: Number(e.target.value) } : v
                                ),
                              }),
                              false
                            )
                          }
                          className="w-full accent-[#7C5CFF]"
                        />
                      </label>
                      <label className="space-y-0.5">
                        <span className="block">Dist {Math.round(item.distance)}m</span>
                        <input
                          type="range"
                          min={vistaMinDist}
                          max={vistaMaxDist}
                          step={2}
                          value={item.distance}
                          onChange={(e) =>
                            store.updateLevel(
                              'move vista distance',
                              (lvl) => ({
                                ...lvl,
                                vistaItems: (lvl.vistaItems ?? []).map((v) =>
                                  v.id === item.id ? { ...v, distance: Number(e.target.value) } : v
                                ),
                              }),
                              false
                            )
                          }
                          className="w-full accent-[#20B46A]"
                        />
                      </label>
                      <label className="space-y-0.5">
                        <span className="block">Size {item.scale.toFixed(1)}×</span>
                        <input
                          type="range"
                          min={0.6}
                          max={3.0}
                          step={0.1}
                          value={item.scale}
                          onChange={(e) =>
                            store.updateLevel(
                              'resize vista landmark',
                              (lvl) => ({
                                ...lvl,
                                vistaItems: (lvl.vistaItems ?? []).map((v) =>
                                  v.id === item.id ? { ...v, scale: Number(e.target.value) } : v
                                ),
                              }),
                              false
                            )
                          }
                          className="w-full accent-[#F59E0B]"
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Water Behavior (Open World) */}
        {envType === 'openWorld' && (
          <div className="space-y-1.5">
            <FieldLabel text="Water behavior" />
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() =>
                  store.updateLevel('enable auto swim', (lvl) => ({ ...lvl, canSwim: true }))
                }
                className={`px-2.5 py-2 rounded-xl text-[11px] font-bold border transition-colors ${
                  currentLevel.canSwim !== false
                    ? 'border-[#38BDF8] bg-[#38BDF8]/15 text-[#38BDF8]'
                    : 'border-transparent bg-slate-100 dark:bg-[#1F2430] text-slate-600 dark:text-[#949BB0]'
                }`}
              >
                Auto-swim
              </button>
              <button
                type="button"
                onClick={() =>
                  store.updateLevel('disable auto swim', (lvl) => ({ ...lvl, canSwim: false }))
                }
                className={`px-2.5 py-2 rounded-xl text-[11px] font-bold border transition-colors ${
                  currentLevel.canSwim === false
                    ? 'border-[#F59E0B] bg-[#F59E0B]/15 text-[#F59E0B]'
                    : 'border-transparent bg-slate-100 dark:bg-[#1F2430] text-slate-600 dark:text-[#949BB0]'
                }`}
              >
                Splash respawn
              </button>
            </div>
          </div>
        )}

        {/* Camera & Music */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <FieldLabel text="Camera feel" />
            <select
              value={cameraMode}
              onChange={(e) =>
                store.updateLevel('change camera mode', (lvl) => ({
                  ...lvl,
                  cameraMode: e.target.value as CameraMode,
                }))
              }
              className="w-full px-2.5 py-2 rounded-xl bg-slate-100 dark:bg-[#1F2430] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]"
            >
              {CameraModes.map((cm) => (
                <option key={cm.id} value={cm.id}>
                  {cm.title}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <FieldLabel text="Music mood" />
            <select
              value={currentLevel.audio.mood}
              onChange={(e) =>
                store.updateLevel('change music', (lvl) => ({
                  ...lvl,
                  audio: { ...lvl.audio, mood: e.target.value as typeof lvl.audio.mood },
                }))
              }
              className="w-full px-2.5 py-2 rounded-xl bg-slate-100 dark:bg-[#1F2430] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]"
            >
              {MusicMoodOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* How to win */}
        <div className="space-y-1.5">
          <FieldLabel text="How to beat this level" />
          <select
            value={currentLevel.completeCondition}
            onChange={(e) =>
              store.updateLevel('change win condition', (lvl) => ({
                ...lvl,
                completeCondition: e.target.value as typeof lvl.completeCondition,
              }))
            }
            className="w-full px-3 py-2 rounded-xl bg-slate-100 dark:bg-[#1F2430] text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]"
          >
            {CompleteConditions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>

        {/* Prototype Mode & Vehicle / Intro Bubble Settings */}
        <div className="p-3 rounded-2xl bg-slate-100 dark:bg-[#1F2430] space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <FieldLabel text="Gameplay Mode" />
            <select
              value={currentLevel.gameplayMode ?? 'adventure'}
              onChange={(e) => {
                const mode = e.target.value as GameplayMode;
                store.updateLevel('change gameplay mode', (lvl) => ({
                  ...lvl,
                  gameplayMode: mode,
                  drivingConfig:
                    mode === 'driving'
                      ? lvl.drivingConfig ?? {
                          carId: 'trailBuggy',
                          physicsId: 'arcadeDrift',
                          driverId: 'stunt',
                          cameraView: 'closeChase',
                        }
                      : lvl.drivingConfig,
                  roguelikeConfig:
                    mode === 'roguelike'
                      ? lvl.roguelikeConfig ?? { ...DEFAULT_ROGUELIKE_CONFIG }
                      : lvl.roguelikeConfig,
                  cameraMode:
                    mode === 'roguelike' && !lvl.cameraMode ? 'isometric' : lvl.cameraMode,
                }));
              }}
              className="px-2.5 py-1 rounded-lg bg-white dark:bg-[#171A23] text-[11px] font-bold"
            >
              <option value="adventure">Adventure</option>
              <option value="buddies">Buddies Quest</option>
              <option value="driving">Forest Driving</option>
              <option value="roguelike">Roguelike Run</option>
            </select>
          </div>

          {currentLevel.gameplayMode === 'roguelike' && (
            <div className="space-y-2.5 pt-2 border-t border-slate-200/70 dark:border-white/[0.06]">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-[11px] font-extrabold text-[#E11D48] block">
                    Roguelike Run Rules
                  </span>
                  {currentLevel.dungeonRooms && currentLevel.dungeonRooms.length > 0 && (
                    <span className="text-[10px] text-slate-500 dark:text-[#949BB0]">
                      {currentLevel.dungeonRooms.length} rooms · A* corridors
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const nextSeed = Math.floor(10000 + Math.random() * 899999);
                    store.updateLevel('roll procedural dungeon floor', (lvl) =>
                      DungeonGenerator.generateFloor(lvl, nextSeed, 1, {
                        ...(lvl.roguelikeConfig ?? DEFAULT_ROGUELIKE_CONFIG),
                        fixedSeed: nextSeed,
                        dungeonStyle: resolveDungeonStyle(
                          lvl.dungeonStyle ?? lvl.roguelikeConfig?.dungeonStyle
                        ),
                      })
                    );
                  }}
                  className="px-2.5 py-1 rounded-lg bg-[#E11D48]/15 hover:bg-[#E11D48]/25 text-[#E11D48] text-[10px] font-extrabold transition-colors whitespace-nowrap"
                >
                  Roll Preview Layout
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-1">
                  <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0]">
                    Boss every N floors
                  </span>
                  <select
                    value={currentLevel.roguelikeConfig?.bossInterval ?? 3}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      store.updateLevel('change boss interval', (lvl) => ({
                        ...lvl,
                        roguelikeConfig: {
                          ...DEFAULT_ROGUELIKE_CONFIG,
                          ...(lvl.roguelikeConfig ?? {}),
                          bossInterval: val,
                        },
                      }));
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#171A23] text-xs font-semibold"
                  >
                    {[2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        Every {n} floors
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0]">
                    Relic draft picks
                  </span>
                  <select
                    value={currentLevel.roguelikeConfig?.relicChoicesPerFloor ?? 3}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      store.updateLevel('change relic draft count', (lvl) => ({
                        ...lvl,
                        roguelikeConfig: {
                          ...DEFAULT_ROGUELIKE_CONFIG,
                          ...(lvl.roguelikeConfig ?? {}),
                          relicChoicesPerFloor: val,
                        },
                      }));
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#171A23] text-xs font-semibold"
                  >
                    {[2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        {n} choices
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0]">
                    Floor scaling
                  </span>
                  <select
                    value={String(currentLevel.roguelikeConfig?.difficultyScale ?? 0.28)}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      store.updateLevel('change floor scaling', (lvl) => ({
                        ...lvl,
                        roguelikeConfig: {
                          ...DEFAULT_ROGUELIKE_CONFIG,
                          ...(lvl.roguelikeConfig ?? {}),
                          difficultyScale: val,
                        },
                      }));
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#171A23] text-xs font-semibold"
                  >
                    <option value="0.15">Gentle (+15%/floor)</option>
                    <option value="0.28">Balanced (+28%/floor)</option>
                    <option value="0.42">Brutal (+42%/floor)</option>
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0]">
                    Starting HP
                  </span>
                  <select
                    value={currentLevel.roguelikeConfig?.startingMaxHealth ?? 6}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      store.updateLevel('change starting HP', (lvl) => ({
                        ...lvl,
                        roguelikeConfig: {
                          ...DEFAULT_ROGUELIKE_CONFIG,
                          ...(lvl.roguelikeConfig ?? {}),
                          startingMaxHealth: val,
                        },
                      }));
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#171A23] text-xs font-semibold"
                  >
                    {[4, 6, 8, 10].map((hp) => (
                      <option key={hp} value={hp}>
                        {hp} HP
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="flex items-center justify-between gap-2 pt-0.5">
                <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0]">
                  Run layout seed
                </span>
                <select
                  value={currentLevel.roguelikeConfig?.seedMode ?? 'random'}
                  onChange={(e) => {
                    const seedMode = e.target.value as 'random' | 'fixed';
                    store.updateLevel('change seed mode', (lvl) => ({
                      ...lvl,
                      roguelikeConfig: {
                        ...DEFAULT_ROGUELIKE_CONFIG,
                        ...(lvl.roguelikeConfig ?? {}),
                        seedMode,
                      },
                    }));
                  }}
                  className="px-2.5 py-1 rounded-lg bg-white dark:bg-[#171A23] text-[11px] font-bold"
                >
                  <option value="random">Random each run</option>
                  <option value="fixed">Fixed seed</option>
                </select>
              </div>
            </div>
          )}

          {(currentLevel.gameplayMode === 'roguelike' || envType === 'dungeon') && (() => {
            const activeStyle = resolveDungeonStyle(
              currentLevel.dungeonStyle ?? currentLevel.roguelikeConfig?.dungeonStyle
            );
            const updateDungeonStyle = (
              label: string,
              patch: Partial<typeof activeStyle>
            ) => {
              const merged = resolveDungeonStyle({ ...activeStyle, ...patch });
              store.updateLevel(label, (lvl) => applyDungeonStyleToLevel(lvl, merged));
            };
            return (
              <div className="space-y-2.5 pt-2 border-t border-slate-200/70 dark:border-white/[0.06]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-extrabold text-amber-500">
                    Dungeon Theme & Style
                  </span>
                  {(activeStyle.wallTint ||
                    activeStyle.floorTint ||
                    activeStyle.propTint ||
                    activeStyle.trapTint) && (
                    <button
                      type="button"
                      onClick={() =>
                        updateDungeonStyle('reset dungeon tints', {
                          wallTint: undefined,
                          floorTint: undefined,
                          propTint: undefined,
                          trapTint: undefined,
                        })
                      }
                      className="text-[10px] font-bold text-slate-500 hover:text-slate-900 dark:text-[#949BB0] dark:hover:text-white whitespace-nowrap"
                    >
                      Reset tints
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  {DUNGEON_THEME_PRESETS.map((preset) => {
                    const isActive =
                      activeStyle.wallStyle === preset.style.wallStyle &&
                      activeStyle.floorStyle === preset.style.floorStyle &&
                      activeStyle.propStyle === preset.style.propStyle &&
                      activeStyle.trapStyle === preset.style.trapStyle;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() =>
                          store.updateLevel(`apply ${preset.name} theme`, (lvl) =>
                            applyDungeonStyleToLevel(lvl, preset.style)
                          )
                        }
                        className={`px-2 py-1.5 rounded-lg text-[10px] font-bold text-left border transition-colors flex items-center gap-1.5 ${
                          isActive
                            ? 'border-amber-500/80 bg-amber-500/15 text-amber-400'
                            : 'border-transparent bg-white dark:bg-[#171A23] text-slate-600 dark:text-[#C5CBE0] hover:border-white/15'
                        }`}
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: preset.accentHex }}
                        />
                        <span className="truncate">{preset.name}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="block space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0]">
                        Walls
                      </span>
                      <input
                        type="color"
                        title="Tint walls"
                        value={
                          activeStyle.wallTint ??
                          DUNGEON_WALL_STYLE_META[activeStyle.wallStyle].primaryHex
                        }
                        onChange={(e) =>
                          updateDungeonStyle('tint dungeon walls', { wallTint: e.target.value })
                        }
                        className="w-4 h-4 rounded border-0 bg-transparent p-0 cursor-pointer"
                      />
                    </div>
                    <select
                      value={activeStyle.wallStyle}
                      onChange={(e) =>
                        updateDungeonStyle('change dungeon wall style', {
                          wallStyle: e.target.value as DungeonWallStyle,
                          wallTint: undefined,
                        })
                      }
                      className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-[#171A23] text-[11px] font-semibold"
                    >
                      {(Object.keys(DUNGEON_WALL_STYLE_META) as DungeonWallStyle[]).map((k) => (
                        <option key={k} value={k}>
                          {DUNGEON_WALL_STYLE_META[k].label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0]">
                        Floor
                      </span>
                      <input
                        type="color"
                        title="Tint floor"
                        value={
                          activeStyle.floorTint ??
                          DUNGEON_FLOOR_STYLE_META[activeStyle.floorStyle].colorHex
                        }
                        onChange={(e) =>
                          updateDungeonStyle('tint dungeon floor', { floorTint: e.target.value })
                        }
                        className="w-4 h-4 rounded border-0 bg-transparent p-0 cursor-pointer"
                      />
                    </div>
                    <select
                      value={activeStyle.floorStyle}
                      onChange={(e) =>
                        updateDungeonStyle('change dungeon floor style', {
                          floorStyle: e.target.value as DungeonFloorStyle,
                          floorTint: undefined,
                        })
                      }
                      className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-[#171A23] text-[11px] font-semibold"
                    >
                      {(Object.keys(DUNGEON_FLOOR_STYLE_META) as DungeonFloorStyle[]).map((k) => (
                        <option key={k} value={k}>
                          {DUNGEON_FLOOR_STYLE_META[k].label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0]">
                        Props
                      </span>
                      <input
                        type="color"
                        title="Tint dungeon props"
                        value={activeStyle.propTint ?? '#9E6234'}
                        onChange={(e) =>
                          updateDungeonStyle('tint dungeon props', { propTint: e.target.value })
                        }
                        className="w-4 h-4 rounded border-0 bg-transparent p-0 cursor-pointer"
                      />
                    </div>
                    <select
                      value={activeStyle.propStyle}
                      onChange={(e) =>
                        updateDungeonStyle('change dungeon prop style', {
                          propStyle: e.target.value as DungeonPropStyle,
                          propTint: undefined,
                        })
                      }
                      className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-[#171A23] text-[11px] font-semibold"
                    >
                      {(Object.keys(DUNGEON_PROP_STYLE_META) as DungeonPropStyle[]).map((k) => (
                        <option key={k} value={k}>
                          {DUNGEON_PROP_STYLE_META[k].label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0]">
                        Traps
                      </span>
                      <input
                        type="color"
                        title="Tint dungeon traps"
                        value={
                          activeStyle.trapTint ??
                          DUNGEON_TRAP_STYLE_META[activeStyle.trapStyle].hazardHex
                        }
                        onChange={(e) =>
                          updateDungeonStyle('tint dungeon traps', { trapTint: e.target.value })
                        }
                        className="w-4 h-4 rounded border-0 bg-transparent p-0 cursor-pointer"
                      />
                    </div>
                    <select
                      value={activeStyle.trapStyle}
                      onChange={(e) =>
                        updateDungeonStyle('change dungeon trap style', {
                          trapStyle: e.target.value as DungeonTrapStyle,
                          trapTint: undefined,
                        })
                      }
                      className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-[#171A23] text-[11px] font-semibold"
                    >
                      {(Object.keys(DUNGEON_TRAP_STYLE_META) as DungeonTrapStyle[]).map((k) => (
                        <option key={k} value={k}>
                          {DUNGEON_TRAP_STYLE_META[k].label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            );
          })()}

          {currentLevel.gameplayMode === 'driving' && (
            <div className="space-y-2 pt-1.5 border-t border-slate-200/70 dark:border-white/[0.06]">
              <label className="block space-y-1">
                <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0]">Car model</span>
                <select
                  value={currentLevel.drivingConfig?.carId ?? 'trailBuggy'}
                  onChange={(e) =>
                    store.updateLevel('change car preset', (lvl) => ({
                      ...lvl,
                      drivingConfig: {
                        carId: e.target.value as CarPresetId,
                        physicsId: lvl.drivingConfig?.physicsId ?? 'arcadeDrift',
                        driverId: lvl.drivingConfig?.driverId ?? 'stunt',
                        cameraView: lvl.drivingConfig?.cameraView ?? 'closeChase',
                      },
                    }))
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#171A23] text-xs font-semibold"
                >
                  {CAR_PRESETS.map((car) => (
                    <option key={car.id} value={car.id}>
                      {car.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0]">Driving physics</span>
                <select
                  value={currentLevel.drivingConfig?.physicsId ?? 'arcadeDrift'}
                  onChange={(e) =>
                    store.updateLevel('change driving physics', (lvl) => ({
                      ...lvl,
                      drivingConfig: {
                        carId: lvl.drivingConfig?.carId ?? 'trailBuggy',
                        physicsId: e.target.value as DrivingPhysicsId,
                        driverId: lvl.drivingConfig?.driverId ?? 'stunt',
                        cameraView: lvl.drivingConfig?.cameraView ?? 'closeChase',
                      },
                    }))
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#171A23] text-xs font-semibold"
                >
                  {DRIVING_PHYSICS_PRESETS.map((phys) => (
                    <option key={phys.id} value={phys.id}>
                      {phys.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0]">Driver type</span>
                <select
                  value={currentLevel.drivingConfig?.driverId ?? 'stunt'}
                  onChange={(e) =>
                    store.updateLevel('change driver type', (lvl) => ({
                      ...lvl,
                      drivingConfig: {
                        carId: lvl.drivingConfig?.carId ?? 'trailBuggy',
                        physicsId: lvl.drivingConfig?.physicsId ?? 'arcadeDrift',
                        driverId: e.target.value as DriverTypeId,
                        cameraView: lvl.drivingConfig?.cameraView ?? 'closeChase',
                      },
                    }))
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#171A23] text-xs font-semibold"
                >
                  {DRIVER_TYPES.map((drv) => (
                    <option key={drv.id} value={drv.id}>
                      {drv.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="space-y-1">
                <span className="block text-[10px] font-bold text-slate-500 dark:text-[#949BB0]">
                  Driving camera view
                </span>
                <div className="grid grid-cols-3 gap-1">
                  {DRIVING_CAMERA_VIEWS.map((view) => {
                    const activeView: DrivingCameraView =
                      currentLevel.drivingConfig?.cameraView ?? 'closeChase';
                    const isActive = activeView === view.id;
                    return (
                      <button
                        key={view.id}
                        type="button"
                        onClick={() =>
                          store.updateLevel('change driving camera view', (lvl) => ({
                            ...lvl,
                            drivingConfig: {
                              carId: lvl.drivingConfig?.carId ?? 'trailBuggy',
                              physicsId: lvl.drivingConfig?.physicsId ?? 'arcadeDrift',
                              driverId: lvl.drivingConfig?.driverId ?? 'stunt',
                              cameraView: view.id,
                            },
                          }))
                        }
                        title={view.blurb}
                        className={`px-2 py-1.5 rounded-lg text-[10px] font-bold transition-colors ${
                          isActive
                            ? 'bg-[#0EA5E9] text-white shadow-sm'
                            : 'bg-white dark:bg-[#171A23] text-slate-700 dark:text-[#CBD5E1] hover:bg-slate-200/70 dark:hover:bg-[#252B3B]'
                        }`}
                      >
                        {view.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {currentLevel.gameplayMode !== 'driving' && (
            <div className="space-y-2.5 pt-1 border-t border-slate-200/70 dark:border-white/[0.06]">
              <label className="flex items-center justify-between gap-2 text-[11px] font-bold cursor-pointer py-1">
                <span>Escort Baby Duckling companion</span>
                <input
                  type="checkbox"
                  checked={Boolean(currentLevel.startWithDuckling)}
                  onChange={(e) =>
                    store.updateLevel('toggle baby duckling companion', (lvl) => ({
                      ...lvl,
                      startWithDuckling: e.target.checked,
                    }))
                  }
                  className="accent-[#F59E0B] w-4 h-4"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0]">
                  Opening hero dialogue (optional)
                </span>
                <textarea
                  rows={2}
                  value={currentLevel.heroIntroSpeech ?? ''}
                  onChange={(e) =>
                    store.updateLevel(
                      'edit hero intro speech',
                      (lvl) => ({ ...lvl, heroIntroSpeech: e.target.value || undefined }),
                      false
                    )
                  }
                  placeholder="e.g. Oh no, I need my woodland buddies to help..."
                  className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#171A23] text-[11px] font-medium resize-none focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]"
                />
              </label>

              <DialogueVoiceEditor
                dialogueText={currentLevel.heroIntroSpeech ?? ''}
                voiceConfig={currentLevel.heroIntroVoice}
                projectChatSettings={currentProject.chatSettings}
                singleLineOnly
                compact
                labelPrefix="Intro"
                onChange={(nextVoice) =>
                  store.updateLevel(
                    'update hero intro voice-over',
                    (lvl) => ({ ...lvl, heroIntroVoice: nextVoice }),
                    true
                  )
                }
              />
            </div>
          )}

          {/* Storybook Framing */}
          <div className="space-y-2.5 pt-2 border-t border-slate-200/70 dark:border-white/[0.06]">
            <label className="flex items-center justify-between gap-2 text-[11px] font-bold cursor-pointer py-1">
              <span>Illustrated Storybook Framing</span>
              <input
                type="checkbox"
                checked={Boolean(currentProject.storybook?.enabled)}
                onChange={(e) => {
                  const nextEnabled = e.target.checked;
                  store.updateProject('toggle storybook framing', (proj) => ({
                    ...proj,
                    storybook: {
                      ...(proj.storybook ?? defaultStorybookConfig()),
                      enabled: nextEnabled,
                    },
                  }));
                }}
                className="accent-[#8C4A27] w-4 h-4"
              />
            </label>

            {currentProject.storybook?.enabled && (() => {
              const sb = currentProject.storybook ?? defaultStorybookConfig();
              const updateSb = (
                label: string,
                patch: Partial<typeof sb>,
                recordUndo = true
              ) => {
                store.updateProject(
                  label,
                  (proj) => ({
                    ...proj,
                    storybook: {
                      ...(proj.storybook ?? defaultStorybookConfig()),
                      ...patch,
                    },
                  }),
                  recordUndo
                );
              };
              return (
                <div className="space-y-2 rounded-xl bg-slate-100/90 dark:bg-[#1A1E29] p-2.5 border border-slate-200/70 dark:border-white/[0.07]">
                  <label className="block space-y-1">
                    <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0]">
                      Book Paper Theme
                    </span>
                    <select
                      value={sb.theme}
                      onChange={(e) =>
                        updateSb('change storybook theme', {
                          theme: e.target.value as StorybookThemeId,
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#171A23] text-xs font-semibold"
                    >
                      {StorybookThemeCatalog.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="grid grid-cols-3 gap-1.5">
                    <label className="col-span-1 block space-y-1">
                      <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0]">
                        Ch. #
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={currentLevel.chapterNumber ?? 1}
                        onChange={(e) =>
                          store.updateLevel(
                            'edit chapter number',
                            (lvl) => ({
                              ...lvl,
                              chapterNumber: Math.max(1, Number(e.target.value) || 1),
                            }),
                            false
                          )
                        }
                        className="w-full px-2 py-1 rounded-lg bg-white dark:bg-[#171A23] text-xs font-semibold tabular-nums"
                      />
                    </label>
                    <label className="col-span-2 block space-y-1">
                      <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0]">
                        Chapter Title
                      </span>
                      <input
                        type="text"
                        value={currentLevel.chapterTitle ?? ''}
                        onChange={(e) =>
                          store.updateLevel(
                            'edit chapter title',
                            (lvl) => ({ ...lvl, chapterTitle: e.target.value }),
                            false
                          )
                        }
                        placeholder={currentLevel.name}
                        className="w-full px-2 py-1 rounded-lg bg-white dark:bg-[#171A23] text-xs font-medium"
                      />
                    </label>
                  </div>

                  <label className="block space-y-1">
                    <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0]">
                      Subtitle
                    </span>
                    <input
                      type="text"
                      value={sb.subtitle ?? ''}
                      onChange={(e) =>
                        updateSb('edit storybook subtitle', { subtitle: e.target.value }, false)
                      }
                      placeholder="e.g. Book I · The Misfits of Whispering Woods"
                      className="w-full px-2.5 py-1 rounded-lg bg-white dark:bg-[#171A23] text-[11px] font-medium"
                    />
                  </label>

                  <label className="block space-y-1">
                    <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0]">
                      Opening Prologue (Cover Card)
                    </span>
                    <textarea
                      rows={3}
                      value={sb.prologueText ?? ''}
                      onChange={(e) =>
                        updateSb('edit storybook prologue', { prologueText: e.target.value }, false)
                      }
                      placeholder="Once upon a time in Whispering Woods…"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#171A23] text-[11px] font-medium resize-none"
                    />
                  </label>

                  <DialogueVoiceEditor
                    dialogueText={sb.prologueText ?? ''}
                    voiceConfig={sb.prologueVoice}
                    projectChatSettings={currentProject.chatSettings}
                    singleLineOnly
                    compact
                    labelPrefix="Prologue"
                    onChange={(nextVoice) =>
                      updateSb('update prologue voice', { prologueVoice: nextVoice }, true)
                    }
                  />

                  <label className="block space-y-1">
                    <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0]">
                      Closing Epilogue &amp; Moral
                    </span>
                    <textarea
                      rows={2}
                      value={sb.epilogueText ?? ''}
                      onChange={(e) =>
                        updateSb('edit storybook epilogue', { epilogueText: e.target.value }, false)
                      }
                      placeholder="Closing story reflection shown on chapter end…"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#171A23] text-[11px] font-medium resize-none"
                    />
                  </label>

                  <input
                    type="text"
                    value={sb.moralLine ?? ''}
                    onChange={(e) =>
                      updateSb('edit storybook moral', { moralLine: e.target.value }, false)
                    }
                    placeholder="Moral / closing quote (optional)"
                    className="w-full px-2.5 py-1 rounded-lg bg-white dark:bg-[#171A23] text-[11px] italic"
                  />

                  <DialogueVoiceEditor
                    dialogueText={sb.epilogueText ?? ''}
                    voiceConfig={sb.epilogueVoice}
                    projectChatSettings={currentProject.chatSettings}
                    singleLineOnly
                    compact
                    labelPrefix="Epilogue"
                    onChange={(nextVoice) =>
                      updateSb('update epilogue voice', { epilogueVoice: nextVoice }, true)
                    }
                  />
                </div>
              );
            })()}
          </div>
        </div>

        {/* Objectives */}
        <div className="space-y-2">
          <FieldLabel text="Goals shown to player" />
          <div className="space-y-1.5">
            {currentLevel.objectives.map((obj) => (
              <div
                key={obj.id}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-100 dark:bg-[#1F2430] text-xs font-medium"
              >
                <span className="truncate">{obj.text}</span>
                <button
                  type="button"
                  onClick={() =>
                    store.updateLevel('remove goal', (lvl) => ({
                      ...lvl,
                      objectives: lvl.objectives.filter((o) => o.id !== obj.id),
                    }))
                  }
                  className="text-slate-400 hover:text-[#F2545B]"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={newObjective}
              onChange={(e) => setNewObjective(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddObjective();
              }}
              placeholder="Add a goal…"
              className="flex-1 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-[#1F2430] text-xs focus:outline-none focus:ring-2 focus:ring-[#7C5CFF]"
            />
            <button
              type="button"
              onClick={handleAddObjective}
              className="px-3 py-1.5 rounded-xl bg-[#7C5CFF] text-white text-xs font-bold"
            >
              Add
            </button>
          </div>
        </div>

        {/* Toggles */}
        <div className="space-y-2 pt-2 border-t border-slate-200/70 dark:border-white/[0.08]">
          <label className="flex items-center justify-between text-xs font-semibold cursor-pointer">
            <span>Hero start spot</span>
            <input
              type="checkbox"
              checked={currentLevel.hasStart}
              onChange={(e) =>
                store.updateLevel('toggle start', (lvl) => ({ ...lvl, hasStart: e.target.checked }))
              }
              className="accent-[#7C5CFF] w-4 h-4"
            />
          </label>
          <label className="flex items-center justify-between text-xs font-semibold cursor-pointer">
            <span>Exit portal</span>
            <input
              type="checkbox"
              checked={currentLevel.hasPortal}
              onChange={(e) =>
                store.updateLevel('toggle portal', (lvl) => ({ ...lvl, hasPortal: e.target.checked }))
              }
              className="accent-[#7C5CFF] w-4 h-4"
            />
          </label>
          {envType === 'openWorld' && (
            <button
              type="button"
              onClick={() => store.resetTerrain()}
              className="w-full mt-2 inline-flex items-center justify-center gap-1.5 py-2 rounded-xl bg-slate-100 dark:bg-[#1F2430] text-xs font-semibold text-slate-600 dark:text-[#949BB0] hover:text-slate-900 dark:hover:text-white"
            >
              <RotateCcw size={12} />
              <span>Reset world ground</span>
            </button>
          )}
        </div>
      </aside>

      {/* Center: 3D Viewport + Tools */}
      <main className="shrink-0 lg:shrink lg:flex-1 lg:h-full lg:min-h-0 lg:min-w-0 flex flex-col p-3 sm:p-4 gap-3 lg:overflow-hidden">
        <div className="h-[340px] sm:h-[420px] lg:h-auto lg:flex-1 min-h-[240px] rounded-2xl overflow-hidden border border-slate-200/80 dark:border-white/[0.1] shadow-sm relative bg-[#0B0F1A]">
          {!store.isPlaying && (
            <WorldViewport3D
              project={currentProject}
              level={currentLevel}
              customAssets={store.customAssets}
              selectedEntityID={store.selectedEntityID}
              playerPin={store.playFromPoint}
              tool={activeTool}
              brush={brush}
              brushRadius={brushRadius}
              brushFalloff={store.terrainBrushFalloff}
              gridSnap={store.worldGridSnap}
              isPlacingBuildingBlock={
                activeTool === 'add' && addPaletteMode === 'blocks' && !activePlaceFxTemplate
              }
              resolutionScale={store.viewportResolutionScale}
              shadowQuality={store.viewportShadowQuality}
              renderPaused={
                showingCanopyEngine ||
                showingTextureStudio ||
                vertexPaintTargetId !== null ||
                showingMap
              }
              onSelectEntity={(id) => store.setSelectedEntityID(id)}
              onMoveEntity={(id, pos, elev) => store.moveEntity(id, pos, false, elev)}
              onRotateEntity={(id, deg) =>
                store.updateEntity(id, 'rotate item', (e) => ({ ...e, rotation: Math.round(deg) }), false)
              }
              onScaleEntity={(id, sc) =>
                store.updateEntity(id, 'resize item', (e) => ({ ...e, scale: sc }), false)
              }
              onBrushStroke={(x, z, meta) =>
                store.applyBrush(
                  brush,
                  x,
                  z,
                  brushRadius,
                  meta?.isStart ?? false,
                  brush === 'scatterCustom' ? activeScatterAssetId : undefined,
                  {
                    strength: store.terrainBrushStrength,
                    falloff: store.terrainBrushFalloff,
                    flattenHeight:
                      store.terrainFlattenHeight !== null
                        ? store.terrainFlattenHeight
                        : meta?.sampledHeight,
                  }
                )
              }
              fxBurstSignal={fxBurstSignal}
              fxPaused={store.isPlaying}
              draggingFxTemplate={
                draggingFxTemplate
                  ? {
                      id: draggingFxTemplate.id,
                      name: draggingFxTemplate.name,
                      accentHex: draggingFxTemplate.accentHex,
                    }
                  : null
              }
              onDropFxTemplate={handleDropFxTemplate}
              onAddAtPoint={(pos, elev) => {
                if (activePlaceFxTemplate) {
                  store.addFxTemplateAtPoint(activePlaceFxTemplate, pos);
                  setPlaceFxTemplateId(null);
                  setTool('move');
                } else if (addPaletteMode === 'blocks') {
                  store.addBuildingBlockEntity(activeBuildShape, activeBuildMaterial, pos, {
                    elevationY: elev,
                  });
                } else if (dropCustomAssetId) {
                  const asset = store.customAssets.find((a) => a.id === dropCustomAssetId);
                  const kind: EntityKind =
                    asset?.category === 'character'
                      ? 'npc'
                      : asset?.category === 'scenery'
                      ? 'scenery'
                      : 'prop';
                  store.addEntity(kind, asset?.name ?? 'Custom 3D', pos, dropCustomAssetId);
                  setTool('move');
                } else {
                  const meta = EntityKindMeta[dropKind];
                  store.addEntity(dropKind, meta.defaultName, pos);
                  setTool('move');
                }
              }}
            />
          )}

          {/* Compact hint at top-left */}
          <div className="pointer-events-none absolute top-3 left-3 px-3 py-1.5 rounded-xl bg-black/70 text-white text-[11px] font-semibold">
            {activeTool === 'move' &&
              'Click to select · Drag item to move · R rotates 90° · Drag sky to orbit'}
            {activeTool === 'rotate' && 'Drag a selected item left or right to spin it'}
            {activeTool === 'scale' && 'Drag a selected item left or right to resize it'}
            {activeTool === 'terrain' &&
              `Brush: ${TerrainBrushes.find((b) => b.id === brush)?.title} · Drag across terrain`}
            {activeTool === 'add' &&
              (activePlaceFxTemplate
                ? `Click anywhere in the scene to stamp ${activePlaceFxTemplate.name}`
                : addPaletteMode === 'blocks'
                ? `Click to place ${
                    activeBuildShape === 'door'
                      ? 'Modular Door'
                      : BUILDING_SHAPES.find((s) => s.id === activeBuildShape)?.label ?? 'Block'
                  } (${
                    BUILDING_MATERIALS.find((m) => m.id === activeBuildMaterial)?.label ?? 'Stone'
                  }) · Click tops to stack · R turns 90°`
                : dropCustomAssetId
                ? `Click anywhere in the scene to drop ${
                    store.customAssets.find((a) => a.id === dropCustomAssetId)?.name ?? 'model'
                  }`
                : `Click anywhere in the scene to drop a ${EntityKindMeta[dropKind].defaultName}`)}
          </div>

          {/* Quick Play from Center button */}
          <button
            type="button"
            onClick={() => {
              store.setPlayFromPoint({ x: 0.5, y: 0.52 });
              store.setIsPlaying(true);
            }}
            className="absolute top-3 right-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-black/70 hover:bg-black/85 text-white text-[11px] font-bold border border-white/15"
            title="Test right from the center of this level"
          >
            <Play size={11} fill="currentColor" className="text-[#20B46A]" />
            <span>Test from center</span>
          </button>
        </div>

        {/* Bottom Tool Controls */}
        <div className="shrink-0 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-white dark:bg-[#171A23] border border-slate-200/80 dark:border-white/[0.08]">
                {tools.map((t) => {
                  const active = activeTool === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setTool(t.id);
                        if (t.id !== 'add') setPlaceFxTemplateId(null);
                      }}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                        active
                          ? 'bg-[#7C5CFF] text-white'
                          : 'text-slate-600 dark:text-[#949BB0] hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {t.icon}
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => {
                  setPlaceFxTemplateId(null);
                  setAddPaletteMode('blocks');
                  setTool('add');
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-extrabold border transition-colors whitespace-nowrap ${
                  activeTool === 'add' && addPaletteMode === 'blocks' && !activePlaceFxTemplate
                    ? 'bg-[#F59E0B]/18 border-[#F59E0B] text-[#F59E0B]'
                    : 'bg-white dark:bg-[#171A23] border-slate-200/80 dark:border-white/[0.08] text-slate-700 dark:text-[#C8D0E4] hover:border-[#F59E0B]'
                }`}
              >
                <Box size={13} />
                <span>Build Kit</span>
              </button>

              <div
                className="inline-flex items-center gap-0.5 p-1 rounded-xl bg-white dark:bg-[#171A23] border border-slate-200/80 dark:border-white/[0.08]"
                title="Grid Snap spacing for placing and dragging blocks"
              >
                <span className="px-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-[#7D859B]">
                  Snap
                </span>
                {([0, 1, 2] as const).map((snapVal) => {
                  const active = store.worldGridSnap === snapVal;
                  return (
                    <button
                      key={snapVal}
                      type="button"
                      onClick={() => store.setWorldGridSnap(snapVal)}
                      className={`px-2 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                        active
                          ? 'bg-[#20B46A] text-white'
                          : 'text-slate-500 dark:text-[#949BB0] hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {snapVal === 0 ? 'Off' : `${snapVal}m`}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => setShowingFxLibrary((open) => !open)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-extrabold border transition-colors whitespace-nowrap ${
                  showingFxLibrary
                    ? 'bg-[#7C5CFF]/15 border-[#7C5CFF] text-[#7C5CFF]'
                    : 'bg-white dark:bg-[#171A23] border-slate-200/80 dark:border-white/[0.08] text-slate-700 dark:text-[#C8D0E4] hover:border-[#7C5CFF]'
                }`}
              >
                <Sparkles size={13} />
                <span>FX Library</span>
                <span className="tabular-nums text-[11px] opacity-80">
                  ({allFxTemplates.length})
                </span>
              </button>

              <button
                type="button"
                onClick={() => setShowingCanopyEngine(true)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-extrabold border transition-colors whitespace-nowrap ${
                  currentLevel.canopyEngine?.enabled
                    ? 'bg-[#20B46A]/15 border-[#20B46A] text-[#20B46A]'
                    : 'bg-white dark:bg-[#171A23] border-slate-200/80 dark:border-white/[0.08] text-slate-700 dark:text-[#C8D0E4] hover:border-[#20B46A]'
                }`}
              >
                <Trees size={13} />
                <span>Tree Studio</span>
                {currentLevel.canopyEngine?.enabled && (
                  <span className="text-[11px] font-bold opacity-85">· On</span>
                )}
              </button>

              {(() => {
                const activeTexCount = Object.values(currentLevel.sceneryTextures ?? {}).filter(
                  (s) => s?.enabled && s?.textureId
                ).length;
                return (
                  <button
                    type="button"
                    onClick={() => setShowingTextureStudio(true)}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-extrabold border transition-colors whitespace-nowrap ${
                      activeTexCount > 0
                        ? 'bg-[#7C5CFF]/15 border-[#7C5CFF] text-[#7C5CFF]'
                        : 'bg-white dark:bg-[#171A23] border-slate-200/80 dark:border-white/[0.08] text-slate-700 dark:text-[#C8D0E4] hover:border-[#7C5CFF]'
                    }`}
                  >
                    <Layers size={13} />
                    <span>Textures</span>
                    {activeTexCount > 0 && (
                      <span className="tabular-nums text-[11px] font-bold opacity-85">
                        ({activeTexCount})
                      </span>
                    )}
                  </button>
                );
              })()}

              {(() => {
                const paintedCount =
                  (currentLevel.canopyEngine?.vertexPaintStrokes?.length ? 1 : 0) +
                  currentLevel.entities.filter(
                    (e) =>
                      (e.canopyTree?.vertexPaintStrokes?.length ?? 0) > 0 ||
                      (e.vertexPaintStrokes?.length ?? 0) > 0
                  ).length;
                return (
                  <button
                    type="button"
                    onClick={() => {
                      if (currentEntity && currentEntity.kind !== 'fxEmitter') {
                        setVertexPaintTargetId(currentEntity.id);
                      } else {
                        setVertexPaintTargetId('forestTree');
                      }
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-extrabold border transition-colors whitespace-nowrap ${
                      paintedCount > 0
                        ? 'bg-[#EC4899]/15 border-[#EC4899] text-[#EC4899]'
                        : 'bg-white dark:bg-[#171A23] border-slate-200/80 dark:border-white/[0.08] text-slate-700 dark:text-[#C8D0E4] hover:border-[#EC4899]'
                    }`}
                  >
                    <Paintbrush size={13} />
                    <span>Vertex Paint</span>
                    {paintedCount > 0 && (
                      <span className="tabular-nums text-[11px] font-bold opacity-85">
                        ({paintedCount})
                      </span>
                    )}
                  </button>
                );
              })()}
            </div>

            {activeTool === 'terrain' && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-white dark:bg-[#171A23] border border-slate-200/80 dark:border-white/[0.08]">
                  {(['shape', 'paint', 'degrade', 'scatter'] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => {
                        const first = TerrainBrushes.find((b) => b.group === g);
                        if (first) setBrush(first.id);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold capitalize ${
                        brushGroup === g
                          ? g === 'degrade'
                            ? 'bg-[#20B46A] text-white'
                            : 'bg-[#F59E0B] text-white'
                          : 'text-slate-500 dark:text-[#949BB0]'
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2 bg-white dark:bg-[#171A23] px-3 py-1.5 rounded-xl border border-slate-200/80 dark:border-white/[0.08]">
                  <span className="text-[11px] font-bold text-slate-500 dark:text-[#949BB0]">
                    Size
                  </span>
                  <input
                    type="range"
                    min={2}
                    max={24}
                    step={0.5}
                    value={brushRadius}
                    onChange={(e) => setBrushRadius(Number(e.target.value))}
                    className="w-20 accent-[#F59E0B]"
                  />
                  <span className="text-[11px] font-bold tabular-nums text-slate-600 dark:text-[#C8D0E4]">
                    {brushRadius.toFixed(0)}m
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => store.setShowingTerrainEditor(!store.showingTerrainEditor)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-extrabold border transition-colors whitespace-nowrap ${
                    store.showingTerrainEditor
                      ? 'bg-[#20B46A]/15 border-[#20B46A] text-[#20B46A]'
                      : 'bg-white dark:bg-[#171A23] border-slate-200/80 dark:border-white/[0.08] text-slate-700 dark:text-[#C8D0E4] hover:border-[#20B46A]'
                  }`}
                >
                  <Mountain size={12} />
                  <span>Sculpt Panel</span>
                </button>
              </div>
            )}
          </div>

          {activeTool === 'terrain' && (
            <div className="flex flex-wrap items-center gap-1.5">
              {TerrainBrushes.filter((b) => b.group === brushGroup).map((b) => {
                const active = brush === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      if (b.id === 'scatterCustom' && store.customAssets.length === 0) {
                        store.setShowingAssetVault(true);
                        return;
                      }
                      setBrush(b.id);
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                      active
                        ? 'bg-[#F59E0B] text-white border-[#F59E0B]'
                        : 'bg-white dark:bg-[#171A23] border-slate-200/80 dark:border-white/[0.08] hover:border-[#F59E0B]'
                    }`}
                  >
                    {b.title}
                  </button>
                );
              })}

              {brushGroup === 'degrade' && (
                <button
                  type="button"
                  onClick={() =>
                    store.updateLevel('auto-weather cliffs & caves', (lvl) => ({
                      ...lvl,
                      terrain: applySlopeAutoWeathering(
                        lvl.terrain ?? createInitialTerrain(),
                        store.terrainBrushStrength
                      ),
                    }))
                  }
                  className="px-3 py-1.5 rounded-xl bg-[#20B46A]/15 hover:bg-[#20B46A]/25 border border-[#20B46A]/40 text-[#20B46A] text-xs font-extrabold transition-colors"
                >
                  Auto-Weather Cliffs
                </button>
              )}

              {brush === 'scatterCustom' && store.customAssets.length > 0 && (
                <select
                  value={activeScatterAssetId}
                  onChange={(e) => setScatterAssetId(e.target.value)}
                  className="px-3 py-1.5 rounded-xl bg-white dark:bg-[#171A23] border border-[#7C5CFF]/50 text-xs font-bold"
                >
                  {store.customAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      Model: {a.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {activeTool === 'add' && (
            <div className="space-y-2 p-2.5 rounded-2xl bg-white dark:bg-[#171A23] border border-slate-200/80 dark:border-white/[0.08]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex items-center gap-1 p-0.5 rounded-xl bg-slate-100 dark:bg-[#1F2430]">
                  <button
                    type="button"
                    onClick={() => {
                      setPlaceFxTemplateId(null);
                      setAddPaletteMode('blocks');
                    }}
                    className={`px-3 py-1 rounded-lg text-[11px] font-extrabold transition-colors ${
                      addPaletteMode === 'blocks'
                        ? 'bg-[#F59E0B] text-white'
                        : 'text-slate-600 dark:text-[#949BB0]'
                    }`}
                  >
                    Dungeon &amp; Masonry Kit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPlaceFxTemplateId(null);
                      setAddPaletteMode('entities');
                    }}
                    className={`px-3 py-1 rounded-lg text-[11px] font-extrabold transition-colors ${
                      addPaletteMode === 'entities'
                        ? 'bg-[#7C5CFF] text-white'
                        : 'text-slate-600 dark:text-[#949BB0]'
                    }`}
                  >
                    Cast, Loot &amp; GLBs
                  </button>
                </div>

                {addPaletteMode === 'blocks' && (
                  <div className="flex flex-wrap items-center gap-1">
                    {BUILDING_MATERIALS.map((mat) => {
                      const active = activeBuildMaterial === mat.id;
                      return (
                        <button
                          key={mat.id}
                          type="button"
                          onClick={() => setActiveBuildMaterial(mat.id)}
                          title={`${mat.label} (${mat.category})`}
                          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
                            active
                              ? 'border-[#F59E0B] bg-[#F59E0B]/15 text-[#D97706] dark:text-[#FBBF24]'
                              : 'border-transparent bg-slate-100 dark:bg-[#1F2430] text-slate-600 dark:text-[#949BB0] hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-sm border border-black/25 shrink-0"
                            style={{ backgroundColor: mat.swatch }}
                          />
                          <span>{mat.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {addPaletteMode === 'blocks' ? (
                <div className="flex gap-1.5 overflow-x-auto pb-0.5 maker-scroll">
                  {BUILDING_SHAPES.map((shape) => {
                    const active = activeBuildShape === shape.id;
                    return (
                      <button
                        key={shape.id}
                        type="button"
                        title={shape.blurb}
                        onClick={() => setActiveBuildShape(shape.id)}
                        className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                          active
                            ? 'bg-[#7C5CFF] text-white border-[#7C5CFF]'
                            : 'bg-slate-100 dark:bg-[#1F2430] border-transparent text-slate-700 dark:text-[#C8D0E4] hover:border-[#7C5CFF]'
                        }`}
                      >
                        <Box size={12} />
                        <span className="whitespace-nowrap">{shape.label}</span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    title="Interactive doorway with arched/rectangular frame, plank/metal/bar/cage leaves & peep slots"
                    onClick={() => setActiveBuildShape('door')}
                    className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                      activeBuildShape === 'door'
                        ? 'bg-[#20B46A] text-white border-[#20B46A]'
                        : 'bg-slate-100 dark:bg-[#1F2430] border-transparent text-slate-700 dark:text-[#C8D0E4] hover:border-[#20B46A]'
                    }`}
                  >
                    <Layers size={12} />
                    <span className="whitespace-nowrap">Modular Door</span>
                  </button>
                </div>
              ) : (
                <div className="flex gap-1.5 overflow-x-auto pb-0.5 maker-scroll">
                  {DropKinds.map((k) => {
                    const meta = EntityKindMeta[k];
                    const active = !dropCustomAssetId && dropKind === k;
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => {
                          setDropCustomAssetId('');
                          setDropKind(k);
                        }}
                        className={`shrink-0 inline-flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-xl text-xs font-bold border transition-colors ${
                          active
                            ? 'bg-[#7C5CFF] text-white border-[#7C5CFF]'
                            : 'bg-slate-100 dark:bg-[#1F2430] border-transparent hover:border-[#7C5CFF]'
                        }`}
                      >
                        <AssetThumbnail kind={k} size={26} rounded="rounded-lg" />
                        <span className="whitespace-nowrap">{meta.defaultName}</span>
                      </button>
                    );
                  })}

                  {store.customAssets.map((asset) => {
                    const active = dropCustomAssetId === asset.id;
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => setDropCustomAssetId(asset.id)}
                        className={`shrink-0 inline-flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-xl text-xs font-bold border transition-colors ${
                          active
                            ? 'bg-[#20B46A] text-white border-[#20B46A]'
                            : 'bg-slate-100 dark:bg-[#1F2430] border-transparent hover:border-[#20B46A]'
                        }`}
                      >
                        <AssetThumbnail customAsset={asset} size={26} rounded="rounded-lg" />
                        <span className="whitespace-nowrap">{asset.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {showingFxLibrary && (
            <FxLibraryPanel
              templates={allFxTemplates}
              activePlaceTemplateId={placeFxTemplateId}
              onSelectPlaceTemplate={(tpl) => {
                if (tpl) {
                  setPlaceFxTemplateId(tpl.id);
                  setTool('add');
                } else {
                  setPlaceFxTemplateId(null);
                  setTool('move');
                }
              }}
              onQuickPlaceCenter={(tpl) => {
                store.addFxTemplateAtPoint(tpl, {
                  x: 0.44 + Math.random() * 0.12,
                  y: 0.44 + Math.random() * 0.12,
                });
                setPlaceFxTemplateId(null);
                setTool('move');
              }}
              onDragStartTemplate={(tpl) => setDraggingFxTemplate(tpl)}
              onDragEndTemplate={() => setDraggingFxTemplate(null)}
              onDeleteCustomTemplate={handleDeleteCustomFxTemplate}
              onClose={() => setShowingFxLibrary(false)}
            />
          )}
        </div>
      </main>

      {/* Right inspector: Selected Entity */}
      <aside className="w-full lg:w-72 shrink-0 lg:h-full lg:min-h-0 bg-white dark:bg-[#171A23] border-t lg:border-t-0 lg:border-l border-slate-200/80 dark:border-white/[0.08] lg:overflow-y-auto maker-scroll p-4 space-y-4">
        {currentEntity ? (
          <>
            <div className="flex items-center gap-3">
              <AssetThumbnail
                entity={currentEntity}
                customAsset={selectedEntityCustom}
                size={48}
                rounded="rounded-xl"
              />
              <div className="min-w-0 flex-1">
                <input
                  type="text"
                  value={currentEntity.name}
                  onChange={(e) =>
                    store.updateEntity(currentEntity.id, 'rename', (ent) => ({
                      ...ent,
                      name: e.target.value,
                    }))
                  }
                  className="w-full text-base font-extrabold bg-transparent focus:outline-none border-b border-transparent focus:border-[#7C5CFF]"
                />
                <div className="text-xs text-slate-500 dark:text-[#949BB0]">
                  {EntityKindMeta[currentEntity.kind].title}
                  {selectedEntityCustom ? ` · ${selectedEntityCustom.name}` : ''}
                </div>
              </div>
            </div>

            <div className="space-y-3 pt-2 border-t border-slate-200/70 dark:border-white/[0.08]">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span>Turn</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        store.updateEntity(currentEntity.id, 'rotate -90°', (ent) => ({
                          ...ent,
                          rotation: (Math.round((ent.rotation - 90) / 90) * 90 + 360) % 360,
                        }))
                      }
                      className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#1F2430] hover:bg-[#7C5CFF]/20 text-[10px] font-bold"
                      title="Turn -90°"
                    >
                      -90°
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        store.updateEntity(currentEntity.id, 'rotate +90°', (ent) => ({
                          ...ent,
                          rotation: (Math.round((ent.rotation + 90) / 90) * 90 + 360) % 360,
                        }))
                      }
                      className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#1F2430] hover:bg-[#7C5CFF]/20 text-[10px] font-bold"
                      title="Turn +90° (or press R)"
                    >
                      +90°
                    </button>
                    <span className="tabular-nums text-slate-500 dark:text-[#949BB0] ml-1">
                      {Math.round(currentEntity.rotation)}°
                    </span>
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={360}
                  value={currentEntity.rotation}
                  onChange={(e) =>
                    store.updateEntity(
                      currentEntity.id,
                      'rotate',
                      (ent) => ({ ...ent, rotation: Number(e.target.value) }),
                      false
                    )
                  }
                  className="w-full accent-[#7C5CFF]"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span>Elevation (Stack Y)</span>
                  <span className="tabular-nums text-slate-500 dark:text-[#949BB0]">
                    {(currentEntity.elevationY ?? 0).toFixed(2)}m
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-1">
                  {[
                    { label: '-2m', delta: -2 },
                    { label: '-0.5m', delta: -0.5 },
                    { label: '0m', delta: null },
                    { label: '+0.5m', delta: 0.5 },
                    { label: '+2m', delta: 2 },
                  ].map((btn) => (
                    <button
                      key={btn.label}
                      type="button"
                      onClick={() =>
                        store.updateEntity(currentEntity.id, 'change elevation', (ent) => ({
                          ...ent,
                          elevationY:
                            btn.delta === null
                              ? 0
                              : Number(Math.max(-4, (ent.elevationY ?? 0) + btn.delta).toFixed(2)),
                        }))
                      }
                      className="py-1 rounded-lg bg-slate-100 dark:bg-[#1F2430] hover:bg-[#7C5CFF]/20 text-[10px] font-bold"
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold">
                  <span>Size</span>
                  <span className="tabular-nums text-slate-500 dark:text-[#949BB0]">
                    {currentEntity.scale.toFixed(1)}×
                  </span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={2.4}
                  step={0.1}
                  value={currentEntity.scale}
                  onChange={(e) =>
                    store.updateEntity(
                      currentEntity.id,
                      'resize',
                      (ent) => ({ ...ent, scale: Number(e.target.value) }),
                      false
                    )
                  }
                  className="w-full accent-[#7C5CFF]"
                />
              </div>
            </div>

            {currentEntity.buildingBlock && (() => {
              const bb = currentEntity.buildingBlock!;
              const patchBb = (label: string, patch: Partial<typeof bb>) =>
                store.updateEntity(currentEntity.id, label, (ent) => ({
                  ...ent,
                  buildingBlock: { ...(ent.buildingBlock ?? bb), ...patch },
                }));
              return (
                <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-[#1F2430] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BB0]">
                      Building Block
                    </span>
                    <span className="text-[10px] font-bold text-[#F59E0B]">2m Grid Kit</span>
                  </div>

                  <label className="block space-y-1">
                    <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0]">
                      Shape
                    </span>
                    <select
                      value={bb.shape}
                      onChange={(e) =>
                        patchBb('change block shape', { shape: e.target.value as BuildingShapeId })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#171A23] text-xs font-semibold"
                    >
                      {BUILDING_SHAPES.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label} — {s.blurb}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0] block">
                      Surface Material
                    </span>
                    <div className="grid grid-cols-3 gap-1">
                      {BUILDING_MATERIALS.map((mat) => {
                        const active = bb.material === mat.id;
                        return (
                          <button
                            key={mat.id}
                            type="button"
                            onClick={() => patchBb('change block material', { material: mat.id })}
                            className={`flex items-center gap-1 px-1.5 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
                              active
                                ? 'border-[#F59E0B] bg-[#F59E0B]/15 text-[#D97706] dark:text-[#FBBF24]'
                                : 'border-transparent bg-white dark:bg-[#171A23] text-slate-600 dark:text-[#949BB0]'
                            }`}
                          >
                            <span
                              className="w-2.5 h-2.5 rounded-sm border border-black/25 shrink-0"
                              style={{ backgroundColor: mat.swatch }}
                            />
                            <span className="truncate">{mat.label.split(' ')[0]}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {bb.shape === 'archway' && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0] block">
                        Archway Style
                      </span>
                      <div className="grid grid-cols-2 gap-1">
                        {(['arched', 'rectangular'] as const).map((styleId) => (
                          <button
                            key={styleId}
                            type="button"
                            onClick={() => patchBb('change archway style', { archStyle: styleId })}
                            className={`py-1 rounded-lg text-[11px] font-bold capitalize ${
                              (bb.archStyle ?? 'arched') === styleId
                                ? 'bg-[#7C5CFF] text-white'
                                : 'bg-white dark:bg-[#171A23] text-slate-600 dark:text-[#949BB0]'
                            }`}
                          >
                            {styleId}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {bb.shape === 'windowWall' && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0] block">
                        Window Style
                      </span>
                      <div className="grid grid-cols-3 gap-1">
                        {(['open', 'barred', 'shuttered'] as const).map((wId) => (
                          <button
                            key={wId}
                            type="button"
                            onClick={() => patchBb('change window style', { windowStyle: wId })}
                            className={`py-1 rounded-lg text-[10px] font-bold capitalize ${
                              (bb.windowStyle ?? 'barred') === wId
                                ? 'bg-[#7C5CFF] text-white'
                                : 'bg-white dark:bg-[#171A23] text-slate-600 dark:text-[#949BB0]'
                            }`}
                          >
                            {wId}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {currentEntity.kind === 'door' && (() => {
              const dc = currentEntity.doorConfig;
              const patchDoor = (label: string, patch: Partial<DoorConfig>) =>
                store.updateEntity(currentEntity.id, label, (ent) => ({
                  ...ent,
                  doorConfig: { ...(ent.doorConfig ?? DEFAULT_DOOR_CONFIG), ...patch },
                }));
              return (
                <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-[#1F2430] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BB0]">
                      Door Customizer
                    </span>
                    {!dc && (
                      <button
                        type="button"
                        onClick={() => patchDoor('enable modular door', {})}
                        className="px-2 py-0.5 rounded-lg bg-[#7C5CFF] text-white text-[10px] font-bold"
                      >
                        Customize Style
                      </button>
                    )}
                  </div>

                  {dc && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-1.5">
                        <label className="space-y-1">
                          <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0] block">
                            Frame
                          </span>
                          <select
                            value={dc.frameShape}
                            onChange={(e) =>
                              patchDoor('change door frame', {
                                frameShape: e.target.value as DoorFrameShape,
                              })
                            }
                            className="w-full px-2 py-1 rounded-lg bg-white dark:bg-[#171A23] text-[11px] font-semibold"
                          >
                            <option value="arched">Arched</option>
                            <option value="rectangular">Rectangular</option>
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0] block">
                            Open Mode
                          </span>
                          <select
                            value={dc.openMode}
                            onChange={(e) =>
                              patchDoor('change door open mode', {
                                openMode: e.target.value as DoorOpenMode,
                              })
                            }
                            className="w-full px-2 py-1 rounded-lg bg-white dark:bg-[#171A23] text-[11px] font-semibold"
                          >
                            <option value="hingedSide">Side Swing</option>
                            <option value="doubleSplit">Middle Split</option>
                            <option value="sliding">Sliding Up</option>
                          </select>
                        </label>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5">
                        <label className="space-y-1">
                          <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0] block">
                            Leaf Style
                          </span>
                          <select
                            value={dc.leafStyle}
                            onChange={(e) =>
                              patchDoor('change door leaf style', {
                                leafStyle: e.target.value as DoorLeafStyle,
                              })
                            }
                            className="w-full px-2 py-1 rounded-lg bg-white dark:bg-[#171A23] text-[11px] font-semibold"
                          >
                            <option value="woodPlank">Wooden Plank</option>
                            <option value="solidMetal">Solid Iron</option>
                            <option value="ironBars">Metal Bars</option>
                            <option value="jailCage">Jail Cage</option>
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0] block">
                            Window / Slot
                          </span>
                          <select
                            value={dc.slotStyle}
                            onChange={(e) =>
                              patchDoor('change door slot style', {
                                slotStyle: e.target.value as DoorSlotStyle,
                              })
                            }
                            className="w-full px-2 py-1 rounded-lg bg-white dark:bg-[#171A23] text-[11px] font-semibold"
                          >
                            <option value="none">Solid (None)</option>
                            <option value="peepSlot">Peep Slot</option>
                            <option value="barredWindow">Barred Window</option>
                          </select>
                        </label>
                      </div>

                      <label className="block space-y-1">
                        <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0]">
                          Frame Material
                        </span>
                        <select
                          value={dc.frameMaterial ?? 'hewnStone'}
                          onChange={(e) =>
                            patchDoor('change door frame material', {
                              frameMaterial: e.target.value as BuildingMaterialId,
                            })
                          }
                          className="w-full px-2 py-1 rounded-lg bg-white dark:bg-[#171A23] text-[11px] font-semibold"
                        >
                          {BUILDING_MATERIALS.map((mat) => (
                            <option key={mat.id} value={mat.id}>
                              {mat.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="flex items-center justify-between text-xs font-semibold cursor-pointer pt-0.5">
                        <span>Requires Key to Unlock</span>
                        <input
                          type="checkbox"
                          checked={Boolean(dc.requiresKey)}
                          onChange={(e) =>
                            patchDoor('toggle door key requirement', {
                              requiresKey: e.target.checked,
                            })
                          }
                          className="accent-[#F59E0B] w-4 h-4"
                        />
                      </label>
                    </div>
                  )}
                </div>
              );
            })()}

            {currentEntity.kind === 'npc' && (
              <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-[#1F2430] space-y-2">
                <label className="block space-y-1">
                  <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0]">Creature Look</span>
                  <select
                    value={currentEntity.creatureType ?? ''}
                    onChange={(e) =>
                      store.updateEntity(currentEntity.id, 'change creature look', (ent) => ({
                        ...ent,
                        creatureType: (e.target.value || undefined) as CreatureBodyId | undefined,
                      }))
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#171A23] text-xs font-semibold"
                  >
                    <option value="">Default Townsperson</option>
                    <option value="Skunk">Skunk</option>
                    <option value="Porcupine">Porcupine</option>
                    <option value="Mole Rat">Mole Rat</option>
                    <option value="Vulture">Vulture</option>
                    <option value="Duckling">Duckling</option>
                    <option value="Squirrel">Squirrel</option>
                    <option value="Badger">Badger</option>
                    <option value="Owl">Owl</option>
                  </select>
                </label>
                <label className="flex items-center justify-between text-xs font-semibold cursor-pointer">
                  <span>Recruitable Buddy Companion</span>
                  <input
                    type="checkbox"
                    checked={Boolean(currentEntity.isBuddy)}
                    onChange={(e) =>
                      store.updateEntity(currentEntity.id, 'toggle buddy status', (ent) => ({
                        ...ent,
                        isBuddy: e.target.checked,
                      }))
                    }
                    className="accent-[#FF9F1C] w-4 h-4"
                  />
                </label>
              </div>
            )}

            {(currentEntity.kind === 'prop' || currentEntity.kind === 'checkpoint') && (
              <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-[#1F2430] space-y-1">
                <label className="block space-y-1">
                  <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BB0]">Landmark / Structure</span>
                  <select
                    value={currentEntity.propPreset ?? ''}
                    onChange={(e) =>
                      store.updateEntity(currentEntity.id, 'change prop structure', (ent) => ({
                        ...ent,
                        propPreset: (e.target.value || undefined) as PropPresetId | undefined,
                      }))
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#171A23] text-xs font-semibold"
                  >
                    <option value="">Standard Prop</option>
                    <option value="tavern">Woodland Tavern</option>
                    <option value="cottage">Burrow Cottage</option>
                    <option value="dock">Lakeside Dock</option>
                    <option value="campfire">Campfire Ring</option>
                    <option value="craftingBench">Crafting Bench</option>
                    <option value="signpost">Trail Signpost</option>
                    <option value="ramp">Timber Stunt Ramp</option>
                    <option value="checkpointArch">Rally Checkpoint Arch</option>
                  </select>
                </label>
              </div>
            )}

            {currentEntity.kind === 'fxEmitter' ? (
              <FxEmitterInspector
                entity={currentEntity}
                store={store}
                onTriggerBurst={triggerFxBurst}
                onSaveToLibrary={handleSaveEntityToFxLibrary}
              />
            ) : currentEntity.canopyTree ? (
              <CanopyTreeInspector
                entity={currentEntity}
                store={store}
                onOpenStudio={() => setShowingCanopyEngine(true)}
                onOpenVertexPainter={() => setVertexPaintTargetId(currentEntity.id)}
              />
            ) : (
              <EntityItemAssignPanel entity={currentEntity} store={store} />
            )}

            {currentEntity.kind !== 'fxEmitter' && currentEntity.kind !== 'light' && (
              <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-[#1F2430] space-y-2.5">
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <div>
                    <div className="text-[11px] font-bold text-slate-800 dark:text-[#EAECF4]">
                      High-Detail Meshlet (GPU Culling)
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-[#949BB0]">
                      WebGPU cluster culling for large static meshes &amp; landmarks
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(currentEntity.meshletEnabled)}
                    onChange={(e) =>
                      store.updateEntity(
                        currentEntity.id,
                        'toggle high-detail meshlet',
                        (ent) => ({ ...ent, meshletEnabled: e.target.checked })
                      )
                    }
                    className="accent-[#7C5CFF] w-4 h-4 shrink-0"
                  />
                </label>

                <div className="pt-2 border-t border-slate-200/70 dark:border-white/[0.08] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BB0]">
                      Material &amp; Weathering
                    </span>
                    {currentEntity.materialVariant && (
                      <button
                        type="button"
                        onClick={() =>
                          store.updateEntity(currentEntity.id, 'reset material variant', (ent) => ({
                            ...ent,
                            materialVariant: undefined,
                          }))
                        }
                        className="text-[10px] font-bold text-[#7C5CFF] hover:underline"
                      >
                        Reset
                      </button>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold">Tint Color</span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={currentEntity.materialVariant?.colorHex ?? '#ffffff'}
                        onChange={(e) => {
                          const hex = e.target.value;
                          store.updateEntity(
                            currentEntity.id,
                            'tint material',
                            (ent) => ({
                              ...ent,
                              materialVariant: {
                                ...ent.materialVariant,
                                colorHex: hex,
                              },
                            }),
                            false
                          );
                        }}
                        className="w-7 h-6 rounded border border-slate-300 dark:border-white/15 bg-transparent cursor-pointer"
                      />
                      {currentEntity.materialVariant?.colorHex && (
                        <button
                          type="button"
                          onClick={() =>
                            store.updateEntity(currentEntity.id, 'clear material tint', (ent) => ({
                              ...ent,
                              materialVariant: {
                                ...ent.materialVariant,
                                colorHex: undefined,
                              },
                            }))
                          }
                          className="px-1.5 py-0.5 rounded bg-white dark:bg-[#171A23] text-[10px] font-semibold"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-0.5">
                    <div className="flex justify-between text-[11px] font-semibold">
                      <span>Roughness</span>
                      <span className="tabular-nums text-slate-500 dark:text-[#949BB0]">
                        {Math.round((currentEntity.materialVariant?.roughness ?? 0.84) * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.05}
                      max={1}
                      step={0.01}
                      value={currentEntity.materialVariant?.roughness ?? 0.84}
                      onChange={(e) => {
                        const roughness = Number(e.target.value);
                        store.updateEntity(
                          currentEntity.id,
                          'adjust roughness',
                          (ent) => ({
                            ...ent,
                            materialVariant: {
                              ...ent.materialVariant,
                              roughness,
                            },
                          }),
                          false
                        );
                      }}
                      className="w-full accent-[#7C5CFF]"
                    />
                  </div>

                  <div className="space-y-0.5">
                    <div className="flex justify-between text-[11px] font-semibold">
                      <span>Matte Diffuse (EON)</span>
                      <span className="tabular-nums text-slate-500 dark:text-[#949BB0]">
                        {Math.round((currentEntity.materialVariant?.diffuseRoughness ?? 0.84) * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={currentEntity.materialVariant?.diffuseRoughness ?? 0.84}
                      onChange={(e) => {
                        const diffuseRoughness = Number(e.target.value);
                        store.updateEntity(
                          currentEntity.id,
                          'adjust eon diffuse roughness',
                          (ent) => ({
                            ...ent,
                            materialVariant: {
                              ...ent.materialVariant,
                              diffuseRoughness,
                            },
                          }),
                          false
                        );
                      }}
                      className="w-full accent-[#20B46A]"
                    />
                  </div>

                  <div className="space-y-1 pt-1 border-t border-slate-200/60 dark:border-white/[0.06]">
                    {(() => {
                      const wearVal = currentEntity.materialVariant?.wearFactor ?? 0;
                      const wearLabel =
                        wearVal <= 0.01
                          ? 'Pristine'
                          : wearVal < 0.28
                          ? 'Light Scuffs'
                          : wearVal < 0.56
                          ? 'Worn Edges'
                          : wearVal < 0.82
                          ? 'Deep Dings'
                          : 'Battered';
                      return (
                        <>
                          <div className="flex items-center justify-between gap-2 text-[11px] font-semibold">
                            <span>Wear Intensity</span>
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`text-[10px] font-bold ${
                                  wearVal > 0.01
                                    ? 'text-[#D97706] dark:text-[#FBBF24]'
                                    : 'text-slate-400 dark:text-[#7D859B]'
                                }`}
                              >
                                {wearLabel}
                              </span>
                              <span className="tabular-nums text-slate-500 dark:text-[#949BB0]">
                                {Math.round(wearVal * 100)}%
                              </span>
                            </div>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={wearVal}
                            aria-label="Wear Intensity"
                            onChange={(e) => {
                              const wearFactor = Number(e.target.value);
                              store.updateEntity(
                                currentEntity.id,
                                'adjust object wear factor',
                                (ent) => ({
                                  ...ent,
                                  materialVariant: {
                                    ...ent.materialVariant,
                                    wearFactor,
                                  },
                                }),
                                false
                              );
                            }}
                            className="w-full accent-[#D97706]"
                          />
                          <p className="text-[10px] text-slate-400 dark:text-[#7D859B] leading-tight">
                            Controls how deep &amp; extensive dings, chips &amp; scratches appear on this block.
                          </p>
                        </>
                      );
                    })()}
                  </div>

                  <div className="space-y-1">
                    <span className="text-[11px] font-semibold block">
                      Weathering / Degrading
                    </span>
                    <div className="grid grid-cols-5 gap-1">
                      {WEATHERING_PRESETS.map((preset) => {
                        const active =
                          (currentEntity.materialVariant?.weathering ?? 'none') === preset.id;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            title={preset.shortDesc}
                            onClick={() =>
                              store.updateEntity(currentEntity.id, 'set weathering preset', (ent) => ({
                                ...ent,
                                materialVariant: {
                                  ...ent.materialVariant,
                                  weathering: preset.id,
                                  weatheringIntensity: ent.materialVariant?.weatheringIntensity ?? 0.65,
                                },
                              }))
                            }
                            className={`flex items-center justify-center gap-1 py-1 px-1 rounded-lg text-[10px] font-bold transition-colors ${
                              active
                                ? 'bg-[#7C5CFF] text-white'
                                : 'bg-white dark:bg-[#171A23] text-slate-600 dark:text-[#949BB0] hover:bg-slate-200 dark:hover:bg-[#272D3C]'
                            }`}
                          >
                            <span
                              className="w-2 h-2 rounded-full border border-black/20 shrink-0"
                              style={{ backgroundColor: preset.swatch }}
                            />
                            <span className="truncate">{preset.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {(currentEntity.materialVariant?.weathering ?? 'none') !== 'none' && (
                    <div className="space-y-0.5">
                      <div className="flex justify-between text-[11px] font-semibold">
                        <span>Weathering Amount</span>
                        <span className="tabular-nums text-slate-500 dark:text-[#949BB0]">
                          {Math.round((currentEntity.materialVariant?.weatheringIntensity ?? 0.65) * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.05}
                        max={1}
                        step={0.01}
                        value={currentEntity.materialVariant?.weatheringIntensity ?? 0.65}
                        onChange={(e) => {
                          const weatheringIntensity = Number(e.target.value);
                          store.updateEntity(
                            currentEntity.id,
                            'adjust weathering intensity',
                            (ent) => ({
                              ...ent,
                              materialVariant: {
                                ...ent.materialVariant,
                                weatheringIntensity,
                              },
                            }),
                            false
                          );
                        }}
                        className="w-full accent-[#20B46A]"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="pt-2 border-t border-slate-200/70 dark:border-white/[0.08] space-y-2">
              {(currentEntity.kind === 'npc' ||
                currentEntity.kind === 'baddie' ||
                currentEntity.kind === 'sign') && (
                <button
                  type="button"
                  onClick={() => setChatBubbleTargetId(currentEntity.id)}
                  className="w-full py-2 rounded-xl bg-[#38BDF8]/15 text-xs font-bold text-[#0EA5E9] dark:text-[#38BDF8] hover:bg-[#38BDF8]/25 inline-flex items-center justify-center gap-1.5"
                >
                  <MessageCircle size={13} />
                  <span>Customize Chat Bubble</span>
                </button>
              )}
              {currentEntity.kind !== 'fxEmitter' && (() => {
                const vpCount =
                  currentEntity.canopyTree?.vertexPaintStrokes?.length ??
                  currentEntity.vertexPaintStrokes?.length ??
                  0;
                return (
                  <button
                    type="button"
                    onClick={() => setVertexPaintTargetId(currentEntity.id)}
                    className="w-full py-2 rounded-xl bg-[#EC4899]/15 text-xs font-bold text-[#EC4899] hover:bg-[#EC4899]/25 inline-flex items-center justify-center gap-1.5"
                  >
                    <Paintbrush size={13} />
                    <span>Vertex Paint &amp; Degrade</span>
                    {vpCount > 0 && (
                      <span className="tabular-nums text-[10px] opacity-85">({vpCount})</span>
                    )}
                  </button>
                );
              })()}
              {currentEntity.kind !== 'fxEmitter' && (
                <button
                  type="button"
                  onClick={() => store.setShowingAssetVault(true)}
                  className="w-full py-2 rounded-xl bg-[#7C5CFF]/15 text-xs font-bold text-[#7C5CFF] hover:bg-[#7C5CFF]/25 inline-flex items-center justify-center gap-1.5"
                >
                  <Box size={13} />
                  <span>{selectedEntityCustom ? 'Swap 3D GLB Model' : 'Bind Custom 3D Model'}</span>
                </button>
              )}
              {currentEntity.kind !== 'fxEmitter' && (envType === 'openWorld' || envType === 'castle') && (
                <button
                  type="button"
                  onClick={() => {
                    if (currentEntity.customAssetId) {
                      handleAddVistaItem('custom', currentEntity.customAssetId, currentEntity.name);
                      return;
                    }
                    const lower = currentEntity.name.toLowerCase();
                    const mappedKind: VistaPropKind = lower.includes('pine')
                      ? 'pineCluster'
                      : lower.includes('birch')
                      ? 'birchCluster'
                      : lower.includes('tree') || lower.includes('oak')
                      ? 'oakCluster'
                      : lower.includes('tower') || lower.includes('castle') || lower.includes('ruin')
                      ? 'castleRuins'
                      : lower.includes('mountain') || lower.includes('peak')
                      ? 'mountain'
                      : 'boulderRidge';
                    handleAddVistaItem(mappedKind, undefined, currentEntity.name);
                  }}
                  className="w-full py-2 rounded-xl bg-[#20B46A]/15 text-xs font-bold text-[#20B46A] hover:bg-[#20B46A]/25 inline-flex items-center justify-center gap-1.5"
                >
                  <Mountain size={13} />
                  <span>Place Copy on Distant Horizon</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => store.setSelectedTab('cast')}
                className="w-full py-2 rounded-xl bg-slate-100 dark:bg-[#1F2430] text-xs font-bold hover:bg-slate-200 dark:hover:bg-[#272D3C]"
              >
                Edit stats & details in Cast
              </button>
              <button
                type="button"
                onClick={() => store.setSelectedTab('logic')}
                className="w-full py-2 rounded-xl bg-[#A855F7]/15 text-xs font-bold text-[#A855F7] hover:bg-[#A855F7]/25"
              >
                Edit rules ({currentEntity.cards.length})
              </button>
              <button
                type="button"
                onClick={() => store.deleteEntity(currentEntity.id)}
                className="w-full py-2 rounded-xl bg-[#F2545B]/12 text-xs font-bold text-[#F2545B] hover:bg-[#F2545B]/20 inline-flex items-center justify-center gap-1.5"
              >
                <Trash2 size={13} />
                <span>Remove from level</span>
              </button>
            </div>
          </>
        ) : (
          <MakerCard padding="p-4" className="!bg-slate-100 dark:!bg-[#1F2430] border-none space-y-2.5">
            <h3 className="text-sm font-extrabold">Nothing selected</h3>
            <p className="text-xs text-slate-500 dark:text-[#949BB0] leading-relaxed">
              Click any character, chest, door or prop in the 3D scene to move, turn, resize, or bind a custom GLB.
            </p>
            <div className="text-[11px] font-semibold text-slate-500 dark:text-[#8E96AB] capitalize pt-1">
              <span className="text-[#7C5CFF]">{currentLevel.entities.length} items</span>
              <span> · </span>
              <span className="text-[#20B46A]">{envType}</span>
            </div>
          </MakerCard>
        )}

        {/* Quick list of items in level */}
        <div className="pt-2 border-t border-slate-200/70 dark:border-white/[0.08] space-y-2">
          <FieldLabel text="In this level" />
          <div className="space-y-1 max-h-56 overflow-y-auto maker-scroll">
            {currentLevel.entities.map((ent) => {
              const active = ent.id === store.selectedEntityID;
              const entCustom = ent.customAssetId
                ? store.customAssets.find((a) => a.id === ent.customAssetId) ?? null
                : null;
              return (
                <button
                  key={ent.id}
                  type="button"
                  onClick={() => store.setSelectedEntityID(ent.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-xl text-left text-xs font-semibold ${
                    active
                      ? 'bg-[#7C5CFF]/15 text-[#7C5CFF]'
                      : 'hover:bg-slate-100 dark:hover:bg-[#1F2430]'
                  }`}
                >
                  <AssetThumbnail
                    entity={ent}
                    customAsset={entCustom}
                    size={26}
                    rounded="rounded-lg"
                  />
                  <span className="truncate flex-1">{ent.name}</span>
                  {ent.customAssetId && <Box size={11} className="text-[#20B46A] shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      {showingMap && (
        <LevelMapModal
          level={currentLevel}
          selectedEntityID={store.selectedEntityID}
          onSelectEntity={(id) => store.setSelectedEntityID(id)}
          onMoveEntity={(id, pos) => store.moveEntity(id, pos, true)}
          onClose={() => setShowingMap(false)}
        />
      )}

      {showingCanopyEngine && (
        <CanopyEngineModal
          store={store}
          onClose={() => setShowingCanopyEngine(false)}
          onOpenVertexPainter={() => {
            setShowingCanopyEngine(false);
            setVertexPaintTargetId('forestTree');
          }}
        />
      )}

      {showingTextureStudio && (
        <TextureStudioModal
          store={store}
          onClose={() => setShowingTextureStudio(false)}
        />
      )}

      {vertexPaintTargetId !== null && (
        <VertexPaintModal
          store={store}
          initialEntityId={vertexPaintTargetId === 'forestTree' ? null : vertexPaintTargetId}
          onClose={() => setVertexPaintTargetId(null)}
        />
      )}

      {chatBubbleTargetId !== null && (
        <ChatBubbleStudioModal
          store={store}
          initialTarget={chatBubbleTargetId}
          onClose={() => setChatBubbleTargetId(null)}
        />
      )}
    </div>
  );
};
