import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { api } from "@/lib/api";
import { AuthProvider, useAuth } from "@/lib/auth";
import { keys, queryClient } from "@/lib/query";

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <StatusBar style="auto" />
        <Gate />
      </AuthProvider>
    </QueryClientProvider>
  );
}

/** Routes the user to sign-in, onboarding or the app depending on their state. */
function Gate() {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const profile = useQuery({ queryKey: keys.profile, queryFn: api.getProfile, enabled: !!session });

  useEffect(() => {
    if (loading) return;
    const group = segments[0];
    if (!session) {
      if (group !== "(auth)") router.replace("/(auth)/sign-in");
      return;
    }
    if (profile.isPending) return;
    const onboarded = !!profile.data?.onboarded_at;
    if (!onboarded && group !== "(onboarding)") router.replace("/(onboarding)/preferences");
    else if (onboarded && (group === "(auth)" || group === undefined)) router.replace("/(tabs)");
  }, [loading, session, profile.isPending, profile.data, segments, router]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="job/[id]" options={{ headerShown: true, title: "Job", presentation: "card" }} />
    </Stack>
  );
}
