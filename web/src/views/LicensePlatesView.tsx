import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import axios from "axios";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import ActivityIndicator from "@/components/indicators/activity-indicator";
import { Search } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";

type PlateEvent = {
  id: string;
  label: string;
  camera: string;
  start_time: number;
  end_time?: number;
  data?: {
    sub_label?: string;
    score?: number;
    top_score?: number;
  };
};

type ListConfig = {
  allow_list?: string[];
  block_list?: string[];
};

function formatTime(ts: number) {
  return new Date(ts * 1000).toLocaleString();
}

function formatConfidence(score?: number) {
  if (score == null) return "—";
  return `${(score * 100).toFixed(1)}%`;
}

function RecentPlatesTab() {
  const [search, setSearch] = useState("");
  const { data: events, isLoading } = useSWR<PlateEvent[]>(
    ["events/explore", { label: "license_plate", limit: 100 }],
    { revalidateOnFocus: true },
  );

  const filtered = events?.filter((e) => {
    const plate = e.data?.sub_label ?? e.label ?? "";
    if (!search.trim()) return true;
    return (
      plate.toLowerCase().includes(search.toLowerCase()) ||
      e.camera.toLowerCase().includes(search.toLowerCase())
    );
  });

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search plates or cameras…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <ActivityIndicator />
        </div>
      ) : filtered && filtered.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Plate Text</TableHead>
                <TableHead>Camera</TableHead>
                <TableHead>Timestamp</TableHead>
                <TableHead>Confidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="font-mono font-semibold uppercase">
                    {event.data?.sub_label ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">{event.camera}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatTime(event.start_time)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatConfidence(event.data?.top_score ?? event.data?.score)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {search ? "No plates match your search." : "No recent license plate events."}
        </p>
      )}
    </div>
  );
}

function ListsTab() {
  const { data: listConfig, mutate } = useSWR<ListConfig>("config/lpr");

  const [allowText, setAllowText] = useState("");
  const [blockText, setBlockText] = useState("");
  const [savingAllow, setSavingAllow] = useState(false);
  const [savingBlock, setSavingBlock] = useState(false);
  const initializedRef = useRef(false);

  // Sync textarea from fetched config once
  useEffect(() => {
    if (listConfig && !initializedRef.current) {
      initializedRef.current = true;
      setAllowText((listConfig.allow_list ?? []).join("\n"));
      setBlockText((listConfig.block_list ?? []).join("\n"));
    }
  }, [listConfig]);

  const parseLines = (text: string) =>
    text
      .split("\n")
      .map((l) => l.trim().toUpperCase())
      .filter(Boolean);

  const handleSaveAllow = async () => {
    setSavingAllow(true);
    try {
      await axios.put("config/license_plate_allow_list", {
        allow_list: parseLines(allowText),
      });
      await mutate();
      toast.success("Allow list saved", { position: "top-center" });
    } catch {
      toast.error("Failed to save allow list", { position: "top-center" });
    } finally {
      setSavingAllow(false);
    }
  };

  const handleSaveBlock = async () => {
    setSavingBlock(true);
    try {
      await axios.put("config/license_plate_block_list", {
        block_list: parseLines(blockText),
      });
      await mutate();
      toast.success("Block list saved", { position: "top-center" });
    } catch {
      toast.error("Failed to save block list", { position: "top-center" });
    } finally {
      setSavingBlock(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      {/* Allow List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold text-green-600 dark:text-green-400">
            Allow List
          </Label>
          <span className="text-xs text-muted-foreground">
            {parseLines(allowText).length} plates
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          One plate per line. Vehicles on this list will always be permitted.
        </p>
        <Textarea
          className="min-h-[200px] font-mono text-xs uppercase"
          placeholder={"ABC123\nXYZ789"}
          value={allowText}
          onChange={(e) => setAllowText(e.target.value)}
        />
        <Button
          variant="select"
          className="w-full"
          onClick={handleSaveAllow}
          disabled={savingAllow}
        >
          {savingAllow ? "Saving…" : "Save Allow List"}
        </Button>
      </div>

      {/* Block List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold text-red-600 dark:text-red-400">
            Block List
          </Label>
          <span className="text-xs text-muted-foreground">
            {parseLines(blockText).length} plates
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          One plate per line. Vehicles on this list will trigger alerts.
        </p>
        <Textarea
          className="min-h-[200px] font-mono text-xs uppercase"
          placeholder={"STOLEN1\nWANTED2"}
          value={blockText}
          onChange={(e) => setBlockText(e.target.value)}
        />
        <Button
          variant="destructive"
          className="w-full"
          onClick={handleSaveBlock}
          disabled={savingBlock}
        >
          {savingBlock ? "Saving…" : "Save Block List"}
        </Button>
      </div>
    </div>
  );
}

export default function LicensePlatesView() {
  useEffect(() => {
    document.title = "License Plates — Frigate";
  }, []);

  return (
    <div className="flex size-full flex-col p-4">
      <Toaster position="top-center" />
      <div className="mb-4">
        <h1 className="text-xl font-bold">License Plates</h1>
        <p className="text-sm text-muted-foreground">
          Recent detections and allow/block lists
        </p>
      </div>

      <Tabs defaultValue="recent" className="flex flex-1 flex-col">
        <TabsList className="w-fit">
          <TabsTrigger value="recent">Recent Plates</TabsTrigger>
          <TabsTrigger value="lists">Lists</TabsTrigger>
        </TabsList>

        <TabsContent value="recent" className="mt-4 flex-1">
          <RecentPlatesTab />
        </TabsContent>

        <TabsContent value="lists" className="mt-4 flex-1">
          <ListsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
