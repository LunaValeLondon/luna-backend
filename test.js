// This tests the chatbot backend
const { messageHandler } = require('./index.js');

// Send a test message
const message = "hi";
const result = messageHandler(message);

// Show the result
console.log(result);