import * as DocumentPicker from "expo-document-picker";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";
import { api } from "@/lib/api";
import { keys } from "@/lib/query";
import { Body, Button, ErrorText } from "./ui";

const TYPES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
const MAX_BYTES = 10 * 1024 * 1024;

export function ResumeUploader({ onDone }: { onDone?: () => void }) {
  const qc = useQueryClient();
  const [localError, setLocalError] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: api.uploadResume,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.resumes });
      qc.invalidateQueries({ queryKey: ["feed"] });
      onDone?.();
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.resumes }),
  });

  async function pick() {
    setLocalError(null);
    const res = await DocumentPicker.getDocumentAsync({ type: TYPES, copyToCacheDirectory: true, multiple: false });
    if (res.canceled) return;
    const f = res.assets[0];
    if (!f) return;
    const mimeType = f.mimeType ?? (f.name.toLowerCase().endsWith(".pdf") ? TYPES[0]! : TYPES[1]!);
    if (!TYPES.includes(mimeType)) return setLocalError("Choose a PDF or Word (.docx) file.");
    if ((f.size ?? 0) > MAX_BYTES) return setLocalError("That file is over 10 MB.");
    upload.mutate({ uri: f.uri, name: f.name, mimeType, size: f.size ?? 1 });
  }

  return (
    <View style={{ gap: 12 }}>
      <Button label={upload.isPending ? "Reading your resume…" : "Upload resume (PDF or Word)"} loading={upload.isPending} onPress={pick} />
      {upload.isPending && <Body muted>This takes about 20 seconds. We pull out your experience and skills, then match jobs.</Body>}
      {upload.isSuccess && <Body>Done. We found {upload.data.document.skills.length} skills and {upload.data.feed.kept} matching jobs.</Body>}
      {localError && <ErrorText error={localError} />}
      <ErrorText error={upload.error} />
    </View>
  );
}
