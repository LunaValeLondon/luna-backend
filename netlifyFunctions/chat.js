const { messageHandler } = require('../index');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
    }
    const body = JSON.parse(event.body);
    const { message } = body;
    if (!message) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No message provided' }),
      };
    }
    // Await the async messageHandler here
    const result = await messageHandler(message);
    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error' }),
    };
  }
};
