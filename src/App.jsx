import React, { useState, useCallback, useEffect } from 'react';
import { 
    FileUp, Send, Loader2, AlertTriangle, CheckCircle, List, FileText, BarChart2,
    Save, Clock, Zap, ArrowLeft, Users, Briefcase, Layers, UserPlus, LogIn, Tag,
    Shield, User, HardDrive, Phone, Mail, Building, Trash2, Eye, DollarSign, Activity, Printer, Download
} from 'lucide-react'; 

// --- FIREBASE IMPORTS ---
import { initializeApp } from 'firebase/app';
import { 
    getAuth, onAuthStateChanged, createUserWithEmailAndPassword, 
    signInWithEmailAndPassword 
} from 'firebase/auth';
import { 
    getFirestore, collection, addDoc, onSnapshot, query, doc, setDoc, 
    runTransaction, deleteDoc, getDocs, getDoc, collectionGroup
} from 'firebase/firestore'; 

// --- FIREBASE INITIALIZATION ---
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
const API_KEY = import.meta.env.VITE_API_KEY; 
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${API_MODEL}:generateContent?key=${API_KEY}`;

const CATEGORY_ENUM = ["LEGAL", "FINANCIAL", "TECHNICAL", "TIMELINE", "REPORTING", "ADMINISTRATIVE", "OTHER"];

const PAGE = {
    HOME: 'HOME',
    COMPLIANCE_CHECK: 'COMPLIANCE_CHECK', 
    ADMIN: 'ADMIN',                     
    HISTORY: 'HISTORY' 
};

// --- UPDATED JSON Schema (Project Title & O&G Support) ---
const COMPREHENSIVE_REPORT_SCHEMA = {
    type: "OBJECT",
    description: "The complete compliance audit report with market intelligence data.",
    properties: {
        "projectTitle": {
            "type": "STRING",
            "description": "Extract the OFFICIAL PROJECT TITLE from the RFQ cover page or header. Do not use the filename. Example: 'Offshore Pipeline Maintenance Phase 2'."
        },
        "rfqScopeSummary": {
            "type": "STRING",
            "description": "A high-level summary (2-3 sentences) combining the 'Project Background' and 'Scope of Work' from the RFQ."
        },
        "grandTotalValue": {
            "type": "STRING",
            "description": "Extract the total proposed Bid Price/Cost from the Bid Document (e.g., '$450,000' or 'Not Disclosed'). If unclear, estimate or state 'Unknown'."
        },
        "industryTag": {
            "type": "STRING",
            "description": "Classify the project into ONE industry sector. Options: 'Energy / Oil & Gas', 'Construction', 'IT/SaaS', 'Healthcare', 'Logistics', 'Consulting', 'Manufacturing', 'Financial', or 'Other'. NOTE: If keywords like drilling, offshore, pipeline, or refinery are present, classify as 'Energy / Oil & Gas' instead of Construction."
        },
        "primaryRisk": {
            "type": "STRING",
            "description": "In 5 words or less, state the biggest deal-breaker risk found in the bid."
        },
        "executiveSummary": {
            "type": "STRING",
            "description": "A concise, high-level summary of the compliance audit findings."
        },
        "findings": {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    "requirementFromRFQ": { "type": "STRING" },
                    "complianceScore": { "type": "NUMBER" },
                    "bidResponseSummary": { "type": "STRING" },
                    "flag": { "type": "STRING", "enum": ["COMPLIANT", "PARTIAL", "NON-COMPLIANT"] },
                    "category": { "type": "STRING", "enum": CATEGORY_ENUM },
                    "negotiationStance": { "type": "STRING" }
                }
            }
        }
    },
    "required": ["projectTitle", "rfqScopeSummary", "grandTotalValue", "industryTag", "primaryRisk", "executiveSummary", "findings"]
};

// --- API Utility ---
const fetchWithRetry = async (url, options, maxRetries = 3) => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            return response;
        } catch (error) {
            if (i === maxRetries - 1) throw error; 
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
        }
    }
};

// --- FIRESTORE UTILITIES ---
const getUsageDocRef = (db, userId) => {
    return doc(db, `users/${userId}/usage_limits`, 'main_tracker');
};

const getReportsCollectionRef = (db, userId) => {
    return collection(db, `users/${userId}/compliance_reports`);
};

// --- Calculation Utility ---
const getCompliancePercentage = (report) => {
    const findings = report.findings || []; 
    const totalScore = findings.reduce((sum, item) => sum + (item.complianceScore || 0), 0);
    const maxScore = findings.length * 1;
    return maxScore > 0 ? parseFloat(((totalScore / maxScore) * 100).toFixed(1)) : 0;
};

// --- File Processor ---
const processFile = (file) => {
    return new Promise(async (resolve, reject) => {
        const fileExtension = file.name.split('.').pop().toLowerCase();
        const reader = new FileReader();

        if (fileExtension === 'txt') {
            reader.onload = (event) => resolve(event.target.result);
            reader.onerror = reject;
            reader.readAsText(file);
        } else if (fileExtension === 'pdf') {
            if (typeof window.pdfjsLib === 'undefined') return reject("PDF lib not loaded.");
            reader.onload = async (event) => {
                try {
                    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(event.target.result) }).promise;
                    let fullText = '';
                    for (let i = 1; i <= pdf.numPages; i++) {
                        const page = await pdf.getPage(i);
                        const textContent = await page.getTextContent();
                        fullText += textContent.items.map(item => item.str).join(' ') + '\n\n'; 
                    }
                    resolve(fullText);
                } catch (e) { reject(e.message); }
            };
            reader.readAsArrayBuffer(file);
        } else if (fileExtension === 'docx') {
            if (typeof window.mammoth === 'undefined') return reject("DOCX lib not loaded.");
            reader.onload = async (event) => {
                try {
                    const result = await window.mammoth.extractRawText({ arrayBuffer: event.target.result });
                    resolve(result.value); 
                } catch (e) { reject(e.message); }
            };
            reader.readAsArrayBuffer(file);
        } else {
            reject('Unsupported file type.');
        }
    });
};

// --- Error Boundary ---
class ErrorBoundary extends React.Component {
    constructor(props) { super(props); this.state = { hasError: false, error: null }; }
    static getDerivedStateFromError(error) { return { hasError: true }; }
    componentDidCatch(error, errorInfo) { this.setState({ error, errorInfo }); }
    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen bg-red-900 font-body p-8 text-white flex items-center justify-center">
                    <div className="bg-red-800 p-8 rounded-xl border border-red-500 max-w-lg">
                        <AlertTriangle className="w-8 h-8 text-red-300 mx-auto mb-4"/>
                        <h2 className="text-xl font-bold mb-2">Critical Application Error</h2>
                        <p className="text-sm font-mono">{this.state.error && this.state.error.toString()}</p>
                    </div>
                </div>
            );
        }
        return this.props.children; 
    }
}

// --- Components ---
const handleFileChange = (e, setFile, setErrorMessage) => {
    if (e.target.files.length > 0) {
        setFile(e.target.files[0]);
        if (setErrorMessage) setErrorMessage(null); 
    }
};

const FormInput = ({ label, name, value, onChange, type, placeholder, id }) => (
    <div>
        <label htmlFor={id || name} className="block text-sm font-medium text-slate-300 mb-1">{label}</label>
        <input
            id={id || name}
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

const AuthPage = ({ setCurrentPage, setErrorMessage, errorMessage, db, auth }) => {
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
            const userCred = await createUserWithEmailAndPassword(auth, regForm.email, regForm.password);
            await setDoc(doc(db, 'users', userCred.user.uid), {
                name: regForm.name,
                designation: regForm.designation,
                company: regForm.company,
                email: regForm.email,
                phone: regForm.phone,
                role: 'USER',
                createdAt: Date.now()
            });
            setLoginForm({ email: regForm.email, password: regForm.password });
            setErrorMessage('SUCCESS: Registration complete! Credentials autofilled. Please Sign In below.');
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
            await signInWithEmailAndPassword(auth, loginForm.email, loginForm.password);
            setCurrentPage(PAGE.COMPLIANCE_CHECK);
        } catch (err) {
            console.error('Login error', err);
            setErrorMessage(err.message || 'Login failed.');
            setIsSubmitting(false);
        }
    };

    const isSuccess = errorMessage && errorMessage.includes('SUCCESS');

    return (
        <div className="p-8 bg-slate-800 rounded-2xl shadow-2xl shadow-black/50 border border-slate-700 mt-12 mb-12">
            <h2 className="text-3xl font-extrabold text-white text-center">Welcome to SmartBids</h2>
            <p className="text-lg font-medium text-blue-400 text-center mb-6">AI-Driven Bid Compliance Audit: Smarter Bids, Every Time!</p>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="p-6 bg-slate-700/50 rounded-xl border border-blue-500/50 shadow-inner space-y-4">
                    <h3 className="text-2xl font-bold text-blue-300 flex items-center mb-4"><UserPlus className="w-6 h-6 mr-2" /> Create Account</h3>
                    <form onSubmit={handleRegister} className="space-y-3">
                        <FormInput id="reg-name" label="Full Name *" name="name" value={regForm.name} onChange={handleRegChange} type="text" />
                        <FormInput id="reg-designation" label="Designation" name="designation" value={regForm.designation} onChange={handleRegChange} type="text" />
                        <FormInput id="reg-company" label="Company" name="company" value={regForm.company} onChange={handleRegChange} type="text" />
                        <FormInput id="reg-email" label="Email *" name="email" value={regForm.email} onChange={handleRegChange} type="email" />
                        <FormInput id="reg-phone" label="Contact Number" name="phone" value={regForm.phone} onChange={handleRegChange} type="tel" placeholder="Optional" />
                        <FormInput id="reg-password" label="Create Password *" name="password" value={regForm.password} onChange={handleRegChange} type="password" />

                        <button type="submit" disabled={isSubmitting} className={`w-full py-3 text-lg font-semibold rounded-xl text-slate-900 transition-all shadow-lg mt-6 bg-blue-400 hover:bg-blue-300 disabled:opacity-50 flex items-center justify-center`}>
                            {isSubmitting ? <Loader2 className="animate-spin h-5 w-5 mr-2" /> : <UserPlus className="h-5 w-5 mr-2" />}
                            {isSubmitting ? 'Registering...' : 'Register'}
                        </button>
                    </form>
                </div>

                <div className="p-6 bg-slate-700/50 rounded-xl border border-green-500/50 shadow-inner flex flex-col justify-center">
                    <h3 className="text-2xl font-bold text-green-300 flex items-center mb-4"><LogIn className="w-6 h-6 mr-2" /> Sign In</h3>
                    <form onSubmit={handleLogin} className="space-y-4">
                        <FormInput id="login-email" label="Email *" name="email" value={loginForm.email} onChange={handleLoginChange} type="email" />
                        <FormInput id="login-password" label="Password *" name="password" value={loginForm.password} onChange={handleLoginChange} type="password" />

                        <button type="submit" disabled={isSubmitting} className={`w-full py-3 text-lg font-semibold rounded-xl text-slate-900 transition-all shadow-lg mt-6 bg-green-400 hover:bg-green-300 disabled:opacity-50 flex items-center justify-center`}>
                            {isSubmitting ? <Loader2 className="animate-spin h-5 w-5 mr-2" /> : <LogIn className="h-5 w-5 mr-2" />}
                            {isSubmitting ? 'Signing in...' : 'Sign In'}
                        </button>
                    </form>

                    {errorMessage && (
                        <div className={`mt-4 p-3 ${isSuccess ? 'bg-green-900/40 text-green-300 border-green-700' : 'bg-red-900/40 text-red-300 border-red-700'} border rounded-xl flex items-center`}>
                            {isSuccess ? <CheckCircle className="w-5 h-5 mr-3"/> : <AlertTriangle className="w-5 h-5 mr-3"/>}
                            <p className="text-sm font-medium">{errorMessage}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// --- MAIN APP COMPONENT ---
const App = () => {
    const [currentPage, setCurrentPage] = useState(PAGE.HOME);
    const [errorMessage, setErrorMessage] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [currentUser, setCurrentUser] = useState(null);
    const [userId, setUserId] = useState(null);
    const [usageLimits, setUsageLimits] = useState({ initiatorChecks: 0, bidderChecks: 0, isSubscribed: true });
    const [reportsHistory, setReportsHistory] = useState([]);
    
    // File & Report State
    const [RFQFile, setRFQFile] = useState(null);
    const [BidFile, setBidFile] = useState(null);
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    // --- EFFECT 1: Auth State Listener ---
    useEffect(() => {
        if (!auth) return;
        
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                setUserId(user.uid);
                setCurrentPage(prev => prev === PAGE.HOME ? PAGE.COMPLIANCE_CHECK : prev);
                
                try {
                    const userDoc = await getDoc(doc(db, 'users', user.uid));
                    if (userDoc.exists()) {
                        setCurrentUser({ uid: user.uid, ...userDoc.data() });
                    } else {
                        setCurrentUser({ uid: user.uid, role: 'USER' });
                    }
                } catch (error) {
                    console.error("Error fetching user profile:", error);
                    setCurrentUser({ uid: user.uid, role: 'USER' });
                }
            } else {
                setUserId(null);
                setCurrentUser(null);
                setCurrentPage(PAGE.HOME);
            }
            setIsAuthReady(true);
        });

        return () => unsubscribe();
    }, []);

    // --- EFFECT 2: Usage Limits Listener ---
    useEffect(() => {
        if (db && userId) {
            const docRef = getUsageDocRef(db, userId);

            const unsubscribe = onSnapshot(docRef, (docSnap) => {
                if (docSnap.exists()) {
                    setUsageLimits({ ...docSnap.data(), isSubscribed: true });
                } else {
                    const initialData = { initiatorChecks: 0, bidderChecks: 0, isSubscribed: true };
                    setDoc(docRef, initialData).catch(e => console.error("Error creating usage doc:", e));
                    setUsageLimits(initialData);
                }
            }, (error) => console.error("Error listening to usage limits:", error));

            return () => unsubscribe();
        }
    }, [userId]);

    // --- EFFECT 3: Report History Listener (Admin Aware) ---
    useEffect(() => {
        if (!db || !currentUser) return;

        let unsubscribeSnapshot = null;
        let q;

        try {
            if (currentUser.role === 'ADMIN') {
                const collectionGroupRef = collectionGroup(db, 'compliance_reports');
                q = query(collectionGroupRef);
            } else if (userId) {
                const reportsRef = getReportsCollectionRef(db, userId);
                q = query(reportsRef);
            }

            if (q) {
                unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
                    const history = [];
                    snapshot.forEach(docSnap => {
                        const ownerId = docSnap.ref.parent.parent ? docSnap.ref.parent.parent.id : userId;
                        history.push({ 
                            id: docSnap.id, 
                            ownerId: ownerId, 
                            ...docSnap.data() 
                        });
                    });
                    history.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                    setReportsHistory(history);
                }, (error) => {
                    console.error('Error listening to reports:', error);
                });
            }
        } catch (err) {
            console.error("Error setting up history listener:", err);
        }

        return () => unsubscribeSnapshot && unsubscribeSnapshot();
    }, [userId, currentUser]);

    // --- EFFECT 4: Load Libraries ---
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
                script.onerror = () => reject(new Error(`Failed to load external script for ${libraryName}: ${src}`));
                document.head.appendChild(script);
            });
        };

        const loadAllLibraries = async () => {
            try {
                await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js", "PDF.js");
                if (window.pdfjsLib) {
                    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
                }
            } catch (e) {
                console.warn("PDF support will be unavailable.");
            }
            try {
                await loadScript("https://cdnjs.cloudflare.com/ajax/libs/mammoth.js/1.4.15/mammoth.browser.min.js", "Mammoth.js");
            } catch (e) {
                console.warn("DOCX support will be unavailable.");
            }
        };
        
        loadAllLibraries();
    }, []); 

    // --- LOGIC: Increment Usage ---
    const incrementUsage = async (roleKey) => {
        if (!db || !userId) return;
        const docRef = getUsageDocRef(db, userId);

        try {
            await runTransaction(db, async (transaction) => {
                const docSnap = await transaction.get(docRef);
                let currentData = docSnap.exists() ? docSnap.data() : { initiatorChecks: 0, bidderChecks: 0, isSubscribed: true };
                if (!docSnap.exists()) transaction.set(docRef, currentData);
                
                const newCount = (currentData[roleKey] || 0) + 1;
                transaction.update(docRef, { [roleKey]: newCount, isSubscribed: true });
                setUsageLimits(prev => ({ ...prev, [roleKey]: newCount }));
            });
        } catch (e) {
            console.error("Transaction failed to update usage:", e);
        }
    };

    // --- CORE LOGIC: Analysis ---
    const handleAnalyze = useCallback(async (role) => {
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
            
            // IMPROVED PROMPT: O&G Support + Project Title Extraction
            const systemPrompt = {
                parts: [{
                    text: `You are the SmartBid Compliance Auditor. Your task is to strictly compare the RFQ and the Bid.
                    
                    1. EXTRACT 'projectTitle': Look for the official Project Title on the cover page or header of the RFQ. Do not use the filename.
                    2. EXTRACT 'grandTotalValue': Find the total price/bid amount. If unclear, say 'Unknown'.
                    3. EXTRACT 'industryTag': INFER the sector. Options: 'Energy / Oil & Gas', 'Construction', 'IT/SaaS', 'Healthcare', 'Logistics', 'Consulting', 'Manufacturing', 'Financial', or 'Other'. 
                       *IMPORTANT*: If words like 'offshore', 'drilling', 'pipeline', 'refinery', or 'petroleum' appear, classify as 'Energy / Oil & Gas'.
                    4. EXTRACT 'primaryRisk': In 5 words or less, what is the biggest deal-breaker risk?
                    5. EXTRACT 'rfqScopeSummary': A 2-3 sentence summary combining the 'Background' and 'Scope of Work' sections of the RFQ.
                    
                    6. Identify mandatory requirements from RFQ.
                    7. Locate corresponding response in Bid.
                    8. Score Compliance: 1 (Full), 0.5 (Partial), 0 (Non-Compliant).
                    9. Category: ${CATEGORY_ENUM.join(', ')}.
                    10. Negotiation Stance: Required for scores < 1.
                    
                    11. Generate JSON output ONLY.`
                }]
            };

            const userQuery = `RFQ Document (Doc A):\n${rfqContent}\n\nBid Document (Doc B):\n${bidContent}\n\nPerform compliance audit.`;
            
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

    // --- CORE LOGIC: Test Data ---
    const generateTestData = useCallback(async () => {
        const mockRfqContent = `
PROJECT TITLE: OFFSHORE PIPELINE MAINTENANCE PHASE 3
BACKGROUND: This project involves the inspection and repair of subsea pipelines in the North Sea.
SCOPE OF WORK: Contractor shall provide a diving support vessel and ROV team for 60 days.
1. TECHNICAL: The proposed cloud solution must integrate bi-directionally with our legacy billing system via its existing REST/JSON API endpoints, as detailed in Appendix B. This is a mandatory core technical specification.
2. FINANCIAL: Bidders must submit a Firm Fixed Price (FFP) quote for all services covering the first 12 calendar months of operation. Cost estimates or time-and-materials pricing will result in non-compliance.
3. LEGAL: A signed, legally binding Non-Disclosure Agreement (NDA) must be included as a separate document, titled "Appendix A," within the submission package.
4. TIMELINE: The entire migration project, including final testing and sign-off, must be completed and live within 60 calendar days of contract award.
5. ADMINISTRATIVE: The entire bid package (including all appendices) must be submitted electronically as a single, consolidated PDF document.
        `.trim();
        
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
                role: role, 
            });
            
            setErrorMessage("Report saved successfully to history!"); 
            setTimeout(() => setErrorMessage(null), 3000);

        } catch (error) {
            console.error("Error saving report:", error);
            setErrorMessage(`Failed to save: ${error.message}. (Check Firebase Console > Firestore Database > Rules)`);
        } finally {
            setSaving(false);
        }
    }, [db, userId, report, RFQFile, BidFile]);
    
    // --- CORE LOGIC: Delete Report ---
    const deleteReport = useCallback(async (reportId, rfqName, bidName) => {
        if (!db || !userId) {
            setErrorMessage("Database not ready.");
            return;
        }
        setErrorMessage(`Deleting report: ${rfqName} vs ${bidName}...`);
        
        try {
            const reportsRef = getReportsCollectionRef(db, userId);
            const docRef = doc(reportsRef, reportId);
            
            await deleteDoc(docRef);

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
            id: historyItem.id, 
            executiveSummary: historyItem.executiveSummary,
            findings: historyItem.findings,
        });
        setCurrentPage(PAGE.COMPLIANCE_CHECK); 
        setErrorMessage(`Loaded report: ${historyItem.rfqName} vs ${historyItem.bidName}`);
        setTimeout(() => setErrorMessage(null), 3000);
    }, []);
    
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
                    db={db}
                    auth={auth}
                />;
            case PAGE.COMPLIANCE_CHECK:
                return <AuditPage 
                    title="Bidder: Self-Compliance Check"
                    rfqTitle="Request for Quotation (RFQ)" 
                    bidTitle="Bid/Proposal Document" 
                    role="BIDDER"
                    handleAnalyze={handleAnalyze}
                    usageLimits={usageLimits.bidderChecks}
                    setCurrentPage={setCurrentPage}
                    currentUser={currentUser}
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
                    reportsHistory={reportsHistory}
                    loadReportFromHistory={loadReportFromHistory}
                    />;
            case PAGE.HISTORY:
                return <ReportHistory 
                    reportsHistory={reportsHistory} 
                    loadReportFromHistory={loadReportFromHistory} 
                    deleteReport={deleteReport}
                    isAuthReady={isAuthReady} 
                    userId={userId}
                    setCurrentPage={setCurrentPage}
                    currentUser={currentUser}
                />;
            default:
                return <AuthPage 
                    setCurrentPage={setCurrentPage} 
                    setErrorMessage={setErrorMessage} 
                    userId={userId} 
                    isAuthReady={isAuthReady}
                    errorMessage={errorMessage}
                    setCurrentUser={setCurrentUser}
                    db={db}
                    auth={auth}
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
                    font-family: 'Lexend', sans-serif; 
                }
                input[type="file"]::file-selector-button:hover {
                    background-color: #fbbf24;
                }

                /* Custom Scrollbar */
                .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background-color: #475569; 
                    border-radius: 3px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background-color: #1e293b;
                }

                /* PRINT STYLES */
                @media print {
                    body * {
                        visibility: hidden;
                    }
                    #admin-print-area, #admin-print-area * {
                        visibility: visible;
                    }
                    #admin-print-area {
                        position: absolute;
                        left: 0;
                        top: 0;
                        width: 100%;
                        background-color: white;
                        color: black;
                        padding: 20px;
                    }
                    .no-print {
                        display: none !important;
                    }
                    * {
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                }
            `}</style>
            
            <div className="max-w-4xl mx-auto space-y-10">
                {renderPage()}
            </div>
        </div>
    );
};

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

// --- AdminDashboard component (MARKET INTEL ENABLED) ---
const AdminDashboard = ({ setCurrentPage, currentUser, reportsHistory, loadReportFromHistory }) => {
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

  // Calculate Global Stats
  const totalAudits = reportsHistory.length; 
  const recentReports = reportsHistory.slice(0, 15); // Show 15 most recent

  // Helper to find user info for a report
  const getUserForReport = (ownerId) => {
    const found = userList.find(u => u.id === ownerId);
    return found ? `${found.name} (${found.company})` : `User ID: ${ownerId}`;
  };

  // Helper: Export Data to CSV
  const exportToCSV = (data, filename) => {
    if (!data || !data.length) return;
    const csvContent = "data:text/csv;charset=utf-8," 
        + Object.keys(data[0]).join(",") + "\n" 
        + data.map(e => Object.values(e).map(v => `"${v}"`).join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div id="admin-print-area" className="bg-slate-800 p-8 rounded-2xl shadow-2xl shadow-black/50 border border-slate-700 space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-slate-700 pb-4">
        <h2 className="text-3xl font-bold text-white flex items-center">
          <Shield className="w-8 h-8 mr-3 text-red-400" />
          Admin Market Intelligence
        </h2>
        <div className="flex space-x-3 no-print">
            <button
                onClick={() => window.print()}
                className="text-sm text-slate-400 hover:text-white flex items-center bg-slate-700 px-3 py-2 rounded-lg"
            >
                <Printer className="w-4 h-4 mr-2" /> Print
            </button>
            <button
            onClick={() => setCurrentPage('HOME')}
            className="text-sm text-slate-400 hover:text-amber-500 flex items-center"
            >
            <ArrowLeft className="w-4 h-4 mr-1" /> Logout
            </button>
        </div>
      </div>

      {/* Welcome (Hidden on Print) */}
      <p className="text-lg text-slate-300 no-print">
        Welcome, <span className="font-bold text-red-400">{currentUser?.name || 'Admin'}</span>.
        Collecting real-time market data from <span className="text-white font-bold">{userList.length}</span> active vendors.
      </p>

      {/* Quick Actions (Hidden on Print) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 no-print">
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
        <h3 className="text-xl font-bold text-white mb-4">System & Market Stats</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            icon={<HardDrive className="w-8 h-8 text-green-400" />}
            label="Total Bids Processed"
            value={totalAudits}
          />
          <StatCard
            icon={<Users className="w-8 h-8 text-blue-400" />}
            label="Active Vendors"
            value={userList.length}
          />
          <StatCard
            icon={<Layers className="w-8 h-8 text-amber-400" />}
            label="Avg. Compliance"
            value={reportsHistory.length > 0 
                ? Math.round(reportsHistory.reduce((acc, r) => acc + (getCompliancePercentage(r)), 0) / reportsHistory.length) + "%" 
                : "0%"}
          />
        </div>
      </div>

      {/* Live Market Feed (ENHANCED GOD VIEW) */}
      <div className="pt-4 border-t border-slate-700">
        <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-bold text-white flex items-center">
                <Eye className="w-6 h-6 mr-2 text-amber-400" /> Live Market Data Feed
            </h3>
            <button 
                onClick={() => exportToCSV(reportsHistory.map(r => ({
                    id: r.id, 
                    Project: r.projectTitle || r.rfqName, 
                    Vendor: getUserForReport(r.ownerId), 
                    Industry: r.industryTag, 
                    Value: r.grandTotalValue, 
                    Risk: r.primaryRisk,
                    Score: getCompliancePercentage(r)
                })), 'market_data.csv')}
                className="text-xs flex items-center bg-green-700 hover:bg-green-600 text-white px-3 py-1 rounded no-print"
            >
                <Download className="w-3 h-3 mr-1"/> Export CSV
            </button>
        </div>
        
        <div className="space-y-4">
          {recentReports.length > 0 ? (
            recentReports.map(item => {
                const percentage = getCompliancePercentage(item);
                const scoreColor = percentage >= 80 ? 'text-green-400' : percentage >= 50 ? 'text-amber-400' : 'text-red-400';
                const projectTitleDisplay = item.projectTitle || item.rfqName; // Fallback to filename
                
                return (
                  <div 
                    key={item.id} 
                    onClick={() => loadReportFromHistory(item)}
                    className="p-4 bg-slate-900/50 rounded-xl border border-slate-700 shadow-sm hover:bg-slate-900 transition cursor-pointer group"
                  >
                    {/* Row 1: Project & Vendor */}
                    <div className="flex flex-col sm:flex-row justify-between items-start mb-3">
                        <div>
                            <div className="flex items-center flex-wrap gap-2">
                                <span className="px-2 py-0.5 rounded text-xs font-bold bg-blue-900 text-blue-200 border border-blue-700">
                                    {item.industryTag || 'UNCLASSIFIED'}
                                </span>
                                <h4 className="text-lg font-bold text-white group-hover:text-blue-400 transition-colors">{projectTitleDisplay}</h4>
                            </div>
                            <p className="text-sm text-slate-400 mt-1 flex items-center">
                                <User className="w-3 h-3 mr-1"/> Vendor: {getUserForReport(item.ownerId)}
                            </p>
                        </div>
                        <div className="text-right mt-2 sm:mt-0">
                            <div className={`text-xl font-bold ${scoreColor}`}>{percentage}% Compliance</div>
                            <p className="text-xs text-slate-500">{new Date(item.timestamp).toLocaleDateString()}</p>
                        </div>
                    </div>

                    {/* Row 2: The "Money" & "Risk" Layer */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                        <div className="p-3 bg-slate-800 rounded-lg border border-slate-700/50">
                            <p className="text-xs font-semibold text-green-400 mb-1 flex items-center">
                                <DollarSign className="w-3 h-3 mr-1"/> BID VALUE & SCOPE
                            </p>
                            <p className="text-sm text-white font-bold">{item.grandTotalValue || 'Value Not Detected'}</p>
                            <p className="text-xs text-slate-400 italic mt-1 line-clamp-2">"{item.rfqScopeSummary || 'No scope summary.'}"</p>
                        </div>
                        
                        <div className="p-3 bg-slate-800 rounded-lg border border-slate-700/50">
                            <p className="text-xs font-semibold text-red-400 mb-1 flex items-center">
                                <Activity className="w-3 h-3 mr-1"/> PRIMARY RISK FACTOR
                            </p>
                            <p className="text-sm text-slate-200">{item.primaryRisk || 'No risk analysis available.'}</p>
                        </div>
                    </div>
                  </div>
                );
            })
          ) : (
            <p className="text-slate-400 italic text-sm p-4 text-center border border-dashed border-slate-700 rounded-xl">
                No market data collected yet. Run a new audit to populate the dataset.
            </p>
          )}
        </div>
      </div>
      
      {/* Registered Users (FIXED: Table Layout) */}
      <div className="pt-4 border-t border-slate-700">
        <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-bold text-white flex items-center">
                <Users className="w-5 h-5 mr-2 text-blue-400" /> Vendor Registry ({userList.length})
            </h3>
            <button 
                onClick={() => exportToCSV(userList, 'vendor_registry.csv')}
                className="text-xs flex items-center bg-blue-700 hover:bg-blue-600 text-white px-3 py-1 rounded no-print"
            >
                <Download className="w-3 h-3 mr-1"/> Export CSV
            </button>
        </div>
        
        {/* New Table Structure for Registry */}
        <div className="max-h-96 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900">
            <table className="w-full text-left text-sm text-slate-400">
                <thead className="bg-slate-800 text-slate-200 uppercase font-bold sticky top-0">
                    <tr>
                        <th className="px-4 py-3">Name</th>
                        <th className="px-4 py-3">Company</th>
                        <th className="px-4 py-3">Designation</th>
                        <th className="px-4 py-3">Email</th>
                        <th className="px-4 py-3">Phone</th>
                        <th className="px-4 py-3 text-right">Role</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                    {userList.map((user, index) => (
                        <tr key={index} className="hover:bg-slate-800/50 transition">
                            <td className="px-4 py-3 font-medium text-white">{user.name}</td>
                            <td className="px-4 py-3">{user.company}</td>
                            <td className="px-4 py-3">{user.designation}</td>
                            <td className="px-4 py-3">{user.email}</td>
                            <td className="px-4 py-3">{user.phone || 'N/A'}</td>
                            <td className="px-4 py-3 text-right">
                                <span className={`px-2 py-1 rounded text-xs font-bold ${user.role === 'ADMIN' ? 'bg-red-900 text-red-200' : 'bg-green-900 text-green-200'}`}>
                                    {user.role}
                                </span>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
      </div>
    </div>
  );
};

// --- Common Audit Component ---
const AuditPage = ({ 
    title, rfqTitle, bidTitle, role, handleAnalyze, usageLimits, 
    setCurrentPage, currentUser, loading, RFQFile, BidFile, setRFQFile, setBidFile, 
    generateTestData, errorMessage, report, saveReport, saving, setErrorMessage, userId
}) => {

    const handleSave = () => {
        saveReport(role);
    };
    
    const handleBack = () => {
        if (currentUser && currentUser.role === 'ADMIN') {
            setCurrentPage(PAGE.ADMIN); 
        } else {
            setCurrentPage(PAGE.HOME); 
        }
    };

    const HeaderMessage = () => {
        if (currentUser && currentUser.role === 'ADMIN') {
            return (
                <p className="text-green-400 text-sm font-semibold">
                    **Welcome, {currentUser.name}! | ADMIN VIEW**
                </p>
            );
        }
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

                <div className="text-center mb-6 p-3 rounded-xl bg-green-900/40 border border-green-700">
                    <HeaderMessage />
                </div>
                
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
                
                {(report || userId) && ( 
                    <button
                        onClick={() => setCurrentPage(PAGE.HISTORY)}
                        className="mt-2 w-full flex items-center justify-center px-8 py-3 text-md font-semibold rounded-xl text-white bg-slate-700/80 hover:bg-slate-700 transition-all"
                    >
                        <List className="h-5 w-5 mr-2" />
                        VIEW ALL SAVED REPORTS
                    </button>
                )}
            </div>

            {report && <ComplianceReport report={report} />}
        </>
    );
};

// FileUploader Component
const FileUploader = ({ title, file, setFile, color, requiredText }) => (
    <div className={`p-6 border-2 border-dashed border-${color}-600/50 rounded-2xl bg-slate-900/50 space-y-3`}>
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

// ComplianceReport Component
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
            
            {/* --- Score Visualization Section --- */}
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

// --- Compliance Ranking Component ---
const ComplianceRanking = ({ reportsHistory, loadReportFromHistory, deleteReport, currentUser }) => { 
    if (reportsHistory.length === 0) return null;

    // 1. Group by RFQ Title
    const groupedReports = reportsHistory.reduce((acc, report) => {
        const rfqName = report.rfqName;
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


    // 2. Function to sort and assign ranks
    const getRankedReports = (reports) => {
        // Sort by Percentage (High to Low), then Timestamp (New to Old)
        const sortedReports = reports.sort((a, b) => {
            if (b.percentage !== a.percentage) {
                return b.percentage - a.percentage; 
            }
            return b.timestamp - a.timestamp; 
        });
        
        // Simple ranking based on sort order
        return sortedReports.map((report, index) => ({
            ...report,
            rank: index + 1
        }));
    };


    return (
        <div className="mt-8">
            <h2 className="text-xl font-bold text-white flex items-center mb-4 border-b border-slate-700 pb-2">
                <Layers className="w-5 h-5 mr-2 text-blue-400"/> Compliance Ranking by RFQ
            </h2>
            <p className="text-sm text-slate-400 mb-6">
                Reports are grouped by Project (RFQ) and ranked by Compliance Score (Highest First).
            </p>
            
            <div className="space-y-6">
                {rankedProjects.map(([rfqName, data]) => {
                    const rankedReports = getRankedReports(data.allReports);

                    return (
                        <div key={rfqName} className="p-5 bg-slate-700/50 rounded-xl border border-slate-600 shadow-lg">
                            <h3 className="text-lg font-extrabold text-amber-400 mb-4 border-b border-slate-600 pb-2">
                                {rfqName} <span className="text-sm font-normal text-slate-400">({data.count} Revisions)</span>
                            </h3>
                            <div className="space-y-3">
                                {rankedReports.map((report) => (
                                    <div 
                                        key={report.id} 
                                        className={`p-3 rounded-lg border border-slate-600 bg-slate-900/50 space-y-2 flex justify-between items-center transition hover:bg-slate-700/50`}
                                    >
                                        <div className='flex items-center min-w-0 cursor-pointer' onClick={() => loadReportFromHistory(report)}>
                                            <div className={`text-xl font-extrabold w-8 flex-shrink-0 ${report.rank === 1 ? 'text-green-400' : 'text-slate-500'}`}>
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
                                                {report.percentage}%
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
const ReportHistory = ({ reportsHistory, loadReportFromHistory, isAuthReady, userId, setCurrentPage, currentUser, deleteReport }) => { 
    
    const handleBack = () => {
        if (currentUser && currentUser.role === 'ADMIN') {
            setCurrentPage(PAGE.ADMIN); 
        } else {
            setCurrentPage(PAGE.COMPLIANCE_CHECK); 
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
                deleteReport={deleteReport} 
                currentUser={currentUser} 
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
