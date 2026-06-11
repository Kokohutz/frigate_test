import { useEffect, useRef, useState } from "react";
import ReactApexChart from "react-apexcharts";
import useSWR from "swr";
import { FrigateStats } from "@/types/stats";
import type { ApexOptions } from "apexcharts";

type DataPoint = {
  ts: number;
  cpu: number;
  mem: number;
  storageReadMb: number;
};

const MAX_POINTS = 60;

function calcCpuPercent(stats: FrigateStats): number {
  let total = 0;
  let count = 0;
  Object.values(stats.cpu_usages).forEach((p) => {
    const v = parseFloat(p.cpu ?? "0");
    if (!isNaN(v)) {
      total += v;
      count += 1;
    }
  });
  return count > 0 ? total / count : 0;
}

function calcMemPercent(stats: FrigateStats): number {
  let total = 0;
  let count = 0;
  Object.values(stats.cpu_usages).forEach((p) => {
    const v = parseFloat(p.mem ?? "0");
    if (!isNaN(v)) {
      total += v;
      count += 1;
    }
  });
  return count > 0 ? total / count : 0;
}

function calcStorageIoMb(stats: FrigateStats): number {
  // Use detection fps as a proxy for I/O activity (MB/s estimate)
  // Real I/O metrics aren't in the stats object; use camera fps as indicator
  return stats.detection_fps ?? 0;
}

export default function SystemStatsLiveChart() {
  const ringBuffer = useRef<DataPoint[]>([]);
  const [series, setSeries] = useState<ApexAxisChartSeries>([
    { name: "CPU %", data: [] },
    { name: "Memory %", data: [] },
    { name: "Detect FPS", data: [] },
  ]);

  const { data: stats } = useSWR<FrigateStats>("stats", {
    refreshInterval: 2000,
    revalidateOnFocus: true,
    dedupingInterval: 1500,
  });

  useEffect(() => {
    if (!stats) return;

    const point: DataPoint = {
      ts: Date.now(),
      cpu: calcCpuPercent(stats),
      mem: calcMemPercent(stats),
      storageReadMb: calcStorageIoMb(stats),
    };

    const buf = ringBuffer.current;
    buf.push(point);
    if (buf.length > MAX_POINTS) {
      buf.splice(0, buf.length - MAX_POINTS);
    }

    setSeries([
      {
        name: "CPU %",
        data: buf.map((d) => ({ x: d.ts, y: parseFloat(d.cpu.toFixed(1)) })),
      },
      {
        name: "Memory %",
        data: buf.map((d) => ({ x: d.ts, y: parseFloat(d.mem.toFixed(1)) })),
      },
      {
        name: "Detect FPS",
        data: buf.map((d) => ({
          x: d.ts,
          y: parseFloat(d.storageReadMb.toFixed(2)),
        })),
      },
    ]);
  }, [stats]);

  const options: ApexOptions = {
    chart: {
      type: "line",
      background: "transparent",
      animations: { enabled: false },
      toolbar: { show: false },
      zoom: { enabled: false },
      sparkline: { enabled: false },
    },
    stroke: {
      curve: "smooth",
      width: 2,
    },
    xaxis: {
      type: "datetime",
      labels: {
        datetimeUTC: false,
        style: { fontSize: "10px" },
      },
      axisBorder: { show: false },
    },
    yaxis: [
      {
        seriesName: "CPU %",
        min: 0,
        max: 100,
        labels: {
          style: { fontSize: "10px" },
          formatter: (v) => `${v.toFixed(0)}%`,
        },
      },
      {
        seriesName: "Memory %",
        min: 0,
        max: 100,
        show: false,
      },
      {
        seriesName: "Detect FPS",
        opposite: true,
        min: 0,
        labels: {
          style: { fontSize: "10px" },
          formatter: (v) => `${v.toFixed(1)}`,
        },
      },
    ],
    legend: {
      position: "top",
      fontSize: "11px",
    },
    tooltip: {
      x: { format: "HH:mm:ss" },
    },
    grid: {
      borderColor: "rgba(128,128,128,0.15)",
    },
    colors: ["#3b82f6", "#22c55e", "#f97316"],
    theme: {
      mode: "dark",
    },
  };

  return (
    <div className="mt-4 rounded-lg bg-background_alt p-3 md:rounded-2xl">
      <p className="mb-1 text-sm font-medium">Live System Stats (60 s)</p>
      <p className="mb-3 text-xs text-muted-foreground">
        CPU %, Memory %, and Detection FPS — polling every 2 s
      </p>
      <ReactApexChart
        type="line"
        height={220}
        series={series}
        options={options}
      />
    </div>
  );
}
