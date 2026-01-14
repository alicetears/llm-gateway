/**
 * Example script to seed API keys into the database
 * 
 * Usage: npx tsx examples/seed-keys.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedKeys() {
  console.log('Seeding API keys...');

  // Example: OpenAI keys with different model access
  const openaiPremium = await prisma.llmApiKey.create({
    data: {
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY || 'sk-your-premium-key',
      name: 'OpenAI Premium (GPT-4o)',
      priority: 1,
      enabled: true,
      allowedModels: ['gpt-4o', 'gpt-4o-2024-11-20', 'o1-preview', 'o1-mini'],
      defaultModel: 'gpt-4o',
      dailyLimit: 500,
    },
  });
  console.log(`Created: ${openaiPremium.name} (${openaiPremium.id})`);

  const openaiStandard = await prisma.llmApiKey.create({
    data: {
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY_2 || 'sk-your-standard-key',
      name: 'OpenAI Standard (GPT-4o-mini)',
      priority: 2,
      enabled: true,
      allowedModels: ['gpt-4o-mini', 'gpt-3.5-turbo'],
      defaultModel: 'gpt-4o-mini',
      dailyLimit: 5000,
    },
  });
  console.log(`Created: ${openaiStandard.name} (${openaiStandard.id})`);

  // Example: Anthropic key
  const anthropic = await prisma.llmApiKey.create({
    data: {
      provider: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY || 'sk-ant-your-key',
      name: 'Anthropic Claude',
      priority: 1,
      enabled: true,
      allowedModels: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
      defaultModel: 'claude-3-5-sonnet-20241022',
      dailyLimit: 1000,
    },
  });
  console.log(`Created: ${anthropic.name} (${anthropic.id})`);

  // Example: OpenRouter as fallback (supports many models)
  const openrouter = await prisma.llmApiKey.create({
    data: {
      provider: 'openrouter',
      apiKey: process.env.OPENROUTER_API_KEY || 'sk-or-your-key',
      name: 'OpenRouter Fallback',
      priority: 3,
      enabled: true,
      allowedModels: [], // Empty = allow all models
      defaultModel: 'anthropic/claude-3.5-sonnet',
      dailyLimit: null, // Unlimited
    },
  });
  console.log(`Created: ${openrouter.name} (${openrouter.id})`);

  // Example: Groq for fast inference
  const groq = await prisma.llmApiKey.create({
    data: {
      provider: 'groq',
      apiKey: process.env.GROQ_API_KEY || 'gsk_your-key',
      name: 'Groq Fast Inference',
      priority: 1,
      enabled: true,
      allowedModels: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
      defaultModel: 'llama-3.3-70b-versatile',
      dailyLimit: 10000,
    },
  });
  console.log(`Created: ${groq.name} (${groq.id})`);

  // Example: DeepSeek for cost-effective reasoning
  const deepseek = await prisma.llmApiKey.create({
    data: {
      provider: 'deepseek',
      apiKey: process.env.DEEPSEEK_API_KEY || 'sk-your-deepseek-key',
      name: 'DeepSeek V3',
      priority: 2,
      enabled: true,
      allowedModels: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
      defaultModel: 'deepseek-chat',
      dailyLimit: null,
    },
  });
  console.log(`Created: ${deepseek.name} (${deepseek.id})`);

  console.log('\nSeeding complete!');
  console.log('\nKey hierarchy:');
  console.log('Priority 1: OpenAI GPT-4o, Anthropic Claude, Groq LLaMA');
  console.log('Priority 2: OpenAI GPT-4o-mini, DeepSeek');
  console.log('Priority 3: OpenRouter (fallback)');
}

seedKeys()
  .catch((error) => {
    console.error('Seeding failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
