import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { Body, Chip, ErrorText, ScoreBadge, useColors } from "@/components/ui";
import { api, type FeedItem } from "@/lib/api";
import { formatAge, formatLocations, formatSalary } from "@/lib/format";
import { keys } from "@/lib/query";

export default function Feed() {
  const c = useColors();
  const [sponsorOnly, setSponsorOnly] = useState(false);
  const feed = useInfiniteQuery({
    queryKey: keys.feed(sponsorOnly),
    queryFn: ({ pageParam }) => api.getFeed({ sponsorOnly, after: pageParam }),
    initialPageParam: undefined as { score: number; posting_id: string } | undefined,
    getNextPageParam: (last) => (last.length < 25 ? undefined : { score: last.at(-1)!.score, posting_id: last.at(-1)!.posting_id }),
  });
  const items = feed.data?.pages.flat() ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flexDirection: "row", gap: 8, padding: 16, paddingBottom: 8 }}>
        <Chip label="Best matches" selected={!sponsorOnly} onPress={() => setSponsorOnly(false)} />
        <Chip label="Sponsor jobs only" selected={sponsorOnly} onPress={() => setSponsorOnly(true)} />
      </View>
      {feed.isPending ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.posting_id}
          renderItem={({ item }) => <JobCard item={item} />}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          onEndReached={() => feed.hasNextPage && !feed.isFetchingNextPage && feed.fetchNextPage()}
          refreshControl={<RefreshControl refreshing={feed.isRefetching} onRefresh={() => feed.refetch()} />}
          ListEmptyComponent={
            <View style={{ gap: 8, paddingTop: 24 }}>
              <ErrorText error={feed.error} />
              <Body muted>
                {sponsorOnly
                  ? "No sponsor-friendly matches yet. We show employers with recent certified H-1B filings (public DOL data) whose posting doesn't rule out sponsorship."
                  : "No matches yet. Add your resume and target roles in Profile; new jobs arrive every few hours."}
              </Body>
            </View>
          }
          ListFooterComponent={feed.isFetchingNextPage ? <ActivityIndicator /> : null}
        />
      )}
    </View>
  );
}

function JobCard({ item }: { item: FeedItem }) {
  const c = useColors();
  const salary = formatSalary(item.salary_min_usd, item.salary_max_usd);
  return (
    <Link href={{ pathname: "/job/[id]", params: { id: item.posting_id } }} asChild>
      <Pressable style={{ backgroundColor: c.surface, borderRadius: 14, padding: 14, gap: 6 }} accessibilityRole="link">
        <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          <ScoreBadge score={item.score} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontSize: 16, fontWeight: "600" }} numberOfLines={2}>{item.title}</Text>
            <Text style={{ color: c.muted }}>{item.company_name} · {formatLocations(item.locations)}</Text>
          </View>
        </View>
        <Text style={{ color: c.muted, fontSize: 13 }}>
          {[salary, formatAge(item.posted_at), item.sponsor_filings ? `${item.sponsor_filings} H-1B filings last FY` : null].filter(Boolean).join(" · ")}
        </Text>
        {item.reasons[0] && <Text style={{ color: c.text, fontSize: 13 }}>{item.reasons.slice(0, 2).join(" · ")}</Text>}
      </Pressable>
    </Link>
  );
}
