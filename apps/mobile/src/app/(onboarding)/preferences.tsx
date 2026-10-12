import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { PreferencesForm } from "@/components/PreferencesForm";
import { Body, Screen, Title } from "@/components/ui";
import { api } from "@/lib/api";
import { keys } from "@/lib/query";

export default function OnboardingPreferences() {
  const router = useRouter();
  const qc = useQueryClient();
  return (
    <Screen style={{ paddingTop: 64 }}>
      <Title>What are you looking for?</Title>
      <Body muted>Step 1 of 2. You can change this any time.</Body>
      <PreferencesForm
        submitLabel="Continue"
        onSubmit={async (p) => {
          await api.savePreferences(p);
          await qc.invalidateQueries({ queryKey: keys.preferences });
          router.push("/(onboarding)/resume");
        }}
      />
    </Screen>
  );
}
