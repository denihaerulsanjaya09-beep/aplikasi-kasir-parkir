import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, CheckCircle2, LogOut, Settings, 
  MapPin, Clock, FileText, Search, Car, Truck, Bike, Download, Share2,
  ChevronDown, Bluetooth, Users, Monitor, ShieldCheck, FileImage,
  UploadCloud, AlertTriangle, X, Lock, Trash2, Database,
  ArrowRight, ArrowLeft, Printer, CheckSquare, HardDrive
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

// --- HELPER FUNCTION: Storage Calculator ---
const getBase64Size = (b64) => {
  if (!b64 || typeof b64 !== 'string') return 0;
  const base64str = b64.includes(',') ? b64.split(',')[1] : b64;
  return Math.floor((base64str.length * 3) / 4);
};

const formatBytes = (bytes) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// --- HELPER FUNCTION: Direct Bluetooth Print (RawBT / ESC-POS) DIKEMBALIKAN ---
const printDirectBluetooth = (type, data, settings) => {
    try {
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
            text += `NOPOL: ${nopol}\n`;
            text += `JENIS: ${jenis}\n`;
            text += `MASUK: ${data.waktuMasuk ? data.waktuMasuk.toLocaleString('id-ID') : new Date().toLocaleString('id-ID')}\n`;
            text += `KASIR: ${nip}\n`;
            text += divider + '\n';
            text += center(settings?.ticket?.footerIn || "SIMPAN TIKET INI") + '\n';
        } else {
            text += center("STRUK KELUAR") + '\n';
            text += `NOPOL: ${nopol}\n`;
            text += `JENIS: ${jenis} ${data.tiketHilang ? '(HILANG)' : ''}\n`;
            text += `MASUK: ${data.waktuMasuk ? data.waktuMasuk.toLocaleTimeString('id-ID') : '-'}\n`;
            text += `KLUAR: ${data.waktuKeluar ? data.waktuKeluar.toLocaleTimeString('id-ID') : new Date().toLocaleTimeString('id-ID')}\n`;
            text += `DURAS: ${data.durasiText || '-'}\n`;
            text += divider + '\n';
            text += right("TOTAL:", `Rp ${(data.totalBiaya || 0).toLocaleString('id-ID')}`) + '\n';
            text += divider + '\n';
            text += center(settings?.ticket?.footerOut || "TERIMA KASIH") + '\n';
        }
        text += '\n';

        const intentUrl = `intent:${encodeURI(text)}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = intentUrl;
        document.body.appendChild(iframe);
        
        setTimeout(() => {
            if (document.body.contains(iframe)) document.body.removeChild(iframe);
        }, 2000);
    } catch (e) {
        console.error("Print Direct Bluetooth Failed: ", e);
    }
};

// --- CONSTANTS & DEFAULT DATA ---
const PURE_LOCATIONS = ['ST. Cimahi Selatan', 'ST. Gadobangkong', 'ST. Cianjur', 'ST. Cibatu'];
const LOCATIONS = [...PURE_LOCATIONS, 'All Lokasi'];

const DEFAULT_LOCATION_SETTINGS = {
  tariffs: {
    'Motor': { mode: 'progressif', first: 2000, firstDuration: 1, next: 2000, max: 8000, inap: 10000, gracePeriodActive: false, gracePeriodMinutes: 0 },
    'Mobil': { mode: 'progressif', first: 3000, firstDuration: 1, next: 3000, max: 15000, inap: 20000, gracePeriodActive: false, gracePeriodMinutes: 0 },
    'Box/Truck': { mode: 'progressif', first: 5000, firstDuration: 1, next: 5000, max: 25000, inap: 25000, gracePeriodActive: false, gracePeriodMinutes: 0 },
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
    footerOut: 'TERIMA KASIH'
  },
  members: [],
  activeLogins: {}, 
  userSessions: {}, 
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
  <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[200] px-6 py-3 rounded-full text-white font-bold shadow-2xl transition-all animate-in slide-in-from-top-4 flex items-center gap-2 ${type === 'error' ? 'bg-red-600' : type === 'warning' ? 'bg-amber-500' : 'bg-teal-600'}`}>
    {type === 'error' ? <AlertTriangle size={18}/> : type === 'warning' ? <AlertTriangle size={18}/> : <CheckCircle2 size={18}/>}
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

// --- COMPONENT: TICKET PREVIEW (SOP KONTROL - DIKEMBALIKAN KE LAYOUT COMPACT) ---
const TicketPreviewModal = ({ type, data, settings, onClose, showToast }) => {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in zoom-in-95 print:bg-white print:p-0 print:block">
      <div className="bg-[#114022] p-6 rounded-[2rem] border border-[#1b5e35] shadow-2xl flex flex-col items-center max-w-sm w-full relative print:border-none print:shadow-none print:p-0 print:bg-white print:w-full print:max-w-none">
        
        <div className="absolute -top-5 bg-teal-500 text-white px-4 py-1 rounded-full text-xs font-bold shadow-lg flex items-center gap-2 hide-on-print">
          <CheckCircle2 size={14}/> Tercetak Otomatis
        </div>
        
        <h3 className="text-white font-bold mb-4 flex items-center gap-2 hide-on-print">
          <FileText className="text-teal-400"/> SOP Preview Karcis
        </h3>

        {/* Simulasi Kertas Karcis Thermal dengan layout Ultra Compact untuk Hemat Kertas */}
        <div className="ticket-print-area bg-white text-black font-mono w-full p-4 rounded shadow-inner text-sm relative overflow-hidden">
           
           <div className="ticket-text-center font-bold ticket-mb-1">
              {settings?.web?.logoUrl && (
                 <img src={settings.web.logoUrl} alt="Logo" className="mx-auto" style={{ display: 'block', maxHeight: '40px', width: 'auto', marginBottom: '2px' }} />
              )}
              
              <p className="text-[13px]">{settings?.ticket?.title || 'Sistem Device Portable'}</p>
              {settings?.ticket?.subtitle && <p className="text-[10px]">{settings.ticket.subtitle}</p>}
              <p className="text-[11px]">{data.lokasi}</p>
           </div>

           <div className="ticket-divider"></div>
           <div className="ticket-text-center font-bold text-[12px] my-1">{type === 'IN' ? 'TIKET MASUK' : 'STRUK KELUAR'}</div>
           <div className="ticket-divider"></div>
           
           <div className="ticket-flex-between ticket-mb-1 text-[11px]"><span>NOPOL:</span><span className="font-bold text-[13px]">{data.nopol}</span></div>
           <div className="ticket-flex-between ticket-mb-1 text-[11px]"><span>JENIS:</span><span>{data.jenis}</span></div>
           <div className="ticket-flex-between ticket-mb-1 text-[11px]"><span>MASUK:</span><span>{data.waktuMasuk ? data.waktuMasuk.toLocaleString('id-ID') : '-'}</span></div>
           
           {type === 'OUT' && (
              <>
                <div className="ticket-flex-between ticket-mb-1 text-[11px]"><span>KELUAR:</span><span>{data.waktuKeluar ? data.waktuKeluar.toLocaleTimeString('id-ID') : '-'}</span></div>
                <div className="ticket-flex-between ticket-mb-1 text-[11px]"><span>DURASI:</span><span>{data.durasiText || '-'}</span></div>
                {data.tiketHilang && <div className="text-center text-[10px] mt-1 text-black font-bold">*Termasuk Denda Kehilangan</div>}
                <div className="ticket-divider mt-1"></div>
                <div className="ticket-flex-between font-black text-[13px] mt-1"><span>TOTAL:</span><span>Rp {data.totalBiaya?.toLocaleString('id-ID')}</span></div>
              </>
           )}
           
           {type === 'IN' && (
              <div className="ticket-flex-between mt-1 text-[11px]"><span>KASIR:</span><span>{data.kasirMasuk}</span></div>
           )}

           <div className="ticket-divider mt-1 mb-1"></div>
           <div className="ticket-text-center text-[10px] font-bold">{type === 'IN' ? (settings?.ticket?.footerIn || 'SIMPAN TIKET INI') : (settings?.ticket?.footerOut || 'TERIMA KASIH')}</div>
        </div>

        <p className="text-[10px] text-green-200/50 mt-4 text-center hide-on-print">Data telah tersimpan dan perintah cetak telah dikirim.</p>

        <div className="flex flex-wrap gap-2 mt-4 w-full hide-on-print">
           <button onClick={() => window.print()} className="flex-1 py-3 px-2 rounded-xl bg-[#092613] border border-[#1b5e35] text-white hover:bg-[#164d2b] transition-all flex justify-center items-center gap-2 text-xs font-bold">
             <Printer size={14}/> Print (Spooler)
           </button>
           <button onClick={() => { printDirectBluetooth(type, data, settings); showToast("Mengirim ulang via bluetooth..."); }} className="flex-1 py-3 px-2 rounded-xl bg-orange-600 border border-orange-500 text-white hover:bg-orange-500 transition-all flex justify-center items-center gap-2 text-xs font-bold">
             <Bluetooth size={14}/> Print Bluetooth
           </button>
           <button onClick={onClose} className="w-full py-3 rounded-xl bg-teal-600 text-white font-bold hover:bg-teal-500 transition-all shadow-lg mt-2 text-sm">
             Selesai / Tutup
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
  const [shiftData, setShiftData] = useState({ current: 'Loading...', showSummary: false, forced: false });

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
               
               const mergedLocations = { ...DEFAULT_SETTINGS.locations };
               if (loadedSettings.locations) {
                   Object.keys(loadedSettings.locations).forEach(loc => {
                       mergedLocations[loc] = {
                           ...DEFAULT_LOCATION_SETTINGS,
                           ...(loadedSettings.locations[loc] || {})
                       };
                   });
               }

               setSettings({ 
                   ...DEFAULT_SETTINGS, 
                   ...loadedSettings,
                   locations: mergedLocations
               });
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
    await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'transactions', newTx.id), { ...newTx, waktuMasuk: newTx.waktuMasuk.toISOString(), waktuKeluar: newTx.waktuKeluar ? newTx.waktuKeluar.toISOString() : null });
  };

  const handleUpdateTransaction = async (id, updateData) => {
    if (!fbUser) return;
    const txToUpdate = { ...updateData };
    if (txToUpdate.waktuKeluar) txToUpdate.waktuKeluar = txToUpdate.waktuKeluar.toISOString();
    await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'transactions', id), txToUpdate, { merge: true });
  };

  const handleUpdateSettings = async (newSettings) => {
    if (!fbUser) return;
    await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'global'), newSettings, { merge: true });
  };

  // LOGIC INTERVAL SHIFT & FORCED END SHIFT
  useEffect(() => {
    if (!user) return;
    
    const checkShift = () => {
       const userLocShifts = getLocSettings(settings, user.lokasi).shifts;
       const active = getActiveShift(userLocShifts);
       
       if (user.startShiftName && active !== user.startShiftName) {
           setShiftData({ current: user.startShiftName, showSummary: true, forced: true });
       } else if (active !== shiftData.current) {
           setShiftData({ current: active, showSummary: false, forced: false });
       }

       const activeLogins = settings.activeLogins || {};
       if (activeLogins[user.nipp]?.deviceId === deviceId) {
          handleUpdateSettings({
             ...settings, 
             activeLogins: { ...activeLogins, [user.nipp]: { ...activeLogins[user.nipp], timestamp: Date.now() } }
          });
       }
    };

    checkShift();
    const interval = setInterval(checkShift, 10000); 
    return () => clearInterval(interval);
  }, [user, settings, deviceId]);

  const handleLogout = async (newSessionsData = null) => { 
    if(user){
       const activeLogins = settings.activeLogins || {};
       const newLogins = { ...activeLogins };
       delete newLogins[user.nipp];
       
       const toUpdate = { ...settings, activeLogins: newLogins };
       if (newSessionsData) toUpdate.userSessions = newSessionsData;

       await handleUpdateSettings(toUpdate);
    }
    setUser(null); 
    setActiveTab('masuk'); 
    setShiftData({ current: 'Loading...', showSummary: false, forced: false });
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
                setUser(u); 
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
    <div className="min-h-screen bg-[#092613] text-green-50 font-sans selection:bg-green-500 selection:text-white pb-36">
      {/* CSS GLOBAL KHUSUS UNTUK PRINT LAPORAN A4 (Ticket tidak terpengaruh jika modal tidak terbuka) */}
      <style>{`
        @media print {
          @page { margin: 0; size: auto; }
          body { background: white !important; color: black !important; font-size: 11px; margin: 0; padding: 0; }
          #root > div > header, .fixed.bottom-6, .hide-on-print { display: none !important; }
          
          .print-a4-layout {
            display: block !important;
            background: white !important;
            color: black !important;
            width: 100% !important;
            box-shadow: none !important;
            border: none !important;
            padding: 10mm !important;
            margin: 0 !important;
          }

          .ticket-print-area {
            width: 100% !important;
            max-width: 58mm !important;
            margin: 0 auto !important;
            padding: 2mm !important;
            background: white !important;
            color: black !important;
            font-family: monospace !important;
            box-shadow: none !important;
            border: none !important;
          }
          .ticket-print-area * { line-height: 1.1 !important; margin: 0; padding: 0; }
          .ticket-divider { border-bottom: 1px solid black !important; margin: 2px 0 !important; }
          .ticket-text-center { text-align: center !important; }
          .ticket-flex-between { display: flex !important; justify-content: space-between !important; }
          .ticket-mb-1 { margin-bottom: 2px !important; }

          .dense-table { width: 100%; border-collapse: collapse; font-size: 11px !important; margin-top: 15px; }
          .dense-table tr { page-break-inside: avoid; page-break-after: auto; }
          .dense-table th, .dense-table td { border: 1px solid black !important; padding: 6px 8px !important; color: black !important; background-color: transparent !important; }
          .dense-table th { font-weight: bold; text-align: center; }
          .shift-report-print { width: 100%; font-family: 'Times New Roman', serif, sans-serif !important; }
          .shift-report-print h3 { font-size: 16pt !important; margin-bottom: 2px; text-align: center; font-weight: bold; }
          .shift-report-print p { font-size: 10pt !important; color: black !important; margin: 2px 0;}
          
          .scrollable-modal-content { max-height: none !important; overflow: visible !important; }
        }
      `}</style>

      {toast && <Toast message={toast.msg} type={toast.type} />}
      {confirmDialog && <ConfirmModal {...confirmDialog} />}
      
      {/* TICKET PREVIEW MENGGUNAKAN NATIVE BROWSER PRINT ATAU RAWBT */}
      {ticketPreview && <TicketPreviewModal type={ticketPreview.type} data={ticketPreview.data} settings={settings} onClose={() => setTicketPreview(null)} showToast={showToast} />}

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
             <button onClick={() => setShiftData(prev => ({...prev, showSummary: true, forced: false}))} className="p-2 bg-orange-500/20 text-orange-400 rounded-xl hover:bg-orange-500/30 transition-colors text-xs font-bold hidden md:flex items-center gap-1 border border-orange-500/20">
               <CheckSquare size={14} /> Akhiri Shift
             </button>
          )}
          <button onClick={() => handleLogout()} className="p-3 bg-red-600/20 text-red-400 rounded-xl hover:bg-red-600/30 transition-colors flex items-center gap-2 text-sm font-bold border border-red-600/20">
            <LogOut size={16} /> Keluar
          </button>
        </div>
      </header>

      <main className="pt-28 px-4 md:px-6 max-w-6xl mx-auto print-a4-layout">
        {canTransact && !['area', 'settings'].includes(activeTab) && (
          <>
             <div className="flex gap-4 mb-6 hide-on-print">
               <button onClick={() => setActiveTab('masuk')} className={`flex-1 py-6 md:py-8 rounded-[2rem] flex flex-col items-center justify-center gap-2 transition-all duration-300 shadow-xl border-2 ${activeTab === 'masuk' ? 'bg-green-600 border-green-400 text-white scale-[1.02]' : 'bg-[#114022] border-[#1b5e35] text-green-200/50 hover:bg-[#164d2b]'}`}>
                 <ArrowRight size={40} />
                 <span className="text-xl md:text-3xl font-black uppercase tracking-widest">Pintu Masuk</span>
               </button>
               <button onClick={() => setActiveTab('keluar')} className={`flex-1 py-6 md:py-8 rounded-[2rem] flex flex-col items-center justify-center gap-2 transition-all duration-300 shadow-xl border-2 ${activeTab === 'keluar' ? 'bg-teal-600 border-teal-400 text-white scale-[1.02]' : 'bg-[#114022] border-[#1b5e35] text-green-200/50 hover:bg-[#164d2b]'}`}>
                 <ArrowLeft size={40} />
                 <span className="text-xl md:text-3xl font-black uppercase tracking-widest">Pintu Keluar</span>
               </button>
             </div>
             
             {/* TOMBOL BESAR SELESAI BERDINAS KHUSUS KASIR */}
             <div className="mb-8 hide-on-print animate-in fade-in slide-in-from-bottom-4">
                <button 
                   onClick={() => setShiftData(prev => ({...prev, current: getActiveShift(getLocSettings(settings, user.lokasi).shifts), showSummary: true, forced: false}))}
                   className="w-full bg-gradient-to-r from-red-700 via-orange-600 to-red-700 text-white font-black py-5 md:py-6 rounded-[2rem] shadow-[0_0_30px_rgba(234,88,12,0.3)] hover:shadow-[0_0_40px_rgba(234,88,12,0.5)] hover:scale-[1.01] transition-all flex items-center justify-center gap-3 text-lg md:text-2xl border-2 border-orange-400/50"
                >
                   <CheckSquare size={32} className="text-yellow-300" /> SELESAI BERDINAS / LAPOR PENDAPATAN
                </button>
             </div>
          </>
        )}

        {/* Routers */}
        {canTransact && activeTab === 'masuk' && <KendaraanMasuk user={user} addTransaction={handleAddTransaction} showToast={showToast} settings={settings} setTicketPreview={setTicketPreview} />}
        {canTransact && activeTab === 'keluar' && <KendaraanKeluar user={user} transactions={transactions} updateTransaction={handleUpdateTransaction} settings={settings} showToast={showToast} setTicketPreview={setTicketPreview} />}
        {canViewArea && activeTab === 'area' && <KendaraanArea transactions={transactions} user={user} />}
        {hasSettingsAccess && activeTab === 'settings' && <MasterSettings settings={settings} setSettings={handleUpdateSettings} user={user} transactions={transactions} addTransaction={handleAddTransaction} updateTransaction={handleUpdateTransaction} showToast={showToast} setConfirmDialog={setConfirmDialog} />}
      </main>

      {/* Bottom Nav */}
      <div className="fixed bottom-6 w-full flex justify-center z-40 px-4 hide-on-print">
        <div className="bg-[#0c331a]/90 backdrop-blur-2xl p-2 rounded-[2rem] shadow-2xl border border-[#1b5e35] flex items-center gap-2">
          {canTransact && <NavButton active={['masuk', 'keluar'].includes(activeTab)} onClick={() => setActiveTab('masuk')} icon={<Car />} label="Transaksi" color="text-green-400" />}
          {canViewArea && <NavButton active={activeTab === 'area'} onClick={() => setActiveTab('area')} icon={<MapPin />} label="Area Parkir" color="text-teal-400" />}
          {hasSettingsAccess && <NavButton active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={<Settings />} label="Settings & Laporan" color="text-emerald-400" />}
        </div>
      </div>

      {shiftData.showSummary && <ShiftEndModal user={user} transactions={transactions} shiftName={shiftData.current} forced={shiftData.forced} onClose={handleLogout} cancelOpen={() => setShiftData(prev => ({...prev, showSummary: false}))} settings={settings} showToast={showToast} />}
    </div>
  );
}

// --- LOGIN COMPONENT ---
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

    const currentSession = settings.userSessions?.[matchedUser.nipp];
    const currentLocShifts = getLocSettings(settings, formData.lokasi).shifts;
    const currentShiftName = getActiveShift(currentLocShifts);

    let loginTime = Date.now();
    let sessionShiftName = currentShiftName;

    if (currentSession && currentSession.status === 'OPEN') {
        loginTime = currentSession.startTime;
        sessionShiftName = currentSession.shiftName || currentShiftName;
        showToast("PERINGATAN: Sesi shift sebelumnya belum dilaporkan! Mohon lapor sekarang.", "warning");
    }

    const newSessions = { ...(settings.userSessions || {}) };
    if (!currentSession || currentSession.status !== 'OPEN') {
        newSessions[matchedUser.nipp] = { status: 'OPEN', startTime: loginTime, shiftName: sessionShiftName, lokasi: formData.lokasi };
    }

    updateSettings({
       ...settings,
       activeLogins: {
           ...(settings.activeLogins || {}),
           [matchedUser.nipp]: { lokasi: formData.lokasi, deviceId: deviceId, timestamp: Date.now() }
       },
       userSessions: newSessions
    });

    setTempUser({ ...matchedUser, lokasi: formData.lokasi, loginTime, startShiftName: sessionShiftName });
    setShowCamera(true); 
  };

  const processLogin = (photoData) => {
    onLogin({ ...tempUser, photo: photoData });
  };

  return (
    <div className="min-h-screen bg-[#092613] flex items-center justify-center p-6 relative overflow-hidden font-sans">
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-green-500/10 rounded-full blur-[120px]" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-teal-500/10 rounded-full blur-[120px]" />

      <div className="bg-[#114022]/80 backdrop-blur-3xl p-10 rounded-[3rem] border border-[#1b5e35] shadow-2xl w-full max-w-md z-10 flex flex-col">
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

        <div className="mt-6 text-center border-t border-[#1b5e35] pt-4">
           <a href="https://www.dashboardregional2bd.id/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 text-xs font-bold text-orange-400 hover:text-orange-300 transition-colors bg-orange-900/20 py-2 px-4 rounded-full border border-orange-500/30 shadow-sm">
              <AlertTriangle size={14} /> Lapor Kendala Sistem
           </a>
        </div>
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

// --- SHIFT END MODAL (AUTO LOGOUT POPUP) DENGAN SISTEM PENGUNCI MULTIPLE ---
function ShiftEndModal({ user, transactions, shiftName, forced, onClose, cancelOpen, settings, showToast }) {
  const [waSent, setWaSent] = useState(false);
  const [pdfPrinted, setPdfPrinted] = useState(false);
  const webSettings = settings?.web || {};
  
  // FIX BUG PENTING: Gunakan rentang waktu 14 Jam ke belakang sebagai pengganti user.loginTime yang rentan riset saat refresh browser.
  const cutoffTime = new Date(Date.now() - 14 * 60 * 60 * 1000); // 14 jam ke belakang
  
  const shiftTx = transactions.filter(t => 
    t.kasirKeluar === user.nama && 
    t.lokasi === user.lokasi && 
    t.waktuKeluar && 
    new Date(t.waktuKeluar) > cutoffTime
  );
  
  const totalNominal = shiftTx.reduce((sum, t) => sum + (t.totalBiaya || 0), 0);
  
  const regularTx = shiftTx.filter(t => !t.isManual);
  const manualTx = shiftTx.filter(t => t.isManual);

  const statsPerType = regularTx.reduce((acc, tx) => { 
     if (!acc[tx.jenis]) acc[tx.jenis] = { qty: 0, nominal: 0 };
     acc[tx.jenis].qty += 1;
     acc[tx.jenis].nominal += (tx.totalBiaya || 0);
     return acc; 
  }, {});
  const allTypes = ['Motor', 'Mobil', 'Box/Truck', 'Sepeda/Becak'];

  const manualStats = manualTx.reduce((acc, tx) => {
     acc.nominal += (tx.totalBiaya || 0);
     acc.qtyMotor += (tx.details?.['Motor'] || 0);
     acc.qtyMobil += (tx.details?.['Mobil'] || 0);
     acc.qtyBox += (tx.details?.['Box/Truck'] || 0);
     acc.qtySepeda += (tx.details?.['Sepeda/Becak'] || 0);
     return acc;
  }, { nominal: 0, qtyMotor: 0, qtyMobil: 0, qtyBox: 0, qtySepeda: 0 });

  // FORMAT WHATSAPP ESTETIK DAN PROFESIONAL
  const exportWA = () => {
    let text = `🧾 *LAPORAN PENDAPATAN SHIFT* 🧾\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `🏢 *Lokasi:* ${user.lokasi}\n`;
    text += `👤 *Kasir:* ${user.nama} (${user.nipp})\n`;
    text += `🕒 *Shift:* ${shiftName.toUpperCase()}\n`;
    text += `📅 *Tanggal:* ${new Date().toLocaleDateString('id-ID')}\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    text += `📊 *RINGKASAN TRANSAKSI:*\n`;
    let isAnyRegular = false;
    allTypes.forEach(jenis => {
       if(statsPerType[jenis]) {
           text += `▪️ ${jenis}: ${statsPerType[jenis].qty} unit ➡️ Rp ${statsPerType[jenis].nominal.toLocaleString('id-ID')}\n`;
           isAnyRegular = true;
       }
    });
    if(!isAnyRegular) text += `▪️ Tidak ada transaksi normal tercatat.\n`;

    if (manualStats.nominal > 0) {
        text += `\n⚠️ *PENDAPATAN MANUAL (BACKUP):*\n`;
        if (manualStats.qtyMotor > 0) text += `▪️ Motor: ${manualStats.qtyMotor} unit\n`;
        if (manualStats.qtyMobil > 0) text += `▪️ Mobil: ${manualStats.qtyMobil} unit\n`;
        if (manualStats.qtyBox > 0) text += `▪️ Box/Truck: ${manualStats.qtyBox} unit\n`;
        if (manualStats.qtySepeda > 0) text += `▪️ Sepeda/Becak: ${manualStats.qtySepeda} unit\n`;
        text += `▪️ Total Manual: Rp ${manualStats.nominal.toLocaleString('id-ID')}\n`;
    }

    text += `\n💰 *GRAND TOTAL SETORAN*\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `>>> *Rp ${totalNominal.toLocaleString('id-ID')}* <<<\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    text += `📝 *RINCIAN KENDARAAN KELUAR:*\n`;
    if (shiftTx.length === 0) {
        text += `- Kosong -\n`;
    } else {
        shiftTx.forEach((tx, idx) => {
            text += `${idx+1}. ${tx.nopol} (${tx.isManual ? 'Manual Backup' : tx.jenis}) - Rp ${tx.totalBiaya.toLocaleString('id-ID')}\n`;
        });
    }

    text += `\n✅ _Laporan Valid Generated by System Device Portable_`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    setWaSent(true);
  };

  const handlePrintPdf = () => {
     window.print();
     setPdfPrinted(true);
  };

  const handleCompleteShift = () => {
     const newSessions = { ...settings.userSessions };
     if (newSessions[user.nipp]) {
         newSessions[user.nipp] = { ...newSessions[user.nipp], status: 'CLOSED', endTime: Date.now() };
     }
     onClose(newSessions);
  };

  const canClose = waSent && pdfPrinted;

  return (
    <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex items-center justify-center p-4">
       <div className="bg-[#114022] rounded-3xl p-6 md:p-8 max-w-2xl w-full border border-[#1b5e35] shadow-[0_0_50px_rgba(0,0,0,0.8)] hide-on-print max-h-[95vh] flex flex-col print-a4-layout relative">
          
          <div className="text-center hide-on-print shrink-0 mb-4 relative">
            {!forced && !canClose && (
               <button onClick={cancelOpen} className="absolute top-0 right-0 bg-[#092613] text-green-200/50 hover:text-white hover:bg-red-600/50 p-2 rounded-full transition-all" title="Batal / Kembali Bekerja">
                  <X size={20}/>
               </button>
            )}
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${forced ? 'bg-red-500/20 text-red-500' : 'bg-orange-500/20 text-orange-400'}`}>
                {forced ? <AlertTriangle size={36}/> : <FileText size={36}/>}
            </div>
            <h2 className="text-2xl font-black text-white mb-2">{forced ? 'Sesi Shift Telah Habis' : 'Laporan Akhir Shift Kasir'}</h2>
            <p className={`${forced ? 'text-red-300' : 'text-green-200/70'} text-sm`}>
               {forced ? 'Waktu shift Anda telah berganti. Selesaikan pelaporan untuk menutup sesi.' : 'Berikut rekapan pendapatan Anda pada sesi shift ini. Wajib laporkan ke pimpinan.'}
            </p>
          </div>
          
          <div className="scrollable-modal-content flex-1 overflow-y-auto custom-scrollbar pr-2 pb-4 shift-report-print bg-[#092613] border border-[#1b5e35] p-6 rounded-2xl text-left mb-6 font-mono text-sm print:bg-transparent print:border-none print:p-0">
             
             {/* HEADER SURAT - HANYA PRINT */}
             <div className="hidden-screen show-on-print border-b-[3px] border-black pb-4 mb-6 bg-white text-black text-center">
                {webSettings.logoUrl && <img src={webSettings.logoUrl} className="h-16 mb-2 mx-auto" alt="Logo" />}
                <h3 className="font-black text-xl leading-tight uppercase tracking-widest mt-2">Laporan Pendapatan Shift</h3>
                <p className="text-sm font-semibold mt-1">Sistem Parkir Terpadu</p>
                <p className="text-[10px] mt-1 text-gray-500">{webSettings.appVersion || 'v.1.3.26'} | &copy; copyright by 200041</p>
             </div>

             {/* INFO PETUGAS */}
             <div className="grid grid-cols-2 gap-4 mb-4 text-green-300/80 print:text-black border-b border-[#1b5e35] print:border-black pb-4">
                <div><p className="font-bold text-white print:text-black">LOKASI TUGAS:</p><p>{user.lokasi}</p></div>
                <div className="text-right"><p className="font-bold text-white print:text-black">KASIR / PETUGAS:</p><p>{user.nama} ({user.nipp})</p></div>
                <div><p className="font-bold text-white print:text-black">SHIFT:</p><p>{shiftName.toUpperCase()}</p></div>
                <div className="text-right"><p className="font-bold text-white print:text-black">TANGGAL CETAK:</p><p>{new Date().toLocaleString('id-ID')}</p></div>
             </div>
             
             {/* RINGKASAN */}
             <div className="mb-4">
                <p className="font-bold text-white print:text-black mb-3 text-center uppercase tracking-widest bg-[#114022] print:bg-transparent py-1 rounded">Ringkasan Pendapatan</p>
                <table className="w-full text-left">
                   <tbody>
                      {Object.keys(statsPerType).length === 0 && manualStats.nominal === 0 && <tr><td colSpan="2" className="text-green-400/30 text-center py-2">Tidak ada transaksi tercatat pada shift ini.</td></tr>}
                      {allTypes.map(jenis => {
                         if (!statsPerType[jenis]) return null;
                         return (
                           <tr key={jenis} className="border-b border-[#1b5e35]/50 print:border-black text-green-200/80 print:text-black">
                              <td className="py-2">{jenis} ({statsPerType[jenis].qty} Unit)</td>
                              <td className="py-2 text-right font-bold text-white print:text-black">Rp {statsPerType[jenis].nominal.toLocaleString('id-ID')}</td>
                           </tr>
                         )
                      })}
                      {manualStats.nominal > 0 && (
                         <>
                           <tr className="border-t-[2px] border-[#1b5e35] print:border-black text-orange-400 print:text-black font-bold mt-2">
                              <td colSpan="2" className="pt-3 pb-1 uppercase">Pendapatan Manual (Backup)</td>
                           </tr>
                           <tr className="border-b border-[#1b5e35]/50 print:border-black text-orange-200/80 print:text-black">
                              <td className="py-2 leading-relaxed">
                                 <span className="text-[11px] font-mono">
                                   {manualStats.qtyMotor > 0 && `Motor:${manualStats.qtyMotor} `}
                                   {manualStats.qtyMobil > 0 && `Mobil:${manualStats.qtyMobil} `}
                                   {manualStats.qtyBox > 0 && `Box:${manualStats.qtyBox} `}
                                   {manualStats.qtySepeda > 0 && `Sepeda:${manualStats.qtySepeda}`}
                                 </span>
                              </td>
                              <td className="py-2 text-right font-bold text-white print:text-black">Rp {manualStats.nominal.toLocaleString('id-ID')}</td>
                           </tr>
                         </>
                      )}
                   </tbody>
                </table>
             </div>

             {/* GRAND TOTAL */}
             <div className="mt-4 mb-8 border-y-[3px] border-[#1b5e35] print:border-black py-4 bg-black/20 print:bg-transparent rounded text-center">
                <p className="text-sm font-bold text-green-300/80 print:text-black mb-1 uppercase tracking-widest">Grand Total Setoran</p>
                <h3 className="text-3xl font-black text-green-400 print:text-black">Rp {totalNominal.toLocaleString('id-ID')}</h3>
             </div>

             {/* RINCIAN TRANSAKSI FULL */}
             <div>
                <p className="font-bold text-white print:text-black mb-3 text-center uppercase tracking-widest bg-[#114022] print:bg-transparent py-1 rounded">Daftar Rincian Kendaraan</p>
                <table className="dense-table text-white print:text-black w-full mb-8">
                   <thead>
                      <tr className="bg-[#114022] print:bg-transparent">
                         <th className="py-2 text-center">No</th>
                         <th className="py-2">Nopol</th>
                         <th className="py-2">Jenis</th>
                         <th className="py-2">Masuk</th>
                         <th className="py-2">Keluar</th>
                         <th className="py-2 text-right">Biaya (Rp)</th>
                      </tr>
                   </thead>
                   <tbody>
                      {shiftTx.length === 0 && <tr><td colSpan="6" className="text-center py-4">Kosong</td></tr>}
                      {shiftTx.map((tx, idx) => (
                         <tr key={tx.id} className="border-b border-[#1b5e35]/50 print:border-black">
                            <td className="py-1.5 text-center">{idx + 1}</td>
                            <td className="py-1.5 font-bold">{tx.nopol}</td>
                            <td className="py-1.5">{tx.isManual ? 'Manual' : tx.jenis}</td>
                            <td className="py-1.5 text-[10px]">{tx.waktuMasuk.toLocaleString('id-ID')}</td>
                            <td className="py-1.5 text-[10px]">{tx.waktuKeluar.toLocaleString('id-ID')}</td>
                            <td className="py-1.5 text-right font-bold">{tx.totalBiaya.toLocaleString('id-ID')}</td>
                         </tr>
                      ))}
                   </tbody>
                </table>
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

          <div className="flex flex-col gap-3 hide-on-print shrink-0">
             <div className="bg-red-900/20 border border-red-500/30 p-3 rounded-xl mb-1 flex items-start gap-3">
                 <Lock className="text-red-400 mt-1 shrink-0" size={18}/>
                 <p className="text-xs text-red-200/90 leading-relaxed">
                    <strong>PENGUNCI LAPORAN:</strong> Tombol <span className="text-red-400 font-bold">"Selesai & Keluar"</span> saat ini terkunci. Anda diwajibkan mengklik <strong>Kirim WA</strong> dan <strong>Cetak PDF</strong> terlebih dahulu sebelum bisa menutup sesi shift ini.
                 </p>
             </div>

             <div className="flex flex-col md:flex-row gap-2">
                 <button onClick={exportWA} className={`flex-1 py-4 rounded-xl font-bold flex justify-center items-center gap-2 text-sm transition-all shadow-lg ${waSent ? 'bg-[#1b5e35] text-green-300 border border-green-500/50' : 'bg-green-600 hover:bg-green-500 text-white'}`}>
                    <Share2 size={20}/> {waSent ? '✅ 1. WA Terkirim' : '1. Kirim Laporan WA'}
                 </button>
                 <button onClick={handlePrintPdf} className={`flex-1 py-4 rounded-xl font-bold flex justify-center items-center gap-2 text-sm transition-all shadow-lg ${pdfPrinted ? 'bg-teal-900 text-teal-300 border border-teal-500/50' : 'bg-teal-600 hover:bg-teal-500 text-white'}`}>
                    <Download size={20}/> {pdfPrinted ? '✅ 2. PDF Dicetak' : '2. Cetak/Save PDF'}
                 </button>
             </div>
             
             <button onClick={handleCompleteShift} disabled={!canClose} className={`mt-2 py-4 md:py-5 rounded-2xl font-black transition-all text-sm md:text-lg flex items-center justify-center gap-2 uppercase tracking-wider ${canClose ? 'bg-red-600 text-white hover:bg-red-500 shadow-[0_0_20px_rgba(220,38,38,0.6)] hover:scale-[1.02]' : 'bg-[#092613] text-green-300/20 cursor-not-allowed border-2 border-[#1b5e35]'}`}>
                {canClose ? <><LogOut size={24}/> Selesai & Keluar Akun</> : <><Lock size={20}/> Lengkapi Langkah 1 & 2</>}
             </button>
          </div>
       </div>
    </div>
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
    try {
        setShowCamera(false);
        const newTx = {
          id: Date.now().toString(), nopol: nopol.toUpperCase(), jenis, waktuMasuk: new Date(),
          status: 'IN', fotoMasuk: photo, lokasi: user.lokasi === 'All Lokasi' ? PURE_LOCATIONS[0] : user.lokasi,
          kasirMasuk: user.nama, gps
        };
        
        // Simpan ke DB dulu agar tidak hilang
        await addTransaction(newTx);
        
        // Eksekusi print rahasia / Direct Bluetooth
        printDirectBluetooth('IN', newTx, settings);
        
        // Tampilkan SOP Preview Modal ke UI
        setTicketPreview({ type: 'IN', data: newTx });
        
        setNopol('');
    } catch (e) {
        console.error("Gagal Proses Masuk: ", e);
        showToast("Terjadi kesalahan saat simpan tiket masuk!", "error");
    }
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
    const waktuMasukValid = tx.waktuMasuk ? new Date(tx.waktuMasuk) : new Date(); // Safey Check Jika Undefined
    const diffMs = exitTime - waktuMasukValid;
    
    const diffMinutesTotal = Math.floor(diffMs / (1000 * 60));
    const exactHours = Math.floor(diffMinutesTotal / 60);
    const exactMinutes = diffMinutesTotal % 60;
    const durasiText = `${exactHours} Jam ${exactMinutes} Menit`;

    const jam = exactHours + (exactMinutes > 0 ? 1 : 0);
    const billedJam = jam > 0 ? jam : 1; 

    const locSettings = getLocSettings(settings, tx.lokasi);
    const rate = locSettings.tariffs[tx.jenis] || locSettings.tariffs['Motor']; // Safety Jika Tarif Kosong
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
    try {
        setShowCamera(false);
        const { total, jam, durasiText, exitTime, isMember, denda } = calculateFee(selectedTx);
        
        const updateData = { 
          status: 'OUT', waktuKeluar: exitTime, fotoKeluar: photo, 
          kasirKeluar: user.nama, durasiJam: jam, durasiText: durasiText, totalBiaya: total, 
          isMember, tiketHilang, denda, fotoKTP, fotoSTNK
        };
        
        // BUG FIX PENTING: Tunggu database tuntas terupdate
        await updateTransaction(selectedTx.id, updateData);
        
        const locSettings = getLocSettings(settings, selectedTx.lokasi);
        const finalData = { ...selectedTx, ...updateData, petugasPhoto: user.photo, locSettings };

        // Eksekusi print rahasia / Direct Bluetooth
        printDirectBluetooth('OUT', finalData, settings);

        // Tampilkan SOP Preview Modal ke UI
        setTicketPreview({ type: 'OUT', data: finalData });

        // Reset state
        setSelectedTx(null);
        setSearchQuery('');
        setTiketHilang(false); setFotoKTP(null); setFotoSTNK(null);
    } catch (error) {
        console.error("Gagal Proses Keluar:", error);
        showToast("Proses gagal: " + error.message, "error");
    }
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
function MasterSettings({ settings, setSettings, user, transactions, addTransaction, updateTransaction, showToast, setConfirmDialog }) {
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
        
        {user.role === 'master' && <button onClick={() => setActiveSetTab('storage')} className={`px-5 py-3 rounded-xl font-bold text-sm transition-all whitespace-nowrap shadow-md ${activeSetTab === 'storage' ? 'bg-purple-600 text-white' : 'bg-[#114022] text-purple-400 hover:bg-[#164d2b]'}`}><HardDrive size={16} className="inline mr-2 -mt-0.5"/>Database Storage</button>}
        
        <button onClick={() => setActiveSetTab('tarif')} className={`px-5 py-3 rounded-xl font-bold text-sm transition-all whitespace-nowrap ${activeSetTab === 'tarif' ? 'bg-[#1b5e35] text-white' : 'bg-[#114022] text-green-300/50 hover:bg-[#164d2b]'}`}>Setting Tarif</button>
        <button onClick={() => setActiveSetTab('member')} className={`px-5 py-3 rounded-xl font-bold text-sm transition-all whitespace-nowrap ${activeSetTab === 'member' ? 'bg-[#1b5e35] text-white' : 'bg-[#114022] text-green-300/50 hover:bg-[#164d2b]'}`}>Member Parkir</button>
        <button onClick={() => setActiveSetTab('shift')} className={`px-5 py-3 rounded-xl font-bold text-sm transition-all whitespace-nowrap ${activeSetTab === 'shift' ? 'bg-[#1b5e35] text-white' : 'bg-[#114022] text-green-300/50 hover:bg-[#164d2b]'}`}>Setting Shift</button>
        {user.role === 'master' && <button onClick={() => setActiveSetTab('users')} className={`px-5 py-3 rounded-xl font-bold text-sm transition-all whitespace-nowrap ${activeSetTab === 'users' ? 'bg-blue-600 text-white' : 'bg-[#114022] text-blue-400 hover:bg-[#164d2b]'}`}>Manajemen User</button>}
        <button onClick={() => setActiveSetTab('tiket')} className={`px-5 py-3 rounded-xl font-bold text-sm transition-all whitespace-nowrap ${activeSetTab === 'tiket' ? 'bg-[#1b5e35] text-white' : 'bg-[#114022] text-green-300/50 hover:bg-[#164d2b]'}`}>Struk/Tiket Parkir</button>
        <button onClick={() => setActiveSetTab('web')} className={`px-5 py-3 rounded-xl font-bold text-sm transition-all whitespace-nowrap ${activeSetTab === 'web' ? 'bg-[#1b5e35] text-white' : 'bg-[#114022] text-green-300/50 hover:bg-[#164d2b]'}`}>Web & Printer</button>
        {(user.role === 'master' || user.role === 'korlap') && (
           <button onClick={() => setActiveSetTab('manual')} className={`px-5 py-3 rounded-xl font-bold text-sm transition-all whitespace-nowrap ${activeSetTab === 'manual' ? 'bg-orange-600 text-white shadow-md' : 'bg-[#114022] text-orange-400 hover:bg-[#164d2b]'}`}>Setoran Manual</button>
        )}
      </div>

      <div className="bg-[#114022] rounded-[2.5rem] p-8 shadow-2xl border border-[#1b5e35] print-a4-layout">
        {activeSetTab === 'laporan' && <Laporan transactions={transactions} user={user} updateTransaction={updateTransaction} showToast={showToast} setConfirmDialog={setConfirmDialog} settings={settings} />}
        {activeSetTab === 'rekapan' && user.role === 'master' && <RekapanLaporan transactions={transactions} user={user} settings={settings} />}
        {activeSetTab === 'storage' && user.role === 'master' && <SettingStorage transactions={transactions} updateTransaction={updateTransaction} showToast={showToast} setConfirmDialog={setConfirmDialog} />}
        {activeSetTab === 'tarif' && <SettingTarif settings={settings} setSettings={setSettings} isReadOnly={isReadOnly} user={user} showToast={showToast} />}
        {activeSetTab === 'member' && <SettingMember settings={settings} setSettings={setSettings} isReadOnly={isReadOnly} user={user} showToast={showToast} />}
        {activeSetTab === 'shift' && <SettingShift settings={settings} setSettings={setSettings} isReadOnly={isReadOnly} user={user} showToast={showToast} />}
        {activeSetTab === 'users' && user.role === 'master' && <SettingUser settings={settings} setSettings={setSettings} showToast={showToast} />}
        {activeSetTab === 'tiket' && <SettingTiket settings={settings} setSettings={setSettings} isReadOnly={isReadOnly} showToast={showToast} />}
        {activeSetTab === 'web' && <SettingWeb settings={settings} setSettings={setSettings} isReadOnly={isReadOnly} showToast={showToast} />}
        {activeSetTab === 'manual' && (user.role === 'master' || user.role === 'korlap') && <SettingSetoranManual user={user} addTransaction={addTransaction} showToast={showToast} />}
      </div>
    </div>
  );
}

// Sub-Setting: Database Storage
function SettingStorage({ transactions, updateTransaction, showToast, setConfirmDialog }) {
   const MAX_SIMULATED_STORAGE_MB = 100; // Simulated 100MB Total Capacity for Base64 Data
   const MAX_STORAGE_BYTES = MAX_SIMULATED_STORAGE_MB * 1024 * 1024;

   const [selectedIds, setSelectedIds] = useState([]);
   const [isDeleting, setIsDeleting] = useState(false);

   let sizeMasuk = 0, sizeKeluar = 0, sizeDokumen = 0, sizeText = 0;
   
   const txWithSizes = transactions.map(tx => {
      const masukB = getBase64Size(tx.fotoMasuk);
      const keluarB = getBase64Size(tx.fotoKeluar);
      const docB = getBase64Size(tx.fotoKTP) + getBase64Size(tx.fotoSTNK);
      const textB = JSON.stringify(tx).length;

      sizeMasuk += masukB;
      sizeKeluar += keluarB;
      sizeDokumen += docB;
      sizeText += textB;

      return { ...tx, masukB, keluarB, docB, textB, totalPhotoB: masukB + keluarB + docB };
   });

   const totalUsedBytes = sizeMasuk + sizeKeluar + sizeDokumen + sizeText;
   const freeBytes = MAX_STORAGE_BYTES - totalUsedBytes > 0 ? MAX_STORAGE_BYTES - totalUsedBytes : 0;
   const totalUsedMB = (totalUsedBytes / (1024 * 1024)).toFixed(2);
   const freeMB = (freeBytes / (1024 * 1024)).toFixed(2);

   const totalChartBytes = totalUsedBytes + freeBytes;
   const pMasuk = (sizeMasuk / totalChartBytes) * 100;
   const pKeluar = (sizeKeluar / totalChartBytes) * 100;
   const pDoc = (sizeDokumen / totalChartBytes) * 100;
   const pText = (sizeText / totalChartBytes) * 100;
   
   const txWithPhotos = txWithSizes.filter(tx => tx.totalPhotoB > 0).sort((a,b) => b.waktuMasuk - a.waktuMasuk);

   const handleSelectAll = (e) => {
      if (e.target.checked) {
         setSelectedIds(txWithPhotos.map(t => t.id));
      } else {
         setSelectedIds([]);
      }
   };

   const handleSelectOne = (id, checked) => {
      if (checked) setSelectedIds([...selectedIds, id]);
      else setSelectedIds(selectedIds.filter(i => i !== id));
   };

   const handleBulkDelete = () => {
      if (selectedIds.length === 0) return showToast("Pilih minimal satu data!", "warning");
      
      setConfirmDialog({
         title: "Hapus File Storage?",
         message: `Anda akan menghapus file foto dari ${selectedIds.length} transaksi. Histori teks transaksi akan tetap ada. Tindakan ini tidak dapat dibatalkan!`,
         onConfirm: async () => {
             setConfirmDialog(null);
             setIsDeleting(true);
             try {
                for (const id of selectedIds) {
                   await updateTransaction(id, { fotoMasuk: null, fotoKeluar: null, fotoKTP: null, fotoSTNK: null, photoCleaned: true });
                }
                showToast(`Memori foto dari ${selectedIds.length} transaksi berhasil dihapus/dibersihkan!`);
                setSelectedIds([]);
             } catch (e) {
                showToast("Terjadi kesalahan saat menghapus memori.", "error");
             }
             setIsDeleting(false);
         },
         onCancel: () => setConfirmDialog(null)
      });
   };

   return (
      <div className="space-y-6 animate-in fade-in">
         <div className="flex flex-col md:flex-row gap-6">
            <div className="bg-[#092613] p-6 rounded-3xl border border-[#1b5e35] flex flex-col items-center justify-center shrink-0 w-full md:w-auto">
               <h3 className="font-bold text-white mb-6 uppercase tracking-widest text-sm flex items-center gap-2">
                  <Database size={16} className="text-purple-400"/> Kapasitas Memori Database
               </h3>
               
               <div style={{
                  background: `conic-gradient(
                     #0d9488 0% ${pMasuk}%,
                     #ea580c ${pMasuk}% ${pMasuk+pKeluar}%,
                     #3b82f6 ${pMasuk+pKeluar}% ${pMasuk+pKeluar+pDoc}%,
                     #22c55e ${pMasuk+pKeluar+pDoc}% ${pMasuk+pKeluar+pDoc+pText}%,
                     #1b5e35 ${pMasuk+pKeluar+pDoc+pText}% 100%
                  )`
               }} className="w-48 h-48 rounded-full flex items-center justify-center relative shadow-[0_0_30px_rgba(0,0,0,0.5)]">
                  <div className="w-36 h-36 bg-[#092613] rounded-full flex items-center justify-center flex-col shadow-inner z-10 border border-[#1b5e35]/50">
                     <span className="text-3xl font-black text-white leading-none">{totalUsedMB}</span>
                     <span className="text-xs text-green-200/50 mt-1">MB Terpakai</span>
                  </div>
               </div>

               <p className="mt-6 text-sm text-green-200/70 font-medium bg-[#114022] px-4 py-2 rounded-xl border border-[#1b5e35]">
                  Sisa Kapasitas: <strong className="text-white">{freeMB} MB</strong> dari <strong className="text-purple-400">{MAX_SIMULATED_STORAGE_MB} MB</strong>
               </p>
            </div>

            <div className="flex-1 bg-[#092613] p-6 rounded-3xl border border-[#1b5e35]">
               <h3 className="font-bold text-white mb-6 uppercase tracking-widest text-sm border-b border-[#1b5e35] pb-2">Rincian Penggunaan Memori</h3>
               <div className="space-y-4">
                  <div className="flex justify-between items-center p-3 rounded-xl hover:bg-[#114022] transition-colors border border-transparent hover:border-[#1b5e35]">
                     <div className="flex items-center gap-3"><div className="w-4 h-4 rounded-full bg-teal-600"></div><span className="text-sm text-white font-medium">Foto Kendaraan Masuk</span></div>
                     <span className="text-sm font-bold text-teal-400">{formatBytes(sizeMasuk)}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 rounded-xl hover:bg-[#114022] transition-colors border border-transparent hover:border-[#1b5e35]">
                     <div className="flex items-center gap-3"><div className="w-4 h-4 rounded-full bg-orange-600"></div><span className="text-sm text-white font-medium">Foto Kendaraan Keluar</span></div>
                     <span className="text-sm font-bold text-orange-400">{formatBytes(sizeKeluar)}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 rounded-xl hover:bg-[#114022] transition-colors border border-transparent hover:border-[#1b5e35]">
                     <div className="flex items-center gap-3"><div className="w-4 h-4 rounded-full bg-blue-600"></div><span className="text-sm text-white font-medium">Dokumen Denda (KTP/STNK)</span></div>
                     <span className="text-sm font-bold text-blue-400">{formatBytes(sizeDokumen)}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 rounded-xl hover:bg-[#114022] transition-colors border border-transparent hover:border-[#1b5e35]">
                     <div className="flex items-center gap-3"><div className="w-4 h-4 rounded-full bg-green-500"></div><span className="text-sm text-white font-medium">Data Histori Teks Murni</span></div>
                     <span className="text-sm font-bold text-green-400">{formatBytes(sizeText)}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 rounded-xl hover:bg-[#114022] transition-colors border border-transparent hover:border-[#1b5e35]">
                     <div className="flex items-center gap-3"><div className="w-4 h-4 rounded-full bg-[#1b5e35]"></div><span className="text-sm text-green-200/50 font-medium">Sisa Ruang Kosong (Simulasi)</span></div>
                     <span className="text-sm font-bold text-green-200/50">{formatBytes(freeBytes)}</span>
                  </div>
               </div>
            </div>
         </div>

         <div className="bg-[#092613] rounded-3xl border border-[#1b5e35] overflow-hidden flex flex-col max-h-[500px]">
            <div className="p-4 bg-[#0c331a] border-b border-[#1b5e35] flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0">
               <div>
                  <h3 className="font-bold text-white uppercase text-sm">Manajer File Transaksi</h3>
                  <p className="text-xs text-green-200/60 mt-0.5">Pilih riwayat transaksi di bawah ini untuk mengosongkan file foto dari database (Teks histori tidak akan dihapus).</p>
               </div>
               <button onClick={handleBulkDelete} disabled={selectedIds.length === 0 || isDeleting} className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${selectedIds.length > 0 ? 'bg-red-600 text-white hover:bg-red-500 shadow-lg' : 'bg-[#114022] text-green-300/30 cursor-not-allowed'}`}>
                  <Trash2 size={16}/> {isDeleting ? 'Menghapus...' : `Hapus Foto Terpilih (${selectedIds.length})`}
               </button>
            </div>
            
            <div className="overflow-x-auto overflow-y-auto custom-scrollbar flex-1">
               <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-[#0c331a] z-10 shadow-sm">
                     <tr className="text-green-300/70 text-xs uppercase">
                        <th className="p-4 border-b border-[#1b5e35] w-12 text-center">
                           <input type="checkbox" onChange={handleSelectAll} checked={selectedIds.length === txWithPhotos.length && txWithPhotos.length > 0} className="w-4 h-4 accent-red-500 rounded cursor-pointer" />
                        </th>
                        <th className="p-4 border-b border-[#1b5e35]">Tanggal & Nopol</th>
                        <th className="p-4 border-b border-[#1b5e35] text-center">Foto Masuk</th>
                        <th className="p-4 border-b border-[#1b5e35] text-center">Foto Keluar</th>
                        <th className="p-4 border-b border-[#1b5e35] text-center">Dokumen Hilang</th>
                        <th className="p-4 border-b border-[#1b5e35] text-right">Total Ukuran</th>
                     </tr>
                  </thead>
                  <tbody>
                     {txWithPhotos.length === 0 ? (
                        <tr><td colSpan="6" className="p-8 text-center text-green-300/30 text-sm">Seluruh foto transaksi sudah kosong / bersih.</td></tr>
                     ) : (
                        txWithPhotos.map(tx => (
                           <tr key={tx.id} className="hover:bg-[#114022] border-b border-[#1b5e35]/50 text-sm transition-colors">
                              <td className="p-4 text-center">
                                 <input type="checkbox" checked={selectedIds.includes(tx.id)} onChange={(e) => handleSelectOne(tx.id, e.target.checked)} className="w-4 h-4 accent-red-500 rounded cursor-pointer" />
                              </td>
                              <td className="p-4">
                                 <p className="font-bold text-white text-base">{tx.nopol}</p>
                                 <p className="text-[10px] text-green-200/50 mt-1">{tx.waktuMasuk.toLocaleString('id-ID')}</p>
                              </td>
                              <td className="p-4 text-center"><span className={`px-2 py-1 rounded-md text-[10px] ${tx.masukB > 0 ? 'bg-teal-900/50 text-teal-400 font-bold' : 'text-green-200/30'}`}>{tx.masukB > 0 ? formatBytes(tx.masukB) : 'N/A'}</span></td>
                              <td className="p-4 text-center"><span className={`px-2 py-1 rounded-md text-[10px] ${tx.keluarB > 0 ? 'bg-orange-900/50 text-orange-400 font-bold' : 'text-green-200/30'}`}>{tx.keluarB > 0 ? formatBytes(tx.keluarB) : 'N/A'}</span></td>
                              <td className="p-4 text-center"><span className={`px-2 py-1 rounded-md text-[10px] ${tx.docB > 0 ? 'bg-blue-900/50 text-blue-400 font-bold' : 'text-green-200/30'}`}>{tx.docB > 0 ? formatBytes(tx.docB) : 'N/A'}</span></td>
                              <td className="p-4 text-right font-bold text-red-400">{formatBytes(tx.totalPhotoB)}</td>
                           </tr>
                        ))
                     )}
                  </tbody>
               </table>
            </div>
         </div>
      </div>
   );
}

// Sub-Setting: Setoran Manual
function SettingSetoranManual({ user, addTransaction, showToast }) {
  const [form, setForm] = useState({ motor: '', mobil: '', box: '', sepeda: '', nominal: '' });

  const handleSubmit = async (e) => {
    e.preventDefault();
    const nominalInt = parseInt(String(form.nominal).replace(/[^0-9]/g, ''), 10);
    if (isNaN(nominalInt) || nominalInt <= 0) return showToast("Nominal wajib diisi dan lebih dari 0!", "error");

    const newTx = {
      id: `manual_${Date.now()}`,
      isManual: true,
      nopol: 'MANUAL',
      jenis: 'Manual Backup',
      waktuMasuk: new Date(),
      waktuKeluar: new Date(),
      status: 'OUT',
      lokasi: user.lokasi === 'All Lokasi' ? PURE_LOCATIONS[0] : user.lokasi,
      kasirMasuk: user.nama,
      kasirKeluar: user.nama,
      totalBiaya: nominalInt,
      durasiJam: 1,
      durasiText: 'Input Manual',
      details: {
        'Motor': parseInt(form.motor) || 0,
        'Mobil': parseInt(form.mobil) || 0,
        'Box/Truck': parseInt(form.box) || 0,
        'Sepeda/Becak': parseInt(form.sepeda) || 0
      }
    };

    await addTransaction(newTx);
    showToast("Setoran Manual Berhasil Disimpan & Masuk Ke Pendapatan!");
    setForm({ motor: '', mobil: '', box: '', sepeda: '', nominal: '' });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 animate-in fade-in">
      <div className="bg-[#092613] p-5 rounded-2xl border border-[#1b5e35]">
         <h4 className="font-bold text-white mb-2 uppercase text-sm flex items-center gap-2"><Database size={18} className="text-orange-400"/> Input Pendapatan Manual (Backup)</h4>
         <p className="text-xs text-green-200/70 leading-relaxed mb-4">Gunakan form ini hanya jika terjadi gangguan sistem/jaringan. Pendapatan ini akan otomatis masuk ke laporan akhir shift Anda dengan status khusus "Pendapatan Manual".</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
         <div>
            <label className="block text-xs font-bold text-green-200/70 ml-2 mb-2 uppercase tracking-wider">Qty Motor</label>
            <input type="number" min="0" value={form.motor} onChange={e => setForm({...form, motor: e.target.value})} placeholder="0" className="w-full bg-[#092613] border border-[#1b5e35] rounded-xl px-4 py-3 text-white outline-none focus:border-orange-500" />
         </div>
         <div>
            <label className="block text-xs font-bold text-green-200/70 ml-2 mb-2 uppercase tracking-wider">Qty Mobil</label>
            <input type="number" min="0" value={form.mobil} onChange={e => setForm({...form, mobil: e.target.value})} placeholder="0" className="w-full bg-[#092613] border border-[#1b5e35] rounded-xl px-4 py-3 text-white outline-none focus:border-orange-500" />
         </div>
         <div>
            <label className="block text-xs font-bold text-green-200/70 ml-2 mb-2 uppercase tracking-wider">Qty Box/Truck</label>
            <input type="number" min="0" value={form.box} onChange={e => setForm({...form, box: e.target.value})} placeholder="0" className="w-full bg-[#092613] border border-[#1b5e35] rounded-xl px-4 py-3 text-white outline-none focus:border-orange-500" />
         </div>
         <div>
            <label className="block text-xs font-bold text-green-200/70 ml-2 mb-2 uppercase tracking-wider">Qty Sepeda/Becak</label>
            <input type="number" min="0" value={form.sepeda} onChange={e => setForm({...form, sepeda: e.target.value})} placeholder="0" className="w-full bg-[#092613] border border-[#1b5e35] rounded-xl px-4 py-3 text-white outline-none focus:border-orange-500" />
         </div>
      </div>

      <div>
         <label className="block text-sm font-bold text-green-200/70 ml-2 mb-2 uppercase tracking-wider">Total Nominal Rupiah (Rp)</label>
         <input type="number" min="1" required value={form.nominal} onChange={e => setForm({...form, nominal: e.target.value})} placeholder="Cth: 150000" className="w-full bg-[#092613] border-2 border-orange-500/50 rounded-[1.5rem] px-5 py-4 text-2xl font-black text-white outline-none focus:border-orange-500" />
      </div>

      <button type="submit" className="w-full bg-orange-600 text-white font-black rounded-[1.5rem] px-6 py-4 shadow-xl hover:bg-orange-500 transition-all flex justify-center items-center gap-2 text-lg">
         <CheckCircle2 size={24}/> Simpan Pendapatan Manual
      </button>
    </form>
  );
}

// Sub-Component Laporan Visual
function Laporan({ transactions, user, updateTransaction, showToast, setConfirmDialog, settings }) {
  const [lapTab, setLapTab] = useState('ringkasan');
  const [zoomImg, setZoomImg] = useState(null);
  const [isCleaning, setIsCleaning] = useState(false);
  const webSettings = settings?.web || {};
  
  const [filterMode, setFilterMode] = useState('semua');
  const [filterDate, setFilterDate] = useState(new Date().toISOString().slice(0, 10));
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7));
  const [filterYear, setFilterYear] = useState(new Date().getFullYear().toString());
  const locShifts = getLocSettings(settings, user.lokasi).shifts || [];
  const [filterShift, setFilterShift] = useState(locShifts[0]?.id || '');

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

  let hasManual = false;
  let manualTotalQty = 0;
  let manualTotalNominal = 0;

  completedTx.forEach(tx => {
     if (tx.isManual) {
         hasManual = true;
         manualTotalQty += (tx.details?.['Motor'] || 0) + (tx.details?.['Mobil'] || 0) + (tx.details?.['Box/Truck'] || 0) + (tx.details?.['Sepeda/Becak'] || 0);
         manualTotalNominal += (tx.totalBiaya || 0);
     } else if (tx.jenis && breakdown[tx.jenis] !== undefined) { 
         breakdown[tx.jenis].qty += 1; 
         breakdown[tx.jenis].nominal += tx.totalBiaya || 0; 
     }

     if (!tx.isManual) {
        const jam = tx.durasiJam || 1;
        if (jam <= 1) durasiStats['1 Jam Awal'] += 1;
        else if (jam <= 5) durasiStats['2 sd 5 Jam'] += 1;
        else if (jam <= 12) durasiStats['6 sd 12 Jam'] += 1;
        else if (jam <= 24) durasiStats['13 sd 24 Jam'] += 1;
        else durasiStats['> 24 Jam'] += 1;
     }
  });

  if (hasManual) {
      breakdown['Pendapatan Manual (Backup)'] = { qty: manualTotalQty, nominal: manualTotalNominal };
  }

  const totalQtySelesai = Object.values(breakdown).reduce((sum, item) => sum + item.qty, 0);

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
                           <tr key={jenis} className={`border-b border-[#1b5e35]/50 print:border-gray-400 ${jenis === 'Pendapatan Manual (Backup)' ? 'text-orange-400' : ''}`}>
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
                        const persentase = (totalQtySelesai - manualTotalQty) > 0 ? ((count / (totalQtySelesai - manualTotalQty)) * 100).toFixed(1) : 0;
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

      {/* TAB MASTER LIST */}
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
                       <td className={`p-2 ${tx.isManual ? 'text-orange-400 font-bold' : ''}`}>{tx.jenis}</td>
                       <td className="p-2 text-center">
                          {tx.status === 'IN' ? (
                            <span className="bg-amber-900/50 text-amber-400 print:bg-transparent print:text-black print:font-bold px-2 py-0.5 rounded text-[10px]">Di Area</span>
                          ) : (
                            <span className={`${tx.isManual ? 'bg-orange-900/50 text-orange-400' : 'bg-green-900/50 text-green-400'} print:bg-transparent print:text-black px-2 py-0.5 rounded text-[10px]`}>{tx.isManual ? 'Manual Backup' : 'Selesai'}</span>
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
                   <tr key={tx.id} className={`hover:bg-[#114022] border-b border-[#1b5e35]/50 text-sm transition-colors text-white ${tx.isManual ? 'bg-orange-900/10' : ''}`}>
                     <td className="p-4 font-bold">{tx.nopol} <span className={`block text-xs mt-1 ${tx.isManual ? 'text-orange-400' : 'text-green-400/50'}`}>{tx.jenis}</span></td>
                     <td className="p-4 text-xs text-green-200/70"><p>IN: {tx.waktuMasuk.toLocaleString('id-ID')}</p><p>OUT: {tx.waktuKeluar.toLocaleString('id-ID')}</p></td>
                     <td className="p-4 flex gap-2">
                        {tx.fotoMasuk ? <img src={tx.fotoMasuk} onClick={()=>setZoomImg(tx.fotoMasuk)} className="w-16 h-12 object-cover rounded cursor-pointer border border-[#1b5e35]" alt="In"/> : <div className="w-16 h-12 bg-black/50 border border-[#1b5e35] rounded flex items-center justify-center text-[8px] text-green-200/30">N/A</div>}
                        {tx.fotoKeluar ? <img src={tx.fotoKeluar} onClick={()=>setZoomImg(tx.fotoKeluar)} className="w-16 h-12 object-cover rounded cursor-pointer border border-[#1b5e35]" alt="Out"/> : <div className="w-16 h-12 bg-black/50 border border-[#1b5e35] rounded flex items-center justify-center text-[8px] text-green-200/30">N/A</div>}
                     </td>
                     <td className="p-4 font-bold text-green-400">Rp {tx.totalBiaya.toLocaleString('id-ID')} {tx.tiketHilang && <span className="text-red-500 block text-xs">(Denda Hilang Tiket)</span>} {tx.isManual && <span className="text-orange-400 block text-xs">(Backup Sistem)</span>}</td>
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

// Sub-Component Rekapan Global
function RekapanLaporan({ transactions, user, settings }) {
  const [filterMode, setFilterMode] = useState('semua');
  const [filterDate, setFilterDate] = useState(new Date().toISOString().slice(0, 10));
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7));
  const [filterYear, setFilterYear] = useState(new Date().getFullYear().toString());
  const locShifts = getLocSettings(settings, user.lokasi).shifts || [];
  const [filterShift, setFilterShift] = useState(locShifts[0]?.id || '');
  const webSettings = settings?.web || {};

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
      const row = [t.id, t.lokasi, t.nopol, t.isManual ? 'Manual Backup' : t.jenis, t.status, wMasuk, wKeluar, t.durasiText || '-', t.totalBiaya || 0, t.kasirKeluar || '-', t.tiketHilang ? 'YA' : 'TIDAK'].map(v => `"${v}"`).join(",");
      csvContent += row + "\n";
    });
    const link = document.createElement("a");
    link.href = encodeURI(csvContent);
    link.download = `Rekapan_Global_Parkir_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
  };

  return (
    <div className="space-y-6 print-a4-layout">
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
                      <td className={`p-2 ${tx.isManual ? 'text-orange-400 font-bold' : ''}`}>{tx.isManual ? 'Manual Backup' : tx.jenis}</td>
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
  const [localTariff, setLocalTariff] = useState(getLocSettings(settings, targetLokasi).tariffs || DEFAULT_LOCATION_SETTINGS.tariffs);

  const [dirty, setDirty] = useState({ 'Motor': false, 'Mobil': false, 'Box/Truck': false, 'Sepeda/Becak': false });

  useEffect(() => { 
     const dbTariff = getLocSettings(settings, targetLokasi).tariffs || DEFAULT_LOCATION_SETTINGS.tariffs;
     setLocalTariff(prev => {
         const nextState = { ...prev };
         Object.keys(dbTariff).forEach(jenis => {
             if (!dirty[jenis]) {
                 nextState[jenis] = dbTariff[jenis];
             }
         });
         return nextState;
     });
  }, [settings, targetLokasi, dirty]); 

  useEffect(() => {
     setDirty({ 'Motor': false, 'Mobil': false, 'Box/Truck': false, 'Sepeda/Becak': false });
  }, [targetLokasi]);

  const updateTariff = (jenis, field, val) => {
    if (isReadOnly) return;
    setDirty(prev => ({ ...prev, [jenis]: true }));
    setLocalTariff(prev => ({ ...prev, [jenis]: { ...prev[jenis], [field]: field === 'mode' || typeof val === 'boolean' ? val : Number(val) } }));
  };

  const handleSaveJenis = (jenis) => {
     if (isReadOnly) return;
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
     setDirty(prev => ({ ...prev, [jenis]: false })); 
     showToast(`Tarif ${jenis} di lokasi ${targetLokasi} berhasil disimpan!`);
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
          <div key={jenis} className={`border ${dirty[jenis] ? 'border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.15)]' : 'border-[#1b5e35]'} rounded-2xl p-5 bg-[#092613] transition-all duration-300`}>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
              <div className="flex items-center gap-3">
                 <h4 className="font-bold text-lg text-white border-b-2 border-green-500 pb-1">{jenis}</h4>
                 {dirty[jenis] && (
                     <span className="bg-amber-900/50 text-amber-400 border border-amber-500/50 text-[10px] px-2 py-1 rounded font-bold uppercase flex items-center gap-1"><Settings size={12}/> Belum Disimpan</span>
                 )}
              </div>
              <div className="flex bg-[#114022] rounded-xl p-1 border border-[#1b5e35]">
                 <button disabled={isReadOnly} onClick={() => updateTariff(jenis, 'mode', 'progressif')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${localTariff[jenis].mode === 'progressif' ? 'bg-green-600 text-white shadow-sm' : 'text-green-300/50 hover:text-white'}`}>Progressif</button>
                 <button disabled={isReadOnly} onClick={() => updateTariff(jenis, 'mode', 'flat')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${localTariff[jenis].mode === 'flat' ? 'bg-green-600 text-white shadow-sm' : 'text-green-300/50 hover:text-white'}`}>Flat</button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div>
                <label className="block text-xs text-green-200/70 mb-1">Jam Pertama (Rp)</label>
                <input disabled={isReadOnly} type="number" value={localTariff[jenis].first} onChange={e => updateTariff(jenis, 'first', e.target.value)} className="w-full bg-[#114022] border border-[#1b5e35] rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-amber-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" />
              </div>
              <div className={localTariff[jenis].mode === 'flat' ? 'opacity-50 pointer-events-none' : ''}>
                <label className="block text-xs text-green-200/70 mb-1">Durasi Awal</label>
                <select disabled={isReadOnly} value={localTariff[jenis].firstDuration} onChange={e => updateTariff(jenis, 'firstDuration', e.target.value)} className="w-full bg-[#114022] border border-[#1b5e35] rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-amber-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                  {[...Array(24).keys()].map(i => <option key={i+1} value={i+1}>{i+1} Jam</option>)}
                </select>
              </div>
              <div className={localTariff[jenis].mode === 'flat' ? 'opacity-50 pointer-events-none' : ''}>
                <label className="block text-xs text-green-200/70 mb-1">Jam Berikutnya (Rp)</label>
                <input disabled={isReadOnly} type="number" value={localTariff[jenis].next} onChange={e => updateTariff(jenis, 'next', e.target.value)} className="w-full bg-[#114022] border border-[#1b5e35] rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-amber-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" />
              </div>
              <div className={localTariff[jenis].mode === 'flat' ? 'opacity-50 pointer-events-none' : ''}>
                <label className="block text-xs text-green-200/70 mb-1">Tarif Maksimal (Rp)</label>
                <input disabled={isReadOnly} type="number" value={localTariff[jenis].max} onChange={e => updateTariff(jenis, 'max', e.target.value)} className="w-full bg-[#114022] border border-[#1b5e35] rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-amber-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" />
              </div>
              <div className={localTariff[jenis].mode === 'flat' ? 'opacity-50 pointer-events-none' : ''}>
                <label className="block text-xs text-green-200/70 mb-1">Tarif Inap/Hari (Rp)</label>
                <input disabled={isReadOnly} type="number" value={localTariff[jenis].inap} onChange={e => updateTariff(jenis, 'inap', e.target.value)} className="w-full bg-[#114022] border border-[#1b5e35] rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-amber-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" />
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-[#1b5e35] flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
               <div className="flex items-center gap-4">
                   <label className="flex items-center gap-2 text-sm cursor-pointer text-green-200/70">
                      <input type="checkbox" disabled={isReadOnly} checked={localTariff[jenis].gracePeriodActive} onChange={e => updateTariff(jenis, 'gracePeriodActive', e.target.checked)} className="rounded accent-amber-500 w-4 h-4 disabled:opacity-50 disabled:cursor-not-allowed" />
                      Aktifkan Grace Periode
                   </label>
                   {localTariff[jenis].gracePeriodActive && (
                      <div className="flex items-center gap-2 animate-in fade-in">
                         <span className="text-xs text-green-200/70">Berapa menit?</span>
                         <input disabled={isReadOnly} type="number" value={localTariff[jenis].gracePeriodMinutes} onChange={e => updateTariff(jenis, 'gracePeriodMinutes', e.target.value)} className="w-20 bg-[#114022] border border-[#1b5e35] rounded-lg px-2 py-1 text-sm text-white outline-none focus:border-amber-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" />
                      </div>
                   )}
               </div>

               <div className="w-full md:w-auto flex justify-end">
                   {!isReadOnly && (
                      <button onClick={() => handleSaveJenis(jenis)} className={`w-full md:w-auto px-5 py-2 rounded-xl text-xs font-bold flex justify-center items-center gap-2 shadow-lg transition-all ${dirty[jenis] ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-600/20' : 'bg-[#114022] text-green-500 border border-[#1b5e35]'}`}>
                         <CheckCircle2 size={16}/> {dirty[jenis] ? `Simpan Perubahan ${jenis}` : `Tarif ${jenis} Tersimpan`}
                      </button>
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

  const handleSave = (e) => { 
      e.preventDefault(); 
      setSettings({ ...settings, web: form });
      showToast("Pengaturan Web & Logo Tersimpan!"); 
  };

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="bg-[#092613] p-5 rounded-2xl border border-[#1b5e35]">
         <h4 className="font-bold text-white mb-2 uppercase text-sm flex items-center gap-2"><Bluetooth size={18} className="text-teal-400"/> Pengaturan Printer Default</h4>
         <p className="text-xs text-green-200/70 leading-relaxed mb-4">Aplikasi ini telah dioptimalkan untuk menggunakan pencetakan otomatis (<strong>Direct Background Print</strong>).</p>
         <div className="bg-[#114022] p-4 rounded-xl border border-[#1b5e35]">
            <ol className="text-xs text-green-200/60 list-decimal ml-4 space-y-2">
               <li><strong>Android:</strong> Wajib install aplikasi <strong>RawBT</strong> Print Service. Aktifkan fitur <em>"Don't ask before print"</em> agar struk otomatis keluar seketika tanpa dialog.</li>
               <li>Pastikan Printer Thermal Bluetooth Anda sudah di-pairing (dipasangkan) di setingan Bluetooth HP.</li>
            </ol>
         </div>
      </div>

      <div className="bg-[#092613] p-5 rounded-2xl border border-[#1b5e35] flex flex-col items-center text-center">
        <p className="text-sm font-bold text-green-200/70 mb-4 uppercase">Master Logo Perusahaan (Tampil di Web & Cetakan Struk)</p>
        <img src={form.logoUrl} alt="Logo" className="h-20 bg-white/10 rounded-xl px-4 py-2 mb-4 object-contain" />
        {!isReadOnly && (
          <div>
            <input type="file" id="upload-logo" accept="image/*" className="hidden" onChange={handleLogoUpload} />
            <label htmlFor="upload-logo" className="bg-green-600 hover:bg-green-500 text-white font-bold py-2 px-6 rounded-xl cursor-pointer inline-flex items-center gap-2"><UploadCloud size={16}/> Upload Master Logo</label>
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
  const defaultTicketSettings = { title: 'Sistem Device Portable', subtitle: '', footerIn: 'SIMPAN TIKET INI', footerOut: 'TERIMA KASIH' };
  const [form, setForm] = useState(settings.ticket || defaultTicketSettings);

  const handleSave = (e) => {
     e.preventDefault();
     setSettings({ ...settings, ticket: form });
     showToast("Pengaturan Struk/Tiket Tersimpan!");
  };

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="bg-[#092613] p-5 rounded-2xl border border-[#1b5e35]">
         <h4 className="font-bold text-white mb-2 uppercase text-sm flex items-center gap-2"><Printer size={18} className="text-teal-400"/> Editor Konten Struk</h4>
         <p className="text-xs text-green-200/70 leading-relaxed mb-4">Sesuaikan teks Header dan Footer khusus untuk cetakan tiket masuk dan struk keluar. <b>Catatan: Logo struk mengambil dari menu Web & Printer.</b></p>
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