import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {
  getCachedAssetSync,
  loadCustomAssetToCache,
} from '../../three/gltfAssetManager';
import {
  createMakerRenderer,
  detectSoftwareGl,
  disposeObject3D,
  setupSceneEnvironment,
} from '../../three/islandScene';
import {
  createBuiltinMechanismModel,
  findBestPartPathForObject,
  inspectObjectHierarchy,
  MechanismRuntimeController,
  resolveTargetNode,
  type ObjectPartNode,
} from '../../three/mechanismController';
import type {
  BuiltinMechanismTemplate,
  CustomAssetMeta,
  LevelEntity,
  MechanismAxis,
  MechanismTriggerEvent,
  ObjectMechanism,
} from '../../types/maker';

export type MechanismCameraPreset = 'threeQuarter' | 'front' | 'side' | 'top';

export interface WireframeLogicSummary {
  triggerCount: number;
  linkCount: number;
  crossObjectLinks: number;
  flagsBroadcast: string[];
  flagsListened: string[];
}

export interface MechanismPreviewStageProps {
  sourceKind: 'builtin' | 'custom';
  builtinTemplate: BuiltinMechanismTemplate;
  customAsset: CustomAssetMeta | null;
  mechanisms: ObjectMechanism[];
  activeMechanismId: string | null;
  selectedPartPath: string | null;
  previewProgress: number;
  testTargetOpen: boolean | null;
  testTriggerNonce: number;
  editPivotGizmo: boolean;
  xrayOthers: boolean;
  wireframeMode: boolean;
  levelEntities?: LevelEntity[];
  cameraPreset: MechanismCameraPreset;
  cameraResetNonce: number;
  onPartsLoaded: (parts: ObjectPartNode[]) => void;
  onSelectPart: (partPath: string) => void;
  onSelectMechanismTrigger?: (mechId: string, triggerId?: string) => void;
  onChangePivot: (pivot: [number, number, number]) => void;
  onProgressTick: (progress: number) => void;
  onWireframeSummary?: (summary: WireframeLogicSummary) => void;
}

interface LogicLabelMeta {
  id: string;
  badge: string;
  title: string;
  subtitle?: string;
  color: string;
  worldPos: THREE.Vector3;
  mechId?: string;
  triggerId?: string;
  isActive?: boolean;
}

interface SignalPulseItem {
  curve: THREE.QuadraticBezierCurve3;
  mesh: THREE.Mesh;
  halo: THREE.Mesh;
  phase: number;
  speed: number;
}

const AXIS_COLOR: Record<MechanismAxis, string> = {
  x: '#FF4D6D',
  y: '#22C55E',
  z: '#38BDF8',
};

const TRIGGER_COLOR: Record<MechanismTriggerEvent, string> = {
  playerUses: '#A78BFA',
  playerNear: '#38BDF8',
  playerTouches: '#06B6D4',
  flagSet: '#34D399',
  levelStarts: '#FBBF24',
};

const TRIGGER_SHORT_LABEL: Record<MechanismTriggerEvent, string> = {
  playerUses: 'Interact (E)',
  playerNear: 'Player Near',
  playerTouches: 'On Touch',
  flagSet: 'On Flag',
  levelStarts: 'Level Start',
};

const CONDITION_SHORT_LABEL: Record<string, string> = {
  hasKey: 'IF Key',
  hasItem: 'IF Item',
  flagSet: 'IF Flag',
  baddiesGone: 'IF Baddies Gone',
};

const _raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _tmpBox = new THREE.Box3();
const _tmpCenter = new THREE.Vector3();
const _tmpSize = new THREE.Vector3();
const _tmpWorldPivot = new THREE.Vector3();
const _tmpLocalPivot = new THREE.Vector3();
const _projVec = new THREE.Vector3();
const _pulsePos = new THREE.Vector3();

interface StageInternalRefs {
  renderer: WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  transformControls: TransformControls;
  pivotTarget: THREE.Object3D;
  gizmoDragging: boolean;
  lastGizmoDragEndMs: number;
  modelHolder: THREE.Group;
  modelRoot: THREE.Group | null;
  controller: MechanismRuntimeController | null;
  guideGroup: THREE.Group;
  logicGraphGroup: THREE.Group;
  logicPulses: SignalPulseItem[];
  logicLabels: LogicLabelMeta[];
  pedestalMat: THREE.MeshStandardMaterial;
  camGoalPos: THREE.Vector3 | null;
  camGoalTarget: THREE.Vector3 | null;
  animatingTest: boolean;
  originalMats: Map<
    THREE.Mesh,
    {
      emissive: number[];
      opacity: number[];
      transparent: boolean[];
      depthWrite: boolean[];
      wireframe: boolean[];
    }
  >;
}

function disposeGroupChildren(group: THREE.Group) {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    disposeObject3D(child);
  }
}

function addGlowingCurve(
  parent: THREE.Group,
  pulses: SignalPulseItem[],
  start: THREE.Vector3,
  end: THREE.Vector3,
  liftY: number,
  colorHex: string,
  emphasized: boolean,
  speed = 0.42
): THREE.QuadraticBezierCurve3 {
  const mid = start.clone().add(end).multiplyScalar(0.5);
  mid.y = Math.max(start.y, end.y) + liftY;
  const curve = new THREE.QuadraticBezierCurve3(start.clone(), mid, end.clone());
  const color = new THREE.Color(colorHex);

  // Inner bright core conduit
  const coreTube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 32, emphasized ? 0.017 : 0.011, 8, false),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: emphasized ? 0.96 : 0.68,
      depthTest: false,
      depthWrite: false,
    })
  );
  coreTube.renderOrder = 986;
  parent.add(coreTube);

  // Outer additive glow sheath
  const glowTube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 32, emphasized ? 0.048 : 0.032, 8, false),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: emphasized ? 0.34 : 0.18,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    })
  );
  glowTube.renderOrder = 985;
  parent.add(glowTube);

  // 2 traveling glowing signal pulses along each curve
  const pulseCount = emphasized ? 2 : 1;
  for (let i = 0; i < pulseCount; i++) {
    const pulseMesh = new THREE.Mesh(
      new THREE.SphereGeometry(emphasized ? 0.038 : 0.026, 12, 10),
      new THREE.MeshBasicMaterial({
        color: '#FFFFFF',
        transparent: true,
        opacity: 0.98,
        depthTest: false,
        depthWrite: false,
      })
    );
    pulseMesh.renderOrder = 990;

    const haloMesh = new THREE.Mesh(
      new THREE.SphereGeometry(emphasized ? 0.088 : 0.062, 12, 10),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.52,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      })
    );
    haloMesh.renderOrder = 989;

    parent.add(pulseMesh, haloMesh);
    pulses.push({
      curve,
      mesh: pulseMesh,
      halo: haloMesh,
      phase: i * 0.5,
      speed,
    });
  }

  return curve;
}

function addBeaconNode(
  parent: THREE.Group,
  pos: THREE.Vector3,
  colorHex: string,
  shape: 'octahedron' | 'sphere' | 'cube',
  radius: number,
  emphasized: boolean
) {
  const color = new THREE.Color(colorHex);
  const geo =
    shape === 'octahedron'
      ? new THREE.OctahedronGeometry(radius, 0)
      : shape === 'cube'
      ? new THREE.BoxGeometry(radius * 1.5, radius * 1.5, radius * 1.5)
      : new THREE.SphereGeometry(radius, 16, 12);

  const core = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: emphasized ? 0.98 : 0.78,
      depthTest: false,
    })
  );
  core.position.copy(pos);
  core.renderOrder = 992;
  parent.add(core);

  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 2.05, 14, 12),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: emphasized ? 0.34 : 0.18,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    })
  );
  halo.position.copy(pos);
  halo.renderOrder = 991;
  parent.add(halo);

  // Subtle vertical drop-line to the turntable floor for spatial grounding
  if (pos.y > 0.08) {
    const dropPts = [new THREE.Vector3(pos.x, 0.01, pos.z), pos.clone()];
    const dropLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(dropPts),
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
      })
    );
    parent.add(dropLine);
  }
}

function buildLogicGraph(
  logicGroup: THREE.Group,
  modelRoot: THREE.Group | null,
  mechanisms: ObjectMechanism[],
  activeMechanismId: string | null,
  parts: ObjectPartNode[],
  levelEntities: LevelEntity[],
  wireframeMode: boolean
): {
  pulses: SignalPulseItem[];
  labels: LogicLabelMeta[];
  summary: WireframeLogicSummary;
} {
  disposeGroupChildren(logicGroup);
  const pulses: SignalPulseItem[] = [];
  const labels: LogicLabelMeta[] = [];
  const flagsBroadcastSet = new Set<string>();
  const flagsListenedSet = new Set<string>();
  let triggerCount = 0;
  let linkCount = 0;
  let crossObjectLinks = 0;

  if (!wireframeMode || !modelRoot) {
    return {
      pulses,
      labels,
      summary: {
        triggerCount: 0,
        linkCount: 0,
        crossObjectLinks: 0,
        flagsBroadcast: [],
        flagsListened: [],
      },
    };
  }

  modelRoot.updateMatrixWorld(true);
  _tmpBox.setFromObject(modelRoot);
  if (_tmpBox.isEmpty()) {
    _tmpCenter.set(0, 0.85, 0);
    _tmpSize.set(1.4, 1.4, 1.4);
  } else {
    _tmpBox.getCenter(_tmpCenter);
    _tmpBox.getSize(_tmpSize);
  }
  const maxDim = Math.max(_tmpSize.x, _tmpSize.y, _tmpSize.z, 1.25);
  const orbitRadius = Math.max(1.35, maxDim * 0.96 + 0.55);

  // Gather flat list of all triggers to distribute beacons evenly without clutter
  const allTriggerEntries: {
    mech: ObjectMechanism;
    rule: ObjectMechanism['triggers'][number];
    ruleIdx: number;
  }[] = [];
  for (const mech of mechanisms) {
    mech.triggers.forEach((rule, idx) => {
      allTriggerEntries.push({ mech, rule, ruleIdx: idx });
    });
  }
  triggerCount = allTriggerEntries.length;

  // Resolve world-space target centroid for each mechanism
  const targetWorldMap = new Map<string, THREE.Vector3>();
  for (const mech of mechanisms) {
    const part = parts.find((p) => p.path === mech.targetNodePath);
    const pt = part ? new THREE.Vector3(...part.center) : new THREE.Vector3(0, 0.85, 0);
    pt.applyMatrix4(modelRoot.matrixWorld);
    targetWorldMap.set(mech.id, pt);

    const isAct = mech.id === activeMechanismId;
    addBeaconNode(logicGroup, pt, isAct ? '#F59E0B' : '#38BDF8', 'sphere', isAct ? 0.075 : 0.056, isAct);

    labels.push({
      id: `target_${mech.id}`,
      badge: mech.kind === 'hinge' ? 'HINGE' : 'SLIDER',
      title: mech.targetLabel || mech.name,
      subtitle:
        mech.kind === 'hinge'
          ? `${mech.axis.toUpperCase()} ${mech.restAngleDeg}° → ${mech.openAngleDeg}°`
          : `${mech.axis.toUpperCase()} ${mech.openOffset >= 0 ? '+' : ''}${mech.openOffset.toFixed(2)}m`,
      color: isAct ? '#F59E0B' : '#38BDF8',
      worldPos: pt.clone().add(new THREE.Vector3(0, 0.24, 0)),
      mechId: mech.id,
      isActive: isAct,
    });
  }

  // Track outbound flag nodes so shared flags consolidate cleanly
  const outboundFlags: {
    flag: string;
    sourcePos: THREE.Vector3;
    mechId: string;
    triggerId: string;
    isAct: boolean;
  }[] = [];

  // Build Trigger -> (Condition Gate) -> Target Child Element glowing arcs
  const totalIn = Math.max(1, allTriggerEntries.length);
  allTriggerEntries.forEach(({ mech, rule, ruleIdx }, i) => {
    const targetPos = targetWorldMap.get(mech.id) ?? _tmpCenter.clone();
    const isAct = mech.id === activeMechanismId;
    const color = TRIGGER_COLOR[rule.event] ?? '#A78BFA';

    // Fan trigger nodes gracefully on the left/front arc (-145 deg to -35 deg)
    const tFrac = totalIn === 1 ? 0.5 : i / (totalIn - 1);
    const angle = THREE.MathUtils.lerp(-Math.PI * 0.82, -Math.PI * 0.2, tFrac);
    const beaconPos = new THREE.Vector3(
      _tmpCenter.x + Math.cos(angle) * orbitRadius,
      Math.max(0.52, _tmpCenter.y + 0.18 + (i % 2 === 0 ? 0.22 : -0.14)),
      _tmpCenter.z + Math.sin(angle) * orbitRadius * 0.72 + 0.35
    );

    addBeaconNode(logicGroup, beaconPos, color, 'octahedron', isAct ? 0.088 : 0.068, isAct);

    // Check if an incoming flag matches any placed entity in the current level
    let inboundSubtitle =
      rule.event === 'flagSet'
        ? `Flag "${rule.eventFlag?.trim() || 'switch_on'}"`
        : rule.event === 'levelStarts'
        ? 'Automatic on spawn'
        : `Reach ${rule.radius.toFixed(1)}m`;

    if (rule.event === 'flagSet' && rule.eventFlag?.trim()) {
      const flag = rule.eventFlag.trim();
      flagsListenedSet.add(flag);
      const emitters = levelEntities.filter((ent) =>
        ent.mechanisms?.some((m) =>
          m.triggers.some((t) => t.setFlagOnOpen?.trim() === flag)
        )
      );
      if (emitters.length > 0) {
        crossObjectLinks += emitters.length;
        inboundSubtitle = `From ${emitters[0].name}${emitters.length > 1 ? ` +${emitters.length - 1}` : ''} ("${flag}")`;
      }
    }

    labels.push({
      id: `trig_${mech.id}_${rule.id}`,
      badge: `WHEN #${ruleIdx + 1}`,
      title: TRIGGER_SHORT_LABEL[rule.event],
      subtitle: inboundSubtitle,
      color,
      worldPos: beaconPos.clone().add(new THREE.Vector3(0, 0.22, 0)),
      mechId: mech.id,
      triggerId: rule.id,
      isActive: isAct,
    });

    // Draw glowing signal curve from trigger beacon -> target part
    const curve = addGlowingCurve(
      logicGroup,
      pulses,
      beaconPos,
      targetPos,
      0.34 + (i % 3) * 0.14,
      color,
      isAct,
      isAct ? 0.52 : 0.34
    );
    linkCount++;

    // Condition gate node halfway along the curve
    if (rule.condition !== 'none') {
      const gatePos = curve.getPoint(0.48);
      addBeaconNode(logicGroup, gatePos, '#FBBF24', 'octahedron', isAct ? 0.068 : 0.052, isAct);

      if (rule.condition === 'flagSet' && rule.conditionValue?.trim()) {
        flagsListenedSet.add(rule.conditionValue.trim());
      }

      labels.push({
        id: `cond_${mech.id}_${rule.id}`,
        badge: 'GATE',
        title: CONDITION_SHORT_LABEL[rule.condition] ?? 'Condition',
        subtitle:
          rule.condition === 'flagSet'
            ? `"${rule.conditionValue?.trim() || 'flag'}"`
            : rule.consumeRequired
            ? 'Consumes on use'
            : undefined,
        color: '#FBBF24',
        worldPos: gatePos.clone().add(new THREE.Vector3(0, 0.2, 0)),
        mechId: mech.id,
        triggerId: rule.id,
        isActive: isAct,
      });
    }

    // Subtle glowing ground proximity/interact ring for the active mechanism
    if (
      isAct &&
      (rule.event === 'playerUses' ||
        rule.event === 'playerNear' ||
        rule.event === 'playerTouches')
    ) {
      const clampedR = Math.min(2.15, Math.max(0.75, rule.radius * 0.52));
      const ringGeo = new THREE.RingGeometry(clampedR - 0.028, clampedR, 48);
      const ringMat = new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(_tmpCenter.x, 0.015, _tmpCenter.z);
      logicGroup.add(ring);
    }

    // Queue outbound flag broadcast if configured
    if (rule.setFlagOnOpen?.trim()) {
      const flag = rule.setFlagOnOpen.trim();
      flagsBroadcastSet.add(flag);
      outboundFlags.push({
        flag,
        sourcePos: targetPos,
        mechId: mech.id,
        triggerId: rule.id,
        isAct,
      });
    }
  });

  // Build Outbound Flag Broadcasts -> Cross-Object Level Targets on the right perimeter
  outboundFlags.forEach((out, idx) => {
    const tFrac = outboundFlags.length === 1 ? 0.5 : idx / (outboundFlags.length - 1);
    const angle = THREE.MathUtils.lerp(-Math.PI * 0.16, Math.PI * 0.24, tFrac);
    const flagPos = new THREE.Vector3(
      _tmpCenter.x + Math.cos(angle) * orbitRadius,
      Math.max(0.65, _tmpCenter.y + 0.34 + idx * 0.2),
      _tmpCenter.z + Math.sin(angle) * orbitRadius * 0.72 + 0.15
    );

    addBeaconNode(logicGroup, flagPos, '#34D399', 'cube', out.isAct ? 0.072 : 0.056, out.isAct);
    addGlowingCurve(
      logicGroup,
      pulses,
      out.sourcePos,
      flagPos,
      0.38,
      '#34D399',
      out.isAct,
      0.56
    );
    linkCount++;

    // Find level entities influenced by this emitted flag!
    const listeners = levelEntities.filter((ent) =>
      ent.mechanisms?.some((m) =>
        m.triggers.some(
          (t) =>
            (t.event === 'flagSet' && t.eventFlag?.trim() === out.flag) ||
            (t.condition === 'flagSet' && t.conditionValue?.trim() === out.flag)
        )
      )
    );

    labels.push({
      id: `out_${out.mechId}_${out.triggerId}_${idx}`,
      badge: 'EMITS FLAG',
      title: out.flag,
      subtitle:
        listeners.length > 0
          ? `Drives ${listeners.length} level ${listeners.length === 1 ? 'object' : 'objects'}`
          : 'Ready to link in level',
      color: '#34D399',
      worldPos: flagPos.clone().add(new THREE.Vector3(0, 0.24, 0)),
      mechId: out.mechId,
      triggerId: out.triggerId,
      isActive: out.isAct,
    });

    listeners.slice(0, 3).forEach((ent, lIdx) => {
      crossObjectLinks++;
      const satPos = flagPos
        .clone()
        .add(new THREE.Vector3(0.62, 0.26 - lIdx * 0.36, -0.35 + lIdx * 0.32));
      addBeaconNode(logicGroup, satPos, '#2DD4BF', 'cube', 0.06, true);
      addGlowingCurve(logicGroup, pulses, flagPos, satPos, 0.16, '#2DD4BF', true, 0.65);
      linkCount++;

      labels.push({
        id: `lvl_${ent.id}_${idx}_${lIdx}`,
        badge: 'LEVEL OBJECT',
        title: ent.name,
        subtitle: `Triggered by "${out.flag}"`,
        color: '#2DD4BF',
        worldPos: satPos.clone().add(new THREE.Vector3(0, 0.2, 0)),
        mechId: out.mechId,
        triggerId: out.triggerId,
        isActive: true,
      });
    });
  });

  return {
    pulses,
    labels,
    summary: {
      triggerCount,
      linkCount,
      crossObjectLinks,
      flagsBroadcast: Array.from(flagsBroadcastSet),
      flagsListened: Array.from(flagsListenedSet),
    },
  };
}

function buildAxisGuide(
  guideGroup: THREE.Group,
  modelRoot: THREE.Group | null,
  mech: ObjectMechanism | null,
  parts: ObjectPartNode[]
) {
  disposeGroupChildren(guideGroup);
  if (!modelRoot || !mech) return;

  modelRoot.updateMatrixWorld(true);
  const colorHex = AXIS_COLOR[mech.axis] ?? '#F59E0B';
  const accentColor = new THREE.Color(colorHex);

  guideGroup.position.copy(modelRoot.position);
  guideGroup.quaternion.copy(modelRoot.quaternion);
  guideGroup.scale.copy(modelRoot.scale);

  if (mech.kind === 'hinge') {
    const [px, py, pz] = mech.pivot;
    const pivotGroup = new THREE.Group();
    pivotGroup.position.set(px, py, pz);

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.068, 18, 14),
      new THREE.MeshBasicMaterial({
        color: '#FBBF24',
        depthTest: false,
        transparent: true,
        opacity: 0.96,
      })
    );
    sphere.renderOrder = 995;
    pivotGroup.add(sphere);

    const pinGeo = new THREE.CylinderGeometry(0.022, 0.022, 1.35, 14);
    const pinMat = new THREE.MeshBasicMaterial({
      color: accentColor,
      depthTest: false,
      transparent: true,
      opacity: 0.94,
    });
    const pin = new THREE.Mesh(pinGeo, pinMat);
    pin.renderOrder = 994;

    if (mech.axis === 'x') {
      pin.rotation.z = Math.PI / 2;
    } else if (mech.axis === 'z') {
      pin.rotation.x = Math.PI / 2;
    }
    pivotGroup.add(pin);

    const startRad = THREE.MathUtils.degToRad(mech.restAngleDeg);
    const endRad = THREE.MathUtils.degToRad(mech.openAngleDeg);
    const sweep = endRad - startRad;
    const arcRadius = 0.52;

    if (Math.abs(sweep) > 0.015) {
      const steps = Math.max(12, Math.min(48, Math.ceil(Math.abs(sweep) * 14)));
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      for (let i = 0; i <= steps; i++) {
        const a = startRad + (sweep * i) / steps;
        shape.lineTo(Math.cos(a) * arcRadius, Math.sin(a) * arcRadius);
      }
      shape.closePath();
      const fanGeo = new THREE.ShapeGeometry(shape);
      const fanMat = new THREE.MeshBasicMaterial({
        color: accentColor,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.28,
        depthTest: false,
        depthWrite: false,
      });
      const fan = new THREE.Mesh(fanGeo, fanMat);
      fan.renderOrder = 992;

      if (mech.axis === 'x') {
        fan.rotation.y = -Math.PI / 2;
      } else if (mech.axis === 'y') {
        fan.rotation.x = Math.PI / 2;
      }
      pivotGroup.add(fan);

      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= steps; i++) {
        const a = startRad + (sweep * i) / steps;
        const c = Math.cos(a) * arcRadius;
        const s = Math.sin(a) * arcRadius;
        if (mech.axis === 'x') pts.push(new THREE.Vector3(0, s, c));
        else if (mech.axis === 'y') pts.push(new THREE.Vector3(c, 0, -s));
        else pts.push(new THREE.Vector3(c, s, 0));
      }
      const arcLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({
          color: '#FBBF24',
          depthTest: false,
          transparent: true,
          opacity: 0.95,
        })
      );
      arcLine.renderOrder = 993;
      pivotGroup.add(arcLine);
    }

    guideGroup.add(pivotGroup);
  } else {
    const part = parts.find((p) => p.path === mech.targetNodePath);
    const origin = part ? new THREE.Vector3(...part.center) : new THREE.Vector3(0, 0.8, 0);
    const axisVec =
      mech.axis === 'x'
        ? new THREE.Vector3(1, 0, 0)
        : mech.axis === 'y'
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(0, 0, 1);

    const startPt = origin.clone().addScaledVector(axisVec, mech.restOffset);
    const endPt = origin.clone().addScaledVector(axisVec, mech.openOffset);
    const delta = endPt.clone().sub(startPt);
    const travelLen = Math.max(0.08, delta.length());
    const midPt = startPt.clone().add(endPt).multiplyScalar(0.5);

    const rail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, travelLen, 12),
      new THREE.MeshBasicMaterial({
        color: accentColor,
        depthTest: false,
        transparent: true,
        opacity: 0.92,
      })
    );
    rail.position.copy(midPt);
    if (mech.axis === 'x') rail.rotation.z = Math.PI / 2;
    else if (mech.axis === 'z') rail.rotation.x = Math.PI / 2;
    rail.renderOrder = 994;
    guideGroup.add(rail);

    const startBall = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 14, 12),
      new THREE.MeshBasicMaterial({ color: '#94A3B8', depthTest: false })
    );
    startBall.position.copy(startPt);
    startBall.renderOrder = 995;
    guideGroup.add(startBall);

    const dir = delta.lengthSq() > 0.0001 ? delta.clone().normalize() : axisVec.clone();
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.072, 0.19, 14),
      new THREE.MeshBasicMaterial({ color: '#FBBF24', depthTest: false })
    );
    cone.position.copy(endPt);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    cone.renderOrder = 996;
    guideGroup.add(cone);
  }
}

export const MechanismPreviewStage: React.FC<MechanismPreviewStageProps> = ({
  sourceKind,
  builtinTemplate,
  customAsset,
  mechanisms,
  activeMechanismId,
  selectedPartPath,
  previewProgress,
  testTargetOpen,
  testTriggerNonce,
  editPivotGizmo,
  xrayOthers,
  wireframeMode,
  levelEntities = [],
  cameraPreset,
  cameraResetNonce,
  onPartsLoaded,
  onSelectPart,
  onSelectMechanismTrigger,
  onChangePivot,
  onProgressTick,
  onWireframeSummary,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const refsRef = useRef<StageInternalRefs | null>(null);
  const partsRef = useRef<ObjectPartNode[]>([]);
  const labelElsRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [overlayLabels, setOverlayLabels] = useState<LogicLabelMeta[]>([]);

  const stateRef = useRef({
    mechanisms,
    activeMechanismId,
    selectedPartPath,
    previewProgress,
    editPivotGizmo,
    xrayOthers,
    wireframeMode,
    levelEntities,
    onPartsLoaded,
    onSelectPart,
    onSelectMechanismTrigger,
    onChangePivot,
    onProgressTick,
    onWireframeSummary,
  });
  stateRef.current = {
    mechanisms,
    activeMechanismId,
    selectedPartPath,
    previewProgress,
    editPivotGizmo,
    xrayOthers,
    wireframeMode,
    levelEntities,
    onPartsLoaded,
    onSelectPart,
    onSelectMechanismTrigger,
    onChangePivot,
    onProgressTick,
    onWireframeSummary,
  };

  // Apply selection highlight, X-Ray transparency, or Wireframe Logic blueprint rendering
  const applySelectionVisuals = (refs: StageInternalRefs) => {
    const modelRoot = refs.modelRoot;
    const {
      selectedPartPath: selPath,
      xrayOthers: xray,
      wireframeMode: wire,
      mechanisms: mechs,
    } = stateRef.current;

    // Subtle schematic backdrop tint in wireframe mode
    refs.scene.background = new THREE.Color(wire ? '#090E1A' : '#111521');
    if (refs.scene.fog && refs.scene.fog instanceof THREE.Fog) {
      refs.scene.fog.color.set(wire ? '#090E1A' : '#111521');
    }
    refs.pedestalMat.color.set(wire ? '#0F172A' : '#1B2030');
    refs.pedestalMat.wireframe = wire;

    if (!modelRoot) return;
    const targetNode = selPath ? resolveTargetNode(modelRoot, selPath) : null;

    const selectedMeshes = new Set<THREE.Mesh>();
    if (targetNode) {
      targetNode.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) selectedMeshes.add(obj as THREE.Mesh);
      });
    }

    const influencedMeshes = new Set<THREE.Mesh>();
    if (wire) {
      for (const m of mechs) {
        const node = resolveTargetNode(modelRoot, m.targetNodePath);
        if (node) {
          node.traverse((obj) => {
            if ((obj as THREE.Mesh).isMesh) influencedMeshes.add(obj as THREE.Mesh);
          });
        }
      }
    }

    refs.originalMats.forEach((orig, mesh) => {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const isSelected = selectedMeshes.has(mesh);
      const isInfluenced = influencedMeshes.has(mesh);

      mats.forEach((mat, i) => {
        const std = mat as THREE.MeshStandardMaterial;
        if (!std) return;

        if (wire) {
          std.wireframe = true;
          std.transparent = true;
          std.depthWrite = false;
          if (isSelected) {
            std.opacity = 0.96;
            if (std.emissive) {
              std.emissive.setHex(0xf59e0b);
              std.emissiveIntensity = 0.85;
            }
          } else if (isInfluenced) {
            std.opacity = 0.78;
            if (std.emissive) {
              std.emissive.setHex(0x38bdf8);
              std.emissiveIntensity = 0.65;
            }
          } else {
            std.opacity = 0.34;
            if (std.emissive) {
              std.emissive.setHex(0x3b82f6);
              std.emissiveIntensity = 0.25;
            }
          }
          std.needsUpdate = true;
          return;
        }

        std.wireframe = orig.wireframe[i] ?? false;
        if (std.emissive) {
          if (isSelected) {
            std.emissive.setHex(0xd97706);
            std.emissiveIntensity = 0.32;
          } else {
            std.emissive.setHex(orig.emissive[i] ?? 0x000000);
            std.emissiveIntensity = orig.emissive[i] ? 0.7 : 0;
          }
        }
        if (xray && targetNode && !isSelected) {
          std.transparent = true;
          std.opacity = 0.28;
          std.depthWrite = false;
        } else {
          std.transparent = orig.transparent[i] ?? false;
          std.opacity = orig.opacity[i] ?? 1;
          std.depthWrite = orig.depthWrite[i] ?? true;
        }
        std.needsUpdate = true;
      });
    });
  };

  const rebuildLogicVisualization = (refs: StageInternalRefs) => {
    const {
      mechanisms: mechs,
      activeMechanismId: activeId,
      levelEntities: lvlEnts,
      wireframeMode: wire,
      onWireframeSummary: reportSummary,
    } = stateRef.current;

    const result = buildLogicGraph(
      refs.logicGraphGroup,
      refs.modelRoot,
      mechs,
      activeId,
      partsRef.current,
      lvlEnts,
      wire
    );
    refs.logicPulses = result.pulses;
    refs.logicLabels = result.labels;
    setOverlayLabels(result.labels);
    reportSummary?.(result.summary);
  };

  const syncPivotGizmo = (refs: StageInternalRefs) => {
    const { mechanisms: mechs, activeMechanismId: activeId, editPivotGizmo: showGizmo } =
      stateRef.current;
    const activeMech = mechs.find((m) => m.id === activeId) ?? null;

    if (!refs.modelRoot || !activeMech || activeMech.kind !== 'hinge' || !showGizmo) {
      refs.transformControls.detach();
      refs.transformControls.getHelper().visible = false;
      return;
    }

    if (!refs.gizmoDragging) {
      refs.modelRoot.updateMatrixWorld(true);
      _tmpWorldPivot
        .set(activeMech.pivot[0], activeMech.pivot[1], activeMech.pivot[2])
        .applyMatrix4(refs.modelRoot.matrixWorld);
      refs.pivotTarget.position.copy(_tmpWorldPivot);
      refs.pivotTarget.quaternion.copy(refs.modelRoot.quaternion);
    }

    refs.transformControls.setMode('translate');
    refs.transformControls.attach(refs.pivotTarget);
    refs.transformControls.getHelper().visible = true;
  };

  // 1. Initialize WebGL scene once
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const isSoftwareGl = detectSoftwareGl();
    const renderer = createMakerRenderer(isSoftwareGl);
    renderer.setSize(Math.max(1, mount.clientWidth), Math.max(1, mount.clientHeight));
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#111521');
    scene.fog = new THREE.Fog('#111521', 14, 34);
    let envTex: THREE.Texture | null = null;

    const camera = new THREE.PerspectiveCamera(
      40,
      Math.max(1, mount.clientWidth) / Math.max(1, mount.clientHeight),
      0.08,
      60
    );
    camera.position.set(2.8, 2.0, 3.2);

    const transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.setMode('translate');
    transformControls.setSize(1.05);
    const gizmoHelper = transformControls.getHelper();
    gizmoHelper.visible = false;
    scene.add(gizmoHelper);

    const pivotTarget = new THREE.Object3D();
    scene.add(pivotTarget);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0.9, 0);
    controls.minDistance = 1.2;
    controls.maxDistance = 14;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.update();

    const hemi = new THREE.HemisphereLight('#DCEBFF', '#293044', 1.1);
    const key = new THREE.DirectionalLight('#FFF3DC', 2.0);
    key.position.set(4.5, 6.5, 5.0);
    if (!isSoftwareGl) {
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.left = -3.5;
      key.shadow.camera.right = 3.5;
      key.shadow.camera.top = 3.5;
      key.shadow.camera.bottom = -3.5;
      key.shadow.bias = -0.0005;
      key.shadow.normalBias = 0.02;
    }
    const rim = new THREE.DirectionalLight('#7CC8FF', 0.95);
    rim.position.set(-4.2, 3.6, -4.0);
    scene.add(hemi, key, rim);

    const pedestalMat = new THREE.MeshStandardMaterial({
      color: '#1B2030',
      roughness: 0.85,
      metalness: 0.08,
    });
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(2.15, 2.28, 0.08, 48),
      pedestalMat
    );
    pedestal.position.y = -0.04;
    pedestal.receiveShadow = true;
    scene.add(pedestal);

    const grid = new THREE.GridHelper(4.4, 18, '#3A4462', '#262D42');
    grid.position.y = 0.004;
    scene.add(grid);

    const modelHolder = new THREE.Group();
    scene.add(modelHolder);

    const guideGroup = new THREE.Group();
    scene.add(guideGroup);

    const logicGraphGroup = new THREE.Group();
    scene.add(logicGraphGroup);

    const refs: StageInternalRefs = {
      renderer,
      scene,
      camera,
      controls,
      transformControls,
      pivotTarget,
      gizmoDragging: false,
      lastGizmoDragEndMs: 0,
      modelHolder,
      modelRoot: null,
      controller: null,
      guideGroup,
      logicGraphGroup,
      logicPulses: [],
      logicLabels: [],
      pedestalMat,
      camGoalPos: null,
      camGoalTarget: null,
      animatingTest: false,
      originalMats: new Map(),
    };
    refsRef.current = refs;

    const onDraggingChanged = (e: { value: unknown }) => {
      const dragging = Boolean(e.value);
      refs.gizmoDragging = dragging;
      if (!dragging) refs.lastGizmoDragEndMs = performance.now();
      controls.enabled = !dragging;
    };

    const onGizmoChange = () => {
      if (!refs.gizmoDragging || !refs.modelRoot) return;
      refs.modelRoot.updateMatrixWorld(true);
      const invMat = new THREE.Matrix4().copy(refs.modelRoot.matrixWorld).invert();
      _tmpLocalPivot.copy(pivotTarget.position).applyMatrix4(invMat);
      stateRef.current.onChangePivot([
        Math.round(_tmpLocalPivot.x * 1000) / 1000,
        Math.round(_tmpLocalPivot.y * 1000) / 1000,
        Math.round(_tmpLocalPivot.z * 1000) / 1000,
      ]);
    };

    transformControls.addEventListener('dragging-changed', onDraggingChanged);
    transformControls.addEventListener('objectChange', onGizmoChange);

    const onOrbitStart = () => {
      refs.camGoalPos = null;
      refs.camGoalTarget = null;
    };
    controls.addEventListener('start', onOrbitStart);

    let downX = 0;
    let downY = 0;
    const onPointerDown = (ev: PointerEvent) => {
      downX = ev.clientX;
      downY = ev.clientY;
    };
    const onPointerUp = (ev: PointerEvent) => {
      if (refs.gizmoDragging || performance.now() - refs.lastGizmoDragEndMs < 180) return;
      if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > 7) return;
      if (!refs.modelRoot) return;

      const rect = renderer.domElement.getBoundingClientRect();
      _ndc.x = ((ev.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      _ndc.y = -((ev.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;

      _raycaster.setFromCamera(_ndc, camera);
      const hits = _raycaster.intersectObject(refs.modelRoot, true);
      if (hits.length > 0) {
        const bestPath = findBestPartPathForObject(refs.modelRoot, hits[0].object);
        if (bestPath) {
          stateRef.current.onSelectPart(bestPath);
        }
      }
    };

    const onContextLost = (ev: Event) => {
      ev.preventDefault();
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);

    const ro = new ResizeObserver(() => {
      const w = Math.max(1, mount.clientWidth);
      const h = Math.max(1, mount.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(mount);

    let frameId = 0;
    let disposed = false;
    let lastTime = performance.now();

    const afterDraw = (cb: () => void) => {
      const gl =
        typeof renderer.getContext === 'function'
          ? (renderer.getContext() as Partial<WebGL2RenderingContext> | null)
          : null;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE ?? 0x9117, 0);
      gl.flush?.();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync?.(sync);
          return;
        }
        const st = sync && gl.getSyncParameter?.(sync, gl.SYNC_STATUS ?? 0x9114);
        if (st === (gl.UNSIGNALED ?? 0x9118)) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync?.(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const tick = () => {
      if (disposed) return;
      const now = performance.now();
      const dt = Math.min(0.08, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      if (refs.camGoalPos && refs.camGoalTarget) {
        camera.position.lerp(refs.camGoalPos, 1 - Math.exp(-8 * dt));
        controls.target.lerp(refs.camGoalTarget, 1 - Math.exp(-8 * dt));
        if (
          camera.position.distanceTo(refs.camGoalPos) < 0.02 &&
          controls.target.distanceTo(refs.camGoalTarget) < 0.02
        ) {
          camera.position.copy(refs.camGoalPos);
          controls.target.copy(refs.camGoalTarget);
          refs.camGoalPos = null;
          refs.camGoalTarget = null;
        }
      }

      if (refs.controller && refs.animatingTest) {
        const moved = refs.controller.update(dt);
        const activeId = stateRef.current.activeMechanismId;
        if (activeId) {
          const p = refs.controller.getProgress(activeId);
          stateRef.current.onProgressTick(p);
          if (!moved && Math.abs(p - refs.controller.getTargetProgress(activeId)) < 0.002) {
            refs.animatingTest = false;
          }
        }
      }

      // Advance glowing signal pulses along logic graph curves (zero allocations)
      if (refs.logicPulses.length > 0) {
        const boost = refs.animatingTest ? 2.4 : 1.0;
        for (let i = 0; i < refs.logicPulses.length; i++) {
          const item = refs.logicPulses[i];
          item.phase = (item.phase + dt * item.speed * boost) % 1;
          item.curve.getPoint(item.phase, _pulsePos);
          item.mesh.position.copy(_pulsePos);
          item.halo.position.copy(_pulsePos);
        }
      }

      controls.update();
      renderer.render(scene, camera);

      // Project 3D wireframe node labels directly onto DOM transforms (zero React re-renders)
      if (refs.logicLabels.length > 0 && mount.clientWidth > 0 && mount.clientHeight > 0) {
        const w = mount.clientWidth;
        const h = mount.clientHeight;
        for (let i = 0; i < refs.logicLabels.length; i++) {
          const lbl = refs.logicLabels[i];
          const el = labelElsRef.current.get(lbl.id);
          if (!el) continue;
          _projVec.copy(lbl.worldPos).project(camera);
          const behind = _projVec.z > 1 || _projVec.z < -1;
          if (behind) {
            el.style.opacity = '0';
            el.style.pointerEvents = 'none';
          } else {
            const sx = (_projVec.x * 0.5 + 0.5) * w;
            const sy = (-_projVec.y * 0.5 + 0.5) * h;
            const clipped = sx < 16 || sx > w - 16 || sy < 44 || sy > h - 36;
            el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%)`;
            el.style.opacity = clipped ? '0.2' : '1';
            el.style.pointerEvents = 'auto';
          }
        }
      }

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    void (async () => {
      try {
        await renderer.init();
      } catch {
        // ignore if unmounted
      }
      if (disposed) return;
      envTex = setupSceneEnvironment(scene, renderer);
      tick();
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      ro.disconnect();
      transformControls.removeEventListener('dragging-changed', onDraggingChanged);
      transformControls.removeEventListener('objectChange', onGizmoChange);
      controls.removeEventListener('start', onOrbitStart);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      transformControls.dispose();
      controls.dispose();
      disposeGroupChildren(logicGraphGroup);
      disposeGroupChildren(guideGroup);
      disposeGroupChildren(modelHolder);
      disposeObject3D(scene);
      envTex?.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
      refsRef.current = null;
    };
  }, []);

  // 2. Load & mount the active 3D complex object
  const customAssetId = customAsset?.id ?? null;
  const customAssetCategory = customAsset?.category ?? 'prop';
  const customScale = customAsset?.defaultScale ?? 1;
  const customGround = customAsset?.groundOffset ?? 0;

  useEffect(() => {
    const refs = refsRef.current;
    if (!refs) return;
    let cancelled = false;

    const mountModel = (rootObj: THREE.Group) => {
      if (cancelled) {
        disposeObject3D(rootObj);
        return;
      }

      refs.transformControls.detach();
      refs.transformControls.getHelper().visible = false;
      disposeGroupChildren(refs.modelHolder);
      refs.originalMats.clear();

      rootObj.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        const clonedMats = Array.isArray(mesh.material)
          ? mesh.material.map((m) => m.clone())
          : [mesh.material.clone()];
        mesh.material = Array.isArray(mesh.material) ? clonedMats : clonedMats[0];
        refs.originalMats.set(mesh, {
          emissive: clonedMats.map((m) => {
            const std = m as THREE.MeshStandardMaterial;
            return std.emissive ? std.emissive.getHex() : 0x000000;
          }),
          opacity: clonedMats.map((m) => (m as THREE.MeshStandardMaterial).opacity ?? 1),
          transparent: clonedMats.map((m) => Boolean((m as THREE.MeshStandardMaterial).transparent)),
          depthWrite: clonedMats.map((m) => (m as THREE.MeshStandardMaterial).depthWrite !== false),
          wireframe: clonedMats.map((m) => Boolean((m as THREE.MeshStandardMaterial).wireframe)),
        });
      });

      refs.modelHolder.add(rootObj);
      refs.modelRoot = rootObj;
      rootObj.updateMatrixWorld(true);

      _tmpBox.setFromObject(rootObj);
      if (!_tmpBox.isEmpty()) {
        _tmpBox.getCenter(_tmpCenter);
        _tmpBox.getSize(_tmpSize);
        const maxDim = Math.max(_tmpSize.x, _tmpSize.y, _tmpSize.z, 1.2);
        const dist = maxDim * (stateRef.current.wireframeMode ? 2.4 : 1.95);
        refs.camGoalTarget = _tmpCenter.clone();
        refs.camGoalPos = new THREE.Vector3(
          _tmpCenter.x + dist * 0.72,
          _tmpCenter.y + maxDim * 0.46,
          _tmpCenter.z + dist * 0.85
        );
      }

      const parts = inspectObjectHierarchy(rootObj);
      partsRef.current = parts;
      stateRef.current.onPartsLoaded(parts);

      refs.controller = new MechanismRuntimeController(rootObj, stateRef.current.mechanisms);
      const activeId = stateRef.current.activeMechanismId;
      if (activeId) {
        refs.controller.setProgressImmediate(activeId, stateRef.current.previewProgress);
      }

      applySelectionVisuals(refs);
      const activeMech =
        stateRef.current.mechanisms.find((m) => m.id === activeId) ?? null;
      buildAxisGuide(refs.guideGroup, rootObj, activeMech, parts);
      rebuildLogicVisualization(refs);
      syncPivotGizmo(refs);
    };

    if (sourceKind === 'builtin') {
      mountModel(createBuiltinMechanismModel(builtinTemplate));
    } else if (customAssetId) {
      const mountCached = (cached: ReturnType<typeof getCachedAssetSync>) => {
        if (!cached || cancelled) return;
        const wrapper = new THREE.Group();
        wrapper.name = customAsset?.name || 'CustomObject';
        const clone = SkeletonUtils.clone(cached.scene) as THREE.Group;
        clone.updateMatrixWorld(true);
        const rawBox = new THREE.Box3().setFromObject(clone);
        const rawCenter = new THREE.Vector3();
        rawBox.getCenter(rawCenter);
        clone.position.x -= rawCenter.x;
        clone.position.z -= rawCenter.z;

        const scale = customScale || cached.baseScale;
        const baseNormalizedY = (cached.baseGroundOffset / Math.max(0.0001, cached.baseScale)) * scale;
        const userGroundDelta = customGround - cached.baseGroundOffset;
        wrapper.scale.setScalar(scale);
        wrapper.position.y = baseNormalizedY + userGroundDelta;
        wrapper.add(clone);

        mountModel(wrapper);
      };

      const sync = getCachedAssetSync(customAssetId);
      if (sync) {
        mountCached(sync);
      } else {
        void loadCustomAssetToCache(customAssetId, customAssetCategory).then((loaded) => {
          mountCached(loaded);
        });
      }
    } else {
      disposeGroupChildren(refs.modelHolder);
      disposeGroupChildren(refs.guideGroup);
      disposeGroupChildren(refs.logicGraphGroup);
      refs.logicPulses = [];
      refs.logicLabels = [];
      setOverlayLabels([]);
      refs.modelRoot = null;
      refs.controller = null;
      partsRef.current = [];
      stateRef.current.onPartsLoaded([]);
    }

    return () => {
      cancelled = true;
    };
  }, [sourceKind, builtinTemplate, customAssetId, customAssetCategory, customScale, customGround]);

  // 3. Re-bind mechanisms, guides, and wireframe logic graph when rules or mode change
  useEffect(() => {
    const refs = refsRef.current;
    if (!refs || !refs.modelRoot || !refs.controller) return;
    refs.controller.setMechanisms(mechanisms);
    if (activeMechanismId && !refs.animatingTest) {
      refs.controller.setProgressImmediate(activeMechanismId, previewProgress);
    }
    const activeMech = mechanisms.find((m) => m.id === activeMechanismId) ?? null;
    buildAxisGuide(refs.guideGroup, refs.modelRoot, activeMech, partsRef.current);
    applySelectionVisuals(refs);
    rebuildLogicVisualization(refs);
    syncPivotGizmo(refs);
  }, [mechanisms, activeMechanismId, editPivotGizmo, wireframeMode, levelEntities]);

  // Pull camera slightly wider when toggling wireframe mode on so outer trigger beacons fit cleanly
  useEffect(() => {
    const refs = refsRef.current;
    if (!refs?.modelRoot) return;
    _tmpBox.setFromObject(refs.modelRoot);
    if (_tmpBox.isEmpty()) return;
    _tmpBox.getCenter(_tmpCenter);
    _tmpBox.getSize(_tmpSize);
    const maxDim = Math.max(_tmpSize.x, _tmpSize.y, _tmpSize.z, 1.2);
    const dist = maxDim * (wireframeMode ? 2.55 : 1.95);
    refs.camGoalTarget = _tmpCenter.clone();
    refs.camGoalPos = new THREE.Vector3(
      _tmpCenter.x + dist * 0.62,
      _tmpCenter.y + maxDim * (wireframeMode ? 0.64 : 0.42),
      _tmpCenter.z + dist * 0.92
    );
  }, [wireframeMode]);

  // 4. Direct scrub preview update
  useEffect(() => {
    const refs = refsRef.current;
    if (!refs?.controller || !activeMechanismId || refs.animatingTest) return;
    refs.controller.setProgressImmediate(activeMechanismId, previewProgress);
  }, [previewProgress, activeMechanismId]);

  // 5. Live Test Activate / Close animation trigger
  useEffect(() => {
    const refs = refsRef.current;
    if (!refs?.controller || !activeMechanismId || testTargetOpen === null || testTriggerNonce === 0) {
      return;
    }
    refs.controller.trigger(activeMechanismId, testTargetOpen ? 'open' : 'close');
    refs.animatingTest = true;
  }, [testTriggerNonce, testTargetOpen, activeMechanismId]);

  // 6. Highlight & X-Ray updates
  useEffect(() => {
    const refs = refsRef.current;
    if (!refs) return;
    applySelectionVisuals(refs);
  }, [selectedPartPath, xrayOthers, wireframeMode]);

  // 7. Camera preset transitions
  useEffect(() => {
    const refs = refsRef.current;
    if (!refs || cameraResetNonce === 0) return;
    let center = new THREE.Vector3(0, 0.9, 0);
    let maxDim = 2.0;
    if (refs.modelRoot) {
      _tmpBox.setFromObject(refs.modelRoot);
      if (!_tmpBox.isEmpty()) {
        _tmpBox.getCenter(center);
        _tmpBox.getSize(_tmpSize);
        maxDim = Math.max(_tmpSize.x, _tmpSize.y, _tmpSize.z, 1.2);
      }
    }
    const dist = maxDim * (wireframeMode ? 2.45 : 1.95);
    refs.camGoalTarget = center.clone();
    if (cameraPreset === 'front') {
      refs.camGoalPos = new THREE.Vector3(center.x, center.y + maxDim * 0.18, center.z + dist);
    } else if (cameraPreset === 'side') {
      refs.camGoalPos = new THREE.Vector3(center.x + dist, center.y + maxDim * 0.18, center.z + 0.08);
    } else if (cameraPreset === 'top') {
      refs.camGoalPos = new THREE.Vector3(center.x, center.y + dist * 1.18, center.z + 0.35);
    } else {
      refs.camGoalPos = new THREE.Vector3(
        center.x + dist * 0.68,
        center.y + maxDim * 0.48,
        center.z + dist * 0.88
      );
    }
  }, [cameraPreset, cameraResetNonce, wireframeMode]);

  return (
    <div className="w-full h-full relative overflow-hidden bg-[#111521]">
      <div ref={mountRef} className="w-full h-full touch-none" />

      {/* Projected 2D Semantic DOM Labels for Wireframe Logic Mode */}
      {wireframeMode && overlayLabels.length > 0 && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden z-10">
          {overlayLabels.map((lbl) => (
            <button
              key={lbl.id}
              ref={(el) => {
                if (el) labelElsRef.current.set(lbl.id, el);
                else labelElsRef.current.delete(lbl.id);
              }}
              type="button"
              onClick={() => {
                if (lbl.mechId) {
                  onSelectMechanismTrigger?.(lbl.mechId, lbl.triggerId);
                }
              }}
              style={{
                borderColor: lbl.isActive ? lbl.color : 'rgba(255,255,255,0.16)',
                opacity: 0,
              }}
              className="pointer-events-auto absolute top-0 left-0 px-2 py-1 rounded-lg bg-[#0D1322]/92 border text-left transition-colors hover:bg-[#162038] max-w-[190px]"
            >
              <div className="flex items-center gap-1.5 leading-none">
                <span
                  style={{ color: lbl.color }}
                  className="text-[9px] font-black tracking-wide whitespace-nowrap"
                >
                  {lbl.badge}
                </span>
                <span className="text-[11px] font-bold text-white truncate">{lbl.title}</span>
              </div>
              {lbl.subtitle && (
                <div className="text-[10px] text-slate-300/85 truncate mt-0.5 leading-tight">
                  {lbl.subtitle}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Subtle Bottom Helper / Wireframe Legend Bar */}
      <div className="pointer-events-none absolute bottom-2.5 left-3 right-3 flex items-center justify-between gap-3 text-[11px] font-medium text-white/75 z-10">
        {wireframeMode ? (
          <>
            <span className="truncate">
              Wireframe Logic View · Click any glowing trigger or target label to inspect its rule
            </span>
            <span className="hidden sm:inline whitespace-nowrap">
              <span className="text-[#A78BFA]">Violet</span> Interact ·{' '}
              <span className="text-[#38BDF8]">Cyan</span> Near/Target ·{' '}
              <span className="text-[#FBBF24]">Amber</span> Condition ·{' '}
              <span className="text-[#34D399]">Emerald</span> Flag Link
            </span>
          </>
        ) : (
          <>
            <span className="truncate">
              Click any child part in 3D to select · Drag arrows to position hinge pivot
            </span>
            <span className="hidden sm:inline whitespace-nowrap">
              X = Red · Y = Green · Z = Blue
            </span>
          </>
        )}
      </div>
    </div>
  );
};
