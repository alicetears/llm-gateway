/**
 * Example client usage of the LLM Gateway API
 * 
 * This demonstrates various ways to use the API
 */

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';

// ============================================================================
// Basic Chat Request
// ============================================================================

async function basicChat() {
  console.log('\n=== Basic Chat Request ===');
  
  const response = await fetch(`${GATEWAY_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        { role: 'user', content: 'Hello! What is 2+2?' },
      ],
    }),
  });

  const data = await response.json();
  console.log('Response:', JSON.stringify(data, null, 2));
  console.log('Provider:', response.headers.get('X-LLM-Provider'));
  console.log('Model:', response.headers.get('X-LLM-Model'));
}

// ============================================================================
// Request Specific Model
// ============================================================================

async function requestSpecificModel() {
  console.log('\n=== Request Specific Model ===');
  
  const response = await fetch(`${GATEWAY_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: 'You are a helpful coding assistant.' },
        { role: 'user', content: 'Write a Python function to calculate fibonacci numbers.' },
      ],
      model: 'gpt-4o', // Request specific model
      temperature: 0.3,
      maxTokens: 500,
    }),
  });

  const data = await response.json();
  console.log('Model used:', data.model);
  console.log('Usage:', data.usage);
}

// ============================================================================
// Request Specific Provider
// ============================================================================

async function requestSpecificProvider() {
  console.log('\n=== Request Specific Provider ===');
  
  const response = await fetch(`${GATEWAY_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        { role: 'user', content: 'Explain quantum computing in simple terms.' },
      ],
      provider: 'anthropic', // Use Anthropic provider
      // Model will be the default_model of the selected key
    }),
  });

  const data = await response.json();
  console.log('Provider:', data.provider);
  console.log('Model:', data.model);
}

// ============================================================================
// Restrict to Specific Providers
// ============================================================================

async function restrictProviders() {
  console.log('\n=== Restrict to Specific Providers ===');
  
  const response = await fetch(`${GATEWAY_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        { role: 'user', content: 'Tell me a joke.' },
      ],
      provider: 'auto',
      allowedProviders: ['groq', 'together'], // Only use fast inference providers
    }),
  });

  const data = await response.json();
  console.log('Selected provider:', data.provider);
}

// ============================================================================
// Restrict to Priority Levels
// ============================================================================

async function restrictPriorities() {
  console.log('\n=== Restrict to Priority Levels ===');
  
  const response = await fetch(`${GATEWAY_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        { role: 'user', content: 'What is the capital of France?' },
      ],
      allowedPriorities: [2, 3], // Use cheaper keys (priority 2-3)
    }),
  });

  const data = await response.json();
  console.log('Response:', data.choices[0]?.message.content);
}

// ============================================================================
// Async Request (Queue-based)
// ============================================================================

async function asyncRequest() {
  console.log('\n=== Async Request ===');
  
  // Submit async request
  const submitResponse = await fetch(`${GATEWAY_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        { role: 'user', content: 'Write a haiku about programming.' },
      ],
      async: true, // Queue the request
    }),
  });

  const submitData = await submitResponse.json();
  console.log('Request queued:', submitData);

  const requestId = submitData.requestId;

  // Poll for result
  console.log('Waiting for result...');
  await new Promise(resolve => setTimeout(resolve, 2000));

  const resultResponse = await fetch(
    `${GATEWAY_URL}/api/chat/${requestId}?timeout=30000`,
  );

  const resultData = await resultResponse.json();
  console.log('Result:', resultData);
}

// ============================================================================
// List API Keys
// ============================================================================

async function listKeys() {
  console.log('\n=== List API Keys ===');
  
  const response = await fetch(`${GATEWAY_URL}/api/keys`);
  const data = await response.json();
  
  console.log(`Total keys: ${data.total}`);
  for (const key of data.keys) {
    console.log(`- ${key.name} (${key.provider}): ${key.usedToday}/${key.dailyLimit || '∞'} used`);
  }
}

// ============================================================================
// Get Usage Statistics
// ============================================================================

async function getStats() {
  console.log('\n=== Usage Statistics ===');
  
  const response = await fetch(`${GATEWAY_URL}/api/keys/stats`);
  const data = await response.json();
  
  console.log('Key statistics:');
  for (const stat of data.stats) {
    console.log(`- ${stat.provider}: ${stat.usedToday}/${stat.dailyLimit || '∞'} (${stat.remainingQuota ?? '∞'} remaining)`);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  try {
    await basicChat();
    await requestSpecificModel();
    await requestSpecificProvider();
    await restrictProviders();
    await restrictPriorities();
    await listKeys();
    await getStats();
    // await asyncRequest(); // Uncomment if you have the worker running
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
