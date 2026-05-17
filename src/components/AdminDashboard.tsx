import React, { useState, useEffect, useMemo } from 'react';
import {
  Users, Star, MessageSquare, TrendingUp, AlertTriangle, Search,
  ArrowUp, ArrowDown, ChevronDown, ChevronUp, Plus, Edit2, Trash2,
  Save, X, Check, Clock, Smartphone, ShieldCheck, Zap, DollarSign,
  Activity, RefreshCw, Download,
} from 'lucide-react';
import { supabase } from '@shared/lib/supabase';
import { funnelTrackingService } from '@shared/services/funnelTrackingService';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DoctorRow {
  id: string;
  name: string;
  email: string;
  clinic_name: string;
  subscription_plan: string;
  subscription_status: string;
  is_valid: boolean;
  plan_assigned: boolean;
  created_at: string;
  // Derived from reviews
  total_reviews: number;
  reviews_30d: number;
  avg_rating: number;
  urgent_unaddressed: number; // urgent reviews not replied for 48h+
  response_rate: number;
  last_review_date?: string;
  // Derived from billing
  monthly_revenue: number;
  has_pending_payment: boolean;
}

interface BillingRecord {
  id: string;
  doctor_id: string;
  doctor_name: string;
  clinic_name: string;
  amount: number;
  plan: string;
  billing_cycle: string;
  payment_date?: string;
  payment_status: 'pending' | 'paid' | 'failed' | 'refunded';
  payment_method: string;
  transaction_id?: string;
  notes?: string;
  created_at: string;
}

interface PlatformMetrics {
  reviews_30d: number;
  ai_replies_generated: number;
  whatsapp_messages: number;
  review_gates: number;
}

type AdminTab = 'overview' | 'doctors' | 'billing' | 'funnel' | 'enquiries';

// ── Shared style helpers ───────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #E8E4DE',
  borderRadius: '14px',
};

const PLAN_COLORS: Record<string, { bg: string; text: string }> = {
  Solo:     { bg: '#EEF4FB', text: '#1D4ED8' },
  Clinic:   { bg: 'rgba(10,74,107,0.08)', text: '#0A4A6B' },
  Hospital: { bg: '#F3E8FF', text: '#7C3AED' },
};

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  active:    { bg: '#F0F9F4', text: '#2D7D5A', dot: '#2D7D5A' },
  trial:     { bg: '#FFFBEB', text: '#B45309', dot: '#D97706' },
  cancelled: { bg: '#FEF2F2', text: '#C0392B', dot: '#EF4444' },
  expired:   { bg: '#FEF2F2', text: '#C0392B', dot: '#EF4444' },
};

// ── Sub-components ─────────────────────────────────────────────────────────────

const Metric: React.FC<{
  label: string;
  value: string;
  sub?: string;
  color?: string;
  icon?: React.ElementType;
}> = ({ label, value, sub, color = '#12100E', icon: Icon }) => (
  <div className="text-center p-5 sm:p-6">
    {Icon && <Icon className="w-4 h-4 mx-auto mb-2" style={{ color: '#9CA3AF' }} />}
    <p className="serif" style={{ fontSize: 'clamp(1.6rem,3vw,2.4rem)', lineHeight: 1, color }}>
      {value}
    </p>
    <p className="text-xs font-bold uppercase tracking-widest mt-1.5" style={{ color: '#9CA3AF', letterSpacing: '0.1em' }}>
      {label}
    </p>
    {sub && <p className="text-xs mt-1" style={{ color: '#C4C4C4' }}>{sub}</p>}
  </div>
);

const PlanBadge: React.FC<{ plan: string }> = ({ plan }) => {
  const c = PLAN_COLORS[plan] || { bg: '#F8F7F5', text: '#64748b' };
  return (
    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full"
      style={{ backgroundColor: c.bg, color: c.text }}>{plan}</span>
  );
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const c = STATUS_COLORS[status] || { bg: '#F8F7F5', text: '#64748b', dot: '#9CA3AF' };
  return (
    <span className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full w-fit"
      style={{ backgroundColor: c.bg, color: c.text }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.dot }} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
};

// ── Main Component ─────────────────────────────────────────────────────────────

const AdminDashboard: React.FC = () => {
  const [tab, setTab]           = useState<AdminTab>('overview');
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Raw data
  const [doctors, setDoctors]             = useState<any[]>([]);
  const [reviews, setReviews]             = useState<any[]>([]);
  const [billing, setBilling]             = useState<BillingRecord[]>([]);
  const [whatsappUsage, setWhatsappUsage] = useState<any[]>([]);
  const [gatesCount, setGatesCount]             = useState(0);
  const [funnelMetrics, setFunnelMetrics]       = useState<any>(null);
  const [failedSignups, setFailedSignups]       = useState<any[]>([]);
  const [failedLogins, setFailedLogins]         = useState<any[]>([]);
  const [contactSubmissions, setContactSubmissions] = useState<any[]>([]);
  const [updatingContact, setUpdatingContact]   = useState<string | null>(null);

  // UI state
  const [search, setSearch]           = useState('');
  const [expandedDoctor, setExpandedDoctor] = useState<string | null>(null);
  const [billingForm, setBillingForm] = useState<Partial<BillingRecord> | null>(null);
  const [editingBilling, setEditingBilling] = useState<string | null>(null);
  const [savingBilling, setSavingBilling]   = useState(false);
  const [billingMsg, setBillingMsg]         = useState<{ text: string; type: 'ok' | 'err' } | null>(null);

  const now = new Date();
  const thirtyDaysAgo  = new Date(now.getTime() - 30 * 86400000);
  const fortyEightHAgo = new Date(now.getTime() - 48 * 3600000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      setLoading(true);
      await Promise.all([loadCoreData(), loadFunnel(), loadContacts()]);
    } finally {
      setLoading(false);
    }
  };

  const loadContacts = async () => {
    try {
      const data = await databaseService.getContactSubmissions();
      setContactSubmissions(data);
    } catch {}
  };

  const handleContactStatus = async (id: string, status: 'new' | 'read' | 'replied') => {
    setUpdatingContact(id);
    try {
      await databaseService.updateContactStatus(id, status);
      setContactSubmissions(prev => prev.map(s => s.id === id ? { ...s, status } : s));
    } finally {
      setUpdatingContact(null);
    }
  };

  const loadCoreData = async () => {
    const [
      { data: doctorsData },
      { data: reviewsData },
      { data: billingData },
      { data: whatsappData },
      { count: gatesTotal },
    ] = await Promise.all([
      supabase.from('doctors').select('id,name,email,clinic_name,subscription_plan,subscription_status,is_valid,plan_assigned,created_at').order('created_at', { ascending: false }),
      supabase.from('reviews').select('id,doctor_id,rating,status,sentiment,date,created_at,updated_at,ai_reply').order('date', { ascending: false }),
      supabase.from('billing_records')
        .select('id,doctor_id,amount,plan,billing_cycle,payment_date,payment_status,payment_method,transaction_id,notes,created_at')
        .order('created_at', { ascending: false }),
      supabase.from('whatsapp_usage').select('doctor_id,message_count,month_year'),
      supabase.from('private_feedback').select('id', { count: 'exact', head: true }),
    ]);

    // Enrich billing with doctor names
    const doctorMap = new Map((doctorsData || []).map((d: any) => [d.id, d]));
    const enrichedBilling: BillingRecord[] = (billingData || []).map((b: any) => ({
      ...b,
      doctor_name: doctorMap.get(b.doctor_id)?.name || 'Unknown',
      clinic_name: doctorMap.get(b.doctor_id)?.clinic_name || 'Unknown',
    }));

    setDoctors(doctorsData || []);
    setReviews(reviewsData || []);
    setBilling(enrichedBilling);
    setWhatsappUsage(whatsappData || []);
    setGatesCount(gatesTotal || 0);
  };

  const loadFunnel = async () => {
    try {
      const [metrics, signups, logins] = await Promise.all([
        funnelTrackingService.getFunnelMetrics(),
        funnelTrackingService.getFailedAttempts('signup_failed', 30),
        funnelTrackingService.getFailedAttempts('login_failed', 30),
      ]);
      setFunnelMetrics(metrics);
      setFailedSignups(signups);
      setFailedLogins(logins);
    } catch { /* non-blocking */ }
  };

  const refresh = async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  };

  // ── Derived metrics ────────────────────────────────────────────────────────

  const doctorRows: DoctorRow[] = useMemo(() => {
    const reviewsByDoctor = new Map<string, any[]>();
    reviews.forEach(r => {
      if (!reviewsByDoctor.has(r.doctor_id)) reviewsByDoctor.set(r.doctor_id, []);
      reviewsByDoctor.get(r.doctor_id)!.push(r);
    });

    const billingByDoctor = new Map<string, BillingRecord[]>();
    billing.forEach(b => {
      if (!billingByDoctor.has(b.doctor_id)) billingByDoctor.set(b.doctor_id, []);
      billingByDoctor.get(b.doctor_id)!.push(b);
    });

    return doctors.map(d => {
      const dr = reviewsByDoctor.get(d.id) || [];
      const dr30 = dr.filter(r => new Date(r.date) >= thirtyDaysAgo);
      const replied = dr.filter(r => r.status === 'replied').length;
      const urgentOld = dr.filter(r =>
        r.status === 'urgent' &&
        new Date(r.updated_at || r.created_at) < fortyEightHAgo
      ).length;
      const lastReview = dr[0]?.date;
      const avgRating = dr.length > 0 ? dr.reduce((s: number, r: any) => s + r.rating, 0) / dr.length : 0;

      const db = billingByDoctor.get(d.id) || [];
      const paidThisMonth = db.filter(b =>
        b.payment_status === 'paid' &&
        new Date(b.payment_date || b.created_at) >= thirtyDaysAgo
      );
      const monthlyRevenue = paidThisMonth.reduce((s, b) =>
        s + (b.billing_cycle === 'yearly' ? b.amount / 12 : b.amount), 0);
      const hasPending = db.some(b => b.payment_status === 'pending');

      return {
        id: d.id,
        name: d.name,
        email: d.email,
        clinic_name: d.clinic_name,
        subscription_plan: d.subscription_plan || 'Clinic',
        subscription_status: d.subscription_status || 'active',
        is_valid: !!d.is_valid,
        plan_assigned: !!d.plan_assigned,
        created_at: d.created_at,
        total_reviews: dr.length,
        reviews_30d: dr30.length,
        avg_rating: avgRating,
        urgent_unaddressed: urgentOld,
        response_rate: dr.length > 0 ? Math.round((replied / dr.length) * 100) : 0,
        last_review_date: lastReview,
        monthly_revenue: monthlyRevenue,
        has_pending_payment: hasPending,
      };
    });
  }, [doctors, reviews, billing]);

  const mrr = useMemo(() => {
    return billing
      .filter(b => b.payment_status === 'paid' && new Date(b.payment_date || b.created_at) >= thirtyDaysAgo)
      .reduce((s, b) => s + (b.billing_cycle === 'yearly' ? b.amount / 12 : b.amount), 0);
  }, [billing]);

  const pendingRevenue = useMemo(() =>
    billing.filter(b => b.payment_status === 'pending').reduce((s, b) => s + b.amount, 0),
  [billing]);

  const paidThisMonth = useMemo(() =>
    billing.filter(b => b.payment_status === 'paid' && new Date(b.payment_date || b.created_at) >= thirtyDaysAgo).reduce((s, b) => s + b.amount, 0),
  [billing]);

  const platformMetrics: PlatformMetrics = useMemo(() => ({
    reviews_30d:        reviews.filter(r => new Date(r.date) >= thirtyDaysAgo).length,
    ai_replies_generated: reviews.filter(r => r.ai_reply).length,
    whatsapp_messages:  whatsappUsage.reduce((s, w) => s + (w.message_count || 0), 0),
    review_gates:       gatesCount,
  }), [reviews, whatsappUsage, gatesCount]);

  const growthMetrics = useMemo(() => ({
    total:           doctors.length,
    new_this_month:  doctors.filter(d => new Date(d.created_at) >= thirtyDaysAgo).length,
    trial:           doctors.filter(d => d.subscription_status === 'trial').length,
    paid:            doctors.filter(d => d.subscription_status === 'active').length,
    churned:         doctors.filter(d => ['cancelled','expired'].includes(d.subscription_status)).length,
  }), [doctors]);

  const actionRequired = useMemo(() => ({
    urgentUnaddressed: doctorRows.filter(d => d.urgent_unaddressed > 0),
    inactive14d:       doctorRows.filter(d =>
      !d.last_review_date || new Date(d.last_review_date) < fourteenDaysAgo
    ),
  }), [doctorRows]);

  const filteredDoctors = useMemo(() => {
    if (!search) return doctorRows;
    const q = search.toLowerCase();
    return doctorRows.filter(d =>
      d.name.toLowerCase().includes(q) ||
      d.clinic_name.toLowerCase().includes(q) ||
      d.email.toLowerCase().includes(q)
    );
  }, [doctorRows, search]);

  const pendingBilling = useMemo(() =>
    billing
      .filter(b => b.payment_status === 'pending')
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
  [billing]);

  // ── Billing actions ────────────────────────────────────────────────────────

  const showMsg = (text: string, type: 'ok' | 'err') => {
    setBillingMsg({ text, type });
    setTimeout(() => setBillingMsg(null), 4000);
  };

  const markPaid = async (id: string) => {
    try {
      const { error } = await supabase.from('billing_records')
        .update({ payment_status: 'paid', payment_date: new Date().toISOString().split('T')[0] })
        .eq('id', id);
      if (error) throw error;
      setBilling(prev => prev.map(b => b.id === id ? { ...b, payment_status: 'paid', payment_date: new Date().toISOString().split('T')[0] } : b));
      showMsg('Marked as paid!', 'ok');
    } catch (e: any) { showMsg(e.message, 'err'); }
  };

  const deleteBilling = async (id: string) => {
    if (!confirm('Delete this billing record?')) return;
    try {
      const { error } = await supabase.from('billing_records').delete().eq('id', id);
      if (error) throw error;
      setBilling(prev => prev.filter(b => b.id !== id));
      showMsg('Deleted', 'ok');
    } catch (e: any) { showMsg(e.message, 'err'); }
  };

  const saveBillingRecord = async () => {
    if (!billingForm?.doctor_id || !billingForm?.amount) { showMsg('Doctor and amount are required', 'err'); return; }
    setSavingBilling(true);
    try {
      if (editingBilling) {
        const { error } = await supabase.from('billing_records').update({
          amount: billingForm.amount, plan: billingForm.plan, billing_cycle: billingForm.billing_cycle,
          payment_status: billingForm.payment_status, payment_method: billingForm.payment_method,
          payment_date: billingForm.payment_date, transaction_id: billingForm.transaction_id, notes: billingForm.notes,
        }).eq('id', editingBilling);
        if (error) throw error;
        await loadCoreData();
        showMsg('Updated!', 'ok');
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        const { error } = await supabase.from('billing_records').insert({
          doctor_id: billingForm.doctor_id, amount: billingForm.amount,
          plan: billingForm.plan || 'Clinic', billing_cycle: billingForm.billing_cycle || 'monthly',
          payment_status: billingForm.payment_status || 'pending',
          payment_method: billingForm.payment_method || 'bank_transfer',
          payment_date: billingForm.payment_date, transaction_id: billingForm.transaction_id,
          notes: billingForm.notes, created_by: user?.id,
        });
        if (error) throw error;
        await loadCoreData();
        showMsg('Record added!', 'ok');
      }
      setBillingForm(null);
      setEditingBilling(null);
    } catch (e: any) { showMsg(e.message, 'err'); }
    finally { setSavingBilling(false); }
  };

  const updateDoctorPlan = async (doctorId: string, plan: string) => {
    try {
      const { error } = await supabase.from('doctors').update({
        subscription_plan: plan,
        plan_assigned: true,
        subscription_status: 'active',
      }).eq('id', doctorId);
      if (error) throw error;
      setDoctors(prev => prev.map(d => d.id === doctorId
        ? { ...d, subscription_plan: plan, plan_assigned: true, subscription_status: 'active' }
        : d));
    } catch (e: any) { alert(e.message); }
  };

  const updateDoctorHealthcareVerified = async (doctorId: string, isValid: boolean) => {
    try {
      const { error } = await supabase.from('doctors').update({ is_valid: isValid }).eq('id', doctorId);
      if (error) throw error;
      setDoctors(prev => prev.map(d => d.id === doctorId ? { ...d, is_valid: isValid } : d));
      showMsg(isValid ? 'Healthcare verification approved' : 'Verification revoked', 'ok');
    } catch (e: any) { showMsg(e.message, 'err'); }
  };

  const updateDoctorPlanAssigned = async (doctorId: string, planAssigned: boolean) => {
    try {
      const updates: Record<string, unknown> = { plan_assigned: planAssigned };
      if (planAssigned) updates.subscription_status = 'active';
      const { error } = await supabase.from('doctors').update(updates).eq('id', doctorId);
      if (error) throw error;
      setDoctors(prev => prev.map(d => d.id === doctorId
        ? { ...d, plan_assigned: planAssigned, subscription_status: planAssigned ? 'active' : d.subscription_status }
        : d));
      showMsg(planAssigned ? 'Plan access enabled' : 'Plan access removed', 'ok');
    } catch (e: any) { showMsg(e.message, 'err'); }
  };

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: '#F8F7F5' }}>
      <div className="text-center">
        <div className="w-10 h-10 rounded-full border-2 border-transparent animate-spin mx-auto mb-4"
          style={{ borderTopColor: '#0A4A6B', borderRightColor: '#0A4A6B' }} />
        <p className="text-sm" style={{ color: '#9CA3AF', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Loading admin data…</p>
      </div>
    </div>
  );

  const inp = 'text-sm border rounded-lg px-3 py-2 outline-none w-full';
  const inpStyle: React.CSSProperties = { border: '1px solid #E8E4DE', borderRadius: '8px', color: '#374151', fontFamily: "'Plus Jakarta Sans', sans-serif", backgroundColor: '#FAFAF8' };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen pb-20" style={{ backgroundColor: '#F8F7F5', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <style>{`.serif{font-family:'Cormorant Garamond',serif}`}</style>

      {/* Sticky header */}
      <div className="sticky top-0 z-20 px-4 sm:px-6 pt-4 pb-3"
        style={{ backgroundColor: 'rgba(248,247,245,0.92)', backdropFilter: 'blur(8px)', borderBottom: '1px solid #E8E4DE' }}>
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="serif text-xl" style={{ color: '#12100E' }}>Admin Panel</h1>
            <p className="text-xs mt-0.5" style={{ color: '#9CA3AF' }}>
              {doctors.length} clinics · ₹{mrr.toLocaleString('en-IN', { maximumFractionDigits: 0 })} MRR
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={refresh} disabled={refreshing}
              className="p-2 rounded-lg hover:opacity-80 transition-opacity disabled:opacity-40"
              style={{ border: '1px solid #E8E4DE', backgroundColor: '#fff' }}>
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} style={{ color: '#64748b' }} />
            </button>
            <button onClick={() => {
              const csv = ['Name,Clinic,Plan,Status,Reviews,Avg Rating,Response Rate,MRR']
                .concat(doctorRows.map(d => `${d.name},${d.clinic_name},${d.subscription_plan},${d.subscription_status},${d.total_reviews},${d.avg_rating.toFixed(1)},${d.response_rate}%,${d.monthly_revenue}`))
                .join('\n');
              const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
              a.download = `crestward-doctors-${new Date().toISOString().slice(0,10)}.csv`; a.click();
            }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity"
              style={{ border: '1px solid #E8E4DE', backgroundColor: '#fff', color: '#64748b' }}>
              <Download className="w-3.5 h-3.5" /> Export
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-6xl mx-auto flex items-center gap-1 mt-3 overflow-x-auto pb-1">
          {([
            { id: 'overview', label: 'Overview' },
            { id: 'doctors',  label: `Doctors (${doctors.length})` },
            { id: 'billing',  label: `Billing${pendingBilling.length > 0 ? ` · ${pendingBilling.length} pending` : ''}` },
            { id: 'funnel',    label: 'Funnel' },
            { id: 'enquiries', label: `Enquiries${contactSubmissions.filter(s => s.status === 'new').length > 0 ? ` · ${contactSubmissions.filter(s => s.status === 'new').length} new` : ''}` },
          ] as { id: AdminTab; label: string }[]).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0"
              style={{
                backgroundColor: tab === t.id ? '#0A4A6B' : '#fff',
                color: tab === t.id ? '#fff' : '#64748b',
                border: tab === t.id ? 'none' : '1px solid #E8E4DE',
              }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-5 space-y-5">

        {/* ── OVERVIEW TAB ──────────────────────────────────────────────────── */}
        {tab === 'overview' && (<>

          {/* Revenue strip */}
          <div style={{ ...card, overflow: 'hidden' }}>
            <div className="px-5 py-3" style={{ borderBottom: '1px solid #E8E4DE' }}>
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#9CA3AF' }}>Revenue</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-x" style={{ divideColor: '#E8E4DE' }}>
              <div style={{ borderRight: '1px solid #E8E4DE' }}>
                <Metric label="MRR" value={`₹${Math.round(mrr).toLocaleString('en-IN')}`} sub="monthly recurring" color="#E8960C" />
              </div>
              <div style={{ borderRight: '1px solid #E8E4DE' }}>
                <Metric label="ARR" value={`₹${Math.round(mrr * 12).toLocaleString('en-IN')}`} sub="annualised" color="#0A4A6B" />
              </div>
              <div style={{ borderRight: '1px solid #E8E4DE' }}>
                <Metric label="Pending Collection" value={`₹${Math.round(pendingRevenue).toLocaleString('en-IN')}`}
                  sub={`${pendingBilling.length} invoices`} color={pendingRevenue > 0 ? '#C0392B' : '#2D7D5A'} />
              </div>
              <div>
                <Metric label="Paid This Month" value={`₹${Math.round(paidThisMonth).toLocaleString('en-IN')}`}
                  sub="last 30 days" color="#2D7D5A" />
              </div>
            </div>
          </div>

          {/* Growth strip */}
          <div style={{ ...card, overflow: 'hidden' }}>
            <div className="px-5 py-3" style={{ borderBottom: '1px solid #E8E4DE' }}>
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#9CA3AF' }}>Customer Base</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 divide-x" style={{ divideColor: '#E8E4DE' }}>
              {[
                { label: 'Total Clinics',   value: growthMetrics.total.toString(),          color: '#12100E' },
                { label: 'New This Month',  value: `+${growthMetrics.new_this_month}`,      color: '#2D7D5A' },
                { label: 'Active (Paid)',   value: growthMetrics.paid.toString(),            color: '#0A4A6B' },
                { label: 'On Trial',        value: growthMetrics.trial.toString(),           color: '#D97706' },
                { label: 'Churned',         value: growthMetrics.churned.toString(),         color: growthMetrics.churned > 0 ? '#C0392B' : '#9CA3AF' },
              ].map((m, i, arr) => (
                <div key={m.label} style={i < arr.length - 1 ? { borderRight: '1px solid #E8E4DE' } : {}}>
                  <Metric label={m.label} value={m.value} color={m.color} />
                </div>
              ))}
            </div>
          </div>

          {/* Platform health */}
          <div style={{ ...card, overflow: 'hidden' }}>
            <div className="px-5 py-3" style={{ borderBottom: '1px solid #E8E4DE' }}>
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#9CA3AF' }}>Platform Usage (30 days)</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-x" style={{ divideColor: '#E8E4DE' }}>
              {[
                { label: 'Reviews Processed',   value: platformMetrics.reviews_30d.toString(),          icon: MessageSquare },
                { label: 'AI Replies Generated', value: platformMetrics.ai_replies_generated.toString(), icon: Zap },
                { label: 'WhatsApp Messages',    value: platformMetrics.whatsapp_messages.toString(),    icon: Smartphone },
                { label: 'Bad Reviews Intercepted', value: platformMetrics.review_gates.toString(),      icon: ShieldCheck },
              ].map((m, i, arr) => (
                <div key={m.label} style={i < arr.length - 1 ? { borderRight: '1px solid #E8E4DE' } : {}}>
                  <Metric label={m.label} value={m.value} icon={m.icon} />
                </div>
              ))}
            </div>
          </div>

          {/* Action Required */}
          {(actionRequired.urgentUnaddressed.length > 0 || actionRequired.inactive14d.length > 0) && (
            <div style={card}>
              <div className="px-5 py-3" style={{ borderBottom: '1px solid #E8E4DE' }}>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" style={{ color: '#C0392B' }} />
                  <p className="text-sm font-bold" style={{ color: '#12100E' }}>Action Required</p>
                </div>
              </div>
              <div className="p-5 space-y-3">
                {actionRequired.urgentUnaddressed.map(d => (
                  <div key={d.id} className="flex items-center justify-between p-3 rounded-xl"
                    style={{ backgroundColor: '#FEF2F2', border: '1px solid #FECACA' }}>
                    <div>
                      <p className="text-sm font-semibold" style={{ color: '#7F1D1D' }}>{d.clinic_name}</p>
                      <p className="text-xs mt-0.5" style={{ color: '#B91C1C' }}>
                        {d.urgent_unaddressed} urgent {d.urgent_unaddressed === 1 ? 'review' : 'reviews'} unanswered for 48h+
                      </p>
                    </div>
                    <PlanBadge plan={d.subscription_plan} />
                  </div>
                ))}
                {actionRequired.inactive14d.slice(0, 5).map(d => (
                  <div key={d.id} className="flex items-center justify-between p-3 rounded-xl"
                    style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE68A' }}>
                    <div>
                      <p className="text-sm font-semibold" style={{ color: '#78350F' }}>{d.clinic_name}</p>
                      <p className="text-xs mt-0.5" style={{ color: '#92400E' }}>
                        No reviews synced in 14+ days — possible churn risk
                      </p>
                    </div>
                    <PlanBadge plan={d.subscription_plan} />
                  </div>
                ))}
              </div>
            </div>
          )}

        </>)}

        {/* ── DOCTORS TAB ───────────────────────────────────────────────────── */}
        {tab === 'doctors' && (<>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#9CA3AF' }} />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, clinic, or email…"
              className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none"
              style={{ border: '1px solid #E8E4DE', backgroundColor: '#fff', color: '#374151', fontFamily: "'Plus Jakarta Sans', sans-serif" }} />
          </div>

          {/* Table */}
          <div style={card}>
            {/* Mobile: cards */}
            <div className="sm:hidden divide-y" style={{ divideColor: '#E8E4DE' }}>
              {filteredDoctors.map(d => (
                <div key={d.id} className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <p className="font-bold text-sm" style={{ color: '#12100E' }}>{d.clinic_name}</p>
                      <p className="text-xs" style={{ color: '#9CA3AF' }}>{d.name} · {d.email}</p>
                    </div>
                    <PlanBadge plan={d.subscription_plan} />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                      { v: d.total_reviews.toString(), l: 'Reviews' },
                      { v: d.avg_rating.toFixed(1) + '★', l: 'Avg Rating' },
                      { v: d.response_rate + '%', l: 'Response' },
                    ].map(m => (
                      <div key={m.l} className="p-2 rounded-lg" style={{ backgroundColor: '#F8F7F5' }}>
                        <p className="font-bold text-sm" style={{ color: '#12100E' }}>{m.v}</p>
                        <p className="text-[10px]" style={{ color: '#9CA3AF' }}>{m.l}</p>
                      </div>
                    ))}
                  </div>
                  {d.urgent_unaddressed > 0 && (
                    <p className="text-xs mt-2 font-semibold" style={{ color: '#C0392B' }}>
                      ⚠ {d.urgent_unaddressed} urgent reviews unaddressed 48h+
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: '1px solid #E8E4DE', backgroundColor: '#FAFAF8' }}>
                    {['Clinic / Doctor', 'Verified', 'Plan', 'Status', 'Reviews (30d)', 'Avg ★', 'Response', 'MRR', 'Last Review', ''].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-bold" style={{ color: '#64748b' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredDoctors.map(d => (<React.Fragment key={d.id}>
                    <tr
                      className="cursor-pointer"
                      style={{ borderBottom: '1px solid #F0ECE6' }}
                      onClick={() => setExpandedDoctor(expandedDoctor === d.id ? null : d.id)}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#FAFAF8')}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <td className="px-4 py-3">
                        <p className="font-semibold text-sm" style={{ color: '#12100E' }}>{d.clinic_name}</p>
                        <p className="text-xs" style={{ color: '#9CA3AF' }}>{d.name}</p>
                        {d.urgent_unaddressed > 0 && (
                          <p className="text-[10px] font-bold mt-0.5" style={{ color: '#C0392B' }}>
                            ⚠ {d.urgent_unaddressed} urgent 48h+
                          </p>
                        )}
                        {d.has_pending_payment && (
                          <p className="text-[10px] font-bold" style={{ color: '#D97706' }}>💰 Payment pending</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                          style={{
                            backgroundColor: d.is_valid ? '#E8F5F0' : '#FFFBEB',
                            color: d.is_valid ? '#2D7D5A' : '#B45309',
                          }}>
                          {d.is_valid ? 'Healthcare ✓' : 'Pending'}
                        </span>
                        {!d.plan_assigned && d.is_valid && (
                          <p className="text-[10px] mt-1 font-semibold" style={{ color: '#D97706' }}>No plan yet</p>
                        )}
                      </td>
                      <td className="px-4 py-3"><PlanBadge plan={d.subscription_plan} /></td>
                      <td className="px-4 py-3"><StatusBadge status={d.subscription_status} /></td>
                      <td className="px-4 py-3">
                        <span className="font-bold text-sm" style={{ color: '#12100E' }}>{d.reviews_30d}</span>
                        <span className="text-xs ml-1" style={{ color: '#9CA3AF' }}>/{d.total_reviews}</span>
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold" style={{ color: d.avg_rating >= 4 ? '#2D7D5A' : d.avg_rating >= 3 ? '#D97706' : '#C0392B' }}>
                        {d.avg_rating > 0 ? d.avg_rating.toFixed(1) : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm" style={{ color: '#374151' }}>{d.response_rate}%</td>
                      <td className="px-4 py-3 text-sm font-semibold" style={{ color: '#E8960C' }}>
                        {d.monthly_revenue > 0 ? `₹${Math.round(d.monthly_revenue).toLocaleString('en-IN')}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: '#9CA3AF' }}>
                        {d.last_review_date ? new Date(d.last_review_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'Never'}
                      </td>
                      <td className="px-4 py-3">
                        {expandedDoctor === d.id
                          ? <ChevronUp className="w-4 h-4" style={{ color: '#9CA3AF' }} />
                          : <ChevronDown className="w-4 h-4" style={{ color: '#9CA3AF' }} />}
                      </td>
                    </tr>

                    {/* Expanded row */}
                    {expandedDoctor === d.id && (
                      <tr style={{ backgroundColor: '#F8F7F5' }}>
                        <td colSpan={10} className="px-6 py-4">
                          <div className="flex items-start gap-6 flex-wrap">
                            <div>
                              <p className="text-xs font-bold mb-1" style={{ color: '#64748b' }}>EMAIL</p>
                              <p className="text-sm" style={{ color: '#374151' }}>{d.email}</p>
                            </div>
                            <div>
                              <p className="text-xs font-bold mb-1" style={{ color: '#64748b' }}>JOINED</p>
                              <p className="text-sm" style={{ color: '#374151' }}>
                                {new Date(d.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs font-bold mb-2" style={{ color: '#64748b' }}>HEALTHCARE VERIFICATION</p>
                              <div className="flex gap-1.5">
                                <button
                                  onClick={e => { e.stopPropagation(); updateDoctorHealthcareVerified(d.id, true); }}
                                  className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:opacity-80"
                                  style={{
                                    backgroundColor: d.is_valid ? '#2D7D5A' : '#fff',
                                    color: d.is_valid ? '#fff' : '#64748b',
                                    border: '1px solid #E8E4DE',
                                  }}
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={e => { e.stopPropagation(); updateDoctorHealthcareVerified(d.id, false); }}
                                  className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:opacity-80"
                                  style={{
                                    backgroundColor: !d.is_valid ? '#C0392B' : '#fff',
                                    color: !d.is_valid ? '#fff' : '#64748b',
                                    border: '1px solid #E8E4DE',
                                  }}
                                >
                                  Revoke
                                </button>
                              </div>
                            </div>
                            <div>
                              <p className="text-xs font-bold mb-2" style={{ color: '#64748b' }}>PLAN ACCESS</p>
                              <div className="flex gap-1.5">
                                <button
                                  onClick={e => { e.stopPropagation(); updateDoctorPlanAssigned(d.id, true); }}
                                  className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:opacity-80"
                                  style={{
                                    backgroundColor: d.plan_assigned ? '#0A4A6B' : '#fff',
                                    color: d.plan_assigned ? '#fff' : '#64748b',
                                    border: '1px solid #E8E4DE',
                                  }}
                                >
                                  Assigned
                                </button>
                                <button
                                  onClick={e => { e.stopPropagation(); updateDoctorPlanAssigned(d.id, false); }}
                                  className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:opacity-80"
                                  style={{
                                    backgroundColor: !d.plan_assigned ? '#64748b' : '#fff',
                                    color: !d.plan_assigned ? '#fff' : '#64748b',
                                    border: '1px solid #E8E4DE',
                                  }}
                                >
                                  Not assigned
                                </button>
                              </div>
                            </div>
                            <div>
                              <p className="text-xs font-bold mb-2" style={{ color: '#64748b' }}>CHANGE PLAN</p>
                              <div className="flex gap-1.5">
                                {['Solo', 'Clinic', 'Hospital'].map(p => (
                                  <button key={p} onClick={e => { e.stopPropagation(); updateDoctorPlan(d.id, p); }}
                                    className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:opacity-80"
                                    style={{
                                      backgroundColor: d.subscription_plan === p ? '#0A4A6B' : '#fff',
                                      color: d.subscription_plan === p ? '#fff' : '#64748b',
                                      border: '1px solid #E8E4DE',
                                    }}>
                                    {p}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div>
                              <p className="text-xs font-bold mb-2" style={{ color: '#64748b' }}>QUICK ACTIONS</p>
                              <button onClick={e => { e.stopPropagation(); setBillingForm({ doctor_id: d.id, plan: d.subscription_plan }); setEditingBilling(null); setTab('billing'); }}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold hover:opacity-80"
                                style={{ backgroundColor: '#E8960C', color: '#fff' }}>
                                <DollarSign className="w-3.5 h-3.5" /> Add Payment Record
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>))}
                </tbody>
              </table>
              {filteredDoctors.length === 0 && (
                <div className="py-12 text-center">
                  <p className="text-sm" style={{ color: '#9CA3AF' }}>No doctors match your search</p>
                </div>
              )}
            </div>
          </div>
        </>)}

        {/* ── BILLING TAB ───────────────────────────────────────────────────── */}
        {tab === 'billing' && (<>

          {/* Revenue summary */}
          <div style={{ ...card, overflow: 'hidden' }}>
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-x" style={{ divideColor: '#E8E4DE' }}>
              <div style={{ borderRight: '1px solid #E8E4DE' }}>
                <Metric label="MRR" value={`₹${Math.round(mrr).toLocaleString('en-IN')}`} color="#E8960C" />
              </div>
              <div style={{ borderRight: '1px solid #E8E4DE' }}>
                <Metric label="ARR" value={`₹${Math.round(mrr * 12).toLocaleString('en-IN')}`} color="#0A4A6B" />
              </div>
              <div style={{ borderRight: '1px solid #E8E4DE' }}>
                <Metric label="Pending" value={`₹${Math.round(pendingRevenue).toLocaleString('en-IN')}`}
                  color={pendingRevenue > 0 ? '#C0392B' : '#2D7D5A'} />
              </div>
              <div>
                <Metric label="Paid (30d)" value={`₹${Math.round(paidThisMonth).toLocaleString('en-IN')}`} color="#2D7D5A" />
              </div>
            </div>
          </div>

          {/* Status message */}
          {billingMsg && (
            <div className="px-4 py-3 rounded-xl text-sm font-medium"
              style={{
                backgroundColor: billingMsg.type === 'ok' ? '#F0F9F4' : '#FEF2F2',
                border: `1px solid ${billingMsg.type === 'ok' ? '#C6E8D9' : '#FECACA'}`,
                color: billingMsg.type === 'ok' ? '#2D7D5A' : '#C0392B',
              }}>
              {billingMsg.text}
            </div>
          )}

          {/* Pending payments */}
          {pendingBilling.length > 0 && (
            <div style={card}>
              <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid #E8E4DE' }}>
                <p className="text-sm font-bold" style={{ color: '#C0392B' }}>
                  Pending Payments ({pendingBilling.length})
                </p>
                <p className="text-xs" style={{ color: '#9CA3AF' }}>Sorted oldest first</p>
              </div>
              <div className="divide-y" style={{ divideColor: '#F0ECE6' }}>
                {pendingBilling.map(b => {
                  const daysOld = Math.floor((now.getTime() - new Date(b.created_at).getTime()) / 86400000);
                  return (
                    <div key={b.id} className="px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="font-semibold text-sm truncate" style={{ color: '#12100E' }}>{b.clinic_name}</p>
                          <PlanBadge plan={b.plan} />
                          {daysOld > 7 && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                              style={{ backgroundColor: '#FEF2F2', color: '#C0392B' }}>
                              {daysOld}d overdue
                            </span>
                          )}
                        </div>
                        <p className="text-xs" style={{ color: '#9CA3AF' }}>
                          ₹{b.amount.toLocaleString('en-IN')} · {b.billing_cycle} · {b.payment_method.replace('_', ' ')}
                          {b.notes && ` · ${b.notes}`}
                        </p>
                      </div>
                      <button onClick={() => markPaid(b.id)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold hover:opacity-90 transition-opacity flex-shrink-0"
                        style={{ backgroundColor: '#2D7D5A', color: '#fff' }}>
                        <Check className="w-3.5 h-3.5" /> Mark Paid
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Add / Edit record form */}
          <div style={card}>
            <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid #E8E4DE' }}>
              <p className="text-sm font-bold" style={{ color: '#12100E' }}>
                {billingForm ? (editingBilling ? 'Edit Record' : 'Add Record') : 'All Billing Records'}
              </p>
              {!billingForm
                ? <button onClick={() => { setBillingForm({}); setEditingBilling(null); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold hover:opacity-90"
                    style={{ backgroundColor: '#0A4A6B', color: '#fff' }}>
                    <Plus className="w-3.5 h-3.5" /> Add Record
                  </button>
                : <button onClick={() => { setBillingForm(null); setEditingBilling(null); }}>
                    <X className="w-4 h-4" style={{ color: '#9CA3AF' }} />
                  </button>}
            </div>

            {billingForm && (
              <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold mb-1.5 uppercase tracking-wider" style={{ color: '#64748b' }}>Doctor *</label>
                  <select className={inp} style={inpStyle} value={billingForm.doctor_id || ''}
                    onChange={e => setBillingForm({ ...billingForm, doctor_id: e.target.value })}>
                    <option value="">Select doctor</option>
                    {doctors.map(d => <option key={d.id} value={d.id}>{d.clinic_name} — {d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1.5 uppercase tracking-wider" style={{ color: '#64748b' }}>Amount (₹) *</label>
                  <input type="number" className={inp} style={inpStyle} value={billingForm.amount || ''}
                    onChange={e => setBillingForm({ ...billingForm, amount: parseFloat(e.target.value) })} placeholder="1499" />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1.5 uppercase tracking-wider" style={{ color: '#64748b' }}>Plan</label>
                  <select className={inp} style={inpStyle} value={billingForm.plan || 'Clinic'}
                    onChange={e => setBillingForm({ ...billingForm, plan: e.target.value })}>
                    <option>Solo</option><option>Clinic</option><option>Hospital</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1.5 uppercase tracking-wider" style={{ color: '#64748b' }}>Billing Cycle</label>
                  <select className={inp} style={inpStyle} value={billingForm.billing_cycle || 'monthly'}
                    onChange={e => setBillingForm({ ...billingForm, billing_cycle: e.target.value })}>
                    <option value="monthly">Monthly</option><option value="yearly">Yearly</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1.5 uppercase tracking-wider" style={{ color: '#64748b' }}>Payment Status</label>
                  <select className={inp} style={inpStyle} value={billingForm.payment_status || 'pending'}
                    onChange={e => setBillingForm({ ...billingForm, payment_status: e.target.value as any })}>
                    <option value="pending">Pending</option><option value="paid">Paid</option>
                    <option value="failed">Failed</option><option value="refunded">Refunded</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1.5 uppercase tracking-wider" style={{ color: '#64748b' }}>Payment Method</label>
                  <select className={inp} style={inpStyle} value={billingForm.payment_method || 'bank_transfer'}
                    onChange={e => setBillingForm({ ...billingForm, payment_method: e.target.value })}>
                    <option value="bank_transfer">Bank Transfer</option><option value="upi">UPI</option>
                    <option value="razorpay">Razorpay</option><option value="cash">Cash</option><option value="cheque">Cheque</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1.5 uppercase tracking-wider" style={{ color: '#64748b' }}>Payment Date</label>
                  <input type="date" className={inp} style={inpStyle} value={billingForm.payment_date || ''}
                    onChange={e => setBillingForm({ ...billingForm, payment_date: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1.5 uppercase tracking-wider" style={{ color: '#64748b' }}>Transaction ID</label>
                  <input type="text" className={inp} style={inpStyle} value={billingForm.transaction_id || ''}
                    onChange={e => setBillingForm({ ...billingForm, transaction_id: e.target.value })} placeholder="Optional" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold mb-1.5 uppercase tracking-wider" style={{ color: '#64748b' }}>Notes</label>
                  <input type="text" className={inp} style={inpStyle} value={billingForm.notes || ''}
                    onChange={e => setBillingForm({ ...billingForm, notes: e.target.value })} placeholder="Optional" />
                </div>
                <div className="sm:col-span-2 flex gap-3">
                  <button onClick={saveBillingRecord} disabled={savingBilling}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold hover:opacity-90 disabled:opacity-40"
                    style={{ backgroundColor: '#0A4A6B', color: '#fff' }}>
                    {savingBilling ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {editingBilling ? 'Update' : 'Save Record'}
                  </button>
                  <button onClick={() => { setBillingForm(null); setEditingBilling(null); }}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold hover:opacity-70"
                    style={{ border: '1px solid #E8E4DE', color: '#9CA3AF' }}>Cancel</button>
                </div>
              </div>
            )}

            {!billingForm && (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr style={{ borderBottom: '1px solid #E8E4DE', backgroundColor: '#FAFAF8' }}>
                      {['Clinic','Plan','Amount','Cycle','Date','Status','Method','Actions'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-bold" style={{ color: '#64748b' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {billing.map(b => (
                      <tr key={b.id} style={{ borderBottom: '1px solid #F0ECE6' }}>
                        <td className="px-4 py-3">
                          <p className="text-sm font-semibold" style={{ color: '#12100E' }}>{b.clinic_name}</p>
                          <p className="text-xs" style={{ color: '#9CA3AF' }}>{b.doctor_name}</p>
                        </td>
                        <td className="px-4 py-3"><PlanBadge plan={b.plan} /></td>
                        <td className="px-4 py-3 text-sm font-bold" style={{ color: '#E8960C' }}>
                          ₹{b.amount.toLocaleString('en-IN')}
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: '#64748b' }}>{b.billing_cycle}</td>
                        <td className="px-4 py-3 text-xs" style={{ color: '#9CA3AF' }}>
                          {b.payment_date ? new Date(b.payment_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{
                            backgroundColor:
                              b.payment_status === 'paid'     ? '#F0F9F4' :
                              b.payment_status === 'pending'  ? '#FFFBEB' :
                              b.payment_status === 'refunded' ? '#EEF4FB' : '#FEF2F2',
                            color:
                              b.payment_status === 'paid'     ? '#2D7D5A' :
                              b.payment_status === 'pending'  ? '#B45309' :
                              b.payment_status === 'refunded' ? '#0A4A6B' : '#C0392B',
                          }}>{b.payment_status}</span>
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: '#64748b' }}>
                          {b.payment_method.replace('_', ' ')}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {b.payment_status === 'pending' && (
                              <button onClick={() => markPaid(b.id)}
                                className="p-1.5 rounded-lg hover:opacity-80" title="Mark paid"
                                style={{ backgroundColor: '#F0F9F4', color: '#2D7D5A' }}>
                                <Check className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button onClick={() => { setEditingBilling(b.id); setBillingForm(b); }}
                              className="p-1.5 rounded-lg hover:opacity-80"
                              style={{ backgroundColor: '#EEF4FB', color: '#0A4A6B' }}>
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => deleteBilling(b.id)}
                              className="p-1.5 rounded-lg hover:opacity-80"
                              style={{ backgroundColor: '#FEF2F2', color: '#C0392B' }}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {billing.length === 0 && (
                  <div className="py-12 text-center">
                    <p className="text-sm" style={{ color: '#9CA3AF' }}>No billing records yet</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </>)}

        {/* ── FUNNEL TAB ────────────────────────────────────────────────────── */}
        {tab === 'funnel' && (<>
          {funnelMetrics ? (
            <>
              <div style={{ ...card, overflow: 'hidden' }}>
                <div className="px-5 py-3" style={{ borderBottom: '1px solid #E8E4DE' }}>
                  <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#9CA3AF' }}>Conversion Funnel (Last 30 days)</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 divide-x" style={{ divideColor: '#E8E4DE' }}>
                  {[
                    { label: 'Try-Out Clicks',    value: funnelMetrics.try_out_clicks || 0 },
                    { label: 'Signup Attempts',   value: funnelMetrics.signup_attempts || 0 },
                    { label: 'Signups Completed', value: funnelMetrics.signup_successes || 0 },
                    { label: 'Conversion Rate',   value: `${parseFloat(funnelMetrics.conversion_rate || '0').toFixed(1)}%` },
                  ].map((m, i, arr) => (
                    <div key={m.label} style={i < arr.length - 1 ? { borderRight: '1px solid #E8E4DE' } : {}}>
                      <Metric label={m.label} value={m.value.toString()} color="#0A4A6B" />
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {[
                  { title: 'Failed Signups', data: failedSignups },
                  { title: 'Failed Logins',  data: failedLogins  },
                ].map(({ title, data }) => (
                  <div key={title} style={card}>
                    <div className="px-5 py-3" style={{ borderBottom: '1px solid #E8E4DE' }}>
                      <p className="text-sm font-bold" style={{ color: '#12100E' }}>{title} ({data.length})</p>
                    </div>
                    {data.length === 0 ? (
                      <p className="text-sm text-center py-8" style={{ color: '#9CA3AF' }}>None recorded</p>
                    ) : (
                      <div className="divide-y overflow-y-auto" style={{ divideColor: '#F0ECE6', maxHeight: '280px' }}>
                        {data.map((f: any, i: number) => (
                          <div key={i} className="px-4 py-3">
                            <p className="text-sm font-medium truncate" style={{ color: '#374151' }}>{f.email}</p>
                            <p className="text-xs mt-0.5 truncate" style={{ color: '#9CA3AF' }}>{f.error}</p>
                            <p className="text-[10px] mt-0.5" style={{ color: '#C4C4C4' }}>
                              {new Date(f.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ ...card, padding: '48px', textAlign: 'center' }}>
              <p className="text-sm" style={{ color: '#9CA3AF' }}>
                Funnel data unavailable. Make sure the <code>get_funnel_metrics</code> function is deployed in Supabase.
              </p>
            </div>
          )}
        </>)}

        {/* ── ENQUIRIES TAB ─────────────────────────────────────────────────── */}
        {tab === 'enquiries' && (<>
          <div style={card} className="overflow-hidden">
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: '#E8E4DE' }}>
              <div>
                <h2 className="font-bold text-base" style={{ color: '#12100E' }}>Contact Enquiries</h2>
                <p className="text-xs mt-0.5" style={{ color: '#9CA3AF' }}>
                  {contactSubmissions.length} total · {contactSubmissions.filter(s => s.status === 'new').length} new
                </p>
              </div>
            </div>

            {contactSubmissions.length === 0 ? (
              <div className="py-16 text-center" style={{ color: '#9CA3AF' }}>
                <p className="text-sm">No enquiries yet.</p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: '#F0EDE6' }}>
                {contactSubmissions.map(s => (
                  <div key={s.id} className="px-5 py-4" style={{ backgroundColor: s.status === 'new' ? 'rgba(10,74,107,0.02)' : '#fff' }}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-semibold text-sm" style={{ color: '#12100E' }}>{s.name}</span>
                          {s.clinic && <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#F0EDE6', color: '#64748b' }}>{s.clinic}</span>}
                          <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                            style={{
                              backgroundColor: s.status === 'new' ? 'rgba(10,74,107,0.1)' : s.status === 'replied' ? '#F0F9F4' : '#F8F7F5',
                              color: s.status === 'new' ? '#0A4A6B' : s.status === 'replied' ? '#2D7D5A' : '#64748b',
                            }}>
                            {s.status}
                          </span>
                        </div>
                        <a href={`mailto:${s.email}`} className="text-xs hover:underline" style={{ color: '#0A4A6B' }}>{s.email}</a>
                        <p className="text-sm mt-2 leading-relaxed" style={{ color: '#374151' }}>{s.message}</p>
                        <p className="text-xs mt-2" style={{ color: '#9CA3AF' }}>
                          {new Date(s.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      <div className="flex flex-col gap-1.5 flex-shrink-0">
                        {(['new', 'read', 'replied'] as const).map(status => (
                          <button
                            key={status}
                            disabled={s.status === status || updatingContact === s.id}
                            onClick={() => handleContactStatus(s.id, status)}
                            className="text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-opacity capitalize"
                            style={{
                              backgroundColor: s.status === status ? '#0A4A6B' : '#F0EDE6',
                              color: s.status === status ? '#fff' : '#64748b',
                              opacity: updatingContact === s.id ? 0.5 : 1,
                            }}>
                            {status}
                          </button>
                        ))}
                        <a
                          href={`mailto:${s.email}?subject=Re: Your CrestWard Enquiry`}
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg text-center transition-opacity"
                          style={{ backgroundColor: '#F0F9F4', color: '#2D7D5A' }}>
                          Reply ↗
                        </a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>)}

      </div>
    </div>
  );
};

export default AdminDashboard;
