import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DecimalStepFix } from "@/components/DecimalStepFix";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";

function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="dark"><TooltipProvider><Toaster theme="dark" position="top-center" /><DecimalStepFix /><Home /></TooltipProvider></ThemeProvider></ErrorBoundary>;
}

export default App;
