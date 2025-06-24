// This is the web server for Luna Chat 2.0 to talk to Wix
const express = require('express');
const { messageHandler } = require('./index.js');

// Set up the web server
const app = express();
app.use(express.json());

// Create a mailbox for Wix to send messages
app.post('/chat', (req, res) => {
    const message = req.body.message;
    if (!message) {
        return res.status(400).json({ error: 'No message provided' });
    }
    const result = messageHandler(message);
    res.json(result);
});

// Start the web server
const port = 3000;
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});