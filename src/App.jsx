import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, CheckCircle2, LogOut, Settings, 
  MapPin, Clock, FileText, ArrowRightSquare, 
  ArrowLeftSquare, Search, Car, Truck, Bike, Download, Share2,
  ChevronDown, Bluetooth, Users, Wallet, Monitor, ShieldCheck, FileImage,
  UploadCloud, AlertTriangle, Maximize2, X, UserCog, CalendarClock, Lock,
  Trash2, Database
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, onSnapshot } from 'firebase/firestore';

// --- BUG FIX: Mencegah error "tailwind is not defined" dari environment ---
if (typeof window !== 'undefined') {
  window.tailwind = window.tailwind || {};
  window.tailwind.config = window.tailwind.config || {};
}

// --- HELPER FUNCTION: Image Processing/Compression ---
// OPTIMALISASI DATABASE: Resolusi dan kualitas gambar dikurangi drastis namun tetap terbaca (Hemat kapasitas hingga 80%)
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
      callback(canvas.toDataURL('image/jpeg', 0.4)); // Kualitas 40%
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
};

// --- CONSTANTS & DEFAULT DATA ---
const PURE_LOCATIONS = ['ST. Cimahi Selatan', 'ST. Gadobangkong', 'ST. Cianjur', 'ST. Cibatu'];
const LOCATIONS = [...PURE_LOCATIONS, 'All Lokasi'];

const DEFAULT_LOCATION_SETTINGS = {
  tariffs: {
    'Motor': { mode: 'progressif', first: 2000, firstDuration: 1, next: 1000, max: 10000, inap: 5000, gracePeriodActive: true, gracePeriodMinutes: 10 },
    'Mobil': { mode: 'progressif', first: 5000, firstDuration: 1, next: 2000, max: 25000, inap: 15000, gracePeriodActive: true, gracePeriodMinutes: 10 },
    'Box/Truck': { mode: 'progressif', first: 10000, firstDuration: 2, next: 5000, max: 50000, inap: 25000, gracePeriodActive: false, gracePeriodMinutes: 10 },
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
    printerConnected: false
  },
  members: [],
  users: [
    { id: 'u1', nipp: '200041', nama: 'petugas Master', role: 'master', password: 'R3gional2BD!', canViewArea: true },
    { id: 'u2', nipp: 'AUDIT', nama: 'Petugas Audit', role: 'audit', password: '123', canViewArea: true },
    { id: 'u3', nipp: 'KORLAP', nama: 'Petugas Korlap', role: 'korlap', password: '123', canViewArea: false }
  ],
  locations: PURE_LOCATIONS.reduce((acc, loc) => ({ ...acc, [loc]: JSON.parse(JSON.stringify(DEFAULT_LOCATION_SETTINGS)) }), {})
};

// Helper: Mendapatkan setingan lokasi spesifik (Fallback aman ke default)
const getLocSettings = (settings, locName) => {
  if (locName === 'All Lokasi') locName = PURE_LOCATIONS[0];
  if (settings.locations && settings.locations[locName]) return settings.locations[locName];
  if (settings.tariffs && settings.shifts) return { tariffs: settings.tariffs, shifts: settings.shifts }; // Legacy Support
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
// PASTIKAN HANYA ADA SATU "firebaseConfig" dan SATU "app" DI SINI
const firebaseConfig = {
  apiKey: "PASTE_API_KEY_ANDA_DISINI",
  authDomain: "PASTE_AUTH_DOMAIN_ANDA_DISINI",
  projectId: "PASTE_PROJECT_ID_ANDA_DISINI",
  storageBucket: "PASTE_STORAGE_BUCKET_ANDA_DISINI",
  messagingSenderId: "PASTE_SENDER_ID_ANDA_DISINI",
  appId: "PASTE_APP_ID_ANDA_DISINI"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = 'sistem-parkir-pro'; // ID Unik untuk Database Anda

// --- COMPONENTS ---

const CameraModal = ({ facingMode, onCapture, onClose, title }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [stream, setStream] = useState(null);

  useEffect(() => {
    const startCamera = async () => {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facingMode } });
        if (videoRef.current) videoRef.current.srcObject = mediaStream;
        setStream(mediaStream);
      } catch (err) {
        console.error("Camera Error:", err);
        alert("Gagal mengakses kamera. Pastikan izin diberikan.");
      }
    };
    startCamera();
    return () => { if (stream) stream.getTracks().forEach(track => track.stop()); };
  }, [facingMode]);

  const handleCapture = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const MAX_WIDTH = 300; // Dikompresi keras untuk database
      const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
      canvas.width = video.videoWidth * scale;
      canvas.height = video.videoHeight * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      onCapture(canvas.toDataURL('image/jpeg', 0.4)); // Kualitas 40%
      if (stream) stream.getTracks().forEach(track => track.stop());
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-md">
      <div className="bg-[#114022] p-6 rounded-[2rem] border border-[#1b5e35] shadow-2xl flex flex-col items-center max-w-md w-full mx-4">
        <h3 className="text-xl font-bold text-white mb-4">{title}</h3>
        <div className="relative rounded-3xl overflow-hidden w-full aspect-video bg-black mb-6 border border-[#1b5e35]">
          <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'scaleX(1)' }} />
          <canvas ref={canvasRef} className="hidden" />
        </div>
        <div className="flex gap-4 w-full">
          <button onClick={onClose} className="flex-1 py-4 rounded-2xl bg-[#092613] text-white font-bold hover:bg-black/20 transition-all">Batal</button>
          <button onClick={handleCapture} className="flex-1 py-4 rounded-2xl bg-green-600 text-white font-bold hover:bg-green-500 transition-all shadow-lg flex justify-center gap-2"><Camera size={20} /> Ambil Foto</button>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [transactions, setTransactions] = useState([]);
  const [fbUser, setFbUser] = useState(null);
  
  const [activeTab, setActiveTab] = useState('masuk');
  const [shiftData, setShiftData] = useState({ current: 'Loading...', showSummary: false });

  // Firebase Hooks
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
  }, [fbUser]);

  // DB Handlers
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

  // Check shift end every minute
  useEffect(() => {
    const interval = setInterval(() => {
      if(user) {
         const userLocShifts = getLocSettings(settings, user.lokasi).shifts;
         const active = getActiveShift(userLocShifts);
         if (active !== shiftData.current) setShiftData({ current: active, showSummary: true });
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [user, shiftData.current, settings]);

  const handleLogout = () => { 
    if(user){
       const userLocShifts = getLocSettings(settings, user.lokasi).shifts;
       setShiftData({ current: getActiveShift(userLocShifts), showSummary: false }); 
    }
    setUser(null); 
    setActiveTab('masuk'); 
  };

  // Menunggu Data Load
  if (!user) return <LoginScreen usersList={settings.users} onLogin={(u) => { 
     setUser({ ...u, loginTime: new Date() }); 
     const userLocShifts = getLocSettings(settings, u.lokasi).shifts;
     setShiftData({ current: getActiveShift(userLocShifts), showSummary: false }); 
     if (u.role === 'audit') setActiveTab('settings');
  }} />;

  const hasSettingsAccess = ['master', 'korlap', 'audit'].includes(user.role);
  const canViewArea = user.role === 'master' || user.role === 'audit' || user.role === 'kasir' || (user.role === 'korlap' && user.canViewArea);
  const canTransact = user.role === 'master' || user.role === 'korlap' || user.role === 'kasir';

  return (
    <div className="min-h-screen bg-[#092613] text-green-50 font-sans selection:bg-green-500 selection:text-white pb-28">
      {/* Header Tema Hijau Tua */}
      <header className="fixed top-0 w-full z-40 bg-[#0c331a]/90 backdrop-blur-xl border-b border-[#1b5e35] shadow-lg px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3 w-1/3">
          <img src={user.photo} alt="User" className="w-12 h-12 rounded-full object-cover border-2 border-green-500 shadow-sm bg-black" />
          <div className="leading-tight">
            <p className="font-bold text-white text-sm flex items-center gap-1">
              {user.nama} {user.role === 'master' && <ShieldCheck size={14} className="text-green-500"/>}
            </p>
            <p className="text-xs text-green-200/70 font-medium flex items-center gap-1"><MapPin size={10} /> {user.lokasi} | {shiftData.current}</p>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center overflow-hidden">
          <img src={settings.web.logoUrl} alt="Logo" className="h-8 object-contain mb-1 bg-white/10 backdrop-blur-sm rounded-lg px-2" />
          <div className="w-full max-w-md overflow-hidden bg-black rounded-full px-4 py-1 border border-[#1b5e35]">
            <marquee className="text-xs text-red-500 font-bold tracking-widest">{settings.web.runningText}</marquee>
          </div>
        </div>
        <div className="w-1/3 flex justify-end gap-2">
          {canTransact && (
             <button onClick={() => setShiftData(prev => ({...prev, showSummary: true}))} className="p-2 bg-orange-500/20 text-orange-400 rounded-xl hover:bg-orange-500/30 transition-colors text-xs font-bold hidden md:flex items-center gap-1 border border-orange-500/20">
               <Clock size={14} /> Akhiri Shift
             </button>
          )}
          <button onClick={() => setUser(null)} className="p-3 bg-red-600/20 text-red-400 rounded-xl hover:bg-red-600/30 transition-colors flex items-center gap-2 text-sm font-bold border border-red-600/20">
            <LogOut size={16} /> Keluar
          </button>
        </div>
      </header>

      <main className="pt-28 px-4 md:px-6 max-w-6xl mx-auto">
        {/* BIG TABS FOR MASUK & KELUAR */}
        {canTransact && !['area', 'settings'].includes(activeTab) && (
          <div className="flex gap-4 mb-8">
            <button onClick={() => setActiveTab('masuk')} className={`flex-1 py-6 md:py-8 rounded-[2rem] flex flex-col items-center justify-center gap-2 transition-all duration-300 shadow-xl border-2 ${activeTab === 'masuk' ? 'bg-green-600 border-green-400 text-white scale-[1.02]' : 'bg-[#114022] border-[#1b5e35] text-green-200/50 hover:bg-[#164d2b]'}`}>
              <ArrowRightSquare size={40} />
              <span className="text-xl md:text-3xl font-black uppercase tracking-widest">Pintu Masuk</span>
            </button>
            <button onClick={() => setActiveTab('keluar')} className={`flex-1 py-6 md:py-8 rounded-[2rem] flex flex-col items-center justify-center gap-2 transition-all duration-300 shadow-xl border-2 ${activeTab === 'keluar' ? 'bg-teal-600 border-teal-400 text-white scale-[1.02]' : 'bg-[#114022] border-[#1b5e35] text-green-200/50 hover:bg-[#164d2b]'}`}>
              <ArrowLeftSquare size={40} />
              <span className="text-xl md:text-3xl font-black uppercase tracking-widest">Pintu Keluar</span>
            </button>
          </div>
        )}

        {/* Content Routing */}
        {canTransact && activeTab === 'masuk' && <KendaraanMasuk user={user} addTransaction={handleAddTransaction} />}
        {canTransact && activeTab === 'keluar' && <KendaraanKeluar user={user} transactions={transactions} updateTransaction={handleUpdateTransaction} settings={settings} />}
        
        {canViewArea && activeTab === 'area' && <KendaraanArea transactions={transactions} user={user} />}
        {hasSettingsAccess && activeTab === 'settings' && <MasterSettings settings={settings} setSettings={handleUpdateSettings} user={user} transactions={transactions} updateTransaction={handleUpdateTransaction} />}
      </main>

      {/* Bottom Nav */}
      <div className="fixed bottom-6 w-full flex justify-center z-40 px-4">
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

// --- LOGIN COMPONENT ---
function LoginScreen({ onLogin, usersList }) {
  const [formData, setFormData] = useState({ nipp: '', password: '', lokasi: LOCATIONS[0] });
  const [showCamera, setShowCamera] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [tempUser, setTempUser] = useState(null);

  const handleLoginSubmit = (e) => {
    e.preventDefault();
    setErrorMsg('');
    const matchedUser = usersList.find(u => u.nipp === formData.nipp && u.password === formData.password);
    
    if (!matchedUser) {
       return setErrorMsg("NIPP atau Password Tidak Ditemukan/Salah!");
    }
    
    if (formData.lokasi === 'All Lokasi' && matchedUser.role !== 'master' && matchedUser.role !== 'audit') {
       return setErrorMsg("Hanya Master/Audit yang dapat mengakses 'All Lokasi'.");
    }

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
        </div>

        {errorMsg && <div className="bg-red-500/20 border border-red-500/50 text-red-200 p-3 rounded-xl text-sm mb-4 text-center font-bold">{errorMsg}</div>}

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
function KendaraanMasuk({ user, addTransaction }) {
  const [nopol, setNopol] = useState('');
  const [jenis, setJenis] = useState('Motor');
  const [showCamera, setShowCamera] = useState(false);
  const [printData, setPrintData] = useState(null);
  const [gps, setGps] = useState('Sedang mencari...');

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      pos => setGps(`${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`),
      err => setGps('GPS Tidak Tersedia')
    );
  }, []);

  const handleProcess = (e) => {
    e.preventDefault();
    if (!nopol) return alert("Nomor Polisi wajib diisi!");
    setShowCamera(true);
  };

  const handleCapture = (photo) => {
    setShowCamera(false);
    const newTx = {
      id: Date.now().toString(), nopol: nopol.toUpperCase(), jenis, waktuMasuk: new Date(),
      status: 'IN', fotoMasuk: photo, lokasi: user.lokasi === 'All Lokasi' ? PURE_LOCATIONS[0] : user.lokasi,
      kasirMasuk: user.nama, gps
    };
    addTransaction(newTx);
    setPrintData(newTx);
    setNopol('');
  };

  return (
    <div className="fade-in max-w-2xl mx-auto">
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
            <Camera size={28} /> PROSES & FOTO MASUK
          </button>
        </form>
      </div>
      {showCamera && <CameraModal facingMode="environment" title="Foto Kendaraan Masuk" onClose={() => setShowCamera(false)} onCapture={handleCapture} />}
      {printData && <TicketPrintModal data={printData} onClose={() => setPrintData(null)} />}
    </div>
  );
}

// --- KENDARAAN KELUAR ---
function KendaraanKeluar({ user, transactions, updateTransaction, settings }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTx, setSelectedTx] = useState(null);
  const [showCamera, setShowCamera] = useState(false);
  const [printData, setPrintData] = useState(null);
  const [tiketHilang, setTiketHilang] = useState(false);
  const [showLostModal, setShowLostModal] = useState(false);
  
  const [fotoKTP, setFotoKTP] = useState(null);
  const [fotoSTNK, setFotoSTNK] = useState(null);

  const activeTransactions = transactions.filter(t => t.status === 'IN' && t.nopol.includes(searchQuery.toUpperCase()) && (user.lokasi === 'All Lokasi' || t.lokasi === user.lokasi));

  const calculateFee = (tx) => {
    const exitTime = new Date();
    const diffMs = exitTime - tx.waktuMasuk;
    
    const diffMinutesTotal = Math.floor(diffMs / (1000 * 60));
    const exactHours = Math.floor(diffMinutesTotal / 60);
    const exactMinutes = diffMinutesTotal % 60;
    const durasiText = `${exactHours} Jam ${exactMinutes} Menit`;

    const jam = exactHours + (exactMinutes > 0 ? 1 : 0);
    const billedJam = jam > 0 ? jam : 1; 

    // Ambil tarif berdasarkan lokasi masuk transaksi
    const locSettings = getLocSettings(settings, tx.lokasi);
    const rate = locSettings.tariffs[tx.jenis];
    const denda = tiketHilang ? 10000 : 0;

    if (rate.gracePeriodActive && diffMinutesTotal <= rate.gracePeriodMinutes) {
       return { total: denda, jam: billedJam, durasiText, exitTime, isMember: false, denda };
    }

    const isMember = settings.members.find(m => m.nopol === tx.nopol && m.status === 'Aktif');
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
    if (tiketHilang && (!fotoKTP || !fotoSTNK)) return alert("Mohon upload Foto KTP dan STNK terlebih dahulu!");
    if (selectedTx) setShowCamera(true); 
  };

  const handleCapture = (photo) => {
    setShowCamera(false);
    const { total, jam, durasiText, exitTime, isMember, denda } = calculateFee(selectedTx);
    
    const updateData = { 
      status: 'OUT', waktuKeluar: exitTime, fotoKeluar: photo, 
      kasirKeluar: user.nama, durasiJam: jam, durasiText: durasiText, totalBiaya: total, 
      isMember, tiketHilang, denda, fotoKTP, fotoSTNK
    };
    
    updateTransaction(selectedTx.id, updateData);
    const locSettings = getLocSettings(settings, selectedTx.lokasi);
    setPrintData({ ...selectedTx, ...updateData, petugasPhoto: user.photo, locSettings });
    setSelectedTx(null);
    setSearchQuery('');
    setTiketHilang(false); setFotoKTP(null); setFotoSTNK(null);
  };

  return (
    <div className="fade-in max-w-2xl mx-auto">
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

            {/* Hilang Tiket Section (Diperjelas) */}
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
            
            {/* Popup/Modal Tiket Hilang */}
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
                       <button onClick={() => { if(!fotoKTP || !fotoSTNK) return alert("KTP & STNK wajib diupload!"); setTiketHilang(true); setShowLostModal(false); }} className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-500 text-sm">Terapkan Denda</button>
                    </div>
                 </div>
              </div>
            )}

          </div>
        )}

        <button onClick={handleProcess} disabled={!selectedTx} className={`w-full font-black rounded-[1.5rem] px-6 py-6 text-xl transition-all flex justify-center items-center gap-3 ${selectedTx ? 'bg-teal-600 hover:bg-teal-500 text-white shadow-xl shadow-teal-600/20 active:scale-95' : 'bg-[#092613] border-2 border-[#1b5e35] text-green-300/30 cursor-not-allowed'}`}>
          <Camera size={28} /> PROSES KELUAR & HITUNG
        </button>
      </div>
      {showCamera && <CameraModal facingMode="environment" title="Foto Kendaraan Keluar" onClose={() => setShowCamera(false)} onCapture={handleCapture} />}
      {printData && <ReceiptPrintModal data={printData} settings={settings} onClose={() => setPrintData(null)} />}
    </div>
  );
}

// --- KENDARAAN AREA ---
function KendaraanArea({ transactions, user }) {
  const activeTx = transactions.filter(t => t.status === 'IN' && (user.lokasi === 'All Lokasi' || t.lokasi === user.lokasi));
  const [zoomImg, setZoomImg] = useState(null);

  return (
    <div className="fade-in max-w-5xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
         <div className="w-14 h-14 bg-teal-500/20 text-teal-400 border border-teal-500/30 rounded-2xl flex items-center justify-center"><MapPin size={28} /></div>
         <div><h2 className="text-2xl font-extrabold text-white">Kendaraan di Area</h2><p className="text-green-200/70 text-sm">Rincian detail kendaraan yang belum melakukan transaksi keluar.</p></div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {activeTx.length === 0 && <p className="text-green-300/50 col-span-full">Tidak ada kendaraan di area parkir saat ini.</p>}
        {activeTx.map(tx => (
          <div key={tx.id} className="bg-[#114022] p-5 rounded-3xl border border-[#1b5e35] flex flex-col hover:bg-[#164d2b] transition-colors relative overflow-hidden shadow-lg">
            
            {/* Foto Kendaraan dengan fitur Zoom */}
            <div className="relative w-full aspect-video bg-[#092613] rounded-2xl overflow-hidden mb-4 group cursor-pointer border border-[#1b5e35]" onClick={() => tx.fotoMasuk && setZoomImg(tx.fotoMasuk)}>
               {tx.fotoMasuk ? (
                 <img src={tx.fotoMasuk} alt="Masuk" className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
               ) : (
                 <div className="w-full h-full flex flex-col items-center justify-center text-green-300/30">
                    <Camera size={32} className="mb-2"/>
                    <span className="text-xs">Foto Tidak Tersedia</span>
                 </div>
               )}
               {tx.fotoMasuk && <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 text-white"><Maximize2 size={32} /></div>}
            </div>
            
            {/* Header Nopol & Jenis */}
            <div className="flex justify-between items-center mb-4">
               <h3 className="text-3xl font-black text-white tracking-widest">{tx.nopol}</h3>
               <span className="text-xs text-green-300/90 bg-[#092613] px-3 py-1.5 rounded-lg font-bold border border-[#1b5e35] uppercase tracking-wider">{tx.jenis}</span>
            </div>
            
            {/* Detail Transaksi (Tabel Mini) */}
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
      
      {/* Zoom Image Modal */}
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
function MasterSettings({ settings, setSettings, user, transactions, updateTransaction }) {
  const [activeSetTab, setActiveSetTab] = useState('laporan');
  const isReadOnly = user.role !== 'master';

  return (
    <div className="fade-in max-w-5xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-14 h-14 bg-[#114022] text-green-400 border border-[#1b5e35] rounded-2xl flex items-center justify-center"><Settings size={28} /></div>
        <div>
          <h2 className="text-2xl font-extrabold text-white tracking-tight">System Settings & Reports</h2>
          <p className="text-green-200/70 text-sm">Akses {user.role.toUpperCase()} {isReadOnly ? '(Sebagian Fitur Read-Only)' : '(Full Access)'}</p>
        </div>
      </div>

      <div className="flex gap-2 mb-6 overflow-x-auto pb-2 custom-scrollbar">
        <button onClick={() => setActiveSetTab('laporan')} className={`px-5 py-3 rounded-xl font-bold text-sm transition-all whitespace-nowrap ${activeSetTab === 'laporan' ? 'bg-green-600 text-white' : 'bg-[#114022] text-green-300/50 hover:bg-[#164d2b]'}`}>Laporan Pendapatan</button>
        {user.role === 'master' && <button onClick={() => setActiveSetTab('rekapan')} className={`px-5 py-3 rounded-xl font-bold text-sm transition-all whitespace-nowrap ${activeSetTab === 'rekapan' ? 'bg-teal-600 text-white' : 'bg-[#114022] text-teal-400 hover:bg-[#164d2b]'}`}>Rekapan Global (Rinci)</button>}
        <button onClick={() => setActiveSetTab('tarif')} className={`px-5 py-3 rounded-xl font-bold text-sm transition-all whitespace-nowrap ${activeSetTab === 'tarif' ? 'bg-[#1b5e35] text-white' : 'bg-[#114022] text-green-300/50 hover:bg-[#164d2b]'}`}>Setting Tarif</button>
        <button onClick={() => setActiveSetTab('member')} className={`px-5 py-3 rounded-xl font-bold text-sm transition-all whitespace-nowrap ${activeSetTab === 'member' ? 'bg-[#1b5e35] text-white' : 'bg-[#114022] text-green-300/50 hover:bg-[#164d2b]'}`}>Member Parkir</button>
        <button onClick={() => setActiveSetTab('shift')} className={`px-5 py-3 rounded-xl font-bold text-sm transition-all whitespace-nowrap ${activeSetTab === 'shift' ? 'bg-[#1b5e35] text-white' : 'bg-[#114022] text-green-300/50 hover:bg-[#164d2b]'}`}>Setting Shift</button>
        {user.role === 'master' && <button onClick={() => setActiveSetTab('users')} className={`px-5 py-3 rounded-xl font-bold text-sm transition-all whitespace-nowrap ${activeSetTab === 'users' ? 'bg-blue-600 text-white' : 'bg-[#114022] text-blue-400 hover:bg-[#164d2b]'}`}>Manajemen User</button>}
        <button onClick={() => setActiveSetTab('web')} className={`px-5 py-3 rounded-xl font-bold text-sm transition-all whitespace-nowrap ${activeSetTab === 'web' ? 'bg-[#1b5e35] text-white' : 'bg-[#114022] text-green-300/50 hover:bg-[#164d2b]'}`}>Web & Printer</button>
      </div>

      <div className="bg-[#114022] rounded-[2.5rem] p-8 shadow-2xl border border-[#1b5e35]">
        {activeSetTab === 'laporan' && <Laporan transactions={transactions} user={user} updateTransaction={updateTransaction} />}
        {activeSetTab === 'rekapan' && user.role === 'master' && <RekapanLaporan transactions={transactions} user={user} />}
        {activeSetTab === 'tarif' && <SettingTarif settings={settings} setSettings={setSettings} isReadOnly={isReadOnly} user={user} />}
        {activeSetTab === 'member' && <SettingMember settings={settings} setSettings={setSettings} isReadOnly={isReadOnly} user={user} />}
        {activeSetTab === 'shift' && <SettingShift settings={settings} setSettings={setSettings} isReadOnly={isReadOnly} user={user} />}
        {activeSetTab === 'users' && user.role === 'master' && <SettingUser settings={settings} setSettings={setSettings} />}
        {activeSetTab === 'web' && <SettingWeb settings={settings} setSettings={setSettings} isReadOnly={isReadOnly} />}
      </div>
    </div>
  );
}

// Sub-Component Laporan Visual (Auditor Friendly)
function Laporan({ transactions, user, updateTransaction }) {
  const [filterType, setFilterType] = useState('shift'); 
  const [lapTab, setLapTab] = useState('ringkasan');
  const [zoomImg, setZoomImg] = useState(null);
  const [isCleaning, setIsCleaning] = useState(false);
  
  let filteredTx = transactions.filter(t => user.lokasi === 'All Lokasi' || t.lokasi === user.lokasi);
  const completedTx = filteredTx.filter(t => t.status === 'OUT');
  const totalPendapatan = completedTx.reduce((acc, curr) => acc + curr.totalBiaya, 0);

  const breakdown = { 'Motor': { qty: 0, nominal: 0 }, 'Mobil': { qty: 0, nominal: 0 }, 'Box/Truck': { qty: 0, nominal: 0 }, 'Sepeda/Becak': { qty: 0, nominal: 0 } };
  const durasiStats = { '1 Jam Awal': 0, '2 sd 5 Jam': 0, '6 sd 12 Jam': 0, '13 sd 24 Jam': 0, '> 24 Jam': 0 };

  completedTx.forEach(tx => {
     if (breakdown[tx.jenis] !== undefined) { breakdown[tx.jenis].qty += 1; breakdown[tx.jenis].nominal += tx.totalBiaya || 0; }
     const jam = tx.durasiJam || 1;
     if (jam <= 1) durasiStats['1 Jam Awal'] += 1;
     else if (jam <= 5) durasiStats['2 sd 5 Jam'] += 1;
     else if (jam <= 12) durasiStats['6 sd 12 Jam'] += 1;
     else if (jam <= 24) durasiStats['13 sd 24 Jam'] += 1;
     else durasiStats['> 24 Jam'] += 1;
  });

  const totalQtySelesai = completedTx.length;

  // Auto-Cleanup Database Logic (Mengosongkan gambar berumur > 30 hari untuk menjaga database tidak 80% penuh)
  const cleanOldDatabasePhotos = async () => {
     if(!window.confirm("Peringatan: Proses ini akan menghapus semua file foto transaksi yang berumur LEBIH DARI 30 HARI untuk mengosongkan ruang database. Data log nopol dan biaya tetap aman. Lanjutkan?")) return;
     
     setIsCleaning(true);
     const thirtyDaysAgo = new Date();
     thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
     
     const txToClean = transactions.filter(t => t.waktuMasuk < thirtyDaysAgo && (t.fotoMasuk || t.fotoKeluar));
     
     for (const tx of txToClean) {
        await updateTransaction(tx.id, { fotoMasuk: null, fotoKeluar: null, fotoKTP: null, fotoSTNK: null, photoCleaned: true });
     }
     
     setIsCleaning(false);
     alert(`Berhasil! ${txToClean.length} data lama berhasil dihapus fotonya untuk menghemat storage.`);
  };

  return (
    <div className="space-y-6">
      {/* Peringatan Database & Tombol Clean */}
      {user.role === 'master' && (
        <div className="bg-red-900/20 border border-red-500/30 p-4 rounded-xl flex flex-col md:flex-row justify-between items-center gap-4 hide-on-print">
           <div className="flex items-center gap-3">
              <Database className="text-red-400" size={24}/>
              <p className="text-xs text-red-200/80 leading-relaxed"><strong>Sistem Auto-Storage Aktif:</strong> Hapus foto transaksi visual yang berumur lebih dari 1 Bulan (30 Hari) agar kapasitas database Firebase Anda tetap lapang.</p>
           </div>
           <button onClick={cleanOldDatabasePhotos} disabled={isCleaning} className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap flex items-center gap-2 transition-colors">
              <Trash2 size={14}/> {isCleaning ? 'Membersihkan...' : 'Bersihkan Storage > 1 Bulan'}
           </button>
        </div>
      )}

      {/* TABS LAPORAN */}
      <div className="flex bg-[#092613] p-1 rounded-xl border border-[#1b5e35] hide-on-print overflow-x-auto custom-scrollbar">
         <button onClick={()=>setLapTab('ringkasan')} className={`flex-1 py-2 px-4 rounded-lg text-sm font-bold whitespace-nowrap transition-all ${lapTab==='ringkasan'?'bg-[#1b5e35] text-white shadow':'text-green-300/50 hover:text-white'}`}>Ringkasan Bisnis</button>
         <button onClick={()=>setLapTab('in_area')} className={`flex-1 py-2 px-4 rounded-lg text-sm font-bold whitespace-nowrap transition-all ${lapTab==='in_area'?'bg-teal-600 text-white shadow':'text-green-300/50 hover:text-white'}`}>Audit Kendaraan Area</button>
         <button onClick={()=>setLapTab('out_area')} className={`flex-1 py-2 px-4 rounded-lg text-sm font-bold whitespace-nowrap transition-all ${lapTab==='out_area'?'bg-orange-600 text-white shadow':'text-green-300/50 hover:text-white'}`}>Audit Kendaraan Keluar</button>
      </div>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div><h3 className="font-bold text-xl text-white">Laporan Transaksi</h3></div>
        <div className="flex flex-wrap gap-2">
           <select value={filterType} onChange={e => setFilterType(e.target.value)} className="bg-[#092613] border border-[#1b5e35] text-white px-4 py-2 rounded-xl text-sm font-bold outline-none hide-on-print">
              <option value="shift">Per Shift</option><option value="hari">Akhir Hari</option><option value="bulan">Per Bulan</option><option value="tahun">Per Tahun</option>
           </select>
          <button onClick={() => window.print()} className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-bold hide-on-print"><Download size={16} /> PDF</button>
        </div>
      </div>

      {lapTab === 'ringkasan' && (
         <div className="animate-in fade-in space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-[#092613] p-6 rounded-2xl border border-[#1b5e35]"><p className="text-green-300/50 text-xs font-bold mb-1">Total Pendapatan</p><h3 className="text-2xl font-black text-green-400">Rp {totalPendapatan.toLocaleString('id-ID')}</h3></div>
              <div className="bg-[#092613] p-6 rounded-2xl border border-[#1b5e35]"><p className="text-green-300/50 text-xs font-bold mb-1">Mobil/Motor Masuk</p><h3 className="text-2xl font-black text-teal-400">{filteredTx.filter(t => t.status === 'IN').length}</h3></div>
              <div className="bg-[#092613] p-6 rounded-2xl border border-[#1b5e35]"><p className="text-green-300/50 text-xs font-bold mb-1">Transaksi Selesai</p><h3 className="text-2xl font-black text-orange-400">{totalQtySelesai}</h3></div>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 printable-report">
               {/* Breakdown Jenis Kendaraan */}
               <div className="bg-[#092613] p-5 rounded-2xl border border-[#1b5e35] print:border-slate-300 print:text-black">
                  <h4 className="font-bold text-white print:text-black mb-4 border-b border-[#1b5e35] print:border-slate-300 pb-2">Breakdown Jenis Kendaraan</h4>
                  <table className="w-full text-sm text-left border-collapse">
                     <thead>
                        <tr className="text-green-200/70 print:text-slate-600 border-b border-[#1b5e35] print:border-slate-300">
                           <th className="py-2">Jenis Kendaraan</th><th className="py-2 text-center">Total Qty</th><th className="py-2 text-right">Nominal (Rp)</th>
                        </tr>
                     </thead>
                     <tbody className="text-white print:text-slate-800">
                        {Object.keys(breakdown).map(jenis => (
                           <tr key={jenis} className="border-b border-[#1b5e35]/50 print:border-slate-200">
                              <td className="py-2">{jenis}</td>
                              <td className="py-2 text-center font-bold text-teal-400 print:text-slate-800">{breakdown[jenis].qty}</td>
                              <td className="py-2 text-right font-bold text-green-400 print:text-slate-800">{breakdown[jenis].nominal.toLocaleString('id-ID')}</td>
                           </tr>
                        ))}
                        <tr className="bg-[#114022] print:bg-slate-100 font-bold border-t-2 border-green-500 print:border-black">
                           <td className="py-3 px-2 uppercase text-xs">GRAND TOTAL</td>
                           <td className="py-3 text-center text-teal-400 print:text-black">{totalQtySelesai}</td>
                           <td className="py-3 text-right text-green-400 print:text-black">{totalPendapatan.toLocaleString('id-ID')}</td>
                        </tr>
                     </tbody>
                  </table>
               </div>

               {/* Statistik Durasi Parkir */}
               <div className="bg-[#092613] p-5 rounded-2xl border border-[#1b5e35] print:border-slate-300 print:text-black">
                  <h4 className="font-bold text-white print:text-black mb-4 border-b border-[#1b5e35] print:border-slate-300 pb-2">Persentase Lama Parkir</h4>
                  <div className="space-y-4 mt-2">
                     {Object.keys(durasiStats).map(rentang => {
                        const count = durasiStats[rentang];
                        const persentase = totalQtySelesai > 0 ? ((count / totalQtySelesai) * 100).toFixed(1) : 0;
                        return (
                           <div key={rentang} className="relative">
                              <div className="flex justify-between text-xs font-bold text-green-100 mb-1 print:text-black">
                                 <span>{rentang}</span>
                                 <span className="text-teal-400 print:text-slate-600">{count} Unit ({persentase}%)</span>
                              </div>
                              <div className="w-full bg-[#114022] print:bg-slate-200 h-2.5 rounded-full overflow-hidden">
                                 <div className="bg-teal-500 print:bg-slate-800 h-full rounded-full" style={{ width: `${persentase}%` }}></div>
                              </div>
                           </div>
                        );
                     })}
                  </div>
               </div>
            </div>
         </div>
      )}

      {/* TAB AUDIT IN AREA */}
      {lapTab === 'in_area' && (
         <div className="bg-[#092613] rounded-2xl border border-[#1b5e35] overflow-x-auto printable-report print:bg-white animate-in fade-in">
             <table className="w-full text-left border-collapse print:text-black">
               <thead><tr className="bg-[#0c331a] print:bg-slate-100 text-green-300/70 print:text-slate-800 text-xs uppercase"><th className="p-4 border-b border-[#1b5e35] print:border-slate-300">Waktu Masuk</th><th className="p-4 border-b border-[#1b5e35] print:border-slate-300">Nopol & Jenis</th><th className="p-4 border-b border-[#1b5e35] print:border-slate-300">Foto Masuk</th><th className="p-4 border-b border-[#1b5e35] print:border-slate-300">Petugas</th></tr></thead>
               <tbody>
                 {filteredTx.filter(t => t.status === 'IN').slice().reverse().map(tx => (
                   <tr key={tx.id} className="hover:bg-[#114022] print:hover:bg-white border-b border-[#1b5e35]/50 print:border-slate-200 text-sm transition-colors">
                     <td className="p-4 text-green-200/70 print:text-slate-700">{tx.waktuMasuk.toLocaleString('id-ID')}</td>
                     <td className="p-4 font-bold text-white print:text-slate-900">{tx.nopol} <span className="block text-xs text-green-400/50 mt-1">{tx.jenis}</span></td>
                     <td className="p-4">
                        {tx.fotoMasuk ? <img src={tx.fotoMasuk} onClick={()=>setZoomImg(tx.fotoMasuk)} className="w-20 h-14 object-cover rounded cursor-pointer border border-[#1b5e35] hover:opacity-80"/> : <span className="text-xs text-green-200/30">Dibersihkan</span>}
                     </td>
                     <td className="p-4 text-green-200/70 print:text-slate-700">{tx.kasirMasuk}</td>
                   </tr>
                 ))}
               </tbody>
             </table>
         </div>
      )}

      {/* TAB AUDIT KELUAR AREA */}
      {lapTab === 'out_area' && (
         <div className="bg-[#092613] rounded-2xl border border-[#1b5e35] overflow-x-auto printable-report print:bg-white animate-in fade-in">
             <table className="w-full text-left border-collapse print:text-black">
               <thead><tr className="bg-[#0c331a] print:bg-slate-100 text-green-300/70 print:text-slate-800 text-xs uppercase"><th className="p-4 border-b border-[#1b5e35] print:border-slate-300">Nopol</th><th className="p-4 border-b border-[#1b5e35] print:border-slate-300">Waktu</th><th className="p-4 border-b border-[#1b5e35] print:border-slate-300">Foto Masuk vs Keluar</th><th className="p-4 border-b border-[#1b5e35] print:border-slate-300">Biaya</th></tr></thead>
               <tbody>
                 {completedTx.slice().reverse().map(tx => (
                   <tr key={tx.id} className="hover:bg-[#114022] print:hover:bg-white border-b border-[#1b5e35]/50 print:border-slate-200 text-sm transition-colors">
                     <td className="p-4 font-bold text-white print:text-slate-900">{tx.nopol} <span className="block text-xs text-green-400/50 mt-1">{tx.jenis}</span></td>
                     <td className="p-4 text-xs text-green-200/70 print:text-slate-700"><p>IN: {tx.waktuMasuk.toLocaleString('id-ID')}</p><p>OUT: {tx.waktuKeluar.toLocaleString('id-ID')}</p></td>
                     <td className="p-4 flex gap-2">
                        {tx.fotoMasuk ? <img src={tx.fotoMasuk} onClick={()=>setZoomImg(tx.fotoMasuk)} className="w-16 h-12 object-cover rounded cursor-pointer border border-[#1b5e35]"/> : <div className="w-16 h-12 bg-black/50 border border-[#1b5e35] rounded flex items-center justify-center text-[8px] text-green-200/30">N/A</div>}
                        {tx.fotoKeluar ? <img src={tx.fotoKeluar} onClick={()=>setZoomImg(tx.fotoKeluar)} className="w-16 h-12 object-cover rounded cursor-pointer border border-[#1b5e35]"/> : <div className="w-16 h-12 bg-black/50 border border-[#1b5e35] rounded flex items-center justify-center text-[8px] text-green-200/30">N/A</div>}
                     </td>
                     <td className="p-4 font-bold text-green-400 print:text-green-700">Rp {tx.totalBiaya.toLocaleString('id-ID')} {tx.tiketHilang && <span className="text-red-500 block text-xs">(Denda Hilang Tiket)</span>}</td>
                   </tr>
                 ))}
               </tbody>
             </table>
         </div>
      )}

      {/* Zoom Image Modal */}
      {zoomImg && (
        <div className="fixed inset-0 z-[70] bg-black/95 flex items-center justify-center p-4 backdrop-blur-md" onClick={() => setZoomImg(null)}>
           <img src={zoomImg} className="max-w-[95vw] max-h-[90vh] rounded-2xl shadow-2xl border-4 border-[#1b5e35] object-contain" alt="Zoom"/>
           <button className="absolute top-6 right-6 text-white bg-red-600/50 hover:bg-red-600 p-3 rounded-full transition-colors"><X size={24}/></button>
        </div>
      )}
    </div>
  );
}

// Sub-Component Rekapan Global
function RekapanLaporan({ transactions, user }) {
  const completed = transactions.filter(t => t.status === 'OUT');
  const total = completed.reduce((a, b) => a + b.totalBiaya, 0);
  
  const totalDurasi = completed.reduce((a, b) => a + b.durasiJam, 0);
  const avgDurasi = completed.length ? (totalDurasi / completed.length).toFixed(1) : 0;
  
  const volumeByJenis = completed.reduce((acc, tx) => { acc[tx.jenis] = (acc[tx.jenis] || 0) + 1; return acc; }, {});
  
  const jamMasukFreq = transactions.reduce((acc, tx) => { const h = tx.waktuMasuk.getHours(); acc[h] = (acc[h] || 0) + 1; return acc; }, {});
  const jamKeluarFreq = completed.reduce((acc, tx) => { const h = tx.waktuKeluar.getHours(); acc[h] = (acc[h] || 0) + 1; return acc; }, {});
  const jamRamaiMasuk = Object.keys(jamMasukFreq).length ? Object.keys(jamMasukFreq).reduce((a, b) => jamMasukFreq[a] > jamMasukFreq[b] ? a : b) : '-';
  const jamRamaiKeluar = Object.keys(jamKeluarFreq).length ? Object.keys(jamKeluarFreq).reduce((a, b) => jamKeluarFreq[a] > jamKeluarFreq[b] ? a : b) : '-';

  const handleExportExcel = () => {
    let csvContent = "data:text/csv;charset=utf-8,\uFEFF"; 
    csvContent += "ID,Lokasi,Nomor Polisi,Jenis Kendaraan,Status,Waktu Masuk,Waktu Keluar,Lama Parkir,Total Biaya,Kasir Keluar,Tiket Hilang\n";

    completed.forEach(t => {
      const wMasuk = t.waktuMasuk ? t.waktuMasuk.toLocaleString('id-ID').replace(/,/g, '') : '-';
      const wKeluar = t.waktuKeluar ? t.waktuKeluar.toLocaleString('id-ID').replace(/,/g, '') : '-';
      const row = [
        t.id, t.lokasi, t.nopol, t.jenis, t.status, wMasuk, wKeluar, 
        t.durasiText || '-', t.totalBiaya || 0, t.kasirKeluar || '-', t.tiketHilang ? 'YA' : 'TIDAK'
      ].map(v => `"${v}"`).join(",");
      csvContent += row + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Rekapan_Parkir_Global_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
       <div className="bg-teal-900/30 border border-teal-500/30 p-6 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div><p className="text-sm font-bold text-teal-400">Total Pendapatan Global Semua Lokasi</p><h2 className="text-4xl font-black text-white">Rp {total.toLocaleString('id-ID')}</h2></div>
          <div className="flex gap-2">
            <button onClick={() => window.print()} className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-bold hide-on-print shadow-lg"><Download size={16} /> PDF</button>
            <button onClick={handleExportExcel} className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-bold shadow-lg"><FileText size={16} /> XLSX / CSV</button>
          </div>
       </div>
       
       <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-[#092613] p-4 rounded-xl border border-[#1b5e35] text-center"><p className="text-xs text-green-300/50">Rata-rata Parkir</p><h4 className="text-xl font-bold text-white mt-1">{avgDurasi} Jam</h4></div>
          <div className="bg-[#092613] p-4 rounded-xl border border-[#1b5e35] text-center"><p className="text-xs text-green-300/50">Jam Ramai Masuk</p><h4 className="text-xl font-bold text-teal-400 mt-1">{jamRamaiMasuk}:00</h4></div>
          <div className="bg-[#092613] p-4 rounded-xl border border-[#1b5e35] text-center"><p className="text-xs text-green-300/50">Jam Ramai Keluar</p><h4 className="text-xl font-bold text-orange-400 mt-1">{jamRamaiKeluar}:00</h4></div>
          <div className="bg-[#092613] p-4 rounded-xl border border-[#1b5e35] text-center"><p className="text-xs text-green-300/50">Kasus Tiket Hilang</p><h4 className="text-xl font-bold text-red-400 mt-1">{completed.filter(t=>t.tiketHilang).length} Kasus</h4></div>
       </div>

       <div className="bg-[#092613] p-6 rounded-2xl border border-[#1b5e35]">
         <h4 className="font-bold text-white mb-4">Volume Kendaraan per Tipe</h4>
         <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
           {['Motor', 'Mobil', 'Box/Truck', 'Sepeda/Becak'].map(jenis => (
             <div key={jenis} className="bg-[#114022] p-3 rounded-lg border border-[#1b5e35] flex justify-between items-center">
               <span className="text-xs text-green-200/70">{jenis}</span><span className="font-bold text-white">{volumeByJenis[jenis] || 0} unit</span>
             </div>
           ))}
         </div>
       </div>

       <div className="bg-[#092613] p-6 rounded-2xl border border-[#1b5e35] mt-6 overflow-x-auto printable-report print:bg-white print:text-black print:border-none print:shadow-none">
         <div className="hidden-screen show-on-print flex items-center gap-4 p-6 border-b-2 border-slate-200 mb-4 bg-white text-black">
            <img src={user.photo} alt="Petugas" className="w-16 h-16 rounded-full border-2 border-slate-300 object-cover" />
            <div>
               <h2 className="text-2xl font-black uppercase text-slate-800">Rekapan Parkir Global (Master)</h2>
               <p className="text-sm font-bold text-slate-600">Ditarik Oleh: {user.nama} ({user.role.toUpperCase()})</p>
               <p className="text-xs text-slate-500">Waktu Penarikan Data: {new Date().toLocaleString('id-ID')}</p>
            </div>
         </div>

         <h4 className="font-bold text-white mb-4 hide-on-print">Rincian Transaksi per Lokasi</h4>
         <table className="w-full text-left border-collapse min-w-[600px] print:text-black">
           <thead>
             <tr className="bg-[#0c331a] print:bg-slate-100 text-green-300/70 print:text-slate-800 text-xs uppercase">
                <th className="p-3 border-b border-[#1b5e35] print:border-slate-300">Lokasi</th>
                <th className="p-3 border-b border-[#1b5e35] print:border-slate-300">Waktu Keluar</th>
                <th className="p-3 border-b border-[#1b5e35] print:border-slate-300">Nopol</th>
                <th className="p-3 border-b border-[#1b5e35] print:border-slate-300">Jenis</th>
                <th className="p-3 border-b border-[#1b5e35] print:border-slate-300">Durasi Parkir</th>
                <th className="p-3 border-b border-[#1b5e35] print:border-slate-300">Biaya</th>
             </tr>
           </thead>
           <tbody>
             {completed.slice().reverse().map(tx => (
               <tr key={tx.id} className="text-sm text-white hover:bg-[#114022] print:hover:bg-white border-b border-[#1b5e35]/50 print:border-slate-200 transition-colors">
                 <td className="p-3 text-teal-400 print:text-teal-700 font-bold">{tx.lokasi}</td>
                 <td className="p-3 text-green-200/70 print:text-slate-700">{tx.waktuKeluar.toLocaleString()}</td>
                 <td className="p-3 print:font-semibold">{tx.nopol} {tx.tiketHilang && <span className="text-[10px] text-red-400 ml-1">(H)</span>}</td>
                 <td className="p-3 text-green-200/70 print:text-slate-700">{tx.jenis}</td>
                 <td className="p-3 text-green-200/70 print:text-slate-700">{tx.durasiText || `${tx.durasiJam} Jam`}</td>
                 <td className="p-3 font-bold text-green-400 print:text-green-700">Rp {tx.totalBiaya.toLocaleString('id-ID')}</td>
               </tr>
             ))}
           </tbody>
         </table>
       </div>

    </div>
  );
}

// Sub-Setting: Shift Multi-Lokasi
function SettingShift({ settings, setSettings, isReadOnly, user }) {
  const [targetLokasi, setTargetLokasi] = useState(user.lokasi === 'All Lokasi' ? PURE_LOCATIONS[0] : user.lokasi);
  const locSettings = getLocSettings(settings, targetLokasi);
  const [shifts, setShifts] = useState(locSettings.shifts || DEFAULT_LOCATION_SETTINGS.shifts);

  useEffect(() => { setShifts(getLocSettings(settings, targetLokasi).shifts || DEFAULT_LOCATION_SETTINGS.shifts); }, [targetLokasi, settings]);

  const handleSave = () => {
    const newLocations = { ...settings.locations, [targetLokasi]: { ...getLocSettings(settings, targetLokasi), shifts: shifts } };
    setSettings({ ...settings, locations: newLocations });
    alert(`Setingan Jam Shift untuk ${targetLokasi} Tersimpan!`);
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
          <div className="flex items-center gap-3 text-white"><CalendarClock size={20}/> <h3 className="font-bold text-lg">Konfigurasi Waktu Shift</h3></div>
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
function SettingUser({ settings, setSettings }) {
  const [usersList, setUsersList] = useState(settings.users || DEFAULT_SETTINGS.users);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ id: '', nipp: '', nama: '', password: '', role: 'kasir', canViewArea: false });

  const handleSaveGlobal = () => {
    setSettings({ ...settings, users: usersList });
    alert("Perubahan Akun Tersimpan ke Database!");
  };

  const submitForm = (e) => {
    e.preventDefault();
    if (form.id) {
       setUsersList(usersList.map(u => u.id === form.id ? form : u));
    } else {
       setUsersList([...usersList, { ...form, id: `u_${Date.now()}` }]);
    }
    setShowForm(false);
    setForm({ id: '', nipp: '', nama: '', password: '', role: 'kasir', canViewArea: false });
  };

  const hapusUser = (id) => {
    if (usersList.find(u => u.id === id).role === 'master') return alert("Akun Master tidak bisa dihapus!");
    setUsersList(usersList.filter(u => u.id !== id));
  };

  return (
    <div className="space-y-6">
       <div className="flex justify-between items-center">
          <div className="flex items-center gap-3 text-white">
             <UserCog size={20}/> <h3 className="font-bold text-lg">Manajemen User</h3>
          </div>
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
                      <option value="kasir">Kasir Biasa</option>
                      <option value="korlap">Korlap</option>
                      <option value="audit">Audit</option>
                      <option value="master">Master</option>
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
             <button type="submit" className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl mt-4 hover:bg-blue-500 transition">{form.id ? 'Update Akun' : 'Buat Akun Baru'}</button>
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
       <button onClick={handleSaveGlobal} className="w-full bg-blue-700 text-white font-bold py-4 rounded-xl shadow-lg hover:bg-blue-600 transition-all flex justify-center gap-2"><Lock size={20}/> Terapkan Perubahan Akun ke Database</button>
    </div>
  );
}

// Sub-Setting: Setting Tarif Rinci Multi-Lokasi
function SettingTarif({ settings, setSettings, isReadOnly, user }) {
  const [targetLokasi, setTargetLokasi] = useState(user.lokasi === 'All Lokasi' ? PURE_LOCATIONS[0] : user.lokasi);
  const locSettings = getLocSettings(settings, targetLokasi);
  const [localTariff, setLocalTariff] = useState(locSettings.tariffs || DEFAULT_LOCATION_SETTINGS.tariffs);

  useEffect(() => { setLocalTariff(getLocSettings(settings, targetLokasi).tariffs || DEFAULT_LOCATION_SETTINGS.tariffs); }, [targetLokasi, settings]);

  const handleSave = () => {
    const newLocations = { ...settings.locations, [targetLokasi]: { ...getLocSettings(settings, targetLokasi), tariffs: localTariff } };
    setSettings({ ...settings, locations: newLocations });
    alert(`Setingan Tarif Per Kendaraan untuk ${targetLokasi} Tersimpan!`);
  };

  const updateTariff = (jenis, field, val) => {
    setLocalTariff(prev => ({ ...prev, [jenis]: { ...prev[jenis], [field]: field === 'mode' || typeof val === 'boolean' ? val : Number(val) } }));
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
          <div key={jenis} className="border border-[#1b5e35] rounded-2xl p-5 bg-[#092613] shadow-sm">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
              <h4 className="font-bold text-lg text-white border-b-2 border-green-500 pb-1">{jenis}</h4>
              <div className="flex bg-[#114022] rounded-xl p-1 border border-[#1b5e35]">
                 <button disabled={isReadOnly} onClick={() => updateTariff(jenis, 'mode', 'progressif')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${localTariff[jenis].mode === 'progressif' ? 'bg-green-600 text-white shadow-sm' : 'text-green-300/50 hover:text-white'}`}>Progressif</button>
                 <button disabled={isReadOnly} onClick={() => updateTariff(jenis, 'mode', 'flat')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${localTariff[jenis].mode === 'flat' ? 'bg-green-600 text-white shadow-sm' : 'text-green-300/50 hover:text-white'}`}>Flat</button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div>
                <label className="block text-xs text-green-200/70 mb-1">Jam Pertama (Rp)</label>
                <input disabled={isReadOnly} type="number" value={localTariff[jenis].first} onChange={e => updateTariff(jenis, 'first', e.target.value)} className="w-full bg-[#114022] border border-[#1b5e35] rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-green-500" />
              </div>
              <div className={localTariff[jenis].mode === 'flat' ? 'opacity-50 pointer-events-none' : ''}>
                <label className="block text-xs text-green-200/70 mb-1">Durasi Awal</label>
                <select disabled={isReadOnly} value={localTariff[jenis].firstDuration} onChange={e => updateTariff(jenis, 'firstDuration', e.target.value)} className="w-full bg-[#114022] border border-[#1b5e35] rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-green-500">
                  {[...Array(24).keys()].map(i => (
                     <option key={i+1} value={i+1}>{i+1} Jam</option>
                  ))}
                </select>
              </div>
              <div className={localTariff[jenis].mode === 'flat' ? 'opacity-50 pointer-events-none' : ''}>
                <label className="block text-xs text-green-200/70 mb-1">Jam Berikutnya (Rp)</label>
                <input disabled={isReadOnly} type="number" value={localTariff[jenis].next} onChange={e => updateTariff(jenis, 'next', e.target.value)} className="w-full bg-[#114022] border border-[#1b5e35] rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-green-500" />
              </div>
              <div className={localTariff[jenis].mode === 'flat' ? 'opacity-50 pointer-events-none' : ''}>
                <label className="block text-xs text-green-200/70 mb-1">Tarif Maksimal (Rp)</label>
                <input disabled={isReadOnly} type="number" value={localTariff[jenis].max} onChange={e => updateTariff(jenis, 'max', e.target.value)} className="w-full bg-[#114022] border border-[#1b5e35] rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-green-500" />
              </div>
              <div className={localTariff[jenis].mode === 'flat' ? 'opacity-50 pointer-events-none' : ''}>
                <label className="block text-xs text-green-200/70 mb-1">Tarif Inap/Hari (Rp)</label>
                <input disabled={isReadOnly} type="number" value={localTariff[jenis].inap} onChange={e => updateTariff(jenis, 'inap', e.target.value)} className="w-full bg-[#114022] border border-[#1b5e35] rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-green-500" />
              </div>
            </div>

            {/* Grace Period Area */}
            <div className="mt-4 pt-4 border-t border-[#1b5e35] flex items-center gap-4">
               <label className="flex items-center gap-2 text-sm text-green-200/70 cursor-pointer">
                  <input type="checkbox" disabled={isReadOnly} checked={localTariff[jenis].gracePeriodActive} onChange={e => updateTariff(jenis, 'gracePeriodActive', e.target.checked)} className="rounded accent-green-500 w-4 h-4" />
                  Aktifkan Grace Periode
               </label>
               {localTariff[jenis].gracePeriodActive && (
                  <div className="flex items-center gap-2 animate-in fade-in">
                     <span className="text-xs text-green-200/70">Berapa menit?</span>
                     <input disabled={isReadOnly} type="number" value={localTariff[jenis].gracePeriodMinutes} onChange={e => updateTariff(jenis, 'gracePeriodMinutes', e.target.value)} className="w-20 bg-[#114022] border border-[#1b5e35] rounded-lg px-2 py-1 text-sm text-white outline-none focus:border-green-500" />
                  </div>
               )}
            </div>
          </div>
        ))}
      </div>
      {!isReadOnly && <button onClick={handleSave} className="w-full bg-green-600 text-white font-bold py-4 rounded-xl shadow-lg hover:bg-green-500 transition-all flex justify-center gap-2"><CheckCircle2 size={20}/> Simpan Pengaturan Tarif ({targetLokasi})</button>}
    </div>
  );
}

// Sub-Setting: Member Parkir
function SettingMember({ settings, setSettings, isReadOnly, user }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ nipp: '', nopol: '', masaBerlaku: 'Bulanan', fotoSTNK: null, fotoKartuPegawai: null });

  const handleAdd = (e) => {
    e.preventDefault();
    if (!form.fotoSTNK || !form.fotoKartuPegawai) return alert("Mohon Upload Foto STNK dan Kartu Pegawai!");
    const newMember = { ...form, id: Date.now(), status: 'Pending' };
    setSettings({ ...settings, members: [...settings.members, newMember] });
    setShowAdd(false);
    setForm({ nipp: '', nopol: '', masaBerlaku: 'Bulanan', fotoSTNK: null, fotoKartuPegawai: null });
  };

  const handleVerif = (id) => {
    if (user.role !== 'master') return alert("Hanya Master yang bisa verifikasi.");
    const updated = settings.members.map(m => m.id === id ? { ...m, status: 'Aktif' } : m);
    setSettings({ ...settings, members: updated });
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
                   <input type="file" id="upload-member-stnk" accept="image/*" capture="environment" className="hidden" onChange={(e) => processImageFile(e.target.files[0], (d)=>setForm({...form, fotoSTNK: d}))} />
                   <label htmlFor="upload-member-stnk" className="bg-orange-600 text-white text-xs py-2 px-4 rounded-lg cursor-pointer hover:bg-orange-500 block font-bold">Pilih Foto STNK</label>
                </div>
                <div className="text-center">
                   <p className="text-xs font-bold text-green-200/70 mb-2">Upload Kartu Pegawai</p>
                   {form.fotoKartuPegawai ? <img src={form.fotoKartuPegawai} className="h-24 w-full object-cover rounded mb-2 border border-[#1b5e35]" alt="Kartu"/> : <div className="h-24 bg-[#114022] rounded mb-2 flex items-center justify-center text-green-300/30 border border-[#1b5e35]"><FileImage/></div>}
                   <input type="file" id="upload-member-kartu" accept="image/*" capture="environment" className="hidden" onChange={(e) => processImageFile(e.target.files[0], (d)=>setForm({...form, fotoKartuPegawai: d}))} />
                   <label htmlFor="upload-member-kartu" className="bg-blue-600 text-white text-xs py-2 px-4 rounded-lg cursor-pointer hover:bg-blue-500 block font-bold">Pilih Kartu Pegawai</label>
                </div>
             </div>

             <div className="pt-2">
                <label className="block text-xs text-green-200/70 mb-1">Masa Berlaku</label>
                <select value={form.masaBerlaku} onChange={e=>setForm({...form, masaBerlaku: e.target.value})} className="w-full bg-[#114022] border border-[#1b5e35] p-2 rounded-lg text-white outline-none focus:border-green-500"><option>Bulanan</option><option>Tahunan</option></select>
             </div>
             
             <button type="submit" className="w-full bg-green-600 text-white font-bold py-3 rounded-xl mt-4 hover:bg-green-500 transition">Ajukan Member (Verifikasi Master)</button>
          </form>
       )}

       <div className="overflow-x-auto bg-[#092613] rounded-xl border border-[#1b5e35]">
          <table className="w-full text-left border-collapse">
             <thead><tr className="bg-[#0c331a] text-green-300/70 text-xs uppercase"><th className="p-3">NIPP</th><th className="p-3">Nopol</th><th className="p-3">Berlaku</th><th className="p-3">Status</th><th className="p-3">Aksi</th></tr></thead>
             <tbody>
                {settings.members.length === 0 && <tr><td colSpan="5" className="p-4 text-center text-green-300/30 text-sm">Belum ada data member.</td></tr>}
                {settings.members.map(m => (
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

// Sub-Setting: Web & Printer (No Bluetooth API)
function SettingWeb({ settings, setSettings, isReadOnly }) {
  const [form, setForm] = useState(settings.web);
  
  const handleLogoUpload = (e) => {
    processImageFile(e.target.files[0], (data) => setForm({...form, logoUrl: data}));
  };

  const handleSave = (e) => { e.preventDefault(); setSettings({ ...settings, web: form }); alert("Pengaturan Web Tersimpan!"); };

  return (
    <form onSubmit={handleSave} className="space-y-6">
      
      {/* Printer Module - Solusi Default Browser */}
      <div className="bg-[#092613] p-5 rounded-2xl border border-[#1b5e35]">
         <h4 className="font-bold text-white mb-2 uppercase text-sm flex items-center gap-2"><Bluetooth size={18} className="text-teal-400"/> Pengaturan Printer Default</h4>
         <p className="text-xs text-green-200/70 leading-relaxed mb-4">
            Aplikasi ini telah dioptimalkan untuk menggunakan <strong>pencetakan default perangkat Anda (Print Dialog)</strong>. Ini meniadakan error Bluetooth web dan 100% kompatibel di semua HP dan browser.
         </p>
         <div className="bg-[#114022] p-4 rounded-xl border border-[#1b5e35]">
            <p className="text-xs text-green-100 mb-1 font-bold">Cara Mencetak Struk:</p>
            <ol className="text-xs text-green-200/60 list-decimal ml-4 space-y-1">
               <li>Pastikan Printer Thermal / POS Bluetooth Anda menyala.</li>
               <li>Buka menu <strong>Settings (Pengaturan) Bluetooth HP Anda</strong>, lalu sandingkan (Pair) ke printer.</li>
               <li>Saat Anda menekan tombol "Cetak" di aplikasi, menu print browser akan muncul. Pilih printer Anda lalu cetak.</li>
            </ol>
         </div>
      </div>

      <div className="bg-[#092613] p-5 rounded-2xl border border-[#1b5e35] flex flex-col items-center text-center">
        <p className="text-sm font-bold text-green-200/70 mb-4 uppercase">Logo Perusahaan</p>
        <img src={form.logoUrl} alt="Logo" className="h-20 bg-white/10 rounded-xl px-4 py-2 mb-4 object-contain" />
        {!isReadOnly && (
          <div>
            <input type="file" id="upload-logo" accept="image/*" className="hidden" onChange={handleLogoUpload} />
            <label htmlFor="upload-logo" className="bg-green-600 hover:bg-green-500 text-white font-bold py-2 px-6 rounded-xl cursor-pointer inline-flex items-center gap-2"><UploadCloud size={16}/> Upload Logo Dari Device</label>
          </div>
        )}
      </div>
      <div>
        <label className="block text-sm font-bold text-green-200/70 ml-2 mb-2 uppercase tracking-wider">Running Text / Slogan Bawah Struk</label>
        <textarea disabled={isReadOnly} rows="2" value={form.runningText} onChange={e => setForm({...form, runningText: e.target.value})} className="w-full bg-[#092613] border border-[#1b5e35] rounded-[1.5rem] px-5 py-4 text-white outline-none focus:border-green-500" />
      </div>
      {!isReadOnly && <button type="submit" className="w-full bg-green-600 text-white font-bold rounded-[1.5rem] px-6 py-4 shadow-xl hover:bg-green-500 transition-all flex justify-center gap-2">Simpan Pengaturan Web</button>}
    </form>
  );
}


// --- SHIFT END MODAL (AUTO LOGOUT POPUP) ---
function ShiftEndModal({ user, transactions, shiftName, onClose, settings }) {
  const [waSent, setWaSent] = useState(false);
  
  const shiftTx = transactions.filter(t => t.kasirKeluar === user.nama && t.waktuKeluar && t.waktuKeluar >= user.loginTime);
  const totalNominal = shiftTx.reduce((sum, t) => sum + t.totalBiaya, 0);
  
  const statsPerType = shiftTx.reduce((acc, tx) => { 
     if (!acc[tx.jenis]) acc[tx.jenis] = { qty: 0, nominal: 0 };
     acc[tx.jenis].qty += 1;
     acc[tx.jenis].nominal += tx.totalBiaya;
     return acc; 
  }, {});
  const allTypes = ['Motor', 'Mobil', 'Box/Truck', 'Sepeda/Becak'];

  const exportWA = () => {
    let text = `*LAPORAN PENDAPATAN SHIFT*\n`;
    text += `🏢 *Lokasi:* ${user.lokasi}\n`;
    text += `👤 *Petugas:* ${user.nama}\n`;
    text += `🕒 *Shift:* ${shiftName}\n`;
    text += `📅 *Tanggal:* ${new Date().toLocaleDateString('id-ID')}\n\n`;
    text += `*RINCIAN PENDAPATAN:*\n`;
    
    allTypes.forEach(jenis => {
       if(statsPerType[jenis]) {
           text += `▪️ ${jenis}: ${statsPerType[jenis].qty} unit (Rp ${statsPerType[jenis].nominal.toLocaleString('id-ID')})\n`;
       }
    });

    text += `\n========================\n`;
    text += `💰 *TOTAL SETORAN: Rp ${totalNominal.toLocaleString('id-ID')}*\n`;
    text += `========================\n\n`;
    text += `_System Generated by Device Portable_`;
    
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    setWaSent(true);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
       <div className="bg-[#114022] rounded-3xl p-6 md:p-8 max-w-md w-full border border-[#1b5e35] shadow-2xl text-center hide-on-print max-h-[95vh] overflow-y-auto custom-scrollbar">
          <div className="w-16 h-16 md:w-20 md:h-20 bg-orange-500/20 text-orange-400 rounded-full flex items-center justify-center mx-auto mb-4"><Clock size={36}/></div>
          <h2 className="text-xl md:text-2xl font-black text-white mb-2">Shift Telah Berakhir</h2>
          <p className="text-green-200/70 text-xs md:text-sm mb-6">Waktu shift Anda telah selesai. Berikut rekapan pendapatan Anda pada sesi ini.</p>
          
          <div className="print-area bg-[#092613] border border-[#1b5e35] p-4 rounded-2xl text-left mb-6 font-mono text-xs md:text-sm">
             <div className="hidden-screen show-on-print flex items-center gap-3 border-b border-black/20 pb-4 mb-4 bg-white text-black">
                <img src={user.photo} alt="Petugas" className="w-12 h-12 rounded-full border border-slate-300 object-cover" />
                <div>
                   <h3 className="font-bold text-lg leading-tight uppercase">Rekapan Shift</h3>
                   <p className="text-xs text-slate-600">Dicetak: {new Date().toLocaleString('id-ID')}</p>
                </div>
             </div>

             <p className="text-center font-bold text-white border-b border-[#1b5e35] pb-2 mb-2 hide-on-print">REKAPAN {shiftName.toUpperCase()}</p>
             <p className="text-green-300/50 print:text-slate-600">Kasir: <span className="text-white print:text-black font-bold float-right">{user.nama}</span></p>
             <p className="text-green-300/50 print:text-slate-600 mb-2">Lokasi: <span className="text-white print:text-black font-bold float-right">{user.lokasi}</span></p>
             
             <div className="border-t border-[#1b5e35] my-2 pt-2">
                <p className="font-bold text-white mb-2">Rincian Pendapatan:</p>
                {Object.keys(statsPerType).length === 0 && <p className="text-green-400/30 text-xs text-center py-2">Tidak ada transaksi keluar</p>}
                {allTypes.map(jenis => {
                   if (!statsPerType[jenis]) return null;
                   return (
                     <div key={jenis} className="flex justify-between items-center text-green-200/70 mb-1">
                        <span>- {jenis} ({statsPerType[jenis].qty})</span>
                        <span className="text-white">Rp {statsPerType[jenis].nominal.toLocaleString('id-ID')}</span>
                     </div>
                   )
                })}
             </div>
             <div className="border-t border-[#1b5e35] mt-3 pt-3 bg-black/30 p-3 rounded text-center">
                <p className="text-xs text-green-300/50 mb-1">TOTAL SETORAN</p>
                <h3 className="text-2xl font-black text-green-400">Rp {totalNominal.toLocaleString('id-ID')}</h3>
             </div>
          </div>

          <div className="flex flex-col gap-3">
             <div className="flex gap-2">
                <button onClick={exportWA} className="flex-1 bg-green-600 hover:bg-green-500 text-white py-3 rounded-xl font-bold flex justify-center items-center gap-2 text-sm"><Share2 size={18}/> Kirim WA</button>
                <button onClick={() => window.print()} className="flex-1 bg-teal-600 hover:bg-teal-500 text-white py-3 rounded-xl font-bold flex justify-center items-center gap-2 text-sm"><Download size={18}/> Cetak PDF</button>
             </div>
             <button onClick={onClose} disabled={!waSent} className={`py-4 rounded-xl font-bold transition-all text-sm ${waSent ? 'bg-[#1b5e35] text-white hover:bg-[#258249]' : 'bg-[#092613] text-green-300/30 cursor-not-allowed border border-[#1b5e35]'}`}>
                {waSent ? 'Tutup & Logout Sistem' : 'Kirim WA Laporan Dahulu'}
             </button>
          </div>
       </div>

       <style dangerouslySetInnerHTML={{__html: `
        @media print {
          body * { visibility: hidden; }
          .hide-on-print { display: none !important; }
          .print-area, .print-area * { visibility: visible; background: white !important; color: black !important; }
          .print-area { position: absolute; left: 0; top: 0; width: 100%; border: none; }
        }
      `}} />
    </div>
  );
}

// --- PRINT MODALS FOR TICKETS ---
function TicketPrintModal({ data, onClose }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-sm hide-on-print">
      <div className="bg-[#114022] rounded-3xl p-6 shadow-2xl max-w-sm w-full mx-4 flex flex-col items-center">
        <div className="print-area w-full bg-white text-black p-4 border-2 border-dashed border-slate-300 rounded-xl mb-6 font-mono text-center">
          <h2 className="text-xl font-bold mb-1">TIKET MASUK</h2><p className="text-xs mb-4 border-b border-black/20 pb-2">{data.lokasi}</p>
          <div className="my-6"><h1 className="text-4xl font-black tracking-widest">{data.nopol}</h1><p className="text-sm mt-1">{data.jenis}</p></div>
          <div className="text-left text-xs space-y-1 border-t border-black/20 pt-2"><p><strong>Masuk:</strong> {data.waktuMasuk.toLocaleString()}</p><p><strong>Kasir:</strong> {data.kasirMasuk}</p></div>
        </div>
        <div className="flex gap-3 w-full">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-[#092613] text-white font-bold hover:bg-black/20">Tutup</button>
          <button onClick={() => window.print()} className="flex-1 py-3 rounded-xl bg-green-600 text-white font-bold flex justify-center gap-2 hover:bg-green-500"><FileText size={18} /> Cetak</button>
        </div>
      </div>
    </div>
  );
}

function ReceiptPrintModal({ data, settings, onClose }) {
  const locSettings = getLocSettings(settings, data.lokasi);
  
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-sm hide-on-print">
      <div className="bg-[#114022] rounded-3xl p-6 shadow-2xl max-w-sm w-full mx-4 flex flex-col items-center">
        <div className="print-area w-full bg-white text-black p-4 border-2 border-slate-300 rounded-xl mb-6 font-mono text-center relative overflow-hidden">
          <div className="absolute inset-0 z-0 flex items-center justify-center opacity-[0.05]"><img src={settings.web.logoUrl} className="w-3/4" alt="watermark" /></div>
          <div className="relative z-10">
            <h2 className="text-lg font-bold">STRUK KELUAR</h2><p className="text-xs mb-4 border-b border-black pb-2">{data.lokasi}</p>
            <div className="my-4"><h1 className="text-3xl font-black">{data.nopol}</h1><p className="text-xs">{data.jenis} {data.tiketHilang && '(HILANG TIKET)'}</p></div>
            <div className="text-left text-xs space-y-1 border-t border-b border-dashed border-black py-2 my-2">
              <div className="flex justify-between"><p>Masuk:</p><p>{data.waktuMasuk.toLocaleTimeString()}</p></div>
              <div className="flex justify-between"><p>Keluar:</p><p>{data.waktuKeluar.toLocaleTimeString()}</p></div>
              <div className="flex justify-between font-bold"><p>Lama Parkir:</p><p>{data.durasiText}</p></div>
            </div>
            <div className="my-4"><p className="text-xs">TOTAL BIAYA</p><h1 className="text-3xl font-black bg-black text-white py-1 my-1">Rp {data.totalBiaya.toLocaleString('id-ID')}</h1></div>
            <div className="text-[10px] text-left pt-2">
               {data.tiketHilang && <p className="text-center font-bold mb-1 text-red-600">*Termasuk denda kehilangan tiket Rp 10.000</p>}
               {locSettings.tariffs[data.jenis].mode === 'progressif' && !data.isMember && (
                 <p className="text-center italic mt-2 text-[8px]">Max Tarif: Rp {locSettings.tariffs[data.jenis].max} | Inap: Rp {locSettings.tariffs[data.jenis].inap}</p>
               )}
            </div>
            {settings.web.runningText && <p className="text-[9px] mt-4 pt-2 border-t border-dashed border-black">{settings.web.runningText}</p>}
          </div>
        </div>
        <div className="flex gap-3 w-full">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-[#092613] text-white font-bold hover:bg-black/20">Tutup</button>
          <button onClick={() => window.print()} className="flex-1 py-3 rounded-xl bg-orange-600 text-white font-bold flex justify-center gap-2 hover:bg-orange-500"><FileText size={18} /> Cetak</button>
        </div>
      </div>
      <style dangerouslySetInnerHTML={{__html: `
        @media print {
          body * { visibility: hidden; }
          .hide-on-print { display: none !important; }
          .print-area, .print-area * { visibility: visible; }
          .print-area { position: absolute; left: 0; top: 0; width: 100%; border: none; }
        }
      `}} />
    </div>
  );
}