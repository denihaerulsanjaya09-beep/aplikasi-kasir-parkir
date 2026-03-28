import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Camera, Printer, Settings, LogOut, Car, Bike, Truck, ShieldCheck, Search, X, Check, Image as ImageIcon, FileText, Send, Users, BarChart3, Moon, Bluetooth, Plus, Trash2, FileDown, MapPin, Eye, Calendar, Download, AlertTriangle, ArrowRight, ArrowLeft } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot, getDocs } from 'firebase/firestore';

// --- BUG FIX: Mencegah error "tailwind is not defined" dari environment ---
if (typeof window !== 'undefined') {
  window.tailwind = window.tailwind || {};
  window.tailwind.config = window.tailwind.config || {};
}

// =====================================
// KONFIGURASI FIREBASE (WAJIB ADA)
// =====================================
let app, auth, db;
try {
  // Konfigurasi menggunakan database resparking-v2 milik Anda
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

const DB_APP_ID = "Resparking_Production_DB"; 

// --- DATA & CONFIG DEFAULT ---
const DEFAULT_TARIFFS = {
  Motor: { type: 'progresif', first: 2000, next: 2000, max: 8000, overnight: 10000 },
  Mobil: { type: 'progresif', first: 3000, next: 3000, max: 15000, overnight: 20000 },
  Truk: { type: 'progresif', first: 5000, next: 5000, max: 25000, overnight: 100000 },
  Sepeda: { type: 'flat', first: 1000, next: 0, max: 2000, overnight: 5000 }
};

const VEHICLE_TYPES = ['Motor', 'Mobil', 'Truk', 'Sepeda'];
const LOCATIONS = ['ST. Cimahi Selatan', 'ST. Gadobangkong', 'ST. Cianjur', 'ST. Cibatu'];

const PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', 
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2', 
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000af30-0000-1000-8000-00805f9b34fb',
  '00001814-0000-1000-8000-00805f9b34fb', 
];

const DEFAULT_USERS = [
  { username: 'master', nipkwt: '200041', password: 'R3gional2BD!', role: 'Master' },
  { username: 'Kasier Pagi', nipkwt: '1014202601', password: '123', role: 'Kasier' },
  { username: 'Kasier Siang', nipkwt: '1014202602', password: '123', role: 'Kasier' },
  { username: 'Kasier Malam', nipkwt: '1014202603', password: '123', role: 'Kasier' },
  { username: 'Korlap', nipkwt: '1014202600', password: '123456', role: 'Korlap' },
  { username: 'Audit', nipkwt: '001', password: 'Audit123', role: 'Auditor' }
];

const DEFAULT_MEMBERS = [{ plate: 'B1234KWT', nip: '12345678' }];

// --- HELPER DATES ---
const getBusinessDateStr = (dateObj) => {
  const d = new Date(dateObj);
  if (d.getHours() < 6) d.setDate(d.getDate() - 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`; 
};

const parseDateStrToInput = (str) => {
   if(!str || str.length !== 8) return "";
   return `${str.substring(0,4)}-${str.substring(4,6)}-${str.substring(6,8)}`;
};

const getDatesInRange = (start, end) => {
  const arr = [];
  let dt = new Date(start);
  while (dt <= end) {
      arr.push(getBusinessDateStr(dt));
      dt.setDate(dt.getDate() + 1);
  }
  return [...new Set(arr)]; // Unique
};

// ==========================================================
// ERROR BOUNDARY (PENCEGAH BLANK PUTIH)
// ==========================================================
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("App Crashed:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0A1A13] flex flex-col items-center justify-center p-6 text-white font-sans">
          <div className="bg-[#0F2E1F] border border-red-500/50 p-8 rounded-3xl max-w-md w-full text-center shadow-2xl">
            <div className="bg-red-500/20 text-red-500 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertTriangle size={40} />
            </div>
            <h1 className="text-2xl font-bold mb-2">Terjadi Kesalahan (Crash)</h1>
            <p className="text-white/60 text-sm mb-6">Aplikasi mengalami kendala akibat data cache yang usang. Silakan reset aplikasi untuk memulihkannya.</p>
            <div className="bg-black/50 p-4 rounded-xl text-red-400 text-xs text-left overflow-auto max-h-32 mb-6 font-mono border border-red-500/20">
              {this.state.error?.toString()}
            </div>
            <button
              onClick={() => { localStorage.clear(); window.location.reload(); }}
              className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-4 rounded-xl shadow-lg transition-all"
            >
              Hapus Cache & Muat Ulang
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// =====================================
// KOMPONEN UTAMA
// =====================================
function MainApp() {
  const [fbUser, setFbUser] = useState(null);
  const [isDbReady, setIsDbReady] = useState(false);

  // BUG FIX: Gunakan Try-Catch agar tidak blank putih saat localStorage corrupt
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const savedUser = localStorage.getItem('app_currentUser');
      return savedUser ? JSON.parse(savedUser) : null;
    } catch(e) {
      localStorage.removeItem('app_currentUser');
      return null;
    }
  });
  
  const [view, setView] = useState(() => {
    try {
      return localStorage.getItem('app_currentUser') ? 'dashboard' : 'login';
    } catch (e) {
      return 'login';
    }
  }); 

  // --- STATE OPERASIONAL KASIR ---
  const [activeTab, setActiveTab] = useState('masuk'); 
  const [plateMasuk, setPlateMasuk] = useState('');
  const [vehicleTypeMasuk, setVehicleTypeMasuk] = useState('Motor');
  const [plateKeluar, setPlateKeluar] = useState('');
  
  const [shiftInfo, setShiftInfo] = useState({ name: '', time: '' });
  const shiftRef = useRef('');
  const [isShiftLocked, setIsShiftLocked] = useState(false);
  
  const [usersList, setUsersList] = useState(DEFAULT_USERS);
  const [parkedVehicles, setParkedVehicles] = useState([]);
  const [shiftTransactions, setShiftTransactions] = useState([]); 
  const [tariffs, setTariffs] = useState(DEFAULT_TARIFFS);
  const [members, setMembers] = useState(DEFAULT_MEMBERS); 
  const [runningText, setRunningText] = useState('Selamat Datang di Sistem Layanan Parkir Resparking');
  const [customLogo, setCustomLogo] = useState(null);

  const [connectedPrinter, setConnectedPrinter] = useState(null);
  const [settingsMenu, setSettingsMenu] = useState('tarif'); 
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

  // State Khusus Admin Laporan
  const [reportFilterType, setReportFilterType] = useState('cutoff'); 
  const [reportFilterShift, setReportFilterShift] = useState('Shift 1 (Pagi)');
  const [adminSelectedDate, setAdminSelectedDate] = useState(parseDateStrToInput(getBusinessDateStr(new Date())));
  const [adminReports, setAdminReports] = useState([]);
  const [isLoadingReports, setIsLoadingReports] = useState(false);

  // Mendefinisikan canAccessSettings
  const canAccessSettings = currentUser && (currentUser.role === 'Master' || currentUser.role === 'Korlap' || currentUser.role === 'Auditor');

  // ==================================================
  // EFEK 1-4: KONEKSI & FETCHING FIREBASE
  // ==================================================
  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (e) { console.error("Firebase Auth Error:", e); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (user) => { setFbUser(user); setIsDbReady(!!user); });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!fbUser || !db) return;
    const docRef = doc(db, 'artifacts', DB_APP_ID, 'public', 'data', 'globalSettings', 'users');
    const unsub = onSnapshot(docRef, (snap) => {
      if (snap.exists() && snap.data().list) setUsersList(snap.data().list);
      else setDoc(docRef, { list: DEFAULT_USERS }, { merge: true }).catch(console.error);
    }, (err) => console.error(err));
    return () => unsub();
  }, [fbUser]);

  useEffect(() => {
    if (!fbUser || !db || !currentUser?.location) return;
    const loc = currentUser.location;

    const confRef = doc(db, 'artifacts', DB_APP_ID, 'public', 'data', 'locationConfigs', loc);
    const unsubConf = onSnapshot(confRef, (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        
        const safeTariffs = { ...DEFAULT_TARIFFS };
        if (d.tariffs) {
           Object.keys(DEFAULT_TARIFFS).forEach(key => {
              safeTariffs[key] = { ...DEFAULT_TARIFFS[key], ...(d.tariffs[key] || {}) };
           });
        }
        setTariffs(safeTariffs);
        
        setMembers(d.members || DEFAULT_MEMBERS);
        setRunningText(d.runningText || 'Selamat Datang di Sistem Layanan Parkir Resparking');
        if (d.customLogo !== undefined) setCustomLogo(d.customLogo);
      } else {
        setDoc(confRef, { tariffs: DEFAULT_TARIFFS, members: DEFAULT_MEMBERS, runningText: 'Selamat Datang di Sistem Layanan Parkir Resparking', customLogo: null }, { merge: true }).catch(console.error);
      }
    }, (err) => console.error(err));

    const pvRef = collection(db, 'artifacts', DB_APP_ID, 'public', 'data', `pv_${loc}`);
    const unsubPv = onSnapshot(pvRef, (snap) => {
      const items = [];
      snap.forEach(d => {
         const data = d.data();
         items.push({ ...data, time: data.time ? new Date(data.time) : new Date() });
      });
      setParkedVehicles(items);
    }, (err) => console.error(err));

    const todayBusinessStr = getBusinessDateStr(new Date());
    const txRef = collection(db, 'artifacts', DB_APP_ID, 'public', 'data', `tx_${loc}_${todayBusinessStr}`);
    const unsubTx = onSnapshot(txRef, (snap) => {
      const items = [];
      snap.forEach(d => {
         const data = d.data();
         items.push({ ...data, time: data.time ? new Date(data.time) : new Date(), exitTime: data.exitTime ? new Date(data.exitTime) : null });
      });
      setShiftTransactions(items);
    }, (err) => console.error(err));

    return () => { unsubConf(); unsubPv(); unsubTx(); };
  }, [fbUser, currentUser?.location]);


  // ==================================================
  // LOGIKA WAKTU & SISTEM LOCKOUT SHIFT KASIR
  // ==================================================
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

      if (currentUser && currentUser.role === 'Kasier' && shiftRef.current && shiftRef.current !== shiftName) {
        setIsShiftLocked(true);
        setShowReportModal(true);
      }
      
      if(!shiftRef.current) shiftRef.current = shiftName;
    };

    updateTimeAndShift();
    const timer = setInterval(updateTimeAndShift, 10000);
    return () => clearInterval(timer);
  }, [currentUser]);

  const updateLocConfig = (partial) => {
    if (currentUser?.role !== 'Master' || !db || !fbUser || !currentUser?.location) return;
    setDoc(doc(db, 'artifacts', DB_APP_ID, 'public', 'data', 'locationConfigs', currentUser.location), partial, { merge: true }).catch(console.error);
  };

  const handleLogin = (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const user = data.get('username'), pwd = data.get('password'), nip = data.get('nipkwt'), location = data.get('location');
    if (!user || !pwd || !nip || !location) return alert("Mohon isi semua data login termasuk lokasi stasiun!");
    
    // Pencarian role login HANYA dipicu dari NIPKWT dan Password.
    const foundUser = usersList.find(u => u.nipkwt === nip && u.password === pwd);
    
    if (!foundUser) return alert("Akses Ditolak: NIPKWT atau Password tidak valid!");
    
    // Variabel "user" (kolom nama yang diketik) tetap digunakan secara bebas 
    setPendingLoginUser({ name: user, nipkwt: foundUser.nipkwt, role: foundUser.role, location });
    setShowLoginCamera(true);
  };

  const onLoginPhotoCaptured = (photoBase64) => {
    const loggedInUser = { ...pendingLoginUser, photo: photoBase64 };
    localStorage.setItem('app_currentUser', JSON.stringify(loggedInUser));
    setCurrentUser(loggedInUser); setShowLoginCamera(false); setView('dashboard');
    setPlateMasuk(''); setPlateKeluar(''); setIsShiftLocked(false); shiftRef.current = ''; setActiveTab('masuk');
  };

  const confirmLogout = () => {
    if(currentUser) localStorage.removeItem('app_currentUser');
    setCurrentUser(null); setShowReportModal(false); setView('login');
  };

  const getBusinessDate = (dateObj) => {
    if (!dateObj) return '';
    const d = new Date(dateObj);
    if (d.getHours() < 6) d.setDate(d.getDate() - 1); 
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const generateReportStats = (transactions) => {
    let stats = { motorQty: 0, motorNom: 0, mobilQty: 0, mobilNom: 0, trukQty: 0, trukNom: 0, memberQty: 0, total: 0, durUnder1: 0, dur1to3: 0, durOver3: 0 };
    transactions.forEach(t => {
      const hrs = t.durationHours || 1;
      if (hrs <= 1) stats.durUnder1++;
      else if (hrs <= 3) stats.dur1to3++;
      else stats.durOver3++;

      if (t.isMember) {
        stats.memberQty++;
      } else {
        if (t.vehicleType === 'Motor' || t.vehicleType === 'Sepeda') {
          stats.motorQty++; stats.motorNom += (t.cost || 0);
        } else if (t.vehicleType === 'Mobil') {
          stats.mobilQty++; stats.mobilNom += (t.cost || 0);
        } else if (t.vehicleType === 'Truk') {
          stats.trukQty++; stats.trukNom += (t.cost || 0);
        }
        stats.total += (t.cost || 0);
      }
    });
    return stats;
  };

  // --- TRANSAKSI KASIR (FIX: SIMPAN DATABASE OTOMATIS SAAT FOTO DIAMBIL) ---
  const saveTransactionToDB = async (transactionData, photoData) => {
    if (!db || !fbUser || !currentUser?.location || !transactionData) return;
    try {
      if (transactionData.type === 'masuk') {
        const v = { ...transactionData, photo: photoData, time: transactionData.time.toISOString() };
        await setDoc(doc(db, 'artifacts', DB_APP_ID, 'public', 'data', `pv_${currentUser.location}`, v.plate), v);
      } else if (transactionData.type === 'keluar') {
        await deleteDoc(doc(db, 'artifacts', DB_APP_ID, 'public', 'data', `pv_${currentUser.location}`, transactionData.plate));
        // Menyimpan data keluar beserta foto bukti keluarnya
        const tx = { ...transactionData, exitPhoto: photoData, time: transactionData.time.toISOString(), exitTime: transactionData.exitTime.toISOString() };
        const businessStr = getBusinessDateStr(new Date());
        await setDoc(doc(db, 'artifacts', DB_APP_ID, 'public', 'data', `tx_${currentUser.location}_${businessStr}`, `${tx.plate}_${Date.now()}`), tx);
      }
    } catch (err) {
      console.error("Error saving data:", err);
    }
  };

  const handleMasuk = () => {
    if (!plateMasuk) return alert("Masukkan Plat Nomor!");
    setCurrentTransaction({
      type: 'masuk',
      plate: plateMasuk.toUpperCase(),
      vehicleType: vehicleTypeMasuk,
      time: new Date(),
      location: currentUser?.location,
      cashier: currentUser?.name,
      shift: shiftInfo.name,
      isMember: members.some(m => m.plate === plateMasuk.toUpperCase())
    });
    setShowCamera(true);
  };

  const handleKeluar = (plateInput = plateKeluar) => {
    if (!plateInput) return alert("Masukkan Plat Nomor Keluar!");
    const vehicle = parkedVehicles.find(v => v.plate === plateInput.toUpperCase());
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

    setCurrentTransaction({ 
      ...vehicle, 
      type: 'keluar', 
      exitTime, 
      durationHours: hours, 
      cost, 
      location: currentUser?.location,
      exitCashier: currentUser?.name,
      exitShift: shiftInfo.name
    });
    setShowCamera(true);
  };

  const handleReprint = (transactionData) => {
      setCurrentTransaction(transactionData);
      setShowPrintModal(true);
  };

  const handlePrintComplete = () => {
    // Fungsi ini sekarang HANYA membersihkan UI Form. Data sudah tersimpan saat proses Kamera Selesai.
    if (currentTransaction?.type === 'masuk') setPlateMasuk('');
    else if (currentTransaction?.type === 'keluar') setPlateKeluar('');
    
    setShowPrintModal(false);
    setCurrentTransaction(null);
    setCapturedImage(null);
  };

  const pairBluetooth = async () => {
    try {
      if (!navigator.bluetooth) throw new Error("Browser ini tidak mendukung Web Bluetooth. Gunakan Chrome untuk PC/Android.");
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
      setTimeout(() => { window.print(); setTimeout(() => setReportToPrint(null), 1000); }, 500);
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
  // MODAL LAPORAN SHIFT (KASIR SPESIFIK)
  // =====================================
  const ReportModal = () => {
    const [waSent, setWaSent] = useState(false);
    const [pdfSent, setPdfSent] = useState(false);

    const myShiftTx = shiftTransactions.filter(t => 
       t.exitCashier === currentUser?.name && 
       t.exitShift === shiftInfo.name &&
       getBusinessDate(t.exitTime) === getBusinessDate(new Date())
    );
    
    const s = generateReportStats(myShiftTx);
    const dateStr = new Date().toLocaleDateString('id-ID');

    const triggerAction = (actionType) => {
      const payload = { type: 'report', title: 'LAPORAN KASIR (SHIFT)', stats: s, date: dateStr, shift: shiftInfo.name, location: currentUser?.location, cashier: currentUser?.name, role: 'Petugas Kasir', data: myShiftTx };
      
      if(actionType === 'wa') {
        setWaSent(true);
        const msg = `*LAPORAN SHIFT KASIR*\n📍 Lokasi: ${currentUser?.location}\n🗓 ${dateStr}\n👤 ${currentUser?.name} (${currentUser?.nipkwt})\n🕒 ${shiftInfo.name}\n\n*RINCIAN:*\n🏍 Motor: ${s.motorQty} (Rp ${s.motorNom.toLocaleString()})\n🚗 Mobil: ${s.mobilQty} (Rp ${s.mobilNom.toLocaleString()})\n🚚 Box: ${s.trukQty} (Rp ${s.trukNom.toLocaleString()})\n💳 Member: ${s.memberQty}\n\n*TOTAL STORAN: Rp ${s.total.toLocaleString()}*`;
        window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
      } else if (actionType === 'pdf') {
        setPdfSent(true);
        setReportToPrint(payload);
      }
    };

    const handleLogoutShift = () => {
       if (isShiftLocked && (!waSent || !pdfSent)) {
          alert("Anda wajib mengeklik tombol Kirim WA dan Cetak PDF sebelum sistem mengizinkan Logout.");
          return;
       }
       confirmLogout();
    };

    return (
      <div className={`fixed inset-0 ${isShiftLocked ? 'bg-black/95 z-[999]' : 'bg-black/90 z-50'} backdrop-blur-md flex items-center justify-center p-4 print:hidden`}>
        <div className={`bg-[#0F2E1F] border ${isShiftLocked ? 'border-red-500/50 shadow-[0_0_50px_rgba(239,68,68,0.2)]' : 'border-green-500/30 shadow-[0_0_50px_rgba(34,197,94,0.1)]'} backdrop-blur-xl rounded-[32px] w-full max-w-md p-6 text-white relative overflow-hidden`}>
          {!isShiftLocked && (
             <button onClick={() => setShowReportModal(false)} className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-red-500/80 rounded-full transition-colors"><X size={24} /></button>
          )}
          
          <div className="flex flex-col items-center mb-4 mt-2">
            {isShiftLocked ? (
               <div className="bg-red-500/20 text-red-400 p-4 rounded-full mb-4 animate-pulse"><AlertTriangle size={48} /></div>
            ) : (
               <div className="bg-orange-500/20 text-orange-400 p-4 rounded-full mb-4"><FileText size={48} /></div>
            )}
            
            <h2 className="text-2xl font-bold tracking-tight text-center">{isShiftLocked ? 'Sesi Shift Berakhir' : 'Laporan Shift Anda'}</h2>
            <p className="text-white/60 text-sm text-center mt-2 leading-relaxed">
               {isShiftLocked 
                  ? "Waktu shift habis. Anda wajib melakukan aksi cetak PDF dan mengirim WA ke Grup sebelum dapat menekan tombol Logout." 
                  : `Rincian transaksi yang diselesaikan oleh ${currentUser?.name} pada ${shiftInfo.name} hari ini.`}
            </p>
          </div>
          
          <div className="bg-black/40 rounded-2xl p-4 space-y-3 mb-6 text-sm border border-white/5">
            <div className="flex justify-between border-b border-white/10 pb-2"><span>Motor/Sepeda ({s.motorQty})</span> <span>Rp {s.motorNom.toLocaleString('id-ID')}</span></div>
            <div className="flex justify-between border-b border-white/10 pb-2"><span>Mobil ({s.mobilQty})</span> <span>Rp {s.mobilNom.toLocaleString('id-ID')}</span></div>
            <div className="flex justify-between border-b border-white/10 pb-2"><span>Box/Truk ({s.trukQty})</span> <span>Rp {s.trukNom.toLocaleString('id-ID')}</span></div>
            <div className="flex justify-between font-bold text-lg pt-2 text-green-400"><span>TOTAL STORAN:</span> <span>Rp {s.total.toLocaleString('id-ID')}</span></div>
          </div>
          
          <div className="flex gap-3 mb-4">
             <button onClick={() => triggerAction('wa')} className={`flex-1 ${waSent ? 'bg-green-700/50 text-green-300' : 'bg-green-600 hover:bg-green-500'} text-white font-bold rounded-xl py-3 shadow-lg transition-all flex justify-center items-center gap-2 text-sm`}>
               {waSent ? <Check size={18}/> : <Send size={18} />} Kirim WA
             </button>
             <button onClick={() => triggerAction('pdf')} className={`flex-1 ${pdfSent ? 'bg-blue-700/50 text-blue-300' : 'bg-blue-600 hover:bg-blue-500'} text-white font-bold rounded-xl py-3 shadow-lg transition-all flex justify-center items-center gap-2 text-sm`}>
               {pdfSent ? <Check size={18}/> : <Download size={18} />} Cetak PDF
             </button>
          </div>

          <button 
             onClick={handleLogoutShift} 
             disabled={isShiftLocked && (!waSent || !pdfSent)}
             className={`w-full font-bold rounded-xl py-4 transition-all flex justify-center items-center gap-2 text-sm ${isShiftLocked && (!waSent || !pdfSent) ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-red-600 hover:bg-red-500 text-white shadow-lg'}`}>
               <LogOut size={18} /> Akhiri Shift & Logout
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
            <p className="text-white/60 text-xs mb-3">Login Petugas Parkir</p>
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
              <input name="username" placeholder="Nama Kasir / Petugas (Bebas)" className="w-full bg-black/30 border border-white/10 rounded-xl p-4 text-[17px] outline-none focus:ring-2 focus:ring-green-500/50 transition-all placeholder:text-white/40 text-white" required />
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
  // VIEW: DASHBOARD KASIR (SIMPLE UI ARROWS)
  // =====================================
  if (view === 'dashboard') {
    return (
      <div className="min-h-screen bg-[#0A1A13] font-sans text-white pb-10 selection:bg-green-500/30 print:hidden flex flex-col">
        <div className="bg-[#0F2E1F]/80 backdrop-blur-xl pt-6 pb-4 px-6 sticky top-0 z-10 border-b border-white/10 shadow-lg">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-2">
            <div className="flex items-center gap-4">
              {currentUser?.photo ? (
                <img src={currentUser.photo} alt="User" className="w-14 h-14 rounded-full border-2 border-green-500 object-cover shadow-lg" />
              ) : (
                <div className="w-14 h-14 rounded-full border-2 border-green-500 flex items-center justify-center bg-black/50">
                  <Users size={24} className="text-green-500" />
                </div>
              )}
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-green-50">{currentUser?.name} <span className="text-xs font-normal text-white/50 bg-black/30 px-2 py-0.5 rounded-md ml-2">{currentUser?.nipkwt}</span></h1>
                <div className="flex items-center gap-2 mt-1 text-sm text-green-400/80 font-medium">
                  <MapPin size={16} /> {currentUser?.location} <span className="text-white/30">|</span> {shiftInfo.name} <span className="text-white/30">|</span> {shiftInfo.time}
                </div>
              </div>
            </div>
            
            <div className="flex flex-wrap gap-2 md:gap-3 w-full md:w-auto">
              {currentUser?.role === 'Kasier' && (
                <button onClick={() => setShowReportModal(true)} className="flex-1 md:flex-none px-4 py-2.5 bg-orange-500/20 text-orange-400 border border-orange-500/50 rounded-xl text-sm font-bold hover:bg-orange-500/30 transition-colors flex items-center justify-center gap-2 shadow-lg">
                  <FileText size={18}/> Laporan Kasir
                </button>
              )}
              {canAccessSettings && (
                <button onClick={() => setView('settings')} className="p-2.5 bg-white/10 border border-white/10 rounded-xl text-white hover:bg-white/20 transition-colors flex justify-center items-center shadow-lg">
                  <Settings size={20} />
                </button>
              )}
              <button onClick={() => { currentUser?.role === 'Kasier' ? setShowReportModal(true) : confirmLogout() }} className="p-2.5 bg-red-500/20 border border-red-500/30 rounded-xl text-red-400 hover:bg-red-500/40 transition-colors flex justify-center items-center shadow-lg">
                <LogOut size={20} />
              </button>
            </div>
          </div>
          
          <div className="w-full bg-black py-1.5 overflow-hidden relative shadow-inner border-y border-red-500/20 mt-4 rounded-md">
            <marquee scrollamount="8" className="text-red-500 text-[11px] font-bold tracking-widest uppercase">
              {runningText}
            </marquee>
          </div>
        </div>

        {/* UI SIMPLE TRANSAKSI */}
        <div className="p-4 mt-2 max-w-xl mx-auto w-full flex-1 flex flex-col">
          
          <div className="flex gap-2 mb-6">
              <button onClick={() => setActiveTab('masuk')} className={`flex-1 py-4 rounded-2xl font-black text-sm md:text-lg flex items-center justify-center gap-1 md:gap-2 transition-all ${activeTab === 'masuk' ? 'bg-green-500 text-black shadow-[0_0_20px_rgba(34,197,94,0.4)]' : 'bg-black/40 text-white/50 border border-white/10 hover:bg-white/10'}`}>
                  <ArrowRight size={20} /> MASUK
              </button>
              <button onClick={() => setActiveTab('keluar')} className={`flex-1 py-4 rounded-2xl font-black text-sm md:text-lg flex items-center justify-center gap-1 md:gap-2 transition-all ${activeTab === 'keluar' ? 'bg-red-500 text-white shadow-[0_0_20px_rgba(239,68,68,0.4)]' : 'bg-black/40 text-white/50 border border-white/10 hover:bg-white/10'}`}>
                  <ArrowLeft size={20} /> KELUAR
              </button>
              <button onClick={() => setActiveTab('riwayat')} className={`flex-1 py-4 rounded-2xl font-black text-sm md:text-lg flex items-center justify-center gap-1 md:gap-2 transition-all ${activeTab === 'riwayat' ? 'bg-blue-500 text-white shadow-[0_0_20px_rgba(59,130,246,0.4)]' : 'bg-black/40 text-white/50 border border-white/10 hover:bg-white/10'}`}>
                  <FileText size={20} /> RIWAYAT
              </button>
          </div>

          {activeTab === 'masuk' && (
            <div className="bg-gradient-to-br from-white/5 to-transparent border border-white/10 backdrop-blur-lg rounded-[32px] p-6 shadow-2xl flex flex-col relative overflow-hidden flex-1 animate-fade-in">
              <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none"><Car size={200}/></div>
              
              <div className="flex-1 space-y-6 z-10">
                <div>
                  <label className="text-xs font-bold text-white/50 uppercase tracking-widest pl-1 mb-2 block">Ketik Plat Nomor Masuk</label>
                  <input value={plateMasuk} onChange={e => setPlateMasuk(e.target.value.toUpperCase())} placeholder="D 1234 XY" className="w-full bg-black/50 border border-green-500/30 rounded-2xl p-5 text-4xl font-black text-center text-white uppercase tracking-[0.2em] outline-none focus:ring-2 focus:ring-green-500 transition-all placeholder:text-white/10 shadow-inner" />
                </div>
                
                <div>
                  <label className="text-xs font-bold text-white/50 uppercase tracking-widest pl-1 mb-3 block">Kategori Kendaraan</label>
                  <div className="grid grid-cols-2 gap-3">
                    {VEHICLE_TYPES.map(type => (
                      <button key={type} onClick={() => setVehicleTypeMasuk(type)} className={`flex flex-col items-center justify-center py-5 rounded-2xl border transition-all ${vehicleTypeMasuk === type ? 'border-green-400 bg-green-500/20 text-green-300 shadow-[0_0_15px_rgba(34,197,94,0.2)]' : 'border-white/10 bg-black/30 text-white/50 hover:bg-white/5'}`}>
                        {type === 'Motor' && <Bike size={32} className="mb-2"/>}
                        {type === 'Mobil' && <Car size={32} className="mb-2"/>}
                        {type === 'Truk' && <Truck size={32} className="mb-2"/>}
                        {type === 'Sepeda' && <Bike size={32} className="mb-2"/>}
                        <span className="text-sm font-bold">{type}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button onClick={handleMasuk} disabled={currentUser?.role !== 'Kasier'} className={`w-full rounded-2xl py-5 text-xl font-extrabold mt-6 transition-all flex items-center justify-center gap-2 ${currentUser?.role === 'Kasier' ? 'bg-green-500 text-black hover:bg-green-400 active:scale-[0.98] shadow-[0_0_20px_rgba(34,197,94,0.3)]' : 'bg-gray-600 text-gray-400 cursor-not-allowed opacity-50'}`}>
                <Camera size={24} /> FOTO & CETAK TIKET
              </button>
            </div>
          )}

          {activeTab === 'keluar' && (
            <div className="bg-gradient-to-bl from-white/5 to-transparent border border-white/10 backdrop-blur-lg rounded-[32px] p-6 shadow-2xl flex flex-col relative overflow-hidden flex-1 animate-fade-in">
               <div className="absolute top-0 left-0 p-6 opacity-5 pointer-events-none"><LogOut size={200}/></div>
               
               <div className="flex-1 flex flex-col z-10">
                  <div>
                    <label className="text-xs font-bold text-white/50 uppercase tracking-widest pl-1 mb-2 block">Cari / Scan Plat Keluar</label>
                    <div className="relative">
                      <Search className="absolute left-5 top-5 text-white/40" size={26} />
                      <input value={plateKeluar} onChange={e => setPlateKeluar(e.target.value.toUpperCase())} placeholder="D 12..." className="w-full bg-black/50 border border-red-500/30 rounded-2xl p-5 pl-14 text-3xl font-black text-white uppercase tracking-widest outline-none focus:ring-2 focus:ring-red-500 transition-all placeholder:text-white/10 shadow-inner" />
                    </div>
                  </div>

                  <div className="mt-4 bg-black/30 rounded-2xl p-3 flex-1 overflow-y-auto border border-white/5 min-h-[150px] space-y-2">
                    {parkedVehicles.filter(v => v.plate.includes(plateKeluar) && plateKeluar !== '').map((v, i) => (
                      <div key={i} onClick={() => setPlateKeluar(v.plate)} className="bg-white/10 p-4 rounded-xl flex justify-between items-center cursor-pointer hover:bg-white/20 border border-white/5 transition-colors group">
                        <span className="font-bold text-xl md:text-2xl tracking-wider">{v.plate}</span>
                        <div className="flex items-center gap-2">
                           <span className="text-xs font-bold bg-white/20 text-white px-3 py-1.5 rounded-lg">{v.vehicleType}</span>
                           <button onClick={(e) => { e.stopPropagation(); handleReprint({...v, type: 'masuk'}); }} className="bg-blue-500 text-white p-2 rounded-lg font-bold opacity-0 group-hover:opacity-100 transition-opacity shadow-lg" title="Cetak Ulang Tiket Masuk"><Printer size={18}/></button>
                           <button onClick={(e) => { e.stopPropagation(); handleKeluar(v.plate); }} className="bg-red-500 text-white px-3 py-2 rounded-lg font-bold opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2 shadow-lg"><Printer size={16}/><span className="hidden md:inline">Selesaikan</span></button>
                        </div>
                      </div>
                    ))}
                    {plateKeluar === '' && <p className="text-center text-white/30 text-sm mt-10 font-bold tracking-widest">Ketik Plat Untuk Mencari Data</p>}
                    {plateKeluar !== '' && parkedVehicles.filter(v => v.plate.includes(plateKeluar)).length === 0 && <p className="text-center text-red-400/50 text-sm mt-10 font-bold">Data Kendaraan Tidak Ditemukan</p>}
                  </div>

                  {parkedVehicles.find(v => v.plate === plateKeluar) && (
                    <div className="mt-4 bg-black/40 p-4 rounded-2xl border border-white/10 text-center flex flex-col md:flex-row items-center gap-4 animate-fade-in shadow-xl">
                      {parkedVehicles.find(v => v.plate === plateKeluar).photo ? (
                        <img src={parkedVehicles.find(v => v.plate === plateKeluar).photo} alt="Foto Masuk" className="w-full md:w-48 h-32 object-cover rounded-xl border border-white/20 shadow-lg shrink-0" />
                      ) : (
                        <div className="w-full md:w-48 h-32 flex flex-col items-center justify-center bg-white/5 rounded-xl border border-white/20 text-white/30 shrink-0">
                          <ImageIcon size={32} className="mb-2" />
                          <span className="text-[10px] font-bold">TIDAK ADA FOTO</span>
                        </div>
                      )}
                      <div className="flex-1 text-left w-full">
                         <p className="text-xs text-white/50 font-bold mb-1 uppercase tracking-wider">Rincian Terpilih</p>
                         <h3 className="text-3xl font-black tracking-widest">{plateKeluar}</h3>
                         <p className="text-sm font-bold text-white/70 mt-1">{parkedVehicles.find(v => v.plate === plateKeluar).vehicleType} • Masuk: {parkedVehicles.find(v => v.plate === plateKeluar).time.toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'})}</p>
                      </div>
                    </div>
                  )}
               </div>

               <button onClick={() => handleKeluar()} disabled={currentUser?.role !== 'Kasier'} className={`w-full rounded-2xl py-5 text-xl font-extrabold mt-6 transition-all flex items-center justify-center gap-2 ${currentUser?.role === 'Kasier' ? 'bg-red-500/90 text-white hover:bg-red-400 active:scale-[0.98] shadow-[0_0_20px_rgba(239,68,68,0.3)]' : 'bg-gray-600 text-gray-400 cursor-not-allowed opacity-50'}`}>
                 <Printer size={24} /> SELESAIKAN & CETAK
               </button>
            </div>
          )}

          {activeTab === 'riwayat' && (
            <div className="bg-gradient-to-b from-white/5 to-transparent border border-white/10 backdrop-blur-lg rounded-[32px] p-6 shadow-2xl flex flex-col relative overflow-hidden flex-1 animate-fade-in">
               <div className="flex justify-between items-center mb-6">
                 <h3 className="text-xl font-bold tracking-tight">Kendaraan di Area Parkir (Aktif)</h3>
                 <span className="bg-blue-500/20 text-blue-300 px-3 py-1 rounded-lg text-sm font-bold">{parkedVehicles.length} Unit</span>
               </div>
               
               <div className="flex-1 overflow-y-auto space-y-3 bg-black/20 p-2 rounded-2xl border border-white/5">
                  {parkedVehicles.sort((a,b) => b.time - a.time).map((v, i) => (
                     <div key={i} className="bg-white/10 p-4 rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border border-white/5 hover:bg-white/20 transition-colors">
                        <div className="flex items-center gap-4">
                           {v.photo ? (
                              <img src={v.photo} alt="Foto" className="w-16 h-12 object-cover rounded-md border border-white/20 shrink-0" />
                           ) : (
                              <div className="w-16 h-12 bg-black/50 rounded-md border border-white/20 flex items-center justify-center text-white/30 shrink-0"><Car size={20}/></div>
                           )}
                           <div>
                              <p className="font-bold text-xl tracking-wider">{v.plate}</p>
                              <p className="text-xs text-white/50 mt-1">{v.vehicleType} • Masuk: {v.time.toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'})}</p>
                           </div>
                        </div>
                        <div className="flex gap-2 w-full md:w-auto">
                           <button onClick={() => handleReprint({...v, type: 'masuk'})} className="flex-1 md:flex-none justify-center bg-blue-500/20 hover:bg-blue-500/40 text-blue-300 p-2 md:px-3 md:py-2 rounded-xl flex items-center gap-2 transition-colors" title="Cetak Ulang Tiket Masuk">
                              <Printer size={18}/> <span className="font-bold text-sm">Cetak</span>
                           </button>
                           <button onClick={() => { setActiveTab('keluar'); setPlateKeluar(v.plate); }} className="flex-1 md:flex-none justify-center bg-red-500/20 hover:bg-red-500/40 text-red-300 p-2 md:px-3 md:py-2 rounded-xl flex items-center gap-2 transition-colors" title="Selesaikan / Keluar">
                              <ArrowLeft size={18}/> <span className="font-bold text-sm">Keluar</span>
                           </button>
                        </div>
                     </div>
                  ))}
                  {parkedVehicles.length === 0 && <p className="text-center text-white/40 mt-10 font-bold tracking-widest text-sm">Area parkir kosong.</p>}
               </div>
            </div>
          )}

        </div>

        {showCamera && <CameraModal onCapture={v => { 
            setCapturedImage(v); 
            setShowCamera(false); 
            saveTransactionToDB(currentTransaction, v); // SIMPAN KE DB SEBELUM MODAL CETAK TAMPIL
            setShowPrintModal(true); 
          }} onClose={() => setShowCamera(false)} />}
          
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

    const fetchAdminReports = async () => {
      setIsLoadingReports(true);
      try {
         let datesToFetch = [];
         
         if (reportFilterType === 'cutoff' || reportFilterType === 'shift') {
             datesToFetch = [adminSelectedDate.replace(/-/g, '')];
         } else if (reportFilterType === 'bulan') {
             const [yy, mm] = adminSelectedDate.split('-');
             if(yy && mm) {
                 const start = new Date(parseInt(yy), parseInt(mm)-1, 1);
                 const end = new Date(parseInt(yy), parseInt(mm), 0);
                 datesToFetch = getDatesInRange(start, end);
             }
         } else if (reportFilterType === 'tahun') {
             const yy = adminSelectedDate;
             if(yy) {
                 const start = new Date(parseInt(yy), 0, 1);
                 const end = new Date(parseInt(yy), 11, 31);
                 datesToFetch = getDatesInRange(start, end);
             }
         }

         let allData = [];
         const chunkSize = 30; // Batch fetching to stay within limits
         for(let i=0; i<datesToFetch.length; i+=chunkSize){
             const chunk = datesToFetch.slice(i, i+chunkSize);
             const promises = chunk.map(d => getDocs(collection(db, 'artifacts', DB_APP_ID, 'public', 'data', `tx_${currentUser.location}_${d}`)));
             const snaps = await Promise.all(promises);
             snaps.forEach(snap => {
                 snap.forEach(doc => {
                     const data = doc.data();
                     allData.push({ ...data, time: data.time ? new Date(data.time) : new Date(), exitTime: data.exitTime ? new Date(data.exitTime) : null });
                 });
             });
         }

         if (reportFilterType === 'shift') {
             allData = allData.filter(d => d.exitShift === reportFilterShift);
         }

         setAdminReports(allData);
      } catch(e) { console.error("Error fetch historical data:", e); }
      setIsLoadingReports(false);
    };

    const generatePDFReport = () => {
       const s = generateReportStats(adminReports);
       let title = `LAPORAN PENDAPATAN (${reportFilterType.toUpperCase()})`;
       let sub = adminSelectedDate;
       if(reportFilterType==='shift') sub = `${adminSelectedDate} | ${reportFilterShift}`;
       // Menyertakan nama user dan jabatannya dalam parameter laporan untuk di cetak
       setReportToPrint({ type: 'report', title, date: sub, stats: s, data: adminReports, location: currentUser?.location, cashier: currentUser?.name, role: currentUser?.role });
    };

    const exportWALaporan = () => {
       const s = generateReportStats(adminReports);
       let sub = adminSelectedDate;
       if(reportFilterType==='shift') sub = `${adminSelectedDate} | ${reportFilterShift}`;
       const msg = `*REKAP PENDAPATAN (${reportFilterType.toUpperCase()})*\n📍 Lokasi: ${currentUser?.location}\n🗓 Periode: ${sub}\n\n*RINCIAN:*\n🏍 Motor: ${s.motorQty} (Rp ${s.motorNom.toLocaleString()})\n🚗 Mobil: ${s.mobilQty} (Rp ${s.mobilNom.toLocaleString()})\n🚚 Box: ${s.trukQty} (Rp ${s.trukNom.toLocaleString()})\n💳 Member: ${s.memberQty}\n\n*TOTAL: Rp ${s.total.toLocaleString()}*`;
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
              <h1 className="text-2xl font-bold tracking-tight text-green-400">Panel Admin & Laporan</h1>
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
                  {VEHICLE_TYPES.map(type => {
                    const t = tariffs[type] || DEFAULT_TARIFFS[type]; // Cegah undefined jika kategori baru ditambahkan
                    return (
                    <div key={type} className={`bg-white/5 border border-white/10 p-6 rounded-[24px] ${!isEditor && 'opacity-70 pointer-events-none'}`}>
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xl font-bold text-green-300">Tarif {type}</h3>
                        <div className="flex bg-black/50 rounded-full p-1 cursor-pointer">
                          <button onClick={() => { if (!isEditor) return; const newTariffs = {...tariffs, [type]: {...t, type: 'progresif'}}; setTariffs(newTariffs); updateLocConfig({ tariffs: newTariffs }); }} className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${t.type !== 'flat' ? 'bg-green-500 text-black shadow-md' : 'text-white/50 hover:text-white'}`} disabled={!isEditor}>Progresif</button>
                          <button onClick={() => { if (!isEditor) return; const newTariffs = {...tariffs, [type]: {...t, type: 'flat'}}; setTariffs(newTariffs); updateLocConfig({ tariffs: newTariffs }); }} className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${t.type === 'flat' ? 'bg-green-500 text-black shadow-md' : 'text-white/50 hover:text-white'}`} disabled={!isEditor}>Flat</button>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div className="flex justify-between items-center gap-4">
                          <label className="text-sm text-white/60 w-1/3">Tarif Awal</label>
                          <input type="number" value={t.first} onChange={(e) => { const newTariffs = {...tariffs, [type]: {...t, first: parseInt(e.target.value)}}; setTariffs(newTariffs); updateLocConfig({ tariffs: newTariffs }); }} readOnly={!isEditor} className={`flex-1 bg-black/40 border border-white/10 p-3 rounded-xl outline-none focus:ring-1 focus:ring-green-500 text-white ${!isEditor && 'bg-black/10'}`} />
                        </div>
                        <div className={`flex justify-between items-center gap-4 transition-opacity ${t.type === 'flat' ? 'opacity-30 pointer-events-none' : ''}`}>
                          <label className="text-sm text-white/60 w-1/3">Jam Berikutnya</label>
                          <input type="number" value={t.next} onChange={(e) => { const newTariffs = {...tariffs, [type]: {...t, next: parseInt(e.target.value)}}; setTariffs(newTariffs); updateLocConfig({ tariffs: newTariffs }); }} readOnly={!isEditor} className={`flex-1 bg-black/40 border border-white/10 p-3 rounded-xl outline-none focus:ring-1 focus:ring-green-500 text-white ${!isEditor && 'bg-black/10'}`} />
                        </div>
                        <div className={`flex justify-between items-center gap-4 transition-opacity ${t.type === 'flat' ? 'opacity-30 pointer-events-none' : ''}`}>
                          <label className="text-sm text-white/60 w-1/3">Maksimal / Hari</label>
                          <input type="number" value={t.max} onChange={(e) => { const newTariffs = {...tariffs, [type]: {...t, max: parseInt(e.target.value)}}; setTariffs(newTariffs); updateLocConfig({ tariffs: newTariffs }); }} readOnly={!isEditor} className={`flex-1 bg-black/40 border border-white/10 p-3 rounded-xl outline-none focus:ring-1 focus:ring-green-500 text-white ${!isEditor && 'bg-black/10'}`} />
                        </div>
                        <div className="flex justify-between items-center gap-4">
                          <label className="text-sm text-white/60 w-1/3">Tarif Menginap</label>
                          <input type="number" value={t.overnight} onChange={(e) => { const newTariffs = {...tariffs, [type]: {...t, overnight: parseInt(e.target.value)}}; setTariffs(newTariffs); updateLocConfig({ tariffs: newTariffs }); }} readOnly={!isEditor} className={`flex-1 bg-black/40 border border-white/10 p-3 rounded-xl outline-none focus:ring-1 focus:ring-green-500 text-white ${!isEditor && 'bg-black/10'}`} />
                        </div>
                      </div>
                    </div>
                  )})}
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
                    <div className="md:col-span-1"><label className="text-xs text-white/60 mb-1 block">Username Default</label><input required value={newUser.username} onChange={e=>setNewUser({...newUser, username: e.target.value})} className="w-full bg-black/40 border border-white/10 p-3 rounded-xl outline-none focus:ring-1 focus:ring-green-500 text-white" /></div>
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
                    <thead className="bg-black/40"><tr><th className="p-4">Username Label</th><th className="p-4">NIPKWT (ID)</th><th className="p-4">Role</th>{isEditor && <th className="p-4 text-center">Aksi</th>}</tr></thead>
                    <tbody>
                      {usersList.map((u, i) => (
                        <tr key={i} className="border-t border-white/5 hover:bg-white/5 transition-colors">
                          <td className="p-4 font-bold">{u.username}</td><td className="p-4">{u.nipkwt}</td>
                          <td className="p-4">
                            <span className={`px-2 py-1 rounded-md text-xs font-bold ${u.role==='Master'?'bg-orange-500/20 text-orange-400':u.role==='Auditor'?'bg-purple-500/20 text-purple-400':u.role==='Korlap'?'bg-blue-500/20 text-blue-400':'bg-green-500/20 text-green-400'}`}>{(u.role || 'KASIER').toUpperCase()}</span>
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
                <h2 className="text-3xl font-extrabold mb-2">Laporan Pendapatan Lanjutan</h2>
                <p className="text-white/50 text-sm mb-6">Filter riwayat transaksi secara spesifik. Aplikasi akan otomatis menarik seluruh data berdasarkan rentang filter secara cerdas.</p>
                
                <div className="bg-white/5 border border-white/10 p-6 rounded-[24px]">
                   <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                      <div>
                         <label className="text-xs font-bold text-white/50 uppercase tracking-widest pl-1 mb-2 block">Filter Data</label>
                         <select value={reportFilterType} onChange={e => {
                             setReportFilterType(e.target.value);
                             if(e.target.value === 'bulan') setAdminSelectedDate(new Date().toISOString().substring(0,7));
                             else if(e.target.value === 'tahun') setAdminSelectedDate(new Date().getFullYear().toString());
                             else setAdminSelectedDate(parseDateStrToInput(getBusinessDateStr(new Date())));
                         }} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 outline-none focus:ring-1 focus:ring-green-500 text-white [&>option]:text-black">
                             <option value="cutoff">Per Hari (Cut-Off)</option>
                             <option value="shift">Per Shift</option>
                             <option value="bulan">Per Bulan</option>
                             <option value="tahun">Per Tahun</option>
                         </select>
                      </div>

                      {reportFilterType === 'shift' && (
                          <div>
                            <label className="text-xs font-bold text-white/50 uppercase tracking-widest pl-1 mb-2 block">Pilih Shift</label>
                            <select value={reportFilterShift} onChange={e => setReportFilterShift(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 outline-none focus:ring-1 focus:ring-green-500 text-white [&>option]:text-black">
                                <option>Shift 1 (Pagi)</option>
                                <option>Shift 2 (Siang)</option>
                                <option>Shift 3 (Malam)</option>
                            </select>
                          </div>
                      )}

                      <div className={reportFilterType !== 'shift' ? 'md:col-span-2' : ''}>
                         <label className="text-xs font-bold text-white/50 uppercase tracking-widest pl-1 mb-2 block">Tentukan Periode</label>
                         <div className="flex flex-col md:flex-row gap-3">
                             {reportFilterType === 'bulan' ? (
                                <input type="month" value={adminSelectedDate} onChange={e => setAdminSelectedDate(e.target.value)} className="flex-1 w-full bg-black/40 border border-white/10 rounded-xl p-3 outline-none focus:ring-1 focus:ring-green-500 text-white" />
                             ) : reportFilterType === 'tahun' ? (
                                <input type="number" value={adminSelectedDate} min="2020" max="2100" onChange={e => setAdminSelectedDate(e.target.value)} className="flex-1 w-full bg-black/40 border border-white/10 rounded-xl p-3 outline-none focus:ring-1 focus:ring-green-500 text-white" placeholder="YYYY" />
                             ) : (
                                <input type="date" value={adminSelectedDate} onChange={e => setAdminSelectedDate(e.target.value)} className="flex-1 w-full bg-black/40 border border-white/10 rounded-xl p-3 outline-none focus:ring-1 focus:ring-green-500 text-white" />
                             )}
                             <button className="w-full md:w-auto bg-green-500 text-black font-bold px-6 py-3 rounded-xl hover:bg-green-400 shadow-lg" onClick={fetchAdminReports}>Tarik Data</button>
                         </div>
                      </div>
                   </div>

                   {isLoadingReports ? (
                      <div className="py-10 text-center flex flex-col items-center text-white/40"><div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin mb-4"></div>Mengunduh & Merekap Data Transaksi...</div>
                   ) : adminReports.length === 0 ? (
                      <div className="py-10 text-center text-white/40 border-t border-white/5">Klik tombol Tarik Data untuk menampilkan laporan.</div>
                   ) : (
                      <div className="border-t border-white/10 pt-6 animate-fade-in">
                         <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                           <h3 className="text-xl font-bold text-green-400">Total Transaksi: {adminReports.length} Data</h3>
                           <div className="flex gap-2 w-full md:w-auto">
                              <button onClick={() => exportWALaporan()} className="flex-1 md:flex-none flex justify-center items-center gap-2 bg-green-500/20 text-green-400 px-4 py-2 rounded-xl text-sm font-bold hover:bg-green-500/30 transition-colors"><Send size={16}/> Kirim WA</button>
                              <button onClick={() => generatePDFReport()} className="flex-1 md:flex-none flex justify-center items-center gap-2 bg-blue-500/20 text-blue-400 px-4 py-2 rounded-xl text-sm font-bold hover:bg-blue-500/30 transition-colors"><FileDown size={16}/> Laporan PDF</button>
                           </div>
                         </div>
                         <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {(() => {
                               const stats = generateReportStats(adminReports);
                               const totalP = adminReports.length;
                               const pUnder1 = totalP ? Math.round((stats.durUnder1 / totalP) * 100) : 0;
                               const p1to3 = totalP ? Math.round((stats.dur1to3 / totalP) * 100) : 0;
                               const pOver3 = totalP ? Math.round((stats.durOver3 / totalP) * 100) : 0;

                               return (
                                 <>
                                  <div className="bg-black/30 p-4 rounded-xl"><p className="text-xs text-white/50">Total Motor</p><p className="text-xl font-bold mt-1">Rp {stats.motorNom.toLocaleString()}</p></div>
                                  <div className="bg-black/30 p-4 rounded-xl"><p className="text-xs text-white/50">Total Mobil/Box</p><p className="text-xl font-bold mt-1">Rp {(stats.mobilNom + stats.trukNom).toLocaleString()}</p></div>
                                  <div className="bg-black/30 p-4 rounded-xl"><p className="text-xs text-white/50">Member Gratis</p><p className="text-xl font-bold mt-1">{stats.memberQty} Unit</p></div>
                                  <div className="bg-green-500/10 p-4 rounded-xl border border-green-500/30"><p className="text-xs text-green-400/80">Total Pendapatan</p><p className="text-2xl font-bold text-green-400 mt-1">Rp {stats.total.toLocaleString()}</p></div>

                                  <div className="bg-black/30 p-5 rounded-xl col-span-2 md:col-span-4 mt-2">
                                     <h4 className="font-bold text-white/80 mb-4 border-b border-white/10 pb-2">Lama Parkir (Durasi Menginap)</h4>
                                     <div className="flex flex-col md:flex-row gap-6">
                                        <div className="flex-1">
                                           <div className="flex justify-between text-xs text-white/60 mb-1"><span>&lt; 1 Jam ({stats.durUnder1} unit)</span><span className="font-bold text-green-400">{pUnder1}%</span></div>
                                           <div className="w-full bg-white/10 h-2.5 rounded-full overflow-hidden"><div className="bg-green-500 h-full transition-all" style={{width: `${pUnder1}%`}}></div></div>
                                        </div>
                                        <div className="flex-1">
                                           <div className="flex justify-between text-xs text-white/60 mb-1"><span>1 - 3 Jam ({stats.dur1to3} unit)</span><span className="font-bold text-blue-400">{p1to3}%</span></div>
                                           <div className="w-full bg-white/10 h-2.5 rounded-full overflow-hidden"><div className="bg-blue-500 h-full transition-all" style={{width: `${p1to3}%`}}></div></div>
                                        </div>
                                        <div className="flex-1">
                                           <div className="flex justify-between text-xs text-white/60 mb-1"><span>&gt; 3 Jam ({stats.durOver3} unit)</span><span className="font-bold text-red-400">{pOver3}%</span></div>
                                           <div className="w-full bg-white/10 h-2.5 rounded-full overflow-hidden"><div className="bg-red-500 h-full transition-all" style={{width: `${pOver3}%`}}></div></div>
                                        </div>
                                     </div>
                                  </div>
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
                 <h1 className="text-4xl font-black tracking-tight">{reportToPrint.title || "LAPORAN PENDAPATAN"}</h1>
                 <p className="text-xl font-medium mt-2">Periode Data: {reportToPrint.date}</p>
                 <p className="text-md">Lokasi Stasiun: <span className="font-bold">{reportToPrint.location}</span></p>
                 {reportToPrint.shift && <p className="text-md font-bold uppercase">Shift Kerja: {reportToPrint.shift}</p>}
                 <p className="text-md">Dicetak pada: {new Date().toLocaleString('id-ID')}</p>
               </div>
               {currentUser?.photo && (
                 <div className="text-center">
                   <img src={currentUser.photo} alt="Foto Petugas Login" className="w-24 h-24 object-cover border-2 border-black rounded-lg shadow-sm mx-auto mb-1" />
                   <p className="text-xs font-bold uppercase">{currentUser?.name}</p>
                 </div>
               )}
            </div>
            
            <div className="flex gap-10 mb-8">
               <div className="flex-1 border-2 border-black p-4 rounded-xl">
                  <p className="text-sm font-bold uppercase text-gray-500">Total Kendaraan</p>
                  <p className="text-3xl font-black">{reportToPrint.data.length} Unit</p>
               </div>
               <div className="flex-1 border-2 border-black p-4 rounded-xl bg-gray-100">
                  <p className="text-sm font-bold uppercase text-gray-500">Total Setoran Kasir (Rp)</p>
                  <p className="text-3xl font-black">{reportToPrint.stats.total.toLocaleString('id-ID')}</p>
               </div>
            </div>

            <h3 className="text-xl font-bold mb-4">Rincian Pendapatan Per Kategori</h3>
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

            <h3 className="text-xl font-bold mb-4">Statistik Lama Parkir (Durasi)</h3>
            <table className="w-full text-left border-collapse border border-gray-300 mb-8">
              <thead>
                 <tr className="bg-gray-100"><th className="border border-gray-300 p-3">Durasi</th><th className="border border-gray-300 p-3">Qty</th><th className="border border-gray-300 p-3">Persentase (%)</th></tr>
              </thead>
              <tbody>
                 <tr><td className="border border-gray-300 p-3 font-semibold">&lt; 1 Jam</td><td className="border border-gray-300 p-3">{reportToPrint.stats.durUnder1}</td><td className="border border-gray-300 p-3">{reportToPrint.data.length ? Math.round((reportToPrint.stats.durUnder1 / reportToPrint.data.length) * 100) : 0}%</td></tr>
                 <tr><td className="border border-gray-300 p-3 font-semibold">1 - 3 Jam</td><td className="border border-gray-300 p-3">{reportToPrint.stats.dur1to3}</td><td className="border border-gray-300 p-3">{reportToPrint.data.length ? Math.round((reportToPrint.stats.dur1to3 / reportToPrint.data.length) * 100) : 0}%</td></tr>
                 <tr><td className="border border-gray-300 p-3 font-semibold">&gt; 3 Jam</td><td className="border border-gray-300 p-3">{reportToPrint.stats.durOver3}</td><td className="border border-gray-300 p-3">{reportToPrint.data.length ? Math.round((reportToPrint.stats.durOver3 / reportToPrint.data.length) * 100) : 0}%</td></tr>
              </tbody>
            </table>

            <div className="mt-10 flex justify-end">
               <div className="text-center w-64">
                 <p className="mb-4">Dinyatakan & Diverifikasi Oleh,</p>
                 {currentUser?.photo && (
                   <img src={currentUser.photo} alt="Tanda Tangan/Selfie Petugas" className="w-24 h-24 object-cover rounded-full mx-auto mb-3 border-2 border-gray-400" />
                 )}
                 <p className="font-bold border-b border-black inline-block px-4 pb-1">{reportToPrint.cashier || currentUser?.name}</p>
                 <p className="text-sm mt-1">{reportToPrint.role || currentUser?.role}</p>
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
    if (video && canvas) {
      const MAX_WIDTH = 300; 
      const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
      canvas.width = video.videoWidth * scale;
      canvas.height = video.videoHeight * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
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

          {transaction.type === 'masuk' ? (
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
          <div className="flex flex-col items-center justify-center gap-4 text-white">
            <div className="flex items-center gap-4">
              <div className="w-6 h-6 border-4 border-green-400 border-t-transparent rounded-full animate-spin"></div>
              <p className="font-bold tracking-wide">Mencetak...</p>
            </div>
            {/* Trik Fallback: Kasir bisa lewati jika bluetooth hang */}
            <button onClick={onComplete} className="text-white/50 text-xs underline mt-2 hover:text-white">Lewati / Tutup (Jika Printer Error)</button>
          </div>
        ) : (
          <button onClick={onComplete} className="w-full bg-green-500 text-black rounded-xl py-4 font-extrabold flex justify-center gap-2 active:scale-95 transition-transform"><Check size={24} /> Selesai</button>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  );
}