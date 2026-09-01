/**
 * Refresh HMS íbúðaverðsvísitölur from hms.is kaupvisitala.csv.
 *
 * The CSV lives on a public OCI object-storage endpoint (not the bot-gated
 * hms.is page), so this runs standalone with `fetch`. It regenerates
 * src/data/hms-data.json — the only file the chart's HMS module reads.
 *
 *   bun scripts/refresh-hms.ts
 */
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const CSV_URL =
  "https://frs3o1zldvgn.objectstorage.eu-frankfurt-1.oci.customer-oci.com/n/frs3o1zldvgn/b/public_data_for_download/o/kaupvisitala.csv";

/** CSV column → canonical series key (matches HMS_OPTIONS keys in hms.ts). */
const COLUMN_BY_KEY: Record<string, string> = {
  fjolbyliCap: "VISITALA_FJOLBYLI_HOFUDBORGARSVAEDI",
  serbyliCap: "VISITALA_SERBYLI_HOFUDBORGARSVAEDI",
  fjolbyliLand: "VISITALA_FJOLBYLI_LANDSBYGGD",
  serbyliLand: "VISITALA_SERBYLI_LANDSBYGGD",
  cap: "VISITALA_HOFUDBORGARSVAEDI",
  land: "VISITALA_LANDSBYGGD",
  total: "VISITALA",
};

function parseCsv(text: string): string[][] {
  // Simpler split: CSV has no quoted commas beyond the header (values are
  // bare numbers/dates); strip any quotes per field.
  return text
    .trim()
    .split("\n")
    .map((line) =>
      line.split(",").map((f) => f.replace(/"/g, "").trim())
    );
}

async function main() {
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`CSV fetch failed: ${res.status} ${res.statusText}`);
  const text = await res.text();
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("CSV has no data rows");

  const header = rows[0]!;
  const colIndex = (name: string) => header.indexOf(name);
  if (colIndex("UTGAFUDAGUR") < 0) throw new Error("CSV header missing UTGAFUDAGUR");

  const series: Record<string, Array<[string, number]>> = {};
  let publishedAt = "";

  for (const [key, col] of Object.entries(COLUMN_BY_KEY)) {
    const ci = colIndex(col);
    if (ci < 0) throw new Error(`CSV missing column ${col} for ${key}`);
    series[key] = [];
  }

  for (const row of rows.slice(1)) {
    const year = row[colIndex("AR")]!;
    const month = row[colIndex("MANUDUR")]!.trim().padStart(2, "0");
    const ym = `${year}-${month}`;
    const pub = row[colIndex("UTGAFUDAGUR")]!;
    if (pub > publishedAt) publishedAt = pub;
    for (const [key, col] of Object.entries(COLUMN_BY_KEY)) {
      const ci = colIndex(col);
      const v = Number(row[ci]);
      if (!Number.isNaN(v)) series[key]!.push([ym, v]);
    }
  }

  // Keep only months present consistently across every series (the CSV rows
  // are uniform, so each series should share the same month list).
  const byMonth = new Map<string, boolean>();
  for (const [, pts] of Object.entries(series)) {
    for (const [ym] of pts) byMonth.set(ym, true);
  }
  // Dedupe + sort each series by month (a later row can re-issue an earlier month).
  for (const key of Object.keys(series)) {
    const seen = new Map<string, number>();
    for (const [ym, v] of series[key]!) seen.set(ym, v);
    series[key] = [...seen.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([ym, v]) => [ym, v]);
  }

  const lastMonth = [...byMonth.keys()].sort().pop()!;
  const out = {
    source: CSV_URL,
    fetchedAt: new Date().toISOString(),
    publishedAt,
    lastMonth,
    series,
  };

  const outPath = join(import.meta.dir, "..", "src", "data", "hms-data.json");
  mkdirSync(join(import.meta.dir, "..", "src", "data"), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`Wrote ${outPath}`);
  console.log(`  ${series.fjolbyliCap!.length} months (${series.fjolbyliCap![0]![0]} → ${lastMonth}), published ${publishedAt}`);
  for (const [key, pts] of Object.entries(series)) {
    console.log(`  ${key}: last ${pts[pts.length - 1]![1]} @ ${pts[pts.length - 1]![0]}`);
  }
}

main().catch((e) => {
  console.error("refresh-hms failed:", e.message);
  process.exit(1);
});
