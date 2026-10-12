import type { LLMInput } from "../../api";

export const emptyLLMForm: LLMInput = {
  name: "默认连接",
  base_url: "",
  api_key: "",
  model: "",
  enable_tools: false,
  is_default: true,
  context_window: null,
};
