export function jumpToMessage(id: string) {
  const el = document.querySelector(`[data-msg-id="${CSS.escape(id)}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("msg-highlight");
  window.setTimeout(() => el.classList.remove("msg-highlight"), 1200);
}
