import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Dashboard from "./pages/Dashboard";
import TgAccounts from "./pages/TgAccounts";
import Keywords from "./pages/Keywords";
import MonitorGroups from "./pages/MonitorGroups";
import Templates from "./pages/Templates";
import DmQueue from "./pages/DmQueue";
import HitRecords from "./pages/HitRecords";
import Antiban from "./pages/Antiban";
import Plans from "./pages/Plans";
import AdminPanel from "./pages/AdminPanel";
import Landing from "./pages/Landing";
import Payment from "./pages/Payment";
import SystemSettings from "./pages/SystemSettings";
import BotConfig from "./pages/BotConfig";
import Invite from "./pages/Invite";
import Login from "./pages/Login";
import Register from "./pages/Register";
import VerifyEmail from "./pages/VerifyEmail";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import HitMessages from "./pages/HitMessages";
import KeywordStats from "./pages/KeywordStats";
import GroupSubmissions from "./pages/GroupSubmissions";
import PushSettings from "./pages/PushSettings";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Landing} />
      <Route path={"/dashboard"} component={Dashboard} />
      <Route path={"/accounts"} component={TgAccounts} />
      <Route path={"/keywords"} component={Keywords} />
      <Route path={"/monitor"} component={MonitorGroups} />
      <Route path={"/templates"} component={Templates} />
      <Route path={"/queue"} component={DmQueue} />
      <Route path={"/records"} component={HitRecords} />
      <Route path={"/antiban"} component={Antiban} />
      <Route path={"/plans"} component={Plans} />
      <Route path={"/admin"} component={AdminPanel} />
      <Route path={"/payment"} component={Payment} />
      <Route path={"/system-settings"} component={SystemSettings} />
      <Route path={"/bot-config"} component={BotConfig} />
      <Route path={"/invite"} component={Invite} />
      <Route path={"/hit-messages"} component={HitMessages} />
      <Route path={"/keyword-stats"} component={KeywordStats} />
      <Route path={"/group-submissions"} component={GroupSubmissions} />
      <Route path={"/push-settings"} component={PushSettings} />
      <Route path={"/login"} component={Login} />
      <Route path={"/register"} component={Register} />
      <Route path={"/verify-email"} component={VerifyEmail} />
      <Route path={"/forgot-password"} component={ForgotPassword} />
      <Route path={"/reset-password"} component={ResetPassword} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster theme="dark" />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
