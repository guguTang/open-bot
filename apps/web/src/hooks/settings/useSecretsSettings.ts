import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  createBotSecret,
  deleteBotSecret,
  getToken,
  listBotSecretRequests,
  listBotSecrets,
  type BotSecretMeta,
  type BotSecretRequest,
} from "../../api";

type UseSecretsSettingsOptions = {
  secretPrompt: BotSecretRequest | null;
  setSecretPrompt: (req: BotSecretRequest | null) => void;
};

export function useSecretsSettings({ secretPrompt, setSecretPrompt }: UseSecretsSettingsOptions) {
  const [botSecrets, setBotSecrets] = useState<BotSecretMeta[]>([]);
  const [secretRequests, setSecretRequests] = useState<BotSecretRequest[]>([]);
  const [secretFormName, setSecretFormName] = useState("api_token");
  const [secretFormValue, setSecretFormValue] = useState("");
  const [secretFormOrigin, setSecretFormOrigin] = useState("https://api.github.com");
  const [secretMsg, setSecretMsg] = useState("");

  const refreshSecrets = useCallback(async () => {
    try {
      const [secs, reqs] = await Promise.all([listBotSecrets(), listBotSecretRequests()]);
      setBotSecrets(secs);
      setSecretRequests(reqs);
      if (reqs.length && !secretPrompt) setSecretPrompt(reqs[0]);
    } catch {
      /* soft-fail */
    }
  }, [secretPrompt, setSecretPrompt]);

  useEffect(() => {
    if (!getToken()) return;
    void refreshSecrets();
    const id = window.setInterval(() => void refreshSecrets(), 8000);
    return () => window.clearInterval(id);
  }, [refreshSecrets]);

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
