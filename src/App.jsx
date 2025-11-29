
import React, { useState, useCallback, useEffect } from 'react';
import { 
    FileUp, Send, Loader2, AlertTriangle, CheckCircle, List, FileText, BarChart2,
    Save, Clock, Zap, ArrowLeft, Users, Briefcase, Layers, UserPlus, LogIn, Tag,
    Shield, User, HardDrive, Phone, Mail, Building, Trash2, Eye, DollarSign, Activity, 
    Printer, Download, MapPin, Calendar, ThumbsUp, ThumbsDown, Gavel, Paperclip, Copy, Award, Lock, CreditCard, Info
} from 'lucide-react'; 

// --- FIREBASE IMPORTS ---
import { initializeApp } from 'firebase/app';
import { 
    getAuth, onAuthStateChanged, createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, signOut 
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
const API_URL = '/api/analyze'; 

const CATEGORY_ENUM = ["LEGAL", "FINANCIAL", "TECHNICAL", "TIMELINE", "REPORTING", "ADMINISTRATIVE", "OTHER"];
const MAX_FREE_AUDITS = 3; 

const PAGE = {
    HOME: 'HOME',
    COMPLIANCE_CHECK: 'COMPLIANCE_CHECK', 
    ADMIN: 'ADMIN',                     
    HISTORY: 'HISTORY' 
};

// --- JSON SCHEMA ---
const COMPREHENSIVE_REPORT_SCHEMA = {
    type: "OBJECT",
    description: "The complete compliance audit report with market intelligence and bid coaching data.",
    properties: {
        // --- ADMIN / MARKET INTEL FIELDS ---
        "projectTitle": { "type": "STRING", "description": "Official Project Title from RFQ." },
        "rfqScopeSummary": { "type": "STRING", "description": "High-level scope summary from RFQ." },
        "grandTotalValue": { "type": "STRING", "description": "Total Bid Price/Cost." },
        "industryTag": { 
            "type": "STRING", 
            "description": "STRICTLY classify into ONE of these exact categories: 'Energy / Oil & Gas', 'Construction / Infrastructure', 'IT / SaaS / Technology', 'Healthcare / Medical', 'Logistics / Supply Chain', 'Consulting / Professional Services', 'Manufacturing / Industrial', 'Financial Services', or 'Other'."
        },
        "primaryRisk": { "type": "STRING", "description": "Biggest deal-breaker risk." },
        "projectLocation": { "type": "STRING", "description": "Geographic location." },
        "contractDuration": { "type": "STRING", "description": "Proposed timeline." },
        "techKeywords": { "type": "STRING", "description": "Top 3 technologies/materials." },
        "requiredCertifications": { "type": "STRING", "description": "Mandatory certs (ISO, etc.)." },
        
        // --- GOD VIEW METRICS ---
        "buyingPersona": { 
            "type": "STRING", 
            "description": "Classify Buyer: 'PRICE-DRIVEN' (Budget focus) or 'VALUE-DRIVEN' (Quality/Innovation focus)." 
        },
        "complexityScore": { 
            "type": "STRING", 
            "description": "Rate project complexity (e.g. '8/10')." 
        },
        "trapCount": { 
            "type": "STRING", 
            "description": "Count dangerous clauses (e.g. '3 Critical Traps')." 
        },
        "leadTemperature": { 
            "type": "STRING", 
            "description": "Rate win probability: 'HOT LEAD', 'WARM LEAD', or 'COLD LEAD'." 
        },

        // --- USER COACHING FIELDS ---
        "generatedExecutiveSummary": {
            "type": "STRING",
            "description": "Write a professional 2-PARAGRAPH Executive Summary. PARAGRAPH 1: Mirror the RFQ context. Explicitly restate the Client's primary objectives and pain points. PARAGRAPH 2: Validate the Bidder's specific suitability (USP, Tech, Experience). If the bid lacks a USP, highlight this gap."
        },
        "persuasionScore": { "type": "NUMBER", "description": "Score 0-100 based on confidence and clarity." },
        "toneAnalysis": { "type": "STRING" },
        "weakWords": { "type": "ARRAY", "items": { "type": "STRING" } },
        "procurementVerdict": {
            "type": "OBJECT",
            "properties": {
                "winningFactors": { "type": "ARRAY", "items": { "type": "STRING" }, "description": "Top 3 strong points." },
                "losingFactors": { "type": "ARRAY", "items": { "type": "STRING" }, "description": "Top 3 weak points." }
            }
        },
        "legalRiskAlerts": { "type": "ARRAY", "items": { "type": "STRING" } },
        "submissionChecklist": { "type": "ARRAY", "items": { "type": "STRING" } },

        // --- CORE COMPLIANCE FIELDS ---
        "executiveSummary": { "type": "STRING", "description": "Audit summary." },
        "findings": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "requirementFromRFQ": { "type": "STRING", "description": "EXACT TEXT of requirement." },
                    "complianceScore": { "type": "NUMBER" },
                    "bidResponseSummary": { "type": "STRING" },
                    "flag": { "type": "STRING", "enum": ["COMPLIANT", "PARTIAL", "NON-COMPLIANT"] },
                    "category": { "type": "STRING", "enum": CATEGORY_ENUM },
                    "negotiationStance": { 
                        "type": "STRING", 
                        "description": "If score < 1: Act as a Sales Diplomat. 1. Identify deviation. 2. Suggest a 'Pivot Strategy' (e.g. 'Pivot to Safety'). 3. Provide a template script justifying why this deviation is acceptable/beneficial. Do NOT invent facts."
                    }
                }
            }
        }
    },
    "required": ["projectTitle", "rfqScopeSummary", "grandTotalValue", "industryTag", "primaryRisk", "generatedExecutiveSummary", "persuasionScore", "toneAnalysis", "procurementVerdict", "legalRiskAlerts", "submissionChecklist", "executiveSummary", "findings", "buyingPersona", "complexityScore", "trapCount", "leadTemperature"]
};

// --- UTILS ---
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

const getUsageDocRef = (db, userId) => doc(db, `users/${userId}/usage_limits`, 'main_tracker');
const getReportsCollectionRef = (db, userId) => collection(db, `users/${userId}/compliance_reports`);

const getCompliancePercentage = (report) => {
    const findings = report.findings || []; 
    const totalScore = findings.reduce((sum, item) => sum + (item.complianceScore || 0), 0);
    const maxScore = findings.length * 1;
    return maxScore > 0 ? parseFloat(((totalScore / maxScore) * 100).toFixed(1)) : 0;
};

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

// --- LEAF COMPONENTS ---
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

const PaywallModal = ({ show, onClose, userId }) => {
    if (!show) return null;
    
    // ✅ STRIPE LINK
    const STRIPE_PAYMENT_LINK = "https://buy.stripe.com/test_cNi00i4JHdOmdTT8VJafS00"; 

    const handleUpgrade = () => {
        if (userId) {
            window.location.href = `${STRIPE_PAYMENT_LINK}?client_reference_id=${userId}`;
        } else {
            alert("Error: User ID missing. Please log in again.");
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-sm flex items-center justify-center z-50 p-4 no-print">
            <div className="bg-slate-800 rounded-2xl shadow-2xl border border-amber-500/50 max-w-md w-full p-8 text-center relative">
                <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 bg-amber-500 rounded-full p-4 shadow-lg shadow-amber-500/50">
                    <Lock className="w-10 h-10 text-white" />
                </div>
                <h2 className="text-2xl font-bold text-white mt-8 mb-2">Trial Limit Reached</h2>
                <p className="text-slate-300 mb-6">
                    You have used your <span className="text-amber-400 font-bold">3 Free Audits</span>.
                    <br/>To continue further audits on SmartBids, upgrade to Pro.
                </p>
                <div className="bg-slate-700/50 rounded-xl p-4 mb-6 text-left space-y-3">
                    <div className="flex items-center text-sm text-white"><CheckCircle className="w-4 h-4 mr-3 text-green-400"/> Unlimited Compliance Audits</div>
                    <div className="flex items-center text-sm text-white"><CheckCircle className="w-4 h-4 mr-3 text-green-400"/> AI Sales Coach & Tone Analysis</div>
                    <div className="flex items-center text-sm text-white"><CheckCircle className="w-4 h-4 mr-3 text-green-400"/> Market Intelligence Data</div>
                </div>
                <button 
                    onClick={handleUpgrade}
                    className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold rounded-xl transition-all shadow-lg mb-3 flex items-center justify-center"
                >
                    <CreditCard className="w-5 h-5 mr-2"/> Upgrade Now - $10/mo
                </button>
                <button onClick={onClose} className="text-sm text-slate-400 hover:text-white">
                    Maybe Later (Return to Home)
                </button>
            </div>
        </div>
    );
};

const DetailItem = ({ icon: Icon, label, value }) => (
    <div className='flex items-center text-sm text-slate-300'>
        {Icon && <Icon className="w-4 h-4 mr-2 text-blue-400 flex-shrink-0"/>}
        <span className="text-slate-500 mr-2 flex-shrink-0">{label}:</span>
        <span className="font-medium truncate min-w-0" title={value}>{value}</span>
    </div>
);

const UserCard = ({ user }) => (
  <div className="p-4 bg-slate-900 rounded-xl border border-slate-700 shadow-md">
    <div className="flex justify-between items-center border-b border-slate-700 pb-2 mb-2">
      <p className="text-xl font-bold text-white flex items-center"><User className="w-5 h-5 mr-2 text-amber-400" />{user.name}</p>
      <span className={`text-xs px-3 py-1 rounded-full font-semibold ${user.role === 'ADMIN' ? 'bg-red-500 text-white' : 'bg-green-500 text-slate-900'}`}>{user.role}</span>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 mt-4">
      <DetailItem icon={Briefcase} label="Designation" value={user.designation} />
      <DetailItem icon={Building} label="Company" value={user.company} />
      <DetailItem icon={Mail} label="Email" value={user.email} />
      <DetailItem icon={Phone} label="Contact" value={user.phone || 'N/A'} />
    </div>
  </div>
);

const StatCard = ({ icon, label, value }) => (
  <div className="bg-slate-900 p-6 rounded-xl border border-slate-700 flex items-center space-x-4">
    <div className="flex-shrink-0">{icon}</div>
    <div><div className="text-3xl font-extrabold text-white">{value}</div><div className="text-sm text-slate-400">{label}</div></div>
  </div>
);

const MetricPill = ({ label, count, color }) => (
    <div className="p-2 rounded-lg bg-slate-800 border border-slate-700">
        <div className={`text-xl font-bold ${color}`}>{count}</div>
        <div className="text-slate-400 text-xs mt-1">{label}</div>
    </div>
);

const FileUploader = ({ title, file, setFile, color, requiredText }) => (
    <div className={`p-6 border-2 border-dashed border-${color}-600/50 rounded-2xl bg-slate-900/50 space-y-3 no-print`}>
        <h3 className={`text-lg font-bold text-${color}-400 flex items-center`}><FileUp className={`w-6 h-6 mr-2 text-${color}-500`} /> {title}</h3>
        <p className="text-sm text-slate-400">{requiredText}</p>
        <input type="file" accept=".txt,.pdf,.docx" onChange={setFile} className="w-full text-base text-slate-300"/>
        {file && <p className="text-sm font-medium text-green-400 flex items-center"><CheckCircle className="w-4 h-4 mr-1 text-green-500" /> {file.name}</p>}
    </div>
);

// --- MID-LEVEL COMPONENTS ---

const ComplianceReport = ({ report }) => {
    const findings = report.findings || []; 
    const overallPercentage = getCompliancePercentage(report);
    const counts = findings.reduce((acc, item) => { const flag = item.flag || 'NON-COMPLIANT'; acc[flag] = (acc[flag] || 0) + 1; return acc; }, { 'COMPLIANT': 0, 'PARTIAL': 0, 'NON-COMPLIANT': 0 });
    const getWidth = (flag) => findings.length === 0 ? '0%' : `${(counts[flag] / findings.length) * 100}%`;

    return (
        <div id="printable-compliance-report" className="bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700 mt-8">
            <div className="flex justify-between items-center mb-6 border-b border-slate-700 pb-4">
                <h2 className="text-3xl font-extrabold text-white flex items-center"><List className="w-6 h-6 mr-3 text-amber-400"/> Comprehensive Compliance Report</h2>
                <button 
                    onClick={() => window.print()} 
                    className="text-sm text-slate-400 hover:text-white bg-slate-700 px-3 py-2 rounded-lg flex items-center no-print"
                >
                    <Printer className="w-4 h-4 mr-2"/> Print / PDF
                </button>
            </div>

            {report.generatedExecutiveSummary && (
                <div className="mb-8 p-6 bg-gradient-to-r from-blue-900/40 to-slate-800 rounded-xl border border-blue-500/30">
                    <div className="flex justify-between items-start mb-3">
                        <h3 className="text-xl font-bold text-blue-200 flex items-center"><Award className="w-5 h-5 mr-2 text-yellow-400"/> AI-Suggested Executive Summary</h3>
                        <button 
                            onClick={() => navigator.clipboard.writeText(report.generatedExecutiveSummary)}
                            className="text-xs flex items-center bg-blue-700 hover:bg-blue-600 text-white px-3 py-1 rounded transition no-print"
                        >
                            <Copy className="w-3 h-3 mr-1"/> Copy Text
                        </button>
                    </div>
                    <p className="text-slate-300 italic leading-relaxed border-l-4 border-blue-500 pl-4 whitespace-pre-line">"{report.generatedExecutiveSummary}"</p>
                </div>
            )}
            <div className="mb-10 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-5 bg-slate-700/50 rounded-xl border border-amber-600/50 text-center">
                    <p className="text-sm font-semibold text-white mb-1"><BarChart2 className="w-4 h-4 inline mr-2"/> Compliance Score</p>
                    <div className="text-5xl font-extrabold text-amber-400">{overallPercentage}%</div>
                    <div className="w-full h-3 bg-slate-900 rounded-full flex overflow-hidden mt-4"><div style={{ width: getWidth('COMPLIANT') }} className="bg-green-500"></div><div style={{ width: getWidth('PARTIAL') }} className="bg-amber-500"></div><div style={{ width: getWidth('NON-COMPLIANT') }} className="bg-red-500"></div></div>
                    <p className="text-xs text-slate-400 mt-3">View detailed score breakdown by requirement below.</p>
                </div>
                {report.persuasionScore !== undefined && (
                    <div className="p-5 bg-slate-700/50 rounded-xl border border-purple-600/50 text-center relative overflow-hidden">
                        <p className="text-sm font-semibold text-white mb-1"><Activity className="w-4 h-4 inline mr-2 text-purple-400"/> Persuasion Score</p>
                        <div className="text-5xl font-extrabold text-purple-300">{report.persuasionScore}/100</div>
                        <div className="mt-3 flex flex-wrap justify-center gap-2">
                            <span className="px-3 py-1 rounded-full bg-purple-900/50 border border-purple-500 text-xs text-purple-200 font-bold uppercase">
                                Tone: {report.toneAnalysis || 'Neutral'}
                            </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-3 text-center">Based on confidence, active voice, and clarity.</p>
                        {report.weakWords && report.weakWords.length > 0 && (
                            <p className="text-xs text-slate-400 mt-1 text-center">
                                ⚠️ Weak words detected: <span className="italic text-red-300">{report.weakWords.join(", ")}</span>
                            </p>
                        )}
                    </div>
                )}
            </div>
            {report.procurementVerdict && (
                <div className="mb-10 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="p-5 bg-green-900/20 rounded-xl border border-green-800">
                        <h4 className="text-lg font-bold text-green-400 mb-3"><ThumbsUp className="w-5 h-5 inline mr-2"/> Proposal Winning Proposition</h4>
                        <ul className="space-y-2">{report.procurementVerdict.winningFactors?.map((f, i) => <li key={i} className="flex text-sm text-green-200"><CheckCircle className="w-4 h-4 mr-2"/> {f}</li>)}</ul>
                    </div>
                    <div className="p-5 bg-red-900/20 rounded-xl border border-red-800">
                        <h4 className="text-lg font-bold text-red-400 mb-3"><ThumbsDown className="w-5 h-5 inline mr-2"/> Proposal Potential Flaws</h4>
                        <ul className="space-y-2">{report.procurementVerdict.losingFactors?.map((f, i) => <li key={i} className="flex text-sm text-red-200"><AlertTriangle className="w-4 h-4 mr-2"/> {f}</li>)}</ul>
                    </div>
                </div>
            )}
            {report.legalRiskAlerts?.length > 0 && (
                <div className="mb-10 p-5 bg-red-950/50 rounded-xl border border-red-600">
                    <h4 className="text-lg font-bold text-red-400 mb-1"><Gavel className="w-6 h-6 inline mr-2"/> Legal Risk Detected</h4>
                    <ul className="list-disc list-inside text-sm text-red-300">{report.legalRiskAlerts.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </div>
            )}
            <h3 className="text-2xl font-bold text-white mb-6 border-b border-slate-700 pb-3">Detailed Findings</h3>
            <div className="space-y-8">
                {findings.map((item, index) => (
                    <div key={index} className="p-6 border border-slate-700 rounded-xl shadow-md space-y-3 bg-slate-800 hover:bg-slate-700/50 transition">
                        <div className="flex justify-between items-start">
                            <h3 className="text-xl font-bold text-white">#{index + 1}</h3>
                            <div className={`px-4 py-1 text-sm font-semibold rounded-full border ${item.flag === 'COMPLIANT' ? 'bg-green-700/30 text-green-300 border-green-500' : item.flag === 'PARTIAL' ? 'bg-amber-700/30 text-amber-300 border-amber-500' : 'bg-red-700/30 text-red-300 border-red-500'}`}>{item.flag} ({item.complianceScore})</div>
                        </div>
                        <p className="font-semibold text-slate-300 mt-2">RFQ Requirement Extracted:</p>
                        <p className="p-4 bg-slate-900/80 text-slate-200 rounded-lg border border-slate-700 italic text-sm">{item.requirementFromRFQ || "Text not extracted by AI"}</p>
                        <p className="font-semibold text-slate-300 mt-4">Bidder's Response Summary:</p>
                        <p className="text-slate-400 text-sm">{item.bidResponseSummary}</p>
                        {item.negotiationStance && <div className="mt-4 p-4 bg-blue-900/40 border border-blue-700 rounded-xl"><p className="font-semibold text-blue-300">Recommended Negotiation Stance:</p><p className="text-blue-200 text-sm">{item.negotiationStance}</p></div>}
                    </div>
                ))}
            </div>
            {report.submissionChecklist?.length > 0 && (
                <div className="mt-12 p-6 bg-slate-700/30 rounded-xl border border-slate-600 border-dashed">
                    <h3 className="text-lg font-bold text-white mb-4"><Paperclip className="w-5 h-5 inline mr-2 text-slate-400"/> Identified Required Attachment/Appendices From RFQ</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {report.submissionChecklist.map((artifact, i) => (
                            <div key={i} className="flex items-center p-3 bg-slate-800 rounded-lg border border-slate-700">
                                <FileText className="w-4 h-4 text-blue-400 mr-3 flex-shrink-0"/>
                                <span className="text-sm text-slate-300">{artifact}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

const ComplianceRanking = ({ reportsHistory, loadReportFromHistory, deleteReport, currentUser }) => { 
    if (reportsHistory.length === 0) return null;
    const groupedReports = reportsHistory.reduce((acc, report) => {
        const rfqName = report.rfqName;
        const percentage = getCompliancePercentage(report); 
        if (!acc[rfqName]) acc[rfqName] = { allReports: [], count: 0 };
        acc[rfqName].allReports.push({ ...report, percentage });
        acc[rfqName].count += 1;
        return acc;
    }, {});
    const rankedProjects = Object.entries(groupedReports).filter(([_, data]) => data.allReports.length >= 1).sort(([nameA], [nameB]) => nameA.localeCompare(nameB));
    return (
        <div className="mt-8">
            <h2 className="text-xl font-bold text-white flex items-center mb-4 border-b border-slate-700 pb-2"><Layers className="w-5 h-5 mr-2 text-blue-400"/> Compliance Ranking by RFQ</h2>
            <div className="space-y-6">
                {rankedProjects.map(([rfqName, data]) => (
                    <div key={rfqName} className="p-5 bg-slate-700/50 rounded-xl border border-slate-600 shadow-lg">
                        <h3 className="text-lg font-extrabold text-amber-400 mb-4 border-b border-slate-600 pb-2">{rfqName} <span className="text-sm font-normal text-slate-400">({data.count} Revisions)</span></h3>
                        <div className="space-y-3">
                            {data.allReports.sort((a, b) => b.percentage - a.percentage).map((report, idx) => (
                                <div key={report.id} className="p-3 rounded-lg border border-slate-600 bg-slate-900/50 space-y-2 flex justify-between items-center hover:bg-slate-700/50">
                                    <div className='flex items-center cursor-pointer' onClick={() => loadReportFromHistory(report)}>
                                        <div className={`text-xl font-extrabold w-8 ${idx === 0 ? 'text-green-400' : 'text-slate-500'}`}>#{idx + 1}</div>
                                        <div className='ml-3'><p className="text-sm font-medium text-white">{report.bidName}</p><p className="text-xs text-slate-400">{new Date(report.timestamp).toLocaleDateString()}</p></div>
                                    </div>
                                    <div className="flex items-center">
                                        {currentUser && currentUser.role === 'ADMIN' && <button onClick={(e) => {e.stopPropagation(); deleteReport(report.id, report.rfqName, report.bidName, report.ownerId || currentUser.uid);}} className="mr-2 p-1 bg-red-600 rounded"><Trash2 className="w-4 h-4 text-white"/></button>}
                                        <span className="px-2 py-0.5 rounded text-sm font-bold bg-blue-600 text-slate-900">{report.percentage}%</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const ReportHistory = ({ reportsHistory, loadReportFromHistory, isAuthReady, userId, setCurrentPage, currentUser, deleteReport, handleLogout }) => { 
    if (!isAuthReady || !userId) return <div className="text-center text-red-400">Please login to view history.</div>;
    return (
        <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700">
            <div className="flex justify-between items-center mb-6 border-b border-slate-700 pb-3">
                <h2 className="text-xl font-bold text-white flex items-center"><Clock className="w-5 h-5 mr-2 text-amber-500"/> Saved Report History ({reportsHistory.length})</h2>
                <div className="flex gap-2">
                    <button onClick={() => setCurrentPage(PAGE.COMPLIANCE_CHECK)} className="text-sm text-slate-400 hover:text-amber-500 flex items-center"><ArrowLeft className="w-4 h-4 mr-1"/> Back</button>
                    <button onClick={handleLogout} className="text-sm text-slate-400 hover:text-red-400 flex items-center ml-4">Logout</button>
                </div>
            </div>
            <ComplianceRanking reportsHistory={reportsHistory} loadReportFromHistory={loadReportFromHistory} deleteReport={deleteReport} currentUser={currentUser} />
            <h3 className="text-lg font-bold text-white mt-8 mb-4 border-b border-slate-700 pb-2">All Reports</h3>
            {reportsHistory.length === 0 ? <p className="text-slate-400 italic">No saved reports found.</p> : (
                <div className="space-y-4">{reportsHistory.map(item => (
                    <div key={item.id} className="flex justify-between items-center p-4 bg-slate-700/50 rounded-xl border border-slate-700 hover:bg-slate-700/80">
                        <div className="mr-4"><p className="text-sm font-medium text-white">{item.rfqName} vs {item.bidName}</p><p className="text-xs text-slate-400">{new Date(item.timestamp).toLocaleDateString()}</p></div>
                        <div className='flex items-center space-x-2'>
                            <button onClick={() => loadReportFromHistory(item)} className="px-4 py-2 text-xs rounded-lg bg-amber-500 text-slate-900 hover:bg-amber-400"><ArrowLeft className="w-3 h-3 inline mr-1 rotate-180"/> Load</button>
                            {currentUser && currentUser.role === 'ADMIN' && <button onClick={(e) => {e.stopPropagation(); deleteReport(item.id, item.rfqName, item.bidName, item.ownerId || userId);}} className="px-4 py-2 text-xs rounded-lg bg-red-600 text-white hover:bg-red-500"><Trash2 className="w-3 h-3 inline"/></button>}
                        </div>
                    </div>
                ))}</div>
            )}
        </div>
    );
};

// --- PAGE COMPONENTS (AuthPage First) ---

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
            
            // FIX: Sign Out immediately to prevent auto-redirect
            await signOut(auth);
            
            setLoginForm({ email: regForm.email, password: regForm.password });
            setErrorMessage('SUCCESS: Registration complete! Use the Email/Password you just created to Sign In.');
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
            // No direct navigation here; App effect handles role-based redirect
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

                        {/* --- LEGAL DISCLAIMER --- */}
                        <div className="mt-4 text-[10px] text-slate-500 text-center leading-tight">
                            By registering, you agree to our 
                            <a 
                                href="https://img1.wsimg.com/blobby/go/203a0c5d-2209-4c66-b0c4-991df2124bd3/downloads/0c0d3149-68a2-42ef-abeb-f0c82323cfef/TERMS%20OF%20SERVICE.pdf?ver=1764379110939" 
                                target="_blank" 
                                rel="noreferrer" 
                                className="text-blue-400 hover:underline mx-1"
                            >
                                Terms of Service
                            </a>
                            and 
                            <a 
                                href="https://img1.wsimg.com/blobby/go/203a0c5d-2209-4c66-b0c4-991df2124bd3/downloads/1a00cf64-6cab-4f3d-89c1-f370755ca03c/PRIVACY%20POLICY.pdf?ver=1764379110939" 
                                target="_blank" 
                                rel="noreferrer" 
                                className="text-blue-400 hover:underline mx-1"
                            >
                                Privacy Policy
                            </a>.
                        </div>
                        {/* -------------------------- */}

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

const AdminDashboard = ({ setCurrentPage, currentUser, reportsHistory, loadReportFromHistory, handleLogout }) => {
  const [userList, setUserList] = useState([]);
  useEffect(() => {
    getDocs(collection(getFirestore(), 'users')).then(snap => setUserList(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, []);
  const exportToCSV = (data, filename) => {
    const csvContent = "data:text/csv;charset=utf-8," + Object.keys(data[0]).join(",") + "\n" + data.map(e => Object.values(e).map(v => `"${v}"`).join(",")).join("\n");
    const link = document.createElement("a"); link.href = encodeURI(csvContent); link.download = filename; document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };
  const handleVendorExport = () => {
      const cleanVendorData = userList.map(u => ({ "Full Name": u.name, "Designation": u.designation, "Company": u.company, "Email": u.email, "Contact Number": u.phone, "Role": u.role }));
      exportToCSV(cleanVendorData, 'vendor_registry.csv');
  };
  const handleMarketExport = () => {
      const cleanMarketData = reportsHistory.map(r => ({
          ID: r.id, Project: r.projectTitle || r.rfqName, "Scope of Work": r.rfqScopeSummary || 'N/A', Vendor: userList.find(u => u.id === r.ownerId)?.name, Industry: r.industryTag, Value: r.grandTotalValue, Location: r.projectLocation, Duration: r.contractDuration, "Tech Stack": r.techKeywords, Regulations: r.requiredCertifications, "Risk Identified": r.primaryRisk, "Buying Persona": r.buyingPersona, "Complexity Score": r.complexityScore, "Trap Count": r.trapCount, "Lead Temperature": r.leadTemperature, Score: getCompliancePercentage(r) + '%'
      }));
      exportToCSV(cleanMarketData, 'market_data.csv');
  };
  return (
    <div id="admin-print-area" className="bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700 space-y-8">
      <div className="flex justify-between items-center border-b border-slate-700 pb-4">
        <h2 className="text-3xl font-bold text-white flex items-center"><Shield className="w-8 h-8 mr-3 text-red-400" /> Admin Market Intel</h2>
        <div className="flex space-x-3 no-print">
            <button onClick={() => window.print()} className="text-sm text-slate-400 hover:text-white bg-slate-700 px-3 py-2 rounded-lg"><Printer className="w-4 h-4 mr-2" /> Print</button>
            <button onClick={handleLogout} className="text-sm text-slate-400 hover:text-amber-500 flex items-center"><ArrowLeft className="w-4 h-4 mr-1" /> Logout</button>
        </div>
      </div>

      <div className="bg-slate-700/30 border border-slate-600 rounded-xl p-4 no-print"><div className="flex items-center mb-2"><Info className="w-4 h-4 mr-2 text-blue-400"/><h4 className="text-sm font-bold text-white">Metric Definitions (God View)</h4></div><div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs text-slate-400"><div><span className="text-blue-300 font-bold">Buying Persona:</span><br/>Buyer priority: Cost vs. Innovation.</div><div><span className="text-purple-300 font-bold">Complexity Score:</span><br/>Difficulty based on timeline & scope.</div><div><span className="text-orange-300 font-bold">Trap Count:</span><br/>Count of dangerous legal clauses.</div><div><span className="text-pink-300 font-bold">Lead Temperature:</span><br/>Win probability based on match.</div></div></div>
      <div className="pt-4 border-t border-slate-700">
        <div className="flex justify-between mb-4">
            <h3 className="text-xl font-bold text-white flex items-center"><Eye className="w-6 h-6 mr-2 text-amber-400" /> Live Market Feed</h3>
            <button onClick={handleMarketExport} className="text-xs bg-green-700 text-white px-3 py-1 rounded no-print"><Download className="w-3 h-3 mr-1"/> CSV</button>
        </div>
        <div className="space-y-4">{reportsHistory.slice(0, 15).map(item => (
            <div key={item.id} className="p-4 bg-slate-900/50 rounded-xl border border-slate-700 cursor-default hover:bg-slate-900">
                <div className="flex justify-between mb-2">
                    <div><h4 className="text-lg font-bold text-white">{item.projectTitle || item.rfqName} <span className="text-xs font-normal text-slate-500 ml-2">{item.industryTag === undefined ? '(LEGACY DATA)' : ''}</span></h4><p className="text-sm text-slate-400"><MapPin className="w-3 h-3 inline"/> {item.projectLocation || 'N/A'} • <Calendar className="w-3 h-3 inline"/> {item.contractDuration || 'N/A'}</p></div>
                    <div className="text-right"><div className="text-xl font-bold text-green-400">{getCompliancePercentage(item)}%</div><span className="text-slate-500 text-xs">{new Date(item.timestamp).toLocaleDateString()}</span></div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                    <p className="text-xs text-green-400 font-bold"><DollarSign className="w-3 h-3 inline"/> {item.grandTotalValue || 'N/A'}</p>
                    <p className="text-xs text-red-400 font-bold"><Activity className="w-3 h-3 inline"/> {item.primaryRisk || 'N/A'}</p>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-3 border-t border-slate-700/50">
                    <div><p className="text-xs font-bold text-blue-300">{item.buyingPersona || 'N/A'}</p><p className="text-[10px] text-slate-500">Buyer Priority</p></div>
                    <div><p className="text-xs font-bold text-purple-300">{item.complexityScore || 'N/A'}</p><p className="text-[10px] text-slate-500">Complexity</p></div>
                    <div><p className="text-xs font-bold text-orange-300">{item.trapCount || 'N/A'}</p><p className="text-[10px] text-slate-500">Risk Traps</p></div>
                    <div><p className="text-xs font-bold text-pink-300">{item.leadTemperature || 'N/A'}</p><p className="text-[10px] text-slate-500">Win Prob.</p></div>
                </div>
            </div>
        ))}</div>
      </div>
      <div className="pt-4 border-t border-slate-700">
         <div className="flex justify-between mb-4"><h3 className="text-xl font-bold text-white"><Users className="w-5 h-5 mr-2 text-blue-400" /> Vendor Registry</h3><button onClick={handleVendorExport} className="text-xs bg-blue-700 text-white px-3 py-1 rounded no-print"><Download className="w-3 h-3 mr-1"/> CSV</button></div>
         <div className="max-h-64 overflow-y-auto bg-slate-900 rounded-xl border border-slate-700">
            <table className="w-full text-left text-sm text-slate-400">
                <thead className="bg-slate-800 text-slate-200 uppercase font-bold sticky top-0 z-10">
                    <tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Designation</th><th className="px-4 py-3">Company</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Phone</th><th className="px-4 py-3 text-right">Role</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-800">{userList.map((user, i) => (
                    <tr key={i} className="hover:bg-slate-800/50 transition">
                        <td className="px-4 py-3 font-medium text-white">{user.name}</td><td className="px-4 py-3">{user.designation}</td><td className="px-4 py-3">{user.company}</td><td className="px-4 py-3">{user.email}</td><td className="px-4 py-3">{user.phone || 'N/A'}</td><td className="px-4 py-3 text-right"><span className={`px-2 py-1 rounded text-xs font-bold ${user.role === 'ADMIN' ? 'bg-red-900 text-red-200' : 'bg-green-900 text-green-200'}`}>{user.role}</span></td>
                    </tr>
                ))}</tbody>
            </table>
         </div>
      </div>
    </div>
  );
};

const AuditPage = ({ title, handleAnalyze, usageLimits, setCurrentPage, currentUser, loading, RFQFile, BidFile, setRFQFile, setBidFile, generateTestData, errorMessage, report, saveReport, saving, setErrorMessage, userId, handleLogout }) => {
    return (
        <>
            <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700">
                <div className="flex justify-between items-center mb-6 border-b border-slate-700 pb-3">
                    <h2 className="text-2xl font-bold text-white">{title}</h2>
                    <div className="text-right">
                        {currentUser?.role === 'ADMIN' ? (
                            <p className="text-xs text-green-400 font-bold">Admin Mode: Unlimited</p>
                        ) : usageLimits.isSubscribed ? (
                            <div className="flex flex-col items-end space-y-1">
                                <div className="px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500 text-amber-400 text-xs font-bold inline-flex items-center">
                                    <Award className="w-3 h-3 mr-1" /> Status: SmartBids Pro Subscribed
                                </div>
                                <button 
                                    onClick={async () => {
                                        try {
                                            const res = await fetch('/api/create-portal-session', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ userId })
                                            });
                                            const data = await res.json();
                                            if (data.url) window.location.href = data.url;
                                            else alert("Could not access billing portal. " + (data.error || ""));
                                        } catch (e) { console.error(e); alert("Connection failed."); }
                                    }}
                                    className="text-xs text-slate-400 hover:text-red-400 flex items-center transition-colors underline decoration-dotted"
                                >
                                    To Unsubscribe
                                </button>
                                <p className="text-[10px] text-slate-500 italic">Cancellation will Occur at the End of the Billing Period</p>
                            </div>
                        ) : (
                            <p className="text-xs text-slate-400">
                                Audits Used: <span className={usageLimits.bidderChecks >= MAX_FREE_AUDITS ? "text-red-500" : "text-green-500"}>
                                    {usageLimits.bidderChecks}/{MAX_FREE_AUDITS}
                                </span>
                            </p>
                        )}
                        <button onClick={handleLogout} className="text-sm text-slate-400 hover:text-amber-500 block ml-auto mt-1">Logout</button>
                    </div>
                </div>
                <button onClick={generateTestData} disabled={loading} className="mb-6 w-full flex items-center justify-center px-4 py-3 text-sm font-semibold rounded-xl text-slate-900 bg-teal-400 hover:bg-teal-300 disabled:opacity-30"><Zap className="h-5 w-5 mr-2" /> LOAD DEMO DOCUMENTS</button>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <FileUploader title="RFQ Document" file={RFQFile} setFile={(e) => handleFileChange(e, setRFQFile, setErrorMessage)} color="blue" requiredText="Mandatory Requirements" />
                    <FileUploader title="Bid Proposal" file={BidFile} setFile={(e) => handleFileChange(e, setBidFile, setErrorMessage)} color="green" requiredText="Response Document" />
                </div>
                {errorMessage && <div className="mt-6 p-4 bg-red-900/40 text-red-300 border border-red-700 rounded-xl flex items-center"><AlertTriangle className="w-5 h-5 mr-3"/>{errorMessage}</div>}
                <button onClick={() => handleAnalyze('BIDDER')} disabled={loading || !RFQFile || !BidFile} className="mt-8 w-full flex items-center justify-center px-8 py-4 text-lg font-semibold rounded-xl text-slate-900 bg-amber-500 hover:bg-amber-400 disabled:opacity-50">
                    {loading ? <Loader2 className="animate-spin h-6 w-6 mr-3" /> : <Send className="h-6 w-6 mr-3" />} {loading ? 'ANALYZING...' : 'RUN COMPLIANCE AUDIT'}
                </button>
                {report && userId && <button onClick={() => saveReport('BIDDER')} disabled={saving} className="mt-4 w-full flex items-center justify-center px-8 py-3 text-md font-semibold rounded-xl text-white bg-slate-600 hover:bg-slate-500 disabled:opacity-50"><Save className="h-5 w-5 mr-2" /> {saving ? 'SAVING...' : 'SAVE REPORT'}</button>}
                {(report || userId) && <button onClick={() => setCurrentPage(PAGE.HISTORY)} className="mt-2 w-full flex items-center justify-center px-8 py-3 text-md font-semibold rounded-xl text-white bg-slate-700/80 hover:bg-slate-700"><List className="h-5 w-5 mr-2" /> VIEW HISTORY</button>}
            </div>
            {report && <ComplianceReport report={report} />}
        </>
    );
};

// --- APP COMPONENT (DEFINED LAST) ---
const App = () => {
    const [currentPage, setCurrentPage] = useState(PAGE.HOME);
    const [errorMessage, setErrorMessage] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [currentUser, setCurrentUser] = useState(null);
    const [userId, setUserId] = useState(null);
    const [usageLimits, setUsageLimits] = useState({ initiatorChecks: 0, bidderChecks: 0, isSubscribed: false });
    const [reportsHistory, setReportsHistory] = useState([]);
    const [showPaywall, setShowPaywall] = useState(false);
    
    const [RFQFile, setRFQFile] = useState(null);
    const [BidFile, setBidFile] = useState(null);
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const handleLogout = async () => {
        // CONSTITUTION: CLEAN SLATE PROTOCOL
        await signOut(auth);
        setUserId(null);
        setCurrentUser(null);
        setReportsHistory([]);
        setReport(null);
        setRFQFile(null);
        setBidFile(null);
        setUsageLimits({ initiatorChecks: 0, bidderChecks: 0, isSubscribed: false });
        setCurrentPage(PAGE.HOME);
        setErrorMessage(null);
    };

    // --- EFFECT 1: Auth State Listener (Smart Redirect) ---
    useEffect(() => {
        if (!auth) return;
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                setUserId(user.uid);
                try {
                    const userDoc = await getDoc(doc(db, 'users', user.uid));
                    const userData = userDoc.exists() ? userDoc.data() : { role: 'USER' };
                    setCurrentUser({ uid: user.uid, ...userData });
                    
                    // SMART REDIRECT: ADMIN -> ADMIN DASHBOARD, USER -> CHECKER
                    if (userData.role === 'ADMIN') {
                        setCurrentPage(PAGE.ADMIN);
                    } else {
                        setCurrentPage(PAGE.COMPLIANCE_CHECK);
                    }
                } catch (error) {
                    console.error("Error fetching user profile:", error);
                    setCurrentUser({ uid: user.uid, role: 'USER' });
                    setCurrentPage(PAGE.COMPLIANCE_CHECK);
                }
            } else {
                // FIX: WIPE STATE ON LOGOUT
                setUserId(null); setCurrentUser(null); setReportsHistory([]); setReport(null); setRFQFile(null); setBidFile(null); setCurrentPage(PAGE.HOME);
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
                    setUsageLimits({ 
                        bidderChecks: docSnap.data().bidderChecks || 0, 
                        isSubscribed: docSnap.data().isSubscribed || false 
                    });
                } else {
                    const initialData = { initiatorChecks: 0, bidderChecks: 0, isSubscribed: false };
                    setDoc(docRef, initialData).catch(e => console.error("Error creating usage doc:", e));
                    setUsageLimits(initialData);
                }
            }, (error) => console.error("Error listening to usage limits:", error));
            return () => unsubscribe();
        }
    }, [userId]);

    // --- EFFECT 3: Report History Listener ---
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
                        history.push({ id: docSnap.id, ownerId: ownerId, ...docSnap.data() });
                    });
                    history.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                    setReportsHistory(history);
                });
            }
        } catch (err) { console.error("Error setting up history listener:", err); }
        return () => unsubscribeSnapshot && unsubscribeSnapshot();
    }, [userId, currentUser]);

    // --- EFFECT 4: Load Libraries (Robust Check) ---
    useEffect(() => {
        const loadScript = (src) => {
            return new Promise((resolve, reject) => {
                if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
                const script = document.createElement('script');
                script.src = src;
                script.onload = resolve;
                script.onerror = () => reject();
                document.head.appendChild(script);
            });
        };
        const loadAllLibraries = async () => {
            try {
                if (!window.pdfjsLib) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js");
                if (window.pdfjsLib && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
                if (!window.mammoth) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/mammoth.js/1.4.15/mammoth.browser.min.js");
            } catch (e) { console.warn("Doc parsing libs warning:", e); }
        };
        loadAllLibraries();
        
        // FIX: CHECK FOR PAYMENT SUCCESS REDIRECT
        const params = new URLSearchParams(window.location.search);
        if (params.get('client_reference_id') || params.get('payment_success')) {
             // Clean URL
             window.history.replaceState({}, document.title, "/");
             // Optional: Could set a success message state here if desired
        }
    }, []); 

    const incrementUsage = async () => {
        if (!db || !userId) return;
        const docRef = getUsageDocRef(db, userId);
        try {
            await runTransaction(db, async (transaction) => {
                const docSnap = await transaction.get(docRef);
                const currentData = docSnap.exists() ? docSnap.data() : { bidderChecks: 0, isSubscribed: false };
                if (!docSnap.exists()) transaction.set(docRef, currentData);
                transaction.update(docRef, { bidderChecks: (currentData.bidderChecks || 0) + 1 });
            });
        } catch (e) { console.error("Usage update failed:", e); }
    };

    const handleAnalyze = useCallback(async (role) => {
        if (currentUser?.role !== 'ADMIN' && !usageLimits.isSubscribed && usageLimits.bidderChecks >= MAX_FREE_AUDITS) {
            setShowPaywall(true);
            return;
        }
        if (!RFQFile || !BidFile) { setErrorMessage("Please upload both documents."); return; }
        setLoading(true); setReport(null); setErrorMessage(null);

        try {
            const rfqContent = await processFile(RFQFile);
            const bidContent = await processFile(BidFile);
            
            const systemPrompt = {
                parts: [{
                    text: `You are the SmartBid Compliance Auditor & Coach.
                    
                    **TASK 1: Market Intel**
                    1. EXTRACT 'projectTitle', 'grandTotalValue', 'primaryRisk', 'rfqScopeSummary'.
                    2. EXTRACT 'projectLocation', 'contractDuration', 'techKeywords', 'requiredCertifications'.
                    3. CLASSIFY 'industryTag': STRICTLY choose one: 'Energy / Oil & Gas', 'Construction / Infrastructure', 'IT / SaaS / Technology', 'Healthcare / Medical', 'Logistics / Supply Chain', 'Consulting / Professional Services', 'Manufacturing / Industrial', 'Financial Services', or 'Other'.
                    
                    // --- NEW STRATEGIC METRICS ---
                    4. CLASSIFY 'buyingPersona': 'PRICE-DRIVEN' or 'VALUE-DRIVEN' based on RFQ tone.
                    5. SCORE 'complexityScore': 1-10 (String format e.g. '8/10').
                    6. COUNT 'trapCount': Number of dangerous clauses (e.g. '3 Critical Traps').
                    7. ASSESS 'leadTemperature': 'HOT LEAD', 'WARM LEAD', or 'COLD LEAD' based on win probability.

                    **TASK 2: Bid Coaching**
                    1. GENERATE 'generatedExecutiveSummary': MANDATORY: Start by referencing the specific Project Background from the RFQ, then transition to the Vendor's solution and value proposition.
                    2. CALCULATE 'persuasionScore' (0-100).
                    3. ANALYZE 'toneAnalysis' (One word).
                    4. FIND 'weakWords' (List 3).
                    5. JUDGE 'procurementVerdict': List 3 'winningFactors' and 3 'losingFactors'.
                    6. ALERT 'legalRiskAlerts'.
                    7. CHECK 'submissionChecklist' (List artifacts).
                    8. CLEAN UP TEXT: Fix any OCR/PDF spacing errors (e.g. 'Veri fi cation' -> 'Verification').

                    **TASK 3: Compliance Audit**
                    1. Identify mandatory requirements.
                    2. Score (1/0.5/0).
                    3. CRITICAL: Copy EXACT text to 'requirementFromRFQ'.
                    4. NEGOTIATION: If score < 1, write a diplomatic Sales Argument. Suggest a 'Pivot Strategy' (e.g. Safety/Efficiency). Provide a specific justification script. Do not invent facts.
                    
                    Output JSON.`
                }]
            };

            const userQuery = `RFQ:\n${rfqContent}\n\nBid:\n${bidContent}\n\nPerform audit.`;
            const payload = {
                contents: [{ parts: [{ text: userQuery }] }],
                systemInstruction: systemPrompt,
                generationConfig: { responseMimeType: "application/json", responseSchema: COMPREHENSIVE_REPORT_SCHEMA },
            };

            const response = await fetchWithRetry(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;

            if (jsonText) {
                setReport(JSON.parse(jsonText));
                await incrementUsage();
            } else { throw new Error("AI returned invalid data."); }

        } catch (error) {
            setErrorMessage(`Analysis failed: ${error.message}`);
        } finally { setLoading(false); }
    }, [RFQFile, BidFile, usageLimits, currentUser]);

    const generateTestData = useCallback(async () => {
        const mockRfqContent = `PROJECT TITLE: OFFSHORE PIPELINE MAINT.\nSCOPE: Inspect pipelines.\n1. TECH: REST API required.`;
        const mockBidContent = `EXECUTIVE SUMMARY: We will do it.\n1. We use GraphQL.`;
        setRFQFile(new File([mockRfqContent], "MOCK_RFQ.txt", { type: "text/plain" }));
        setBidFile(new File([mockBidContent], "MOCK_BID.txt", { type: "text/plain" }));
        setErrorMessage("Mock docs loaded. Click Run Audit.");
    }, []);

    const saveReport = useCallback(async (role) => {
        if (!db || !userId || !report) { setErrorMessage("No report to save."); return; }
        setSaving(true);
        try {
            const reportsRef = getReportsCollectionRef(db, userId);
            await addDoc(reportsRef, {
                ...report,
                rfqName: RFQFile?.name || 'Untitled',
                bidName: BidFile?.name || 'Untitled',
                timestamp: Date.now(),
                role: role, 
                ownerId: userId 
            });
            setErrorMessage("Report saved successfully!"); 
            setTimeout(() => setErrorMessage(null), 3000);
        } catch (error) {
            setErrorMessage(`Failed to save: ${error.message}.`);
        } finally { setSaving(false); }
    }, [db, userId, report, RFQFile, BidFile]);
    
    const deleteReport = useCallback(async (reportId, rfqName, bidName) => {
        if (!db || !userId) return;
        setErrorMessage(`Deleting...`);
        try {
            const reportsRef = getReportsCollectionRef(db, userId);
            await deleteDoc(doc(reportsRef, reportId));
            if (report && report.id === reportId) setReport(null);
            setErrorMessage("Deleted!");
            setTimeout(() => setErrorMessage(null), 3000);
        } catch (error) { setErrorMessage(`Delete failed: ${error.message}`); }
    }, [db, userId, report]);

    const loadReportFromHistory = useCallback((historyItem) => {
        setRFQFile(null); setBidFile(null);
        setReport({ id: historyItem.id, ...historyItem });
        setCurrentPage(PAGE.COMPLIANCE_CHECK); 
        setErrorMessage(`Loaded: ${historyItem.rfqName}`);
        setTimeout(() => setErrorMessage(null), 3000);
    }, []);
    
    const renderPage = () => {
        switch (currentPage) {
            case PAGE.HOME:
                return <AuthPage setCurrentPage={setCurrentPage} setErrorMessage={setErrorMessage} errorMessage={errorMessage} db={db} auth={auth} />;
            case PAGE.COMPLIANCE_CHECK:
                return <AuditPage 
                    title="Bidder: Self-Compliance Check" rfqTitle="RFQ" bidTitle="Bid" role="BIDDER"
                    handleAnalyze={handleAnalyze} usageLimits={usageLimits} setCurrentPage={setCurrentPage}
                    currentUser={currentUser} loading={loading} RFQFile={RFQFile} BidFile={BidFile}
                    setRFQFile={setRFQFile} setBidFile={setBidFile} generateTestData={generateTestData} 
                    errorMessage={errorMessage} report={report} saveReport={saveReport} saving={saving}
                    setErrorMessage={setErrorMessage} userId={userId} handleLogout={handleLogout}
                />;
            case PAGE.ADMIN:
                return <AdminDashboard setCurrentPage={setCurrentPage} currentUser={currentUser} reportsHistory={reportsHistory} loadReportFromHistory={loadReportFromHistory} handleLogout={handleLogout} />;
            case PAGE.HISTORY:
                return <ReportHistory reportsHistory={reportsHistory} loadReportFromHistory={loadReportFromHistory} deleteReport={deleteReport} isAuthReady={isAuthReady} userId={userId} setCurrentPage={setCurrentPage} currentUser={currentUser} handleLogout={handleLogout} />;
            default: return <AuthPage setCurrentPage={setCurrentPage} setErrorMessage={setErrorMessage} errorMessage={errorMessage} db={db} auth={auth} />;
        }
    };

    return (
        <div className="min-h-screen bg-slate-900 font-body p-4 sm:p-8 text-slate-100">
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@100..900&display=swap');
                .font-body, .font-body * { font-family: 'Lexend', sans-serif !important; }
                input[type="file"] { display: block; width: 100%; }
                input[type="file"]::file-selector-button { background-color: #f59e0b; color: #1e293b; border: none; padding: 10px 20px; border-radius: 10px; cursor: pointer; font-weight: 600; }
                .custom-scrollbar::-webkit-scrollbar { width: 6px; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #475569; border-radius: 3px; }
                @media print { 
                    body * { visibility: hidden; } /* Hide everything by default */
                    
                    /* Rule 1: If printing Admin Dashboard */
                    #admin-print-area, #admin-print-area * { visibility: visible; } 
                    #admin-print-area { position: absolute; left: 0; top: 0; width: 100%; background: white; color: black; } 
                    
                    /* Rule 2: If printing User Report (THE MISSING FIX) */
                    #printable-compliance-report, #printable-compliance-report * { visibility: visible; }
                    #printable-compliance-report { position: absolute; left: 0; top: 0; width: 100%; background: white; color: black; }
                    
                    .no-print { display: none !important; } 
                }
            `}</style>
            <div className="max-w-4xl mx-auto space-y-10">{renderPage()}</div>
            <PaywallModal show={showPaywall} onClose={() => setShowPaywall(false)} userId={userId} />
        </div>
    );
};

// --- TOP LEVEL EXPORT ---
const MainApp = App;

function TopLevelApp() {
    return (
        <ErrorBoundary>
            <MainApp />
        </ErrorBoundary>
    );
}

export default TopLevelApp;
