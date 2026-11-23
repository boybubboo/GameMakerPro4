import React, { Profiler, useEffect, useRef, useState } from 'react';
import {
  Box,
  ChevronDown,
  ChevronLeft,
  Clapperboard,
  FileArchive,
  Film,
  Lightbulb,
  Map as MapIcon,
  Mountain,
  Play,
  Plus,
  Redo2,
  Save,
  Trash2,
  Undo2,
  Workflow,
} from 'lucide-react';
import type { MakerStore } from '../../store/useMakerStore';
import type { StageTab } from '../../types/maker';
import { PlayModeView } from '../play/PlayModeView';
import { ActionsStage } from '../stages/ActionsStage';
import { CastStage } from '../stages/CastStage';
import { InterfaceStage } from '../stages/InterfaceStage';
import { LogicStage } from '../stages/LogicStage';
import { MotionStage } from '../stages/MotionStage';
import { PublishStage } from '../stages/PublishStage';
import { WorldStage } from '../stages/WorldStage';
import { AssetVaultModal } from './AssetVaultModal';
import { ExportProjectZipModal } from './ExportProjectZipModal';
import { MakerIcon } from './IconMap';
import { IdeasModal } from './IdeasModal';
import { LogicFlowModal } from './LogicFlowModal';
import { ThemeToggle } from './MakerUI';
import { PersistentMinimapHUD } from './PersistentMinimapHUD';
import {
  getActivePostFxLabel,
  PostProcessingMenuModal,
} from './PostProcessingMenuModal';
import { SavePresetsModal } from './SavePresetsModal';
import {
  detectTimeOfDayPreset,
  SkyboxLightingEditorModal,
  TimeOfDayIcon,
} from './SkyboxLightingEditorModal';
import { StoryDirectorModal } from './StoryDirectorModal';
import { getTerrainBrushLabel, TerrainEditorModal } from './TerrainEditorModal';
import {
  onEditorProfilerRender,
  useEditorResourceMonitor,
} from '../../utils/resourceMonitor';

const STAGE_TABS: { id: StageTab; title: string; symbol: string }[] = [
  { id: 'world', title: 'World', symbol: 'map.fill' },
  { id: 'cast', title: 'Cast', symbol: 'person.2.fill' },
  { id: 'motion', title: 'Motion', symbol: 'motion.studio' },
  { id: 'logic', title: 'Logic', symbol: 'arrow.triangle.branch' },
  { id: 'actions', title: 'Actions', symbol: 'figure.run' },
  { id: 'interface', title: 'Interface', symbol: 'slider.horizontal.3' },
  { id: 'publish', title: 'Publish', symbol: 'paperplane.fill' },
];

const AUTO_SAVE_DEBOUNCE_MS = 600;
const EDITOR_AUTOSAVE_META_KEY = 'maker.autosave.meta.v1';

export const EditorShell: React.FC<{ store: MakerStore }> = ({ store }) => {
  const { currentProject, currentLevel, levelIndex, saveProjectStateNow } = store;
  const [levelMenuOpen, setLevelMenuOpen] = useState(false);
  const [showingSkybox, setShowingSkybox] = useState(false);
  const [showingPostFx, setShowingPostFx] = useState(false);
  const [showingExportZip, setShowingExportZip] = useState(false);

  const lastProjectIdRef = useRef<string | null>(null);
  const lastSeenProjectRef = useRef(currentProject);
  const pendingAutoSaveRef = useRef(false);
  const autoSaveTimerRef = useRef<number | null>(null);

  useEditorResourceMonitor({
    stage: store.selectedTab,
    projectId: currentProject?.id ?? null,
  });

  // Debounced auto-save: persists project state to localStorage after edits settle
  useEffect(() => {
    if (!currentProject) {
      lastProjectIdRef.current = null;
      lastSeenProjectRef.current = null;
      pendingAutoSaveRef.current = false;
      return;
    }

    // Opening or switching projects is not an edit; establish baseline reference
    if (lastProjectIdRef.current !== currentProject.id) {
      lastProjectIdRef.current = currentProject.id;
      lastSeenProjectRef.current = currentProject;
      pendingAutoSaveRef.current = false;
      return;
    }

    if (lastSeenProjectRef.current === currentProject) {
      return;
    }
    lastSeenProjectRef.current = currentProject;
    pendingAutoSaveRef.current = true;

    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
    }

    const levelId = currentLevel?.id ?? null;
    const tab = store.selectedTab;
    const projectId = currentProject.id;

    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      pendingAutoSaveRef.current = false;
      saveProjectStateNow(true);
      try {
        localStorage.setItem(
          EDITOR_AUTOSAVE_META_KEY,
          JSON.stringify({
            projectId,
            levelId,
            tab,
            savedAt: new Date().toISOString(),
          })
        );
      } catch {
        // ignore localStorage quota errors
      }
    }, AUTO_SAVE_DEBOUNCE_MS);

    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [currentProject, currentLevel?.id, store.selectedTab, saveProjectStateNow]);

  // Flush any pending debounced auto-save if EditorShell unmounts or page hides
  useEffect(() => {
    const flushPending = () => {
      if (!pendingAutoSaveRef.current) return;
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      pendingAutoSaveRef.current = false;
      saveProjectStateNow(true);
    };
    window.addEventListener('pagehide', flushPending);
    return () => {
      window.removeEventListener('pagehide', flushPending);
      flushPending();
    };
  }, [saveProjectStateNow]);

  if (!currentProject) return null;

  const activeTimePreset = currentLevel ? detectTimeOfDayPreset(currentLevel) : 'noon';
  const activePostFxLabel = getActivePostFxLabel(currentProject.postProcessing);

  return (
    <div className="h-dvh min-h-0 flex flex-col bg-[#F4F5F8] dark:bg-[#0F1117] text-slate-900 dark:text-[#F3F5FA] overflow-hidden transition-colors">
      {/* Top Bar */}
      <Profiler id="EditorShell.Header" onRender={onEditorProfilerRender}>
      <header className="shrink-0 bg-white dark:bg-[#171A23] border-b border-slate-200/80 dark:border-white/[0.08] px-3 sm:px-5 py-2.5 flex items-center gap-2.5 sm:gap-3 z-20">
        <button
          type="button"
          onClick={() => store.closeProject()}
          title="All games"
          className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-[#1F2430] text-[#7C5CFF] flex items-center justify-center hover:bg-slate-200 dark:hover:bg-[#272D3C] shrink-0"
        >
          <ChevronLeft size={18} strokeWidth={2.6} />
        </button>

        <div className="min-w-0 flex-1">
          <h1 className="text-base sm:text-lg font-black truncate leading-tight">
            {currentProject.name}
          </h1>
          <div className="text-[11px] font-semibold text-slate-500 dark:text-[#949BB0]">
            Level {levelIndex + 1} of {Math.max(1, currentProject.levels.length)}
          </div>
        </div>

        {/* Theme Switch */}
        <div className="hidden md:block">
          <ThemeToggle theme={store.theme} onChange={store.setTheme} compact />
        </div>

        {/* Terrain Heightmap Sculptor */}
        <button
          type="button"
          onClick={() => {
            const next = !store.showingTerrainEditor;
            if (next) {
              setShowingSkybox(false);
              setShowingPostFx(false);
            }
            store.setShowingTerrainEditor(next);
          }}
          title="Terrain Heightmap Sculptor (Raise, Lower, Flatten, Smooth & Surface Paint)"
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold shrink-0 whitespace-nowrap transition-colors ${
            store.showingTerrainEditor
              ? 'bg-[#20B46A]/18 text-[#16A34A] dark:text-[#20B46A] ring-1 ring-[#20B46A]/45'
              : 'bg-slate-100 dark:bg-[#1F2430] hover:bg-slate-200 dark:hover:bg-[#272D3C]'
          }`}
        >
          <Mountain size={13} className="text-[#20B46A]" />
          <span className="hidden md:inline">Terrain</span>
          {store.showingTerrainEditor && (
            <span className="text-[11px] text-[#16A34A] dark:text-[#6EE7B7] hidden lg:inline">
              {getTerrainBrushLabel(store.terrainBrush)}
            </span>
          )}
        </button>

        {/* Skybox & Atmospheric Lighting Editor */}
        <button
          type="button"
          onClick={() => {
            const next = !showingSkybox;
            if (next) {
              store.setShowingTerrainEditor(false);
              setShowingPostFx(false);
            }
            setShowingSkybox(next);
          }}
          title="Skybox & Atmospheric Lighting Editor (Dawn / Noon / Dusk / Night & Clouds)"
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold shrink-0 whitespace-nowrap transition-colors ${
            showingSkybox
              ? 'bg-[#38BDF8]/18 text-[#0284C7] dark:text-[#38BDF8] ring-1 ring-[#38BDF8]/40'
              : 'bg-slate-100 dark:bg-[#1F2430] hover:bg-slate-200 dark:hover:bg-[#272D3C]'
          }`}
        >
          <TimeOfDayIcon
            preset={activeTimePreset}
            size={13}
            className={
              activeTimePreset === 'night'
                ? 'text-[#818CF8]'
                : activeTimePreset === 'noon'
                ? 'text-[#0EA5E9] dark:text-[#38BDF8]'
                : 'text-[#F59E0B]'
            }
          />
          <span className="hidden md:inline">Sky</span>
          <span className="text-[11px] text-slate-500 dark:text-[#949BB0] capitalize hidden lg:inline">
            {activeTimePreset}
          </span>
        </button>

        {/* Post-Processing Effects Menu (Bloom, Color Grading Filters & Vignette) */}
        <button
          type="button"
          onClick={() => {
            const next = !showingPostFx;
            if (next) {
              setShowingSkybox(false);
              store.setShowingTerrainEditor(false);
            }
            setShowingPostFx(next);
          }}
          title="Post-Processing Effects — Bloom, Color Grading Filters & Vignette"
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold shrink-0 whitespace-nowrap transition-colors ${
            showingPostFx
              ? 'bg-[#EC4899]/18 text-[#DB2777] dark:text-[#F472B6] ring-1 ring-[#EC4899]/45'
              : activePostFxLabel
              ? 'bg-[#EC4899]/10 text-[#DB2777] dark:text-[#F472B6] hover:bg-[#EC4899]/18'
              : 'bg-slate-100 dark:bg-[#1F2430] hover:bg-slate-200 dark:hover:bg-[#272D3C]'
          }`}
        >
          <Film size={13} className="text-[#EC4899]" />
          <span className="hidden md:inline">Post FX</span>
          {activePostFxLabel && (
            <span className="text-[11px] text-[#DB2777]/80 dark:text-[#F9A8D4] hidden xl:inline">
              {activePostFxLabel}
            </span>
          )}
        </button>

        {/* Logic Flow Node Visualizer */}
        <button
          type="button"
          onClick={() => store.setShowingLogicFlow(true)}
          title="Logic Flow — Node-based When-If-Then rule graph & debugger"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-[#1F2430] hover:bg-slate-200 dark:hover:bg-[#272D3C] text-xs font-bold shrink-0 whitespace-nowrap"
        >
          <Workflow size={13} className="text-[#A855F7]" />
          <span className="hidden md:inline">Logic Flow</span>
          <span className="text-[11px] text-slate-500 dark:text-[#949BB0] tabular-nums">
            ({(currentLevel?.entities ?? []).reduce((sum, e) => sum + e.cards.length, 0)})
          </span>
        </button>

        {/* Story Director (Live Camera Cutaways & Skits) */}
        <button
          type="button"
          onClick={() => store.setShowingDirector(true)}
          title="Story Director — Stage live camera cutaways, skits & voiceover beats"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-[#1F2430] hover:bg-slate-200 dark:hover:bg-[#272D3C] text-xs font-bold shrink-0 whitespace-nowrap"
        >
          <Clapperboard size={13} className="text-[#F59E0B]" />
          <span className="hidden md:inline">Director</span>
          <span className="text-[11px] text-slate-500 dark:text-[#949BB0] tabular-nums">
            ({currentLevel?.storySkits?.length ?? 0})
          </span>
        </button>

        {/* Local Save Presets (savepresets.json) */}
        <button
          type="button"
          onClick={() => store.setShowingPresets(true)}
          title="Save & Load Local Design Presets (savepresets.json)"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-[#1F2430] hover:bg-slate-200 dark:hover:bg-[#272D3C] text-xs font-bold shrink-0 whitespace-nowrap"
        >
          <Save size={13} className="text-[#20B46A]" />
          <span className="hidden sm:inline">Presets</span>
          <span className="text-[11px] text-slate-500 dark:text-[#949BB0] tabular-nums">
            ({store.savedPresets.length})
          </span>
        </button>

        {/* 3D Asset Vault */}
        <button
          type="button"
          onClick={() => store.setShowingAssetVault(true)}
          title="3D Asset Vault (Tripo 3D / GLB)"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-[#1F2430] hover:bg-slate-200 dark:hover:bg-[#272D3C] text-xs font-bold shrink-0"
        >
          <Box size={13} className="text-[#7C5CFF]" />
          <span className="hidden sm:inline">Assets</span>
          <span className="text-[11px] text-slate-500 dark:text-[#949BB0] tabular-nums">
            ({store.customAssets.length})
          </span>
        </button>

        {/* Level Switcher */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setLevelMenuOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-[#1F2430] hover:bg-slate-200 dark:hover:bg-[#272D3C] text-xs font-bold"
          >
            <MapIcon size={13} className="text-[#7C5CFF]" />
            <span className="max-w-[110px] truncate">{currentLevel?.name ?? 'Level'}</span>
            <ChevronDown size={12} />
          </button>

          {levelMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-20"
                onClick={() => setLevelMenuOpen(false)}
              />
              <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-white dark:bg-[#171A23] shadow-xl border border-slate-200/80 dark:border-white/[0.1] py-1.5 z-30">
                {currentProject.levels.map((lvl, idx) => (
                  <button
                    key={lvl.id}
                    type="button"
                    onClick={() => {
                      store.setSelectedLevelID(lvl.id);
                      store.setSelectedEntityID(lvl.entities[0]?.id ?? null);
                      setLevelMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-2 px-3.5 py-2 text-left text-xs font-semibold hover:bg-slate-100 dark:hover:bg-[#1F2430] ${
                      lvl.id === currentLevel?.id ? 'text-[#7C5CFF] font-bold' : ''
                    }`}
                  >
                    <span className="w-4 text-[11px] text-slate-400 dark:text-[#6B7285]">
                      {idx + 1}.
                    </span>
                    <span className="truncate flex-1">{lvl.name}</span>
                  </button>
                ))}
                <div className="my-1 border-t border-slate-200/70 dark:border-white/[0.08]" />
                <button
                  type="button"
                  onClick={() => {
                    store.addLevel();
                    setLevelMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-3.5 py-2 text-left text-xs font-bold text-[#7C5CFF] hover:bg-[#7C5CFF]/10"
                >
                  <Plus size={13} />
                  <span>Add a level</span>
                </button>
                {currentProject.levels.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      store.deleteCurrentLevel();
                      setLevelMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-3.5 py-2 text-left text-xs font-bold text-[#F2545B] hover:bg-[#F2545B]/10"
                  >
                    <Trash2 size={13} />
                    <span>Delete current level</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Ideas Coach */}
        <button
          type="button"
          onClick={() => store.setShowingIdeas(true)}
          title="Ideas for your game"
          className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-[#1F2430] text-[#F59E0B] flex items-center justify-center hover:bg-slate-200 dark:hover:bg-[#272D3C] shrink-0"
        >
          <Lightbulb size={16} />
        </button>

        {/* Undo / Redo */}
        <div className="hidden sm:flex items-center gap-1">
          <button
            type="button"
            disabled={!store.canUndo}
            onClick={() => store.undo()}
            title={store.canUndo ? `Undo ${store.undoLabel}` : 'Undo'}
            className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-[#1F2430] flex items-center justify-center disabled:opacity-35 text-slate-500 dark:text-[#949BB0] hover:text-slate-900 dark:hover:text-white"
          >
            <Undo2 size={15} />
          </button>
          <button
            type="button"
            disabled={!store.canRedo}
            onClick={() => store.redo()}
            title="Redo"
            className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-[#1F2430] flex items-center justify-center disabled:opacity-35 text-slate-500 dark:text-[#949BB0] hover:text-slate-900 dark:hover:text-white"
          >
            <Redo2 size={15} />
          </button>
        </div>

        {/* Export Project ZIP */}
        <button
          type="button"
          onClick={() => setShowingExportZip(true)}
          title="Export adventure as a downloadable .zip archive"
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold shrink-0 whitespace-nowrap transition-colors ${
            showingExportZip
              ? 'bg-[#7C5CFF]/18 text-[#7C5CFF] ring-1 ring-[#7C5CFF]/45'
              : 'bg-slate-100 dark:bg-[#1F2430] hover:bg-slate-200 dark:hover:bg-[#272D3C]'
          }`}
        >
          <FileArchive size={13} className="text-[#7C5CFF]" />
          <span className="hidden sm:inline">Export</span>
        </button>

        {/* Play */}
        <button
          type="button"
          onClick={() => {
            store.setPlayFromPoint(null);
            store.setIsPlaying(true);
          }}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#20B46A] text-white text-xs sm:text-sm font-extrabold hover:opacity-95 shadow-sm shadow-[#20B46A]/25 shrink-0"
        >
          <Play size={13} fill="currentColor" />
          <span>Play</span>
        </button>
      </header>
      </Profiler>

      {/* Main Stage */}
      <Profiler id={`EditorShell.Stage.${store.selectedTab}`} onRender={onEditorProfilerRender}>
        <div className="flex-1 min-h-0 overflow-hidden">
          {store.selectedTab === 'world' && <WorldStage store={store} />}
          {store.selectedTab === 'cast' && <CastStage store={store} />}
          {store.selectedTab === 'motion' && <MotionStage store={store} />}
          {store.selectedTab === 'logic' && <LogicStage store={store} />}
          {store.selectedTab === 'actions' && <ActionsStage store={store} />}
          {store.selectedTab === 'interface' && <InterfaceStage store={store} />}
          {store.selectedTab === 'publish' && <PublishStage store={store} />}
        </div>
      </Profiler>

      {/* Bottom Stage Tab Bar */}
      <nav className="shrink-0 bg-white dark:bg-[#171A23] border-t border-slate-200/80 dark:border-white/[0.08] px-2 sm:px-6 py-2 flex items-center justify-start sm:justify-center gap-1 sm:gap-2 overflow-x-auto maker-scroll">
        {STAGE_TABS.map((tab) => {
          const active = store.selectedTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => store.setSelectedTab(tab.id)}
              className={`flex items-center gap-2 px-3.5 sm:px-5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all shrink-0 ${
                active
                  ? 'bg-[#7C5CFF] text-white shadow-xs'
                  : 'text-slate-500 dark:text-[#949BB0] hover:bg-slate-100 dark:hover:bg-[#1F2430] hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <MakerIcon
                symbol={tab.symbol}
                size={15}
                color={active ? '#FFFFFF' : 'currentColor'}
              />
              <span>{tab.title}</span>
            </button>
          );
        })}
      </nav>

      <Profiler id="EditorShell.Overlays" onRender={onEditorProfilerRender}>
        {store.showingIdeas && (
          <IdeasModal store={store} onClose={() => store.setShowingIdeas(false)} />
        )}

        {store.showingAssetVault && (
          <AssetVaultModal store={store} onClose={() => store.setShowingAssetVault(false)} />
        )}

        {store.showingPresets && (
          <SavePresetsModal store={store} onClose={() => store.setShowingPresets(false)} />
        )}

        {store.showingLogicFlow && (
          <LogicFlowModal store={store} onClose={() => store.setShowingLogicFlow(false)} />
        )}

        {store.showingDirector && (
          <StoryDirectorModal store={store} onClose={() => store.setShowingDirector(false)} />
        )}

        {showingSkybox && (
          <SkyboxLightingEditorModal store={store} onClose={() => setShowingSkybox(false)} />
        )}

        {store.showingTerrainEditor && (
          <TerrainEditorModal store={store} onClose={() => store.setShowingTerrainEditor(false)} />
        )}

        {showingPostFx && (
          <PostProcessingMenuModal store={store} onClose={() => setShowingPostFx(false)} />
        )}

        {showingExportZip && (
          <ExportProjectZipModal store={store} onClose={() => setShowingExportZip(false)} />
        )}

        <PersistentMinimapHUD store={store} />
      </Profiler>

      {store.isPlaying && (
        <Profiler id="EditorShell.PlayMode" onRender={onEditorProfilerRender}>
          <PlayModeView store={store} />
        </Profiler>
      )}
    </div>
  );
};
