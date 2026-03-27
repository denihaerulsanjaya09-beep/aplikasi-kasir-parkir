import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, CheckCircle2, LogOut, Settings, 
  MapPin, Clock, FileText, Search, Car, Truck, Bike, Download, Share2,
  ChevronDown, Bluetooth, Users, Monitor, ShieldCheck, FileImage,
  UploadCloud, AlertTriangle, X, Lock, Trash2, Database,
  ArrowRight, ArrowLeft, Building, Printer
} from 'lucide-react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, onSnapshot } from 'firebase/firestore';

// --- BUG FIX: Mencegah error "tailwind is not defined" dari environment ---
if (typeof window !== 'undefined') {
  window.tailwind = window.tailwind || {};
  window.tailwind.config = window.tailwind.config || {};
}

// --- HELPER FUNCTION: Image Processing/Compression ---
const processImageFile = (file, callback) => {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX_WIDTH = 300; 
      const scale = Math.min(1, MAX_WIDTH / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      callback(canvas.toDataURL('image/jpeg', 0.4));
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
};

// --- HELPER FUNCTION: Direct Bluetooth Print (RawBT / ESC-POS) ---
const printDirectBluetooth = (type, data, settings) => {
    const center = (str) => {
        const spaces = Math.max(0, Math.floor((32 - str.length) / 2));
        return ' '.repeat(spaces) + str;
    };
    const right = (lbl, val) => {
        const spaces = Math.max(0, 32 - lbl.length - val.length);
        return lbl + ' '.repeat(spaces) + val;
    };

    const loc = data.lokasi || '';
    const nip = data.kasirMasuk || data.kasirKeluar || '';
    const nopol = data.nopol || '';
    const jenis = data.jenis || '';
    const divider = '-'.repeat(32);

    const ticketTitle = settings?.ticket?.title || "Sistem Device Portable";
    const ticketSubtitle = settings?.ticket?.subtitle || "";

    let text = '';
    text += center(ticketTitle) + '\n';
    if (ticketSubtitle) text += center(ticketSubtitle) + '\n';
    text += center(loc) + '\n';
    text += divider + '\n';
    
    if (type === 'IN') {
        text += center("TIKET MASUK") + '\n';
        text += divider + '\n';
        text += `NOPOL : ${nopol}\n`;
        text += `JENIS : ${jenis}\n`;
        text += `MASUK : ${data.waktuMasuk.toLocaleString('id-ID')}\n`;
        text += `KASIR : ${nip}\n`;
        text += divider + '\n';
        text += center(settings?.ticket?.footerIn || "SIMPAN TIKET INI") + '\n';
    } else {
        text += center("STRUK KELUAR") + '\n';
        text += divider + '\n';
        text += `NOPOL : ${nopol}\n`;
        text += `JENIS : ${jenis} ${data.tiketHilang ? '(HILANG)' : ''}\n`;
        text += `MASUK : ${data.waktuMasuk.toLocaleTimeString('id-ID')}\n`;
        text += `KELUAR: ${data.waktuKeluar.toLocaleTimeString('id-ID')}\n`;
        text += `DURASI: ${data.durasiText}\n`;
        text += divider + '\n';
        text += right("TOTAL:", `Rp ${data.totalBiaya.toLocaleString('id-ID')}`) + '\n';
        text += divider + '\n';
        text += center(settings?.ticket?.footerOut || "TERIMA KASIH") + '\n';
    }
    text += '\n\n';

    const intentUrl = `intent:${encodeURI(text)}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = intentUrl;
    document.body.appendChild(iframe);
    
    setTimeout(() => {
        if (document.body.contains(iframe)) document.body.removeChild(iframe);
    }, 2000);
};

// --- CONSTANTS & DEFAULT DATA ---
const PURE_LOCATIONS = ['ST. Cimahi Selatan', 'ST. Gadobangkong', 'ST. Cianjur', 'ST. Cibatu'];
const LOCATIONS = [...PURE_LOCATIONS, 'All Lokasi'];

const DEFAULT_LOCATION_SETTINGS = {
  tariffs: {
    'Motor': { mode: 'progressif', first: 2000, firstDuration: 1, next: 2000, max: 8000, inap: 10000, gracePeriodActive: false, gracePeriodMinutes: 10 },
    'Mobil': { mode: 'progressif', first: 3000, firstDuration: 1, next: 3000, max: 15000, inap: 20000, gracePeriodActive: false, gracePeriodMinutes: 10 },
    'Box/Truck': { mode: 'progressif', first: 5000, firstDuration: 1, next: 5000, max: 25000, inap: 25000, gracePeriodActive: false, gracePeriodMinutes: 10 },
    'Sepeda/Becak': { mode: 'flat', first: 1000, firstDuration: 1, next: 0, max: 1000, inap: 0, gracePeriodActive: false, gracePeriodMinutes: 0 }
  },
  shifts: [
    { id: 'pagi', name: 'Shift Pagi', start: '06:00', end: '13:59' },
    { id: 'siang', name: 'Shift Siang', start: '14:00', end: '21:59' },
    { id: 'malam', name: 'Shift Malam', start: '22:00', end: '05:59' }
  ]
};

const DEFAULT_SETTINGS = {
  web: {
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Check_green_icon.svg/1200px-Check_green_icon.svg.png',
    runningText: 'Selamat Datang di Sistem Parkir Terpadu - Utamakan Pelayanan yang Ramah dan Senyum kepada Pelanggan.',
    printerConnected: false,
    appVersion: 'v.1.3.26'
  },
  ticket: {
    title: 'Sistem Device Portable',
    subtitle: '',
    footerIn: 'SIMPAN TIKET INI',
    footerOut: 'TERIMA KASIH',
    logoUrl: ''
  },
  members: [],
  activeLogins: {},
  users: [
    { id: 'u1', nipp: '200041', nama: 'Petugas Master', role: 'master', password: 'R3gional2BD!', canViewArea: true },
    { id: 'u2', nipp: 'audit', nama: 'Petugas Audit', role: 'audit', password: 'Rmu123456', canViewArea: true },
    { id: 'u3', nipp: 'korlap', nama: 'Petugas Korlap', role: 'korlap', password: 'korlap123Rmu', canViewArea: true },
    { id: 'u4', nipp: 'Kasier Pagi', nama: 'Kasir Pagi', role: 'kasir', password: '123', canViewArea: true },
    { id: 'u5', nipp: 'Kasir Siang', nama: 'Kasir Siang', role: 'kasir', password: '123', canViewArea: true },
    { id: 'u6', nipp: 'Kasir Malam', nama: 'Kasir Malam', role: 'kasir', password: '123', canViewArea: true }
  ],
  locations: PURE_LOCATIONS.reduce((acc, loc) => ({ ...acc, [loc]: JSON.parse(JSON.stringify(DEFAULT_LOCATION_SETTINGS)) }), {})
};

const getLocSettings = (settings, locName) => {
  if (locName === 'All Lokasi') locName = PURE_LOCATIONS[0];
  if (settings.locations && settings.locations[locName]) return settings.locations[locName];
  if (settings.tariffs && settings.shifts) return { tariffs: settings.tariffs, shifts: settings.shifts }; 
  return DEFAULT_LOCATION_SETTINGS;
};

const getActiveShift = (shifts) => {
  const now = new Date();
  const currentTotalM = now.getHours() * 60 + now.getMinutes();

  for (const s of shifts) {
     const [startH, startM] = s.start.split(':').map(Number);
     const [endH, endM] = s.end.split(':').map(Number);
     const startTotal = startH * 60 + startM;
     const endTotal = endH * 60 + endM;

     if (startTotal <= endTotal) {
        if (currentTotalM >= startTotal && currentTotalM <= endTotal) return s.name;
     } else {
        if (currentTotalM >= startTotal || currentTotalM <= endTotal) return s.name;
     }
  }
  return 'Shift Tidak Diketahui';
};

// --- FIREBASE INITIALIZATION ---
const MY_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDdY7ZlT8NqWf7aPckiIQIvOsjFaBsOcK4",
  authDomain: "aplikasi-parkir-ku.firebaseapp.com",
  projectId: "aplikasi-parkir-ku",
  storageBucket: "aplikasi-parkir-ku.firebasestorage.app",
  messagingSenderId: "80401749338",
  appId: "1:80401749338:web:87b4418d98e86a1d3d0f63"
};

const fbConfig = (typeof __firebase_config !== 'undefined' && __firebase_config) ? JSON.parse(__firebase_config) : MY_FIREBASE_CONFIG;
const app = !getApps().length ? initializeApp(fbConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const appId = (typeof __app_id !== 'undefined' && __app_id) ? __app_id : MY_FIREBASE_CONFIG.projectId;

// --- UI COMPONENTS ---
const Toast = ({ message, type }) => (
  <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[200] px-6 py-3 rounded-full text-white font-bold shadow-2xl transition-all animate-in slide-in-from-top-4 flex items-center gap-2 ${type === 'error' ? 'bg-red-600' : 'bg-teal-600'}`}>
    {type === 'error' ? <AlertTriangle size={18}/> : <CheckCircle2 size={18}/>}
    {message}
  </div>
);

const ConfirmModal = ({ title, message, onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-[150] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
    <div className="bg-[#114022] border border-[#1b5e35] p-6 rounded-2xl max-w-sm w-full shadow-2xl text-center">
      <AlertTriangle size={40} className="mx-auto text-amber-500 mb-4" />
      <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
      <p className="text-sm text-green-200/70 mb-6">{message}</p>
      <div className="flex gap-3">
        <button onClick={onCancel} className="flex-1 py-3 rounded-xl bg-[#092613] text-white hover:bg-black/30 font-bold transition-colors">Batal</button>
        <button onClick={onConfirm} className="flex-1 py-3 rounded-xl bg-red-600 text-white hover:bg-red-500 font-bold transition-colors">Ya, Lanjutkan</button>
      </div>
    </div>
  </div>
);

const CameraModal = ({ facingMode, onCapture, onClose, title }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const startCamera = async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("Kamera tidak didukung.");
        }
        const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facingMode } });
        if (videoRef.current) videoRef.current.srcObject = mediaStream;
        setStream(mediaStream);
      } catch (err) {
        setError(err.message || "Gagal mengakses kamera. Izin diblokir.");
      }
    };
    startCamera();
    return () => { if (stream) stream.getTracks().forEach(track => track.stop()); };
  }, [facingMode]);

  const handleCapture = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const MAX_WIDTH = 300; 
      const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
      canvas.width = video.videoWidth * scale;
      canvas.height = video.videoHeight * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      onCapture(canvas.toDataURL('image/jpeg', 0.4)); 
      if (stream) stream.getTracks().forEach(track => track.stop());
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-md">
      <div className="bg-[#114022] p-6 rounded-[2rem] border border-[#1b5e35] shadow-2xl flex flex-col items-center max-w-md w-full mx-4">
        <h3 className="text-xl font-bold text-white mb-4">{title}</h3>
        {error ? (
           <div className="w-full aspect-video bg-red-900/20 border border-red-500/50 rounded-3xl flex flex-col items-center justify-center text-red-400 p-4 text-center mb-6">
             <AlertTriangle size={32} className="mb-2"/>
             <p className="text-sm font-bold">{error}</p>
             <p className="text-xs mt-1 opacity-80">Anda bisa melewati ini (Batal) untuk testing jika kamera diblokir sistem.</p>
           </div>
        ) : (
           <div className="relative rounded-3xl overflow-hidden w-full aspect-video bg-black mb-6 border border-[#1b5e35]">
             <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'scaleX(1)' }} />
             <canvas ref={canvasRef} className="hidden" />
           </div>
        )}
        <div className="flex gap-4 w-full">
          <button onClick={onClose} className="flex-1 py-4 rounded-2xl bg-[#092613] text-white font-bold hover:bg-black/20 transition-all">Batal</button>
          {!error && <button onClick={handleCapture} className="flex-1 py-4 rounded-2xl bg-teal-600 text-white font-bold hover:bg-teal-500 transition-all shadow-lg flex justify-center gap-2"><Camera size={20} /> Ambil Foto</button>}
        </div>
      </div>
    </div>
  );
};

// --- COMPONENT: TICKET PREVIEW (SOP KONTROL) ---
const TicketPreviewModal = ({ type, data, settings, onClose }) => {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in zoom-in-95">
      <div className="bg-[#114022] p-6 rounded-[2rem] border border-[#1b5e35] shadow-2xl flex flex-col items-center max-w-sm w-full relative">
        <div className="absolute -top-5 bg-teal-500 text-white px-4 py-1 rounded-full text-xs font-bold shadow-lg flex items-center gap-2">
          <CheckCircle2 size={14}/> Tercetak Otomatis
        </div>
        
        <h3 className="text-white font-bold mb-4 flex items-center gap-2">
          <FileText className="text-teal-400"/> SOP Preview Karcis
        </h3>

        {/* Simulasi Kertas Karcis Thermal */}
        <div className="bg-white text-black font-mono w-full p-4 rounded shadow-inner text-sm leading-snug relative overflow-hidden">
           <div className="relative text-center font-bold mb-2 min-h-[36px]">
              <p>{settings?.ticket?.title || 'Sistem Device Portable'}</p>
              {settings?.ticket?.subtitle && <p className="text-[10px] leading-tight mt-0.5">{settings.ticket.subtitle}</p>}
              <p className="text-xs mt-1">{data.lokasi}</p>
              {settings?.ticket?.logoUrl && (
                 <img src={settings.ticket.logoUrl} alt="Logo" className="absolute -top-1 -right-1 h-9 w-9 object-contain grayscale mix-blend-multiply" />
              )}
           </div>
           <div className="border-b-2 border-dashed border-black/50 mb-2"></div>
           <div className="text-center font-bold mb-2">{type === 'IN' ? 'TIKET MASUK' : 'STRUK KELUAR'}</div>
           <div className="border-b-2 border-dashed border-black/50 mb-2"></div>
           
           <div className="flex justify-between mb-1"><span>NOPOL:</span><span className="font-bold">{data.nopol}</span></div>
           <div className="flex justify-between mb-1"><span>JENIS:</span><span>{data.jenis}</span></div>
           <div className="flex justify-between mb-1"><span>MASUK:</span><span>{data.waktuMasuk.toLocaleString('id-ID')}</span></div>
           
           {type === 'OUT' && (
              <>
                <div className="flex justify-between mb-1"><span>KELUAR:</span><span>{data.waktuKeluar.toLocaleTimeString('id-ID')}</span></div>
                <div className="flex justify-between mb-1"><span>DURASI:</span><span>{data.durasiText}</span></div>
                {data.tiketHilang && <div className="text-center text-xs mt-1">*Termasuk Denda Kehilangan</div>}
                <div className="border-b-2 border-dashed border-black/50 my-2"></div>
                <div className="flex justify-between font-black text-base"><span>TOTAL:</span><span>Rp {data.totalBiaya?.toLocaleString('id-ID')}</span></div>
              </>
           )}
           
           {type === 'IN' && (
              <div className="flex justify-between mt-1 text-xs"><span>KASIR:</span><span>{data.kasirMasuk}</span></div>
           )}

           <div className="border-b-2 border-dashed border-black/50 my-2"></div>
           <div className="text-center text-xs mt-2 font-bold">{type === 'IN' ? (settings?.ticket?.footerIn || 'SIMPAN TIKET INI') : (settings?.ticket?.footerOut || 'TERIMA KASIH')}</div>
           
           {/* Zig-zag bottom edge effect */}
           <div className="absolute bottom-0 left-0 w-full h-2 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPjxwb2x5Z29uIHBvaW50cz0iMCw4IDQsMCA4LDgiIGZpbGw9IiMxMTQwMjIiLz48L3N2Zz4=')] bg-repeat-x"></div>
        </div>

        <p className="text-[10px] text-green-200/50 mt-4 text-center">Data telah tersimpan dan perintah cetak telah dikirim ke printer bluetooth.</p>

        <div className="flex gap-3 mt-4 w-full">
           <button onClick={() => { printDirectBluetooth(type, data, settings); showToast("Mengirim ulang perintah cetak..."); }} className="py-3 px-4 rounded-xl bg-[#092613] border border-[#1b5e35] text-white hover:bg-[#164d2b] transition-all flex justify-center items-center gap-2">
             <Printer size={16}/> Print Ulang
           </button>
           <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-teal-600 text-white font-bold hover:bg-teal-500 transition-all shadow-lg">
             Tutup (Lanjut)
           </button>
        </div>
      </div>
    </div>
  );
};

// --- MAIN APP COMPONENT ---
export default function App() {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [transactions, setTransactions] = useState([]);
  const [fbUser, setFbUser] = useState(null);
  
  const [activeTab, setActiveTab] = useState('masuk');
  const [shiftData, setShiftData] = useState({ current: 'Loading...', showSummary: false });

  const [toast, setToast] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [ticketPreview, setTicketPreview] = useState(null);
  
  const [deviceId] = useState(() => {
    let id = localStorage.getItem('device_session_id');
    if (!id) { id = Math.random().toString(36).substr(2, 9); localStorage.setItem('device_session_id', id); }
    return id;
  });

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) await signInWithCustomToken(auth, __initial_auth_token);
        else await signInAnonymously(auth);
      } catch (error) { console.error("Firebase Auth Error:", error); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setFbUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!fbUser) return;
    try {
      const txRef = collection(db, 'artifacts', appId, 'public', 'data', 'transactions');
      const unsubTx = onSnapshot(txRef, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const parsedData = data.map(t => ({
          ...t, waktuMasuk: t.waktuMasuk ? new Date(t.waktuMasuk) : new Date(), waktuKeluar: t.waktuKeluar ? new Date(t.waktuKeluar) : null
        }));
        setTransactions(parsedData);
      }, (err) => console.error("Error tx:", err));

      const settingsRef = collection(db, 'artifacts', appId, 'public', 'data', 'settings');
      const unsubSettings = onSnapshot(settingsRef, (snapshot) => {
         if (!snapshot.empty) {
            const globalSettings = snapshot.docs.find(d => d.id === 'global');
            if (globalSettings) {
               const loadedSettings = globalSettings.data();
               setSettings({ ...DEFAULT_SETTINGS, ...loadedSettings });
            }
         } else {
            setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'global'), DEFAULT_SETTINGS);
         }
      }, (err) => console.error("Error settings:", err));

      return () => { unsubTx(); unsubSettings(); };
    } catch(e) { console.error(e); }
  }, [fbUser]);

  const handleAddTransaction = async (newTx) => {
    if (!fbUser) return;
    await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'transactions', newTx.id), { ...newTx, waktuMasuk: newTx.waktuMasuk.toISOString(), waktuKeluar: null });
  };

  const handleUpdateTransaction = async (id, updateData) => {
    if (!fbUser) return;
    const txToUpdate = { ...updateData };
    if (txToUpdate.waktuKeluar) txToUpdate.waktuKeluar = txToUpdate.waktuKeluar.toISOString();
    await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'transactions', id), txToUpdate, { merge: true });
  };

  const handleUpdateSettings = async (newSettings) => {
    if (!fbUser) return;
    await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'global'), newSettings);
  };

  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      const userLocShifts = getLocSettings(settings, user.lokasi).shifts;
      const active = getActiveShift(userLocShifts);
      if (active !== shiftData.current) setShiftData({ current: active, showSummary: true });

      const activeLogins = settings.activeLogins || {};
      if (activeLogins[user.nipp]?.deviceId === deviceId) {
         handleUpdateSettings({
            ...settings, 
            activeLogins: { ...activeLogins, [user.nipp]: { ...activeLogins[user.nipp], timestamp: Date.now() } }
         });
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [user, shiftData.current, settings, deviceId]);

  const handleLogout = () => { 
    if(user){
       const userLocShifts = getLocSettings(settings, user.lokasi).shifts;
       setShiftData({ current: getActiveShift(userLocShifts), showSummary: false }); 
       
       const activeLogins = settings.activeLogins || {};
       const newLogins = { ...activeLogins };
       delete newLogins[user.nipp];
       handleUpdateSettings({ ...settings, activeLogins: newLogins });
    }
    setUser(null); 
    setActiveTab('masuk'); 
  };

  if (!user) {
    return (
      <>
        {toast && <Toast message={toast.msg} type={toast.type} />}
        <LoginScreen 
            usersList={settings.users || DEFAULT_SETTINGS.users} 
            settings={settings}
            updateSettings={handleUpdateSettings}
            deviceId={deviceId}
            showToast={showToast}
            onLogin={(u) => { 
                setUser({ ...u, loginTime: new Date() }); 
                const userLocShifts = getLocSettings(settings, u.lokasi).shifts;
                setShiftData({ current: getActiveShift(userLocShifts), showSummary: false }); 
                if (u.role === 'audit') setActiveTab('settings');
            }} 
        />
      </>
    );
  }

  const hasSettingsAccess = ['master', 'korlap', 'audit'].includes(user.role);
  const canViewArea = user.role === 'master' || user.role === 'audit' || user.role === 'kasir' || (user.role === 'korlap' && user.canViewArea);
  const canTransact = user.role === 'master' || user.role === 'korlap' || user.role === 'kasir';
  const webSettings = settings.web || DEFAULT_SETTINGS.web;

  return (
    <div className="min-h-screen bg-[#092613] text-green-50 font-sans selection:bg-green-500 selection:text-white pb-28">
      {/* CSS KHUSUS PRINT Laporan Bersih, Padat & Tanpa Background Warnai */}
      <style>{`
        @media print {
          @page { margin: 15mm; }
          body { 
            background: white !important; 
            color: black !important;
          }
          
          /* Menyembunyikan elemen UI yang tidak perlu dicetak */
          #root > div > header,
          .fixed.bottom-6,
          .hide-on-print { 
            display: none !important; 
          }

          /* Memaksa elemen Laporan untuk mengambil alih halaman secara bersih */
          .print-a4-layout {
            display: block !important;
            background: white !important;
            color: black !important;
            width: 100% !important;
            box-shadow: none !important;
            border: none !important;
            padding: 0 !important;
            margin: 0 !important;
          }

          /* Styling Rapat untuk Tabel Laporan Master (Hemat Kertas) */
          .dense-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px !important;
            margin-top: 15px;
          }
          .dense-table tr { page-break-inside: avoid; page-break-after: auto; }
          .dense-table th, .dense-table td {
            border: 1px solid black !important;
            padding: 6px 8px !important;
            color: black !important;
            background-color: transparent !important;
          }
          .dense-table th { font-weight: bold; text-align: center; }

          /* Layout Khusus Laporan Kasir (Shift End) */
          .shift-report-print {
            width: 100%;
            font-family: 'Times New Roman', serif, sans-serif !important;
          }
          .shift-report-print h3 { font-size: 16pt !important; margin-bottom: 2px; text-align: center; font-weight: bold; }
          .shift-report-print p { font-size: 10pt !important; color: black !important; margin: 2px 0;}
          
          .print-border-black { border-color: black !important; border-width: 1px !important; }
          .print-text-black { color: black !important; }
          .print-bg-transparent { background-color: transparent !important; }
        }
      `}</style>

      {toast && <Toast message={toast.msg} type={toast.type} />}
      {confirmDialog && <ConfirmModal {...confirmDialog} />}
      
      {/* TICKET PREVIEW MODAL */}
      {ticketPreview && <TicketPreviewModal type={ticketPreview.type} data={ticketPreview.data} settings={settings} onClose={() => setTicketPreview(null)} />}

      {/* Header */}
      <header className="fixed top-0 w-full z-40 bg-[#0c331a]/90 backdrop-blur-xl border-b border-[#1b5e35] shadow-lg px-6 py-3 flex items-center justify-between hide-on-print">
        <div className="flex items-center gap-3 w-1/3">
          {user.photo ? (
            <img src={user.photo} alt="User" className="w-12 h-12 rounded-full object-cover border-2 border-green-500 shadow-sm bg-black" />
          ) : (
            <div className="w-12 h-12 rounded-full border-2 border-green-500 bg-black flex items-center justify-center text-white"><Users size={20}/></div>
          )}
          <div className="leading-tight">
            <p className="font-bold text-white text-sm flex items-center gap-1">
              {user.nama} {user.role === 'master' && <ShieldCheck size={14} className="text-green-500"/>}
            </p>
            <p className="text-xs text-green-200/70 font-medium flex items-center gap-1"><MapPin size={10} /> {user.lokasi} | {shiftData.current}</p>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center overflow-hidden">
          <img src={webSettings.logoUrl} alt="Logo" className="h-8 object-contain mb-1 bg-white/10 backdrop-blur-sm rounded-lg px-2" />
          <div className="w-full max-w-md overflow-hidden bg-black rounded-full px-4 py-1 border border-[#1b5e35]">
            <marquee className="text-xs text-red-500 font-bold tracking-widest">{webSettings.runningText}</marquee>
          </div>
        </div>
        <div className="w-1/3 flex justify-end gap-2">
          {canTransact && (
             <button onClick={() => setShiftData(prev => ({...prev, showSummary: true}))} className="p-2 bg-orange-500/20 text-orange-400 rounded-xl hover:bg-orange-500/30 transition-colors text-xs font-bold hidden md:flex items-center gap-1 border border-orange-500/20">
               <Clock size={14} /> Akhiri Shift
             </button>
          )}
          <button onClick={handleLogout} className="p-3 bg-red-600/20 text-red-400 rounded-xl hover:bg-red-600/30 transition-colors flex items-center gap-2 text-sm font-bold border border-red-600/20">
            <LogOut size={16} /> Keluar
          </button>
        </div>
      </header>

      <main className="pt-28 px-4 md:px-6 max-w-6xl mx-auto print-a4-layout">
        {canTransact && !['area', 'settings'].includes(activeTab) && (
          <div className="flex gap-4 mb-8 hide-on-print">
            <button onClick={() => setActiveTab('masuk')} className={`flex-1 py-6 md:py-8 rounded-[2rem] flex flex-col items-center justify-center gap-2 transition-all duration-300 shadow-xl border-2 ${activeTab === 'masuk' ? 'bg-green-600 border-green-400 text-white scale-[1.02]' : 'bg-[#114022] border-[#1b5e35] text-green-200/50 hover:bg-[#164d2b]'}`}>
              <ArrowRight size={40} />
              <span className="text-xl md:text-3xl font-black uppercase tracking-widest">Pintu Masuk</span>
            </button>
            <button onClick={() => setActiveTab('keluar')} className={`flex-1 py-6 md:py-8 rounded-[2rem] flex flex-col items-center justify-center gap-2 transition-all duration-300 shadow-xl border-2 ${activeTab === 'keluar' ? 'bg-teal-600 border-teal-400 text-white scale-[1.02]' : 'bg-[#114022] border-[#1b5e35] text-green-200/50 hover:bg-[#164d2b]'}`}>
              <ArrowLeft size={40} />
              <span className="text-xl md:text-3xl font-black uppercase tracking-widest">Pintu Keluar</span>
            </button>
          </div>
        )}

        {/* Routers */}
        {canTransact && activeTab === 'masuk' && <KendaraanMasuk user={user} addTransaction={handleAddTransaction} showToast={showToast} settings={settings} setTicketPreview={setTicketPreview} />}
        {canTransact && activeTab === 'keluar' && <KendaraanKeluar user={user} transactions={transactions} updateTransaction={handleUpdateTransaction} settings={settings} showToast={showToast} setTicketPreview={setTicketPreview} />}
        {canViewArea && activeTab === 'area' && <KendaraanArea transactions={transactions} user={user} />}
        {hasSettingsAccess && activeTab === 'settings' && <MasterSettings settings={settings} setSettings={handleUpdateSettings} user={user} transactions={transactions} updateTransaction={handleUpdateTransaction} showToast={showToast} setConfirmDialog={setConfirmDialog} />}
      </main>

      {/* Bottom Nav */}
      <div className="fixed bottom-6 w-full flex justify-center z-40 px-4 hide-on-print">
        <div className="bg-[#0c331a]/90 backdrop-blur-2xl p-2 rounded-[2rem] shadow-2xl border border-[#1b5e35] flex items-center gap-2">
          {canTransact && <NavButton active={['masuk', 'keluar'].includes(activeTab)} onClick={() => setActiveTab('masuk')} icon={<Car />} label="Transaksi" color="text-green-400" />}
          {canViewArea && <NavButton active={activeTab === 'area'} onClick={() => setActiveTab('area')} icon={<MapPin />} label="Area Parkir" color="text-teal-400" />}
          {hasSettingsAccess && <NavButton active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={<Settings />} label="Settings & Laporan" color="text-emerald-400" />}
        </div>
      </div>

      {shiftData.showSummary && <ShiftEndModal user={user} transactions={transactions} shiftName={shiftData.current} onClose={handleLogout} settings={settings} />}
    </div>
  );
}

// --- LOGIN COMPONENT DENGAN LOGIC MULTI-LOKASI ---
function LoginScreen({ onLogin, usersList, settings, updateSettings, deviceId, showToast }) {
  const [formData, setFormData] = useState({ nipp: '', password: '', lokasi: LOCATIONS[0] });
  const [showCamera, setShowCamera] = useState(false);
  const [tempUser, setTempUser] = useState(null);

  const handleLoginSubmit = (e) => {
    e.preventDefault();
    const inputNipp = formData.nipp.trim().toLowerCase();
    const matchedUser = usersList.find(u => u.nipp.trim().toLowerCase() === inputNipp && u.password === formData.password);
    
    if (!matchedUser) {
       return showToast("NIPP atau Password Tidak Ditemukan/Salah!", "error");
    }
    if (formData.lokasi === 'All Lokasi' && matchedUser.role !== 'master' && matchedUser.role !== 'audit') {
       return showToast("Hanya Master/Audit yang dapat mengakses 'All Lokasi'.", "error");
    }

    if (matchedUser.role !== 'master') {
        const activeLogins = settings.activeLogins || {};
        const userActive = activeLogins[matchedUser.nipp];

        if (userActive && userActive.lokasi === formData.lokasi && userActive.deviceId !== deviceId) {
           if (Date.now() - userActive.timestamp < 300000) {
               return showToast(`Akun ini sedang online di ${formData.lokasi} oleh perangkat lain! Gunakan akun/lokasi berbeda.`, "error");
           }
        }
    }

    updateSettings({
       ...settings,
       activeLogins: {
           ...(settings.activeLogins || {}),
           [matchedUser.nipp]: { lokasi: formData.lokasi, deviceId: deviceId, timestamp: Date.now() }
       }
    });

    setTempUser({ ...matchedUser, lokasi: formData.lokasi });
    setShowCamera(true); 
  };

  const processLogin = (photoData) => {
    onLogin({ ...tempUser, photo: photoData });
  };

  return (
    <div className="min-h-screen bg-[#092613] flex items-center justify-center p-6 relative overflow-hidden font-sans">
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-green-500/10 rounded-full blur-[120px]" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-teal-500/10 rounded-full blur-[120px]" />

      <div className="bg-[#114022]/80 backdrop-blur-3xl p-10 rounded-[3rem] border border-[#1b5e35] shadow-2xl w-full max-w-md z-10">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-gradient-to-tr from-green-500 to-teal-500 rounded-[1.5rem] mx-auto mb-6 flex items-center justify-center shadow-xl rotate-3">
            <Monitor size={40} className="text-[#092613] -rotate-3" />
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight">Device <span className="font-light text-green-400">Portable</span></h1>
          <p className="text-green-200/70 text-sm mt-2">Sistem kasir berbasis web terintegrasi.</p>
          <p className="text-green-400 font-bold text-xs mt-1">{settings?.web?.appVersion || 'v.1.3.26'}</p>
          <p className="text-green-200/40 text-[10px] mt-0.5">&copy; copyright by 200041</p>
        </div>

        <form onSubmit={handleLoginSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-green-300/60 ml-2 mb-1 uppercase tracking-wider">Lokasi Tugas</label>
            <div className="relative">
              <select className="w-full bg-[#092613] border border-[#1b5e35] rounded-2xl px-5 py-4 text-white focus:bg-[#0c331a] focus:border-green-500 outline-none appearance-none transition-all" value={formData.lokasi} onChange={e => setFormData({...formData, lokasi: e.target.value})}>
                {LOCATIONS.map(loc => <option key={loc} value={loc}>{loc}</option>)}
              </select>
              <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-green-400"><ChevronDown size={20} /></div>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-green-300/60 ml-2 mb-1 uppercase tracking-wider">NIPP / ID Petugas</label>
            <input required type="text" placeholder="Masukkan NIPP Anda" className="w-full bg-[#092613] border border-[#1b5e35] rounded-2xl px-5 py-4 text-white placeholder-green-200/30 focus:bg-[#0c331a] focus:border-green-500 outline-none transition-all" value={formData.nipp} onChange={e => setFormData({...formData, nipp: e.target.value})} />
          </div>
          <div>
            <label className="block text-xs font-bold text-green-300/60 ml-2 mb-1 uppercase tracking-wider">Password</label>
            <input required type="password" placeholder="••••••••" className="w-full bg-[#092613] border border-[#1b5e35] rounded-2xl px-5 py-4 text-white placeholder-green-200/30 focus:bg-[#0c331a] focus:border-green-500 outline-none transition-all" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} />
          </div>
          
          <button type="submit" className="w-full bg-green-600 hover:bg-green-500 text-white font-black rounded-2xl px-5 py-4 shadow-lg shadow-green-600/20 transition-all active:scale-95 mt-4 text-lg">
            Verifikasi & Masuk
          </button>
        </form>
      </div>
      {showCamera && <CameraModal facingMode="user" title="Verifikasi Wajah Kasir" onClose={() => setShowCamera(false)} onCapture={processLogin} />}
    </div>
  );
}

function NavButton({ active, onClick, icon, label, color }) {
  return (
    <button onClick={onClick} className={`relative flex items-center justify-center gap-2 px-5 py-3 rounded-2xl transition-all duration-300 ${active ? 'bg-[#1b5e35] shadow-inner' : 'hover:bg-[#1b5e35]/50'}`}>
      <div className={`${active ? color : 'text-green-300/50'} transition-colors`}>{React.cloneElement(icon, { size: 22, strokeWidth: active ? 2.5 : 2 })}</div>
      {active && <span className={`text-sm font-bold ${color}`}>{label}</span>}
    </button>
  );
}

// --- KENDARAAN MASUK ---
function KendaraanMasuk({ user, addTransaction, showToast, settings, setTicketPreview }) {
  const [nopol, setNopol] = useState('');
  const [jenis, setJenis] = useState('Motor');
  const [showCamera, setShowCamera] = useState(false);
  const [gps, setGps] = useState('Sedang mencari...');
  const webSettings = settings?.web || DEFAULT_SETTINGS.web;

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      pos => setGps(`${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`),
      err => setGps('GPS Tidak Tersedia')
    );
  }, []);

  const handleProcess = (e) => {
    e.preventDefault();
    if (!nopol) return showToast("Nomor Polisi wajib diisi!", "error");
    setShowCamera(true);
  };

  const handleCapture = async (photo) => {
    setShowCamera(false);
    const newTx = {
      id: Date.now().toString(), nopol: nopol.toUpperCase(), jenis, waktuMasuk: new Date(),
      status: 'IN', fotoMasuk: photo, lokasi: user.lokasi === 'All Lokasi' ? PURE_LOCATIONS[0] : user.lokasi,
      kasirMasuk: user.nama, gps
    };
    
    // Simpan ke DB dulu agar tidak hilang
    await addTransaction(newTx);
    
    // Print background langsung jalan
    printDirectBluetooth('IN', newTx, settings);
    
    // Tampilkan SOP Preview Modal ke UI
    setTicketPreview({ type: 'IN', data: newTx });
    
    setNopol('');
  };

  return (
    <div className="fade-in max-w-2xl mx-auto">
      {webSettings.logoUrl && (
         <div className="flex justify-center mb-6">
            <img src={webSettings.logoUrl} className="h-16 object-contain bg-[#114022] border border-[#1b5e35] rounded-2xl p-2 shadow-lg" alt="Logo Perusahaan"/>
         </div>
      )}
      <div className="bg-[#114022] rounded-[2.5rem] p-8 shadow-2xl border border-[#1b5e35]">
        <form onSubmit={handleProcess} className="space-y-8">
          <div>
            <label className="block text-sm font-bold text-green-300/60 ml-2 mb-2 uppercase tracking-wider">Input Nomor Polisi</label>
            <input type="text" placeholder="D 1234 ABC" value={nopol} onChange={e => setNopol(e.target.value.toUpperCase())} className="w-full bg-[#092613] border-2 border-[#1b5e35] rounded-[1.5rem] px-6 py-5 text-4xl font-black text-center uppercase tracking-widest text-white focus:border-green-500 outline-none transition-all placeholder:text-green-200/20" autoFocus />
          </div>

          <div>
            <label className="block text-sm font-bold text-green-300/60 ml-2 mb-2 uppercase tracking-wider">Pilih Jenis Kendaraan</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-[#092613] p-2 rounded-[1.5rem] border border-[#1b5e35]">
              {[{ id: 'Motor', icon: <Bike size={24} /> }, { id: 'Mobil', icon: <Car size={24} /> }, { id: 'Box/Truck', icon: <Truck size={24} /> }, { id: 'Sepeda/Becak', icon: <div className="font-bold text-xl">🚲</div> }].map(item => (
                <button key={item.id} type="button" onClick={() => setJenis(item.id)} className={`flex flex-col items-center justify-center py-4 rounded-xl transition-all duration-300 ${jenis === item.id ? 'bg-green-600 text-white font-bold scale-105 shadow-lg' : 'text-green-300/50 hover:bg-[#114022] hover:text-white'}`}>
                  <div className="mb-2">{item.icon}</div><span className="text-xs">{item.id}</span>
                </button>
              ))}
            </div>
          </div>

          <button type="submit" className="w-full bg-green-600 hover:bg-green-500 text-white font-black rounded-[1.5rem] px-6 py-6 shadow-xl shadow-green-600/20 text-xl transition-all active:scale-95 flex justify-center items-center gap-3">
            <Camera size={28} /> PROSES TIKET MASUK
          </button>
        </form>
      </div>
      {showCamera && <CameraModal facingMode="environment" title="Foto Kendaraan Masuk" onClose={() => setShowCamera(false)} onCapture={handleCapture} />}
    </div>
  );
}

// --- KENDARAAN KELUAR ---
function KendaraanKeluar({ user, transactions, updateTransaction, settings, showToast, setTicketPreview }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTx, setSelectedTx] = useState(null);
  const [showCamera, setShowCamera] = useState(false);
  const [tiketHilang, setTiketHilang] = useState(false);
  const [showLostModal, setShowLostModal] = useState(false);
  
  const [fotoKTP, setFotoKTP] = useState(null);
  const [fotoSTNK, setFotoSTNK] = useState(null);

  const webSettings = settings?.web || DEFAULT_SETTINGS.web;
  const activeTransactions = transactions.filter(t => t.status === 'IN' && (t.nopol || '').includes(searchQuery.toUpperCase()) && (user.lokasi === 'All Lokasi' || t.lokasi === user.lokasi));

  const calculateFee = (tx) => {
    const exitTime = new Date();
    const diffMs = exitTime - tx.waktuMasuk;
    
    const diffMinutesTotal = Math.floor(diffMs / (1000 * 60));
    const exactHours = Math.floor(diffMinutesTotal / 60);
    const exactMinutes = diffMinutesTotal % 60;
    const durasiText = `${exactHours} Jam ${exactMinutes} Menit`;

    const jam = exactHours + (exactMinutes > 0 ? 1 : 0);
    const billedJam = jam > 0 ? jam : 1; 

    const locSettings = getLocSettings(settings, tx.lokasi);
    const rate = locSettings.tariffs[tx.jenis] || locSettings.tariffs['Motor'];
    const denda = tiketHilang ? 10000 : 0;

    if (rate.gracePeriodActive && diffMinutesTotal <= rate.gracePeriodMinutes) {
       return { total: denda, jam: billedJam, durasiText, exitTime, isMember: false, denda };
    }

    const members = settings.members || [];
    const isMember = members.find(m => m.nopol === tx.nopol && m.status === 'Aktif');
    if (isMember) return { total: denda, jam: billedJam, durasiText, exitTime, isMember: true, denda };

    let total = 0;
    if (rate.mode === 'flat') {
      total = rate.first;
    } else {
      const days = Math.floor(billedJam / 24);
      const remainingHours = billedJam % 24;
      
      let cycleFee = rate.first; 
      if (remainingHours > rate.firstDuration) {
        cycleFee += (remainingHours - rate.firstDuration) * rate.next;
      }
      if (cycleFee > rate.max) cycleFee = rate.max;

      if (days > 0) {
        total = days * (rate.max + rate.inap);
        if (remainingHours > 0) total += cycleFee;
      } else {
        total = cycleFee;
      }
    }
    
    return { total: total + denda, jam: billedJam, durasiText, exitTime, isMember: false, denda };
  };

  const handleProcess = () => { 
    if (tiketHilang && (!fotoKTP || !fotoSTNK)) {
        return showToast("Mohon upload Foto KTP dan STNK terlebih dahulu!", "error");
    }
    if (selectedTx) setShowCamera(true); 
  };

  const handleCapture = async (photo) => {
    setShowCamera(false);
    const { total, jam, durasiText, exitTime, isMember, denda } = calculateFee(selectedTx);
    
    const updateData = { 
      status: 'OUT', waktuKeluar: exitTime, fotoKeluar: photo, 
      kasirKeluar: user.nama, durasiJam: jam, durasiText: durasiText, totalBiaya: total, 
      isMember, tiketHilang, denda, fotoKTP, fotoSTNK
    };
    
    await updateTransaction(selectedTx.id, updateData);
    
    const locSettings = getLocSettings(settings, selectedTx.lokasi);
    const finalData = { ...selectedTx, ...updateData, petugasPhoto: user.photo, locSettings };

    printDirectBluetooth('OUT', finalData, settings);

    // Tampilkan SOP Preview Modal ke UI
    setTicketPreview({ type: 'OUT', data: finalData });

    setSelectedTx(null);
    setSearchQuery('');
    setTiketHilang(false); setFotoKTP(null); setFotoSTNK(null);
  };

  return (
    <div className="fade-in max-w-2xl mx-auto">
      {webSettings.logoUrl && (
         <div className="flex justify-center mb-6">
            <img src={webSettings.logoUrl} className="h-16 object-contain bg-[#114022] border border-[#1b5e35] rounded-2xl p-2 shadow-lg" alt="Logo Perusahaan"/>
         </div>
      )}
      <div className="bg-[#114022] rounded-[2.5rem] p-8 shadow-2xl border border-[#1b5e35]">
        <div className="relative mb-8">
          <div className="absolute inset-y-0 left-6 flex items-center pointer-events-none"><Search className="text-green-300/50" size={24} /></div>
          <input type="text" placeholder="Cari Nopol Keluar..." value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setSelectedTx(null); }} className="w-full bg-[#092613] border-2 border-[#1b5e35] rounded-[1.5rem] pl-16 pr-6 py-5 text-3xl font-black text-white uppercase focus:border-teal-500 outline-none transition-all placeholder:text-green-200/20" />
          
          {searchQuery && !selectedTx && activeTransactions.length > 0 && (
            <div className="absolute z-10 w-full mt-2 bg-[#114022] border border-[#1b5e35] rounded-2xl shadow-2xl overflow-hidden max-h-60 overflow-y-auto">
              {activeTransactions.map(tx => (
                <button key={tx.id} onClick={() => { setSelectedTx(tx); setSearchQuery(tx.nopol); }} className="w-full text-left px-6 py-4 hover:bg-[#164d2b] border-b border-[#1b5e35] last:border-0 flex items-center justify-between transition-colors">
                  <div><span className="font-bold text-xl text-white">{tx.nopol}</span><span className="ml-3 text-xs bg-[#092613] px-2 py-1 rounded-md text-green-300/70">{tx.jenis}</span></div>
                  <span className="text-xs text-green-200/50">Masuk: {tx.waktuMasuk.toLocaleTimeString()}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedTx && (
          <div className="bg-[#092613] rounded-[1.5rem] p-6 border border-[#1b5e35] mb-8 animate-in slide-in-from-bottom-4">
            <div className="flex justify-between items-start mb-6">
              <div><p className="text-sm font-bold text-teal-400 mb-1">Tiket Ditemukan</p><h3 className="text-4xl font-black text-white">{selectedTx.nopol}</h3></div>
              <div className="text-right"><p className="text-xs text-green-200/50">Waktu Masuk</p><p className="font-bold text-green-50 text-lg">{selectedTx.waktuMasuk.toLocaleString()}</p></div>
            </div>
            
            <div className="flex gap-4 items-center mb-6 bg-[#114022] p-4 rounded-xl border border-[#1b5e35]">
               {selectedTx.fotoMasuk ? (
                 <img src={selectedTx.fotoMasuk} alt="Masuk" className="w-24 h-24 object-cover rounded-xl border border-black/50 shadow-md" />
               ) : (
                 <div className="w-24 h-24 flex items-center justify-center bg-black/50 rounded-xl border border-black/50 text-green-300/30"><Camera size={24}/></div>
               )}
               <div className="flex flex-col justify-center gap-1">
                  <p className="text-sm text-green-200/70"><span className="font-bold text-white">Lokasi:</span> {selectedTx.lokasi}</p>
                  <p className="text-sm text-green-200/70"><span className="font-bold text-white">Jenis:</span> {selectedTx.jenis}</p>
               </div>
            </div>

            <div className="border-t border-[#1b5e35] pt-6 mt-2">
               <label className={`flex items-center justify-between cursor-pointer p-4 border rounded-xl transition-all ${tiketHilang ? 'bg-red-600/20 border-red-500' : 'bg-red-900/10 border-red-600/30 hover:bg-red-900/20'}`}>
                  <div className="flex items-center gap-3">
                     <div className={`p-2 rounded-full ${tiketHilang ? 'bg-red-500 text-white' : 'bg-red-900/50 text-red-400'}`}>
                        <AlertTriangle size={24}/>
                     </div>
                     <div>
                        <span className={`font-bold block ${tiketHilang ? 'text-red-400' : 'text-red-400/80'}`}>Pelanggan Kehilangan Tiket?</span>
                        <span className="text-xs text-red-400/60">{tiketHilang ? 'Denda Rp 10.000 Aktif & Dokumen Tersimpan' : 'Tekan tombol di samping untuk proses denda'}</span>
                     </div>
                  </div>
                  <button type="button" onClick={(e) => { e.preventDefault(); setShowLostModal(true); }} className={`px-4 py-2 rounded-lg text-sm font-bold shadow-md transition-colors ${tiketHilang ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-red-600/80 text-white hover:bg-red-500'}`}>
                     {tiketHilang ? 'Edit Dokumen' : 'Proses Kehilangan'}
                  </button>
               </label>
            </div>
            
            {showLostModal && (
              <div className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm">
                 <div className="bg-[#114022] p-6 rounded-2xl border border-[#1b5e35] max-w-sm w-full shadow-2xl animate-in zoom-in-95">
                    <h3 className="text-white font-bold mb-2 flex items-center gap-2 text-lg"><AlertTriangle className="text-red-500"/> Laporan Tiket Hilang</h3>
                    <p className="text-xs text-green-200/70 mb-4">Denda sebesar <strong className="text-white">Rp 10.000</strong> akan ditambahkan ke total tarif. Mohon upload bukti kepemilikan kendaraan (KTP & STNK Asli).</p>
                    
                    <div className="space-y-4">
                       <div className="bg-[#092613] p-4 rounded-xl text-center border border-[#1b5e35]">
                          <p className="text-xs font-bold text-green-200/70 mb-2">Upload KTP Asli</p>
                          {fotoKTP ? <img src={fotoKTP} className="h-20 w-full object-cover rounded mb-2 border border-[#1b5e35]" alt="KTP"/> : <div className="h-20 bg-[#114022] rounded mb-2 flex items-center justify-center text-green-300/30"><FileImage/></div>}
                          <input type="file" id="upload-ktp" accept="image/*" capture="environment" className="hidden" onChange={(e) => processImageFile(e.target.files[0], setFotoKTP)} />
                          <label htmlFor="upload-ktp" className="bg-teal-600 text-white text-xs py-2 px-4 rounded-lg cursor-pointer hover:bg-teal-500 block font-bold"><Camera size={12} className="inline mr-1"/> Ambil Foto KTP</label>
                       </div>
                       <div className="bg-[#092613] p-4 rounded-xl text-center border border-[#1b5e35]">
                          <p className="text-xs font-bold text-green-200/70 mb-2">Upload STNK Asli</p>
                          {fotoSTNK ? <img src={fotoSTNK} className="h-20 w-full object-cover rounded mb-2 border border-[#1b5e35]" alt="STNK"/> : <div className="h-20 bg-[#114022] rounded mb-2 flex items-center justify-center text-green-300/30"><FileImage/></div>}
                          <input type="file" id="upload-stnk" accept="image/*" capture="environment" className="hidden" onChange={(e) => processImageFile(e.target.files[0], setFotoSTNK)} />
                          <label htmlFor="upload-stnk" className="bg-orange-600 text-white text-xs py-2 px-4 rounded-lg cursor-pointer hover:bg-orange-500 block font-bold"><Camera size={12} className="inline mr-1"/> Ambil Foto STNK</label>
                       </div>
                    </div>

                    <div className="flex gap-3 mt-6">
                       <button onClick={() => setShowLostModal(false)} className="flex-1 py-3 bg-[#092613] text-white font-bold rounded-xl hover:bg-black/20 text-sm">Batal</button>
                       <button onClick={() => { if(!fotoKTP || !fotoSTNK) return showToast("KTP & STNK wajib diupload!", "error"); setTiketHilang(true); setShowLostModal(false); }} className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-500 text-sm">Terapkan Denda</button>
                    </div>
                 </div>
              </div>
            )}

          </div>
        )}

        <button onClick={handleProcess} disabled={!selectedTx} className={`w-full font-black rounded-[1.5rem] px-6 py-6 text-xl transition-all flex justify-center items-center gap-3 ${selectedTx ? 'bg-teal-600 hover:bg-teal-500 text-white shadow-xl shadow-teal-600/20 active:scale-95' : 'bg-[#092613] border-2 border-[#1b5e35] text-green-300/30 cursor-not-allowed'}`}>
          <Camera size={28} /> HITUNG & CETAK STRUK
        </button>
      </div>
      {showCamera && <CameraModal facingMode="environment" title="Foto Kendaraan Keluar" onClose={() => setShowCamera(false)} onCapture={handleCapture} />}
    </div>
  );
}

// --- KENDARAAN AREA ---
function KendaraanArea({ transactions, user }) {
  const activeTx = transactions.filter(t => t.status === 'IN' && (user.lokasi === 'All Lokasi' || t.lokasi === user.lokasi));
  const [zoomImg, setZoomImg] = useState(null);

  return (
    <div className="fade-in max-w-5xl mx-auto hide-on-print">
      <div className="flex items-center gap-4 mb-6">
         <div className="w-14 h-14 bg-teal-500/20 text-teal-400 border border-teal-500/30 rounded-2xl flex items-center justify-center"><MapPin size={28} /></div>
         <div><h2 className="text-2xl font-extrabold text-white">Kendaraan di Area</h2><p className="text-green-200/70 text-sm">Rincian detail kendaraan yang belum melakukan transaksi keluar.</p></div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {activeTx.length === 0 && <p className="text-green-300/50 col-span-full">Tidak ada kendaraan di area parkir saat ini.</p>}
        {activeTx.map(tx => (
          <div key={tx.id} className="bg-[#114022] p-5 rounded-3xl border border-[#1b5e35] flex flex-col hover:bg-[#164d2b] transition-colors relative overflow-hidden shadow-lg">
            
            <div className="relative w-full aspect-video bg-[#092613] rounded-2xl overflow-hidden mb-4 group cursor-pointer border border-[#1b5e35]" onClick={() => tx.fotoMasuk && setZoomImg(tx.fotoMasuk)}>
               {tx.fotoMasuk ? (
                 <img src={tx.fotoMasuk} alt="Masuk" className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
               ) : (
                 <div className="w-full h-full flex flex-col items-center justify-center text-green-300/30">
                    <Camera size={32} className="mb-2"/>
                    <span className="text-xs">Foto Tidak Tersedia</span>
                 </div>
               )}
               {tx.fotoMasuk && <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 text-white"><Search size={32} /></div>}
            </div>
            
            <div className="flex justify-between items-center mb-4">
               <h3 className="text-3xl font-black text-white tracking-widest">{tx.nopol}</h3>
               <span className="text-xs text-green-300/90 bg-[#092613] px-3 py-1.5 rounded-lg font-bold border border-[#1b5e35] uppercase tracking-wider">{tx.jenis}</span>
            </div>
            
            <div className="text-xs text-green-200/80 space-y-2 bg-[#092613] p-4 rounded-2xl border border-[#1b5e35]">
               <div className="flex justify-between items-center border-b border-[#1b5e35] pb-2">
                  <span className="flex items-center gap-2"><Clock size={14} className="text-teal-400"/> Tanggal Masuk</span>
                  <span className="text-white font-bold">{tx.waktuMasuk.toLocaleDateString('id-ID')}</span>
               </div>
               <div className="flex justify-between items-center border-b border-[#1b5e35] pb-2">
                  <span className="flex items-center gap-2"><Clock size={14} className="text-teal-400"/> Jam Masuk</span>
                  <span className="text-white font-bold">{tx.waktuMasuk.toLocaleTimeString('id-ID')}</span>
               </div>
               <div className="flex justify-between items-center border-b border-[#1b5e35] pb-2">
                  <span className="flex items-center gap-2"><MapPin size={14} className="text-teal-400"/> Lokasi</span>
                  <span className="text-white font-bold">{tx.lokasi}</span>
               </div>
               <div className="flex justify-between items-center pt-1">
                  <span className="flex items-center gap-2"><Monitor size={14} className="text-teal-400"/> Petugas Entry</span>
                  <span className="text-white font-bold text-right">{tx.kasirMasuk}</span>
               </div>
            </div>

          </div>
        ))}
      </div>
      
      {zoomImg && (
        <div className="fixed inset-0 z-[70] bg-black/95 flex items-center justify-center p-4 backdrop-blur-md" onClick={() => setZoomImg(null)}>
           <img src={zoomImg} className="max-w-[95vw] max-h-[90vh] rounded-2xl shadow-2xl border-4 border-[#1b5e35] object-contain" alt="Zoom"/>
           <button className="absolute top-6 right-6 text-white bg-red-600/50 hover:bg-red-600 p-3 rounded-full transition-colors"><X size={24}/></button>
           <p className="absolute bottom-6 text-white/50 text-sm bg-black/50 px-4 py-2 rounded-full">Ketuk area manapun untuk menutup</p>
        </div>
      )}
    </div>
  );
}

// --- MASTER SETTINGS & LAPORAN ---
function MasterSettings({ settings, setSettings, user, transactions, updateTransaction, showToast, setConfirmDialog }) {
  const [activeSetTab, setActiveSetTab] = useState('laporan');
  const isReadOnly = user.role !== 'master';

  return (
    <div className="fade-in max-w-5xl mx-auto print-a4-layout">
      <div className="flex items-center gap-4 mb-8 hide-on-print">
        <div className="w-14 h-14 bg-[#114022] text-green-400 border border-[#1b5e35] rounded-2xl flex items-center justify-center"><Settings size={28} /></div>
        <div>
          <h2 className="text-2xl font-extrabold text-white tracking-tight">System Settings & Reports</h2>
          <p className="text-green-200/70 text-sm">Akses {user.role.toUpperCase()} {isReadOnly ? '(Sebagian Fitur Read-Only)' : '(Full Access)'}</p>
        </div>
      </div>

      <div className="flex gap-2 mb-6 overflow-x-auto pb-2 custom-scrollbar hide-on-print">
        <button onClick={() => setActiveSetTab('laporan')} className={`px-5 py-3 rounded-xl font-bold text-sm transition-all whitespace-nowrap ${activeSetTab === 'laporan' ? 'bg-green-600 text-white' : 'bg-[#114022] text-green-300/50 hover:bg-[#164d2b]'}`}>Laporan & Audit</button>
        {user.role === 'master' && <button onClick={() => setActiveSetTab('rekapan')} className={`px-5 py-3 rounded-xl font-bold text-sm transition-all whitespace-nowrap ${activeSetTab === 'rekapan' ? 'bg-teal-600 text-white' : 'bg-[#114022] text-teal-400 hover:bg-[#164d2b]'}`}>Rekapan Global (Rinci)</button>}
        <button onClick={() => setActiveSetTab('tarif')} className={`px-5 py-3 rounded-xl font-bold text-sm transition-all whitespace-nowrap ${activeSetTab === 'tarif' ? 'bg-[#1b5e35] text-white' : 'bg-[#114022] text-green-300/50 hover:bg-[#164d2b]'}`}>Setting Tarif</button>
        <button onClick={() => setActiveSetTab('member')} className={`px-5 py-3 rounded-xl font-bold text-sm transition-all whitespace-nowrap ${activeSetTab === 'member' ? 'bg-[#1b5e35] text-white' : 'bg-[#114022] text-green-300/50 hover:bg-[#164d2b]'}`}>Member Parkir</button>
        <button onClick={() => setActiveSetTab('shift')} className={`px-5 py-3 rounded-xl font-bold text-sm transition-all whitespace-nowrap ${activeSetTab === 'shift' ? 'bg-[#1b5e35] text-white' : 'bg-[#114022] text-green-300/50 hover:bg-[#164d2b]'}`}>Setting Shift</button>
        {user.role === 'master' && <button onClick={() => setActiveSetTab('users')} className={`px-5 py-3 rounded-xl font-bold text-sm transition-all whitespace-nowrap ${activeSetTab === 'users' ? 'bg-blue-600 text-white' : 'bg-[#114022] text-blue-400 hover:bg-[#164d2b]'}`}>Manajemen User</button>}
        <button onClick={() => setActiveSetTab('tiket')} className={`px-5 py-3 rounded-xl font-bold text-sm transition-all whitespace-nowrap ${activeSetTab === 'tiket' ? 'bg-[#1b5e35] text-white' : 'bg-[#114022] text-green-300/50 hover:bg-[#164d2b]'}`}>Struk/Tiket Parkir</button>
        <button onClick={() => setActiveSetTab('web')} className={`px-5 py-3 rounded-xl font-bold text-sm transition-all whitespace-nowrap ${activeSetTab === 'web' ? 'bg-[#1b5e35] text-white' : 'bg-[#114022] text-green-300/50 hover:bg-[#164d2b]'}`}>Web & Printer</button>
      </div>

      <div className="bg-[#114022] rounded-[2.5rem] p-8 shadow-2xl border border-[#1b5e35] print-a4-layout">
        {activeSetTab === 'laporan' && <Laporan transactions={transactions} user={user} updateTransaction={updateTransaction} showToast={showToast} setConfirmDialog={setConfirmDialog} settings={settings} />}
        {activeSetTab === 'rekapan' && user.role === 'master' && <RekapanLaporan transactions={transactions} user={user} settings={settings} />}
        {activeSetTab === 'tarif' && <SettingTarif settings={settings} setSettings={setSettings} isReadOnly={isReadOnly} user={user} showToast={showToast} />}
        {activeSetTab === 'member' && <SettingMember settings={settings} setSettings={setSettings} isReadOnly={isReadOnly} user={user} showToast={showToast} />}
        {activeSetTab === 'shift' && <SettingShift settings={settings} setSettings={setSettings} isReadOnly={isReadOnly} user={user} showToast={showToast} />}
        {activeSetTab === 'users' && user.role === 'master' && <SettingUser settings={settings} setSettings={setSettings} showToast={showToast} />}
        {activeSetTab === 'tiket' && <SettingTiket settings={settings} setSettings={setSettings} isReadOnly={isReadOnly} showToast={showToast} />}
        {activeSetTab === 'web' && <SettingWeb settings={settings} setSettings={setSettings} isReadOnly={isReadOnly} showToast={showToast} />}
      </div>
    </div>
  );
}

// Sub-Component Laporan Visual (Dilengkapi fitur print 1 lembar)
function Laporan({ transactions, user, updateTransaction, showToast, setConfirmDialog, settings }) {
  const [lapTab, setLapTab] = useState('ringkasan');
  const [zoomImg, setZoomImg] = useState(null);
  const [isCleaning, setIsCleaning] = useState(false);
  const webSettings = settings?.web || {};
  
  // NEW FILTER STATES
  const [filterMode, setFilterMode] = useState('semua');
  const [filterDate, setFilterDate] = useState(new Date().toISOString().slice(0, 10));
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7));
  const [filterYear, setFilterYear] = useState(new Date().getFullYear().toString());
  const locShifts = getLocSettings(settings, user.lokasi).shifts || [];
  const [filterShift, setFilterShift] = useState(locShifts[0]?.id || '');

  // STATE UNTUK FILTER YANG DITERAPKAN SETELAH TOMBOL CARI DIKLIK
  const [appliedFilter, setAppliedFilter] = useState({
     mode: 'semua', date: filterDate, month: filterMonth, year: filterYear, shift: filterShift
  });

  const handleApplyFilter = () => {
     setAppliedFilter({ mode: filterMode, date: filterDate, month: filterMonth, year: filterYear, shift: filterShift });
  };

  let baseFilteredTx = transactions.filter(t => user.lokasi === 'All Lokasi' || t.lokasi === user.lokasi);

  let filteredTx = baseFilteredTx.filter(tx => {
      if (appliedFilter.mode === 'semua') return true;

      const txDate = tx.waktuKeluar || tx.waktuMasuk;
      if (!txDate) return false;

      if (appliedFilter.mode === 'harian') {
          const selected = new Date(appliedFilter.date);
          const start = new Date(selected); start.setHours(6, 0, 0, 0);
          const end = new Date(selected); end.setDate(end.getDate() + 1); end.setHours(5, 59, 59, 999);
          return txDate >= start && txDate <= end;
      }
      if (appliedFilter.mode === 'shift') {
          const selected = new Date(appliedFilter.date);
          const startDay = new Date(selected); startDay.setHours(6, 0, 0, 0);
          const endDay = new Date(selected); endDay.setDate(endDay.getDate() + 1); endDay.setHours(5, 59, 59, 999);

          if (!(txDate >= startDay && txDate <= endDay)) return false;

          const selectedShift = locShifts.find(s => s.id === appliedFilter.shift) || locShifts[0];
          if(!selectedShift) return true;

          const startH = parseInt(selectedShift.start.split(':')[0]);
          const startM = parseInt(selectedShift.start.split(':')[1]);
          const endH = parseInt(selectedShift.end.split(':')[0]);
          const endM = parseInt(selectedShift.end.split(':')[1]);

          const txTotalM = txDate.getHours() * 60 + txDate.getMinutes();
          const startTotalM = startH * 60 + startM;
          const endTotalM = endH * 60 + endM;

          if (startTotalM <= endTotalM) {
              return txTotalM >= startTotalM && txTotalM <= endTotalM;
          } else {
              return txTotalM >= startTotalM || txTotalM <= endTotalM;
          }
      }
      if (appliedFilter.mode === 'bulanan') {
          const txMonth = txDate.getFullYear() + '-' + String(txDate.getMonth() + 1).padStart(2, '0');
          return txMonth === appliedFilter.month;
      }
      if (appliedFilter.mode === 'tahunan') {
          return txDate.getFullYear().toString() === appliedFilter.year;
      }
      return true;
  });

  const completedTx = filteredTx.filter(t => t.status === 'OUT');
  const totalPendapatan = completedTx.reduce((acc, curr) => acc + (curr.totalBiaya || 0), 0);

  const breakdown = { 'Motor': { qty: 0, nominal: 0 }, 'Mobil': { qty: 0, nominal: 0 }, 'Box/Truck': { qty: 0, nominal: 0 }, 'Sepeda/Becak': { qty: 0, nominal: 0 } };
  const durasiStats = { '1 Jam Awal': 0, '2 sd 5 Jam': 0, '6 sd 12 Jam': 0, '13 sd 24 Jam': 0, '> 24 Jam': 0 };

  completedTx.forEach(tx => {
     if (tx.jenis && breakdown[tx.jenis] !== undefined) { 
         breakdown[tx.jenis].qty += 1; 
         breakdown[tx.jenis].nominal += tx.totalBiaya || 0; 
     }
     const jam = tx.durasiJam || 1;
     if (jam <= 1) durasiStats['1 Jam Awal'] += 1;
     else if (jam <= 5) durasiStats['2 sd 5 Jam'] += 1;
     else if (jam <= 12) durasiStats['6 sd 12 Jam'] += 1;
     else if (jam <= 24) durasiStats['13 sd 24 Jam'] += 1;
     else durasiStats['> 24 Jam'] += 1;
  });

  const totalQtySelesai = completedTx.length;

  const requestCleanDatabase = () => {
    setConfirmDialog({
        title: "Bersihkan Storage Database",
        message: "Proses ini akan menghapus semua file foto transaksi yang berumur LEBIH DARI 30 HARI. Lanjutkan?",
        onConfirm: async () => {
            setConfirmDialog(null);
            setIsCleaning(true);
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            
            const txToClean = transactions.filter(t => t.waktuMasuk < thirtyDaysAgo && (t.fotoMasuk || t.fotoKeluar));
            for (const tx of txToClean) {
                await updateTransaction(tx.id, { fotoMasuk: null, fotoKeluar: null, fotoKTP: null, fotoSTNK: null, photoCleaned: true });
            }
            setIsCleaning(false);
            showToast(`Berhasil! ${txToClean.length} data lama dihapus fotonya.`);
        },
        onCancel: () => setConfirmDialog(null)
    });
  };

  let periodeText = "Semua Waktu";
  if(appliedFilter.mode === 'harian') periodeText = `Harian (${appliedFilter.date})`;
  if(appliedFilter.mode === 'shift') periodeText = `Shift (${appliedFilter.date} - ${locShifts.find(s=>s.id===appliedFilter.shift)?.name || ''})`;
  if(appliedFilter.mode === 'bulanan') periodeText = `Bulan (${appliedFilter.month})`;
  if(appliedFilter.mode === 'tahunan') periodeText = `Tahun (${appliedFilter.year})`;

  const signatureBlock = (
     <div className="hidden-screen show-on-print mt-12 print:text-black font-sans w-full pb-8">
         <div className="flex justify-between px-10">
            <div className="text-center w-40">
               <p className="text-sm">Mengetahui,</p>
               <p className="text-sm font-bold mb-16">Pimpinan / Manager</p>
               <div className="border-b-[1.5px] border-black w-full"></div>
            </div>
            
            <div className="text-center w-40">
               <p className="text-sm">Dicetak Oleh,</p>
               <p className="text-sm font-bold mb-16">Petugas Bertugas</p>
               <p className="border-b-[1.5px] border-black font-bold uppercase w-full pb-1">{user.nama}</p>
               <p className="text-[10px] mt-1 uppercase">{user.role}</p>
            </div>
         </div>
     </div>
  );

  return (
    <div className="space-y-6 print:space-y-2 print-a4-layout">
      {user.role === 'master' && (
        <div className="bg-red-900/20 border border-red-500/30 p-4 rounded-xl flex flex-col md:flex-row justify-between items-center gap-4 hide-on-print">
           <div className="flex items-center gap-3">
              <Database className="text-red-400" size={24}/>
              <p className="text-xs text-red-200/80 leading-relaxed"><strong>Sistem Auto-Storage Aktif:</strong> Hapus foto transaksi visual yang berumur &gt; 1 Bulan.</p>
           </div>
           <button onClick={requestCleanDatabase} disabled={isCleaning} className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap flex items-center gap-2 transition-colors">
              <Trash2 size={14}/> {isCleaning ? 'Membersihkan...' : 'Bersihkan Storage &gt; 1 Bulan'}
           </button>
        </div>
      )}

      {/* FILTER BAR TRANSAKSI */}
      <div className="bg-[#092613] p-4 rounded-xl border border-[#1b5e35] hide-on-print flex flex-wrap items-end gap-4">
         <div>
            <label className="block text-xs text-green-200/70 mb-1">Filter Periode</label>
            <select value={filterMode} onChange={e=>setFilterMode(e.target.value)} className="bg-[#114022] border border-[#1b5e35] p-2 rounded-lg text-white outline-none focus:border-green-500 text-sm">
               <option value="semua">Semua Waktu</option>
               <option value="shift">Per Shift</option>
               <option value="harian">Akhir Hari (Cutoff 06:00)</option>
               <option value="bulanan">Per Bulan</option>
               <option value="tahunan">Per Tahun</option>
            </select>
         </div>
         
         {(filterMode === 'shift' || filterMode === 'harian') && (
            <div>
               <label className="block text-xs text-green-200/70 mb-1">Tanggal</label>
               <input type="date" value={filterDate} onChange={e=>setFilterDate(e.target.value)} className="bg-[#114022] border border-[#1b5e35] p-2 rounded-lg text-white outline-none focus:border-green-500 text-sm" />
            </div>
         )}

         {filterMode === 'shift' && (
            <div>
               <label className="block text-xs text-green-200/70 mb-1">Pilih Shift</label>
               <select value={filterShift} onChange={e=>setFilterShift(e.target.value)} className="bg-[#114022] border border-[#1b5e35] p-2 rounded-lg text-white outline-none focus:border-green-500 text-sm">
                  {locShifts.map(s => <option key={s.id} value={s.id}>{s.name} ({s.start}-{s.end})</option>)}
               </select>
            </div>
         )}

         {filterMode === 'bulanan' && (
            <div>
               <label className="block text-xs text-green-200/70 mb-1">Bulan</label>
               <input type="month" value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} className="bg-[#114022] border border-[#1b5e35] p-2 rounded-lg text-white outline-none focus:border-green-500 text-sm" />
            </div>
         )}

         {filterMode === 'tahunan' && (
            <div>
               <label className="block text-xs text-green-200/70 mb-1">Tahun</label>
               <select value={filterYear} onChange={e=>setFilterYear(e.target.value)} className="bg-[#114022] border border-[#1b5e35] p-2 rounded-lg text-white outline-none focus:border-green-500 text-sm">
                  {[0,1,2,3,4].map(y => {
                     const year = new Date().getFullYear() - y;
                     return <option key={year} value={year.toString()}>{year}</option>
                  })}
               </select>
            </div>
         )}
         
         <button onClick={handleApplyFilter} className="bg-teal-600 hover:bg-teal-500 text-white px-6 py-2 rounded-lg font-bold text-sm h-[38px] flex items-center gap-2 shadow-lg transition-all active:scale-95">
            <Search size={16}/> Cari
         </button>
      </div>

      {/* TABS LAPORAN */}
      <div className="flex bg-[#092613] p-1 rounded-xl border border-[#1b5e35] hide-on-print overflow-x-auto custom-scrollbar">
         <button onClick={()=>setLapTab('ringkasan')} className={`flex-1 py-2 px-4 rounded-lg text-sm font-bold whitespace-nowrap transition-all ${lapTab==='ringkasan'?'bg-[#1b5e35] text-white shadow':'text-green-300/50 hover:text-white'}`}>Ringkasan Bisnis</button>
         <button onClick={()=>setLapTab('in_area')} className={`flex-1 py-2 px-4 rounded-lg text-sm font-bold whitespace-nowrap transition-all ${lapTab==='in_area'?'bg-teal-600 text-white shadow':'text-green-300/50 hover:text-white'}`}>Kendaraan di Area</button>
         <button onClick={()=>setLapTab('out_area')} className={`flex-1 py-2 px-4 rounded-lg text-sm font-bold whitespace-nowrap transition-all ${lapTab==='out_area'?'bg-orange-600 text-white shadow':'text-green-300/50 hover:text-white'}`}>Kendaraan Keluar</button>
         <button onClick={()=>setLapTab('semua')} className={`flex-1 py-2 px-4 rounded-lg text-sm font-bold whitespace-nowrap transition-all ${lapTab==='semua'?'bg-blue-600 text-white shadow':'text-green-300/50 hover:text-white'}`}>Semua Transaksi (Master List)</button>
      </div>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hide-on-print">
        <div><h3 className="font-bold text-xl text-white">Laporan Transaksi</h3></div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => window.print()} className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-bold hide-on-print shadow-lg"><Download size={16} /> Print 1 Lembar A4</button>
        </div>
      </div>

      {lapTab === 'ringkasan' && (
         <div className="animate-in fade-in space-y-6 print-a4-layout">
            {/* Header Laporan Khusus Print */}
            <div className="hidden-screen show-on-print border-b-2 border-black pb-4 mb-6 text-center">
                {webSettings.logoUrl && <img src={webSettings.logoUrl} className="h-12 mb-2 mx-auto" alt="Logo"/>}
                <h1 className="text-2xl font-black uppercase tracking-tight">Ringkasan Pendapatan Bisnis</h1>
                <p className="text-sm text-gray-700 font-medium mt-1">Lokasi: {user.lokasi} | Periode: {periodeText}</p>
                <p className="text-[10px] mt-1 text-gray-500">Dicetak: {new Date().toLocaleString('id-ID')} | {webSettings.appVersion || 'v.1.3.26'} | &copy; copyright by 200041</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 print:grid-cols-3">
              <div className="bg-[#092613] p-6 rounded-2xl border border-[#1b5e35] print:border-black print:bg-transparent print:text-black print:p-4 print:border-0"><p className="text-green-300/50 print:text-gray-600 text-xs font-bold mb-1">Total Pendapatan</p><h3 className="text-2xl print:text-xl font-black text-green-400 print:text-black">Rp {totalPendapatan.toLocaleString('id-ID')}</h3></div>
              <div className="bg-[#092613] p-6 rounded-2xl border border-[#1b5e35] print:border-black print:bg-transparent print:text-black print:p-4 print:border-0"><p className="text-green-300/50 print:text-gray-600 text-xs font-bold mb-1">Total Kendaraan (Masuk)</p><h3 className="text-2xl print:text-xl font-black text-teal-400 print:text-black">{filteredTx.length}</h3></div>
              <div className="bg-[#092613] p-6 rounded-2xl border border-[#1b5e35] print:border-black print:bg-transparent print:text-black print:p-4 print:border-0"><p className="text-green-300/50 print:text-gray-600 text-xs font-bold mb-1">Transaksi Selesai</p><h3 className="text-2xl print:text-xl font-black text-orange-400 print:text-black">{totalQtySelesai}</h3></div>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 print:grid-cols-2 mt-4 print:mt-8">
               <div className="bg-[#092613] p-5 rounded-2xl border border-[#1b5e35] print:border-black print:bg-transparent print:text-black print:p-0 print:border-0">
                  <h4 className="font-bold text-white print:text-black mb-4 print:mb-2 border-b border-[#1b5e35] print:border-black pb-2 print:text-lg">Breakdown Jenis Kendaraan</h4>
                  <table className="w-full text-sm print:text-sm text-left border-collapse dense-table">
                     <thead><tr className="text-green-200/70 print:text-black"><th className="py-2">Jenis Kendaraan</th><th className="py-2 text-center">Total Qty</th><th className="py-2 text-right">Nominal (Rp)</th></tr></thead>
                     <tbody className="text-white print:text-black">
                        {Object.keys(breakdown).map(jenis => (
                           <tr key={jenis} className="border-b border-[#1b5e35]/50 print:border-gray-400">
                              <td className="py-2">{jenis}</td><td className="py-2 text-center font-bold text-teal-400 print:text-black">{breakdown[jenis].qty}</td><td className="py-2 text-right font-bold text-green-400 print:text-black">{breakdown[jenis].nominal.toLocaleString('id-ID')}</td>
                           </tr>
                        ))}
                        <tr className="bg-[#114022] print:bg-transparent font-bold border-t-2 border-green-500 print:border-black"><td className="py-3 px-2 uppercase text-xs">GRAND TOTAL</td><td className="py-3 text-center text-teal-400 print:text-black">{totalQtySelesai}</td><td className="py-3 text-right text-green-400 print:text-black">{totalPendapatan.toLocaleString('id-ID')}</td></tr>
                     </tbody>
                  </table>
               </div>
               <div className="bg-[#092613] p-5 rounded-2xl border border-[#1b5e35] print:border-black print:bg-transparent print:text-black print:p-4 print:border">
                  <h4 className="font-bold text-white print:text-black mb-4 print:mb-2 border-b border-[#1b5e35] print:border-black pb-2 print:text-lg">Persentase Lama Parkir</h4>
                  <div className="space-y-4 print:space-y-3 mt-2">
                     {Object.keys(durasiStats).map(rentang => {
                        const count = durasiStats[rentang];
                        const persentase = totalQtySelesai > 0 ? ((count / totalQtySelesai) * 100).toFixed(1) : 0;
                        return (
                           <div key={rentang} className="relative">
                              <div className="flex justify-between text-xs print:text-xs font-bold text-green-100 mb-1 print:text-black"><span>{rentang}</span><span className="text-teal-400 print:text-black">{count} Unit ({persentase}%)</span></div>
                              <div className="w-full bg-[#114022] print:bg-transparent h-2.5 print:h-2.5 rounded-full overflow-hidden border print:border-black"><div className="bg-teal-500 print:bg-transparent border-r-2 border-black h-full rounded-full" style={{ width: `${persentase}%` }}></div></div>
                           </div>
                        );
                     })}
                  </div>
               </div>
            </div>
            
            {signatureBlock}
         </div>
      )}

      {/* TAB MASTER LIST (SEMUA TRANSAKSI - IN & OUT UNTUK PRINT 1 LEMBAR) */}
      {lapTab === 'semua' && (
         <div className="print-a4-layout bg-[#092613] rounded-2xl border border-[#1b5e35] print:border-none print:bg-transparent animate-in fade-in flex flex-col h-full">
            <div className="hidden-screen show-on-print border-b-2 border-black pb-2 mb-4 text-center">
                {webSettings.logoUrl && <img src={webSettings.logoUrl} className="h-10 mb-2 mx-auto" alt="Logo"/>}
                <h1 className="text-xl font-bold uppercase">Audit Keseluruhan Transaksi Area (In & Out)</h1>
                <p className="text-[10px] text-gray-600">Lokasi: {user.lokasi} | Periode: {periodeText} | Total Item: {filteredTx.length}</p>
                <p className="text-[8px] mt-1 text-gray-500">Dicetak: {new Date().toLocaleString('id-ID')} | {webSettings.appVersion || 'v.1.3.26'} | &copy; copyright by 200041</p>
            </div>
            
            <div className="overflow-x-auto hide-scrollbar flex-1 w-full">
               <table className="dense-table print:text-black text-white text-sm w-full">
                 <thead>
                   <tr className="bg-[#0c331a] print:bg-transparent text-green-300/70 print:text-black text-xs uppercase">
                     <th className="p-3 border-b border-[#1b5e35]">No</th>
                     <th className="p-3 border-b border-[#1b5e35]">Nopol</th>
                     <th className="p-3 border-b border-[#1b5e35]">Jenis</th>
                     <th className="p-3 border-b border-[#1b5e35] text-center">Status</th>
                     <th className="p-3 border-b border-[#1b5e35]">Masuk</th>
                     <th className="p-3 border-b border-[#1b5e35]">Keluar</th>
                     <th className="p-3 border-b border-[#1b5e35] text-right">Biaya (Rp)</th>
                   </tr>
                 </thead>
                 <tbody>
                   {filteredTx.slice().reverse().map((tx, i) => (
                     <tr key={tx.id} className="hover:bg-[#114022] print:bg-transparent border-b border-[#1b5e35]/50 transition-colors">
                       <td className="p-2 text-center text-green-200/70 print:text-black">{i+1}</td>
                       <td className="p-2 font-bold">{tx.nopol}</td>
                       <td className="p-2">{tx.jenis}</td>
                       <td className="p-2 text-center">
                          {tx.status === 'IN' ? (
                            <span className="bg-amber-900/50 text-amber-400 print:bg-transparent print:text-black print:font-bold px-2 py-0.5 rounded text-[10px]">Di Area</span>
                          ) : (
                            <span className="bg-green-900/50 text-green-400 print:bg-transparent print:text-black px-2 py-0.5 rounded text-[10px]">Selesai</span>
                          )}
                       </td>
                       <td className="p-2">{tx.waktuMasuk.toLocaleString('id-ID')}</td>
                       <td className="p-2">{tx.waktuKeluar ? tx.waktuKeluar.toLocaleString('id-ID') : '-'}</td>
                       <td className="p-2 text-right font-bold text-teal-400 print:text-black">{tx.totalBiaya ? tx.totalBiaya.toLocaleString('id-ID') : '0'}</td>
                     </tr>
                   ))}
                 </tbody>
               </table>
            </div>
            <p className="hidden-screen show-on-print text-[10px] mt-4 italic text-center text-gray-500">~ Akhir dari dokumen laporan audit ~</p>
            
            {signatureBlock}
         </div>
      )}

      {/* Tampilan Audit Area / Out Area tetap */}
      {lapTab === 'in_area' && (
         <div className="bg-[#092613] rounded-2xl border border-[#1b5e35] overflow-x-auto hide-on-print animate-in fade-in">
             <table className="w-full text-left border-collapse">
               <thead><tr className="bg-[#0c331a] text-green-300/70 text-xs uppercase"><th className="p-4 border-b border-[#1b5e35]">Waktu Masuk</th><th className="p-4 border-b border-[#1b5e35]">Nopol & Jenis</th><th className="p-4 border-b border-[#1b5e35]">Foto Masuk</th><th className="p-4 border-b border-[#1b5e35]">Petugas</th></tr></thead>
               <tbody>
                 {filteredTx.filter(t => t.status === 'IN').slice().reverse().map(tx => (
                   <tr key={tx.id} className="hover:bg-[#114022] border-b border-[#1b5e35]/50 text-sm transition-colors text-white">
                     <td className="p-4 text-green-200/70">{tx.waktuMasuk.toLocaleString('id-ID')}</td>
                     <td className="p-4 font-bold text-white">{tx.nopol} <span className="block text-xs text-green-400/50 mt-1">{tx.jenis}</span></td>
                     <td className="p-4">
                        {tx.fotoMasuk ? <img src={tx.fotoMasuk} onClick={()=>setZoomImg(tx.fotoMasuk)} className="w-20 h-14 object-cover rounded cursor-pointer border border-[#1b5e35] hover:opacity-80" alt="Masuk"/> : <span className="text-xs text-green-200/30">N/A</span>}
                     </td>
                     <td className="p-4 text-green-200/70">{tx.kasirMasuk}</td>
                   </tr>
                 ))}
               </tbody>
             </table>
         </div>
      )}

      {lapTab === 'out_area' && (
         <div className="bg-[#092613] rounded-2xl border border-[#1b5e35] overflow-x-auto hide-on-print animate-in fade-in">
             <table className="w-full text-left border-collapse">
               <thead><tr className="bg-[#0c331a] text-green-300/70 text-xs uppercase"><th className="p-4 border-b border-[#1b5e35]">Nopol</th><th className="p-4 border-b border-[#1b5e35]">Waktu</th><th className="p-4 border-b border-[#1b5e35]">Foto Masuk vs Keluar</th><th className="p-4 border-b border-[#1b5e35]">Biaya</th></tr></thead>
               <tbody>
                 {completedTx.slice().reverse().map(tx => (
                   <tr key={tx.id} className="hover:bg-[#114022] border-b border-[#1b5e35]/50 text-sm transition-colors text-white">
                     <td className="p-4 font-bold">{tx.nopol} <span className="block text-xs text-green-400/50 mt-1">{tx.jenis}</span></td>
                     <td className="p-4 text-xs text-green-200/70"><p>IN: {tx.waktuMasuk.toLocaleString('id-ID')}</p><p>OUT: {tx.waktuKeluar.toLocaleString('id-ID')}</p></td>
                     <td className="p-4 flex gap-2">
                        {tx.fotoMasuk ? <img src={tx.fotoMasuk} onClick={()=>setZoomImg(tx.fotoMasuk)} className="w-16 h-12 object-cover rounded cursor-pointer border border-[#1b5e35]" alt="In"/> : <div className="w-16 h-12 bg-black/50 border border-[#1b5e35] rounded flex items-center justify-center text-[8px] text-green-200/30">N/A</div>}
                        {tx.fotoKeluar ? <img src={tx.fotoKeluar} onClick={()=>setZoomImg(tx.fotoKeluar)} className="w-16 h-12 object-cover rounded cursor-pointer border border-[#1b5e35]" alt="Out"/> : <div className="w-16 h-12 bg-black/50 border border-[#1b5e35] rounded flex items-center justify-center text-[8px] text-green-200/30">N/A</div>}
                     </td>
                     <td className="p-4 font-bold text-green-400">Rp {tx.totalBiaya.toLocaleString('id-ID')} {tx.tiketHilang && <span className="text-red-500 block text-xs">(Denda Hilang Tiket)</span>}</td>
                   </tr>
                 ))}
               </tbody>
             </table>
         </div>
      )}

      {zoomImg && (
        <div className="fixed inset-0 z-[70] bg-black/95 flex items-center justify-center p-4 backdrop-blur-md hide-on-print" onClick={() => setZoomImg(null)}>
           <img src={zoomImg} className="max-w-[95vw] max-h-[90vh] rounded-2xl shadow-2xl border-4 border-[#1b5e35] object-contain" alt="Zoom"/>
           <button className="absolute top-6 right-6 text-white bg-red-600/50 hover:bg-red-600 p-3 rounded-full transition-colors"><X size={24}/></button>
        </div>
      )}
    </div>
  );
}

// Sub-Component Rekapan Global (Disesuaikan u/ Print 1 Lembar)
function RekapanLaporan({ transactions, user, settings }) {
  const [filterMode, setFilterMode] = useState('semua');
  const [filterDate, setFilterDate] = useState(new Date().toISOString().slice(0, 10));
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7));
  const [filterYear, setFilterYear] = useState(new Date().getFullYear().toString());
  const locShifts = getLocSettings(settings, user.lokasi).shifts || [];
  const [filterShift, setFilterShift] = useState(locShifts[0]?.id || '');
  const webSettings = settings?.web || {};

  // STATE UNTUK FILTER YANG DITERAPKAN SETELAH TOMBOL CARI DIKLIK
  const [appliedFilter, setAppliedFilter] = useState({
     mode: 'semua', date: filterDate, month: filterMonth, year: filterYear, shift: filterShift
  });

  const handleApplyFilter = () => {
     setAppliedFilter({ mode: filterMode, date: filterDate, month: filterMonth, year: filterYear, shift: filterShift });
  };

  let baseCompleted = transactions.filter(t => t.status === 'OUT');
  
  const completed = baseCompleted.filter(tx => {
      if (appliedFilter.mode === 'semua') return true;

      const txDate = tx.waktuKeluar || tx.waktuMasuk;
      if (!txDate) return false;

      if (appliedFilter.mode === 'harian') {
          const selected = new Date(appliedFilter.date);
          const start = new Date(selected); start.setHours(6, 0, 0, 0);
          const end = new Date(selected); end.setDate(end.getDate() + 1); end.setHours(5, 59, 59, 999);
          return txDate >= start && txDate <= end;
      }
      if (appliedFilter.mode === 'shift') {
          const selected = new Date(appliedFilter.date);
          const startDay = new Date(selected); startDay.setHours(6, 0, 0, 0);
          const endDay = new Date(selected); endDay.setDate(endDay.getDate() + 1); endDay.setHours(5, 59, 59, 999);

          if (!(txDate >= startDay && txDate <= endDay)) return false;

          const selectedShift = locShifts.find(s => s.id === appliedFilter.shift) || locShifts[0];
          if(!selectedShift) return true;

          const startH = parseInt(selectedShift.start.split(':')[0]);
          const startM = parseInt(selectedShift.start.split(':')[1]);
          const endH = parseInt(selectedShift.end.split(':')[0]);
          const endM = parseInt(selectedShift.end.split(':')[1]);

          const txTotalM = txDate.getHours() * 60 + txDate.getMinutes();
          const startTotalM = startH * 60 + startM;
          const endTotalM = endH * 60 + endM;

          if (startTotalM <= endTotalM) {
              return txTotalM >= startTotalM && txTotalM <= endTotalM;
          } else {
              return txTotalM >= startTotalM || txTotalM <= endTotalM;
          }
      }
      if (appliedFilter.mode === 'bulanan') {
          const txMonth = txDate.getFullYear() + '-' + String(txDate.getMonth() + 1).padStart(2, '0');
          return txMonth === appliedFilter.month;
      }
      if (appliedFilter.mode === 'tahunan') {
          return txDate.getFullYear().toString() === appliedFilter.year;
      }
      return true;
  });

  const total = completed.reduce((a, b) => a + (b.totalBiaya || 0), 0);
  
  let periodeText = "Semua Waktu";
  if(appliedFilter.mode === 'harian') periodeText = `Harian (${appliedFilter.date})`;
  if(appliedFilter.mode === 'shift') periodeText = `Shift (${appliedFilter.date} - ${locShifts.find(s=>s.id===appliedFilter.shift)?.name || ''})`;
  if(appliedFilter.mode === 'bulanan') periodeText = `Bulan (${appliedFilter.month})`;
  if(appliedFilter.mode === 'tahunan') periodeText = `Tahun (${appliedFilter.year})`;

  const signatureBlock = (
     <div className="hidden-screen show-on-print mt-12 print:text-black font-sans w-full pb-8">
         <div className="flex justify-between px-10">
            <div className="text-center w-40">
               <p className="text-sm">Mengetahui,</p>
               <p className="text-sm font-bold mb-16">Pimpinan / Manager</p>
               <div className="border-b-[1.5px] border-black w-full"></div>
            </div>
            
            <div className="text-center w-40">
               <p className="text-sm">Dicetak Oleh,</p>
               <p className="text-sm font-bold mb-16">Petugas Bertugas</p>
               <p className="border-b-[1.5px] border-black font-bold uppercase w-full pb-1">{user.nama}</p>
               <p className="text-[10px] mt-1 uppercase">{user.role}</p>
            </div>
         </div>
     </div>
  );
  
  const handleExportExcel = () => {
    let csvContent = "data:text/csv;charset=utf-8,\uFEFFID,Lokasi,Nomor Polisi,Jenis Kendaraan,Status,Waktu Masuk,Waktu Keluar,Lama Parkir,Total Biaya,Kasir Keluar,Tiket Hilang\n";
    completed.forEach(t => {
      const wMasuk = t.waktuMasuk ? t.waktuMasuk.toLocaleString('id-ID').replace(/,/g, '') : '-';
      const wKeluar = t.waktuKeluar ? t.waktuKeluar.toLocaleString('id-ID').replace(/,/g, '') : '-';
      const row = [t.id, t.lokasi, t.nopol, t.jenis, t.status, wMasuk, wKeluar, t.durasiText || '-', t.totalBiaya || 0, t.kasirKeluar || '-', t.tiketHilang ? 'YA' : 'TIDAK'].map(v => `"${v}"`).join(",");
      csvContent += row + "\n";
    });
    const link = document.createElement("a");
    link.href = encodeURI(csvContent);
    link.download = `Rekapan_Global_Parkir_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
  };

  return (
    <div className="space-y-6 print-a4-layout">
       {/* FILTER BAR TRANSAKSI */}
       <div className="bg-[#092613] p-4 rounded-xl border border-[#1b5e35] hide-on-print flex flex-wrap items-end gap-4">
          <div>
             <label className="block text-xs text-green-200/70 mb-1">Filter Periode</label>
             <select value={filterMode} onChange={e=>setFilterMode(e.target.value)} className="bg-[#114022] border border-[#1b5e35] p-2 rounded-lg text-white outline-none focus:border-green-500 text-sm">
                <option value="semua">Semua Waktu</option>
                <option value="shift">Per Shift</option>
                <option value="harian">Akhir Hari (Cutoff 06:00)</option>
                <option value="bulanan">Per Bulan</option>
                <option value="tahunan">Per Tahun</option>
             </select>
          </div>
          
          {(filterMode === 'shift' || filterMode === 'harian') && (
             <div>
                <label className="block text-xs text-green-200/70 mb-1">Tanggal</label>
                <input type="date" value={filterDate} onChange={e=>setFilterDate(e.target.value)} className="bg-[#114022] border border-[#1b5e35] p-2 rounded-lg text-white outline-none focus:border-green-500 text-sm" />
             </div>
          )}

          {filterMode === 'shift' && (
             <div>
                <label className="block text-xs text-green-200/70 mb-1">Pilih Shift</label>
                <select value={filterShift} onChange={e=>setFilterShift(e.target.value)} className="bg-[#114022] border border-[#1b5e35] p-2 rounded-lg text-white outline-none focus:border-green-500 text-sm">
                   {locShifts.map(s => <option key={s.id} value={s.id}>{s.name} ({s.start}-{s.end})</option>)}
                </select>
             </div>
          )}

          {filterMode === 'bulanan' && (
             <div>
                <label className="block text-xs text-green-200/70 mb-1">Bulan</label>
                <input type="month" value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} className="bg-[#114022] border border-[#1b5e35] p-2 rounded-lg text-white outline-none focus:border-green-500 text-sm" />
             </div>
          )}

          {filterMode === 'tahunan' && (
             <div>
                <label className="block text-xs text-green-200/70 mb-1">Tahun</label>
                <select value={filterYear} onChange={e=>setFilterYear(e.target.value)} className="bg-[#114022] border border-[#1b5e35] p-2 rounded-lg text-white outline-none focus:border-green-500 text-sm">
                   {[0,1,2,3,4].map(y => {
                      const year = new Date().getFullYear() - y;
                      return <option key={year} value={year.toString()}>{year}</option>
                   })}
                </select>
             </div>
          )}
          
          <button onClick={handleApplyFilter} className="bg-teal-600 hover:bg-teal-500 text-white px-6 py-2 rounded-lg font-bold text-sm h-[38px] flex items-center gap-2 shadow-lg transition-all active:scale-95">
             <Search size={16}/> Cari
          </button>
       </div>

       <div className="hidden-screen show-on-print border-b-2 border-black pb-4 mb-4 text-center">
           {webSettings.logoUrl && <img src={webSettings.logoUrl} className="h-10 mb-2 mx-auto" alt="Logo"/>}
           <h1 className="text-xl font-bold uppercase">Rekapan Global Semua Lokasi</h1>
           <p className="text-xs text-gray-600">Periode: {periodeText} | Master: {user.nama} | Total Item: {completed.length}</p>
           <p className="text-[10px] mt-1 text-gray-500">Dicetak: {new Date().toLocaleString('id-ID')} | {webSettings.appVersion || 'v.1.3.26'} | &copy; copyright by 200041</p>
       </div>

       <div className="bg-teal-900/30 border border-teal-500/30 p-6 print:p-4 print:border-black print:border-2 print:bg-transparent rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div><p className="text-sm print:text-xs font-bold text-teal-400 print:text-black">Total Pendapatan Global Semua Lokasi</p><h2 className="text-4xl print:text-2xl font-black text-white print:text-black">Rp {total.toLocaleString('id-ID')}</h2></div>
          <div className="flex gap-2 hide-on-print">
            <button onClick={() => window.print()} className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-bold shadow-lg"><Download size={16} /> Print Laporan Rekapan</button>
            <button onClick={handleExportExcel} className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-bold shadow-lg"><FileText size={16} /> XLSX/CSV</button>
          </div>
       </div>

       <div className="overflow-x-auto hide-scrollbar flex-1 w-full">
          <table className="dense-table print:text-black text-white text-sm w-full">
             <thead>
                <tr className="bg-[#0c331a] print:bg-transparent text-green-300/70 print:text-black text-xs uppercase">
                   <th className="p-3 border-b border-[#1b5e35]">Lokasi</th>
                   <th className="p-3 border-b border-[#1b5e35]">Nopol</th>
                   <th className="p-3 border-b border-[#1b5e35]">Jenis</th>
                   <th className="p-3 border-b border-[#1b5e35]">Keluar</th>
                   <th className="p-3 border-b border-[#1b5e35] text-right">Biaya (Rp)</th>
                </tr>
             </thead>
             <tbody>
                {completed.slice().reverse().map((tx) => (
                   <tr key={tx.id} className="hover:bg-[#114022] print:bg-transparent border-b border-[#1b5e35]/50 transition-colors">
                      <td className="p-2 text-teal-400 print:text-black font-bold">{tx.lokasi}</td>
                      <td className="p-2 font-bold">{tx.nopol}</td>
                      <td className="p-2">{tx.jenis}</td>
                      <td className="p-2 text-green-200/70 print:text-black">{tx.waktuKeluar.toLocaleString('id-ID')}</td>
                      <td className="p-2 text-right font-bold text-teal-400 print:text-black">{tx.totalBiaya.toLocaleString('id-ID')}</td>
                   </tr>
                ))}
             </tbody>
          </table>
       </div>
       
       {signatureBlock}
    </div>
  );
}

// Sub-Setting: Shift
function SettingShift({ settings, setSettings, isReadOnly, user, showToast }) {
  const [targetLokasi, setTargetLokasi] = useState(user.lokasi === 'All Lokasi' ? PURE_LOCATIONS[0] : user.lokasi);
  const locSettings = getLocSettings(settings, targetLokasi);
  const [shifts, setShifts] = useState(locSettings.shifts || DEFAULT_LOCATION_SETTINGS.shifts);

  useEffect(() => { setShifts(getLocSettings(settings, targetLokasi).shifts || DEFAULT_LOCATION_SETTINGS.shifts); }, [targetLokasi, settings]);

  const handleSave = () => {
    const newLocations = { ...settings.locations, [targetLokasi]: { ...getLocSettings(settings, targetLokasi), shifts: shifts } };
    setSettings({ ...settings, locations: newLocations });
    showToast(`Setingan Jam Shift untuk ${targetLokasi} Tersimpan!`);
  };

  const updateShift = (index, field, val) => {
    let formattedVal = val.replace(/[^0-9:]/g, '');
    if (formattedVal.length === 2 && !formattedVal.includes(':') && val.length > shifts[index][field].length) formattedVal += ':';
    const updated = [...shifts];
    updated[index][field] = formattedVal;
    setShifts(updated);
  };

  return (
    <div className="space-y-6">
       <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3 text-white"><Clock size={20}/> <h3 className="font-bold text-lg">Konfigurasi Waktu Shift</h3></div>
          {user.role === 'master' && (
             <select value={targetLokasi} onChange={e=>setTargetLokasi(e.target.value)} className="bg-[#114022] border border-teal-500 text-white p-2 rounded-lg outline-none font-bold text-sm">
                {PURE_LOCATIONS.map(loc => <option key={loc} value={loc}>Setting Lokasi: {loc}</option>)}
             </select>
          )}
       </div>
       <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         {shifts.map((shift, idx) => (
           <div key={shift.id} className="bg-[#092613] p-5 rounded-xl border border-[#1b5e35]">
              <h4 className="font-bold text-green-400 mb-4 pb-2 border-b border-[#1b5e35]">{shift.name}</h4>
              <div className="space-y-3">
                 <div>
                    <label className="block text-xs text-green-200/70 mb-1">Jam Mulai (24H)</label>
                    <input type="text" maxLength="5" disabled={isReadOnly} value={shift.start} onChange={e => updateShift(idx, 'start', e.target.value)} placeholder="00:00" className="w-full bg-[#114022] border border-[#1b5e35] p-2 rounded-lg text-white outline-none focus:border-green-500 font-mono" />
                 </div>
                 <div>
                    <label className="block text-xs text-green-200/70 mb-1">Jam Selesai (24H)</label>
                    <input type="text" maxLength="5" disabled={isReadOnly} value={shift.end} onChange={e => updateShift(idx, 'end', e.target.value)} placeholder="23:59" className="w-full bg-[#114022] border border-[#1b5e35] p-2 rounded-lg text-white outline-none focus:border-green-500 font-mono" />
                 </div>
              </div>
           </div>
         ))}
       </div>
       {!isReadOnly && <button onClick={handleSave} className="w-full bg-green-600 text-white font-bold py-4 rounded-xl shadow-lg hover:bg-green-500 transition-all flex justify-center gap-2"><CheckCircle2 size={20}/> Simpan Waktu Shift ({targetLokasi})</button>}
    </div>
  );
}

// Sub-Setting: User Management
function SettingUser({ settings, setSettings, showToast }) {
  const [usersList, setUsersList] = useState(settings.users || DEFAULT_SETTINGS.users);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ id: '', nipp: '', nama: '', password: '', role: 'kasir', canViewArea: false });

  const submitForm = (e) => {
    e.preventDefault();
    let newList;
    if (form.id) {
       newList = usersList.map(u => u.id === form.id ? form : u);
    } else {
       newList = [...usersList, { ...form, id: `u_${Date.now()}` }];
    }
    
    setUsersList(newList);
    setSettings({ ...settings, users: newList });
    
    setShowForm(false);
    setForm({ id: '', nipp: '', nama: '', password: '', role: 'kasir', canViewArea: false });
    showToast("Akun berhasil disimpan ke database utama!");
  };

  const hapusUser = (id) => {
    if (usersList.find(u => u.id === id).role === 'master') return showToast("Akun Master tidak bisa dihapus!", "error");
    const newList = usersList.filter(u => u.id !== id);
    
    setUsersList(newList);
    setSettings({ ...settings, users: newList });
    showToast("Akun berhasil dihapus!");
  };

  return (
    <div className="space-y-6">
       <div className="flex justify-between items-center">
          <div className="flex items-center gap-3 text-white"><Users size={20}/> <h3 className="font-bold text-lg">Manajemen User</h3></div>
          <button onClick={() => setShowForm(!showForm)} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-blue-500 transition">{showForm ? 'Batal' : '+ Tambah Akun'}</button>
       </div>

       {showForm && (
          <form onSubmit={submitForm} className="bg-[#092613] p-6 rounded-2xl border border-[#1b5e35] space-y-4 animate-in fade-in">
             <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-xs text-green-200/70 mb-1">NIPP / Username</label><input required type="text" value={form.nipp} onChange={e=>setForm({...form, nipp: e.target.value})} className="w-full bg-[#114022] border border-[#1b5e35] p-2 rounded-lg text-white outline-none focus:border-green-500" /></div>
                <div><label className="block text-xs text-green-200/70 mb-1">Nama Lengkap</label><input required type="text" value={form.nama} onChange={e=>setForm({...form, nama: e.target.value})} className="w-full bg-[#114022] border border-[#1b5e35] p-2 rounded-lg text-white outline-none focus:border-green-500" /></div>
                <div><label className="block text-xs text-green-200/70 mb-1">Password</label><input required type="text" value={form.password} onChange={e=>setForm({...form, password: e.target.value})} className="w-full bg-[#114022] border border-[#1b5e35] p-2 rounded-lg text-white outline-none focus:border-green-500" /></div>
                <div>
                   <label className="block text-xs text-green-200/70 mb-1">Role Jabatan</label>
                   <select value={form.role} onChange={e=>setForm({...form, role: e.target.value})} className="w-full bg-[#114022] border border-[#1b5e35] p-2 rounded-lg text-white outline-none focus:border-green-500">
                      <option value="kasir">Kasir Biasa</option><option value="korlap">Korlap</option><option value="audit">Audit</option><option value="master">Master</option>
                   </select>
                </div>
             </div>
             {form.role === 'korlap' && (
                <div className="pt-2">
                   <label className="flex items-center gap-2 text-sm text-orange-300 cursor-pointer">
                      <input type="checkbox" checked={form.canViewArea} onChange={e => setForm({...form, canViewArea: e.target.checked})} className="rounded accent-orange-500 w-4 h-4" />
                      Izinkan Korlap Melihat Daftar Kendaraan Area?
                   </label>
                </div>
             )}
             <button type="submit" className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl mt-4 hover:bg-blue-500 transition shadow-lg">{form.id ? 'Update & Auto-Save Akun' : 'Buat & Auto-Save Akun'}</button>
          </form>
       )}

       <div className="overflow-x-auto bg-[#092613] rounded-xl border border-[#1b5e35]">
          <table className="w-full text-left border-collapse min-w-[500px]">
             <thead><tr className="bg-[#0c331a] text-green-300/70 text-xs uppercase"><th className="p-3">NIPP</th><th className="p-3">Nama</th><th className="p-3">Role</th><th className="p-3">Akses Khusus</th><th className="p-3 text-right">Aksi</th></tr></thead>
             <tbody>
                {usersList.map(u => (
                   <tr key={u.id} className="border-b border-[#1b5e35] text-sm text-white hover:bg-[#114022]">
                      <td className="p-3 font-bold">{u.nipp}</td><td className="p-3">{u.nama}</td>
                      <td className="p-3"><span className="px-2 py-1 text-[10px] rounded-md font-bold bg-[#092613] border border-[#1b5e35] uppercase">{u.role}</span></td>
                      <td className="p-3 text-[11px] text-green-200/70">{u.role === 'korlap' && (u.canViewArea ? 'Bisa Lihat Area' : 'Dilarang Lihat Area')} {u.role === 'audit' && 'Read-Only'}</td>
                      <td className="p-3 text-right">
                         <button onClick={() => { setForm(u); setShowForm(true); }} className="text-blue-400 hover:text-blue-300 mr-3 text-xs">Edit</button>
                         {u.role !== 'master' && <button onClick={() => hapusUser(u.id)} className="text-red-400 hover:text-red-300 text-xs">Hapus</button>}
                      </td>
                   </tr>
                ))}
             </tbody>
          </table>
       </div>
    </div>
  );
}

// Sub-Setting: Setting Tarif Rinci Multi-Lokasi
function SettingTarif({ settings, setSettings, isReadOnly, user, showToast }) {
  const [targetLokasi, setTargetLokasi] = useState(user.lokasi === 'All Lokasi' ? PURE_LOCATIONS[0] : user.lokasi);
  const locSettings = getLocSettings(settings, targetLokasi);
  const [localTariff, setLocalTariff] = useState(locSettings.tariffs || DEFAULT_LOCATION_SETTINGS.tariffs);

  // BUG FIX & FITUR BARU: Kuncian per jenis kendaraan untuk mencegah salah tekan
  const [locked, setLocked] = useState({
     'Motor': true,
     'Mobil': true,
     'Box/Truck': true,
     'Sepeda/Becak': true
  });

  // BUG FIX: Hapus `settings` dari dependency agar auto-sync background tidak mereset input yang sedang diketik
  useEffect(() => { 
     setLocalTariff(getLocSettings(settings, targetLokasi).tariffs || DEFAULT_LOCATION_SETTINGS.tariffs); 
     // Reset kuncian saat ganti lokasi
     setLocked({ 'Motor': true, 'Mobil': true, 'Box/Truck': true, 'Sepeda/Becak': true });
  }, [targetLokasi]); 

  const updateTariff = (jenis, field, val) => {
    setLocalTariff(prev => ({ ...prev, [jenis]: { ...prev[jenis], [field]: field === 'mode' || typeof val === 'boolean' ? val : Number(val) } }));
  };

  const toggleEdit = (jenis) => {
     setLocked(prev => ({ ...prev, [jenis]: false }));
  };

  const handleSaveJenis = (jenis) => {
     const newLocations = { 
         ...settings.locations, 
         [targetLokasi]: { 
             ...getLocSettings(settings, targetLokasi), 
             tariffs: {
                 ...(getLocSettings(settings, targetLokasi).tariffs || DEFAULT_LOCATION_SETTINGS.tariffs),
                 [jenis]: localTariff[jenis]
             }
         } 
     };
     setSettings({ ...settings, locations: newLocations });
     setLocked(prev => ({ ...prev, [jenis]: true }));
     showToast(`Tarif ${jenis} di lokasi ${targetLokasi} berhasil diperbarui & dikunci!`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
         <h3 className="font-bold text-lg text-white">Konfigurasi Tarif</h3>
         {user.role === 'master' && (
             <select value={targetLokasi} onChange={e=>setTargetLokasi(e.target.value)} className="bg-[#114022] border border-teal-500 text-white p-2 rounded-lg outline-none font-bold text-sm">
                {PURE_LOCATIONS.map(loc => <option key={loc} value={loc}>Setting Lokasi: {loc}</option>)}
             </select>
         )}
      </div>

      <div className="space-y-6">
        {Object.keys(localTariff).map(jenis => (
          <div key={jenis} className={`border ${locked[jenis] ? 'border-[#1b5e35]' : 'border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.15)]'} rounded-2xl p-5 bg-[#092613] transition-all duration-300`}>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
              <div className="flex items-center gap-3">
                 <h4 className="font-bold text-lg text-white border-b-2 border-green-500 pb-1">{jenis}</h4>
                 {locked[jenis] ? (
                     <span className="bg-[#114022] text-green-500 border border-[#1b5e35] text-[10px] px-2 py-1 rounded font-bold uppercase flex items-center gap-1"><Lock size={12}/> Terkunci</span>
                 ) : (
                     <span className="bg-amber-900/50 text-amber-400 border border-amber-500/50 text-[10px] px-2 py-1 rounded font-bold uppercase flex items-center gap-1"><Settings size={12}/> Mode Edit Aktif</span>
                 )}
              </div>
              <div className="flex bg-[#114022] rounded-xl p-1 border border-[#1b5e35]">
                 <button disabled={isReadOnly || locked[jenis]} onClick={() => updateTariff(jenis, 'mode', 'progressif')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${localTariff[jenis].mode === 'progressif' ? 'bg-green-600 text-white shadow-sm' : 'text-green-300/50 hover:text-white'}`}>Progressif</button>
                 <button disabled={isReadOnly || locked[jenis]} onClick={() => updateTariff(jenis, 'mode', 'flat')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${localTariff[jenis].mode === 'flat' ? 'bg-green-600 text-white shadow-sm' : 'text-green-300/50 hover:text-white'}`}>Flat</button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div>
                <label className="block text-xs text-green-200/70 mb-1">Jam Pertama (Rp)</label>
                <input disabled={isReadOnly || locked[jenis]} type="number" value={localTariff[jenis].first} onChange={e => updateTariff(jenis, 'first', e.target.value)} className="w-full bg-[#114022] border border-[#1b5e35] rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-amber-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" />
              </div>
              <div className={localTariff[jenis].mode === 'flat' ? 'opacity-50 pointer-events-none' : ''}>
                <label className="block text-xs text-green-200/70 mb-1">Durasi Awal</label>
                <select disabled={isReadOnly || locked[jenis]} value={localTariff[jenis].firstDuration} onChange={e => updateTariff(jenis, 'firstDuration', e.target.value)} className="w-full bg-[#114022] border border-[#1b5e35] rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-amber-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                  {[...Array(24).keys()].map(i => <option key={i+1} value={i+1}>{i+1} Jam</option>)}
                </select>
              </div>
              <div className={localTariff[jenis].mode === 'flat' ? 'opacity-50 pointer-events-none' : ''}>
                <label className="block text-xs text-green-200/70 mb-1">Jam Berikutnya (Rp)</label>
                <input disabled={isReadOnly || locked[jenis]} type="number" value={localTariff[jenis].next} onChange={e => updateTariff(jenis, 'next', e.target.value)} className="w-full bg-[#114022] border border-[#1b5e35] rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-amber-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" />
              </div>
              <div className={localTariff[jenis].mode === 'flat' ? 'opacity-50 pointer-events-none' : ''}>
                <label className="block text-xs text-green-200/70 mb-1">Tarif Maksimal (Rp)</label>
                <input disabled={isReadOnly || locked[jenis]} type="number" value={localTariff[jenis].max} onChange={e => updateTariff(jenis, 'max', e.target.value)} className="w-full bg-[#114022] border border-[#1b5e35] rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-amber-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" />
              </div>
              <div className={localTariff[jenis].mode === 'flat' ? 'opacity-50 pointer-events-none' : ''}>
                <label className="block text-xs text-green-200/70 mb-1">Tarif Inap/Hari (Rp)</label>
                <input disabled={isReadOnly || locked[jenis]} type="number" value={localTariff[jenis].inap} onChange={e => updateTariff(jenis, 'inap', e.target.value)} className="w-full bg-[#114022] border border-[#1b5e35] rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-amber-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" />
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-[#1b5e35] flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
               <div className="flex items-center gap-4">
                   <label className={`flex items-center gap-2 text-sm cursor-pointer ${locked[jenis] ? 'text-green-200/40' : 'text-green-200/70'}`}>
                      <input type="checkbox" disabled={isReadOnly || locked[jenis]} checked={localTariff[jenis].gracePeriodActive} onChange={e => updateTariff(jenis, 'gracePeriodActive', e.target.checked)} className="rounded accent-amber-500 w-4 h-4 disabled:opacity-50 disabled:cursor-not-allowed" />
                      Aktifkan Grace Periode
                   </label>
                   {localTariff[jenis].gracePeriodActive && (
                      <div className="flex items-center gap-2 animate-in fade-in">
                         <span className={`text-xs ${locked[jenis] ? 'text-green-200/40' : 'text-green-200/70'}`}>Berapa menit?</span>
                         <input disabled={isReadOnly || locked[jenis]} type="number" value={localTariff[jenis].gracePeriodMinutes} onChange={e => updateTariff(jenis, 'gracePeriodMinutes', e.target.value)} className="w-20 bg-[#114022] border border-[#1b5e35] rounded-lg px-2 py-1 text-sm text-white outline-none focus:border-amber-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" />
                      </div>
                   )}
               </div>

               {/* TOMBOL KUNCI / SIMPAN PER JENIS */}
               <div className="w-full md:w-auto flex justify-end">
                   {!isReadOnly && (
                       locked[jenis] ? (
                           <button onClick={() => toggleEdit(jenis)} className="w-full md:w-auto bg-[#114022] border border-[#1b5e35] hover:bg-[#164d2b] text-white px-4 py-2 rounded-xl text-xs font-bold flex justify-center items-center gap-2 transition-all">
                               <Lock size={14}/> Buka Kunci Edit
                           </button>
                       ) : (
                           <button onClick={() => handleSaveJenis(jenis)} className="w-full md:w-auto bg-amber-600 hover:bg-amber-500 text-white px-5 py-2 rounded-xl text-xs font-bold flex justify-center items-center gap-2 shadow-lg shadow-amber-600/20 transition-all animate-in zoom-in-95">
                               <CheckCircle2 size={16}/> Simpan & Kunci {jenis}
                           </button>
                       )
                   )}
               </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Sub-Setting: Member Parkir
function SettingMember({ settings, setSettings, isReadOnly, user, showToast }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ nipp: '', nopol: '', masaBerlaku: 'Bulanan', fotoSTNK: null, fotoKartuPegawai: null });

  const membersList = settings.members || [];

  const handleAdd = (e) => {
    e.preventDefault();
    if (!form.fotoSTNK || !form.fotoKartuPegawai) return showToast("Mohon Upload Foto STNK dan Kartu Pegawai!", "error");
    const newMember = { ...form, id: Date.now(), status: 'Pending' };
    setSettings({ ...settings, members: [...membersList, newMember] });
    setShowAdd(false);
    setForm({ nipp: '', nopol: '', masaBerlaku: 'Bulanan', fotoSTNK: null, fotoKartuPegawai: null });
    showToast("Berhasil diajukan!");
  };

  const handleVerif = (id) => {
    if (user.role !== 'master') return showToast("Hanya Master yang bisa verifikasi.", "error");
    const updated = membersList.map(m => m.id === id ? { ...m, status: 'Aktif' } : m);
    setSettings({ ...settings, members: updated });
    showToast("Member Diverifikasi!");
  };

  return (
    <div className="space-y-6">
       <div className="flex justify-between items-center">
          <h3 className="font-bold text-lg text-white">Daftar Member (Parkir Gratis)</h3>
          {(user.role === 'master' || user.role === 'korlap') && (
            <button onClick={() => setShowAdd(!showAdd)} className="bg-[#1b5e35] text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-[#258249] transition">+ Tambah Member</button>
          )}
       </div>

       {showAdd && (
          <form onSubmit={handleAdd} className="bg-[#092613] p-6 rounded-2xl border border-[#1b5e35] space-y-4">
             <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-xs text-green-200/70 mb-1">NIPP Pegawai</label><input required type="text" value={form.nipp} onChange={e=>setForm({...form, nipp: e.target.value})} className="w-full bg-[#114022] border border-[#1b5e35] p-2 rounded-lg text-white outline-none focus:border-green-500" /></div>
                <div><label className="block text-xs text-green-200/70 mb-1">Nopol Kendaraan</label><input required type="text" value={form.nopol} onChange={e=>setForm({...form, nopol: e.target.value.toUpperCase()})} className="w-full bg-[#114022] border border-[#1b5e35] p-2 rounded-lg text-white outline-none focus:border-green-500" /></div>
             </div>
             
             <div className="grid grid-cols-2 gap-4 mt-2 border-t border-[#1b5e35] pt-4">
                <div className="text-center">
                   <p className="text-xs font-bold text-green-200/70 mb-2">Upload STNK</p>
                   {form.fotoSTNK ? <img src={form.fotoSTNK} className="h-24 w-full object-cover rounded mb-2 border border-[#1b5e35]" alt="STNK"/> : <div className="h-24 bg-[#114022] rounded mb-2 flex items-center justify-center text-green-300/30 border border-[#1b5e35]"><FileImage/></div>}
                   <input type="file" id="upload-member-stnk" accept="image/*" className="hidden" onChange={(e) => processImageFile(e.target.files[0], (d)=>setForm({...form, fotoSTNK: d}))} />
                   <label htmlFor="upload-member-stnk" className="bg-orange-600 text-white text-xs py-2 px-4 rounded-lg cursor-pointer hover:bg-orange-500 block font-bold">Pilih Foto STNK</label>
                </div>
                <div className="text-center">
                   <p className="text-xs font-bold text-green-200/70 mb-2">Upload Kartu Pegawai</p>
                   {form.fotoKartuPegawai ? <img src={form.fotoKartuPegawai} className="h-24 w-full object-cover rounded mb-2 border border-[#1b5e35]" alt="Kartu"/> : <div className="h-24 bg-[#114022] rounded mb-2 flex items-center justify-center text-green-300/30 border border-[#1b5e35]"><FileImage/></div>}
                   <input type="file" id="upload-member-kartu" accept="image/*" className="hidden" onChange={(e) => processImageFile(e.target.files[0], (d)=>setForm({...form, fotoKartuPegawai: d}))} />
                   <label htmlFor="upload-member-kartu" className="bg-blue-600 text-white text-xs py-2 px-4 rounded-lg cursor-pointer hover:bg-blue-500 block font-bold">Pilih Kartu Pegawai</label>
                </div>
             </div>

             <div className="pt-2">
                <label className="block text-xs text-green-200/70 mb-1">Masa Berlaku</label>
                <select value={form.masaBerlaku} onChange={e=>setForm({...form, masaBerlaku: e.target.value})} className="w-full bg-[#114022] border border-[#1b5e35] p-2 rounded-lg text-white outline-none focus:border-green-500"><option>Bulanan</option><option>Tahunan</option></select>
             </div>
             <button type="submit" className="w-full bg-green-600 text-white font-bold py-3 rounded-xl mt-4 hover:bg-green-500 transition">Ajukan Member</button>
          </form>
       )}

       <div className="overflow-x-auto bg-[#092613] rounded-xl border border-[#1b5e35]">
          <table className="w-full text-left border-collapse">
             <thead><tr className="bg-[#0c331a] text-green-300/70 text-xs uppercase"><th className="p-3">NIPP</th><th className="p-3">Nopol</th><th className="p-3">Berlaku</th><th className="p-3">Status</th><th className="p-3">Aksi</th></tr></thead>
             <tbody>
                {membersList.length === 0 && <tr><td colSpan="5" className="p-4 text-center text-green-300/30 text-sm">Belum ada data member.</td></tr>}
                {membersList.map(m => (
                   <tr key={m.id} className="border-b border-[#1b5e35] text-sm text-white hover:bg-[#114022]">
                      <td className="p-3 font-bold">{m.nipp}</td><td className="p-3 font-bold">{m.nopol}</td><td className="p-3 text-green-200/70">{m.masaBerlaku}</td>
                      <td className="p-3"><span className={`px-2 py-1 text-[10px] rounded-md font-bold ${m.status === 'Aktif' ? 'bg-green-900/50 text-green-400' : 'bg-orange-900/50 text-orange-400'}`}>{m.status}</span></td>
                      <td className="p-3">
                         {m.status === 'Pending' && user.role === 'master' && (
                            <button onClick={() => handleVerif(m.id)} className="bg-teal-600 hover:bg-teal-500 text-white px-3 py-1 text-xs rounded-md font-bold">Verifikasi</button>
                         )}
                      </td>
                   </tr>
                ))}
             </tbody>
          </table>
       </div>
    </div>
  );
}

// Sub-Setting: Web & Printer 
function SettingWeb({ settings, setSettings, isReadOnly, showToast }) {
  const [form, setForm] = useState(settings.web || DEFAULT_SETTINGS.web);
  
  const handleLogoUpload = (e) => {
    processImageFile(e.target.files[0], (data) => setForm({...form, logoUrl: data}));
  };

  const handleSave = (e) => { e.preventDefault(); setSettings({ ...settings, web: form }); showToast("Pengaturan Web Tersimpan!"); };

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="bg-[#092613] p-5 rounded-2xl border border-[#1b5e35]">
         <h4 className="font-bold text-white mb-2 uppercase text-sm flex items-center gap-2"><Bluetooth size={18} className="text-teal-400"/> Pengaturan Printer Default</h4>
         <p className="text-xs text-green-200/70 leading-relaxed mb-4">Aplikasi ini telah dioptimalkan untuk menggunakan pencetakan otomatis (<strong>Direct Background Print</strong>).</p>
         <div className="bg-[#114022] p-4 rounded-xl border border-[#1b5e35]">
            <ol className="text-xs text-green-200/60 list-decimal ml-4 space-y-2">
               <li><strong>Android:</strong> Wajib install aplikasi <strong>RawBT</strong> Print Service. Aktifkan fitur <em>"Don't ask before print"</em> agar struk otomatis keluar seketika.</li>
               <li>Pastikan Printer Thermal Bluetooth Anda sudah di-pairing (dipasangkan) di setingan Bluetooth HP.</li>
            </ol>
         </div>
      </div>

      <div className="bg-[#092613] p-5 rounded-2xl border border-[#1b5e35] flex flex-col items-center text-center">
        <p className="text-sm font-bold text-green-200/70 mb-4 uppercase">Logo Perusahaan</p>
        <img src={form.logoUrl} alt="Logo" className="h-20 bg-white/10 rounded-xl px-4 py-2 mb-4 object-contain" />
        {!isReadOnly && (
          <div>
            <input type="file" id="upload-logo" accept="image/*" className="hidden" onChange={handleLogoUpload} />
            <label htmlFor="upload-logo" className="bg-green-600 hover:bg-green-500 text-white font-bold py-2 px-6 rounded-xl cursor-pointer inline-flex items-center gap-2"><UploadCloud size={16}/> Upload Logo</label>
          </div>
        )}
      </div>
      <div>
        <label className="block text-sm font-bold text-green-200/70 ml-2 mb-2 uppercase tracking-wider">Running Text</label>
        <textarea disabled={isReadOnly} rows="2" value={form.runningText} onChange={e => setForm({...form, runningText: e.target.value})} className="w-full bg-[#092613] border border-[#1b5e35] rounded-[1.5rem] px-5 py-4 text-white outline-none focus:border-green-500 mb-4" />
      </div>
      <div>
        <label className="block text-sm font-bold text-green-200/70 ml-2 mb-2 uppercase tracking-wider">Versi Aplikasi</label>
        <input disabled={isReadOnly} type="text" value={form.appVersion || 'v.1.3.26'} onChange={e => setForm({...form, appVersion: e.target.value})} className="w-full bg-[#092613] border border-[#1b5e35] rounded-[1.5rem] px-5 py-4 text-white outline-none focus:border-green-500" />
      </div>
      {!isReadOnly && <button type="submit" className="w-full bg-green-600 text-white font-bold rounded-[1.5rem] px-6 py-4 shadow-xl hover:bg-green-500 transition-all flex justify-center gap-2">Simpan Semua Setingan</button>}
    </form>
  );
}

// Sub-Setting: Setting Struk / Tiket Parkir
function SettingTiket({ settings, setSettings, isReadOnly, showToast }) {
  const defaultTicketSettings = { title: 'Sistem Device Portable', subtitle: 'RESPARKING', footerIn: 'SIMPAN TIKET INI', footerOut: 'TERIMA KASIH', logoUrl: '' };
  const [form, setForm] = useState(settings.ticket || defaultTicketSettings);

  const handleLogoUpload = (e) => {
    processImageFile(e.target.files[0], (data) => setForm({...form, logoUrl: data}));
  };

  const handleRemoveLogo = () => setForm({...form, logoUrl: ''});

  const handleSave = (e) => {
     e.preventDefault();
     setSettings({ ...settings, ticket: form });
     showToast("Pengaturan Struk/Tiket Tersimpan!");
  };

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="bg-[#092613] p-5 rounded-2xl border border-[#1b5e35]">
         <h4 className="font-bold text-white mb-2 uppercase text-sm flex items-center gap-2"><Printer size={18} className="text-teal-400"/> Editor Konten Struk</h4>
         <p className="text-xs text-green-200/70 leading-relaxed mb-4">Sesuaikan teks Header, Footer, dan Logo khusus untuk cetakan tiket masuk dan struk keluar (berlaku untuk print bluetooth dan preview).</p>
      </div>

      <div className="bg-[#092613] p-5 rounded-2xl border border-[#1b5e35] flex flex-col items-center text-center">
        <p className="text-sm font-bold text-green-200/70 mb-4 uppercase">Logo Pada Struk (Mode Thermal)</p>
        {form.logoUrl ? (
           <div className="relative inline-block">
              <img src={form.logoUrl} alt="Logo Struk" className="h-24 bg-white rounded-xl px-4 py-2 mb-4 object-contain grayscale mix-blend-screen" />
              {!isReadOnly && <button type="button" onClick={handleRemoveLogo} className="absolute -top-2 -right-2 bg-red-600 rounded-full p-1 text-white hover:bg-red-500 shadow-md"><X size={14}/></button>}
           </div>
        ) : (
           <div className="h-24 w-24 bg-[#114022] rounded-xl mb-4 border border-[#1b5e35] flex items-center justify-center text-green-300/30"><FileImage size={32}/></div>
        )}
        {!isReadOnly && (
          <div>
            <input type="file" id="upload-logo-tiket" accept="image/*" className="hidden" onChange={handleLogoUpload} />
            <label htmlFor="upload-logo-tiket" className="bg-teal-600 hover:bg-teal-500 text-white font-bold py-2 px-6 rounded-xl cursor-pointer inline-flex items-center gap-2"><UploadCloud size={16}/> Upload Logo Struk</label>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
         <div>
            <label className="block text-sm font-bold text-green-200/70 ml-2 mb-2 uppercase tracking-wider">Judul Utama / Header</label>
            <input disabled={isReadOnly} type="text" value={form.title} onChange={e => setForm({...form, title: e.target.value})} placeholder="Sistem Device Portable" className="w-full bg-[#092613] border border-[#1b5e35] rounded-[1.5rem] px-5 py-4 text-white outline-none focus:border-green-500" />
         </div>
         <div>
            <label className="block text-sm font-bold text-green-200/70 ml-2 mb-2 uppercase tracking-wider">Sub-Judul (Opsional)</label>
            <input disabled={isReadOnly} type="text" value={form.subtitle} onChange={e => setForm({...form, subtitle: e.target.value})} placeholder="Cth: PT. Parkir Jaya Abadi" className="w-full bg-[#092613] border border-[#1b5e35] rounded-[1.5rem] px-5 py-4 text-white outline-none focus:border-green-500" />
         </div>
         <div>
            <label className="block text-sm font-bold text-green-200/70 ml-2 mb-2 uppercase tracking-wider">Footer Tiket Masuk</label>
            <input disabled={isReadOnly} type="text" value={form.footerIn} onChange={e => setForm({...form, footerIn: e.target.value})} placeholder="SIMPAN TIKET INI" className="w-full bg-[#092613] border border-[#1b5e35] rounded-[1.5rem] px-5 py-4 text-white outline-none focus:border-green-500" />
         </div>
         <div>
            <label className="block text-sm font-bold text-green-200/70 ml-2 mb-2 uppercase tracking-wider">Footer Struk Keluar</label>
            <input disabled={isReadOnly} type="text" value={form.footerOut} onChange={e => setForm({...form, footerOut: e.target.value})} placeholder="TERIMA KASIH" className="w-full bg-[#092613] border border-[#1b5e35] rounded-[1.5rem] px-5 py-4 text-white outline-none focus:border-green-500" />
         </div>
      </div>

      {!isReadOnly && <button type="submit" className="w-full bg-green-600 text-white font-bold rounded-[1.5rem] px-6 py-4 shadow-xl hover:bg-green-500 transition-all flex justify-center gap-2">Simpan Setting Struk/Tiket</button>}
    </form>
  );
}

// --- SHIFT END MODAL (AUTO LOGOUT POPUP) ---
function ShiftEndModal({ user, transactions, shiftName, onClose, settings }) {
  const [waSent, setWaSent] = useState(false);
  const webSettings = settings?.web || {};
  
  const shiftTx = transactions.filter(t => t.kasirKeluar === user.nama && t.waktuKeluar && t.waktuKeluar >= (user.loginTime || new Date()));
  const totalNominal = shiftTx.reduce((sum, t) => sum + (t.totalBiaya || 0), 0);
  
  const statsPerType = shiftTx.reduce((acc, tx) => { 
     if (!acc[tx.jenis]) acc[tx.jenis] = { qty: 0, nominal: 0 };
     acc[tx.jenis].qty += 1;
     acc[tx.jenis].nominal += (tx.totalBiaya || 0);
     return acc; 
  }, {});
  const allTypes = ['Motor', 'Mobil', 'Box/Truck', 'Sepeda/Becak'];

  const exportWA = () => {
    let text = `*LAPORAN PENDAPATAN SHIFT*\n🏢 *Lokasi:* ${user.lokasi}\n👤 *Petugas:* ${user.nama}\n🕒 *Shift:* ${shiftName}\n📅 *Tanggal:* ${new Date().toLocaleDateString('id-ID')}\n\n*RINCIAN PENDAPATAN:*\n`;
    allTypes.forEach(jenis => {
       if(statsPerType[jenis]) {
           text += `▪️ ${jenis}: ${statsPerType[jenis].qty} unit (Rp ${statsPerType[jenis].nominal.toLocaleString('id-ID')})\n`;
       }
    });
    text += `\n========================\n💰 *TOTAL SETORAN: Rp ${totalNominal.toLocaleString('id-ID')}*\n========================\n\n_System Generated by Device Portable_`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    setWaSent(true);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
       {/* Mengubah menjadi layout yang lebih pantas untuk di-print PDF */}
       <div className="bg-[#114022] rounded-3xl p-6 md:p-8 max-w-lg w-full border border-[#1b5e35] shadow-2xl hide-on-print max-h-[95vh] overflow-y-auto custom-scrollbar print-a4-layout">
          
          <div className="text-center hide-on-print">
            <div className="w-16 h-16 bg-orange-500/20 text-orange-400 rounded-full flex items-center justify-center mx-auto mb-4"><Clock size={36}/></div>
            <h2 className="text-2xl font-black text-white mb-2">Shift Telah Berakhir</h2>
            <p className="text-green-200/70 text-sm mb-6">Waktu shift Anda telah selesai. Berikut rekapan pendapatan Anda pada sesi ini.</p>
          </div>
          
          <div className="shift-report-print bg-[#092613] border border-[#1b5e35] p-6 rounded-2xl text-left mb-6 font-mono text-sm print:bg-transparent print:border-none print:p-0">
             <div className="hidden-screen show-on-print border-b-[3px] border-black pb-4 mb-6 bg-white text-black text-center">
                {webSettings.logoUrl && <img src={webSettings.logoUrl} className="h-16 mb-2 mx-auto" alt="Logo" />}
                <h3 className="font-black text-xl leading-tight uppercase tracking-widest mt-2">Laporan Pendapatan Shift</h3>
                <p className="text-sm font-semibold mt-1">Sistem Parkir Terpadu</p>
                <p className="text-[10px] mt-1 text-gray-500">{webSettings.appVersion || 'v.1.3.26'} | &copy; copyright by 200041</p>
             </div>

             <div className="grid grid-cols-2 gap-4 mb-4 text-green-300/80 print:text-black border-b border-[#1b5e35] print:border-black pb-4">
                <div>
                   <p className="font-bold text-white print:text-black">LOKASI TUGAS:</p>
                   <p>{user.lokasi}</p>
                </div>
                <div className="text-right">
                   <p className="font-bold text-white print:text-black">KASIR / PETUGAS:</p>
                   <p>{user.nama} ({user.nipp})</p>
                </div>
                <div>
                   <p className="font-bold text-white print:text-black">SHIFT:</p>
                   <p>{shiftName.toUpperCase()}</p>
                </div>
                <div className="text-right">
                   <p className="font-bold text-white print:text-black">TANGGAL CETAK:</p>
                   <p>{new Date().toLocaleString('id-ID')}</p>
                </div>
             </div>
             
             <div className="mb-4">
                <p className="font-bold text-white print:text-black mb-3 text-center uppercase tracking-widest">Rincian Transaksi</p>
                <table className="w-full text-left">
                   <tbody>
                      {Object.keys(statsPerType).length === 0 && <tr><td colSpan="2" className="text-green-400/30 text-center py-2">Tidak ada transaksi tercatat pada shift ini.</td></tr>}
                      {allTypes.map(jenis => {
                         if (!statsPerType[jenis]) return null;
                         return (
                           <tr key={jenis} className="border-b border-[#1b5e35]/50 print:border-black text-green-200/80 print:text-black">
                              <td className="py-2">{jenis} ({statsPerType[jenis].qty} Unit)</td>
                              <td className="py-2 text-right font-bold text-white print:text-black">Rp {statsPerType[jenis].nominal.toLocaleString('id-ID')}</td>
                           </tr>
                         )
                      })}
                   </tbody>
                </table>
             </div>

             <div className="mt-6 border-t-[3px] border-[#1b5e35] print:border-black pt-4 bg-black/20 print:bg-transparent rounded text-center">
                <p className="text-sm font-bold text-green-300/80 print:text-black mb-1 uppercase tracking-widest">Grand Total Setoran</p>
                <h3 className="text-3xl font-black text-green-400 print:text-black">Rp {totalNominal.toLocaleString('id-ID')}</h3>
             </div>

             {/* TANDA TANGAN ONLINE & FOTO KASIR (Hanya Tampil Saat Print) */}
             <div className="hidden-screen show-on-print mt-16 print:text-black font-sans">
                 <div className="flex justify-between px-10">
                    <div className="text-center w-40">
                       <p className="text-sm">Mengetahui,</p>
                       <p className="text-sm font-bold">Audit / Koordinator</p>
                       <div className="mt-24 border-b border-black w-full"></div>
                    </div>
                    
                    <div className="text-center w-40">
                       <p className="text-sm mb-2">Dibuat Oleh,</p>
                       <p className="text-sm font-bold mb-2">Kasir Bertugas</p>
                       
                       {/* FOTO WAJAH KASIR SAAT LOGIN */}
                       {user.photo ? (
                         <div className="flex flex-col items-center">
                           <img src={user.photo} className="w-[80px] h-[80px] object-cover border-2 border-slate-200 rounded-lg grayscale shadow-sm mb-1" alt="Validasi Kasir" />
                           <p className="text-[9px] text-gray-500 italic">Terverifikasi Sistem</p>
                         </div>
                       ) : (
                         <div className="mt-20"></div>
                       )}

                       <p className="border-b border-black font-bold uppercase mt-2 pt-1 inline-block w-full">{user.nama}</p>
                    </div>
                 </div>
             </div>
          </div>

          <div className="flex flex-col gap-3 hide-on-print">
             <div className="flex gap-2">
                 <button onClick={exportWA} className="flex-1 bg-green-600 hover:bg-green-500 text-white py-3 rounded-xl font-bold flex justify-center items-center gap-2 text-sm"><Share2 size={18}/> Kirim WA</button>
                 <button onClick={() => window.print()} className="flex-1 bg-teal-600 hover:bg-teal-500 text-white py-3 rounded-xl font-bold flex justify-center items-center gap-2 text-sm"><Download size={18}/> Cetak PDF</button>
             </div>
             <button onClick={onClose} disabled={!waSent} className={`py-4 rounded-xl font-bold transition-all text-sm ${waSent ? 'bg-[#1b5e35] text-white hover:bg-[#258249]' : 'bg-[#092613] text-green-300/30 cursor-not-allowed border border-[#1b5e35]'}`}>
                {waSent ? 'Tutup & Logout Sistem' : 'Kirim WA Laporan Dahulu'}
             </button>
          </div>
       </div>
    </div>
  );
}