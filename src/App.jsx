import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate, Outlet } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider } from '@/lib/AuthContext';
import ScrollToTop from './components/ScrollToTop';
import ProtectedRoute from '@/components/ProtectedRoute';
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
import PublicFunnel from '@/pages/PublicFunnel';
import AcceptInvite from '@/pages/AcceptInvite';

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <Routes>
            {/* Public routes — no auth required */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/f/:slug" element={<PublicFunnel />} />
            <Route path="/accept-invite" element={<AcceptInvite />} />

            {/* Protected routes — require authentication */}
            <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
              <Route element={<WorkspaceProvider><Outlet /></WorkspaceProvider>}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/funnels" element={<Funnels />} />
                <Route path="/funnels/:id" element={<FunnelWorkspace />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/onboarding" element={<Onboarding />} />
                <Route path="/contacts" element={<Contacts />} />
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