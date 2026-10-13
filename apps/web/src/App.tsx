import { AuthPage } from "./components/app/AuthPage";
import { AppSidebar } from "./components/app/AppSidebar";
import { AppAuthenticatedShell } from "./components/app/AppAuthenticatedShell";
import { AppSettingsPanel } from "./components/app/AppSettingsPanel";
import { AppOverlays } from "./components/app/AppOverlays";
import { ChatMain } from "./components/app/ChatMain";
import { useWorkspaceAppSession } from "./hooks/useWorkspaceAppSession";

/** Thin shell: workspace session module owns wiring; UI only mounts surfaces. */
export default function App() {
  const { authed, applySession, settings } = useWorkspaceAppSession();

  if (!authed) {
    return <AuthPage onAuthenticated={applySession} />;
  }

  return (
    <AppAuthenticatedShell>
      <AppSidebar />
      <AppOverlays settings={settings} />
      <ChatMain />
      <AppSettingsPanel settings={settings} />
    </AppAuthenticatedShell>
  );
}
