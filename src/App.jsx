import React, { useState, useCallback, useEffect } from 'react';
import { 
    FileUp, Send, Loader2, AlertTriangle, CheckCircle, List, FileText, BarChart2,
    Save, Clock, Zap, ArrowLeft, Users, Briefcase, Layers, UserPlus, LogIn, Tag,
    Shield, User, HardDrive, Phone, Mail, Building, Trash2 
} from 'lucide-react'; 

// --- FIREBASE IMPORTS ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { 
    getFirestore, collection, addDoc, onSnapshot, query, doc, setDoc, updateDoc, 
    runTransaction, deleteDoc, getDocs
} from 'firebase/firestore'; // <-- add getDocs if not already

// --- FIREBASE INITIALIZATION (PLACE HERE) ---
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);


// --- CONSTANTS ---
const API_MODEL = "gemini-2.5-flash-preview-09-2025";
const API_KEY = import.meta.env.VITE_API_KEY; // <-- This line is the fix
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${API_MODEL}:generateContent?key=${API_KEY}`;

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
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response;
        } catch (error) {
            if (i === maxRetries - 1) throw error; // Re-throw if last attempt
            const delay = Math.pow(2, i) * 1000; // Exponential backoff (1s, 2s, 4s)
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
};

// --- Utility Function to get Firestore Document Reference for Usage ---
const getUsageDocRef = (db, userId) => {
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    // Path: /artifacts/{appId}/users/{userId}/usage_limits/main_tracker
    return doc(db, `artifacts/${appId}/users/${userId}/usage_limits`, 'main_tracker');
};

// --- Utility Function to get Firestore Collection Reference for Reports ---
const getReportsCollectionRef = (db, userId) => {
    const appId = typeof __app_id !== 'undefined' ? '__app_id' : 'default-app-id';
    // FIX: This path correctly scopes data by userId, ensuring isolation.
    return collection(db, `artifacts/${appId}/users/${userId}/compliance_reports`);
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

const AuthPage = ({ setCurrentPage, setErrorMessage, isAuthReady, errorMessage, setCurrentUser, db, auth }) => {
    const [regForm, setRegForm] = useState({ name: '', designation: '', company: '', email: '', phone: '', password: '' });
    const [loginForm, setLoginForm] = useState({ email: '', password: '' });
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleRegChange = (e) => setRegForm({ ...regForm, [e.target.name]: e.target.value });
    const handleLoginChange = (e) => setLoginForm({ ...loginForm, [e.target.name]: e.target.value });

    const handleRegister = async (e) => {
        e.preventDefault();
        setErrorMessage(null);
        setIsSubmitting(true);
        try {
            if (!auth || !db) throw new Error('Authentication backend not configured.');
            const userCred = await createUserWithEmailAndPassword(auth, regForm.email, regForm.password);
            const uid = userCred.user.uid;
            await setDoc(doc(db, 'users', uid), {
                name: regForm.name,
                designation: regForm.designation,
                company: regForm.company,
                email: regForm.email,
                phone: regForm.phone,
                role: 'USER',
                createdAt: Date.now()
            });
            setErrorMessage('Registration successful. You are now logged in.');
        } catch (err) {
            console.error('Registration error', err);
            setErrorMessage(err.message || 'Registration failed.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        setErrorMessage(null);
        setIsSubmitting(true);
        try {
            if (!auth) throw new Error('Auth not configured.');
            await signInWithEmailAndPassword(auth, loginForm.email, loginForm.password);
            setErrorMessage('Login successful.');
        } catch (err) {
            console.error('Login error', err);
            setErrorMessage(err.message || 'Login failed.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="p-8 bg-slate-800 rounded-2xl shadow-2xl shadow-black/50 border border-slate-700 mt-12 mb-12">
            <h2 className="text-3xl font-extrabold text-white text-center">Welcome to SmartBids</h2>
            <p className="text-lg font-medium text-blue-400 text-center mb-6">AI-Driven Bid Compliance Audit: Smarter Bids, Every Time!</p>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="p-6 bg-slate-700/50 rounded-xl border border-blue-500/50 shadow-inner space-y-4">
                    <h3 className="text-2xl font-bold text-blue-300 flex items-center mb-4"><UserPlus className="w-6 h-6 mr-2" /> Create Account</h3>
                    <form onSubmit={handleRegister} className="space-y-3">
                        <FormInput label="Full Name *" name="name" value={regForm.name} onChange={handleRegChange} type="text" />
                        <FormInput label="Designation" name="designation" value={regForm.designation} onChange={handleRegChange} type="text" />
                        <FormInput label="Company" name="company" value={regForm.company} onChange={handleRegChange} type="text" />
                        <FormInput label="Email *" name="email" value={regForm.email} onChange={handleRegChange} type="email" />
                        <FormInput label="Contact Number" name="phone" value={regForm.phone} onChange={handleRegChange} type="tel" placeholder="Optional" />
                        <FormInput label="Create Password *" name="password" value={regForm.password} onChange={handleRegChange} type="password" />

                        <button type="submit" disabled={isSubmitting} className={`w-full py-3 text-lg font-semibold rounded-xl text-slate-900 transition-all shadow-lg mt-6 bg-blue-400 hover:bg-blue-300 disabled:opacity-50 flex items-center justify-center`}>
                            {isSubmitting ? <Loader2 className="animate-spin h-5 w-5 mr-2" /> : <UserPlus className="h-5 w-5 mr-2" />}
                            {isSubmitting ? 'Registering...' : 'Register'}
                        </button>
                    </form>
                </div>

                <div className="p-6 bg-slate-700/50 rounded-xl border border-green-500/50 shadow-inner flex flex-col justify-center">
                    <h3 className="text-2xl font-bold text-green-300 flex items-center mb-4"><LogIn className="w-6 h-6 mr-2" /> Sign In</h3>
                    <form onSubmit={handleLogin} className="space-y-4">
                        <FormInput label="Email *" name="email" value={loginForm.email} onChange={handleLoginChange} type="email" />
                        <FormInput label="Password *" name="password" value={loginForm.password} onChange={handleLoginChange} type="password" />

                        <button type="submit" disabled={isSubmitting} className={`w-full py-3 text-lg font-semibold rounded-xl text-slate-900 transition-all shadow-lg mt-6 bg-green-400 hover:bg-green-300 disabled:opacity-50 flex items-center justify-center`}>
                            {isSubmitting ? <Loader2 className="animate-spin h-5 w-5 mr-2" /> : <LogIn className="h-5 w-5 mr-2" />}
                            {isSubmitting ? 'Signing in...' : 'Sign In'}
                        </button>
                    </form>

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

// --- EFFECT 1: Firebase Initialization and Auth ---
useEffect(() => {
    try {
        const firebaseConfig = {
            apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
            authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
            projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
            storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
            messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
            appId: import.meta.env.VITE_FIREBASE_APP_ID
        };

        const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

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

        signIn();

        const unsubscribeAuth = onAuthStateChanged(newAuth, async (user) => {
            const uid = user?.uid || null;
            setUserId(uid);
            setIsAuthReady(true);

            if (uid && newDb) {
                try {
                    const userDoc = await getDoc(doc(newDb, 'users', uid));
                    if (userDoc.exists()) {
                        setCurrentUser({ uid, ...userDoc.data() });
                    } else {
                        setCurrentUser({ uid, role: 'ANONYMOUS' });
                    }
                } catch (e) {
                    console.error('Error loading user profile:', e);
                }
            } else {
                setCurrentUser(null);
            }
        });

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
                        isSubscribed: true // FORCE true for unlimited mode
                    });
                } else {
                    // Initialize document if it doesn't exist
                    const initialData = { 
                        initiatorChecks: 0, 
                        bidderChecks: 0, 
                        isSubscribed: true // FORCE true for unlimited mode
                    };
                    setDoc(docRef, initialData).catch(e => console.error("Error creating usage doc:", e));
                    setUsageLimits(initialData);
                }
            }, (error) => {
                console.error("Error listening to usage limits:", error);
            });

            // CRITICAL FIX: onSnapshot re-runs whenever userId changes, ensuring data isolation.
            return () => unsubscribe();
        }
    }, [db, userId]);
// --- EFFECT 3: Firestore Listener for Report History (Admin-aware) ---
useEffect(() => {
    if (!db || !currentUser) return;

    let unsubscribeSnapshot = null;

    if (currentUser.role === 'ADMIN') {
        // ADMIN — load ALL USERS' reports
        const collectionGroupRef = collectionGroup(db, 'compliance_reports');
        const q = query(collectionGroupRef);

        unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
            const history = [];
            snapshot.forEach(docSnap => {
                history.push({ id: docSnap.id, ...docSnap.data() });
            });
            history.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            setReportsHistory(history);
        }, (error) => {
            console.error('Error listening to collectionGroup reports:', error);
        });

    } else if (userId) {
        // USER — load ONLY their reports
        const reportsRef = getReportsCollectionRef(db, userId);
        const q = query(reportsRef);

        unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
            const history = [];
            snapshot.forEach((doc) => history.push({ id: doc.id, ...doc.data() }));
            history.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            setReportsHistory(history);
        }, (error) => {
            console.error('Error listening to user reports:', error);
        });
    }

    return () => unsubscribeSnapshot && unsubscribeSnapshot();
}, [db, userId, currentUser]);


    // --- EFFECT 3: Firestore Listener for Report History (Scoped by userId) ---
    useEffect(() => {
        if (db && userId) {
            const reportsRef = getReportsCollectionRef(db, userId);
            const q = query(reportsRef);

            const unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
                const history = [];
                snapshot.forEach((doc) => {
                    history.push({ id: doc.id, ...doc.data() });
                });
                history.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                setReportsHistory(history);
            }, (error) => {
                console.error("Error listening to reports:", error);
            });

            // CRITICAL FIX: onSnapshot re-runs whenever userId changes, ensuring data isolation.
            return () => unsubscribeSnapshot();
        }
    }, [db, userId]);

    // --- EFFECT 4: Safely load PDF.js and Mammoth.js Libraries ---
    useEffect(() => {
        const loadScript = (src, libraryName) => {
            return new Promise((resolve, reject) => {
                if (document.querySelector(`script[src="${src}"]`)) {
                    resolve(); 
                    return;
                }
                const script = document.createElement('script');
                script.src = src;
                script.onload = resolve;
                // When an error occurs, reject the promise with a specific message.
                script.onerror = (error) => reject(new Error(`Failed to load external script for ${libraryName}: ${src}`));
                document.head.appendChild(script);
            });
        };

        const loadAllLibraries = async () => {
            // Load PDF.js
            try {
                // Updated PDF.js CDN link to a more recent stable version for better compatibility
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
                // Updated Mammoth.js CDN link to a highly stable version (1.4.15) 
                // to resolve reported loading issues with 1.6.0 in some environments.
                await loadScript("https://cdnjs.cloudflare.com/ajax/libs/mammoth.js/1.4.15/mammoth.browser.min.js", "Mammoth.js");
            } catch (e) {
                console.error(e.message);
                console.warn("DOCX support will be unavailable.");
            }
        };
        
        loadAllLibraries();
    }, []); 

    // --- LOGIC: Increment Usage Count via Transaction (Tracking only, no enforcement) ---
    const incrementUsage = async (roleKey) => {
        if (!db || !userId) return;
        const docRef = getUsageDocRef(db, userId);

        try {
            await runTransaction(db, async (transaction) => {
                const docSnap = await transaction.get(docRef);
                
                let currentData;
                if (!docSnap.exists()) {
                    currentData = { initiatorChecks: 0, bidderChecks: 0, isSubscribed: true };
                    transaction.set(docRef, currentData);
                } else {
                    currentData = docSnap.data();
                }

                const newCount = (currentData[roleKey] || 0) + 1;
                transaction.update(docRef, { [roleKey]: newCount, isSubscribed: true }); // Always set subscribed to true
                
                setUsageLimits(prev => ({
                    ...prev,
                    [roleKey]: newCount
                }));

            });
        } catch (e) {
            console.error("Transaction failed to update usage:", e);
        }
    };


    // --- CORE LOGIC: Compliance Analysis ---
    const handleAnalyze = useCallback(async (role) => {
        const roleKey = role === 'INITIATOR' ? 'initiatorChecks' : 'bidderChecks';
        
        if (!RFQFile || !BidFile) {
            setErrorMessage("Please upload both the RFQ and the Bid documents.");
            return;
        }

        setLoading(true);
        setReport(null);
        setErrorMessage(null);

        try {
            const rfqContent = await processFile(RFQFile);
            const bidContent = await processFile(BidFile);
            
            // --- UPDATED SYSTEM PROMPT (INCLUDING NEGOTIATION STANCE INSTRUCTION) ---
            const systemPrompt = {
                parts: [{
                    text: `You are the SmartBid Compliance Auditor, a world-class procurement specialist. Your task is to strictly compare two documents: the Request for Quotation (RFQ) and the submitted Bid.
                    1. Identify all mandatory requirements, clauses, and constraints from the RFQ.
                    2. For each requirement, locate the corresponding response in the Bid.
                    3. Assign a Compliance Score: 1 for Full Compliance, 0.5 for Partially Addressed, 0 for Non-Compliant/Missing.
                    4. Infer a functional category for each requirement from the following list: ${CATEGORY_ENUM.join(', ')}.
                    5. IMPORTANT: For any item scoring 0 or 0.5 (Non-Compliant or Partial), you MUST generate a 'negotiationStance'. This stance must be a 1-2 sentence compromise that the bidder can use to open negotiations with the client, moving the language closer to the RFQ's intent without changing the bidder's core offering. Omit this field for Compliant findings.
                    6. Generate the output ONLY as a JSON object matching the provided comprehensive schema, ensuring the 'executiveSummary' is informative and actionable.`
                }]
            };

            const userQuery = `RFQ Document Content (Document A - Mandatory Requirements):\n\n---START RFQ---\n${rfqContent}\n---END RFQ---\n\nBid/Proposal Document Content (Document B - The Response):\n\n---START BID---\n${bidContent}\n---END BID---\n\nBased ONLY on the content above, perform the compliance audit and return the results in the requested JSON format.`;

            const payload = {
                contents: [{ parts: [{ text: userQuery }] }],
                systemInstruction: systemPrompt,
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: COMPREHENSIVE_REPORT_SCHEMA
                },
            };

            const options = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            };

            const response = await fetchWithRetry(API_URL, options);
            const result = await response.json();
            
            const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;

            if (jsonText) {
                const parsedReport = JSON.parse(jsonText); 
                setReport(parsedReport);
                
                // SUCCESS: Increment usage counter (for tracking, not limiting)
                // We use 'bidderChecks' as the generic key for "any compliance check"
                await incrementUsage('bidderChecks');

            } else {
                throw new Error("AI failed to return a valid JSON report.");
            }

        } catch (error) {
            console.error("Analysis Error:", error);
            setErrorMessage(`Failed to generate report. Details: ${error.message}.`);
        } finally {
            setLoading(false);
        }
    }, [RFQFile, BidFile]);


    // --- CORE LOGIC: Test Data Generation ---
    const generateTestData = useCallback(async () => {
        // Mock RFQ content based on the demonstration documents (Risk Weights removed)
        const mockRfqContent = `
1. TECHNICAL: The proposed cloud solution must integrate bi-directionally with our legacy billing system via its existing REST/JSON API endpoints, as detailed in Appendix B. This is a mandatory core technical specification.
2. FINANCIAL: Bidders must submit a Firm Fixed Price (FFP) quote for all services covering the first 12 calendar months of operation. Cost estimates or time-and-materials pricing will result in non-compliance.
3. LEGAL: A signed, legally binding Non-Disclosure Agreement (NDA) must be included as a separate document, titled "Appendix A," within the submission package.
4. TIMELINE: The entire migration project, including final testing and sign-off, must be completed and live within 60 calendar days of contract award.
5. ADMINISTRATIVE: The entire bid package (including all appendices) must be submitted electronically as a single, consolidated PDF document.
        `.trim();
        
        // Mock Bid content based on the demonstration documents (with deliberate compliance issues)
        const mockBidContent = `
--- EXECUTIVE SUMMARY ---
We are pleased to submit our proposal for the Cloud Migration Service. We are committed to a successful partnership.

--- TECHNICAL RESPONSE ---
1. Technical Integration: We propose using our cutting-edge GraphQL gateway for integration, as it offers superior flexibility. While we prefer GraphQL, we understand the requirement for REST/JSON integration with the legacy billing system. We can certainly look into developing the necessary REST/JSON adaptors during the implementation phase, contingent upon a change order if complexity is higher than anticipated.

--- FINANCIALS ---
2. Financials: We have outlined our estimated costs for the first 12 months in the following table. Our estimated price is $850,000. This estimate is subject to final scoping validation but provides a clear indication of cost.

--- LEGAL COMPLIANCE ---
3. Legal: We are happy to execute the NDA referenced in your RFQ. Our standard policy dictates that the NDA process is initiated immediately following the Notice of Intent to Award and prior to the commencement of work.

--- PROJECT PLAN ---
4. Timeline: We commit to the 60 calendar day timeline specified for project completion.
5. Submission Format: We confirm that this document, along with all supporting materials, has been consolidated and submitted as a single PDF file for your review.
        `.trim();

        // Clear existing files and report
        setRFQFile(null);
        setBidFile(null);
        setReport(null);

        setLoading(true);
        setErrorMessage(null);

        try {
            const mockRFQFile = new File([mockRfqContent], "MOCK_RFQ_SIMPLIFIED.txt", { type: "text/plain" });
            const mockBidFile = new File([mockBidContent], "MOCK_BID_SIMPLIFIED.txt", { type: "text/plain" });
            
            setRFQFile(mockRFQFile);
            setBidFile(mockBidFile);
            setErrorMessage("Mock documents loaded! Click 'RUN COMPLIANCE AUDIT' to see the Standard Score.");

        } catch (error) {
            console.error("Test Data Generation Error:", error);
            setErrorMessage(`Failed to generate test data: ${error.message}`);
        } finally {
            setLoading(false);
        }
    }, []);

    // --- CORE LOGIC: Save Report ---
    const saveReport = useCallback(async (role) => {
        if (!db || !userId || !report) {
            setErrorMessage("Database not ready or no report to save.");
            return;
        }
        setSaving(true);
        try {
            const reportsRef = getReportsCollectionRef(db, userId);
            
            await addDoc(reportsRef, {
                ...report,
                rfqName: RFQFile?.name || 'Untitled RFQ',
                bidName: BidFile?.name || 'Untitled Bid',
                timestamp: Date.now(),
                role: role, // Save the role used for the audit
            });
            
            setErrorMessage("Report saved successfully to history!"); 
            setTimeout(() => setErrorMessage(null), 3000);

        } catch (error) {
            console.error("Error saving report:", error);
            setErrorMessage(`Failed to save report: ${error.message}`);
        } finally {
            setSaving(false);
        }
    }, [db, userId, report, RFQFile, BidFile]);
    
    // --- CORE LOGIC: Delete Report ---
    // NOTE: This function remains for ADMIN use. Its button rendering is restricted.
    const deleteReport = useCallback(async (reportId, rfqName, bidName) => {
        if (!db || !userId) {
            setErrorMessage("Database not ready.");
            return;
        }
        setErrorMessage(`Deleting report: ${rfqName} vs ${bidName}...`);
        
        try {
            const reportsRef = getReportsCollectionRef(db, userId);
            const docRef = doc(reportsRef, reportId);
            
            // Perform the deletion
            await deleteDoc(docRef);

            // Clear any currently loaded report if it's the one being deleted
            if (report && report.id === reportId) {
                setReport(null);
            }
            
            setErrorMessage("Report deleted successfully!");
            setTimeout(() => setErrorMessage(null), 3000);

        } catch (error) {
            console.error("Error deleting report:", error);
            setErrorMessage(`Failed to delete report: ${error.message}`);
        }
    }, [db, userId, report]);


    const loadReportFromHistory = useCallback((historyItem) => {
        setRFQFile(null);
        setBidFile(null);
        setReport({
            id: historyItem.id, // Ensure the ID is carried over for potential re-saving/deletion
            executiveSummary: historyItem.executiveSummary,
            findings: historyItem.findings,
        });
        // Navigate to the compliance check page to view any report
        setCurrentPage(PAGE.COMPLIANCE_CHECK); 
        setErrorMessage(`Loaded report: ${historyItem.rfqName} vs ${historyItem.bidName}`);
        setTimeout(() => setErrorMessage(null), 3000);
    }, []);

    const resetFilesAndReport = () => {
        setRFQFile(null);
        setBidFile(null);
        setReport(null);
        setErrorMessage(null);
    };
    
    // --- Render Switch ---
    const renderPage = () => {
        switch (currentPage) {
            case PAGE.HOME:
                return <AuthPage 
                    setCurrentPage={setCurrentPage} 
                    setErrorMessage={setErrorMessage} 
                    userId={userId} 
                    isAuthReady={isAuthReady}
                    errorMessage={errorMessage}
                    setCurrentUser={setCurrentUser}
                />;
            case PAGE.COMPLIANCE_CHECK:
                return <AuditPage 
                    title="Bidder: Self-Compliance Check"
                    rfqTitle="Request for Quotation (RFQ)" 
                    bidTitle="Bid/Proposal Document" 
                    role="BIDDER" // Role here is for the *type* of audit
                    handleAnalyze={handleAnalyze}
                    usageLimits={usageLimits.bidderChecks} // Pass the total count
                    setCurrentPage={setCurrentPage}
                    currentUser={currentUser} // Pass the logged-in user
                    loading={loading}
                    RFQFile={RFQFile}
                    BidFile={BidFile}
                    setRFQFile={setRFQFile}
                    setBidFile={setBidFile}
                    generateTestData={generateTestData} 
                    errorMessage={errorMessage}
                    report={report}
                    saveReport={saveReport}
                    saving={saving}
                    setErrorMessage={setErrorMessage}
                    userId={userId} 
                />;
            case PAGE.ADMIN:
                return <AdminDashboard
                    setCurrentPage={setCurrentPage}
                    currentUser={currentUser}
                    usageLimits={usageLimits}
                    reportsHistory={reportsHistory}
                    />;
            case PAGE.HISTORY:
                return <ReportHistory 
                    reportsHistory={reportsHistory} 
                    loadReportFromHistory={loadReportFromHistory} 
                    deleteReport={deleteReport} // Passed delete function
                    isAuthReady={isAuthReady} 
                    userId={userId}
                    setCurrentPage={setCurrentPage}
                    currentUser={currentUser} // Pass the logged-in user
                />;
            default:
                return <AuthPage 
                    setCurrentPage={setCurrentPage} 
                    setErrorMessage={setErrorMessage} 
                    userId={userId} 
                    isAuthReady={isAuthReady}
                    errorMessage={errorMessage}
                    setCurrentUser={setCurrentUser}
                />;
        }
    };

    return (
        <div className="min-h-screen bg-slate-900 font-body p-4 sm:p-8 text-slate-100">
            
            <style>{`
                /* --- FONT UPDATE: Lexend --- */
                @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@100..900&display=swap');

                /* Apply Lexend to all font utility classes */
                .font-body, .font-body *, .font-display, .font-display * { 
                    font-family: 'Lexend', sans-serif !important; 
                }
                
                input[type="file"] { display: block; width: 100%; }
                
                input[type="file"]::file-selector-button {
                    background-color: #f59e0b; 
                    color: #1e293b; 
                    border: none;
                    padding: 10px 20px;
                    border-radius: 10px;
                    cursor: pointer;
                    font-weight: 600;
                    transition: all 0.3s;
                    font-family: 'Lexend', sans-serif; /* Ensure button font is also Lexend */
                }
                input[type="file"]::file-selector-button:hover {
                    background-color: #fbbf24;
                }

                /* Custom Scrollbar for Admin User List */
                .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background-color: #475569; /* slate-600 */
                    border-radius: 3px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background-color: #1e293b; /* slate-800 */
                }
            `}</style>
            
            <div className="max-w-4xl mx-auto space-y-10">
                {/* --- HEADER CONTENT REMOVED AS REQUESTED --- */}
                
                {renderPage()}
            </div>
        </div>
    );

// --- DetailItem for consistent user card styling ---
const DetailItem = ({ icon: Icon, label, value }) => (
    <div className='flex items-center text-sm text-slate-300'>
        {Icon && <Icon className="w-4 h-4 mr-2 text-blue-400 flex-shrink-0"/>}
        <span className="text-slate-500 mr-2 flex-shrink-0">{label}:</span>
        <span className="font-medium truncate min-w-0" title={value}>{value}</span>
    </div>
);

// --- UserCard sub-component for AdminDashboard ---
const UserCard = ({ user }) => (
  <div className="p-4 bg-slate-900 rounded-xl border border-slate-700 shadow-md">
    <div className="flex justify-between items-center border-b border-slate-700 pb-2 mb-2">
      <p className="text-xl font-bold text-white flex items-center">
        <User className="w-5 h-5 mr-2 text-amber-400" />
        {user.name}
      </p>
      <span
        className={`text-xs px-3 py-1 rounded-full font-semibold ${
          user.role === 'ADMIN' ? 'bg-red-500 text-white' : 'bg-green-500 text-slate-900'
        }`}
      >
        {user.role}
      </span>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 mt-4">
      <DetailItem icon={Briefcase} label="Designation" value={user.designation} />
      <DetailItem icon={Building} label="Company" value={user.company} />
      <DetailItem icon={Mail} label="Email" value={user.email} />
      <DetailItem icon={Phone} label="Contact" value={user.phone || 'N/A'} />
    </div>
    <p className="text-xs text-slate-500 mt-3 border-t border-slate-800 pt-2">
      Login ID: <span className="text-slate-400 font-mono">{user.login}</span>
    </p>
  </div>
);

// --- StatCard sub-component for AdminDashboard ---
const StatCard = ({ icon, label, value }) => (
  <div className="bg-slate-900 p-6 rounded-xl border border-slate-700 flex items-center space-x-4">
    <div className="flex-shrink-0">{icon}</div>
    <div>
      <div className="text-3xl font-extrabold text-white">{value}</div>
      <div className="text-sm text-slate-400">{label}</div>
    </div>
  </div>
);

// --- AdminDashboard component ---
const AdminDashboard = ({ setCurrentPage, currentUser, usageLimits, reportsHistory }) => {
  const totalAudits = (usageLimits.initiatorChecks || 0) + (usageLimits.bidderChecks || 0);
  const recentReports = reportsHistory.slice(0, 5);
  const [userList, setUserList] = useState([]);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const snapshot = await getDocs(collection(getFirestore(), 'users'));
        const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setUserList(users);
      } catch (err) {
        console.error('Error fetching users:', err);
      }
    };
    fetchUsers();
  }, []);

  return (
    <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl shadow-black/50 border border-slate-700 space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-slate-700 pb-4">
        <h2 className="text-3xl font-bold text-white flex items-center">
          <Shield className="w-8 h-8 mr-3 text-red-400" />
          Admin System Oversight
        </h2>
        <button
          onClick={() => setCurrentPage('HOME')}
          className="text-sm text-slate-400 hover:text-amber-500 flex items-center"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Logout
        </button>
      </div>

      {/* Welcome */}
      <p className="text-lg text-slate-300">
        Welcome, <span className="font-bold text-red-400">{currentUser?.name || 'Admin'}</span>.
        This is the central dashboard for system monitoring.
      </p>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          onClick={() => setCurrentPage('COMPLIANCE_CHECK')}
          className="p-4 bg-blue-600 hover:bg-blue-500 rounded-xl text-white font-semibold flex items-center justify-center text-lg transition-all shadow-lg"
        >
          <FileUp className="w-5 h-5 mr-2" /> Go to Compliance Check
        </button>
        <button
          onClick={() => setCurrentPage('HISTORY')}
          className="p-4 bg-slate-600 hover:bg-slate-500 rounded-xl text-white font-semibold flex items-center justify-center text-lg transition-all shadow-lg"
        >
          <List className="w-5 h-5 mr-2" /> View Full Report History
        </button>
      </div>

      {/* System Stats */}
      <div>
        <h3 className="text-xl font-bold text-white mb-4">System Statistics</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            icon={<HardDrive className="w-8 h-8 text-green-400" />}
            label="Total Audits Tracked"
            value={totalAudits}
          />
          <StatCard
            icon={<Users className="w-8 h-8 text-blue-400" />}
            label="Registered Users"
            value={userList.length}
          />
          <StatCard
            icon={<HardDrive className="w-8 h-8 text-amber-400" />}
            label="Total Saved Reports"
            value={reportsHistory.length}
          />
        </div>
      </div>

      {/* Registered Users Section */}
      <div className="pt-4 border-t border-slate-700">
        <h3 className="text-xl font-bold text-white mb-4 flex items-center">
          <Users className="w-5 h-5 mr-2 text-blue-400" /> Registered Users ({userList.length})
        </h3>
        <div className="max-h-96 overflow-y-auto pr-3 space-y-4 custom-scrollbar">
          {userList.map((user, index) => (
            <UserCard key={index} user={user} />
          ))}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="pt-4 border-t border-slate-700">
        <h3 className="text-xl font-bold text-white mb-4">Recent Audit Activity</h3>
        <div className="space-y-3">
          {recentReports.length > 0 ? (
            recentReports.map(item => (
              <div
                key={item.id}
                className="flex justify-between items-center p-3 bg-slate-700/50 rounded-lg border border-slate-700"
              >
                <div>
                  <p className="text-sm font-medium text-white">{item.bidName}</p>
                  <p className="text-xs text-slate-400">vs {item.rfqName}</p>
                </div>
                <span className="text-xs text-slate-500">
                  {new Date(item.timestamp).toLocaleDateString()}
                </span>
              </div>
            ))
          ) : (
            <p className="text-slate-400 italic text-sm">No saved reports found in the database.</p>
          )}
        </div>
      </div>
    </div>
  );
};



// --- Common Audit Component (Usage limits removed) ---
const AuditPage = ({ 
    title, rfqTitle, bidTitle, role, handleAnalyze, usageLimits, 
    setCurrentPage, currentUser, loading, RFQFile, BidFile, setRFQFile, setBidFile, 
    generateTestData, errorMessage, report, saveReport, saving, setErrorMessage, userId
}) => {

    const handleSave = () => {
        saveReport(role);
    };
    
    // --- NEW: Conditional Back Button Logic ---
    const handleBack = () => {
        if (currentUser && currentUser.role === 'ADMIN') {
            setCurrentPage(PAGE.ADMIN); // Admins go back to their dashboard
        } else {
            setCurrentPage(PAGE.HOME); // Standard users log out
        }
    };

    // --- NEW: Conditional Header Message ---
    const HeaderMessage = () => {
        if (currentUser && currentUser.role === 'ADMIN') {
            return (
                <p className="text-green-400 text-sm font-semibold">
                    **Welcome, {currentUser.name}! | ADMIN VIEW: Total Audits Tracked: {usageLimits}**
                </p>
            );
        }
        
        // Standard users and fallback will just see this
        return (
            <p className="text-green-400 text-sm font-semibold">
                **Uninterrupted Mode Active.**
            </p>
        );
    };

    return (
        <>
            <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl shadow-black/50 border border-slate-700">
                <div className="flex justify-between items-center mb-6 border-b border-slate-700 pb-3">
                    <h2 className="text-2xl font-bold text-white">{title}</h2>
                    <button
                        onClick={handleBack}
                        className="text-sm text-slate-400 hover:text-amber-500 flex items-center"
                    >
                        <ArrowLeft className="w-4 h-4 mr-1"/> 
                        {currentUser && currentUser.role === 'ADMIN' ? 'Back to Admin Dashboard' : 'Logout'}
                    </button>
                </div>

                {/* --- UPDATED: Conditional Header --- */}
                <div className="text-center mb-6 p-3 rounded-xl bg-green-900/40 border border-green-700">
                    <HeaderMessage />
                </div>
                
                {/* Test Data Generator Button */}
                <button
                    onClick={generateTestData}
                    disabled={loading}
                    className="mb-6 w-full flex items-center justify-center px-4 py-3 text-sm font-semibold rounded-xl text-slate-900 bg-teal-400 hover:bg-teal-300 disabled:opacity-30 transition-all shadow-md shadow-teal-900/50"
                >
                    <Zap className="h-5 w-5 mr-2" />
                    LOAD DEMO DOCUMENTS
                </button>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <FileUploader
                        title={rfqTitle}
                        file={RFQFile}
                        setFile={(e) => handleFileChange(e, setRFQFile, setErrorMessage)}
                        color="blue"
                        requiredText="Defines the mandatory requirements. Accepts: .txt, .pdf, .docx"
                    />
                    <FileUploader
                        title={bidTitle}
                        file={BidFile}
                        setFile={(e) => handleFileChange(e, setBidFile, setErrorMessage)}
                        color="green"
                        requiredText="The document responding to the RFQ. Accepts: .txt, .pdf, .docx"
                    />
                </div>
                
                {errorMessage && (
                    <div className={`mt-6 p-4 ${errorMessage.includes('Mock documents loaded') ? 'bg-blue-900/40 text-blue-300 border-blue-700' : 'bg-red-900/40 text-red-300 border-red-700'} border rounded-xl flex items-center`}>
                        <AlertTriangle className="w-5 h-5 mr-3"/>
                        <p className="text-sm font-medium">{errorMessage}</p>
                    </div>
                )}
                
                {/* Analyze Button */}
                <button
                    onClick={() => handleAnalyze(role)}
                    disabled={loading || !RFQFile || !BidFile}
                    className={`mt-8 w-full flex items-center justify-center px-8 py-4 text-lg font-semibold rounded-xl text-slate-900 transition-all shadow-xl 
                        bg-amber-500 hover:bg-amber-400 shadow-amber-900/50 disabled:opacity-50
                    `}
                >
                    {loading ? (
                        <Loader2 className="animate-spin h-6 w-6 mr-3" />
                    ) : (
                        <Send className="h-6 w-6 mr-3" />
                    )}
                    {loading ? 'ANALYZING COMPLEX DOCUMENTS...' : 'RUN COMPLIANCE AUDIT'}
                </button>

                {/* Save Button (Conditional) */}
                {report && userId && ( 
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="mt-4 w-full flex items-center justify-center px-8 py-3 text-md font-semibold rounded-xl text-white bg-slate-600 hover:bg-slate-500 disabled:opacity-50 transition-all"
                    >
                        <Save className="h-5 w-5 mr-2" />
                        {saving ? 'SAVING...' : 'SAVE REPORT TO HISTORY'}
                    </button>
                )}
                
                {/* NEW: Go to History Button (Conditional on report) */}
                {(report || userId) && ( // Show if a report exists, or if user is logged in
                    <button
                        onClick={() => setCurrentPage(PAGE.HISTORY)}
                        className="mt-2 w-full flex items-center justify-center px-8 py-3 text-md font-semibold rounded-xl text-white bg-slate-700/80 hover:bg-slate-700 transition-all"
                    >
                        <List className="h-5 w-5 mr-2" />
                        VIEW ALL SAVED REPORTS
                    </button>
                )}
            </div>

            {/* Compliance Report Section (Only rendered if report is present) */}
            {report && <ComplianceReport report={report} />}
        </>
    );
};

// FileUploader Component
const FileUploader = ({ title, file, setFile, color, requiredText }) => (
    <div className={`p-6 border-2 border-dashed border-${color}-600/50 rounded-2xl bg-slate-900/50 space-y-3`}>
        {/* --- Title size reduced from text-xl to text-lg here --- */}
        <h3 className={`text-lg font-bold text-${color}-400 flex items-center`}>
            <FileUp className={`w-6 h-6 mr-2 text-${color}-500`} /> {title}
        </h3>
        <p className="text-sm text-slate-400">{requiredText}</p>
        <input
            type="file"
            accept=".txt,.pdf,.docx" 
            onChange={setFile}
            className="w-full text-base text-slate-300 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold"
        />
        {file && (
            <p className="text-sm font-medium text-green-400 flex items-center">
                <CheckCircle className="w-4 h-4 mr-1 text-green-500" /> Loaded: {file.name}
            </p>
        )}
    </div>
);

// ComplianceReport Component (Simplified)
const ComplianceReport = ({ report }) => {
    const findings = report.findings || []; 
    
    // --- Data Calculation ---
    const overallPercentage = getCompliancePercentage(report);
    const totalRequirements = findings.length;
    
    const counts = findings.reduce((acc, item) => {
        const flag = item.flag && ['COMPLIANT', 'PARTIAL', 'NON-COMPLIANT'].includes(item.flag) ? item.flag : 'NON-COMPLIANT';
        acc[flag] = (acc[flag] || 0) + 1;
        return acc;
    }, { 'COMPLIANT': 0, 'PARTIAL': 0, 'NON-COMPLIANT': 0 });

    const getWidth = (flag) => {
        if (totalRequirements === 0) return '0%';
        return `${(counts[flag] / totalRequirements) * 100}%`;
    };

    const getFlagColor = (flag) => {
        switch (flag) {
            case 'COMPLIANT': return 'bg-green-700/30 text-green-300 border-green-500/50';
            case 'PARTIAL': return 'bg-amber-700/30 text-amber-300 border-amber-500/50';
            case 'NON-COMPLIANT': return 'bg-red-700/30 text-red-300 border-red-500/50';
            default: return 'bg-gray-700/30 text-gray-300 border-gray-500/50';
        }
    };
    
    const getCategoryColor = (category) => {
        switch (category) {
            case 'TECHNICAL': return 'bg-purple-700 text-purple-200';
            case 'FINANCIAL': return 'bg-green-700 text-green-200';
            case 'LEGAL': return 'bg-red-700 text-red-200';
            case 'TIMELINE': return 'bg-blue-700 text-blue-200';
            case 'REPORTING': return 'bg-yellow-700 text-yellow-200';
            case 'ADMINISTRATIVE': return 'bg-indigo-700 text-indigo-200';
            default: return 'bg-slate-700 text-slate-400';
        }
    };
    
    // --- Risk Color removed ---

    return (
        <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl shadow-black/50 border border-slate-700 mt-8">
            <h2 className="text-3xl font-extrabold text-white flex items-center mb-6 border-b border-slate-700 pb-4">
                <List className="w-6 h-6 mr-3 text-amber-400"/> Comprehensive Compliance Report
            </h2>

            {/* --- Executive Summary Section --- */}
            <div className="mb-8 p-6 bg-slate-700/50 rounded-xl border border-blue-600/50">
                <h3 className="text-2xl font-bold text-blue-300 mb-3 flex items-center">
                    <FileText className="w-5 h-5 mr-2"/> Executive Summary
                </h3>
                <p className="text-slate-300 leading-relaxed italic">
                    {report.executiveSummary}
                </p>
            </div>
            
            {/* --- Score Visualization Section (Simplified) --- */}
            <div className="mb-10 p-5 bg-slate-700/50 rounded-xl border border-amber-600/50 shadow-inner">
                <div className="p-4 bg-slate-900 rounded-xl border border-slate-700 text-center">
                    <p className="text-sm font-semibold text-white flex items-center justify-center mb-1">
                        <BarChart2 className="w-4 h-4 mr-1 text-slate-400"/> Standard Compliance Percentage (Unweighted):
                    </p>
                    <div className="text-5xl font-extrabold text-amber-400 tracking-wide">
                        {overallPercentage}%
                    </div>
                </div>

                {/* Stacked Bar Chart */}
                <div className="h-4 bg-slate-900 rounded-full flex overflow-hidden mt-6 mb-4">
                    <div 
                        style={{ width: getWidth('COMPLIANT') }} 
                        className="bg-green-500 transition-all duration-500"
                        title={`${counts.COMPLIANT} Compliant`}
                    ></div>
                    <div 
                        style={{ width: getWidth('PARTIAL') }} 
                        className="bg-amber-500 transition-all duration-500"
                        title={`${counts.PARTIAL} Partial`}
                    ></div>
                    <div 
                        style={{ width: getWidth('NON-COMPLIANT') }} 
                        className="bg-red-500 transition-all duration-500"
                        title={`${counts['NON-COMPLIANT']} Non-Compliant`}
                    ></div>
                </div>

                {/* Key Metrics */}
                <div className="grid grid-cols-3 gap-4 text-center text-sm font-medium">
                    <MetricPill label="Compliant" count={counts.COMPLIANT} color="text-green-400" />
                    <MetricPill label="Partial" count={counts.PARTIAL} color="text-amber-400" />
                    <MetricPill label="Non-Compliant" count={counts['NON-COMPLIANT']} color="text-red-400" />
                </div>
            </div>

            {/* --- Detailed Findings Matrix --- */}
            <h3 className="text-2xl font-bold text-white mb-6 border-b border-slate-700 pb-3">
                Detailed Findings ({totalRequirements} Requirements)
            </h3>
            <div className="space-y-8">
                {findings.map((item, index) => (
                    <div key={index} className="p-6 border border-slate-700 rounded-xl shadow-md space-y-3 bg-slate-800 hover:bg-slate-700/50 transition">
                        <div className="flex flex-wrap justify-between items-start">
                            <h3 className="text-xl font-bold text-white mb-2 sm:mb-0">
                                Requirement #{index + 1}
                            </h3>
                            {/* Tags Group */}
                            <div className="flex flex-col sm:flex-row items-end sm:items-center space-y-2 sm:space-y-0 sm:space-x-3">
                                {/* Category Tag */}
                                {item.category && (
                                    <div className={`px-2 py-0.5 text-xs font-bold rounded-full ${getCategoryColor(item.category)} flex items-center`}>
                                        <Tag className="w-3 h-3 mr-1"/> {item.category}
                                    </div>
                                )}
                                {/* Compliance Flag */}
                                <div className={`px-4 py-1 text-sm font-semibold rounded-full border ${getFlagColor(item.flag)}`}>
                                    {item.flag} ({item.complianceScore})
                                </div>
                            </div>
                        </div>

                        <p className="font-semibold text-slate-300 mt-2">RFQ Requirement Extracted:</p>
                        <p className="p-4 bg-slate-900/80 text-slate-200 rounded-lg border border-slate-700 italic text-sm leading-relaxed">
                            {item.requirementFromRFQ}
                        </p>

                        <p className="font-semibold text-slate-300 mt-4">Bidder's Response Summary:</p>
                        <p className="text-slate-400 leading-relaxed text-sm">
                            {item.bidResponseSummary}
                        </p>
                        
                        {/* --- NEW: Negotiation Friendly Stance --- */}
                        {item.negotiationStance && (
                            <div className="mt-4 p-4 bg-blue-900/40 border border-blue-700 rounded-xl space-y-2">
                                <p className="font-semibold text-blue-300 flex items-center">
                                    <Briefcase className="w-4 h-4 mr-2"/> Recommended Negotiation Stance:
                                </p>
                                <p className="text-blue-200 leading-relaxed text-sm">
                                    {item.negotiationStance}
                                </p>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

// Simple component for metrics below the chart
const MetricPill = ({ label, count, color }) => (
    <div className="p-2 rounded-lg bg-slate-800 border border-slate-700">
        <div className={`text-xl font-bold ${color}`}>{count}</div>
        <div className="text-slate-400 text-xs mt-1">{label}</div>
    </div>
);

// --- Compliance Ranking Component (Uses the standard score for historical comparison) ---
const ComplianceRanking = ({ reportsHistory, loadReportFromHistory, deleteReport, currentUser }) => { // Receives currentUser
    if (reportsHistory.length === 0) return null;

    // 1. Group by RFQ Title
    const groupedReports = reportsHistory.reduce((acc, report) => {
        const rfqName = report.rfqName;
        // Only use standard percentage now
        const percentage = getCompliancePercentage(report); 
        
        const reportWithScore = { ...report, percentage }; 

        if (!acc[rfqName]) {
            acc[rfqName] = { 
                allReports: [],
                count: 0
            };
        }

        acc[rfqName].allReports.push(reportWithScore);
        acc[rfqName].count += 1;
        
        return acc;
    }, {});
    
    // Convert to an array for rendering and filtering
    const rankedProjects = Object.entries(groupedReports)
        .filter(([_, data]) => data.allReports.length >= 1) 
        .sort(([nameA], [nameB]) => nameA.localeCompare(nameB));


    // 2. Function to sort and assign ranks (based on standard percentage)
    const getRankedReports = (reports) => {
        // Sort by percentage (DESC) and then by timestamp (ASC, for stable sorting of ties)
        const sortedReports = reports.sort((a, b) => {
            if (b.percentage !== a.percentage) {
                return b.percentage - a.percentage; // Higher standard score first
            }
            return a.timestamp - b.timestamp; // Earlier submission date first (arbitrary tie-breaker)
        });
        
        let currentRank = 1;
        let lastPercentage = -1;
        
        return sortedReports.map((report, index) => {
            // Check for a score drop from the previous report
            if (report.percentage < lastPercentage) {
                currentRank = index + 1;
            }
            lastPercentage = report.percentage;
            
            return { ...report, rank: currentRank };
        });
    };


    return (
        <div className="mt-8">
            <h2 className="text-xl font-bold text-white flex items-center mb-4 border-b border-slate-700 pb-2">
                <Layers className="w-5 h-5 mr-2 text-blue-400"/> Compliance Ranking by RFQ
            </h2>
            <p className="text-sm text-slate-400 mb-6">
                All saved bids are ranked by compliance score for each specific RFQ.
            </p>
            
            <div className="space-y-6">
                {rankedProjects.map(([rfqName, data]) => {
                    const rankedReports = getRankedReports(data.allReports);

                    return (
                        <div key={rfqName} className="p-5 bg-slate-700/50 rounded-xl border border-slate-600 shadow-lg">
                            <h3 className="text-lg font-extrabold text-amber-400 mb-4 border-b border-slate-600 pb-2">
                                {rfqName} <span className="text-sm font-normal text-slate-400">({data.count} Total Bids Audited)</span>
                            </h3>
                            <div className="space-y-3">
                                {rankedReports.map((report) => (
                                    <div 
                                        key={report.id} 
                                        className={`p-3 rounded-lg border border-slate-600 bg-slate-900/50 space-y-2 flex justify-between items-center transition hover:bg-slate-700/50`}
                                    >
                                        <div className='flex items-center min-w-0 cursor-pointer' onClick={() => loadReportFromHistory(report)}>
                                            <div className="text-xl font-extrabold text-amber-500 w-8 flex-shrink-0">
                                                #{report.rank}
                                            </div>
                                            <div className='ml-3 min-w-0'>
                                                <p className="text-sm font-medium text-white truncate" title={report.bidName}>
                                                    {report.bidName}
                                                </p>
                                                <p className="text-xs text-slate-400">
                                                    Audited on: {new Date(report.timestamp).toLocaleDateString()}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex-shrink-0 text-right space-y-1 flex items-center">
                                            {/* Delete Button for Ranking View - ONLY FOR ADMIN */}
                                            {currentUser && currentUser.role === 'ADMIN' && (
                                                <button
                                                    onClick={() => deleteReport(report.id, report.rfqName, report.bidName)}
                                                    className="mr-2 p-1 rounded bg-red-600 hover:bg-red-500 transition shadow-md"
                                                    title="Click to Delete Report Permanently"
                                                >
                                                    <Trash2 className="w-4 h-4 text-white"/>
                                                </button>
                                            )}
                                            <span className={`px-2 py-0.5 rounded text-sm font-bold bg-blue-600 text-slate-900 block`}>
                                                Score: {report.percentage}%
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};


// History Component
const ReportHistory = ({ reportsHistory, loadReportFromHistory, isAuthReady, userId, setCurrentPage, currentUser, deleteReport }) => { // Receives deleteReport and currentUser
    
    // --- NEW: Conditional Back Button Logic ---
    const handleBack = () => {
        if (currentUser && currentUser.role === 'ADMIN') {
            setCurrentPage(PAGE.ADMIN); // Admins go back to their dashboard
        } else {
            setCurrentPage(PAGE.COMPLIANCE_CHECK); // Standard users go back to the check page
        }
    };
    
    if (!isAuthReady || !userId) {
        return (
            <div className="bg-slate-800 p-8 rounded-2xl border border-red-700 text-center text-red-400">
                <AlertTriangle className="h-5 w-5 inline-block mr-2" />
                History access is currently disabled due to authentication status.
                <button
                    onClick={() => setCurrentPage(PAGE.HOME)}
                    className="mt-4 text-sm text-slate-400 hover:text-white flex items-center mx-auto"
                >
                    <ArrowLeft className="w-4 h-4 mr-1"/> Back to Login
                </button>
            </div>
        );
    }

    return (
        <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl shadow-black/50 border border-slate-700">
            <div className="flex justify-between items-center mb-6 border-b border-slate-700 pb-3">
                <h2 className="text-xl font-bold text-white flex items-center">
                    <Clock className="w-5 h-5 mr-2 text-amber-500"/> Saved Report History ({reportsHistory.length})
                </h2 >
                <button
                    onClick={handleBack}
                    className="text-sm text-slate-400 hover:text-amber-500 flex items-center"
                >
                    <ArrowLeft className="w-4 h-4 mr-1"/> Back to Dashboard
                </button>
            </div>
            
            <ComplianceRanking 
                reportsHistory={reportsHistory} 
                loadReportFromHistory={loadReportFromHistory}
                deleteReport={deleteReport} // Pass delete function
                currentUser={currentUser} // Pass currentUser for RBAC check
            />

            <h3 className="text-lg font-bold text-white mt-8 mb-4 border-b border-slate-700 pb-2">
                All Reports
            </h3>

            {reportsHistory.length === 0 ? (
                <p className="text-slate-400 italic">No saved reports found. Run an audit and click 'Save Report' to populate history.</p>
            ) : (
                <div className="space-y-4">
                    {reportsHistory.map(item => {
                        const date = new Date(item.timestamp);
                        const percentage = getCompliancePercentage(item);
                        const scoreColor = percentage >= 80 ? 'text-green-400' : percentage >= 50 ? 'text-amber-400' : 'text-red-400';
                        const roleLabel = item.role === 'BIDDER' ? 'Self-Check' : 'Initiator Audit';

                        return (
                            <div key={item.id} className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 bg-slate-700/50 rounded-xl border border-slate-700 transition hover:bg-slate-700/80">
                                <div className="space-y-1 sm:space-y-0 sm:mr-4">
                                    <p className="text-sm font-semibold text-white">
                                        <span className={`px-2 py-0.5 rounded-full ${scoreColor} border border-current mr-2 text-xs font-mono`}>{percentage}%</span>
                                        {item.rfqName} vs {item.bidName}
                                    </p>
                                    <p className="text-xs text-slate-500 italic">
                                        Mode: {roleLabel}
                                    </p>
                                    <p className="text-xs text-slate-400">
                                        Audited on: {date.toLocaleDateString()} {date.toLocaleTimeString()}
                                    </p>
                                </div>
                                <div className='flex items-center mt-3 sm:mt-0 space-x-2'>
                                    {/* Load Button */}
                                    <button
                                        onClick={() => loadReportFromHistory(item)}
                                        className="flex items-center px-4 py-2 text-xs font-semibold rounded-lg text-slate-900 bg-amber-500 hover:bg-amber-400 transition"
                                    >
                                        <ArrowLeft className="w-3 h-3 mr-1 rotate-180"/> Load
                                    </button>
                                    {/* Delete Button - ONLY RENDERED FOR ADMIN */}
                                    {currentUser && currentUser.role === 'ADMIN' && (
                                        <button
                                            onClick={() => deleteReport(item.id, item.rfqName, item.bidName)}
                                            className="flex items-center px-4 py-2 text-xs font-semibold rounded-lg text-white bg-red-600 hover:bg-red-500 transition shadow-md"
                                            title="Click to Delete Report Permanently"
                                        >
                                            <Trash2 className="w-3 h-3 mr-1"/> Delete
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};


// --- Top-level export component using the ErrorBoundary ---
function TopLevelApp() {
    return (
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    );
}

export default TopLevelApp;
