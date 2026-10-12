import { useState } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";
import { Body, Button, ErrorText, Field, Screen, Title } from "@/components/ui";
import { auth } from "@/lib/auth";

/** Email one-time code sign-in. Apple and Google sign-in are added with store builds. */
export default function SignIn() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function run(fn: () => Promise<{ error: unknown }>) {
    setBusy(true);
    setError(null);
    const { error } = await fn();
    setBusy(false);
    if (error) setError(error);
    return !error;
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen style={{ justifyContent: "center" }}>
        <Title>Find jobs that fit. Apply faster.</Title>
        <Body muted>Sign in with your email. We'll send you a 6-digit code.</Body>
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" editable={!sent} />
        {sent && <Field label="Code" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} />}
        <ErrorText error={error} />
        {sent ? (
          <Button label="Sign in" loading={busy} disabled={code.length !== 6} onPress={() => run(() => auth.verifyCode(email.trim(), code))} />
        ) : (
          <Button label="Send code" loading={busy} disabled={!/^\S+@\S+\.\S+$/.test(email.trim())} onPress={async () => setSent(await run(() => auth.sendCode(email.trim())))} />
        )}
        {sent && <Button variant="secondary" label="Use a different email" onPress={() => { setSent(false); setCode(""); }} />}
      </Screen>
    </KeyboardAvoidingView>
  );
}
