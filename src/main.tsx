import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/schibsted-grotesk/wght.css";
import "@fontsource-variable/source-serif-4/opsz.css";
import "@fontsource-variable/source-serif-4/opsz-italic.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./styles/base.css";
import "./styles/app.css";
import "./styles/hub.css";
import "./styles/chat.css";
import "./styles/islands.css";
import "./styles/systems.css";
import { StudioProvider } from "./lib/studio";
import { SystemsProvider } from "./lib/systemsStore";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StudioProvider>
      <SystemsProvider>
        <App />
      </SystemsProvider>
    </StudioProvider>
  </StrictMode>,
);
