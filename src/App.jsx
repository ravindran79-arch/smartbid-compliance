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
        if (this.state.hasError
