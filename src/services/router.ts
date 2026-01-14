import { getProviderAdapter, isProviderSupported } from '../providers/index.js';
import { getKeyManager, KeyManager } from './key-manager.js';
import { UsageTracker } from './usage-tracker.js';
import { createLogger } from '../utils/logger.js';
import { config, providerConfigs } from '../config/index.js';
import type {
  ChatRequest,
  ChatResponse,
  KeySelectionResult,
  LLMProvider,
  ProviderConfig,
  RoutingContext,
} from '../types/index.js';
import {
  LLMGatewayError,
  NoEligibleKeyError,
  ProviderError,
  ModelNotSupportedError,
} from '../types/index.js';

const logger = createLogger('router');

// ============================================================================
// Request Router Service
// ============================================================================

export class RequestRouter {
  private keyManager: KeyManager;
  private usageTracker: UsageTracker;
  private maxRetries: number;
  private retryDelayMs: number;

  constructor() {
    this.keyManager = getKeyManager();
    this.usageTracker = new UsageTracker();
    this.maxRetries = config.maxRetries;
    this.retryDelayMs = config.retryDelayMs;
  }

  /**
   * Route and execute a chat request
   */
  async route(request: ChatRequest): Promise<{
    response: ChatResponse;
    metadata: {
      keyId: string;
      provider: LLMProvider;
      model: string;
      latencyMs: number;
    };
  }> {
    const startTime = Date.now();
    const requestId = request.requestId || `req_${Date.now()}`;

    logger.info(
      {
        requestId,
        requestedModel: request.model,
        requestedProvider: request.provider,
      },
      'Routing request',
    );

    // Build routing context
    const context: RoutingContext = {
      requestedModel: request.model,
      requestedProvider: request.provider,
      allowedProviders: request.allowedProviders,
      allowedPriorities: request.allowedPriorities,
    };

    // Track attempted keys to avoid retrying the same key
    const attemptedKeyIds = new Set<string>();
    let lastError: Error | null = null;

    // Try to route the request with retries
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        // Select an eligible key
        const selection = await this.selectKeyWithFallback(context, attemptedKeyIds);
        attemptedKeyIds.add(selection.key.id);

        // Get the provider adapter
        const adapter = getProviderAdapter(selection.key.provider);
        if (!adapter) {
          throw new ProviderError(selection.key.provider, 'Provider adapter not found');
        }

        // Validate model is supported by the provider
        if (!adapter.validateModel(selection.resolvedModel)) {
          throw new ModelNotSupportedError(selection.resolvedModel, selection.key.provider);
        }

        // Build provider config
        const providerConfig = this.buildProviderConfig(selection.key);

        // Map the model name if needed
        const mappedModel = adapter.mapModelName(selection.resolvedModel);

        logger.debug(
          {
            requestId,
            keyId: selection.key.id,
            provider: selection.key.provider,
            originalModel: selection.resolvedModel,
            mappedModel,
          },
          'Executing request',
        );

        // Execute the request
        const response = await adapter.chat(
          {
            messages: request.messages,
            model: mappedModel,
            temperature: request.temperature,
            maxTokens: request.maxTokens,
            topP: request.topP,
            stream: request.stream,
          },
          providerConfig,
        );

        const latencyMs = Date.now() - startTime;

        // Update usage
        await this.keyManager.incrementUsage(selection.key.id);

        // Log usage
        await this.usageTracker.logUsage({
          keyId: selection.key.id,
          provider: selection.key.provider,
          model: selection.resolvedModel,
          requestedModel: request.model,
          promptTokens: response.usage?.promptTokens,
          completionTokens: response.usage?.completionTokens,
          totalTokens: response.usage?.totalTokens,
          latencyMs,
          success: true,
          requestId,
        });

        logger.info(
          {
            requestId,
            keyId: selection.key.id,
            provider: selection.key.provider,
            model: selection.resolvedModel,
            latencyMs,
          },
          'Request completed successfully',
        );

        return {
          response,
          metadata: {
            keyId: selection.key.id,
            provider: selection.key.provider,
            model: selection.resolvedModel,
            latencyMs,
          },
        };
      } catch (error) {
        lastError = error as Error;

        logger.warn(
          {
            requestId,
            attempt: attempt + 1,
            maxRetries: this.maxRetries,
            error: lastError.message,
          },
          'Request attempt failed',
        );

        // Don't retry for certain errors
        if (this.isNonRetryableError(error)) {
          break;
        }

        // Wait before retry with exponential backoff
        if (attempt < this.maxRetries - 1) {
          const delay = this.retryDelayMs * Math.pow(2, attempt);
          await this.sleep(delay);
        }
      }
    }

    // All attempts failed
    const latencyMs = Date.now() - startTime;
    
    await this.usageTracker.logUsage({
      keyId: 'unknown',
      provider: (context.requestedProvider === 'auto' ? 'openai' : context.requestedProvider) as LLMProvider,
      model: context.requestedModel || 'unknown',
      requestedModel: request.model,
      latencyMs,
      success: false,
      errorMessage: lastError?.message,
      requestId,
    });

    logger.error(
      {
        requestId,
        error: lastError?.message,
        attemptedKeys: Array.from(attemptedKeyIds),
      },
      'All routing attempts failed',
    );

    if (lastError instanceof LLMGatewayError) {
      throw lastError;
    }

    throw new NoEligibleKeyError(context.requestedModel, context.requestedProvider);
  }

  /**
   * Select a key with fallback to other keys if needed
   */
  private async selectKeyWithFallback(
    context: RoutingContext,
    attemptedKeyIds: Set<string>,
  ): Promise<KeySelectionResult> {
    const selection = await this.keyManager.selectKey(context);

    // If the selected key was already attempted, try to get another one
    if (attemptedKeyIds.has(selection.key.id)) {
      // Create a modified context that excludes the attempted key's priority
      // This forces selection from the next priority group
      throw new ProviderError(
        selection.key.provider,
        'Key already attempted, trying next',
        503,
      );
    }

    return selection;
  }

  /**
   * Build provider configuration from key info
   */
  private buildProviderConfig(key: { provider: LLMProvider; apiKey: string }): ProviderConfig {
    const providerSettings = providerConfigs[key.provider];
    
    return {
      apiKey: key.apiKey,
      baseUrl: providerSettings.baseUrl,
      timeout: providerSettings.timeout,
    };
  }

  /**
   * Check if an error should not be retried
   */
  private isNonRetryableError(error: unknown): boolean {
    if (error instanceof LLMGatewayError) {
      // Don't retry client errors (4xx)
      if (error.statusCode >= 400 && error.statusCode < 500) {
        return error.statusCode !== 429; // Retry rate limits
      }
    }
    return false;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let routerInstance: RequestRouter | null = null;

export function getRouter(): RequestRouter {
  if (!routerInstance) {
    routerInstance = new RequestRouter();
  }
  return routerInstance;
}
