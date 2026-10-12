import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ResumeUploader } from "@/components/ResumeUploader";
import { Body, Button, Screen, Title } from "@/components/ui";
import { keys } from "@/lib/query";

export default function OnboardingResume() {
  const router = useRouter();
  const qc = useQueryClient();
  const finish = async () => {
    await qc.invalidateQueries({ queryKey: keys.profile });
    router.replace("/(tabs)");
  };
  return (
    <Screen style={{ paddingTop: 64 }}>
      <Title>Add your resume</Title>
      <Body muted>Step 2 of 2. Your resume powers your match scores. It stays private and is never shared with employers unless you apply.</Body>
      <ResumeUploader onDone={finish} />
      <Button variant="secondary" label="Skip for now" onPress={finish} />
    </Screen>
  );
}
