import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { RootErrorBoundary } from "./RootErrorBoundary.tsx";
import "./styles.css";
import { startAppUpdates } from "./app-update.ts";

startAppUpdates();

createRoot(document.getElementById("root")!).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>,
);
