import { NextRequest, NextResponse } from "next/server";
import { getFavouriteFilters, getFilter } from "@/lib/jira-api";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() || "";

  try {
    const favourites = await getFavouriteFilters();

    const results: Array<{
      id: string;
      name: string;
      owner?: string;
      favourite: boolean;
    }> = [];

    for (const f of favourites) {
      if (
        !query ||
        f.name.toLowerCase().includes(query.toLowerCase()) ||
        f.id === query
      ) {
        results.push({
          id: f.id,
          name: f.name,
          owner: f.owner?.displayName || f.owner?.name,
          favourite: true,
        });
      }
    }

    // If query is a numeric ID not already in results, try fetching it directly
    if (/^\d+$/.test(query) && !results.some((r) => r.id === query)) {
      try {
        const filter = await getFilter(query);
        results.push({
          id: filter.id,
          name: filter.name,
          owner: filter.owner?.displayName || filter.owner?.name,
          favourite: filter.favourite || false,
        });
      } catch {
        // Filter ID doesn't exist, ignore
      }
    }

    return NextResponse.json({ filters: results });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch filters";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
