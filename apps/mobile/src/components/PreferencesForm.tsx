import type { Preferences, RemotePreference } from "@vachi/core";
import { Preferences as PreferencesSchema } from "@vachi/core";
import { useState } from "react";
import { ScrollView, Switch, Text, View } from "react-native";
import { Body, Button, Chip, ErrorText, Field, useColors } from "./ui";

const REMOTE: Array<[RemotePreference, string]> = [["any", "Any"], ["remote", "Remote only"], ["hybrid", "Hybrid"], ["onsite", "On-site"]];

/** Parses "Seattle, WA; Austin, TX" into structured US locations. */
function parseLocationInput(text: string) {
  return text.split(";").map((s) => s.trim()).filter(Boolean).map((s) => {
    const [city, region] = s.split(",").map((p) => p.trim());
    return { city: city || undefined, region: region?.toUpperCase() || undefined, country: "US" };
  });
}

export function PreferencesForm({ initial, submitLabel, onSubmit }: {
  initial?: Preferences | null;
  submitLabel: string;
  onSubmit: (p: Preferences) => Promise<unknown>;
}) {
  const c = useColors();
  const [roles, setRoles] = useState(initial?.targetRoles.join(", ") ?? "");
  const [locations, setLocations] = useState(initial?.locations.map((l) => [l.city, l.region].filter(Boolean).join(", ")).join("; ") ?? "");
  const [remote, setRemote] = useState<RemotePreference>(initial?.remote ?? "any");
  const [salary, setSalary] = useState(initial?.salaryMinUsd ? String(initial.salaryMinUsd) : "");
  const [sponsor, setSponsor] = useState(initial?.needsSponsorship ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setError(null);
    const parsed = PreferencesSchema.safeParse({
      targetRoles: roles.split(",").map((r) => r.trim()).filter(Boolean),
      locations: parseLocationInput(locations),
      remote,
      salaryMinUsd: salary ? Number(salary.replace(/[^0-9]/g, "")) : null,
      needsSponsorship: sponsor,
    });
    if (!parsed.success) {
      setError(new Error("Add at least one target role (up to 5)."));
      return;
    }
    setBusy(true);
    try {
      await onSubmit(parsed.data);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ gap: 18, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Field label="Target roles (comma separated)" placeholder="Software Engineer, Backend Engineer" value={roles} onChangeText={setRoles} />
      <Field label="Locations (city, state; separate with ;)" placeholder="Seattle, WA; Austin, TX" value={locations} onChangeText={setLocations} />
      <View style={{ gap: 8 }}>
        <Text style={{ color: c.muted, fontSize: 14 }}>Work style</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {REMOTE.map(([value, label]) => <Chip key={value} label={label} selected={remote === value} onPress={() => setRemote(value)} />)}
        </View>
      </View>
      <Field label="Minimum salary (USD per year, optional)" placeholder="120000" keyboardType="number-pad" value={salary} onChangeText={setSalary} />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Body>I need visa sponsorship</Body>
          <Body muted style={{ fontSize: 13 }}>Private to you. Used only to filter and rank jobs.</Body>
        </View>
        <Switch value={sponsor} onValueChange={setSponsor} accessibilityLabel="I need visa sponsorship" />
      </View>
      <ErrorText error={error} />
      <Button label={submitLabel} loading={busy} onPress={submit} />
    </ScrollView>
  );
}
