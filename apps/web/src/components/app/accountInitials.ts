export function accountInitials(name: string) {
  const text = name.trim();
  if (!text) return "?";
  return [...text].slice(0, 2).join("");
}
