import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Alert, ScrollView } from "react-native";
import { ResumeUploader } from "@/components/ResumeUploader";
import { Body, Button, Screen, Title } from "@/components/ui";
import { api } from "@/lib/api";
import { auth } from "@/lib/auth";
import { keys } from "@/lib/query";

export default function Profile() {
  const router = useRouter();
  const prefs = useQuery({ queryKey: keys.preferences, queryFn: api.getPreferences });
  const resumes = useQuery({ queryKey: keys.resumes, queryFn: api.listResumes });
  const primary = resumes.data?.find((r) => r.is_primary) ?? resumes.data?.[0];

  function confirmDelete() {
    Alert.alert("Delete your account?", "This permanently deletes your resumes, matches and history.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => { await api.deleteAccount(); await auth.signOut(); } },
    ]);
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 16 }}>
        <Title>Your search</Title>
        {prefs.data ? (
          <Body>
            {prefs.data.targetRoles.join(", ")}
            {prefs.data.locations.length ? ` in ${prefs.data.locations.map((l) => [l.city, l.region].filter(Boolean).join(", ")).join("; ")}` : ""}
            {prefs.data.salaryMinUsd ? `, from $${Math.round(prefs.data.salaryMinUsd / 1000)}k` : ""}
            {prefs.data.needsSponsorship ? ", needs sponsorship" : ""}
          </Body>
        ) : <Body muted>No preferences yet.</Body>}
        <Button variant="secondary" label="Edit preferences" onPress={() => router.push("/preferences")} />

        <Title>Resume</Title>
        {primary ? (
          <Body>
            {primary.label}: {primary.parse_status === "parsed" ? "ready" : primary.parse_status === "failed" ? `couldn't read it (${primary.parse_error ?? "unknown error"})` : "reading…"}
          </Body>
        ) : <Body muted>No resume yet.</Body>}
        <ResumeUploader />

        <Title>Account</Title>
        <Button variant="secondary" label="Sign out" onPress={() => auth.signOut()} />
        <Button variant="danger" label="Delete account" onPress={confirmDelete} />
      </ScrollView>
    </Screen>
  );
}
