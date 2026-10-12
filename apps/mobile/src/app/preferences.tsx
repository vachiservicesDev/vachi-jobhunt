import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { ActivityIndicator } from "react-native";
import { PreferencesForm } from "@/components/PreferencesForm";
import { Screen } from "@/components/ui";
import { api } from "@/lib/api";
import { keys } from "@/lib/query";

export default function EditPreferences() {
  const router = useRouter();
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: keys.preferences, queryFn: api.getPreferences });
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: "Preferences" }} />
      {prefs.isPending ? <ActivityIndicator /> : (
        <PreferencesForm
          initial={prefs.data}
          submitLabel="Save"
          onSubmit={async (p) => {
            await api.savePreferences(p);
            await Promise.all([qc.invalidateQueries({ queryKey: keys.preferences }), qc.invalidateQueries({ queryKey: ["feed"] })]);
            router.back();
          }}
        />
      )}
    </Screen>
  );
}
