import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Loader, LogOut } from 'lucide-react';
import { User } from '@shared/types';
import { subscribeAdminAuth, adminSignOut } from './lib/adminAuth';
import Logo from './components/Logo';

const AdminDashboard = lazy(() => import('./components/AdminDashboard'));
const LoginModal = lazy(() => import('./components/LoginModal'));

const WEBAPP_URL = import.meta.env.VITE_WEBAPP_URL || 'http://localhost:3001';
const WEBSITE_URL = import.meta.env.VITE_WEBSITE_URL || 'http://localhost:3000';

const LoaderScreen = () => (
  <div className="min-h-screen flex items-center justify-center bg-slate-50">
    <Loader className="w-8 h-8 text-[#0A4A6B] animate-spin" />
  </div>
);

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('login') === '1') setShowLoginModal(true);

    const { unsubscribe } = subscribeAdminAuth({
      onAdminUser: (adminUser) => {
        setUser(adminUser);
        setLoading(false);
      },
      onGuest: () => {
        setLoading(false);
      },
      onRedirectToWebapp: () => {
        window.location.href = WEBAPP_URL;
      },
      onSignedOut: () => {
        setUser(null);
        setShowLoginModal(false);
      },
    });

    return unsubscribe;
  }, []);

  const handleLogout = () => {
    setUser(null);
    setShowLoginModal(false);
    void adminSignOut();
    window.history.replaceState({}, '', '/');
  };

  const handleLoginSuccess = (signedInUser: User) => {
    setUser(signedInUser);
    setShowLoginModal(false);
  };

  if (loading) return <LoaderScreen />;

  return (
    <>
      {user ? (
        <div className="min-h-screen" style={{ backgroundColor: '#F8F7F5' }}>
          <header className="sticky top-0 z-40 px-6 py-3 flex items-center justify-between border-b border-slate-200 bg-white">
            <div className="flex items-center gap-2">
              <Logo size={32} />
              <span className="font-semibold text-slate-900">CrestWard Admin</span>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 px-3 py-2 rounded-lg hover:bg-slate-100"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </header>
          <Suspense fallback={<LoaderScreen />}>
            <AdminDashboard />
          </Suspense>
        </div>
      ) : (
        <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#F8F7F5' }}>
          <header className="px-6 py-4 flex items-center justify-between border-b border-slate-200 bg-white">
            <div className="flex items-center gap-2">
              <Logo size={36} />
              <span className="font-semibold text-lg text-slate-900">CrestWard Admin</span>
            </div>
            <a href={WEBSITE_URL} className="text-sm text-slate-500 hover:text-slate-800">
              Back to website
            </a>
          </header>
          <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
            <h1 className="text-2xl font-bold text-slate-900">Admin Portal</h1>
            <p className="text-slate-500 text-center max-w-md">
              Sign in with a product owner or admin account to manage the platform.
            </p>
            <button
              type="button"
              onClick={() => setShowLoginModal(true)}
              className="px-6 py-2.5 rounded-lg font-semibold text-white"
              style={{ backgroundColor: '#0A4A6B' }}
            >
              Sign in
            </button>
          </div>
        </div>
      )}

      <Suspense fallback={null}>
        <LoginModal
          isOpen={showLoginModal}
          onClose={() => setShowLoginModal(false)}
          onSuccess={handleLoginSuccess}
        />
      </Suspense>
    </>
  );
};

export default App;
