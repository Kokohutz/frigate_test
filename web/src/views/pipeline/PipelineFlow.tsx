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
import { Button } from "@/components/ui/button";
import ActivityIndicator from "@/components/indicators/activity-indicator";
import { FrigateConfig } from "@/types/frigateConfig";
import { CameraNode } from "./nodes/CameraNode";
import { DetectorNode } from "./nodes/DetectorNode";
import { GenAINode } from "./nodes/GenAINode";
import { MqttNode } from "./nodes/MqttNode";
import { StorageNode } from "./nodes/StorageNode";
import { NodeEditSheet } from "./panels/NodeEditSheet";
import { AddGenAIDialog } from "./panels/AddGenAIDialog";
import { AddDetectorDialog } from "./panels/AddDetectorDialog";
import { MdAddCircle } from "react-icons/md";

const NODE_TYPES = {
  camera: CameraNode,
  detector: DetectorNode,
  genai: GenAINode,
  mqtt: MqttNode,
  storage: StorageNode,
};

export type PipelineNodeData = {
  type: "camera" | "detector" | "genai" | "mqtt" | "storage";
  label: string;
  configKey: string;
  [key: string]: unknown;
};

export type PipelineNode = Node<PipelineNodeData>;

const X_CAMERAS = 60;
const X_DETECTORS = 310;
const X_GENAI = 560;
const X_SYSTEM = 810;
const Y_GAP = 150;
const Y_START = 60;

function buildGraph(config: FrigateConfig): {
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

  // Storage node
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

  // MQTT node
  if (config.mqtt?.host) {
    nodes.push({
      id: "mqtt-main",
      type: "mqtt",
      position: { x: X_SYSTEM, y: Y_START + 180 },
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

  return { nodes, edges };
}

export function PipelineFlow() {
  const { data: config, mutate: revalidate } = useSWR<FrigateConfig>("config", {
    revalidateOnFocus: false,
  });

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => (config ? buildGraph(config) : { nodes: [], edges: [] }),
    [config],
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
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-2">
        <span className="text-sm font-semibold">Pipeline</span>
        <span className="text-xs text-muted-foreground">
          {Object.keys(config.cameras ?? {}).length} cameras ·{" "}
          {Object.keys(config.detectors ?? {}).length} detectors ·{" "}
          {Object.keys(config.genai ?? {}).length} GenAI agents
        </span>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setShowAddDetector(true)}
          >
            <MdAddCircle className="size-3.5" />
            Detector
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setShowAddGenAI(true)}
          >
            <MdAddCircle className="size-3.5" />
            GenAI Agent
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
          fitViewOptions={{ padding: 0.25 }}
          minZoom={0.25}
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
          <MiniMap
            nodeStrokeWidth={3}
            className="rounded-lg border border-border !bg-card"
          />
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
    </div>
  );
}
