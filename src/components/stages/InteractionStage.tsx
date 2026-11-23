import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Bookmark,
  BookmarkPlus,
  Box,
  Check,
  Compass,
  Eye,
  GitBranch,
  Layers,
  Link2,
  MapPin,
  Move3d,
  Network,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  Wrench,
} from 'lucide-react';
import {
  BUILTIN_MECHANISM_PRESETS,
  createPresetFromMechanism,
  instantiatePresetForPart,
  loadSavedMechanismPresets,
  PUZZLE_CHAIN_PRESETS,
  saveCustomMechanismPresets,
  type MechanismPresetDef,
  type PresetCategory,
  type PuzzleChainPresetDef,
} from '../../data/mechanismPresets';
import type { MakerStore } from '../../store/useMakerStore';
import {
  BUILTIN_MECHANISM_TEMPLATES,
  computePivotPresetForPart,
  getDefaultMechanismsForTemplate,
  type ObjectPartNode,
  type PivotSnapPreset,
} from '../../three/mechanismController';
import type {
  BuiltinMechanismTemplate,
  CustomAssetMeta,
  MechanismActionMode,
  MechanismAxis,
  MechanismConditionKind,
  MechanismKind,
  MechanismPlaybackMode,
  MechanismTriggerEvent,
  MechanismTriggerRule,
  MotionEasing,
  ObjectMechanism,
} from '../../types/maker';
import { uid } from '../../utils/terrain';
import { EASING_OPTIONS, EasingCurveIcon } from '../shared/MotionEditorPanel';
import {
  MechanismPreviewStage,
  type MechanismCameraPreset,
  type WireframeLogicSummary,
} from '../shared/MechanismPreviewStage';

const TRIGGER_EVENT_LABELS: Record<MechanismTriggerEvent, string> = {
  playerUses: 'Player presses Interact (E / Use)',
  playerNear: 'Player walks near object',
  playerTouches: 'Player touches / steps on object',
  flagSet: 'Game flag becomes active',
  levelStarts: 'Level starts',
};

const CONDITION_LABELS: Record<MechanismConditionKind, string> = {
  none: 'Always (no condition)',
  hasKey: 'Player has a Key',
  hasItem: 'Player has Inventory Item',
  flagSet: 'Game flag is set',
  baddiesGone: 'All baddies are defeated',
};

const ACTION_LABELS: Record<MechanismActionMode, string> = {
  toggle: 'Toggle Open / Closed',
  open: 'Open / Activate',
  close: 'Close / Reset',
};

const SNAP_PRESETS: { id: PivotSnapPreset; label: string }[] = [
  { id: 'backEdge', label: 'Back Edge' },
  { id: 'frontEdge', label: 'Front Edge' },
  { id: 'leftEdge', label: 'Left Edge' },
  { id: 'rightEdge', label: 'Right Edge' },
  { id: 'bottomCenter', label: 'Bottom' },
  { id: 'partCenter', label: 'Center' },
];

function createDefaultTriggerRule(): MechanismTriggerRule {
  return {
    id: uid(),
    event: 'playerUses',
    radius: 2.4,
    condition: 'none',
    action: 'toggle',
    sound: 'door',
  };
}

function summarizeTriggerRule(
  rule: MechanismTriggerRule,
  mechName: string,
  itemNames: Map<string, string>
): string {
  const whenStr =
    rule.event === 'flagSet'
      ? `When flag "${rule.eventFlag?.trim() || 'switch_on'}" is set`
      : rule.event === 'levelStarts'
      ? 'When the level starts'
      : `When ${TRIGGER_EVENT_LABELS[rule.event].toLowerCase()} (within ${rule.radius.toFixed(1)}m)`;

  let ifStr = '';
  if (rule.condition === 'hasKey') {
    ifStr = rule.consumeRequired ? ', if player spends a Key' : ', if player has a Key';
  } else if (rule.condition === 'hasItem') {
    const itemName = (rule.conditionValue && itemNames.get(rule.conditionValue)) || 'item';
    ifStr = `, if player carries ${itemName}`;
  } else if (rule.condition === 'flagSet') {
    ifStr = `, if flag "${rule.conditionValue?.trim() || 'lever_pulled'}" is active`;
  } else if (rule.condition === 'baddiesGone') {
    ifStr = ', if all baddies are defeated';
  }

  const effects: string[] = [
    `${ACTION_LABELS[rule.action].toLowerCase()} "${mechName || 'part'}"`,
  ];
  if (rule.setFlagOnOpen?.trim()) {
    effects.push(`set flag "${rule.setFlagOnOpen.trim()}"`);
  }
  if (rule.rewardCoins && rule.rewardCoins > 0) {
    effects.push(`award +${rule.rewardCoins} coins`);
  }
  if (rule.rewardItemId && itemNames.has(rule.rewardItemId)) {
    effects.push(`give ${itemNames.get(rule.rewardItemId)}`);
  }

  return `${whenStr}${ifStr}, then ${effects.join(' & ')}.`;
}

export const InteractionStage: React.FC<{ store: MakerStore }> = ({ store }) => {
  // Prefer prop/scenery GLBs first, then any other custom GLB
  const customObjects = useMemo(() => {
    const props = store.customAssets.filter((a) => a.category !== 'character');
    const chars = store.customAssets.filter((a) => a.category === 'character');
    return [...props, ...chars];
  }, [store.customAssets]);

  const [sourceKind, setSourceKind] = useState<'builtin' | 'custom'>(() =>
    store.interactionAssetId && store.customAssets.some((a) => a.id === store.interactionAssetId)
      ? 'custom'
      : 'builtin'
  );
  const [builtinTemplate, setBuiltinTemplate] =
    useState<BuiltinMechanismTemplate>('treasureChest');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(
    () => store.interactionAssetId ?? customObjects[0]?.id ?? null
  );

  // Built-in editable mechanisms stored per template in studio session
  const [builtinMechMap, setBuiltinMechMap] = useState<
    Record<BuiltinMechanismTemplate, ObjectMechanism[]>
  >(() => ({
    treasureChest: getDefaultMechanismsForTemplate('treasureChest'),
    slidingDoor: getDefaultMechanismsForTemplate('slidingDoor'),
    leverSwitch: getDefaultMechanismsForTemplate('leverSwitch'),
    drawbridge: getDefaultMechanismsForTemplate('drawbridge'),
  }));

  // Sync if user routed here targeting a specific custom asset
  useEffect(() => {
    if (store.interactionAssetId && store.customAssets.some((a) => a.id === store.interactionAssetId)) {
      setSourceKind('custom');
      setSelectedAssetId(store.interactionAssetId);
    }
  }, [store.interactionAssetId, store.customAssets]);

  const activeCustomAsset: CustomAssetMeta | null = useMemo(() => {
    if (sourceKind !== 'custom') return null;
    if (selectedAssetId) {
      return store.customAssets.find((a) => a.id === selectedAssetId) ?? customObjects[0] ?? null;
    }
    return customObjects[0] ?? null;
  }, [sourceKind, selectedAssetId, store.customAssets, customObjects]);

  const activeMechanisms: ObjectMechanism[] = useMemo(() => {
    if (sourceKind === 'builtin') {
      return builtinMechMap[builtinTemplate] ?? [];
    }
    return activeCustomAsset?.mechanisms ?? [];
  }, [sourceKind, builtinTemplate, builtinMechMap, activeCustomAsset]);

  const [parts, setParts] = useState<ObjectPartNode[]>([]);
  const [activeMechanismId, setActiveMechanismId] = useState<string | null>(
    () => activeMechanisms[0]?.id ?? null
  );
  const [selectedPartPath, setSelectedPartPath] = useState<string | null>(
    () => activeMechanisms[0]?.targetNodePath ?? null
  );
  const [inspectorTab, setInspectorTab] = useState<'constraint' | 'triggers' | 'presets'>('constraint');

  // Viewport & test controls
  const [previewProgress, setPreviewProgress] = useState<number>(0);
  const [testTargetOpen, setTestTargetOpen] = useState<boolean | null>(null);
  const [testTriggerNonce, setTestTriggerNonce] = useState<number>(0);
  const [editPivotGizmo, setEditPivotGizmo] = useState<boolean>(true);
  const [xrayOthers, setXrayOthers] = useState<boolean>(false);
  const [wireframeMode, setWireframeMode] = useState<boolean>(false);
  const [wireframeSummary, setWireframeSummary] = useState<WireframeLogicSummary>({
    triggerCount: 0,
    linkCount: 0,
    crossObjectLinks: 0,
    flagsBroadcast: [],
    flagsListened: [],
  });
  const [highlightedTriggerId, setHighlightedTriggerId] = useState<string | null>(null);
  const [cameraPreset, setCameraPreset] = useState<MechanismCameraPreset>('threeQuarter');
  const [cameraResetNonce, setCameraResetNonce] = useState<number>(0);
  const [uploading, setUploading] = useState<boolean>(false);
  const [toast, setToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Preset library state
  const [presetFilter, setPresetFilter] = useState<'all' | PresetCategory | 'chains'>('all');
  const [presetSearch, setPresetSearch] = useState<string>('');
  const [customPresets, setCustomPresets] = useState<MechanismPresetDef[]>(() =>
    loadSavedMechanismPresets()
  );
  const [savingPreset, setSavingPreset] = useState<boolean>(false);
  const [newPresetName, setNewPresetName] = useState<string>('');

  const flashToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2400);
  }, []);

  // Keep activeMechanismId valid when switching objects
  useEffect(() => {
    setPreviewProgress(0);
    setTestTargetOpen(null);
    const first = activeMechanisms[0] ?? null;
    setActiveMechanismId(first?.id ?? null);
    setSelectedPartPath(first?.targetNodePath ?? null);
  }, [sourceKind, builtinTemplate, activeCustomAsset?.id]);

  const activeMechanism = useMemo(
    () => activeMechanisms.find((m) => m.id === activeMechanismId) ?? null,
    [activeMechanisms, activeMechanismId]
  );

  const selectedPart = useMemo(
    () => parts.find((p) => p.path === selectedPartPath) ?? null,
    [parts, selectedPartPath]
  );

  const itemCatalog = store.currentProject?.inventoryItems ?? [];
  const itemNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of itemCatalog) {
      map.set(item.id, item.name);
    }
    return map;
  }, [itemCatalog]);

  // Persist mechanism changes to either built-in map or CustomAssetMeta (IndexedDB)
  const commitMechanisms = useCallback(
    (nextList: ObjectMechanism[]) => {
      if (sourceKind === 'builtin') {
        setBuiltinMechMap((prev) => ({ ...prev, [builtinTemplate]: nextList }));
      } else if (activeCustomAsset) {
        void store.updateCustomAssetMeta({
          ...activeCustomAsset,
          mechanisms: nextList,
        });
      }
    },
    [sourceKind, builtinTemplate, activeCustomAsset, store]
  );

  const updateActiveMechanism = useCallback(
    (updater: (mech: ObjectMechanism) => ObjectMechanism) => {
      if (!activeMechanismId) return;
      const nextList = activeMechanisms.map((m) => (m.id === activeMechanismId ? updater(m) : m));
      commitMechanisms(nextList);
    },
    [activeMechanismId, activeMechanisms, commitMechanisms]
  );

  const handlePartsLoaded = useCallback(
    (loadedParts: ObjectPartNode[]) => {
      setParts(loadedParts);
      if (loadedParts.length > 0) {
        setSelectedPartPath((prev) => {
          if (prev && loadedParts.some((p) => p.path === prev)) return prev;
          return loadedParts[loadedParts.length > 1 ? 1 : 0].path;
        });
      } else {
        setSelectedPartPath(null);
      }
    },
    []
  );

  const handleSelectPart = useCallback(
    (partPath: string) => {
      setSelectedPartPath(partPath);
      // If a mechanism already targets this child part, focus it automatically
      const existing = activeMechanisms.find((m) => m.targetNodePath === partPath);
      if (existing) {
        setActiveMechanismId(existing.id);
      }
    },
    [activeMechanisms]
  );

  const handleAddMechanism = (kind: MechanismKind) => {
    const target = selectedPart ?? parts[parts.length > 1 ? 1 : 0] ?? null;
    if (!target) {
      flashToast('Select a child part first');
      return;
    }
    const pivot = computePivotPresetForPart(
      target,
      kind === 'hinge' ? 'backEdge' : 'partCenter'
    );
    const newMech: ObjectMechanism = {
      id: uid(),
      name: `${target.label} ${kind === 'hinge' ? 'Hinge' : 'Slider'}`,
      targetNodePath: target.path,
      targetLabel: target.label,
      kind,
      axis: 'x',
      pivot,
      restAngleDeg: 0,
      openAngleDeg: kind === 'hinge' ? -95 : 0,
      restOffset: 0,
      openOffset: kind === 'slider' ? 1.2 : 0,
      duration: 0.85,
      easing: kind === 'hinge' ? 'smooth' : 'easeOut',
      playbackMode: 'toggle',
      triggers: [createDefaultTriggerRule()],
    };
    const nextList = [...activeMechanisms, newMech];
    commitMechanisms(nextList);
    setActiveMechanismId(newMech.id);
    setSelectedPartPath(target.path);
    setInspectorTab('constraint');
    setPreviewProgress(0);
    flashToast(`Added ${kind === 'hinge' ? 'Hinge' : 'Slider'} to ${target.label}`);
  };

  const handleDeleteMechanism = (mechId: string) => {
    const nextList = activeMechanisms.filter((m) => m.id !== mechId);
    commitMechanisms(nextList);
    if (activeMechanismId === mechId) {
      setActiveMechanismId(nextList[0]?.id ?? null);
      setPreviewProgress(0);
    }
    flashToast('Removed mechanism');
  };

  const handleChangePivot = useCallback(
    (pivot: [number, number, number]) => {
      updateActiveMechanism((m) => ({ ...m, pivot }));
    },
    [updateActiveMechanism]
  );

  const handleSnapPivot = (preset: PivotSnapPreset) => {
    if (!activeMechanism) return;
    const part = parts.find((p) => p.path === activeMechanism.targetNodePath) ?? selectedPart;
    if (!part) return;
    const snapped = computePivotPresetForPart(part, preset);
    updateActiveMechanism((m) => ({ ...m, pivot: snapped }));
  };

  const handleToggleTestAnimate = () => {
    if (!activeMechanism) return;
    const nextOpen = previewProgress < 0.5;
    setTestTargetOpen(nextOpen);
    setTestTriggerNonce((n) => n + 1);
  };

  const handleUploadPropGlb = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const file = files[0];
      if (!/\.(glb|gltf)$/i.test(file.name)) {
        flashToast('Select a .glb or .gltf file');
        return;
      }
      const meta = await store.uploadCustomGlb(file, 'prop');
      setSourceKind('custom');
      setSelectedAssetId(meta.id);
      store.setInteractionAssetId(meta.id);
      flashToast(`Imported "${meta.name}"`);
    } catch (err) {
      flashToast(err instanceof Error ? err.message : 'Failed to load model');
    } finally {
      setUploading(false);
    }
  };

  const handlePlaceInLevel = () => {
    if (sourceKind === 'builtin') {
      const meta = BUILTIN_MECHANISM_TEMPLATES.find((t) => t.id === builtinTemplate)!;
      store.addMechanicalEntityToLevel({
        name: meta.name,
        kind: meta.entityKind,
        mechTemplate: builtinTemplate,
        mechanisms: JSON.parse(JSON.stringify(activeMechanisms)),
      });
      flashToast(`Placed "${meta.name}" into current level`);
    } else if (activeCustomAsset) {
      store.addMechanicalEntityToLevel({
        name: activeCustomAsset.name,
        kind: 'prop',
        customAssetId: activeCustomAsset.id,
        mechanisms: JSON.parse(JSON.stringify(activeMechanisms)),
      });
      flashToast(`Placed "${activeCustomAsset.name}" into current level`);
    }
  };

  const triggerCamera = (preset: MechanismCameraPreset) => {
    setCameraPreset(preset);
    setCameraResetNonce((n) => n + 1);
  };

  // Click handler for projected 3D trigger / flag labels in Wireframe Mode
  const handleSelectMechanismTrigger = useCallback(
    (mechId: string, triggerId?: string) => {
      const targetMech = activeMechanisms.find((m) => m.id === mechId);
      if (!targetMech) return;
      setActiveMechanismId(targetMech.id);
      setSelectedPartPath(targetMech.targetNodePath);
      if (triggerId) {
        setInspectorTab('triggers');
        setHighlightedTriggerId(triggerId);
        window.setTimeout(() => {
          setHighlightedTriggerId((cur) => (cur === triggerId ? null : cur));
        }, 2600);
      } else {
        setInspectorTab('constraint');
      }
    },
    [activeMechanisms]
  );

  // Preset Library handlers
  const allMechanismPresets = useMemo(
    () => [...customPresets, ...BUILTIN_MECHANISM_PRESETS],
    [customPresets]
  );

  const filteredMechanismPresets = useMemo(() => {
    if (presetFilter === 'chains') return [];
    const q = presetSearch.trim().toLowerCase();
    return allMechanismPresets.filter((p) => {
      if (presetFilter !== 'all' && p.category !== presetFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.summary.toLowerCase().includes(q) ||
        p.kind.toLowerCase().includes(q)
      );
    });
  }, [allMechanismPresets, presetFilter, presetSearch]);

  const filteredPuzzleChains = useMemo(() => {
    if (presetFilter !== 'all' && presetFilter !== 'chains') return [];
    const q = presetSearch.trim().toLowerCase();
    return PUZZLE_CHAIN_PRESETS.filter((c) => {
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.summary.toLowerCase().includes(q) ||
        c.flagName.toLowerCase().includes(q)
      );
    });
  }, [presetFilter, presetSearch]);

  const handleApplyPreset = (preset: MechanismPresetDef, mode: 'replace' | 'add') => {
    const targetPart =
      selectedPart ??
      (activeMechanism ? parts.find((p) => p.path === activeMechanism.targetNodePath) : null) ??
      parts[parts.length > 1 ? 1 : 0] ??
      null;
    if (!targetPart) {
      flashToast('Select a child part first');
      return;
    }
    const built = instantiatePresetForPart(preset, targetPart);
    if (mode === 'replace' && activeMechanism) {
      const replaced: ObjectMechanism = {
        ...built,
        id: activeMechanism.id,
      };
      const nextList = activeMechanisms.map((m) => (m.id === activeMechanism.id ? replaced : m));
      commitMechanisms(nextList);
      setSelectedPartPath(targetPart.path);
      setPreviewProgress(0);
      setInspectorTab('constraint');
      flashToast(`Applied "${preset.name}" to ${targetPart.label}`);
    } else {
      const nextList = [...activeMechanisms, built];
      commitMechanisms(nextList);
      setActiveMechanismId(built.id);
      setSelectedPartPath(targetPart.path);
      setPreviewProgress(0);
      setInspectorTab('constraint');
      flashToast(`Added "${preset.name}" on ${targetPart.label}`);
    }
  };

  const handleSaveCurrentAsPreset = () => {
    if (!activeMechanism) return;
    const preset = createPresetFromMechanism(
      activeMechanism,
      newPresetName.trim() || activeMechanism.name
    );
    const next = [preset, ...customPresets];
    setCustomPresets(next);
    saveCustomMechanismPresets(next);
    setSavingPreset(false);
    setNewPresetName('');
    setPresetFilter('saved');
    flashToast(`Saved preset "${preset.name}"`);
  };

  const handleDeleteCustomPreset = (presetId: string) => {
    const next = customPresets.filter((p) => p.id !== presetId);
    setCustomPresets(next);
    saveCustomMechanismPresets(next);
    flashToast('Deleted saved preset');
  };

  const handleSpawnPuzzleChain = (chain: PuzzleChainPresetDef) => {
    for (const item of chain.items) {
      store.addMechanicalEntityToLevel({
        name: item.name,
        kind: item.entityKind,
        mechTemplate: item.mechTemplate,
        mechanisms: item.mechanismsFactory(),
      });
    }
    // Load the first object of the chain into the studio with its wired mechanisms and activate Wireframe mode so the user immediately sees the cross-object flag link!
    const lead = chain.items[0];
    if (lead) {
      const wiredMechs = lead.mechanismsFactory();
      setSourceKind('builtin');
      setBuiltinTemplate(lead.mechTemplate);
      setBuiltinMechMap((prev) => ({ ...prev, [lead.mechTemplate]: wiredMechs }));
      setActiveMechanismId(wiredMechs[0]?.id ?? null);
      setSelectedPartPath(wiredMechs[0]?.targetNodePath ?? null);
      setWireframeMode(true);
    }
    flashToast(`Spawned "${chain.name}" linked via "${chain.flagName}"`);
  };

  // Current interpolated numeric readout for live test bar
  const liveDisplacementReadout = useMemo(() => {
    if (!activeMechanism) return '—';
    if (activeMechanism.kind === 'hinge') {
      const deg =
        activeMechanism.restAngleDeg +
        (activeMechanism.openAngleDeg - activeMechanism.restAngleDeg) * previewProgress;
      return `${deg >= 0 ? '+' : ''}${deg.toFixed(1)}°`;
    }
    const dist =
      activeMechanism.restOffset +
      (activeMechanism.openOffset - activeMechanism.restOffset) * previewProgress;
    return `${dist >= 0 ? '+' : ''}${dist.toFixed(2)}m`;
  }, [activeMechanism, previewProgress]);

  const activeObjectTitle =
    sourceKind === 'builtin'
      ? BUILTIN_MECHANISM_TEMPLATES.find((t) => t.id === builtinTemplate)?.name ?? 'Object'
      : activeCustomAsset?.name ?? 'No Model Selected';

  return (
    <div className="h-full w-full flex flex-col bg-[#F4F5F8] dark:bg-[#0F1117] overflow-hidden">
      {/* TOP INTERACTION DESIGNER HEADER BAR */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-white dark:bg-[#171A23] border-b border-slate-200/80 dark:border-white/[0.08]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 pr-3 border-r border-slate-200/80 dark:border-white/[0.08] shrink-0">
            <Wrench size={16} className="text-[#7C5CFF]" />
            <span className="text-sm font-black tracking-tight whitespace-nowrap">
              Interaction Designer
            </span>
          </div>

          <div className="min-w-0 flex items-center gap-2 text-xs">
            <span className="font-bold text-slate-900 dark:text-white truncate">
              {activeObjectTitle}
            </span>
            <span aria-hidden="true" className="text-slate-400">
              ·
            </span>
            <span className="text-slate-500 dark:text-[#949BB0] tabular-nums whitespace-nowrap">
              {parts.length} parts · {activeMechanisms.length}{' '}
              {activeMechanisms.length === 1 ? 'mechanism' : 'mechanisms'}
            </span>
          </div>

          {toast && (
            <span className="text-xs font-bold text-[#16A34A] dark:text-[#34D399] inline-flex items-center gap-1 whitespace-nowrap">
              <Check size={13} />
              <span>{toast}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setWireframeMode((v) => !v)}
            title="Toggle glowing visual wireframe & trigger logic connections"
            className={`px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
              wireframeMode
                ? 'bg-[#06B6D4] text-slate-950'
                : 'bg-slate-100 dark:bg-[#1F2430] hover:bg-slate-200 dark:hover:bg-[#2A3142] text-slate-700 dark:text-[#D5DCF0]'
            }`}
          >
            <Network size={13} />
            <span>Wireframe Logic</span>
          </button>

          <button
            type="button"
            onClick={() => setInspectorTab('presets')}
            title="Open the Interaction Preset Library"
            className={`px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
              inspectorTab === 'presets'
                ? 'bg-[#F59E0B] text-slate-950'
                : 'bg-slate-100 dark:bg-[#1F2430] hover:bg-slate-200 dark:hover:bg-[#2A3142] text-slate-700 dark:text-[#D5DCF0]'
            }`}
          >
            <Bookmark size={12} />
            <span>Presets</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".glb,.gltf"
            className="hidden"
            onChange={(e) => {
              void handleUploadPropGlb(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-[#1F2430] hover:bg-slate-200 dark:hover:bg-[#2A3142] text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
          >
            <Upload size={12} className="text-[#7C5CFF]" />
            <span>{uploading ? 'Loading…' : 'Import GLB'}</span>
          </button>

          <button
            type="button"
            disabled={sourceKind === 'custom' && !activeCustomAsset}
            onClick={handlePlaceInLevel}
            className="px-3.5 py-1.5 rounded-lg bg-[#7C5CFF] hover:bg-[#6A48F5] text-white text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors disabled:opacity-40"
          >
            <MapPin size={13} />
            <span>Place in Level</span>
          </button>
        </div>
      </div>

      {/* MAIN 3-COLUMN WORKSPACE */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden maker-scroll">
        {/* LEFT SIDEBAR: OBJECT PICKER, NESTED CHILD TREE & MECHANISMS */}
        <aside className="w-full lg:w-64 xl:w-72 shrink-0 lg:h-full lg:overflow-y-auto maker-scroll bg-white dark:bg-[#171A23] border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-white/[0.08] p-4 space-y-4">
          {/* Source Selector: Built-In Complex Props vs Imported GLBs */}
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#12151E] border border-slate-200/70 dark:border-white/[0.08]">
              <button
                type="button"
                onClick={() => setSourceKind('builtin')}
                className={`py-1.5 px-2 rounded-lg text-[11px] font-bold whitespace-nowrap transition-colors ${
                  sourceKind === 'builtin'
                    ? 'bg-[#7C5CFF] text-white'
                    : 'text-slate-600 dark:text-[#A5AEC4] hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Complex Props
              </button>
              <button
                type="button"
                onClick={() => setSourceKind('custom')}
                className={`py-1.5 px-2 rounded-lg text-[11px] font-bold whitespace-nowrap transition-colors ${
                  sourceKind === 'custom'
                    ? 'bg-[#7C5CFF] text-white'
                    : 'text-slate-600 dark:text-[#A5AEC4] hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Imported ({customObjects.length})
              </button>
            </div>

            {sourceKind === 'builtin' ? (
              <div className="space-y-1.5">
                {BUILTIN_MECHANISM_TEMPLATES.map((tpl) => {
                  const active = builtinTemplate === tpl.id;
                  const count = builtinMechMap[tpl.id]?.length ?? 0;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => setBuiltinTemplate(tpl.id)}
                      className={`w-full text-left px-3 py-2 rounded-xl border transition-colors ${
                        active
                          ? 'border-[#7C5CFF] bg-[#7C5CFF]/10'
                          : 'border-slate-200/70 dark:border-white/[0.08] bg-slate-50 dark:bg-[#12151E] hover:border-[#7C5CFF]/45'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-extrabold truncate">{tpl.name}</span>
                        <span className="text-[10px] font-semibold text-slate-500 dark:text-[#8E96AB] tabular-nums shrink-0">
                          {count} {count === 1 ? 'joint' : 'joints'}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-[#949BB0] truncate mt-0.5">
                        {tpl.summary}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : customObjects.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 dark:border-white/[0.12] p-3.5 text-center space-y-2">
                <div className="text-xs font-bold text-slate-700 dark:text-[#D5DCF0]">
                  No Imported 3D Objects
                </div>
                <p className="text-[11px] text-slate-500 dark:text-[#8E96AB] leading-relaxed">
                  Import a multi-piece .glb or .gltf model (such as a chest with a separate lid, a
                  door frame + leaf, or a lever) to add hinges and sliders.
                </p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 rounded-lg bg-[#7C5CFF] text-white text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <Upload size={12} />
                  <span>Import GLB</span>
                </button>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-44 overflow-y-auto maker-scroll pr-0.5">
                {customObjects.map((asset) => {
                  const active = activeCustomAsset?.id === asset.id;
                  const mechCount = asset.mechanisms?.length ?? 0;
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => {
                        setSelectedAssetId(asset.id);
                        store.setInteractionAssetId(asset.id);
                      }}
                      className={`w-full flex items-center gap-2.5 p-2 rounded-xl border text-left transition-colors ${
                        active
                          ? 'border-[#7C5CFF] bg-[#7C5CFF]/10'
                          : 'border-slate-200/70 dark:border-white/[0.08] bg-slate-50 dark:bg-[#12151E] hover:border-[#7C5CFF]/45'
                      }`}
                    >
                      <div className="w-9 h-9 rounded-lg bg-slate-200/70 dark:bg-[#0B0E16] overflow-hidden shrink-0 flex items-center justify-center">
                        {asset.thumbnailDataUrl ? (
                          <img
                            src={asset.thumbnailDataUrl}
                            alt={asset.name}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <Box size={15} className="text-slate-400" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-extrabold truncate">{asset.name}</div>
                        <div className="text-[11px] text-slate-500 dark:text-[#949BB0] tabular-nums truncate">
                          {asset.category} · {mechCount} {mechCount === 1 ? 'joint' : 'joints'}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Mechanisms Attached to Active Object */}
          <div className="space-y-2 pt-3 border-t border-slate-200/70 dark:border-white/[0.08]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-slate-500 dark:text-[#949BB0]">
                Mechanisms ({activeMechanisms.length})
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={parts.length === 0}
                  onClick={() => handleAddMechanism('hinge')}
                  title="Add a pivot hinge constraint to the selected child part"
                  className="px-2 py-1 rounded-md bg-[#7C5CFF]/15 hover:bg-[#7C5CFF] text-[#6A48F5] dark:text-[#C4B5FD] hover:text-white text-[10px] font-bold inline-flex items-center gap-1 whitespace-nowrap transition-colors disabled:opacity-40"
                >
                  <Plus size={10} />
                  <span>Hinge</span>
                </button>
                <button
                  type="button"
                  disabled={parts.length === 0}
                  onClick={() => handleAddMechanism('slider')}
                  title="Add a linear slider constraint to the selected child part"
                  className="px-2 py-1 rounded-md bg-slate-100 dark:bg-[#1F2430] hover:bg-[#7C5CFF] text-slate-700 dark:text-[#D5DCF0] hover:text-white text-[10px] font-bold inline-flex items-center gap-1 whitespace-nowrap transition-colors disabled:opacity-40"
                >
                  <Plus size={10} />
                  <span>Slider</span>
                </button>
              </div>
            </div>

            {activeMechanisms.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 dark:border-white/[0.1] p-3 text-[11px] text-slate-500 dark:text-[#8E96AB] leading-relaxed">
                Click a movable child element below (or directly in 3D), then click{' '}
                <strong className="text-slate-700 dark:text-white">+ Hinge</strong> or{' '}
                <strong className="text-slate-700 dark:text-white">+ Slider</strong>.
              </div>
            ) : (
              <div className="space-y-1.5">
                {activeMechanisms.map((mech) => {
                  const active = mech.id === activeMechanismId;
                  return (
                    <div
                      key={mech.id}
                      className={`p-2 rounded-xl border transition-colors ${
                        active
                          ? 'border-[#7C5CFF] bg-[#7C5CFF]/10'
                          : 'border-slate-200/70 dark:border-white/[0.08] bg-slate-50 dark:bg-[#12151E]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveMechanismId(mech.id);
                            setSelectedPartPath(mech.targetNodePath);
                            setPreviewProgress(0);
                          }}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="text-xs font-extrabold truncate">{mech.name}</div>
                          <div className="text-[10px] text-slate-500 dark:text-[#949BB0] tabular-nums truncate">
                            {mech.kind === 'hinge'
                              ? `Hinge ${mech.axis.toUpperCase()} · ${mech.openAngleDeg}°`
                              : `Slider ${mech.axis.toUpperCase()} · ${mech.openOffset > 0 ? '+' : ''}${mech.openOffset}m`}{' '}
                            · {mech.triggers.length}{' '}
                            {mech.triggers.length === 1 ? 'trigger' : 'triggers'}
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteMechanism(mech.id)}
                          title="Delete mechanism"
                          aria-label={`Delete ${mech.name}`}
                          className="p-1 rounded-md text-slate-400 hover:text-[#F2545B] hover:bg-[#F2545B]/15 shrink-0"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Nested Child Elements Tree */}
          <div className="space-y-2 pt-3 border-t border-slate-200/70 dark:border-white/[0.08]">
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-[#949BB0]">
              <span className="inline-flex items-center gap-1.5">
                <Layers size={12} />
                <span>Nested Child Elements</span>
              </span>
              <span className="tabular-nums">{parts.length}</span>
            </div>

            {parts.length === 0 ? (
              <div className="text-[11px] text-slate-400 dark:text-[#6B7285] py-2">
                No child meshes detected.
              </div>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto maker-scroll pr-0.5">
                {parts.map((part) => {
                  const isSel = selectedPartPath === part.path;
                  const attached = activeMechanisms.find((m) => m.targetNodePath === part.path);
                  return (
                    <button
                      key={part.path}
                      type="button"
                      onClick={() => handleSelectPart(part.path)}
                      style={{ paddingLeft: `${8 + Math.min(part.depth, 4) * 14}px` }}
                      className={`w-full pr-2 py-1.5 rounded-lg text-left flex items-center justify-between gap-2 text-xs transition-colors ${
                        isSel
                          ? 'bg-[#F59E0B] text-slate-950 font-extrabold'
                          : 'bg-slate-50 dark:bg-[#12151E] text-slate-700 dark:text-[#C8D0E4] hover:bg-slate-100 dark:hover:bg-[#1F2430] font-semibold'
                      }`}
                    >
                      <span className="truncate">{part.label}</span>
                      <span
                        className={`text-[10px] shrink-0 tabular-nums ${
                          isSel
                            ? 'text-slate-900/80 font-bold'
                            : attached
                            ? 'text-[#7C5CFF] font-bold'
                            : 'text-slate-400 dark:text-[#7E869C]'
                        }`}
                      >
                        {attached
                          ? attached.kind === 'hinge'
                            ? 'Hinge'
                            : 'Slider'
                          : part.isMesh
                          ? 'Mesh'
                          : `${part.meshCount}m`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        {/* CENTER 3D VIEWPORT + LIVE TEST SCRUB BAR */}
        <main className="flex-1 min-w-0 min-h-[380px] lg:min-h-0 flex flex-col bg-[#111521]">
          <div className="flex-1 min-h-0 relative">
            <MechanismPreviewStage
              sourceKind={sourceKind}
              builtinTemplate={builtinTemplate}
              customAsset={activeCustomAsset}
              mechanisms={activeMechanisms}
              activeMechanismId={activeMechanismId}
              selectedPartPath={selectedPartPath}
              previewProgress={previewProgress}
              testTargetOpen={testTargetOpen}
              testTriggerNonce={testTriggerNonce}
              editPivotGizmo={editPivotGizmo}
              xrayOthers={xrayOthers}
              wireframeMode={wireframeMode}
              levelEntities={store.currentLevel?.entities ?? []}
              cameraPreset={cameraPreset}
              cameraResetNonce={cameraResetNonce}
              onPartsLoaded={handlePartsLoaded}
              onSelectPart={handleSelectPart}
              onSelectMechanismTrigger={handleSelectMechanismTrigger}
              onChangePivot={handleChangePivot}
              onProgressTick={setPreviewProgress}
              onWireframeSummary={setWireframeSummary}
            />

            {/* Compact Top-Left Camera, Wireframe Logic & Seam Inspection Controls */}
            <div className="absolute top-3 left-3 flex flex-wrap items-center gap-1 p-1 rounded-xl bg-[#171A23]/95 border border-white/[0.12] z-20">
              {(
                [
                  ['front', 'Front'],
                  ['side', 'Side'],
                  ['top', 'Top'],
                  ['threeQuarter', 'Reset'],
                ] as const
              ).map(([preset, label]) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => triggerCamera(preset)}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-[#C8D0E4] hover:text-white hover:bg-white/10 whitespace-nowrap"
                >
                  {label}
                </button>
              ))}
              <div className="w-px h-4 bg-white/15 mx-0.5" />
              <button
                type="button"
                onClick={() => setWireframeMode((v) => !v)}
                title="Render object in schematic wireframe with glowing trigger-to-target logic lines"
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 whitespace-nowrap ${
                  wireframeMode
                    ? 'bg-[#06B6D4] text-slate-950'
                    : 'text-[#C8D0E4] hover:text-white hover:bg-white/10'
                }`}
              >
                <Network size={12} />
                <span>Wireframe</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (wireframeMode) setWireframeMode(false);
                  setXrayOthers((v) => !v);
                }}
                title="Make unselected parts translucent so hidden seams and hinge pins are visible"
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 whitespace-nowrap ${
                  xrayOthers && !wireframeMode
                    ? 'bg-[#38BDF8] text-slate-950'
                    : 'text-[#C8D0E4] hover:text-white hover:bg-white/10'
                }`}
              >
                <Eye size={12} />
                <span>X-Ray</span>
              </button>
              {activeMechanism?.kind === 'hinge' && (
                <button
                  type="button"
                  onClick={() => setEditPivotGizmo((v) => !v)}
                  title="Show 3D translate gizmo on the hinge pivot point"
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 whitespace-nowrap ${
                    editPivotGizmo
                      ? 'bg-[#F59E0B] text-slate-950'
                      : 'text-[#C8D0E4] hover:text-white hover:bg-white/10'
                  }`}
                >
                  <Move3d size={12} />
                  <span>Move Pivot</span>
                </button>
              )}
            </div>

            {/* Compact Top-Right Wireframe Logic Debugger Summary */}
            {wireframeMode && (
              <div className="pointer-events-none absolute top-3 right-3 px-3 py-1.5 rounded-xl bg-[#0D1322]/95 border border-[#06B6D4]/40 text-[11px] text-slate-200 flex items-center gap-2 tabular-nums z-20">
                <span className="font-bold text-[#38BDF8]">
                  {wireframeSummary.triggerCount}{' '}
                  {wireframeSummary.triggerCount === 1 ? 'Trigger' : 'Triggers'}
                </span>
                <span aria-hidden="true" className="text-slate-500">
                  ·
                </span>
                <span className="font-bold text-white">
                  {wireframeSummary.linkCount}{' '}
                  {wireframeSummary.linkCount === 1 ? 'Link' : 'Links'}
                </span>
                {wireframeSummary.crossObjectLinks > 0 && (
                  <>
                    <span aria-hidden="true" className="text-slate-500">
                      ·
                    </span>
                    <span className="font-bold text-[#34D399]">
                      {wireframeSummary.crossObjectLinks} Level{' '}
                      {wireframeSummary.crossObjectLinks === 1 ? 'Link' : 'Links'}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Bottom Interactive Activation Test Bar */}
          <div className="shrink-0 bg-white dark:bg-[#171A23] border-t border-slate-200/80 dark:border-white/[0.08] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!activeMechanism}
                onClick={handleToggleTestAnimate}
                className="px-3.5 py-1.5 rounded-lg bg-[#20B46A] hover:opacity-95 text-white text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-40"
              >
                <Play size={12} fill="currentColor" />
                <span>{previewProgress < 0.5 ? 'Test Activate' : 'Test Reset'}</span>
              </button>

              <button
                type="button"
                disabled={!activeMechanism}
                onClick={() => {
                  setTestTargetOpen(null);
                  setPreviewProgress(0);
                }}
                title="Snap back to 0% resting state"
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-[#1F2430] hover:bg-slate-200 dark:hover:bg-[#2A3142] text-xs font-bold inline-flex items-center gap-1 whitespace-nowrap disabled:opacity-40"
              >
                <RotateCcw size={12} />
                <span>Rest</span>
              </button>
            </div>

            <div className="flex-1 min-w-[200px] flex items-center gap-3">
              <span className="text-[11px] font-bold text-slate-500 dark:text-[#949BB0] whitespace-nowrap">
                Closed
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                disabled={!activeMechanism}
                value={previewProgress}
                onChange={(e) => {
                  setTestTargetOpen(null);
                  setPreviewProgress(Number(e.target.value));
                }}
                aria-label="Test mechanism open progress"
                className="flex-1 accent-[#7C5CFF] disabled:opacity-40"
              />
              <span className="text-[11px] font-bold text-slate-500 dark:text-[#949BB0] whitespace-nowrap">
                Open
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-slate-600 dark:text-[#C8D0E4]">
              <span className="font-bold text-slate-900 dark:text-white">
                {liveDisplacementReadout}
              </span>
              <span aria-hidden="true" className="text-slate-400">
                ·
              </span>
              <span>{Math.round(previewProgress * 100)}%</span>
            </div>
          </div>
        </main>

        {/* RIGHT INSPECTOR: CONSTRAINT, CONDITIONAL TRIGGERS & PRESET LIBRARY */}
        <aside className="w-full lg:w-80 xl:w-[360px] shrink-0 lg:h-full lg:overflow-y-auto maker-scroll bg-white dark:bg-[#171A23] border-t lg:border-t-0 lg:border-l border-slate-200/80 dark:border-white/[0.08] p-4 space-y-4">
          {/* Inspector Mode Switcher */}
          <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#12151E] border border-slate-200/70 dark:border-white/[0.08]">
            <button
              type="button"
              onClick={() => setInspectorTab('constraint')}
              className={`py-1.5 px-2 rounded-lg text-[11px] font-bold inline-flex items-center justify-center gap-1 whitespace-nowrap transition-colors ${
                inspectorTab === 'constraint'
                  ? 'bg-[#7C5CFF] text-white'
                  : 'text-slate-600 dark:text-[#A5AEC4] hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <SlidersHorizontal size={11} />
              <span>Joint</span>
            </button>
            <button
              type="button"
              onClick={() => setInspectorTab('triggers')}
              className={`py-1.5 px-2 rounded-lg text-[11px] font-bold inline-flex items-center justify-center gap-1 whitespace-nowrap transition-colors ${
                inspectorTab === 'triggers'
                  ? 'bg-[#7C5CFF] text-white'
                  : 'text-slate-600 dark:text-[#A5AEC4] hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <GitBranch size={11} />
              <span>Triggers ({activeMechanism?.triggers.length ?? 0})</span>
            </button>
            <button
              type="button"
              onClick={() => setInspectorTab('presets')}
              className={`py-1.5 px-2 rounded-lg text-[11px] font-bold inline-flex items-center justify-center gap-1 whitespace-nowrap transition-colors ${
                inspectorTab === 'presets'
                  ? 'bg-[#7C5CFF] text-white'
                  : 'text-slate-600 dark:text-[#A5AEC4] hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Bookmark size={11} />
              <span>Presets</span>
            </button>
          </div>

          {inspectorTab === 'presets' ? (
            /* TAB 3: INTERACTION PRESET LIBRARY */
            <div className="space-y-3.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-extrabold text-slate-900 dark:text-white">
                    Preset Library
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-[#949BB0]">
                    Apply to {selectedPart?.label ?? 'selected part'} or spawn linked puzzles
                  </div>
                </div>
                {activeMechanism && (
                  <button
                    type="button"
                    onClick={() => {
                      setSavingPreset((v) => !v);
                      setNewPresetName(activeMechanism.name);
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-[#7C5CFF]/15 hover:bg-[#7C5CFF] text-[#6A48F5] dark:text-[#C4B5FD] hover:text-white text-[11px] font-bold inline-flex items-center gap-1 whitespace-nowrap transition-colors"
                  >
                    <BookmarkPlus size={12} />
                    <span>Save</span>
                  </button>
                )}
              </div>

              {/* Save Current Mechanism Form */}
              {savingPreset && activeMechanism && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#12151E] border border-[#7C5CFF]/50 space-y-2">
                  <div className="text-[11px] font-bold text-slate-700 dark:text-[#D5DCF0]">
                    Save "{activeMechanism.name}" to Library
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={newPresetName}
                      onChange={(e) => setNewPresetName(e.target.value)}
                      placeholder="Preset name…"
                      className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#1B202E] border border-slate-200/80 dark:border-white/[0.08] text-xs font-semibold"
                    />
                    <button
                      type="button"
                      onClick={handleSaveCurrentAsPreset}
                      className="px-3 py-1.5 rounded-lg bg-[#7C5CFF] hover:bg-[#6A48F5] text-white text-xs font-bold whitespace-nowrap"
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}

              {/* Search & Category Filter */}
              <div className="space-y-2">
                <div className="relative">
                  <Search
                    size={13}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                  />
                  <input
                    type="text"
                    value={presetSearch}
                    onChange={(e) => setPresetSearch(e.target.value)}
                    placeholder="Search doors, levers, traps, flags…"
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-100 dark:bg-[#12151E] border border-slate-200/80 dark:border-white/[0.08] text-xs focus:outline-none focus:border-[#7C5CFF]"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  {(
                    [
                      ['all', 'All'],
                      ['doors', 'Doors'],
                      ['chests', 'Chests'],
                      ['switches', 'Switches'],
                      ['traps', 'Traps'],
                      ['chains', 'Chains'],
                      ['saved', `Saved (${customPresets.length})`],
                    ] as const
                  ).map(([cat, label]) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setPresetFilter(cat)}
                      className={`px-2 py-1 rounded-md text-[11px] font-bold whitespace-nowrap transition-colors ${
                        presetFilter === cat
                          ? 'bg-[#7C5CFF] text-white'
                          : 'bg-slate-100 dark:bg-[#12151E] text-slate-600 dark:text-[#A5AEC4] hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Linked Puzzle Chain Presets */}
              {filteredPuzzleChains.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-200/70 dark:border-white/[0.08]">
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-[#949BB0]">
                    <span className="inline-flex items-center gap-1.5">
                      <Link2 size={12} className="text-[#34D399]" />
                      <span>Linked Multi-Object Puzzle Chains</span>
                    </span>
                    <span className="tabular-nums">{filteredPuzzleChains.length}</span>
                  </div>

                  <div className="space-y-2">
                    {filteredPuzzleChains.map((chain) => (
                      <div
                        key={chain.id}
                        className="p-3 rounded-xl bg-slate-50 dark:bg-[#12151E] border border-slate-200/80 dark:border-white/[0.08] space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs font-extrabold text-slate-900 dark:text-white">
                              {chain.name}
                            </div>
                            <div className="text-[10px] font-mono text-[#16A34A] dark:text-[#34D399] mt-0.5">
                              Flag: {chain.flagName} · {chain.items.length}{' '}
                              {chain.items.length === 1 ? 'object' : 'objects'}
                            </div>
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-600 dark:text-[#9FA8BE] leading-snug">
                          {chain.summary}
                        </p>
                        <button
                          type="button"
                          onClick={() => handleSpawnPuzzleChain(chain)}
                          className="w-full py-1.5 px-3 rounded-lg bg-[#16A34A]/15 hover:bg-[#16A34A] text-[#15803D] dark:text-[#34D399] hover:text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <MapPin size={12} />
                          <span>Spawn Linked Set &amp; Inspect Wireframe</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Part Mechanism Presets */}
              {presetFilter !== 'chains' && (
                <div className="space-y-2 pt-2 border-t border-slate-200/70 dark:border-white/[0.08]">
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-[#949BB0]">
                    <span>Mechanism Presets</span>
                    <span className="tabular-nums">{filteredMechanismPresets.length}</span>
                  </div>

                  {filteredMechanismPresets.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 dark:border-white/[0.12] p-4 text-center text-[11px] text-slate-500 dark:text-[#8E96AB]">
                      {presetFilter === 'saved'
                        ? 'No saved presets yet. Configure a hinge or slider and click Save above.'
                        : 'No presets match your search.'}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filteredMechanismPresets.map((preset) => (
                        <div
                          key={preset.id}
                          className="p-3 rounded-xl bg-slate-50 dark:bg-[#12151E] border border-slate-200/80 dark:border-white/[0.08] space-y-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-xs font-extrabold text-slate-900 dark:text-white truncate">
                                {preset.name}
                              </div>
                              <div className="text-[10px] text-slate-500 dark:text-[#949BB0] tabular-nums mt-0.5">
                                {preset.kind === 'hinge'
                                  ? `Hinge ${preset.axis.toUpperCase()} · ${preset.openAngleDeg}°`
                                  : `Slider ${preset.axis.toUpperCase()} · ${preset.openOffset >= 0 ? '+' : ''}${preset.openOffset}m`}{' '}
                                · {preset.duration}s · {preset.triggers.length}{' '}
                                {preset.triggers.length === 1 ? 'trigger' : 'triggers'}
                              </div>
                            </div>
                            {preset.isCustom && (
                              <button
                                type="button"
                                onClick={() => handleDeleteCustomPreset(preset.id)}
                                title="Delete saved preset"
                                aria-label={`Delete ${preset.name}`}
                                className="p-1 rounded-md text-slate-400 hover:text-[#F2545B] hover:bg-[#F2545B]/15 shrink-0"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>

                          <p className="text-[11px] text-slate-600 dark:text-[#9FA8BE] leading-snug">
                            {preset.summary}
                          </p>

                          <div className="flex items-center gap-1.5 pt-0.5">
                            <button
                              type="button"
                              disabled={parts.length === 0}
                              onClick={() =>
                                handleApplyPreset(preset, activeMechanism ? 'replace' : 'add')
                              }
                              className="flex-1 py-1.5 px-2.5 rounded-lg bg-[#7C5CFF] hover:bg-[#6A48F5] text-white text-[11px] font-bold whitespace-nowrap transition-colors disabled:opacity-40"
                            >
                              {activeMechanism ? 'Apply to Active' : 'Apply to Part'}
                            </button>
                            {activeMechanism && (
                              <button
                                type="button"
                                disabled={parts.length === 0}
                                onClick={() => handleApplyPreset(preset, 'add')}
                                title="Keep existing mechanism and attach this preset as an additional joint"
                                className="py-1.5 px-2.5 rounded-lg bg-slate-200/80 dark:bg-[#1F2430] hover:bg-slate-300 dark:hover:bg-[#2A3142] text-slate-700 dark:text-[#D5DCF0] text-[11px] font-bold whitespace-nowrap transition-colors disabled:opacity-40"
                              >
                                + Add New
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : !activeMechanism ? (
            <div className="rounded-xl border border-dashed border-slate-300 dark:border-white/[0.12] p-5 text-center space-y-3">
              <div className="mx-auto w-10 h-10 rounded-xl bg-[#7C5CFF]/15 text-[#7C5CFF] flex items-center justify-center">
                <Compass size={18} />
              </div>
              <div className="text-sm font-extrabold">Select or Add a Mechanism</div>
              <p className="text-xs text-slate-500 dark:text-[#949BB0] leading-relaxed">
                Pick a movable child part like a chest lid or door panel, then add a pivot hinge or
                linear slider constraint.
              </p>
              <div className="flex items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={parts.length === 0}
                  onClick={() => handleAddMechanism('hinge')}
                  className="px-3 py-2 rounded-lg bg-[#7C5CFF] text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-40"
                >
                  <RotateCw size={12} />
                  <span>Add Hinge</span>
                </button>
                <button
                  type="button"
                  disabled={parts.length === 0}
                  onClick={() => handleAddMechanism('slider')}
                  className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-[#1F2430] text-slate-800 dark:text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-40"
                >
                  <ArrowLeftRight size={12} />
                  <span>Add Slider</span>
                </button>
              </div>
            </div>
          ) : inspectorTab === 'constraint' ? (
            <div className="space-y-4">
              {/* Mechanism Name & Target Child */}
              <div className="space-y-2.5">
                <div className="space-y-1">
                  <label className="block text-[11px] font-bold text-slate-500 dark:text-[#949BB0]">
                    Mechanism Name
                  </label>
                  <input
                    type="text"
                    value={activeMechanism.name}
                    onChange={(e) =>
                      updateActiveMechanism((m) => ({ ...m, name: e.target.value }))
                    }
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-[#12151E] border border-slate-200/80 dark:border-white/[0.08] text-xs font-bold focus:outline-none focus:border-[#7C5CFF]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[11px] font-bold text-slate-500 dark:text-[#949BB0]">
                    Movable Child Element
                  </label>
                  <select
                    value={activeMechanism.targetNodePath}
                    onChange={(e) => {
                      const nextPath = e.target.value;
                      const matched = parts.find((p) => p.path === nextPath);
                      setSelectedPartPath(nextPath);
                      updateActiveMechanism((m) => ({
                        ...m,
                        targetNodePath: nextPath,
                        targetLabel: matched?.label ?? nextPath,
                      }));
                    }}
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-[#12151E] border border-slate-200/80 dark:border-white/[0.08] text-xs font-bold"
                  >
                    {parts.map((p) => (
                      <option key={p.path} value={p.path}>
                        {'— '.repeat(Math.min(p.depth, 3))}
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Constraint Type & Axis */}
              <div className="space-y-2.5 pt-3 border-t border-slate-200/70 dark:border-white/[0.08]">
                <div className="space-y-1">
                  <span className="block text-[11px] font-bold text-slate-500 dark:text-[#949BB0]">
                    Constraint Type
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => updateActiveMechanism((m) => ({ ...m, kind: 'hinge' }))}
                      className={`py-2 px-3 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 border transition-colors ${
                        activeMechanism.kind === 'hinge'
                          ? 'border-[#7C5CFF] bg-[#7C5CFF]/15 text-[#6A48F5] dark:text-[#C4B5FD]'
                          : 'border-slate-200/80 dark:border-white/[0.08] bg-slate-50 dark:bg-[#12151E] text-slate-600 dark:text-[#A5AEC4]'
                      }`}
                    >
                      <RotateCw size={13} />
                      <span>Hinge Pivot</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => updateActiveMechanism((m) => ({ ...m, kind: 'slider' }))}
                      className={`py-2 px-3 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 border transition-colors ${
                        activeMechanism.kind === 'slider'
                          ? 'border-[#7C5CFF] bg-[#7C5CFF]/15 text-[#6A48F5] dark:text-[#C4B5FD]'
                          : 'border-slate-200/80 dark:border-white/[0.08] bg-slate-50 dark:bg-[#12151E] text-slate-600 dark:text-[#A5AEC4]'
                      }`}
                    >
                      <ArrowLeftRight size={13} />
                      <span>Linear Slider</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="block text-[11px] font-bold text-slate-500 dark:text-[#949BB0]">
                    {activeMechanism.kind === 'hinge' ? 'Hinge Axis' : 'Slide Direction Axis'}
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        ['x', 'X · Red', '#FF4D6D'],
                        ['y', 'Y · Green', '#22C55E'],
                        ['z', 'Z · Blue', '#38BDF8'],
                      ] as const
                    ).map(([axis, label, color]) => {
                      const active = activeMechanism.axis === axis;
                      return (
                        <button
                          key={axis}
                          type="button"
                          onClick={() =>
                            updateActiveMechanism((m) => ({ ...m, axis: axis as MechanismAxis }))
                          }
                          style={active ? { borderColor: color } : undefined}
                          className={`py-1.5 px-2 rounded-lg text-xs font-bold border transition-colors whitespace-nowrap ${
                            active
                              ? 'bg-slate-900 text-white dark:bg-white/10 dark:text-white'
                              : 'border-slate-200/80 dark:border-white/[0.08] bg-slate-50 dark:bg-[#12151E] text-slate-600 dark:text-[#A5AEC4]'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Hinge Pivot Point & Rotation Range OR Linear Travel Range */}
              {activeMechanism.kind === 'hinge' ? (
                <div className="space-y-3 pt-3 border-t border-slate-200/70 dark:border-white/[0.08]">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-500 dark:text-[#949BB0]">
                        Pivot Seam Point
                      </span>
                      <button
                        type="button"
                        onClick={() => setEditPivotGizmo((v) => !v)}
                        className="text-[11px] font-bold text-[#7C5CFF] hover:underline"
                      >
                        {editPivotGizmo ? 'Hide 3D Gizmo' : 'Drag in 3D'}
                      </button>
                    </div>

                    {/* 1-Click Seam Edge Snapping */}
                    <div className="grid grid-cols-3 gap-1.5">
                      {SNAP_PRESETS.map((snap) => (
                        <button
                          key={snap.id}
                          type="button"
                          onClick={() => handleSnapPivot(snap.id)}
                          className="py-1.5 px-2 rounded-lg text-[11px] font-bold bg-slate-100 dark:bg-[#12151E] hover:bg-[#7C5CFF] hover:text-white text-slate-700 dark:text-[#C8D0E4] transition-colors whitespace-nowrap"
                        >
                          {snap.label}
                        </button>
                      ))}
                    </div>

                    {/* Exact X / Y / Z Pivot Coordinates */}
                    <div className="grid grid-cols-3 gap-1.5 pt-1">
                      {(['X', 'Y', 'Z'] as const).map((axisLabel, idx) => (
                        <label
                          key={axisLabel}
                          className="flex flex-col gap-0.5 text-[10px] font-bold text-slate-500 dark:text-[#8E96AB]"
                        >
                          <span>Pivot {axisLabel}</span>
                          <input
                            type="number"
                            step={0.02}
                            value={activeMechanism.pivot[idx]}
                            onChange={(e) => {
                              const nextPivot: [number, number, number] = [
                                ...activeMechanism.pivot,
                              ] as [number, number, number];
                              nextPivot[idx] = Number(e.target.value) || 0;
                              handleChangePivot(nextPivot);
                            }}
                            className="w-full px-2 py-1 rounded-lg bg-slate-100 dark:bg-[#12151E] border border-slate-200/80 dark:border-white/[0.08] font-mono text-xs tabular-nums text-slate-900 dark:text-white"
                          />
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Rest & Activated Angles */}
                  <div className="space-y-2.5 pt-2 border-t border-slate-200/60 dark:border-white/[0.06]">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span>Resting Angle</span>
                        <span className="font-mono tabular-nums text-slate-600 dark:text-[#A5AEC4]">
                          {activeMechanism.restAngleDeg}°
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-180}
                        max={180}
                        step={1}
                        value={activeMechanism.restAngleDeg}
                        onChange={(e) =>
                          updateActiveMechanism((m) => ({
                            ...m,
                            restAngleDeg: Number(e.target.value),
                          }))
                        }
                        className="w-full accent-[#7C5CFF]"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span>Activated Angle</span>
                        <span className="font-mono tabular-nums text-[#F59E0B] font-bold">
                          {activeMechanism.openAngleDeg}°
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-180}
                        max={180}
                        step={1}
                        value={activeMechanism.openAngleDeg}
                        onChange={(e) => {
                          setTestTargetOpen(null);
                          setPreviewProgress(1);
                          updateActiveMechanism((m) => ({
                            ...m,
                            openAngleDeg: Number(e.target.value),
                          }));
                        }}
                        className="w-full accent-[#F59E0B]"
                      />
                      <div className="flex items-center gap-1.5 pt-0.5">
                        {[-110, -90, 90, 110].map((deg) => (
                          <button
                            key={deg}
                            type="button"
                            onClick={() => {
                              setTestTargetOpen(null);
                              setPreviewProgress(1);
                              updateActiveMechanism((m) => ({ ...m, openAngleDeg: deg }));
                            }}
                            className="flex-1 py-1 rounded-md bg-slate-100 dark:bg-[#1F2430] hover:bg-[#F59E0B] hover:text-slate-950 text-[10px] font-mono font-bold tabular-nums transition-colors"
                          >
                            {deg > 0 ? `+${deg}°` : `${deg}°`}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5 pt-3 border-t border-slate-200/70 dark:border-white/[0.08]">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span>Resting Offset</span>
                      <span className="font-mono tabular-nums text-slate-600 dark:text-[#A5AEC4]">
                        {activeMechanism.restOffset.toFixed(2)}m
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-3}
                      max={3}
                      step={0.05}
                      value={activeMechanism.restOffset}
                      onChange={(e) =>
                        updateActiveMechanism((m) => ({
                          ...m,
                          restOffset: Number(e.target.value),
                        }))
                      }
                      className="w-full accent-[#7C5CFF]"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span>Activated Slide Distance</span>
                      <span className="font-mono tabular-nums text-[#F59E0B] font-bold">
                        {activeMechanism.openOffset >= 0 ? '+' : ''}
                        {activeMechanism.openOffset.toFixed(2)}m
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-4}
                      max={4}
                      step={0.05}
                      value={activeMechanism.openOffset}
                      onChange={(e) => {
                        setTestTargetOpen(null);
                        setPreviewProgress(1);
                        updateActiveMechanism((m) => ({
                          ...m,
                          openOffset: Number(e.target.value),
                        }));
                      }}
                      className="w-full accent-[#F59E0B]"
                    />
                    <div className="flex items-center gap-1.5 pt-0.5">
                      {[-1.5, -0.8, 0.8, 1.5].map((dist) => (
                        <button
                          key={dist}
                          type="button"
                          onClick={() => {
                            setTestTargetOpen(null);
                            setPreviewProgress(1);
                            updateActiveMechanism((m) => ({ ...m, openOffset: dist }));
                          }}
                          className="flex-1 py-1 rounded-md bg-slate-100 dark:bg-[#1F2430] hover:bg-[#F59E0B] hover:text-slate-950 text-[10px] font-mono font-bold tabular-nums transition-colors"
                        >
                          {dist > 0 ? `+${dist}m` : `${dist}m`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Timing, Easing & Playback Mode */}
              <div className="space-y-3 pt-3 border-t border-slate-200/70 dark:border-white/[0.08]">
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span>Motion Duration</span>
                    <span className="font-mono tabular-nums text-slate-600 dark:text-[#A5AEC4]">
                      {activeMechanism.duration.toFixed(2)}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.15}
                    max={4.0}
                    step={0.05}
                    value={activeMechanism.duration}
                    onChange={(e) =>
                      updateActiveMechanism((m) => ({ ...m, duration: Number(e.target.value) }))
                    }
                    className="w-full accent-[#7C5CFF]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[11px] font-bold text-slate-500 dark:text-[#949BB0]">
                    Motion Easing
                  </label>
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-[#12151E] border border-slate-200/80 dark:border-white/[0.08]">
                    <EasingCurveIcon easing={activeMechanism.easing} />
                    <select
                      value={activeMechanism.easing}
                      onChange={(e) =>
                        updateActiveMechanism((m) => ({
                          ...m,
                          easing: e.target.value as MotionEasing,
                        }))
                      }
                      className="flex-1 bg-transparent text-xs font-bold focus:outline-none cursor-pointer"
                    >
                      {EASING_OPTIONS.map((opt) => (
                        <option
                          key={opt.value}
                          value={opt.value}
                          className="bg-white dark:bg-[#171A23]"
                        >
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="block text-[11px] font-bold text-slate-500 dark:text-[#949BB0]">
                    Activation Behavior
                  </span>
                  <div className="grid grid-cols-3 gap-1">
                    {(
                      [
                        ['toggle', 'Toggle'],
                        ['once', 'Open Once'],
                        ['autoReturn', 'Auto-Close'],
                      ] as const
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() =>
                          updateActiveMechanism((m) => ({
                            ...m,
                            playbackMode: mode as MechanismPlaybackMode,
                          }))
                        }
                        className={`py-1.5 px-2 rounded-lg text-[11px] font-bold whitespace-nowrap transition-colors ${
                          activeMechanism.playbackMode === mode
                            ? 'bg-[#7C5CFF] text-white'
                            : 'bg-slate-100 dark:bg-[#12151E] text-slate-600 dark:text-[#A5AEC4]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {activeMechanism.playbackMode === 'autoReturn' && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span>Hold Open Before Closing</span>
                      <span className="font-mono tabular-nums text-slate-600 dark:text-[#A5AEC4]">
                        {(activeMechanism.autoReturnDelay ?? 2.2).toFixed(1)}s
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={10}
                      step={0.1}
                      value={activeMechanism.autoReturnDelay ?? 2.2}
                      onChange={(e) =>
                        updateActiveMechanism((m) => ({
                          ...m,
                          autoReturnDelay: Number(e.target.value),
                        }))
                      }
                      className="w-full accent-[#7C5CFF]"
                    />
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* TAB 2: CONDITIONAL GAME TRIGGERS (WHEN / IF / THEN) */
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-700 dark:text-[#D5DCF0]">
                  Conditional Triggers
                </span>
                <button
                  type="button"
                  onClick={() =>
                    updateActiveMechanism((m) => ({
                      ...m,
                      triggers: [...m.triggers, createDefaultTriggerRule()],
                    }))
                  }
                  className="px-2.5 py-1 rounded-lg bg-[#7C5CFF] hover:bg-[#6A48F5] text-white text-[11px] font-bold inline-flex items-center gap-1 whitespace-nowrap"
                >
                  <Plus size={12} />
                  <span>Add Trigger</span>
                </button>
              </div>

              {activeMechanism.triggers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 dark:border-white/[0.12] p-4 text-center space-y-2">
                  <div className="text-xs font-bold">No Triggers Configured</div>
                  <p className="text-[11px] text-slate-500 dark:text-[#8E96AB] leading-relaxed">
                    Add a conditional rule so pressing Use, walking close, holding a key/item, or
                    pulling another lever activates this mechanism in Play mode.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {activeMechanism.triggers.map((rule, idx) => {
                    const patchRule = (patch: Partial<MechanismTriggerRule>) => {
                      updateActiveMechanism((m) => ({
                        ...m,
                        triggers: m.triggers.map((t) =>
                          t.id === rule.id ? { ...t, ...patch } : t
                        ),
                      }));
                    };

                    return (
                      <div
                        key={rule.id}
                        className={`p-3 rounded-xl bg-slate-50 dark:bg-[#12151E] border space-y-3 transition-colors ${
                          highlightedTriggerId === rule.id
                            ? 'border-[#06B6D4] ring-1 ring-[#06B6D4]/60'
                            : 'border-slate-200/80 dark:border-white/[0.08]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-0.5 min-w-0">
                            <div className="text-[11px] font-extrabold text-[#7C5CFF]">
                              Rule {idx + 1}
                            </div>
                            <p className="text-[11px] text-slate-600 dark:text-[#B8C0D6] leading-snug">
                              {summarizeTriggerRule(rule, activeMechanism.name, itemNameMap)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              updateActiveMechanism((m) => ({
                                ...m,
                                triggers: m.triggers.filter((t) => t.id !== rule.id),
                              }))
                            }
                            aria-label="Delete trigger rule"
                            className="p-1 rounded-md text-slate-400 hover:text-[#F2545B] hover:bg-[#F2545B]/15 shrink-0"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>

                        {/* WHEN */}
                        <div className="space-y-1.5 pt-2 border-t border-slate-200/70 dark:border-white/[0.06]">
                          <label className="block text-[11px] font-bold text-slate-500 dark:text-[#949BB0]">
                            When
                          </label>
                          <select
                            value={rule.event}
                            onChange={(e) =>
                              patchRule({ event: e.target.value as MechanismTriggerEvent })
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#1B202E] border border-slate-200/80 dark:border-white/[0.08] text-xs font-semibold"
                          >
                            {(Object.keys(TRIGGER_EVENT_LABELS) as MechanismTriggerEvent[]).map(
                              (ev) => (
                                <option key={ev} value={ev}>
                                  {TRIGGER_EVENT_LABELS[ev]}
                                </option>
                              )
                            )}
                          </select>

                          {(rule.event === 'playerUses' ||
                            rule.event === 'playerNear' ||
                            rule.event === 'playerTouches') && (
                            <div className="flex items-center gap-2 pt-0.5">
                              <span className="text-[11px] font-semibold text-slate-500 dark:text-[#949BB0] whitespace-nowrap">
                                Reach
                              </span>
                              <input
                                type="range"
                                min={1.0}
                                max={6.0}
                                step={0.1}
                                value={rule.radius}
                                onChange={(e) => patchRule({ radius: Number(e.target.value) })}
                                className="flex-1 accent-[#7C5CFF]"
                              />
                              <span className="text-[11px] font-mono tabular-nums text-slate-600 dark:text-[#C8D0E4] w-10 text-right">
                                {rule.radius.toFixed(1)}m
                              </span>
                            </div>
                          )}

                          {rule.event === 'flagSet' && (
                            <input
                              type="text"
                              value={rule.eventFlag ?? ''}
                              onChange={(e) => patchRule({ eventFlag: e.target.value })}
                              placeholder="Flag name (e.g. lever_pulled)"
                              className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#1B202E] border border-slate-200/80 dark:border-white/[0.08] text-xs font-mono"
                            />
                          )}
                        </div>

                        {/* IF (CONDITION) */}
                        <div className="space-y-1.5 pt-2 border-t border-slate-200/70 dark:border-white/[0.06]">
                          <label className="block text-[11px] font-bold text-slate-500 dark:text-[#949BB0]">
                            If Condition
                          </label>
                          <select
                            value={rule.condition}
                            onChange={(e) =>
                              patchRule({ condition: e.target.value as MechanismConditionKind })
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#1B202E] border border-slate-200/80 dark:border-white/[0.08] text-xs font-semibold"
                          >
                            {(Object.keys(CONDITION_LABELS) as MechanismConditionKind[]).map(
                              (cond) => (
                                <option key={cond} value={cond}>
                                  {CONDITION_LABELS[cond]}
                                </option>
                              )
                            )}
                          </select>

                          {rule.condition === 'hasItem' && (
                            <select
                              value={rule.conditionValue ?? ''}
                              onChange={(e) => patchRule({ conditionValue: e.target.value })}
                              className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#1B202E] border border-slate-200/80 dark:border-white/[0.08] text-xs font-semibold"
                            >
                              <option value="">Choose required item…</option>
                              {itemCatalog.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ))}
                            </select>
                          )}

                          {rule.condition === 'flagSet' && (
                            <input
                              type="text"
                              value={rule.conditionValue ?? ''}
                              onChange={(e) => patchRule({ conditionValue: e.target.value })}
                              placeholder="Required flag (e.g. lever_pulled)"
                              className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#1B202E] border border-slate-200/80 dark:border-white/[0.08] text-xs font-mono"
                            />
                          )}

                          {(rule.condition === 'hasKey' || rule.condition === 'hasItem') && (
                            <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-600 dark:text-[#B8C0D6] cursor-pointer">
                              <input
                                type="checkbox"
                                checked={Boolean(rule.consumeRequired)}
                                onChange={(e) => patchRule({ consumeRequired: e.target.checked })}
                                className="accent-[#7C5CFF]"
                              />
                              <span>Consume key / item on activation</span>
                            </label>
                          )}

                          {rule.condition !== 'none' && (
                            <input
                              type="text"
                              value={rule.lockedMessage ?? ''}
                              onChange={(e) => patchRule({ lockedMessage: e.target.value })}
                              placeholder="Message when locked (optional)"
                              className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#1B202E] border border-slate-200/80 dark:border-white/[0.08] text-xs"
                            />
                          )}
                        </div>

                        {/* THEN (ACTION & SIDE EFFECTS) */}
                        <div className="space-y-2 pt-2 border-t border-slate-200/70 dark:border-white/[0.06]">
                          <label className="block text-[11px] font-bold text-slate-500 dark:text-[#949BB0]">
                            Then
                          </label>
                          <select
                            value={rule.action}
                            onChange={(e) =>
                              patchRule({ action: e.target.value as MechanismActionMode })
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#1B202E] border border-slate-200/80 dark:border-white/[0.08] text-xs font-bold"
                          >
                            {(Object.keys(ACTION_LABELS) as MechanismActionMode[]).map((act) => (
                              <option key={act} value={act}>
                                {ACTION_LABELS[act]}
                              </option>
                            ))}
                          </select>

                          <div className="grid grid-cols-2 gap-1.5">
                            <label className="space-y-0.5 text-[10px] font-bold text-slate-500 dark:text-[#8E96AB]">
                              <span>Set Flag on Open</span>
                              <input
                                type="text"
                                value={rule.setFlagOnOpen ?? ''}
                                onChange={(e) => patchRule({ setFlagOnOpen: e.target.value })}
                                placeholder="e.g. lever_pulled"
                                className="w-full px-2 py-1 rounded-lg bg-white dark:bg-[#1B202E] border border-slate-200/80 dark:border-white/[0.08] text-xs font-mono text-slate-900 dark:text-white"
                              />
                            </label>
                            <label className="space-y-0.5 text-[10px] font-bold text-slate-500 dark:text-[#8E96AB]">
                              <span>Sound Cue</span>
                              <select
                                value={rule.sound ?? 'door'}
                                onChange={(e) =>
                                  patchRule({
                                    sound: e.target.value as MechanismTriggerRule['sound'],
                                  })
                                }
                                className="w-full px-2 py-1 rounded-lg bg-white dark:bg-[#1B202E] border border-slate-200/80 dark:border-white/[0.08] text-xs font-semibold text-slate-900 dark:text-white"
                              >
                                <option value="door">Door / Stone</option>
                                <option value="sparkle">Switch / Sparkle</option>
                                <option value="coin">Treasure Coin</option>
                                <option value="chime">Chime</option>
                                <option value="none">Silent</option>
                              </select>
                            </label>
                          </div>

                          <div className="grid grid-cols-2 gap-1.5">
                            <label className="space-y-0.5 text-[10px] font-bold text-slate-500 dark:text-[#8E96AB]">
                              <span>Reward Coins</span>
                              <input
                                type="number"
                                min={0}
                                max={999}
                                value={rule.rewardCoins ?? 0}
                                onChange={(e) =>
                                  patchRule({ rewardCoins: Math.max(0, Number(e.target.value) || 0) })
                                }
                                className="w-full px-2 py-1 rounded-lg bg-white dark:bg-[#1B202E] border border-slate-200/80 dark:border-white/[0.08] font-mono text-xs tabular-nums text-slate-900 dark:text-white"
                              />
                            </label>
                            <label className="space-y-0.5 text-[10px] font-bold text-slate-500 dark:text-[#8E96AB]">
                              <span>Reward Item</span>
                              <select
                                value={rule.rewardItemId ?? ''}
                                onChange={(e) =>
                                  patchRule({ rewardItemId: e.target.value || undefined })
                                }
                                className="w-full px-2 py-1 rounded-lg bg-white dark:bg-[#1B202E] border border-slate-200/80 dark:border-white/[0.08] text-xs font-semibold text-slate-900 dark:text-white"
                              >
                                <option value="">None</option>
                                {itemCatalog.map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>

                          <input
                            type="text"
                            value={rule.message ?? ''}
                            onChange={(e) => patchRule({ message: e.target.value })}
                            placeholder="On-screen message when activated (optional)"
                            className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#1B202E] border border-slate-200/80 dark:border-white/[0.08] text-xs"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
