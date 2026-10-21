import "./lib/openuiDevtools";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toast } from "@heroui/react";
import App from "./App";
import AuthCallback from "./pages/AuthCallback";
import { ConfirmProvider } from "./components/ConfirmProvider";
import "./styles.css";
import { initTheme } from "./lib/theme";

initTheme();

const path = window.location.pathname.replace(/\/$/, "") || "/";

function Root() {
  if (path === "/auth/callback") return <AuthCallback />;
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfirmProvider>
      <Root />
      <Toast.Provider placement="top" />
    </ConfirmProvider>
  </StrictMode>,
);
