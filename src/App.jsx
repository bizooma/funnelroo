import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Outlet } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider } from '@/lib/AuthContext';
import ScrollToTop from './components/ScrollToTop';
import ProtectedRoute from '@/components/ProtectedRoute';
import WorkspaceGuard from '@/components/WorkspaceGuard';
import { WorkspaceProvider } from '@/lib/workspaceContext';
// Auth pages
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
// App pages
import Dashboard from '@/pages/Dashboard';
import Funnels from '@/pages/Funnels';
import FunnelWorkspace from '@/pages/FunnelWorkspace';
import Settings from '@/pages/Settings';
import Onboarding from '@/pages/Onboarding';
import Contacts from '@/pages/Contacts';
import ContactDetail from '@/pages/ContactDetail';
import Resources from '@/pages/Resources';
import Appointments from '@/pages/Appointments';
import MarketingKit from '@/pages/MarketingKit';
import AudienceDetail from '@/pages/AudienceDetail';
import GuidedSetup from '@/pages/GuidedSetup';
import PersonaExportPreview from '@/pages/PersonaExportPreview';
import PublicFunnel from '@/pages/PublicFunnel';
import ResourceAccess from '@/pages/ResourceAccess';
import AcceptInvite from '@/pages/AcceptInvite';
import Unsubscribe from '@/pages/Unsubscribe';
import Marketing from '@/pages/Marketing';
import Pricing from '@/pages/Pricing';
import CheckoutReturn from '@/pages/CheckoutReturn';
import { LoginRedirect } from '@/components/ProtectedRoute';

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <Routes>
            {/* Public routes — no auth required */}
            <Route path="/" element={<Marketing />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/f/:publicId" element={<PublicFunnel />} />
            <Route path="/r/:token" element={<ResourceAccess />} />
            <Route path="/accept-invite" element={<AcceptInvite />} />
            <Route path="/u/:token" element={<Unsubscribe />} />

            {/* Protected routes — require authentication */}
            <Route element={<ProtectedRoute unauthenticatedElement={<LoginRedirect />} />}>
              <Route path="/dev/persona-export" element={<PersonaExportPreview />} />
              <Route path="/billing/return" element={<CheckoutReturn />} />
              <Route element={<WorkspaceProvider><Outlet /></WorkspaceProvider>}>
                <Route path="/onboarding" element={<Onboarding />} />
                <Route element={<WorkspaceGuard />}>
                  <Route path="/app" element={<Dashboard />} />
                  <Route path="/funnels" element={<Funnels />} />
                  <Route path="/funnels/:id" element={<FunnelWorkspace />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/contacts" element={<Contacts />} />
                  <Route path="/contacts/:id" element={<ContactDetail />} />
                  <Route path="/marketing-kit" element={<MarketingKit />} />
                  <Route path="/marketing-kit/audiences/:id" element={<AudienceDetail />} />
                  <Route path="/guided-setup" element={<GuidedSetup />} />
                  <Route path="/resources" element={<Resources />} />
                  <Route path="/appointments" element={<Appointments />} />
                </Route>
              </Route>
            </Route>

            <Route path="*" element={<PageNotFound />} />
          </Routes>
          <Toaster />
        </Router>
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App