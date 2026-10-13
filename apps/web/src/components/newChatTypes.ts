/** Domain types for new-chat / create-bot flows (not tied to popover UI). */

export type CreateBotInput = {
  name: string;
  description: string;
  system_prompt: string;
  avatar_shape: string;
  avatar_color: string;
  machine_id?: string;
};

export type NewChatMode = "list" | "group" | "bot";
