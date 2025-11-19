import React, { useState, useCallback, useEffect } from 'react';
import { 
    FileUp, Send, Loader2, AlertTriangle, CheckCircle, List, FileText, BarChart2,
    Save, Clock, Zap, ArrowLeft, Users, Briefcase, Layers, UserPlus, LogIn, Tag,
    Shield, User, HardDrive, Phone, Mail, Building, Trash2, Sliders 
} from 'lucide-react'; 

// --- FIREBASE IMPORTS ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { 
    getFirestore, collection, addDoc, onSnapshot, query, doc, setDoc, updateDoc, 
    runTransaction, deleteDoc, where // <-- ADDED: where for RBAC filtering
} from 'firebase/firestore';

// --- CONSTANTS ---
const API_MODEL = "gemini-2.5-flash-preview-09-2025";
const API_KEY = import.meta.env.VITE_API_KEY; // <-- API Key access
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${API_MODEL}:generateContent?key=${API_KEY}`;
// --- NEW CONSTANT FOR TRIAL ---
const FREE_TRIAL_LIMIT = 3; 

// --- ENUM for Compliance Category ---
const CATEGORY_ENUM = ["LEGAL", "FINANCIAL", "TECHNICAL", "TIMELINE", "REPORTING", "ADMINISTRATIVE", "OTHER"];

// --- APP ROUTING ENUM (RBAC Enabled) ---
const PAGE = {
    HOME: 'HOME',
    COMPLIANCE_CHECK: 'COMPLIANCE_CHECK', // Renamed from BIDDER_SELF_CHECK
    ADMIN: 'ADMIN',                     // New Admin Dashboard
    HISTORY: 'HISTORY' 
};

// --- JSON Schema for the Comprehensive Report (UPDATED with negotiationStance) ---
const COMPREHENSIVE_REPORT_SCHEMA = {
    type: "OBJECT",
    description: "The complete compliance audit report, including a high-level summary and detailed requirement findings.",
    properties: {
        "executiveSummary": {
            "type": "STRING",
            "description": "A concise, high-level summary of the compliance audit, stating the overall compliance score, and the key areas of failure or success."
        },
        "findings": {
            type: "ARRAY",
            description: "A list of detailed compliance findings.",
            items: {
                type: "OBJECT",
                properties: {
                    "requirementFromRFQ": {
                        "type": "STRING",
                        "description": "The specific mandatory requirement or clause extracted verbatim from the RFQ document."
                    },
                    "complianceScore": {
                        "type": "NUMBER",
                        "description": "The score indicating compliance: 1 for Full Compliance, 0.5 for Partially Addressed, 0 for Non-Compliant/Missing."
                    },
                    "bidResponseSummary": {
                        "type": "STRING",
                        "description": "A concise summary of how the Bid addressed (or failed to address) the requirement, including a direct quote or section reference if possible."
                    },
                    "flag": {
                        "type": "STRING",
                        "enum": ["COMPLIANT", "PARTIAL", "NON-COMPLIANT"],
                        "description": "A categorical flag based on the score (1=COMPLIANT, 0.5=PARTIAL, 0=NON-COMPLIANT)."
                    },
                    "category": {
                        "type": "STRING",
                        "enum": CATEGORY_ENUM,
                        "description": "The functional category this requirement belongs to, inferred from its content (e.g., LEGAL, FINANCIAL, TECHNICAL, TIMELINE, REPORTING, ADMINISTRATIVE, OTHER)."
                    },
                    "negotiationStance": {
                        "type": "STRING",
                        "description": "For items flagged as PARTIAL or NON-COMPLIANT (score < 1), suggest a revised, compromise statement (1-2 sentences) that the Bidder can use to open a negotiation channel. This stance must acknowledge the RFQ requirement while offering a viable alternative or minor concession. Omit this field for COMPLIANT findings (score = 1)."
                    }
                },
                "propertyOrdering": ["requirementFromRFQ", "complianceScore", "bidResponseSummary", "flag", "category", "negotiationStance"]
            }
        }
    },
    "required": ["executiveSummary", "findings"],
    "propertyOrdering": ["executiveSummary", "findings"]
};

// --- Utility Function for API Call with Retry Logic ---
const fetchWithRetry = async (url, options, maxRetries = 3) => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                // Read error body for more specific LLM error message
                const errorBody = await response.text();
                throw new Error(`HTTP error! Status: ${response.status}. Details: ${errorBody.substring(0, 100)}...`);
            }
            return response;
        } catch (error) {
            if (i === maxRetries - 1) throw error; // Re-throw if last attempt
            const delay = Math.pow(2, i) * 1000; // Exponential backoff (1s, 2s, 4s)
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
};

// --- Utility Function to get Firestore Document Reference for Usage (per-user) ---
const getUsageDocRef = (db, userId) => {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    // Path: /artifacts/{appId}/users/{userId}/usage_limits/main_tracker
    return doc(db, `artifacts/${appId}/users/${userId}/usage_limits`, 'main_tracker');
};

// --- NEW/UPDATED Utility Function to get Firestore Collection Reference for Reports (Global) ---
const getReportsCollectionRef = (db) => {
    const appId = typeof __app_id !== 'undefined' ? '__app_id' : 'default-app-id';
    // Path: /artifacts/{appId}/compliance_reports (Single collection for Admin access)
    return collection(db, `artifacts/${appId}/compliance_reports`);
};

// --- Utility function to calculate the standard compliance percentage (Unweighted) ---
const getCompliancePercentage = (report) => {
    const findings = report.findings || []; 
    const totalScore = findings.reduce((sum, item) => sum + (item.complianceScore || 0), 0);
    const totalRequirements = findings.length;
    const maxScore = totalRequirements * 1;
    return maxScore > 0 ? parseFloat(((totalScore / maxScore) * 100).toFixed(1)) : 0;
};


// --- Universal File Processor (handles TXT, PDF, DOCX) ---
const processFile = (file) => {
    // NOTE: This uses global libraries loaded via script tags in the App component's useEffect
    return new Promise(async (resolve, reject) => {
        const fileExtension = file.name.split('.').pop().toLowerCase();
        const reader = new FileReader();

        if (fileExtension === 'txt') {
            reader.onload = (event) => resolve(event.target.result);
            reader.onerror = reject;
            reader.readAsText(file);
        } else if (fileExtension === 'pdf') {
            if (typeof window.pdfjsLib === 'undefined' || !window.pdfjsLib.getDocument) {
                return reject("PDF parsing library (pdf.js) not fully loaded or initialized. PDF support disabled.");
            }
            reader.onload = async (event) => {
                try {
                    const pdfData = new Uint8Array(event.target.result);
                    const pdf = await window.pdfjsLib.getDocument({ data: pdfData }).promise;
                    let fullText = '';
                    for (let i = 1; i <= pdf.numPages; i++) {
                        const page = await pdf.getPage(i);
                        const textContent = await page.getTextContent();
                        fullText += textContent.items.map(item => item.str).join(' ') + '\n\n'; 
                    }
                    resolve(fullText);
                } catch (e) {
                    reject('Error parsing PDF. Detail: ' + e.message);
                }
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        } else if (fileExtension === 'docx') {
            if (typeof window.mammoth === 'undefined') {
                 return reject("DOCX parsing library (mammoth.js) not loaded. DOCX support disabled.");
            }
            reader.onload = async (event) => {
                try {
                    const result = await window.mammoth.extractRawText({ arrayBuffer: event.target.result });
                    resolve(result.value); 
                } catch (e) {
                    reject('Error parsing DOCX. Detail: ' + e.message);
                }
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        } else {
            reject('Unsupported file type. Please use .txt, .pdf, or .docx.');
        }
    });
};

// --- CORE: Error Boundary Component to prevent white screens ---
class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true };
    }

    componentDidCatch(error, errorInfo) {
        console.error("Uncaught error:", error, errorInfo);
        this.setState({
            error: error,
            errorInfo: errorInfo
        });
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen bg-red-900 font-body p-4 sm:p-8 text-white flex items-center justify-center">
                    <div className="bg-red-800 p-8 rounded-xl border border-red-500 max-w-lg">
                        <AlertTriangle className="w-8 h-8 text-red-300 mx-auto mb-4"/>
                        <h2 className="text-xl font-bold mb-2">Critical Application Error</h2>
                        <p className="text-sm text-red-200">The application crashed during render.</p>
                        <p className="text-sm mt-3 font-mono break-all bg-red-900 p-2 rounded">
                            **Error Message:** {this.state.error && this.state.error.toString()}
                        </p>
                    </div>
                </div>
            );
        }

        return this.props.children; 
    }
}

// --- Helper Function for File Input Handling ---
const handleFileChange = (e, setFile, setErrorMessage) => {
    if (e.target.files.length > 0) {
        setFile(e.target.files[0]);
        if (setErrorMessage) setErrorMessage(null); 
    }
};

// --- AuthPage Component (Simulation) ---
const FormInput = ({ label, name, value, onChange, type, placeholder }) => (
    <div>
        <label htmlFor={name} className="block text-sm font-medium text-slate-300 mb-1">
            {label}
        </label>
        <input
            id={name}
            name={name}
            type={type}
            value={value}
            onChange={onChange}
            placeholder={placeholder || ''}
            required={label.includes('*')}
            className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:ring-amber-500 focus:border-amber-500 text-sm"
        />
    </div>
);

// UPDATED AuthPage signature for new RBAC logic
const AuthPage = ({ 
    setCurrentPage, setErrorMessage, userId, isAuthReady, errorMessage, 
    mockUsers, setMockUsers, setCurrentUser 
}) => {
    const [regForm, setRegForm] = useState({
        name: '', designation: '', company: '', email: '', phone: '',
        login: '', password: ''
    });

    const [loginForm, setLoginForm] = useState({
        login: '', password: ''
    });

    const [isSubmitting, setIsSubmitting] = useState(false);
    
    const handleRegChange = (e) => {
        setRegForm({ ...regForm, [e.target.name]: e.target.value });
    };

    const handleLoginChange = (e) => {
        setLoginForm({ ...loginForm, [e.target.name]: e.target.value });
    };

    const handleRegister = (e) => {
        e.preventDefault();
        setErrorMessage(null);
        setIsSubmitting(true);

        const required = ['name', 'designation', 'company', 'email', 'login', 'password'];
        const missing = required.filter(field => !regForm[field]);

        if (missing.length > 0) {
            setErrorMessage(`Please fill all required fields: ${missing.join(', ')}.`);
            setIsSubmitting(false);
            return;
        }
        
        // --- NEW: Check against the mockUsers object ---
        if (mockUsers[regForm.login]) {
            setErrorMessage("Registration failed: This login/email is already taken.");
            setIsSubmitting(false);
            return;
        }

        setTimeout(() => {
            // --- UPDATED: Save all registration details ---
            const newUser = {
                password: regForm.password,
                name: regForm.name,
                role: "USER", // All new registrations are standard users
                designation: regForm.designation, 
                company: regForm.company,         
                email: regForm.email,             
                phone: regForm.phone,             
            };
            setMockUsers(prev => ({
                ...prev,
                [regForm.login]: newUser
            }));
            
            setErrorMessage(`Success! User '${regForm.login}' registered. Please use the Login form to continue.`);
            setIsSubmitting(false);
        }, 1000);
    };

    const handleLogin = (e) => {
        e.preventDefault();
        setErrorMessage(null);
        setIsSubmitting(true);

        if (!loginForm.login || !loginForm.password) {
            setErrorMessage("Please enter both login/email and password.");
            setIsSubmitting(false);
            return;
        }
        
        // --- NEW: RBAC Login Check ---
        const user = mockUsers[loginForm.login];

        if (user && user.password === loginForm.password) {
            setTimeout(() => {
                const userData = { login: loginForm.login, ...user };
                setCurrentUser(userData); // Set the current user in App state
                
                setErrorMessage(`Login successful. Welcome back, ${user.name}!`);

                // --- NEW: Role-based Routing ---
                if (user.role === 'ADMIN') {
                    setCurrentPage(PAGE.ADMIN);
                } else {
                    setCurrentPage(PAGE.COMPLIANCE_CHECK);
                }
                
                setIsSubmitting(false);
            }, 500);
        } else {
            setErrorMessage("Login failed: Invalid username or password.");
            setIsSubmitting(false);
        }
    };
    
    const authStatusText = isAuthReady && userId 
        ? `You are currently logged in with Firebase ID: ${userId}` 
        : "Attempting anonymous login...";

    return (
        <div className="p-8 bg-slate-800 rounded-2xl shadow-2xl shadow-black/50 border border-slate-700 mt-12 mb-12">
            <h2 className="text-3xl font-extrabold text-white text-center">Welcome to SmartBids</h2>
            
            <p className="text-lg font-medium text-blue-400 text-center mb-6">
                AI-Driven Bid Compliance Audit: Smarter Bids, Every Time!
            </p>
            
            <div className="text-center mb-6 p-3 rounded-xl bg-green-900/40 border border-green-700">
                <p className="text-green-400 text-sm font-semibold">
                    {authStatusText} (Uninterrupted Testing Mode)
                </p>
                <p className="text-amber-400 text-xs mt-1">
                    **Unified Login Active. (Try admin/pass, myuser/123, or auditor/456)**
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* --- Section 1: New User Registration --- */}
                <div className="p-6 bg-slate-700/50 rounded-xl border border-blue-500/50 shadow-inner space-y-4">
                    <h3 className="text-2xl font-bold text-blue-300 flex items-center mb-4">
                        <UserPlus className="w-6 h-6 mr-2" /> New User Registration
                    </h3>
                    <form onSubmit={handleRegister} className="space-y-3">
                        <FormInput label="Full Name *" name="name" value={regForm.name} onChange={handleRegChange} type="text" />
                        <FormInput label="Designation *" name="designation" value={regForm.designation} onChange={handleRegChange} type="text" />
                        <FormInput label="Company *" name="company" value={regForm.company} onChange={handleRegChange} type="text" />
                        
                        <FormInput label="Email *" name="email" value={regForm.email} onChange={handleRegChange} type="email" />
                        <FormInput label="Contact Number" name="phone" value={regForm.phone} onChange={handleRegChange} type="tel" placeholder="Optional" />
                        
                        <FormInput label="Create Login Username/Email *" name="login" value={regForm.login} onChange={handleRegChange} type="text" />
                        <FormInput label="Create Password *" name="password" value={regForm.password} onChange={handleRegChange} type="password" />

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className={`w-full py-3 text-lg font-semibold rounded-xl text-slate-900 transition-all shadow-lg mt-6
                                bg-blue-400 hover:bg-blue-300 disabled:opacity-50 flex items-center justify-center
                            `}
                        >
                            {isSubmitting ? <Loader2 className="animate-spin h-5 w-5 mr-2" /> : <UserPlus className="h-5 w-5 mr-2" />}
                            {isSubmitting ? 'Registering...' : 'Register User'}
                        </button>
                    </form>
                </div>

                {/* --- Section 2: Returning User Login --- */}
                <div className="p-6 bg-slate-700/50 rounded-xl border border-green-500/50 shadow-inner flex flex-col justify-center">
                    <h3 className="text-2xl font-bold text-green-300 flex items-center mb-4">
                        <LogIn className="w-6 h-6 mr-2" /> Returning User Login
                    </h3>
                    <form onSubmit={handleLogin} className="space-y-4">
                        <FormInput label="Login Username/Email *" name="login" value={loginForm.login} onChange={handleLoginChange} type="text" />
                        <FormInput label="Password *" name="password" value={loginForm.password} onChange={handleLoginChange} type="password" />
                        
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className={`w-full py-3 text-lg font-semibold rounded-xl text-slate-900 transition-all shadow-lg mt-6
                                bg-green-400 hover:bg-green-300 disabled:opacity-50 flex items-center justify-center
                            `}
                        >
                            {isSubmitting ? <Loader2 className="animate-spin h-5 w-5 mr-2" /> : <LogIn className="h-5 w-5 mr-2" />}
                            {isSubmitting ? 'Logging In...' : 'Login & Access Dashboard'}
                        </button>
                    </form>
                    
                    {/* Error Message Display */}
                    {errorMessage && (
                        <div className="mt-4 p-3 bg-red-900/40 text-red-300 border border-red-700 rounded-xl flex items-center">
                            <AlertTriangle className="w-5 h-5 mr-3"/>
                            <p className="text-sm font-medium">{errorMessage}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// --- NEW: Mock Paywall Modal Component ---
const PaywallModal = ({ isOpen, onClose, trialCount, limit }) => {
    if (!isOpen) return null;

    return (
        <div 
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={onClose} // Allows closing by clicking outside
        >
            <div 
                className="bg-slate-800 p-8 rounded-2xl shadow-2xl border border-amber-500 max-w-lg w-full m-4"
                onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside
            >
                <div className="flex justify-between items-start mb-6">
                    <h3 className="text-3xl font-extrabold text-amber-400 flex items-center">
                        <Zap className="w-8 h-8 mr-3"/> Upgrade Required
                    </h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <p className="text-lg text-white mb-4">
                    You have successfully used all **{limit} free audits** in your trial period.
                </p>
                <p className="text-slate-300 mb-6">
                    **Current Usage:** {trialCount} / {limit} Audits Used
                </p>

                <div className="bg-slate-700/50 p-4 rounded-lg border border-slate-600 space-y-3">
                    <p className="font-semibold text-green-400">Unlock Unlimited Power with SmartBids Pro:</p>
                    <ul className="list-disc list-inside text-sm text-slate-200 ml-4">
                        <li>Unlimited Compliance Audits</li>
                        <li>Advanced Negotiation Stance Generator</li>
                        <li>Full History & Ranking Dashboard</li>
                    </ul>
                </div>
                
                <button 
                    onClick={onClose} 
                    className="w-full mt-6 py-3 text-lg font-semibold rounded-xl text-slate-900 bg-amber-500 hover:bg-amber-400 transition shadow-lg shadow-amber-900/50"
                >
                    Subscribe Now (Mock Purchase)
                </button>
                <p className="text-center text-xs text-slate-500 mt-3">
                    Note: This is a mock paywall and the subscription button is decorative.
                </p>
            </div>
        </div>
    );
};

// --- Main Application Component (Now called App) ---
function App() {
    // --- STATE ---
    const [RFQFile, setRFQFile] = useState(null);
    const [BidFile, setBidFile] = useState(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [report, setReport] = useState(null); 
    const [errorMessage, setErrorMessage] = useState(null);
    const [currentPage, setCurrentPage] = useState(PAGE.HOME);

    // --- MOCK AUTH STATE (Now a multi-user object - UPDATED DEFAULT USER DATA) ---
    const [mockUsers, setMockUsers] = useState({
        "myuser": { password: "123", name: "My User", role: "USER", designation: "Procurement Analyst", company: "BidCorp", email: "myuser@demo.com", phone: "555-1234" },
        // --- ADDED NEW USER: auditor/456 ---
        "auditor": { password: "456", name: "Auditor Smith", role: "USER", designation: "Junior Analyst", company: "AuditCo", email: "auditor@demo.com", phone: "555-9012" }, 
        "admin": { password: "pass", name: "System Admin", role: "ADMIN", designation: "Lead Administrator", company: "SmartBids Inc", email: "admin@smartbids.com", phone: "555-5678" }
    });
    const [currentUser, setCurrentUser] = useState(null); // { login, name, role }

    // --- FIREBASE STATE ---
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null); 
    const [userId, setUserId] = useState(null); // Firebase Anonymous User ID
    const [reportsHistory, setReportsHistory] = useState([]);
    // --- NEW: Paywall State ---
    const [isPaywallOpen, setIsPaywallOpen] = useState(false); 
    const [usageLimits, setUsageLimits] = useState({ 
        initiatorChecks: 0, 
        bidderChecks: 0, 
        isSubscribed: false // **UPDATED: Set to FALSE for free trial enforcement**
    });

    // --- LOGIC: Paywall Check ---
    const isTrialOver = usageLimits.bidderChecks >= FREE_TRIAL_LIMIT && !usageLimits.isSubscribed;

    // --- EFFECT 1: Firebase Initialization and Auth ---
    useEffect(() => {
        // ... (Initialization remains the same)
        try {
            const firebaseConfig = JSON.parse(import.meta.env.VITE_FIREBASE_CONFIG);
            const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
    
            if (Object.keys(firebaseConfig).length === 0) {
                setIsAuthReady(true);
                return;
            }

            const app = initializeApp(firebaseConfig);
            const newAuth = getAuth(app);
            const newDb = getFirestore(app);

            setDb(newDb);
            setAuth(newAuth); 

            const signIn = async () => {
                try {
                    if (initialAuthToken) {
                        await signInWithCustomToken(newAuth, initialAuthToken);
                    } else {
                        await signInAnonymously(newAuth);
                    }
                } catch (error) {
                    console.error("Firebase Sign-In Failed:", error);
                }
            };

            const unsubscribeAuth = onAuthStateChanged(newAuth, (user) => {
                const currentUserId = user?.uid || null;
                setUserId(currentUserId);
                setIsAuthReady(true);
            });

            signIn();
            return () => unsubscribeAuth();

        } catch (e) {
            console.error("Error initializing Firebase:", e);
            setIsAuthReady(true);
        }
    }, []); 

    // --- EFFECT 2: Load/Initialize Usage Limits (Scoped by userId) ---
    useEffect(() => {
        if (db && userId) {
            const docRef = getUsageDocRef(db, userId);

            const unsubscribe = onSnapshot(docRef, (docSnap) => {
                if (docSnap.exists()) {
                    setUsageLimits({
                        ...docSnap.data(),
                        // Ensure isSubscribed defaults to false if not in data 
                        isSubscribed: docSnap.data().isSubscribed || false 
                    });
                } else {
                    // Initialize document if it doesn't exist
                    const initialData = { 
                        initiatorChecks: 0, 
                        bidderChecks: 0, 
                        isSubscribed: false 
                    };
                    // Note: This non-transactional set helps initialize for the listener, 
                    // but the transaction (incrementUsage) handles true atomic initialization.
                    setDoc(docRef, initialData).catch(e => console.error("Error creating usage doc:", e));
                    setUsageLimits(initialData);
                }
            }, (error) => {
                console.error("Error listening to usage limits:", error);
            });

            return () => unsubscribe();
        }
    }, [db, userId]);

    // --- EFFECT 3: Firestore Listener for Report History (RBAC Implemented) ---
    useEffect(() => {
        if (db && userId && currentUser) {
            const reportsRef = getReportsCollectionRef(db); // Global collection
            let reportsQuery = query(reportsRef);

            // 1. RBAC Filtering Logic:
            if (currentUser.role !== 'ADMIN') {
                // Standard users only see their own reports, filtered by their mock login ID.
                reportsQuery = query(reportsQuery, where('userLogin', '==', currentUser.login));
            }
            // Admin users see all reports (no 'where' filter needed).

            const unsubscribeSnapshot = onSnapshot(reportsQuery, (snapshot) => {
                const history = [];
                snapshot.forEach((doc) => {
                    history.push({ id: doc.id, ...doc.data() });
                });
                history.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                setReportsHistory(history);
            }, (error) => {
                console.error("Error listening to reports:", error);
            });

            // CRITICAL FIX: Listener now depends on currentUser for RBAC
            return () => unsubscribeSnapshot();
        } else {
            // Clear history if we don't have a logged-in user or Firebase isn't ready
            setReportsHistory([]); 
        }
    }, [db, userId, currentUser]);

    // --- EFFECT 4: Safely load PDF.js and Mammoth.js Libraries ---
    useEffect(() => {
        // ... (Library loading logic remains the same)
        const loadScript = (src, libraryName) => {
            return new Promise((resolve, reject) => {
                if (document.querySelector(`script[src="${src}"]`)) {
                    resolve(); 
                    return;
                }
                const script = document.createElement('script');
                script.src = src;
                script.onload = resolve;
                script.onerror = (error) => reject(new Error(`Failed to load external script for ${libraryName}: ${src}`));
                document.head.appendChild(script);
            });
        };

        const loadAllLibraries = async () => {
            // Load PDF.js
            try {
                await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js", "PDF.js");
                if (window.pdfjsLib) {
                    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
                }
            } catch (e) {
                console.error(e.message);
                console.warn("PDF support will be unavailable.");
            }
            
            // Load Mammoth.js (for DOCX)
            try {
                await loadScript("https://cdnjs.cloudflare.com/ajax/libs/mammoth.js/1.4.15/mammoth.browser.min.js", "Mammoth.js");
            } catch (e) {
                console.error(e.message);
                console.warn("DOCX support will be unavailable.");
            }
        };
        
        loadAllLibraries();
    }, []); 

    // --- LOGIC: Increment Usage Count via Transaction (Atomic Counter FIX) ---
    const incrementUsage = async (roleKey) => {
        if (!db || !userId) return;
        const docRef = getUsageDocRef(db, userId);
        
        try {
            // FIX: Use a transaction with set to ensure atomic increment AND document creation if missing.
            await runTransaction(db, async (transaction) => {
                const docSnap = await transaction.get(docRef);
                
                let currentData;
                
                if (docSnap.exists()) {
                    currentData = docSnap.data();
                } else {
                    // Initialize if the document does not exist
                    currentData = { 
                        initiatorChecks: 0, 
                        bidderChecks: 0, 
                        isSubscribed: false 
                    };
                }

                // Calculate the new count (ensuring it starts from 0 if undefined)
                const newCount = (currentData[roleKey] || 0) + 1;
                
                // Update the currentData object
                currentData[roleKey] = newCount;

                // Use set to guarantee the document is created or fully updated atomically
                transaction.set(docRef, currentData);
            });
            // State update happens via the onSnapshot listener in Effect 2
        } catch (e) {
            console.error("Transaction failed to update usage:", e);
            setErrorMessage(`Failed to update usage count. Details: ${e.message}`);
        }
    };


    // --- CORE LOGIC: Compliance Analysis ---
    const handleAnalyze = useCallback(async (role) => {
        const roleKey = 'bidderChecks'; // Standardized key for trial usage

        // --- Paywall Check (Trial Enforcement) ---
        if (isTrialOver) {
            setIsPaywallOpen(true);
            setErrorMessage(`Trial
