/**
 * HMS íbúðaverðsvísitölur (nominal).
 *
 * The monthly series is GENERATED into hms-data.json by
 * `bun run refresh:hms` (scripts/refresh-hms.ts), which fetches hms.is
 * kaupvisitala.csv. This module is the logic wrapper: it types the data,
 * exposes the property-type options, and interpolates the index per month.
 *
 * Public market data (not personal) — safe to ship.
 */
import hmsData from "./hms-data.json";

export interface HMSDataPoint {
  month: string; // "YYYY-MM"
  index: number;
}

export interface HMSSeries {
  key: string;
  label: string;
  description: string;
  /** The latest monthly value. */
  lastIndex: number;
  /** ISO date the latest value was published. */
  publishedAt: string;
  points: HMSDataPoint[];
}

/** Region + property type options exposed in the chart dropdown. */
export const HMS_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "fjolbyliCap", label: "Fjölbýli, höfuðborgarsvæði" },
  { key: "serbyliCap", label: "Sérbýli, höfuðborgarsvæði" },
  { key: "fjolbyliLand", label: "Fjölbýli, landsbyggð" },
  { key: "serbyliLand", label: "Sérbýli, landsbyggð" },
  { key: "cap", label: "Allt, höfuðborgarsvæði" },
  { key: "land", label: "Allt, landsbyggð" },
  { key: "total", label: "Allt landið" },
];

const DESCRIPTION: Record<string, string> = {
  fjolbyliCap: "Íbúðir í fjölbýlishúsum á höfuðborgarsvæðinu",
  serbyliCap: "Einbýlis- og parhús á höfuðborgarsvæðinu",
  fjolbyliLand: "Íbúðir í fjölbýlishúsum utan höfuðborgarsvæðis",
  serbyliLand: "Einbýlis- og parhús utan höfuðborgarsvæðis",
  cap: "Allar íbúðir á höfuðborgarsvæðinu",
  land: "Allar íbúðir utan höfuðborgarsvæðis",
  total: "Allar íbúðir á landinu öllu",
};

const DEFAULT_KEY = "fjolbyliCap";

// Keep a sorted month list once; every series shares the same months.
// JSON is typed loosely; each entry is [month, index].
const RAW = hmsData.series as unknown as Record<string, Array<[string, number]>>;
const publishedAt: string = hmsData.publishedAt;

function byMonthMap(key: string): Map<string, number> {
  return new Map((RAW[key] ?? RAW[DEFAULT_KEY]!).map(([m, v]) => [m, v]));
}

/** Get a fully-sorted series for a property-type key. */
export function hmsSeries(key: string): HMSSeries {
  const pts = (RAW[key] ?? RAW[DEFAULT_KEY]!)
    .map(([month, index]) => ({ month, index }))
    .sort((a, b) => a.month.localeCompare(b.month));
  const last = pts[pts.length - 1]!;
  return {
    key,
    label: HMS_OPTIONS.find((o) => o.key === key)?.label ?? key,
    description: DESCRIPTION[key] ?? "",
    lastIndex: last.index,
    publishedAt,
    points: pts,
  };
}

/** Linearly interpolated index for a property-type key at a month. */
export function hmsIndexForMonth(key: string, month: string): number {
  const sorted = (RAW[key] ?? RAW[DEFAULT_KEY]!)
    .map(([m, v]) => [m, v] as [string, number])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const byMonth = byMonthMap(key);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (month <= first[0]) return first[1];
  if (month >= last[0]) return last[1];
  const exact = byMonth.get(month);
  if (exact !== undefined) return exact;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    if (month >= a[0] && month <= b[0]) {
      const span = monthDiff(a[0], b[0]);
      const pos = monthDiff(a[0], month);
      return a[1] + ((b[1] - a[1]) * pos) / span;
    }
  }
  return last[1];
}

/** Months between a month and a series' latest data month (>0 = data is old). */
export function hmsAgeMonths(key: string, month: string): number {
  const last = (RAW[key] ?? RAW[DEFAULT_KEY]!)
    .map(([m]) => m)
    .sort()
    .pop()!;
  return monthDiff(last, month);
}

function monthDiff(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by! - ay!) * 12 + (bm! - am!);
}
