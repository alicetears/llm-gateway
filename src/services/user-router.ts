import { getProviderAdapter } from '../providers/index.js';
import { createLogger } from '../utils/logger.js';
import { providerConfigs } from '../config/index.js';
import type {
  ChatRequest,
  ChatResponse,
  LLMProvider,
  ProviderConfig,
} from '../types/index.js';

const logger = createLogger('user-router');

// ============================================================================
// Types
// ============================================================================

interface UserKey {
  id: string;
  provider: LLMProvider;
  apiKey: string;
  priority: number;
  enabled: boolean;
  allowedModels: string[];
  defaultModel: string;
  dailyLimit: number | null;
  usedToday: number;
}

interface RouteResult {
  success: boolean;
  response?: ChatResponse;
  metadata?: {
    keyId: string;
    provider: LLMProvider;
    model: string;
    latencyMs: number;
  };
  error?: string;
  errorCode?: string;
  statusCode?: number;
}

// ============================================================================
// Route with User's Keys
// ============================================================================

export async function routeWithKeys(
  request: ChatRequest,
  keys: UserKey[],
): Promise<RouteResult> {
  const startTime = Date.now();

  // Filter eligible keys
  const eligibleKeys = keys.filter((key) => {
    // Check enabled
    if (!key.enabled) return false;

    // Check quota
    if (key.dailyLimit !== null && key.usedToday >= key.dailyLimit) return false;

    // Check provider match
    if (request.provider !== 'auto' && key.provider !== request.provider) return false;

    // Check model compatibility
    if (request.model) {
      const isAllowed = key.allowedModels.length === 0 || 
        key.allowedModels.some((allowed) => 
          allowed === request.model || 
          allowed === '*' ||
          (allowed.endsWith('*') && request.model!.startsWith(allowed.slice(0, -1)))
        );
      if (!isAllowed) return false;
    }

    return true;
  });

  if (eligibleKeys.length === 0) {
    return {
      success: false,
      error: 'No eligible API key found for this request',
      errorCode: 'NO_ELIGIBLE_KEY',
      statusCode: 400,
    };
  }

  // Sort by priority
  eligibleKeys.sort((a, b) => a.priority - b.priority);

  // Try each key
  for (const key of eligibleKeys) {
    const result = await tryKeyRequest(request, key);
    
    if (result.success) {
      const latencyMs = Date.now() - startTime;
      
      // Update usage count
      await updateKeyUsage(key.id);

      return {
        success: true,
        response: result.response,
        metadata: {
          keyId: key.id,
          provider: key.provider,
          model: result.model!,
          latencyMs,
        },
      };
    }

    logger.warn({ keyId: key.id, error: result.error }, 'Key failed, trying next');
  }

  return {
    success: false,
    error: 'All API keys failed',
    errorCode: 'ALL_KEYS_FAILED',
    statusCode: 502,
  };
}

// ============================================================================
// Try single key
// ============================================================================

async function tryKeyRequest(
  request: ChatRequest,
  key: UserKey,
): Promise<{ success: boolean; response?: ChatResponse; model?: string; error?: string }> {
  try {
    const adapter = getProviderAdapter(key.provider);
    if (!adapter) {
      return { success: false, error: `Provider ${key.provider} not supported` };
    }

    // Resolve model
    const resolvedModel = request.model || key.defaultModel;
    const mappedModel = adapter.mapModelName(resolvedModel);

    // Build config
    const providerSettings = providerConfigs[key.provider];
    const config: ProviderConfig = {
      apiKey: key.apiKey,
      baseUrl: providerSettings.baseUrl,
      timeout: providerSettings.timeout,
    };

    // Make request
    const response = await adapter.chat(
      {
        messages: request.messages,
        model: mappedModel,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        topP: request.topP,
        stream: false,
      },
      config,
    );

    return { success: true, response, model: resolvedModel };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

// ============================================================================
// Update key usage
// ============================================================================

async function updateKeyUsage(keyId: string): Promise<void> {
  try {
    const { getPrismaClient } = await import('../utils/database.js');
    const prisma = getPrismaClient();
    
    await prisma.llmApiKey.update({
      where: { id: keyId },
      data: {
        usedToday: { increment: 1 },
        lastUsedAt: new Date(),
      },
    });
  } catch (error) {
    logger.error({ keyId, error }, 'Failed to update key usage');
  }
}
