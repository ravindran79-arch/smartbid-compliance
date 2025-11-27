/* server.cjs - Security, Payments & Subscription Management */
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const admin = require('firebase-admin');

// --- 1. INITIALIZE FIREBASE ---
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        console.log("✅ Firebase Admin Initialized");
    } catch (error) { console.error("❌ Firebase Error:", error); }
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb', verify: (req, res, buf) => { req.rawBody = buf.toString(); } }));
app.use(cors());

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// --- AI ROUTE ---
app.post('/api/analyze', async (req, res) => {
    try {
        const { contents, systemInstruction, generationConfig } = req.body;
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_API_KEY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents, systemInstruction, generationConfig })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || 'Google API Error');
        res.json(data);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// --- NEW: CUSTOMER PORTAL ROUTE (Manage Subscription) ---
app.post('/api/create-portal-session', async (req, res) => {
    const { userId } = req.body;
    if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: "Server missing Stripe Key" });

    try {
        // 1. Get the Stripe Customer ID from Firebase
        const userDoc = await admin.firestore().collection('users').doc(userId).collection('usage_limits').doc('main_tracker').get();
        const stripeCustomerId = userDoc.data()?.stripeCustomerId;

        if (!stripeCustomerId) return res.status(404).json({ error: "No subscription found for this user." });

        // 2. Create the Portal Session
        const stripe = require('stripe')(STRIPE_SECRET_KEY);
        const session = await stripe.billingPortal.sessions.create({
            customer: stripeCustomerId,
            return_url: `https://smartbid-secure.onrender.com`, // Redirect back to app
        });

        res.json({ url: session.url });
    } catch (error) {
        console.error("Portal Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// --- WEBHOOK ROUTE (UPDATED) ---
app.post('/api/webhook', async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const stripe = require('stripe')(STRIPE_SECRET_KEY);
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.rawBody, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) { return res.status(400).send(`Webhook Error: ${err.message}`); }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const userId = session.client_reference_id;
        const stripeCustomerId = session.customer; // Capture the Customer ID

        if (userId && admin.apps.length) {
            await admin.firestore()
                .collection('users').doc(userId).collection('usage_limits').doc('main_tracker')
                .set({ isSubscribed: true, stripeCustomerId: stripeCustomerId }, { merge: true }); // Save ID
            console.log(`✅ Unlocked & Linked: ${userId} -> ${stripeCustomerId}`);
        }
    }
    // Handle Cancellation Logic (Optional but good)
    if (event.type === 'customer.subscription.deleted') {
        const subscription = event.data.object;
        // We need to find which user owns this subscription (reverse lookup or store ID in metadata).
        // For MVP, we trust the Stripe Dashboard or manual check, but ideally, you'd query Firebase 
        // where stripeCustomerId == subscription.customer and set isSubscribed: false.
    }

    res.send();
});

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'dist', 'index.html')); });
app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
