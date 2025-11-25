/* server.js - The Security Bodyguard */
const express = require('express');
const cors = require('cors');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Allow your frontend to talk to this server
app.use(cors());
// Increase limit to 10mb to allow large PDF uploads
app.use(express.json({ limit: '10mb' })); 

// 2. The Secure Proxy Route
app.post('/api/analyze', async (req, res) => {
    try {
        const { contents, systemInstruction, generationConfig } = req.body;
        
        // The Key is grabbed from Render's Environment Variables
        const API_KEY = process.env.GOOGLE_API_KEY;
        
        // Google Gemini API URL
        const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;

        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents, systemInstruction, generationConfig })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error?.message || 'Google API Error');
        }

        res.json(data);

    } catch (error) {
        console.error("Proxy Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// 3. Serve the Frontend (Production Mode)
const path = require('path');
app.use(express.static(path.join(__dirname, 'dist')));

// Handle React Routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running securely on port ${PORT}`);
});
