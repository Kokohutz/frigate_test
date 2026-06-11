import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { isMobile } from "react-device-detect";
import { Button } from "@/components/ui/button";
import ActivityIndicator from "@/components/indicators/activity-indicator";
import { FrigateConfig } from "@/types/frigateConfig";
import { CameraNode } from "./nodes/CameraNode";
import { DetectorNode } from "./nodes/DetectorNode";
import { GenAINode } from "./nodes/GenAINode";
import { MqttNode } from "./nodes/MqttNode";
import { StorageNode } from "./nodes/StorageNode";
import { TieredStorageNode } from "./nodes/TieredStorageNode";
import { EventRouterNode } from "./nodes/EventRouterNode";
import { EncryptedStorageNode } from "./nodes/EncryptedStorageNode";
import { AlertRulesNode } from "./nodes/AlertRulesNode";
import { NodeEditSheet } from "./panels/NodeEditSheet";
import { AddGenAIDialog } from "./panels/AddGenAIDialog";
import { AddDetectorDialog } from "./panels/AddDetectorDialog";
import { TieredStorageDialog } from "./panels/TieredStorageDialog";
import { EventRouterDialog } from "./panels/EventRouterDialog";
import { MdAddCircle, MdOutlineSettings } from "react-icons/md";

const NODE_TYPES = {
  camera: CameraNode,
  detector: DetectorNode,
  genai: GenAINode,
  mqtt: MqttNode,
  storage: StorageNode,
  tieredStorage: TieredStorageNode,
  eventRouter: EventRouterNode,
  encryptedStorage: EncryptedStorageNode,
  alertRules: AlertRulesNode,
};

export type PipelineNodeData = {
  type:
    | "camera"
    | "detector"
    | "genai"
    | "mqtt"
    | "storage"
    | "tieredStorage"
    | "eventRouter"
    | "encryptedStorage"
    | "alertRules";
  label: string;
  configKey: string;
  [key: string]: unknown;
};

type TierConfig = {
  enabled: boolean;
  hot: { path: string; maxDays: number; maxGb: number };
  cold: { path: string; maxDays: number };
};

type RouterConfig = {
  webhook: { enabled: boolean; url: string };
  discord: { enabled: boolean; url: string };
  slack: { enabled: boolean; url: string };
  telegram: { enabled: boolean; token: string; chatId: string };
  mqtt: { enabled: boolean; host: string; port: number; prefix: string };
  rateLimit: number;
};

const DEFAULT_TIERS: TierConfig = {
  enabled: false,
  hot: { path: "/media/frigate/recordings", maxDays: 7, maxGb: 500 },
  cold: { path: "/mnt/nas/frigate/recordings", maxDays: 90 },
};

const DEFAULT_ROUTER: RouterConfig = {
  webhook: { enabled: false, url: "" },
  discord: { enabled: false, url: "" },
  slack: { enabled: false, url: "" },
  telegram: { enabled: false, token: "", chatId: "" },
  mqtt: { enabled: false, host: "", port: 1883, prefix: "argus" },
  rateLimit: 30,
};

const TIERS_STORAGE_KEY = "argus-storage-tiers";
const ROUTER_STORAGE_KEY = "argus-event-router";

function loadTiers(): TierConfig {
  try {
    const raw = localStorage.getItem(TIERS_STORAGE_KEY);
    return raw ? { ...DEFAULT_TIERS, ...JSON.parse(raw) } : DEFAULT_TIERS;
  } catch {
    return DEFAULT_TIERS;
  }
}

function loadRouter(): RouterConfig {
  try {
    const raw = localStorage.getItem(ROUTER_STORAGE_KEY);
    return raw ? { ...DEFAULT_ROUTER, ...JSON.parse(raw) } : DEFAULT_ROUTER;
  } catch {
    return DEFAULT_ROUTER;
  }
}

export type PipelineNode = Node<PipelineNodeData>;

const X_CAMERAS = 60;
const X_DETECTORS = 310;
const X_GENAI = 560;
const X_SYSTEM = 810;
const Y_GAP = 150;
const Y_START = 60;

function buildGraph(
  config: FrigateConfig,
  tiers: TierConfig,
  router: RouterConfig,
): {
  nodes: PipelineNode[];
  edges: Edge[];
} {
  const nodes: PipelineNode[] = [];
  const edges: Edge[] = [];

  const cameraNames = Object.keys(config.cameras ?? {});

  // Camera nodes
  cameraNames.forEach((name, i) => {
    const cam = config.cameras[name];
    nodes.push({
      id: `camera-${name}`,
      type: "camera",
      position: { x: X_CAMERAS, y: Y_START + i * Y_GAP },
      data: {
        type: "camera",
        label: name,
        configKey: name,
        enabled: cam.detect.enabled,
        detectEnabled: cam.detect.enabled,
        recordEnabled: cam.record?.enabled ?? false,
        genaiEnabled: cam.objects?.genai?.enabled ?? false,
        fps: cam.detect.fps,
      },
    });
  });

  // Detector nodes
  const detectorEntries = Object.entries(
    (config.detectors as Record<string, { type: string; device?: string }>) ??
      {},
  );
  detectorEntries.forEach(([key, det], i) => {
    nodes.push({
      id: `detector-${key}`,
      type: "detector",
      position: { x: X_DETECTORS, y: Y_START + i * Y_GAP },
      data: {
        type: "detector",
        label: key,
        configKey: key,
        detectorType: det.type,
        device: det.device ?? "",
      },
    });
    cameraNames.forEach((name) => {
      edges.push({
        id: `e-cam-${name}-det-${key}`,
        source: `camera-${name}`,
        sourceHandle: "detect",
        target: `detector-${key}`,
        animated: true,
        style: { stroke: "#a855f7", strokeWidth: 1.5 },
      });
    });
  });

  // GenAI nodes
  const genaiEntries = Object.entries(config.genai ?? {});
  genaiEntries.forEach(([key, agent], i) => {
    nodes.push({
      id: `genai-${key}`,
      type: "genai",
      position: { x: X_GENAI, y: Y_START + i * Y_GAP },
      data: {
        type: "genai",
        label: key,
        configKey: key,
        provider: agent.provider ?? "",
        model: agent.model,
        roles: agent.roles ?? [],
        apiKey: agent.api_key ?? "",
        baseUrl: agent.base_url ?? "",
      },
    });
    cameraNames.forEach((name) => {
      if (config.cameras[name].objects?.genai?.enabled) {
        edges.push({
          id: `e-cam-${name}-genai-${key}`,
          source: `camera-${name}`,
          sourceHandle: "genai",
          target: `genai-${key}`,
          animated: true,
          style: { stroke: "#22c55e", strokeWidth: 1.5 },
        });
      }
    });
  });

  // Storage — either tiered or single, never both
  if (tiers.enabled) {
    nodes.push({
      id: "storage-hot",
      type: "tieredStorage",
      position: { x: X_SYSTEM, y: Y_START },
      data: {
        type: "tieredStorage",
        label: "Hot Tier",
        configKey: "storage_tiers.hot",
        tier: "hot",
        path: tiers.hot.path,
        maxDays: tiers.hot.maxDays,
        maxGb: tiers.hot.maxGb,
      },
    });
    nodes.push({
      id: "storage-cold",
      type: "tieredStorage",
      position: { x: X_SYSTEM, y: Y_START + 110 },
      data: {
        type: "tieredStorage",
        label: "Cold Tier",
        configKey: "storage_tiers.cold",
        tier: "cold",
        path: tiers.cold.path,
        maxDays: tiers.cold.maxDays,
      },
    });
    edges.push({
      id: "e-hot-cold",
      source: "storage-hot",
      target: "storage-cold",
      animated: true,
      style: { stroke: "#0ea5e9", strokeWidth: 1.5, strokeDasharray: "4 4" },
      label: "migrate",
      labelStyle: { fontSize: 10, fill: "#0ea5e9" },
      labelBgStyle: { fill: "transparent" },
    });
    cameraNames.forEach((name) => {
      if (config.cameras[name].record?.enabled) {
        edges.push({
          id: `e-cam-${name}-storage-hot`,
          source: `camera-${name}`,
          sourceHandle: "record",
          target: "storage-hot",
          animated: true,
          style: { stroke: "#f97316", strokeWidth: 1.5 },
        });
      }
    });
  } else {
    nodes.push({
      id: "storage-main",
      type: "storage",
      position: { x: X_SYSTEM, y: Y_START },
      data: {
        type: "storage",
        label: "Storage",
        configKey: "storage",
        retainDays: config.record?.retain?.days ?? 7,
        path: "/media/frigate/recordings",
      },
    });
    cameraNames.forEach((name) => {
      if (config.cameras[name].record?.enabled) {
        edges.push({
          id: `e-cam-${name}-storage`,
          source: `camera-${name}`,
          sourceHandle: "record",
          target: "storage-main",
          animated: true,
          style: { stroke: "#f97316", strokeWidth: 1.5 },
        });
      }
    });
  }

  const systemBaseY = tiers.enabled ? Y_START + 240 : Y_START + 180;

  // MQTT node
  if (config.mqtt?.host) {
    nodes.push({
      id: "mqtt-main",
      type: "mqtt",
      position: { x: X_SYSTEM, y: systemBaseY },
      data: {
        type: "mqtt",
        label: "MQTT",
        configKey: "mqtt",
        host: config.mqtt.host,
        port: config.mqtt.port,
        enabled: config.mqtt.enabled,
      },
    });
    cameraNames.forEach((name) => {
      edges.push({
        id: `e-cam-${name}-mqtt`,
        source: `camera-${name}`,
        target: "mqtt-main",
        style: { stroke: "#eab308", strokeWidth: 1.5 },
      });
    });
  }

  // Event router — always shown so users can configure it
  nodes.push({
    id: "event-router",
    type: "eventRouter",
    position: {
      x: X_SYSTEM,
      y: systemBaseY + (config.mqtt?.host ? 120 : 0),
    },
    data: {
      type: "eventRouter",
      label: "Event Router",
      configKey: "event_router",
      sinks: [
        { type: "webhook", enabled: router.webhook.enabled },
        { type: "discord", enabled: router.discord.enabled },
        { type: "slack", enabled: router.slack.enabled },
        { type: "telegram", enabled: router.telegram.enabled },
        { type: "mqtt", enabled: router.mqtt.enabled },
      ],
      rateLimit: router.rateLimit,
    },
  });
  cameraNames.forEach((name) => {
    edges.push({
      id: `e-cam-${name}-router`,
      source: `camera-${name}`,
      target: "event-router",
      style: {
        stroke: "#d946ef",
        strokeWidth: 1.2,
        strokeDasharray: "2 3",
        opacity: 0.6,
      },
    });
  });

  return { nodes, edges };
}

export function PipelineFlow() {
  const { data: config, mutate: revalidate } = useSWR<FrigateConfig>("config", {
    revalidateOnFocus: false,
  });

  const [tiers, setTiers] = useState<TierConfig>(() => loadTiers());
  const [router, setRouter] = useState<RouterConfig>(() => loadRouter());

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () =>
      config ? buildGraph(config, tiers, router) : { nodes: [], edges: [] },
    [config, tiers, router],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<PipelineNode>(
    initialNodes as PipelineNode[],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync when config changes (e.g. after revalidate)
  useEffect(() => {
    setNodes(initialNodes as PipelineNode[]);
    setEdges(initialEdges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNodes, initialEdges]);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  );

  const [selectedNode, setSelectedNode] = useState<PipelineNode | null>(null);
  const [showAddGenAI, setShowAddGenAI] = useState(false);
  const [showAddDetector, setShowAddDetector] = useState(false);
  const [showTiers, setShowTiers] = useState(false);
  const [showRouter, setShowRouter] = useState(false);

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node as PipelineNode);
  }, []);

  const handleNodeUpdate = useCallback(
    (nodeId: string, newData: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, ...newData } as PipelineNodeData }
            : n,
        ),
      );
    },
    [setNodes],
  );

  const handleNodeDelete = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) =>
        eds.filter((e) => e.source !== nodeId && e.target !== nodeId),
      );
    },
    [setNodes, setEdges],
  );

  if (!config) {
    return (
      <div className="flex h-full items-center justify-center">
        <ActivityIndicator />
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2 sm:gap-3 sm:px-4">
        <span className="text-sm font-semibold">Pipeline</span>
        {!isMobile && (
          <span className="text-xs text-muted-foreground">
            {Object.keys(config.cameras ?? {}).length} cameras ·{" "}
            {Object.keys(config.detectors ?? {}).length} detectors ·{" "}
            {Object.keys(config.genai ?? {}).length} GenAI agents
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={() => setShowAddDetector(true)}
            title="Add Detector"
          >
            <MdAddCircle className="size-3.5 shrink-0" />
            {!isMobile && "Detector"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={() => setShowAddGenAI(true)}
            title="Add GenAI Agent"
          >
            <MdAddCircle className="size-3.5 shrink-0" />
            {!isMobile && "GenAI Agent"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={() => setShowTiers(true)}
            title="Storage Tiers"
          >
            <MdOutlineSettings className="size-3.5 shrink-0" />
            {!isMobile && "Storage Tiers"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={() => setShowRouter(true)}
            title="Event Router"
          >
            <MdOutlineSettings className="size-3.5 shrink-0" />
            {!isMobile && "Event Router"}
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <div className="min-h-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={handleNodeClick}
          onPaneClick={() => setSelectedNode(null)}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: isMobile ? 0.1 : 0.25 }}
          minZoom={isMobile ? 0.15 : 0.25}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          className="bg-background"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            className="opacity-30"
          />
          <Controls className="[&>button:hover]:bg-accent [&>button]:border-border [&>button]:bg-card [&>button]:text-foreground" />
          {!isMobile && (
            <MiniMap
              nodeStrokeWidth={3}
              className="rounded-lg border border-border !bg-card"
            />
          )}
        </ReactFlow>
      </div>

      <NodeEditSheet
        node={selectedNode}
        onClose={() => setSelectedNode(null)}
        onDelete={handleNodeDelete}
        onUpdate={handleNodeUpdate}
      />

      {showAddGenAI && (
        <AddGenAIDialog
          onClose={() => setShowAddGenAI(false)}
          onCreated={() => {
            setShowAddGenAI(false);
            revalidate();
          }}
        />
      )}

      {showAddDetector && (
        <AddDetectorDialog
          onClose={() => setShowAddDetector(false)}
          onCreated={() => {
            setShowAddDetector(false);
            revalidate();
          }}
        />
      )}

      {showTiers && (
        <TieredStorageDialog
          value={tiers}
          onClose={() => setShowTiers(false)}
          onSave={(next) => {
            setTiers(next);
            try {
              localStorage.setItem(TIERS_STORAGE_KEY, JSON.stringify(next));
            } catch {
              // ignore
            }
            setShowTiers(false);
          }}
        />
      )}

      {showRouter && (
        <EventRouterDialog
          value={router}
          onClose={() => setShowRouter(false)}
          onSave={(next) => {
            setRouter(next);
            try {
              localStorage.setItem(ROUTER_STORAGE_KEY, JSON.stringify(next));
            } catch {
              // ignore
            }
            setShowRouter(false);
          }}
        />
      )}
    </div>
  );
}
