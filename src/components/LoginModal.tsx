import React, { useState } from 'react';
import { X, Stethoscope } from 'lucide-react';
import type { User } from '@shared/types';
import { authService } from '@shared/services/authService';
import { funnelTrackingService } from '@shared/services/funnelTrackingService';
import { adminSignIn } from '../lib/adminAuth';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: User) => void;
}

const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [isLogin, setIsLogin]           = useState(true);
  const [email, setEmail]               = useState('');
  const [password, setPassword]         = useState('');
  const [name, setName]                 = useState('');
  const [clinicName, setClinicName]     = useState('');
  const [error, setError]               = useState('');
  const [loading, setLoading]           = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    setError('');
    setGoogleLoading(true);
    try {
      await funnelTrackingService.trackGoogleSignInClick();
      await authService.signInWithGoogle();
    } catch (err: any) {
      const msg = err.message || 'Failed to sign in with Google. Please try again.';
      setError(msg);
      await funnelTrackingService.trackGoogleSignInFailure(msg);
      setGoogleLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isLogin) {
        void funnelTrackingService.trackLoginAttempt(email);
        const user = await adminSignIn(email, password);
        void funnelTrackingService.trackLoginSuccess(email, user.id);
        onSuccess(user);
      } else {
        setError('Admin accounts are created by CrestWard. Use Sign in if you already have access.');
        return;
      }
      onClose();
      setEmail(''); setPassword(''); setName(''); setClinicName('');
    } catch (err: any) {
      const msg = err.message || 'An error occurred. Please try again.';
      setError(msg);
      if (isLogin) await funnelTrackingService.trackLoginFailure(email, msg);
      else         await funnelTrackingService.trackSignupFailure(email, msg);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 14px',
    fontSize: '14px',
    border: '1px solid #E8E4DE',
    borderRadius: '10px',
    outline: 'none',
    backgroundColor: '#FAFAF8',
    color: '#374151',
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    transition: 'border-color 0.15s',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '12px',
    fontWeight: 600,
    color: '#64748b',
    marginBottom: '6px',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ backgroundColor: 'rgba(12,25,41,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl overflow-hidden"
        style={{ boxShadow: '0 32px 64px rgba(12,25,41,0.28)', maxHeight: '95vh', overflowY: 'auto' }}
      >

        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="px-6 pt-7 pb-5 flex items-start justify-between"
          style={{ borderBottom: '1px solid #F0ECE6' }}>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl" style={{ backgroundColor: '#0A4A6B' }}>
              <Stethoscope className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '1.35rem', color: '#12100E', lineHeight: 1.1 }}>
                {isLogin ? 'Welcome back' : 'Create your account'}
              </h2>
              <p className="text-xs mt-0.5" style={{ color: '#9CA3AF' }}>
                {isLogin ? 'Sign in to your Crestward account' : 'Start managing your clinic reputation'}
              </p>
            </div>
          </div>
          <button onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors flex-shrink-0">
            <X className="w-4 h-4" style={{ color: '#9CA3AF' }} />
          </button>
        </div>

        <div className="px-6 py-6 space-y-4"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>

          {/* ── Error ──────────────────────────────────────────── */}
          {error && (
            <div className="px-4 py-3 rounded-xl text-sm"
              style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA', color: '#C0392B' }}>
              {error}
            </div>
          )}

          {/* ── Google button ───────────────────────────────────── */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={googleLoading || loading}
            className="w-full flex items-center justify-center gap-3 py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
            style={{ border: '1.5px solid #E8E4DE', color: '#374151', backgroundColor: '#fff' }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F8F7F5')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#fff')}
          >
            <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            {googleLoading ? 'Connecting…' : 'Continue with Google'}
          </button>

          {/* Google note */}
          <p className="text-xs text-center px-4" style={{ color: '#9CA3AF' }}>
            Use the Google account connected to your <span style={{ color: '#0A4A6B', fontWeight: 600 }}>Google Business profile</span>
          </p>

          {/* ── Divider ─────────────────────────────────────────── */}
          <div className="relative flex items-center gap-3">
            <div className="flex-1 h-px" style={{ backgroundColor: '#E8E4DE' }} />
            <span className="text-xs font-medium" style={{ color: '#9CA3AF' }}>or email</span>
            <div className="flex-1 h-px" style={{ backgroundColor: '#E8E4DE' }} />
          </div>

          {/* ── Form ────────────────────────────────────────────── */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <>
                <div>
                  <label style={labelStyle}>Full Name</label>
                  <input
                    type="text" value={name} onChange={e => setName(e.target.value)}
                    style={inputStyle} placeholder="Dr. Ajith Kumar"
                    required={!isLogin}
                    onFocus={e => (e.target.style.borderColor = '#0A4A6B')}
                    onBlur={e  => (e.target.style.borderColor = '#E8E4DE')}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Clinic Name</label>
                  <input
                    type="text" value={clinicName} onChange={e => setClinicName(e.target.value)}
                    style={inputStyle} placeholder="St. Jude Medical Centre"
                    required={!isLogin}
                    onFocus={e => (e.target.style.borderColor = '#0A4A6B')}
                    onBlur={e  => (e.target.style.borderColor = '#E8E4DE')}
                  />
                </div>
              </>
            )}

            <div>
              <label style={labelStyle}>Email</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                style={inputStyle} placeholder="dr.ajith@example.com"
                required
                onFocus={e => (e.target.style.borderColor = '#0A4A6B')}
                onBlur={e  => (e.target.style.borderColor = '#E8E4DE')}
              />
            </div>

            <div>
              <label style={labelStyle}>Password</label>
              <input
                type="password" value={password} onChange={e => setPassword(e.target.value)}
                style={inputStyle} placeholder="••••••••"
                required minLength={6}
                onFocus={e => (e.target.style.borderColor = '#0A4A6B')}
                onBlur={e  => (e.target.style.borderColor = '#E8E4DE')}
              />
            </div>

            <button
              type="submit"
              disabled={loading || googleLoading}
              className="w-full py-3 rounded-xl text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
              style={{ backgroundColor: '#0A4A6B', color: '#fff' }}
            >
              {loading ? 'Please wait…' : isLogin ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          {/* ── Toggle ──────────────────────────────────────────── */}
          <p className="text-xs text-center" style={{ color: '#9CA3AF' }}>
            {isLogin ? "Don't have an account? " : 'Already have an account? '}
            <button
              type="button"
              onClick={() => { setIsLogin(!isLogin); setError(''); }}
              className="font-semibold hover:underline"
              style={{ color: '#0A4A6B' }}
            >
              {isLogin ? 'Sign up free' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginModal;
