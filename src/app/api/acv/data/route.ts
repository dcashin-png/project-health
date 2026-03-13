import { NextRequest, NextResponse } from "next/server";
import { getAcvData, getAcvFilterOptions } from "@/lib/ats-api";
import type { AcvFilters } from "@/lib/types";

function parseList(val: string | null): string[] | undefined {
  if (!val) return undefined;
  return val.split(",").filter(Boolean);
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;

    const filters: AcvFilters = {
      attributions: parseList(params.get("attributions")),
      segments: parseList(params.get("segments")),
      businessLines: parseList(params.get("businessLines")),
      productLines: parseList(params.get("productLines")),
      regions: parseList(params.get("regions")),
      quarters: parseList(params.get("quarters")),
      snapshotDateStart: params.get("snapshotDateStart") || undefined,
      snapshotDateEnd: params.get("snapshotDateEnd") || undefined,
    };

    const filterOptions = await getAcvFilterOptions();
    const data = await getAcvData(filters, filterOptions);
    return NextResponse.json(data);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to load ACV data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
