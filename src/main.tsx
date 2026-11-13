import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { RootErrorBoundary } from "./RootErrorBoundary.tsx";
import "./styles.css";
import { startAppUpdates } from "./app-update.ts";
import UpdateCenter from "./UpdateCenter.tsx";

startAppUpdates();

createRoot(document.getElementById("root")!).render(
  <RootErrorBoundary>
    <App />
    <UpdateCenter />
  </RootErrorBoundary>,
);
