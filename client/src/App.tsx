import { Toaster } from "@/components/ui/sonner";
import { DecimalStepFix } from "@/components/DecimalStepFix";
import ErrorBoundary from "./components/ErrorBoundary";
import Home from "./pages/Home";

function App() {
  return (
    <ErrorBoundary>
      <Toaster theme="dark" position="top-center" />
      <DecimalStepFix />
      <Home />
    </ErrorBoundary>
  );
}

export default App;
