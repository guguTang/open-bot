import { useCallback, useRef } from "react";
import type { PendingFile } from "../../components/Composer";
import type { SendMessageDeps } from "./sendMessageDeps";
import { sendUserTextImpl } from "./sendUserTextImpl";

export type SendUserTextFn = (rawContent: string, filesToSend?: PendingFile[]) => Promise<void>;

export function useSendMessage(deps: SendMessageDeps): SendUserTextFn {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  return useCallback<SendUserTextFn>(async (rawContent, filesToSend = []) => {
    await sendUserTextImpl(depsRef.current, rawContent, filesToSend);
  }, []);
}
