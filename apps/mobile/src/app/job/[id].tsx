import { useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { ScrollView, Text, View } from "react-native";
import { Body, Button, Chip, ScoreBadge, Screen, Title, useColors } from "@/components/ui";
import { api, type FeedItem } from "@/lib/api";
import { formatAge, formatLocations, formatSalary } from "@/lib/format";

/**
 * Job detail from the cached feed. "Open application" sends the user to the
 * employer's own page; nothing is ever submitted on their behalf.
 */
export default function JobDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const qc = useQueryClient();
  const router = useRouter();
  const item = qc.getQueriesData<{ pages: FeedItem[][] }>({ queryKey: ["feed"] })
    .flatMap(([, d]) => d?.pages.flat() ?? [])
    .find((i) => i.posting_id === id);

  if (!item) return <Screen><Body muted>This job is no longer in your feed.</Body></Screen>;
  const salary = formatSalary(item.salary_min_usd, item.salary_max_usd);

  return (
    <Screen>
      <Stack.Screen options={{ title: item.company_name }} />
      <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 40 }}>
        <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          <ScoreBadge score={item.score} />
          <View style={{ flex: 1 }}><Title>{item.title}</Title></View>
        </View>
        <Body muted>{[item.company_name, formatLocations(item.locations), salary, formatAge(item.posted_at)].filter(Boolean).join(" · ")}</Body>

        {item.reasons.length > 0 && (
          <View style={{ gap: 4 }}>
            <Text style={{ color: c.text, fontWeight: "600" }}>Why it matches</Text>
            {item.reasons.map((r) => <Body key={r}>• {r}</Body>)}
          </View>
        )}
        {item.matched_skills.length > 0 && (
          <View style={{ gap: 8 }}>
            <Text style={{ color: c.text, fontWeight: "600" }}>Skills you have</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{item.matched_skills.map((s) => <Chip key={s} label={s} selected />)}</View>
          </View>
        )}
        {item.missing_skills.length > 0 && (
          <View style={{ gap: 8 }}>
            <Text style={{ color: c.text, fontWeight: "600" }}>Missing from your resume</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{item.missing_skills.map((s) => <Chip key={s} label={s} />)}</View>
          </View>
        )}
        {item.sponsor_filings ? (
          <Body muted style={{ fontSize: 13 }}>
            {item.company_name} had {item.sponsor_filings} certified H-1B LCAs in the latest fiscal year (US Department of Labor public data). This is not a promise of sponsorship for this role.
          </Body>
        ) : null}

        <Button label="Open application" onPress={() => Linking.openURL(item.apply_url)} />
        <Button variant="secondary" label={item.saved ? "Saved" : "Save job"} onPress={async () => { await api.setSaved(item.posting_id, !item.saved); qc.invalidateQueries({ queryKey: ["feed"] }); }} />
        <Button variant="secondary" label="Not interested" onPress={async () => { await api.dismiss(item.posting_id); qc.invalidateQueries({ queryKey: ["feed"] }); router.back(); }} />
      </ScrollView>
    </Screen>
  );
}
