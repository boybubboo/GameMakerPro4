import React, { useMemo, useState } from 'react';
import {
  Box,
  ChevronLeft,
  Edit3,
  FolderUp,
  Leaf,
  Plus,
  Search,
  Shapes,
  Sparkles,
  User,
  Wrench,
} from 'lucide-react';
import type { MakerStore } from '../../store/useMakerStore';
import type { AssetCategory, CustomAssetMeta } from '../../types/maker';
import { AssetThumbnail } from '../shared/AssetThumbnail';

export const MAKER_ASSET_DRAG_MIME = 'application/x-maker-asset-id';

export type AssetsPanelCategoryTab = 'objects' | 'characters' | 'plants' | 'all';

export interface LeftAssetsPanelProps {
  store: MakerStore;
  activePlacementAssetId: string | null;
  onSelectPlacementAsset: (asset: CustomAssetMeta) => void;
  onEditAssetInObjectMaker: (assetId: string) => void;
  onCreateNewObject: () => void;
  onSwitchToLevelPanel: () => void;
  onCollapseLeftPanel: () => void;
}

const CATEGORY_TABS: {
  id: AssetsPanelCategoryTab;
  label: string;
  Icon: React.FC<{ size?: number; className?: string }>;
}[] = [
  { id: 'objects', label: 'Objects', Icon: Box },
  { id: 'characters', label: 'Chars', Icon: User },
  { id: 'plants', label: 'Plants', Icon: Leaf },
  { id: 'all', label: 'All', Icon: Sparkles },
];

function matchesTab(category: AssetCategory, tab: AssetsPanelCategoryTab): boolean {
  if (tab === 'all') return true;
  if (tab === 'objects') return category === 'prop' || category === 'scenery';
  if (tab === 'characters') return category === 'character';
  return category === 'plant';
}

export const LeftAssetsPanel: React.FC<LeftAssetsPanelProps> = ({
  store,
  activePlacementAssetId,
  onSelectPlacementAsset,
  onEditAssetInObjectMaker,
  onCreateNewObject,
  onSwitchToLevelPanel,
  onCollapseLeftPanel,
}) => {
  const [tab, setTab] = useState<AssetsPanelCategoryTab>('objects');
  const [search, setSearch] = useState('');

  const filteredAssets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return store.customAssets.filter((a) => {
      if (!matchesTab(a.category, tab)) return false;
      if (!q) return true;
      return a.name.toLowerCase().includes(q) || a.category.toLowerCase().includes(q);
    });
  }, [store.customAssets, tab, search]);

  const counts = useMemo(() => {
    let objects = 0;
    let characters = 0;
    let plants = 0;
    for (const a of store.customAssets) {
      if (a.category === 'character') characters++;
      else if (a.category === 'plant') plants++;
      else objects++;
    }
    return { objects, characters, plants, all: store.customAssets.length };
  }, [store.customAssets]);

  return (
    <aside className="w-[252px] xl:w-[272px] shrink-0 rounded-2xl bg-white dark:bg-[#171A23] border border-slate-200/80 dark:border-white/[0.08] flex flex-col min-h-0 overflow-hidden shadow-xs">
      {/* Top Panel Mode Switcher: Level | Assets | Hide */}
      <div className="shrink-0 p-2 border-b border-slate-200/80 dark:border-white/[0.08] flex items-center gap-1.5 bg-slate-50/80 dark:bg-[#131720]">
        <div className="flex-1 grid grid-cols-2 gap-1 p-0.5 rounded-xl bg-slate-200/70 dark:bg-[#1C212E]">
          <button
            type="button"
            onClick={onSwitchToLevelPanel}
            className="py-1 px-2 rounded-lg text-[11px] font-bold text-slate-600 dark:text-[#9FA8BE] hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            Level
          </button>
          <button
            type="button"
            className="py-1 px-2 rounded-lg text-[11px] font-extrabold bg-white dark:bg-[#272E3F] text-[#7C5CFF] dark:text-white shadow-xs"
          >
            Assets ({store.customAssets.length})
          </button>
        </div>
        <button
          type="button"
          onClick={onCollapseLeftPanel}
          title="Hide left panel to expand viewport"
          aria-label="Hide left panel"
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-[#949BB0] dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-[#1F2430]"
        >
          <ChevronLeft size={15} />
        </button>
      </div>

      {/* Category Tabs */}
      <div className="shrink-0 px-2 pt-2 pb-1.5 border-b border-slate-200/70 dark:border-white/[0.06] space-y-2">
        <div className="grid grid-cols-4 gap-1">
          {CATEGORY_TABS.map(({ id, label, Icon }) => {
            const active = tab === id;
            const c = counts[id];
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`flex flex-col items-center justify-center gap-0.5 py-1.5 px-1 rounded-xl text-[10px] font-bold transition-colors ${
                  active
                    ? 'bg-[#7C5CFF] text-white shadow-xs'
                    : 'bg-slate-100 dark:bg-[#12151E] text-slate-600 dark:text-[#A5AEC4] hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Icon size={12} />
                <span>
                  {label}
                  {c > 0 ? ` (${c})` : ''}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search + New Object Studio CTA */}
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1 min-w-0">
            <Search
              size={12}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search assets…"
              className="w-full pl-7 pr-2 py-1.5 rounded-xl bg-slate-100 dark:bg-[#12151E] border border-slate-200/80 dark:border-white/[0.08] text-[11px] font-semibold focus:outline-none focus:border-[#7C5CFF]"
            />
          </div>
          <button
            type="button"
            onClick={onCreateNewObject}
            title="Open Object Maker"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#7C5CFF] hover:bg-[#6A48F5] text-white text-[11px] font-extrabold shrink-0"
          >
            <Plus size={12} />
            <span>New</span>
          </button>
        </div>
      </div>

      {/* Asset Grid (Draggable to 3D World Viewport) */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5 maker-scroll">
        {filteredAssets.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 dark:border-white/[0.12] p-4 text-center space-y-2.5 my-2">
            <div className="mx-auto w-9 h-9 rounded-xl bg-[#7C5CFF]/15 text-[#7C5CFF] flex items-center justify-center">
              <Shapes size={17} />
            </div>
            <div className="text-xs font-extrabold">
              {tab === 'plants'
                ? 'No Custom Plants Yet'
                : tab === 'characters'
                ? 'No Custom Characters Yet'
                : 'No Custom Objects Yet'}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-[#8E96AB] leading-snug">
              {tab === 'objects' || tab === 'all'
                ? 'Design custom props, crates, arches, or hinged chests in Object Maker, then drag them onto the world.'
                : `Saved ${tab} from the studios or Asset Vault appear here ready to drag into your level.`}
            </p>
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={onCreateNewObject}
                className="w-full py-1.5 px-3 rounded-xl bg-[#7C5CFF] text-white text-[11px] font-extrabold inline-flex items-center justify-center gap-1"
              >
                <Shapes size={12} />
                <span>Open Object Maker</span>
              </button>
              <button
                type="button"
                onClick={() => store.setShowingAssetVault(true)}
                className="w-full py-1.5 px-3 rounded-xl bg-slate-100 dark:bg-[#1F2430] text-slate-700 dark:text-[#D5DCF0] text-[11px] font-bold inline-flex items-center justify-center gap-1"
              >
                <FolderUp size={12} />
                <span>Import GLB</span>
              </button>
            </div>
          </div>
        ) : (
          filteredAssets.map((asset) => {
            const armed = activePlacementAssetId === asset.id;
            const mechCount = asset.mechanisms?.length ?? 0;
            return (
              <div
                key={asset.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(MAKER_ASSET_DRAG_MIME, asset.id);
                  e.dataTransfer.setData('text/plain', asset.name);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => onSelectPlacementAsset(asset)}
                title="Drag onto the 3D world to drop, or click to select for placement"
                className={`group flex items-center gap-2 p-1.5 rounded-xl border cursor-grab active:cursor-grabbing transition-all ${
                  armed
                    ? 'border-[#7C5CFF] bg-[#7C5CFF]/12 ring-1 ring-[#7C5CFF]/35'
                    : 'border-slate-200/80 dark:border-white/[0.08] bg-slate-50/70 dark:bg-[#12151E] hover:border-[#7C5CFF]/60'
                }`}
              >
                <AssetThumbnail customAsset={asset} size={42} rounded="rounded-lg" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-extrabold truncate text-slate-900 dark:text-white">
                    {asset.name}
                  </div>
                  <div className="text-[10px] font-semibold text-slate-500 dark:text-[#949BB0] flex items-center gap-1.5 truncate">
                    <span className="capitalize">{asset.category}</span>
                    {asset.objectRecipe && (
                      <span>· {asset.objectRecipe.parts.length}p</span>
                    )}
                    {mechCount > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[#F59E0B] font-bold">
                        · <Wrench size={9} /> {mechCount}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditAssetInObjectMaker(asset.id);
                  }}
                  title="Edit in Object Maker"
                  className="p-1.5 rounded-lg bg-white dark:bg-[#1C212E] border border-slate-200/80 dark:border-white/[0.08] text-slate-500 hover:text-[#7C5CFF] hover:border-[#7C5CFF] shrink-0"
                >
                  <Edit3 size={12} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Tip */}
      <div className="shrink-0 px-2.5 py-2 border-t border-slate-200/80 dark:border-white/[0.08] bg-slate-50/70 dark:bg-[#131720] flex items-center justify-between gap-2 text-[10px] font-semibold text-slate-500 dark:text-[#8E96AB]">
        <span>Drag asset into 3D viewport</span>
        <button
          type="button"
          onClick={() => store.setShowingAssetVault(true)}
          className="text-[#7C5CFF] hover:underline font-bold"
        >
          Vault
        </button>
      </div>
    </aside>
  );
};
