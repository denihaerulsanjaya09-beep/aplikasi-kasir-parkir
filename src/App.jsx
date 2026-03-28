import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Camera, Printer, Settings, LogOut, Car, Bike, Truck, ShieldCheck, Search, X, Check, Image as ImageIcon, FileText, Send, Users, BarChart3, Moon, Bluetooth, Plus, Trash2, FileDown, MapPin, Eye, Calendar } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot, getDocs } from 'firebase/firestore';

// =====================================
// KONFIGURASI FIREBASE (WAJIB ADA)
// =====================================
let app, auth, db;
try {
  const firebaseConfig = {
  apiKey: "AIzaSyAPmH7VEU8aaawlE_QSIfrHrgU3jykn22s",
  authDomain: "resparking-v2.firebaseapp.com",
  projectId: "resparking-v2",
  storageBucket: "resparking-v2.firebasestorage.app",
  messagingSenderId: "760869381020",
  appId: "1:760869381020:web:bb74989c1c4bb4d51b9e59"
};

  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (e) {
  console.error("Gagal inisialisasi Firebase", e);
}

// --- FIX BUG SETTINGAN KEMBALI KE DEFAULT ---
// Kita patenkan ID Database ini. Jangan diubah agar data tidak hilang saat pindah hosting!
const DB_APP_ID = "Resparking_Production_DB"; 

// --- DATA & CONFIG DEFAULT ---
const DEFAULT_TARIFFS = {
  Motor: { type: 'progresif', first: 2000, next: 2000, max: 8000, overnight: 10000 },
  Mobil: { type: 'progresif', first: 3000, next: 3000, max: 15000, overnight: 20000 },
  Truk: { type: 'progresif', first: 5000, next: 5000, max: 25000, overnight: 25000 },
  Sepeda: { type: 'flat', first: 1000, next: 0, max: 2000, overnight: 5000 }
};

const VEHICLE_TYPES = ['Motor', 'Mobil', 'Truk', 'Sepeda'];
const LOCATIONS = ['ST. Cimahi Selatan', 'ST. Gadobangkong', 'ST. Cianjur', 'ST. Cibatu'];

const PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', 
  '0000af30-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2'
];

const DEFAULT_USERS = [
  { username: 'master', nipkwt: '200041', password: 'R3gional2BD!', role: 'Master' },
  { username: 'Kasier Pagi', nipkwt: '1014202601', password: '123', role: 'Kasier' },
  { username: 'Kasier Pagi', nipkwt: '1014202602', password: '123', role: 'Kasier' },
  { username: 'Kasier Pagi', nipkwt: '1014202603', password: '123', role: 'Kasier' },
  { username: 'Kasier Siang', nipkwt: '1014202604', password: '123', role: 'Kasier' },
  { username: 'Kasier Malam', nipkwt: '1014202605', password: '123', role: 'Kasier' },
  { username: 'Korlap', nipkwt: '1014202600', password: '123456', role: 'Korlap' },
  { username: 'Audit', nipkwt: '001', password: 'Audit123', role: 'Auditor' }
];

const DEFAULT_MEMBERS = [{ plate: 'B1234KWT', nip: '12345678' }];

// --- HELPER FORMAT TANGGAL BISNIS (PENGHEMAT KUOTA FIREBASE) ---
// Memisahkan transaksi ke dalam "laci harian" (Cut-off jam 06:00)
const getBusinessDateStr = (dateObj) => {
  const d = new Date(dateObj);
  if (d.getHours() < 6) d.setDate(d.getDate() - 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`; // Format hasil: 20260328
};

// Ubah format string (YYYYMMDD) kembali jadi tampilan kalender (YYYY-MM-DD)
const parseDateStrToInput = (str) => {
   if(!str || str.length !== 8) return "";
   return `${str.substring(0,4)}-${str.substring(4,6)}-${str.substring(6,8)}`;
};

export default function App() {
  const sessionId = useMemo(() => Math.random().toString(36).substring(2, 10), []);

  // --- STATE FIREBASE AUTH ---
  const [fbUser, setFbUser] = useState(null);
  const [isDbReady, setIsDbReady] = useState(false);

  // --- STATE SESSION LOKAL ---
  const [currentUser, setCurrentUser] = useState(() => {
    const savedUser = localStorage.getItem('app_currentUser');
    return savedUser ? JSON.parse(savedUser) : null;
  });
  const [view, setView] = useState(() => {
    return localStorage.getItem('app_currentUser') ? 'dashboard' : 'login';
  }); 

  // --- STATE OPERASIONAL ---
  const [activeTab, setActiveTab] = useState('masuk'); 
  const [shiftInfo, setShiftInfo] = useState({ name: '', time: '' });
  const shiftRef = useRef('');
  
  const [usersList, setUsersList] = useState(DEFAULT_USERS);
  const [parkedVehicles, setParkedVehicles] = useState([]);
  const [shiftTransactions, setShiftTransactions] = useState([]); // HANYA berisi transaksi HARI INI
  const [tariffs, setTariffs] = useState(DEFAULT_TARIFFS);
  const [members, setMembers] = useState(DEFAULT_MEMBERS); 
  const [runningText, setRunningText] = useState('Selamat Datang di Sistem Layanan Parkir Resparking');
  const [customLogo, setCustomLogo] = useState(null);

  const [connectedPrinter, setConnectedPrinter] = useState(null);
  const [settingsMenu, setSettingsMenu] = useState('tarif'); 
  const [plateNumber, setPlateNumber] = useState('');
  const [vehicleType, setVehicleType] = useState('Motor');
  const [newUser, setNewUser] = useState({ username: '', nipkwt: '', password: '', role: 'Kasier' });
  const [newMember, setNewMember] = useState({ plate: '', nip: '' });
  const [reportToPrint, setReportToPrint] = useState(null); 
  const [rekapSearch, setRekapSearch] = useState('');
  
  const [showCamera, setShowCamera] = useState(false);
  const [showLoginCamera, setShowLoginCamera] = useState(false);
  const [pendingLoginUser, setPendingLoginUser] = useState(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [currentTransaction, setCurrentTransaction] = useState(null);
  const [capturedImage, setCapturedImage] = useState(null);

  // State Khusus Admin Laporan (Hemat Kuota)
  const [adminSelectedDate, setAdminSelectedDate] = useState(parseDateStrToInput(getBusinessDateStr(new Date())));
  const [adminReports, setAdminReports] = useState([]);
  const [isLoadingReports, setIsLoadingReports] = useState(false);

  // ==================================================
  // EFEK 1: LOGIN & AUTH FIREBASE (KONEKSI DATABASE)
  // ==================================================
  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (e) { console.error("Firebase Auth Error:", e); }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFbUser(user);
      setIsDbReady(!!user);
    });
    return () => unsubscribe();
  }, []);

  // ==================================================
  // EFEK 2: FETCH DATA GLOBAL (USER LIST)
  // ==================================================
  useEffect(() => {
    if (!fbUser || !db) return;
    const docRef = doc(db, 'artifacts', DB_APP_ID, 'public', 'data', 'globalSettings', 'users');
    const unsub = onSnapshot(docRef, (snap) => {
      if (snap.exists() && snap.data().list) {
        setUsersList(snap.data().list);
      } else {
        setDoc(docRef, { list: DEFAULT_USERS }, { merge: true }).catch(console.error);
      }
    }, (err) => console.error(err));
    return () => unsub();
  }, [fbUser]);

  // ==================================================
  // EFEK 3: FETCH DATA LOKASI (PARKIR AKTIF & SHIFT HARI INI SAJA)
  // ==================================================
  useEffect(() => {
    if (!fbUser || !db || !currentUser?.location) return;
    const loc = currentUser.location;

    // 1. Sinkronisasi Pengaturan Lokasi
    const confRef = doc(db, 'artifacts', DB_APP_ID, 'public', 'data', 'locationConfigs', loc);
    const unsubConf = onSnapshot(confRef, (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        setTariffs(d.tariffs || DEFAULT_TARIFFS);
        setMembers(d.members || DEFAULT_MEMBERS);
        setRunningText(d.runningText || 'Selamat Datang di Sistem Layanan Parkir Resparking');
        if (d.customLogo !== undefined) setCustomLogo(d.customLogo);
      } else {
        setDoc(confRef, { tariffs: DEFAULT_TARIFFS, members: DEFAULT_MEMBERS, runningText: 'Selamat Datang di Sistem Layanan Parkir Resparking', customLogo: null }, { merge: true }).catch(console.error);
      }
    }, (err) => console.error(err));

    // 2. Sinkronisasi Kendaraan Terparkir (Masih di dalam)
    const pvRef = collection(db, 'artifacts', DB_APP_ID, 'public', 'data', `pv_${loc}`);
    const unsubPv = onSnapshot(pvRef, (snap) => {
      const items = [];
      snap.forEach(d => {
        const data = d.data();
        items.push({ ...data, time: new Date(data.time) });
      });
      setParkedVehicles(items);
    }, (err) => console.error(err));

    // 3. Sinkronisasi Transaksi Selesai (HANYA HARI BISNIS INI -> SANGAT HEMAT KUOTA)
    const todayBusinessStr = getBusinessDateStr(new Date());
    const txRef = collection(db, 'artifacts', DB_APP_ID, 'public', 'data', `tx_${loc}_${todayBusinessStr}`);
    const unsubTx = onSnapshot(txRef, (snap) => {
      const items = [];
      snap.forEach(d => {
        const data = d.data();
        items.push({ ...data, time: new Date(data.time), exitTime: data.exitTime ? new Date(data.exitTime) : null });
      });
      setShiftTransactions(items);
    }, (err) => console.error(err));

    return () => { unsubConf(); unsubPv(); unsubTx(); };
  }, [fbUser, currentUser?.location]);


  // ==================================================
  // EFEK 4: AMBIL DATA LAPORAN HISTORIS (ADMIN HANYA SAAT DIMINTA)
  // ==================================================
  useEffect(() => {
     if (view !== 'settings' || settingsMenu !== 'laporan' || !db || !currentUser?.location || !adminSelectedDate) return;
     
     const fetchAdminReports = async () => {
        setIsLoadingReports(true);
        try {
           // Ubah format YYYY-MM-DD ke YYYYMMDD
           const targetDateStr = adminSelectedDate.replace(/-/g, '');
           const q = collection(db, 'artifacts', DB_APP_ID, 'public', 'data', `tx_${currentUser.location}_${targetDateStr}`);
           const snap = await getDocs(q); // Pake getDocs untuk HEMAT KUOTA (Bukan onSnapshot)
           
           const items = [];
           snap.forEach(d => {
              const data = d.data();
              items.push({ ...data, time: new Date(data.time), exitTime: data.exitTime ? new Date(data.exitTime) : null });
           });
           setAdminReports(items);
        } catch(e) { console.error("Error fetch historical data:", e); }
        setIsLoadingReports(false);
     };

     fetchAdminReports();
  }, [view, settingsMenu, adminSelectedDate, currentUser?.location]);


  // --- LOGIKA WAKTU & SHIFT ---
  useEffect(() => {
    const updateTimeAndShift = () => {
      const now = new Date();
      const hours = now.getHours();
      let shiftName = '';
      
      if (hours >= 6 && hours < 14) shiftName = 'Shift 1 (Pagi)';
      else if (hours >= 14 && hours < 22) shiftName = 'Shift 2 (Siang)';
      else shiftName = 'Shift 3 (Malam)';

      setShiftInfo({
        name: shiftName,
        time: now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
      });

      if (shiftRef.current && shiftRef.current !== shiftName && currentUser && currentUser.role === 'Kasier') {
        setShowReportModal(true);
      }
      shiftRef.current = shiftName;
    };

    updateTimeAndShift();
    const timer = setInterval(updateTimeAndShift, 10000);
    return () => clearInterval(timer);
  }, [currentUser]);

  // --- HANDLER UPDATE DATABASE ---
  const updateLocConfig = (partial) => {
    if (currentUser?.role !== 'Master' || !db || !fbUser || !currentUser?.location) return;
    setDoc(doc(db, 'artifacts', DB_APP_ID, 'public', 'data', 'locationConfigs', currentUser.location), partial, { merge: true }).catch(console.error);
  };

  // --- HANDLER LOGIN & LOGOUT ---
  const handleLogin = (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const user = data.get('username');
    const pwd = data.get('password');
    const nip = data.get('nipkwt');
    const location = data.get('location');

    if (!user || !pwd || !nip || !location) return alert("Mohon isi semua data login termasuk lokasi stasiun!");

    const foundUser = usersList.find(u => u.username === user && u.nipkwt === nip && u.password === pwd);
    if (!foundUser) return alert("Akses Ditolak: Username, NIPKWT, atau Password tidak valid!");

    setPendingLoginUser({ name: foundUser.username, nipkwt: foundUser.nipkwt, role: foundUser.role, location });
    setShowLoginCamera(true);
  };

  const onLoginPhotoCaptured = (photoBase64) => {
    const loggedInUser = { ...pendingLoginUser, photo: photoBase64 };
    localStorage.setItem('app_currentUser', JSON.stringify(loggedInUser));
    setCurrentUser(loggedInUser);
    setShowLoginCamera(false);
    setView('dashboard');
  };

  const handleLogoutClick = () => {
    if(currentUser?.role === 'Kasier') {
      setShowReportModal(true);
    } else {
      confirmLogout();
    }
  };

  const confirmLogout = () => {
    if(currentUser) localStorage.removeItem('app_currentUser');
    setCurrentUser(null);
    setShowReportModal(false);
    setView('login');
  };

  // --- HELPERS ---
  const getBusinessDate = (dateObj) => {
    const d = new Date(dateObj);
    if (d.getHours() < 6) d.setDate(d.getDate() - 1); 
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const generateReportStats = (transactions) => {
    let stats = { motorQty: 0, motorNom: 0, mobilQty: 0, mobilNom: 0, trukQty: 0, trukNom: 0, memberQty: 0, total: 0 };
    transactions.forEach(t => {
      if (t.isMember) {
        stats.memberQty++;
      } else {
        if (t.vehicleType === 'Motor' || t.vehicleType === 'Sepeda') {
          stats.motorQty++; stats.motorNom += t.cost;
        } else if (t.vehicleType === 'Mobil') {
          stats.mobilQty++; stats.mobilNom += t.cost;
        } else if (t.vehicleType === 'Truk') {
          stats.trukQty++; stats.trukNom += t.cost;
        }
        stats.total += t.cost;
      }
    });
    return stats;
  };

  // --- TRANSAKSI PARKIR ---
  const handleMasuk = () => {
    if (!plateNumber) return alert("Masukkan Plat Nomor!");
    setCurrentTransaction({
      type: 'masuk',
      plate: plateNumber.toUpperCase(),
      vehicleType,
      time: new Date(),
      location: currentUser?.location,
      isMember: members.some(m => m.plate === plateNumber.toUpperCase())
    });
    setShowCamera(true);
  };

  const handleKeluar = () => {
    if (!plateNumber) return alert("Masukkan Plat Nomor!");
    const vehicle = parkedVehicles.find(v => v.plate === plateNumber.toUpperCase());
    if (!vehicle) return alert("Kendaraan tidak ditemukan di area parkir!");
    
    const exitTime = new Date();
    const durationMs = exitTime - vehicle.time;
    const hours = Math.ceil(durationMs / (1000 * 60 * 60)) || 1; 
    
    let cost = 0;
    if (!vehicle.isMember) {
      const rates = tariffs[vehicle.vehicleType];
      if (rates.type === 'flat') {
        cost = rates.first;
        if (exitTime.getDate() !== vehicle.time.getDate()) cost += rates.overnight;
      } else {
        cost = rates.first + (Math.max(0, hours - 1) * rates.next);
        if (cost > rates.max) cost = rates.max;
        if (exitTime.getDate() !== vehicle.time.getDate()) cost += rates.overnight;
      }
    }

    setCurrentTransaction({ ...vehicle, type: 'keluar', exitTime, durationHours: hours, cost, location: currentUser?.location });
    setShowCamera(true);
  };

  const handlePrintComplete = () => {
    if (!db || !fbUser || !currentUser?.location) return;

    if (currentTransaction?.type === 'masuk') {
      const v = { ...currentTransaction, photo: capturedImage, time: currentTransaction.time.toISOString() };
      setDoc(doc(db, 'artifacts', DB_APP_ID, 'public', 'data', `pv_${currentUser.location}`, v.plate), v).catch(console.error);
    } else if (currentTransaction?.type === 'keluar') {
      deleteDoc(doc(db, 'artifacts', DB_APP_ID, 'public', 'data', `pv_${currentUser.location}`, currentTransaction.plate)).catch(console.error);
      const tx = { ...currentTransaction, time: currentTransaction.time.toISOString(), exitTime: currentTransaction.exitTime.toISOString() };
      
      // Simpan ke collection harian yang super hemat kuota (Format: tx_Lokasi_20260328)
      const businessStr = getBusinessDateStr(new Date());
      setDoc(doc(db, 'artifacts', DB_APP_ID, 'public', 'data', `tx_${currentUser.location}_${businessStr}`, `${tx.plate}_${Date.now()}`), tx).catch(console.error);
    }
    
    setShowPrintModal(false);
    setPlateNumber('');
    setCurrentTransaction(null);
    setCapturedImage(null);
  };

  const pairBluetooth = async () => {
    try {
      if (!navigator.bluetooth) throw new Error("Browser ini tidak mendukung Web Bluetooth.");
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: PRINTER_SERVICES
      });
      setConnectedPrinter({ name: device.name || 'Printer Kasir Thermal', id: device.id });
      alert(`Berhasil menyandingkan: ${device.name || 'Printer Kasir Thermal'}`);
    } catch (err) {
      alert("Proses sanding dibatalkan atau gagal: " + err.message);
    }
  };

  useEffect(() => {
    if (reportToPrint) {
      setTimeout(() => {
        window.print();
        setTimeout(() => setReportToPrint(null), 1000);
      }, 500);
    }
  }, [reportToPrint]);

  // =====================================
  // TAMPILAN LOADING DB
  // =====================================
  if (!isDbReady) {
    return (
      <div className="min-h-screen bg-[#0A1A13] flex items-center justify-center text-white print:hidden">
        <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="ml-4 font-bold tracking-widest uppercase">Menghubungkan Database...</p>
      </div>
    );
  }

  // =====================================
  // MODAL LAPORAN SHIFT
  // =====================================
  const ReportModal = () => {
    const myShiftTx = shiftTransactions.filter(t => getBusinessDate(t.exitTime) === getBusinessDate(new Date()));
    const s = generateReportStats(myShiftTx);
    const dateStr = new Date().toLocaleDateString('id-ID');

    const doExportWA = () => {
      const msg = `*LAPORAN SHIFT KASIR*\n📍 Lokasi: ${currentUser?.location}\n🗓 ${dateStr}\n👤 ${currentUser?.name} (${currentUser?.nipkwt})\n🕒 ${shiftInfo.name}\n\n*RINCIAN:*\n🏍 Motor: ${s.motorQty} (Rp ${s.motorNom.toLocaleString()})\n🚗 Mobil: ${s.mobilQty} (Rp ${s.mobilNom.toLocaleString()})\n🚚 Box: ${s.trukQty} (Rp ${s.trukNom.toLocaleString()})\n💳 Member: ${s.memberQty}\n\n*TOTAL STORAN: Rp ${s.total.toLocaleString()}*`;
      window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
      setCurrentTransaction({ type: 'report', stats: s, date: dateStr, shift: shiftInfo.name, location: currentUser?.location });
      setShowPrintModal(true);
    };

    return (
      <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex items-center justify-center p-4 print:hidden">
        <div className="bg-[#0F2E1F] border border-green-500/30 backdrop-blur-xl rounded-[32px] w-full max-w-md p-6 text-white shadow-[0_0_50px_rgba(34,197,94,0.1)] relative overflow-hidden">
          <button onClick={confirmLogout} className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-red-500/80 rounded-full transition-colors"><X size={24} /></button>
          <div className="flex flex-col items-center mb-6 mt-4">
            <div className="bg-orange-500/20 text-orange-400 p-4 rounded-full mb-4"><FileText size={48} /></div>
            <h2 className="text-2xl font-bold tracking-tight text-center">Sudahkah Anda Laporan?</h2>
            <p className="text-white/60 text-sm text-center mt-2">Harap cetak & kirim laporan sebelum menyelesaikan shift di {currentUser?.location}.</p>
          </div>
          <div className="bg-black/40 rounded-2xl p-4 space-y-3 mb-6 text-sm border border-white/5">
            <div className="flex justify-between border-b border-white/10 pb-2"><span>Motor/Sepeda: {s.motorQty}</span> <span>Rp {s.motorNom.toLocaleString('id-ID')}</span></div>
            <div className="flex justify-between border-b border-white/10 pb-2"><span>Mobil: {s.mobilQty}</span> <span>Rp {s.mobilNom.toLocaleString('id-ID')}</span></div>
            <div className="flex justify-between border-b border-white/10 pb-2"><span>Box/Truk: {s.trukQty}</span> <span>Rp {s.trukNom.toLocaleString('id-ID')}</span></div>
            <div className="flex justify-between font-bold text-lg pt-2 text-green-400"><span>TOTAL STORAN:</span> <span>Rp {s.total.toLocaleString('id-ID')}</span></div>
          </div>
          <button onClick={doExportWA} className="w-full bg-green-500 hover:bg-green-400 text-black font-extrabold rounded-xl py-4 shadow-[0_0_20px_rgba(34,197,94,0.4)] transition-all flex justify-center items-center gap-2">
            <Send size={20} /> Export WA & Cetak Struk Laporan
          </button>
        </div>
      </div>
    );
  };

  // =====================================
  // VIEW: LOGIN
  // =====================================
  if (view === 'login') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0F2E1F] to-[#05100B] flex items-center justify-center p-4 font-sans text-white relative overflow-hidden print:hidden">
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-green-500/20 rounded-full blur-[100px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-emerald-700/20 rounded-full blur-[120px]"></div>

        <div className="bg-white/10 backdrop-blur-2xl border border-white/20 w-full max-w-sm rounded-[36px] p-8 shadow-[0_8px_32px_rgba(0,0,0,0.5)] relative z-10">
          <div className="flex flex-col items-center justify-center mb-6">
            <div className="bg-gradient-to-br from-green-400 to-green-600 p-5 rounded-[28px] shadow-lg border border-white/20 mb-4 mt-2">
              <Car size={72} className="text-white drop-shadow-md" />
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight mb-2 text-transparent bg-clip-text bg-gradient-to-r from-white to-green-300 uppercase">
              Resparking
            </h1>
            <p className="text-white/60 text-xs mb-3">Login Petugas Parkir (Hemat Kuota V2)</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-3">
              <div className="relative">
                <MapPin className="absolute left-4 top-4 text-white/40" size={20} />
                <select name="location" className="w-full bg-black/30 border border-white/10 rounded-xl p-4 pl-12 text-[15px] outline-none focus:ring-2 focus:ring-green-500/50 transition-all text-white appearance-none [&>option]:text-black" required defaultValue="">
                  <option value="" disabled>-- Pilih Lokasi Stasiun --</option>
                  {LOCATIONS.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                </select>
              </div>
              <input name="username" placeholder="Nama User" className="w-full bg-black/30 border border-white/10 rounded-xl p-4 text-[17px] outline-none focus:ring-2 focus:ring-green-500/50 transition-all placeholder:text-white/40 text-white" required />
              <input name="nipkwt" placeholder="NIPKWT User" className="w-full bg-black/30 border border-white/10 rounded-xl p-4 text-[17px] outline-none focus:ring-2 focus:ring-green-500/50 transition-all placeholder:text-white/40 text-white" required />
              <input name="password" type="password" placeholder="Password" className="w-full bg-black/30 border border-white/10 rounded-xl p-4 text-[17px] outline-none focus:ring-2 focus:ring-green-500/50 transition-all placeholder:text-white/40 text-white" required />
            </div>

            <div className="bg-green-500/10 text-green-300 p-4 rounded-xl text-center mt-2 border border-green-500/20">
              <p className="text-xs font-semibold uppercase tracking-wider mb-1 opacity-80">Shift Terdeteksi</p>
              <p className="text-xl font-bold">{shiftInfo.name}</p>
              <p className="text-sm opacity-70">{shiftInfo.time} WIB</p>
            </div>

            <button type="submit" className="w-full bg-green-500 text-black rounded-xl py-4 text-[17px] font-bold mt-4 shadow-[0_0_15px_rgba(34,197,94,0.3)] hover:bg-green-400 active:scale-[0.98] transition-all flex justify-center items-center gap-2">
              <Camera size={20} /> Login & Ambil Foto
            </button>
            
            <p className="text-center text-white/30 text-[11px] font-bold tracking-widest uppercase mt-6">
              copyright by 200041
            </p>
          </form>
        </div>

        {showLoginCamera && (
          <CameraModal 
            onCapture={onLoginPhotoCaptured} 
            onClose={() => setShowLoginCamera(false)} 
            title="Foto Kehadiran (Selfie)" 
          />
        )}
      </div>
    );
  }

  // =====================================
  // VIEW: DASHBOARD KASIR
  // =====================================
  const canAccessSettings = ['Master', 'Korlap', 'Auditor'].includes(currentUser?.role);

  if (view === 'dashboard') {
    return (
      <div className="min-h-screen bg-[#0A1A13] font-sans text-white pb-20 selection:bg-green-500/30 print:hidden">
        <div className="bg-[#0F2E1F]/80 backdrop-blur-xl pt-10 pb-4 px-4 sticky top-0 z-10 border-b border-white/10 shadow-lg">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-3">
              {currentUser?.photo ? (
                <img src={currentUser.photo} alt="User" className="w-12 h-12 rounded-full border-2 border-green-500 object-cover shadow-lg" />
              ) : (
                <div className="w-12 h-12 rounded-full border-2 border-green-500 flex items-center justify-center bg-black/50">
                  <Users size={20} className="text-green-500" />
                </div>
              )}
              <div>
                <h1 className="text-xl md:text-2xl font-bold tracking-tight text-green-50">{currentUser?.name} <span className="text-xs font-normal text-white/50">({currentUser?.nipkwt}) - {currentUser?.role}</span></h1>
                <div className="flex items-center gap-1.5 mt-0.5 text-xs md:text-sm text-green-400/80 font-medium">
                  <MapPin size={14} /> {currentUser?.location} • {shiftInfo.name}
                </div>
              </div>
            </div>
            <div className="flex gap-2 md:gap-3">
              {canAccessSettings && (
                <button onClick={() => setView('settings')} className="p-2 md:p-3 bg-white/10 border border-white/10 rounded-full text-white hover:bg-white/20 transition-colors">
                  <Settings size={20} />
                </button>
              )}
              <button onClick={handleLogoutClick} className="p-2 md:p-3 bg-red-500/20 border border-red-500/30 rounded-full text-red-400 hover:bg-red-500/40 transition-colors">
                <LogOut size={20} />
              </button>
            </div>
          </div>
          
          <div className="w-full bg-black py-1.5 overflow-hidden relative shadow-inner border-y border-red-500/20 mb-2 mt-2">
            <marquee scrollamount="8" className="text-red-500 text-[11px] font-bold tracking-widest uppercase">
              {runningText}
            </marquee>
          </div>

          <div className="bg-black/40 p-1.5 rounded-[12px] flex border border-white/5 mt-2">
            <button onClick={() => setActiveTab('masuk')} className={`flex-1 py-2 text-sm font-bold rounded-[8px] transition-all ${activeTab === 'masuk' ? 'bg-white/15 shadow-sm text-white' : 'text-white/50 hover:text-white/80'}`}>Kendaraan Masuk</button>
            <button onClick={() => setActiveTab('keluar')} className={`flex-1 py-2 text-sm font-bold rounded-[8px] transition-all ${activeTab === 'keluar' ? 'bg-white/15 shadow-sm text-white' : 'text-white/50 hover:text-white/80'}`}>Kendaraan Keluar</button>
          </div>
        </div>

        <div className="p-4 mt-4 max-w-md mx-auto">
          {activeTab === 'masuk' ? (
            <div className="bg-white/5 border border-white/10 backdrop-blur-lg rounded-[24px] p-6 shadow-xl space-y-6">
              <div className="flex justify-center mb-4">
                {customLogo ? (
                  <img src={customLogo} alt="Logo" className="h-16 w-16 object-contain" />
                ) : (
                  <Car size={48} className="text-white/30" />
                )}
              </div>
              <div>
                <label className="text-xs font-bold text-white/50 uppercase tracking-widest pl-1">Input Plat Nomor</label>
                <input value={plateNumber} onChange={e => setPlateNumber(e.target.value.toUpperCase())} placeholder="D 1234 XY" className="w-full mt-2 bg-black/40 border border-white/10 rounded-2xl p-5 text-4xl font-black text-center text-white uppercase tracking-[0.2em] outline-none focus:ring-2 focus:ring-green-500/50 focus:bg-black/60 transition-all placeholder:text-white/20" />
              </div>
              <div>
                <label className="text-xs font-bold text-white/50 uppercase tracking-widest pl-1 mb-3 block">Pilih Kategori</label>
                <div className="grid grid-cols-2 gap-3">
                  {VEHICLE_TYPES.map(type => (
                    <button key={type} onClick={() => setVehicleType(type)} className={`flex flex-col items-center justify-center py-5 rounded-2xl border transition-all ${vehicleType === type ? 'border-green-400 bg-green-400/10 text-green-300' : 'border-white/10 bg-black/30 text-white/60'}`}>
                      {type === 'Motor' && <Bike size={32} className="mb-2"/>}
                      {type === 'Mobil' && <Car size={32} className="mb-2"/>}
                      {type === 'Truk' && <Truck size={32} className="mb-2"/>}
                      {type === 'Sepeda' && <Bike size={32} className="mb-2"/>}
                      <span className="text-sm font-bold">{type}</span>
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={handleMasuk} disabled={currentUser?.role !== 'Kasier'} className={`w-full rounded-2xl py-4 text-lg font-extrabold shadow-[0_0_20px_rgba(34,197,94,0.25)] flex items-center justify-center gap-2 mt-4 transition-all ${currentUser?.role === 'Kasier' ? 'bg-green-500 text-black hover:bg-green-400 active:scale-[0.98]' : 'bg-gray-600 text-gray-400 cursor-not-allowed opacity-50'}`}>
                <Printer size={22} /> Cetak Tiket Masuk
              </button>
            </div>
          ) : (
            <div className="bg-white/5 border border-white/10 backdrop-blur-lg rounded-[24px] p-6 shadow-xl space-y-6">
               <div>
                <label className="text-xs font-bold text-white/50 uppercase tracking-widest pl-1">Cari Plat Kendaraan Keluar</label>
                <div className="relative mt-2">
                  <Search className="absolute left-5 top-5 text-white/40" size={26} />
                  <input value={plateNumber} onChange={e => setPlateNumber(e.target.value.toUpperCase())} placeholder="D 12..." className="w-full bg-black/40 border border-white/10 rounded-2xl p-5 pl-14 text-3xl font-black text-white uppercase tracking-widest outline-none focus:ring-2 focus:ring-red-500/50 transition-all placeholder:text-white/20" />
                </div>
              </div>
              <div className="bg-black/20 rounded-2xl p-3 max-h-48 overflow-y-auto space-y-2 border border-white/5">
                {parkedVehicles.filter(v => v.plate.includes(plateNumber) && plateNumber !== '').map((v, i) => (
                  <div key={i} onClick={() => setPlateNumber(v.plate)} className="bg-white/10 p-4 rounded-xl flex justify-between items-center cursor-pointer hover:bg-white/20 border border-white/5 transition-colors">
                    <span className="font-bold text-xl tracking-wider">{v.plate}</span>
                    <span className="text-xs font-bold bg-white/20 text-white px-3 py-1.5 rounded-lg">{v.vehicleType}</span>
                  </div>
                ))}
                {parkedVehicles.length === 0 && <p className="text-center text-white/40 text-sm py-6">Area parkir kosong / data tidak ditemukan.</p>}
              </div>

              {parkedVehicles.find(v => v.plate === plateNumber) && (
                <div className="bg-black/40 p-4 rounded-2xl border border-white/10 text-center animate-fade-in">
                  <p className="text-xs font-bold text-white/50 uppercase mb-3">Validasi Foto Masuk Kendaraan</p>
                  {parkedVehicles.find(v => v.plate === plateNumber).photo ? (
                    <img src={parkedVehicles.find(v => v.plate === plateNumber).photo} alt="Foto Masuk" className="w-full h-48 object-cover rounded-xl border border-white/20 shadow-lg" />
                  ) : (
                    <div className="w-full h-48 flex flex-col items-center justify-center bg-white/5 rounded-xl border border-white/20 text-white/30">
                      <ImageIcon size={48} className="mb-2" />
                      <span className="text-sm">Tidak ada foto terekam</span>
                    </div>
                  )}
                </div>
              )}

              <button onClick={handleKeluar} disabled={currentUser?.role !== 'Kasier'} className={`w-full rounded-2xl py-4 text-lg font-extrabold shadow-[0_0_20px_rgba(239,68,68,0.3)] flex items-center justify-center gap-2 mt-4 transition-all ${currentUser?.role === 'Kasier' ? 'bg-red-500/90 text-white hover:bg-red-400 active:scale-[0.98]' : 'bg-gray-600 text-gray-400 cursor-not-allowed opacity-50'}`}>
                <Printer size={22} /> Selesaikan & Cetak Struk
              </button>
            </div>
          )}
        </div>

        {showCamera && <CameraModal onCapture={v => { setCapturedImage(v); setShowCamera(false); setShowPrintModal(true); }} onClose={() => setShowCamera(false)} />}
        {showPrintModal && <PrintModal transaction={currentTransaction} onComplete={handlePrintComplete} />}
        {showReportModal && <ReportModal />}
      </div>
    );
  }

  // =====================================
  // VIEW: SETTINGS MASTER / VIEWER
  // =====================================
  if (view === 'settings' && canAccessSettings) {
    const isEditor = currentUser?.role === 'Master'; 

    const generatePDFReport = (dateStr, dataArray) => {
       const s = generateReportStats(dataArray);
       setReportToPrint({ date: dateStr, stats: s, data: dataArray });
    };

    const exportWALaporan = (dateStr, dataArray) => {
       const s = generateReportStats(dataArray);
       const msg = `*REKAP PENDAPATAN (CUT OFF)*\n📍 Lokasi: ${currentUser?.location}\n🗓 Tgl Bisnis: ${dateStr}\n\n*RINCIAN:*\n🏍 Motor: ${s.motorQty} (Rp ${s.motorNom.toLocaleString()})\n🚗 Mobil: ${s.mobilQty} (Rp ${s.mobilNom.toLocaleString()})\n🚚 Box: ${s.trukQty} (Rp ${s.trukNom.toLocaleString()})\n💳 Member: ${s.memberQty}\n\n*TOTAL: Rp ${s.total.toLocaleString()}*`;
       window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
    };

    const handleAddUser = (e) => {
      e.preventDefault();
      if(!isEditor || !db) return;
      if(usersList.find(u => u.username === newUser.username)) return alert("Username sudah ada!");
      
      const newList = [...usersList, newUser];
      setUsersList(newList);
      setDoc(doc(db, 'artifacts', DB_APP_ID, 'public', 'data', 'globalSettings', 'users'), { list: newList }, {merge: true}).catch(console.error);
      setNewUser({ username: '', nipkwt: '', password: '', role: 'Kasier' });
    };

    const handleDeleteUser = (username) => {
      if(!isEditor || !db) return;
      if(username === 'master') return alert("Akun Master default tidak bisa dihapus!");
      
      const newList = usersList.filter(u => u.username !== username);
      setUsersList(newList);
      setDoc(doc(db, 'artifacts', DB_APP_ID, 'public', 'data', 'globalSettings', 'users'), { list: newList }, {merge: true}).catch(console.error);
    };

    const handleAddMember = (e) => {
      e.preventDefault();
      if(!isEditor) return;
      if(!newMember.plate || !newMember.nip) return;
      if(members.some(m => m.plate === newMember.plate.toUpperCase())) return alert("Plat nomor sudah terdaftar!");
      
      const newMembersList = [...members, { plate: newMember.plate.toUpperCase(), nip: newMember.nip }];
      setMembers(newMembersList);
      updateLocConfig({ members: newMembersList });
      setNewMember({ plate: '', nip: '' });
    };

    const handleDeleteMember = (plate) => {
      if(!isEditor) return;
      const newMembersList = members.filter(m => m.plate !== plate);
      setMembers(newMembersList);
      updateLocConfig({ members: newMembersList });
    };

    return (
      <>
        <div className="flex flex-col md:flex-row h-screen bg-[#0A1A13] text-white overflow-hidden print:hidden font-sans">
          <div className="w-full md:w-80 bg-[#0F2E1F] border-r border-white/10 p-6 flex flex-col md:h-full z-20">
            <div className="flex justify-between items-center mb-8">
              <h1 className="text-2xl font-bold tracking-tight text-green-400">Panel Master</h1>
              <button onClick={() => setView('dashboard')} className="p-2 bg-white/5 hover:bg-white/20 rounded-full transition-colors"><X size={20}/></button>
            </div>

            <div className="bg-black/40 border border-white/10 p-3 rounded-xl mb-6">
               <p className="text-xs text-white/50 mb-1 uppercase tracking-wider font-bold">Lokasi Aktif</p>
               <p className="text-green-300 font-bold flex items-center gap-2"><MapPin size={16}/> {currentUser?.location}</p>
            </div>

            <div className="space-y-2 flex-1 overflow-y-auto">
              {[
                { id: 'tarif', icon: <Settings size={18}/>, label: 'Tarif & Membership' },
                { id: 'users', icon: <Users size={18}/>, label: 'Manajemen User' },
                { id: 'laporan', icon: <BarChart3 size={18}/>, label: 'Laporan Pendapatan' },
                { id: 'rekap', icon: <Search size={18}/>, label: 'Rekap Kendaraan' },
                { id: 'overnight', icon: <Moon size={18}/>, label: 'Kendaraan Overnight' },
                { id: 'device', icon: <Bluetooth size={18}/>, label: 'Device & Printer' }
              ].map(item => (
                <button key={item.id} onClick={() => setSettingsMenu(item.id)} className={`w-full flex items-center gap-3 p-4 rounded-2xl transition-all font-semibold ${settingsMenu === item.id ? 'bg-green-500 text-black shadow-lg' : 'hover:bg-white/10 text-white/70'}`}>
                  {item.icon} {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 p-6 md:p-10 overflow-y-auto">
            {!isEditor && (
              <div className="bg-blue-500/20 border border-blue-500/50 text-blue-300 p-4 rounded-xl mb-6 flex items-center gap-3 animate-fade-in">
                 <Eye size={24} className="shrink-0" />
                 <div>
                    <p className="font-bold">Mode Hanya Lihat (Viewer Mode)</p>
                    <p className="text-sm opacity-80">Anda masuk sebagai {currentUser?.role}. Anda tidak memiliki izin untuk mengubah konfigurasi tarif & sistem.</p>
                 </div>
              </div>
            )}

            {settingsMenu === 'tarif' && (
              <div className="space-y-8 max-w-4xl animate-fade-in">
                <h2 className="text-3xl font-extrabold mb-6">Atur Tarif Parkir</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {VEHICLE_TYPES.map(type => (
                    <div key={type} className={`bg-white/5 border border-white/10 p-6 rounded-[24px] ${!isEditor && 'opacity-70 pointer-events-none'}`}>
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xl font-bold text-green-300">Tarif {type}</h3>
                        <div className="flex bg-black/50 rounded-full p-1 cursor-pointer">
                          <button onClick={() => { if (!isEditor) return; const newTariffs = {...tariffs, [type]: {...tariffs[type], type: 'progresif'}}; setTariffs(newTariffs); updateLocConfig({ tariffs: newTariffs }); }} className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${tariffs[type].type !== 'flat' ? 'bg-green-500 text-black shadow-md' : 'text-white/50 hover:text-white'}`} disabled={!isEditor}>Progresif</button>
                          <button onClick={() => { if (!isEditor) return; const newTariffs = {...tariffs, [type]: {...tariffs[type], type: 'flat'}}; setTariffs(newTariffs); updateLocConfig({ tariffs: newTariffs }); }} className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${tariffs[type].type === 'flat' ? 'bg-green-500 text-black shadow-md' : 'text-white/50 hover:text-white'}`} disabled={!isEditor}>Flat</button>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div className="flex justify-between items-center gap-4">
                          <label className="text-sm text-white/60 w-1/3">Tarif Awal</label>
                          <input type="number" value={tariffs[type].first} onChange={(e) => { const newTariffs = {...tariffs, [type]: {...tariffs[type], first: parseInt(e.target.value)}}; setTariffs(newTariffs); updateLocConfig({ tariffs: newTariffs }); }} readOnly={!isEditor} className={`flex-1 bg-black/40 border border-white/10 p-3 rounded-xl outline-none focus:ring-1 focus:ring-green-500 text-white ${!isEditor && 'bg-black/10'}`} />
                        </div>
                        <div className={`flex justify-between items-center gap-4 transition-opacity ${tariffs[type].type === 'flat' ? 'opacity-30 pointer-events-none' : ''}`}>
                          <label className="text-sm text-white/60 w-1/3">Jam Berikutnya</label>
                          <input type="number" value={tariffs[type].next} onChange={(e) => { const newTariffs = {...tariffs, [type]: {...tariffs[type], next: parseInt(e.target.value)}}; setTariffs(newTariffs); updateLocConfig({ tariffs: newTariffs }); }} readOnly={!isEditor} className={`flex-1 bg-black/40 border border-white/10 p-3 rounded-xl outline-none focus:ring-1 focus:ring-green-500 text-white ${!isEditor && 'bg-black/10'}`} />
                        </div>
                        <div className={`flex justify-between items-center gap-4 transition-opacity ${tariffs[type].type === 'flat' ? 'opacity-30 pointer-events-none' : ''}`}>
                          <label className="text-sm text-white/60 w-1/3">Maksimal / Hari</label>
                          <input type="number" value={tariffs[type].max} onChange={(e) => { const newTariffs = {...tariffs, [type]: {...tariffs[type], max: parseInt(e.target.value)}}; setTariffs(newTariffs); updateLocConfig({ tariffs: newTariffs }); }} readOnly={!isEditor} className={`flex-1 bg-black/40 border border-white/10 p-3 rounded-xl outline-none focus:ring-1 focus:ring-green-500 text-white ${!isEditor && 'bg-black/10'}`} />
                        </div>
                        <div className="flex justify-between items-center gap-4">
                          <label className="text-sm text-white/60 w-1/3">Tarif Menginap</label>
                          <input type="number" value={tariffs[type].overnight} onChange={(e) => { const newTariffs = {...tariffs, [type]: {...tariffs[type], overnight: parseInt(e.target.value)}}; setTariffs(newTariffs); updateLocConfig({ tariffs: newTariffs }); }} readOnly={!isEditor} className={`flex-1 bg-black/40 border border-white/10 p-3 rounded-xl outline-none focus:ring-1 focus:ring-green-500 text-white ${!isEditor && 'bg-black/10'}`} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className={`bg-white/5 border border-white/10 p-6 rounded-[24px] ${!isEditor && 'opacity-80 pointer-events-none'}`}>
                  <h3 className="text-xl font-bold mb-4 text-green-300">Branding & Tampilan Halaman Awal</h3>
                  <div className="mb-5">
                    <label className="text-sm text-white/60 mb-2 block">Logo Custom Stasiun (Opsional)</label>
                    {isEditor && (
                      <input 
                        type="file" accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onloadend = () => {
                              setCustomLogo(reader.result);
                              updateLocConfig({ customLogo: reader.result });
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                        className="w-full bg-black/40 border border-white/10 p-3 rounded-xl outline-none text-white text-sm file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-bold file:bg-green-500/20 file:text-green-400 hover:file:bg-green-500/30"
                      />
                    )}
                    {customLogo && (
                      <div className="mt-3 flex items-center gap-4">
                        <img src={customLogo} alt="Logo Preview" className="h-16 w-16 object-contain bg-white/10 rounded-xl p-2" />
                        {isEditor && <button onClick={() => { setCustomLogo(null); updateLocConfig({ customLogo: null }); }} className="text-red-400 text-sm font-bold hover:underline">Hapus Logo</button>}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="text-sm text-white/60 mb-2 block">Pengaturan Running Text</label>
                    <input 
                      value={runningText} 
                      onChange={e => { setRunningText(e.target.value); updateLocConfig({ runningText: e.target.value }); }} 
                      readOnly={!isEditor} className="w-full bg-black/40 border border-white/10 p-4 rounded-xl outline-none focus:ring-1 focus:ring-green-500 text-white font-medium tracking-wide" placeholder="Masukkan teks berjalan..."
                    />
                  </div>
                </div>
                
                <div className="bg-white/5 border border-white/10 p-6 rounded-[24px]">
                  <h3 className="text-xl font-bold mb-4 text-green-300">Daftar Member (Gratis)</h3>
                  {isEditor && (
                    <form onSubmit={handleAddMember} className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                       <input required value={newMember.plate} onChange={e=>setNewMember({...newMember, plate: e.target.value.toUpperCase()})} placeholder="Plat Nomor" className="bg-black/40 border border-white/10 p-3 rounded-xl outline-none focus:ring-1 focus:ring-green-500 text-white" />
                       <input required value={newMember.nip} onChange={e=>setNewMember({...newMember, nip: e.target.value})} placeholder="NIP/NIPP Pegawai" className="bg-black/40 border border-white/10 p-3 rounded-xl outline-none focus:ring-1 focus:ring-green-500 text-white" />
                       <button type="submit" className="bg-green-500 text-black font-bold p-3 rounded-xl flex items-center justify-center gap-2 hover:bg-green-400"><Plus size={18}/> Tambah Member</button>
                    </form>
                  )}
                  <div className="bg-black/40 border border-white/10 rounded-xl overflow-hidden">
                     <table className="w-full text-left text-sm">
                        <thead className="bg-black/60"><tr><th className="p-4">Plat Nomor</th><th className="p-4">NIP/NIPP Pegawai</th>{isEditor && <th className="p-4 text-center">Aksi</th>}</tr></thead>
                        <tbody>
                           {members.map((m, i) => (
                              <tr key={i} className="border-t border-white/5 hover:bg-white/5 transition-colors">
                                 <td className="p-4 font-bold tracking-wider">{m.plate}</td>
                                 <td className="p-4 text-white/70">{m.nip}</td>
                                 {isEditor && <td className="p-4 text-center"><button onClick={() => handleDeleteMember(m.plate)} className="text-red-400 hover:text-red-300 p-2"><Trash2 size={18}/></button></td>}
                              </tr>
                           ))}
                           {members.length === 0 && <tr><td colSpan={isEditor ? 3 : 2} className="p-6 text-center text-white/40">Belum ada data member.</td></tr>}
                        </tbody>
                     </table>
                  </div>
                </div>
              </div>
            )}

            {settingsMenu === 'users' && (
              <div className="space-y-8 max-w-4xl animate-fade-in">
                <h2 className="text-3xl font-extrabold mb-6">Manajemen User (Global)</h2>
                {isEditor && (
                  <form onSubmit={handleAddUser} className="bg-white/5 border border-white/10 p-6 rounded-[24px] grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                    <div className="md:col-span-1"><label className="text-xs text-white/60 mb-1 block">Username</label><input required value={newUser.username} onChange={e=>setNewUser({...newUser, username: e.target.value})} className="w-full bg-black/40 border border-white/10 p-3 rounded-xl outline-none focus:ring-1 focus:ring-green-500 text-white" /></div>
                    <div className="md:col-span-1"><label className="text-xs text-white/60 mb-1 block">NIPKWT</label><input required value={newUser.nipkwt} onChange={e=>setNewUser({...newUser, nipkwt: e.target.value})} className="w-full bg-black/40 border border-white/10 p-3 rounded-xl outline-none focus:ring-1 focus:ring-green-500 text-white" /></div>
                    <div className="md:col-span-1"><label className="text-xs text-white/60 mb-1 block">Password</label><input required value={newUser.password} onChange={e=>setNewUser({...newUser, password: e.target.value})} className="w-full bg-black/40 border border-white/10 p-3 rounded-xl outline-none focus:ring-1 focus:ring-green-500 text-white" /></div>
                    <div className="md:col-span-1"><label className="text-xs text-white/60 mb-1 block">Role</label>
                      <select value={newUser.role} onChange={e=>setNewUser({...newUser, role: e.target.value})} className="w-full bg-black/40 border border-white/10 p-3 rounded-xl outline-none focus:ring-1 focus:ring-green-500 text-white [&>option]:text-black">
                        <option value="Kasier">Kasier</option><option value="Korlap">Korlap</option><option value="Auditor">Auditor</option><option value="Master">Master</option>
                      </select>
                    </div>
                    <div className="md:col-span-1"><button type="submit" className="w-full bg-green-500 text-black font-bold p-3 rounded-xl flex items-center justify-center gap-2 hover:bg-green-400"><Plus size={18}/> Tambah</button></div>
                  </form>
                )}
                <div className="bg-white/5 border border-white/10 rounded-[24px] overflow-hidden">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-black/40"><tr><th className="p-4">Username</th><th className="p-4">NIPKWT</th><th className="p-4">Role</th>{isEditor && <th className="p-4 text-center">Aksi</th>}</tr></thead>
                    <tbody>
                      {usersList.map((u, i) => (
                        <tr key={i} className="border-t border-white/5 hover:bg-white/5 transition-colors">
                          <td className="p-4 font-bold">{u.username}</td><td className="p-4">{u.nipkwt}</td>
                          <td className="p-4">
                            <span className={`px-2 py-1 rounded-md text-xs font-bold ${u.role==='Master'?'bg-orange-500/20 text-orange-400':u.role==='Auditor'?'bg-purple-500/20 text-purple-400':u.role==='Korlap'?'bg-blue-500/20 text-blue-400':'bg-green-500/20 text-green-400'}`}>{u.role.toUpperCase()}</span>
                          </td>
                          {isEditor && (
                            <td className="p-4 text-center">
                              {u.username !== 'master' && <button onClick={()=>handleDeleteUser(u.username)} className="text-red-400 hover:text-red-300 p-2"><Trash2 size={18}/></button>}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {settingsMenu === 'laporan' && (
              <div className="space-y-6 max-w-4xl animate-fade-in">
                <h2 className="text-3xl font-extrabold mb-2">Laporan Pendapatan (Mode Hemat Kuota)</h2>
                <p className="text-white/50 text-sm mb-6">Pilih tanggal untuk memuat riwayat transaksi. Aplikasi hanya akan mendownload data saat Anda mengeklik tombol "Cari Laporan" untuk meminimalisir penggunaan kuota.</p>
                
                <div className="bg-white/5 border border-white/10 p-6 rounded-[24px]">
                   <div className="flex flex-col md:flex-row gap-4 items-end mb-6">
                      <div className="flex-1 w-full">
                         <label className="text-xs font-bold text-white/50 uppercase tracking-widest pl-1 mb-2 block">Pilih Tanggal Bisnis</label>
                         <div className="relative">
                            <Calendar className="absolute left-4 top-3.5 text-white/40" size={20} />
                            <input type="date" value={adminSelectedDate} onChange={e => setAdminSelectedDate(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 pl-12 outline-none focus:ring-1 focus:ring-green-500 text-white" />
                         </div>
                      </div>
                      <div className="w-full md:w-auto">
                         <button className="w-full md:w-auto bg-green-500 text-black font-bold px-6 py-3 rounded-xl hover:bg-green-400 shadow-lg" onClick={() => setAdminSelectedDate(adminSelectedDate)}>Refresh Data</button>
                      </div>
                   </div>

                   {isLoadingReports ? (
                      <div className="py-10 text-center flex flex-col items-center text-white/40"><div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin mb-4"></div>Memuat Data Transaksi...</div>
                   ) : adminReports.length === 0 ? (
                      <div className="py-10 text-center text-white/40 border-t border-white/5">Tidak ada transaksi yang terselesaikan pada tanggal {adminSelectedDate}.</div>
                   ) : (
                      <div className="border-t border-white/10 pt-6">
                         <div className="flex justify-between items-center mb-6">
                           <h3 className="text-xl font-bold text-green-400">Total: {adminReports.length} Kendaraan</h3>
                           <div className="flex gap-2">
                              <button onClick={() => exportWALaporan(adminSelectedDate, adminReports)} className="flex items-center gap-2 bg-green-500/20 text-green-400 px-4 py-2 rounded-xl text-sm font-bold hover:bg-green-500/30 transition-colors"><Send size={16}/> Kirim WA</button>
                              <button onClick={() => generatePDFReport(adminSelectedDate, adminReports)} className="flex items-center gap-2 bg-blue-500/20 text-blue-400 px-4 py-2 rounded-xl text-sm font-bold hover:bg-blue-500/30 transition-colors"><FileDown size={16}/> Lampiran PDF</button>
                           </div>
                         </div>
                         <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {(() => {
                               const stats = generateReportStats(adminReports);
                               return (
                                 <>
                                  <div className="bg-black/30 p-4 rounded-xl"><p className="text-xs text-white/50">Total Motor</p><p className="text-xl font-bold mt-1">Rp {stats.motorNom.toLocaleString()}</p></div>
                                  <div className="bg-black/30 p-4 rounded-xl"><p className="text-xs text-white/50">Total Mobil/Box</p><p className="text-xl font-bold mt-1">Rp {(stats.mobilNom + stats.trukNom).toLocaleString()}</p></div>
                                  <div className="bg-black/30 p-4 rounded-xl"><p className="text-xs text-white/50">Member Gratis</p><p className="text-xl font-bold mt-1">{stats.memberQty} Unit</p></div>
                                  <div className="bg-green-500/10 p-4 rounded-xl border border-green-500/30"><p className="text-xs text-green-400/80">Total Pendapatan</p><p className="text-2xl font-bold text-green-400 mt-1">Rp {stats.total.toLocaleString()}</p></div>
                                 </>
                               )
                            })()}
                         </div>
                      </div>
                   )}
                </div>
              </div>
            )}

            {settingsMenu === 'rekap' && (
              <div className="space-y-6 max-w-5xl animate-fade-in">
                <h2 className="text-3xl font-extrabold mb-2">Rekap Transaksi Hari Ini</h2>
                <p className="text-white/50 text-sm mb-6">Pencarian riwayat kendaraan masuk dan keluar pada <b>hari bisnis berjalan</b> untuk menghemat kuota sistem.</p>
                <div className="bg-white/5 border border-white/10 p-6 rounded-[24px]">
                  <div className="relative mb-6">
                    <Search className="absolute left-4 top-4 text-white/40" size={20} />
                    <input 
                      value={rekapSearch} 
                      onChange={e => setRekapSearch(e.target.value.toUpperCase())} 
                      placeholder="Cari Plat Nomor (Contoh: D 1234 XY)..." 
                      className="w-full bg-black/40 border border-white/10 rounded-xl p-4 pl-12 text-lg font-bold text-white uppercase tracking-widest outline-none focus:ring-1 focus:ring-green-500 transition-all" 
                    />
                  </div>
                  <div className="bg-black/40 border border-white/10 rounded-xl overflow-x-auto">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-black/60">
                        <tr>
                          <th className="p-4">Plat Nomor</th>
                          <th className="p-4">Kategori</th>
                          <th className="p-4">Jam Masuk</th>
                          <th className="p-4">Jam Keluar</th>
                          <th className="p-4">Status</th>
                          <th className="p-4">Tarif</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...parkedVehicles, ...shiftTransactions]
                          .filter(v => v.plate.includes(rekapSearch))
                          .sort((a, b) => b.time - a.time)
                          .map((v, i) => (
                            <tr key={i} className="border-t border-white/5 hover:bg-white/5 transition-colors">
                              <td className="p-4 font-bold tracking-wider">{v.plate}</td>
                              <td className="p-4">{v.vehicleType}</td>
                              <td className="p-4">{v.time.toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'})}</td>
                              <td className="p-4">{v.exitTime ? v.exitTime.toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'}) : '-'}</td>
                              <td className="p-4">
                                {v.exitTime ? 
                                  <span className="bg-green-500/20 text-green-400 px-2 py-1 rounded text-xs font-bold">Selesai</span> : 
                                  <span className="bg-orange-500/20 text-orange-400 px-2 py-1 rounded text-xs font-bold">Di Dalam</span>}
                              </td>
                              <td className="p-4">{v.isMember ? 'Member' : (v.cost ? `Rp ${v.cost.toLocaleString('id-ID')}` : '-')}</td>
                            </tr>
                        ))}
                        {[...parkedVehicles, ...shiftTransactions].filter(v => v.plate.includes(rekapSearch)).length === 0 && (
                          <tr><td colSpan="6" className="p-6 text-center text-white/40">Data tidak ditemukan.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {settingsMenu === 'overnight' && (
              <div className="space-y-6 max-w-5xl animate-fade-in">
                <h2 className="text-3xl font-extrabold mb-2">Kendaraan Overnight (Menginap)</h2>
                <p className="text-white/50 text-sm mb-6">Daftar kendaraan yang saat ini masih berada di area parkir {currentUser?.location}.</p>
                {parkedVehicles.length === 0 ? (
                  <div className="p-10 text-center bg-white/5 border border-white/10 rounded-[24px] text-white/40">Area Parkir Kosong.</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {parkedVehicles.map((v, i) => (
                      <div key={i} className="bg-white/5 border border-white/10 rounded-[24px] overflow-hidden flex flex-col">
                        <div className="h-48 bg-black/50 relative">
                          {v.photo ? <img src={v.photo} className="w-full h-full object-cover" alt="Foto" /> : <div className="w-full h-full flex items-center justify-center text-white/20"><ImageIcon size={48} /></div>}
                          <div className="absolute bottom-2 right-2 bg-black/80 backdrop-blur-md px-3 py-1 rounded-lg text-xs font-bold border border-white/10">{v.vehicleType}</div>
                        </div>
                        <div className="p-5">
                          <h3 className="text-2xl font-black tracking-widest mb-1">{v.plate}</h3>
                          <p className="text-xs text-white/50">Masuk: {v.time.toLocaleDateString('id-ID')} - {v.time.toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'})}</p>
                          {v.isMember && <span className="inline-block mt-3 bg-blue-500/20 text-blue-300 px-2 py-1 rounded text-xs font-bold">Member</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {settingsMenu === 'device' && (
              <div className="space-y-6 max-w-2xl animate-fade-in">
                <h2 className="text-3xl font-extrabold mb-6">Device & Printer</h2>
                <div className="bg-white/5 border border-white/10 p-8 rounded-[24px] flex flex-col items-center justify-center text-center">
                   <div className={`p-6 rounded-full mb-6 ${connectedPrinter ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/40'}`}>
                      <Bluetooth size={64} />
                   </div>
                   <h3 className="text-xl font-bold mb-2">{connectedPrinter ? connectedPrinter.name : 'Belum Ada Printer Terhubung'}</h3>
                   <p className="text-sm text-white/50 mb-8 max-w-md">Menyambungkan printer Bluetooth termal memungkinkan aplikasi untuk mencetak tiket dan struk laporan langsung dari browser Anda.</p>
                   <button onClick={pairBluetooth} className="bg-white text-black font-bold px-8 py-4 rounded-2xl hover:bg-gray-200 transition-all flex items-center gap-2">
                     <Plus size={20} /> Sandingkan Perangkat Baru
                   </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {reportToPrint && (
          <div className="hidden print:block print:absolute print:inset-0 print:bg-white print:text-black print:z-[9999] p-8 font-sans">
            <div className="border-b-4 border-black pb-4 mb-6 flex justify-between items-start">
               <div>
                 <h1 className="text-4xl font-black tracking-tight">LAPORAN PENDAPATAN (CUT-OFF)</h1>
                 <p className="text-xl font-medium mt-2">Tanggal Bisnis: {reportToPrint.date}</p>
                 <p className="text-md">Lokasi Stasiun: <span className="font-bold">{currentUser?.location}</span></p>
                 <p className="text-md">Dicetak oleh: {currentUser?.name} ({currentUser?.nipkwt}) - {new Date().toLocaleString('id-ID')}</p>
               </div>
               {currentUser?.photo && (
                 <img src={currentUser.photo} alt="Foto Petugas Login" className="w-24 h-24 object-cover border-2 border-black rounded-lg shadow-sm" />
               )}
            </div>
            <div className="flex gap-10 mb-8">
               <div className="flex-1 border-2 border-black p-4 rounded-xl">
                  <p className="text-sm font-bold uppercase text-gray-500">Total Kendaraan</p>
                  <p className="text-3xl font-black">{reportToPrint.data.length} Unit</p>
               </div>
               <div className="flex-1 border-2 border-black p-4 rounded-xl bg-gray-100">
                  <p className="text-sm font-bold uppercase text-gray-500">Total Pendapatan (Rp)</p>
                  <p className="text-3xl font-black">{reportToPrint.stats.total.toLocaleString('id-ID')}</p>
               </div>
            </div>
            <h3 className="text-xl font-bold mb-4">Rincian Per Kategori</h3>
            <table className="w-full text-left border-collapse border border-gray-300 mb-8">
              <thead>
                <tr className="bg-gray-100"><th className="border border-gray-300 p-3">Kategori</th><th className="border border-gray-300 p-3">Qty</th><th className="border border-gray-300 p-3">Nominal (Rp)</th></tr>
              </thead>
              <tbody>
                <tr><td className="border border-gray-300 p-3 font-semibold">Motor / Sepeda</td><td className="border border-gray-300 p-3">{reportToPrint.stats.motorQty}</td><td className="border border-gray-300 p-3">{reportToPrint.stats.motorNom.toLocaleString('id-ID')}</td></tr>
                <tr><td className="border border-gray-300 p-3 font-semibold">Mobil</td><td className="border border-gray-300 p-3">{reportToPrint.stats.mobilQty}</td><td className="border border-gray-300 p-3">{reportToPrint.stats.mobilNom.toLocaleString('id-ID')}</td></tr>
                <tr><td className="border border-gray-300 p-3 font-semibold">Truk / Box</td><td className="border border-gray-300 p-3">{reportToPrint.stats.trukQty}</td><td className="border border-gray-300 p-3">{reportToPrint.stats.trukNom.toLocaleString('id-ID')}</td></tr>
                <tr><td className="border border-gray-300 p-3 font-semibold">Member (Gratis)</td><td className="border border-gray-300 p-3">{reportToPrint.stats.memberQty}</td><td className="border border-gray-300 p-3">0</td></tr>
              </tbody>
            </table>
            <div className="mt-10 flex justify-end">
               <div className="text-center w-64">
                 <p className="mb-4">Mengetahui,</p>
                 {currentUser?.photo && (
                   <img src={currentUser.photo} alt="Tanda Tangan/Selfie Petugas" className="w-20 h-20 object-cover rounded-full mx-auto mb-3 border border-gray-400" />
                 )}
                 <p className="font-bold border-b border-black inline-block px-4 pb-1">{currentUser?.name}</p>
                 <p className="text-sm">Petugas</p>
               </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}

// =====================================
// SUBKOMPONEN MODAL (KAMERA & PRINTER)
// =====================================
function CameraModal({ onCapture, onClose, title = "Arahkan ke Objek" }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let stream = null;
    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (err) { setError(true); }
    };
    startCamera();
    return () => { if (stream) stream.getTracks().forEach(track => track.stop()); };
  }, []);

  const takePhoto = () => {
    if (error) { onCapture('dummy_image_data'); return; }
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    // LOGIKA KOMPRESI EKSTRIM (HEMAT STORAGE & BANDWIDTH)
    if (video && canvas) {
      const MAX_WIDTH = 300; // Resize resolusi secara drastis untuk plat/selfie
      const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
      canvas.width = video.videoWidth * scale;
      canvas.height = video.videoHeight * scale;
      
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // Kompres ke format JPEG dengan kualitas 60%
      onCapture(canvas.toDataURL('image/jpeg', 0.6)); 
    }
  };

  return (
    <div className="fixed inset-0 bg-black/95 backdrop-blur-xl z-[99] flex flex-col items-center justify-center p-4 print:hidden">
      <div className="absolute top-12 text-center w-full">
         <h2 className="text-white font-bold text-xl">{title}</h2>
         <p className="text-white/50 text-sm mt-1">Pastikan wajah atau plat nomor terlihat jelas.</p>
      </div>
      <button onClick={onClose} className="absolute top-12 right-6 bg-white/20 p-3 rounded-full text-white hover:bg-white/30"><X size={28} /></button>
      <div className="w-full max-w-sm aspect-[3/4] bg-[#0A1A13] rounded-[32px] overflow-hidden relative shadow-2xl border border-white/10 mt-10">
        {!error ? <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover scale-x-[-1]" /> : (
          <div className="w-full h-full flex flex-col items-center justify-center text-white/50 p-6 text-center bg-white/5">
             <ImageIcon size={72} className="mb-4 opacity-50" />
             <p className="font-bold">Kamera Dibatasi Sistem</p>
             <p className="text-sm mt-2">Klik tombol untuk simulasi jepret foto.</p>
          </div>
        )}
        <div className="absolute inset-0 border-4 border-green-500/50 m-8 rounded-2xl pointer-events-none shadow-[inset_0_0_20px_rgba(34,197,94,0.3)]"></div>
      </div>
      <canvas ref={canvasRef} className="hidden" />
      <button onClick={takePhoto} className="mt-8 h-20 w-20 bg-white rounded-full border-4 border-transparent shadow-[0_0_0_4px_rgba(255,255,255,0.8)] active:scale-90 transition-transform flex items-center justify-center">
        <div className="w-16 h-16 bg-white rounded-full border-2 border-gray-300"></div>
      </button>
    </div>
  );
}

function PrintModal({ transaction, onComplete }) {
  const [printSuccess, setPrintSuccess] = useState(false);

  useEffect(() => {
    const connectAndPrint = async () => {
      try {
        if (!navigator.bluetooth) throw new Error("Bluetooth tidak didukung");
        await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: PRINTER_SERVICES });
        setTimeout(() => setPrintSuccess(true), 1500);
      } catch (err) { setTimeout(() => setPrintSuccess(true), 1500); }
    };
    connectAndPrint();
  }, []);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[99] flex flex-col items-center justify-center p-4 print:hidden">
      <div className="bg-[#fcfcfc] w-full max-w-[320px] rounded-t-lg shadow-2xl overflow-hidden relative drop-shadow-2xl">
        <div className="h-4 w-full bg-[radial-gradient(circle,transparent_5px,#fcfcfc_5px)] bg-[length:14px_14px] -mt-1 relative z-10"></div>
        <div className="p-6 font-mono text-center text-sm text-black">
          <h2 className="font-bold text-xl border-b-2 border-dashed border-gray-400 pb-3 mb-5">DEVICE KASIER PARKIR</h2>
          
          <p className="text-xs mb-4 border-b border-black pb-2 uppercase tracking-widest font-bold">LOKASI: {transaction.location}</p>

          {transaction.type === 'report' ? (
             <>
              <p className="mb-2 font-bold text-lg border border-black p-1">LAPORAN SHIFT</p>
              <div className="text-left text-xs space-y-2 mt-4"><p>TGL: {transaction.date}</p><p>SHIFT: {transaction.shift}</p></div>
              <div className="border-t-2 border-dashed border-gray-400 my-4 pt-4 text-left space-y-2 text-xs">
                 <div className="flex justify-between"><span>Motor:</span><span>Rp {transaction.stats.motorNom.toLocaleString('id-ID')}</span></div>
                 <div className="flex justify-between"><span>Mobil:</span><span>Rp {transaction.stats.mobilNom.toLocaleString('id-ID')}</span></div>
                 <div className="flex justify-between"><span>Box:</span><span>Rp {transaction.stats.trukNom.toLocaleString('id-ID')}</span></div>
                 <div className="flex justify-between"><span>Member:</span><span>{transaction.stats.memberQty} unit</span></div>
              </div>
              <div className="border-t-2 border-black mt-4 pt-2">
                <p className="text-xs">TOTAL STORAN</p><h2 className="text-2xl font-bold">Rp {transaction.stats.total.toLocaleString('id-ID')}</h2>
              </div>
             </>
          ) : transaction.type === 'masuk' ? (
            <>
              <p className="mb-2 text-base">TIKET MASUK ({transaction.vehicleType})</p>
              <h1 className="text-5xl font-black my-6 tracking-tighter leading-none">{transaction.plate}</h1>
              <p className="text-xs text-gray-600">JAM MASUK</p>
              <p className="font-bold text-base mt-1">{transaction.time.toLocaleDateString('id-ID')} {transaction.time.toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'})}</p>
              {transaction.isMember && <div className="mt-5 border-2 border-black p-2 text-sm font-black uppercase">Member Aktif</div>}
            </>
          ) : (
            <>
              <p className="mb-2 text-base font-bold">STRUK KELUAR ({transaction.vehicleType})</p>
              <p className="text-lg font-bold my-1 border-b border-black pb-2">Plat: {transaction.plate}</p>
              <div className="text-left mt-4 text-sm space-y-2 font-medium">
                <div className="flex justify-between"><span>Masuk:</span><span>{transaction.time.toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'})}</span></div>
                <div className="flex justify-between"><span>Keluar:</span><span>{transaction.exitTime.toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'})}</span></div>
                <div className="flex justify-between"><span>Durasi:</span><span>{transaction.durationHours} Jam</span></div>
              </div>
              <div className="border-t-2 border-dashed border-gray-400 my-5 pt-3">
                <p className="text-sm font-bold mb-2">TOTAL BAYAR</p>
                <div className="bg-black text-white py-3 px-2 rounded-lg border-2 border-black">
                  <h2 className="text-3xl font-black tracking-tight">{transaction.isMember ? 'GRATIS' : `Rp ${transaction.cost.toLocaleString('id-ID')}`}</h2>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="mt-8 bg-white/10 border border-white/20 backdrop-blur-xl p-5 rounded-3xl w-full max-w-[320px] text-center shadow-lg">
        {!printSuccess ? (
          <div className="flex items-center justify-center gap-4 text-white">
            <div className="w-6 h-6 border-4 border-green-400 border-t-transparent rounded-full animate-spin"></div>
            <p className="font-bold tracking-wide">Mencetak...</p>
          </div>
        ) : (
          <button onClick={onComplete} className="w-full bg-green-500 text-black rounded-xl py-4 font-extrabold flex justify-center gap-2 active:scale-95 transition-transform"><Check size={24} /> Selesai</button>
        )}
      </div>
    </div>
  );
}