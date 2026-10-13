import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createBotSecret,
  deleteBotSecret,
  getToken,
  listBotSecretRequests,
  listBotSecrets,
  type BotSecretMeta,
  type BotSecretRequest,
} from "../../api";

export function useSecretsSettings() {
  const [botSecrets, setBotSecrets] = useState<BotSecretMeta[]>([]);
  const [secretRequests, setSecretRequests] = useState<BotSecretRequest[]>([]);
  const [secretPromptDismissed, setSecretPromptDismissed] = useState(false);
  const lastPromptIdRef = useRef<string | undefined>(undefined);
  const [secretFormName, setSecretFormName] = useState("api_token");
  const [secretFormValue, setSecretFormValue] = useState("");
  const [secretFormOrigin, setSecretFormOrigin] = useState("https://api.github.com");
  const [secretMsg, setSecretMsg] = useState("");

  const refreshSecrets = useCallback(async () => {
    try {
      const [secs, reqs] = await Promise.all([listBotSecrets(), listBotSecretRequests()]);
      setBotSecrets(secs);
      setSecretRequests(reqs);
      const nextId = reqs[0]?.id;
      if (nextId && nextId !== lastPromptIdRef.current) {
        lastPromptIdRef.current = nextId;
        setSecretPromptDismissed(false);
      }
      if (!nextId) lastPromptIdRef.current = undefined;
    } catch {
      /* soft-fail */
    }
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    void refreshSecrets();
    const id = window.setInterval(() => void refreshSecrets(), 8000);
    return () => window.clearInterval(id);
  }, [refreshSecrets]);

  const secretPrompt = useMemo(() => {
    if (secretPromptDismissed || !secretRequests.length) return null;
    return secretRequests[0];
  }, [secretPromptDismissed, secretRequests]);

  const setSecretPrompt = useCallback((req: BotSecretRequest | null) => {
    if (req === null) setSecretPromptDismissed(true);
  }, []);

  const onSubmitSecret = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      try {
        await createBotSecret({
          name: secretFormName,
          value: secretFormValue,
          origin: secretFormOrigin,
          auth_type: "bearer",
        });
        setSecretFormValue("");
        setSecretMsg("已保存");
        await refreshSecrets();
      } catch (err) {
        setSecretMsg(err instanceof Error ? err.message : String(err));
      }
    },
    [secretFormName, secretFormValue, secretFormOrigin, refreshSecrets],
  );

  const onDeleteSecret = useCallback(
    (id: string) => {
      void deleteBotSecret(id)
        .then(() => refreshSecrets())
        .catch((e) => setSecretMsg(String(e)));
    },
    [refreshSecrets],
  );

  return {
    botSecrets,
    secretRequests,
    secretPrompt,
    setSecretPrompt,
    secretFormName,
    setSecretFormName,
    secretFormValue,
    setSecretFormValue,
    secretFormOrigin,
    setSecretFormOrigin,
    secretMsg,
    setSecretMsg,
    refreshSecrets,
    onSubmitSecret,
    onDeleteSecret,
  };
}
