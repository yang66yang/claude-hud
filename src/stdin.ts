import type { StdinData } from './types.js';
import { AUTOCOMPACT_BUFFER_PERCENT } from './constants.js';

export async function readStdin(): Promise<StdinData | null> {
  if (process.stdin.isTTY) {
    return null;
  }

  const chunks: string[] = [];

  try {
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      chunks.push(chunk as string);
    }
    const raw = chunks.join('');
    if (!raw.trim()) {
      return null;
    }
    return JSON.parse(raw) as StdinData;
  } catch {
    return null;
  }
}

export function getTotalTokens(stdin: StdinData): number {
  const usage = stdin.context_window?.current_usage;
  if (!usage) return 0;

  // 优先使用 Anthropic 格式
  const anthropicTotal =
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0);

  if (anthropicTotal > 0) return anthropicTotal;

  // 回退到 GLM 格式
  return usage.prompt_tokens ?? usage.total_tokens ?? 0;
}

/**
 * Get native percentage from Claude Code v2.1.6+ if available.
 * Returns null if not available or invalid, triggering fallback to manual calculation.
 */
function getNativePercent(stdin: StdinData): number | null {
  const nativePercent = stdin.context_window?.used_percentage;
  if (typeof nativePercent === 'number' && !Number.isNaN(nativePercent)) {
    return Math.min(100, Math.max(0, Math.round(nativePercent)));
  }
  return null;
}

export function getContextPercent(stdin: StdinData): number {
  const size = stdin.context_window?.context_window_size;
  if (!size || size <= 0) {
    return 0;
  }

  // 手动计算作为基准
  const totalTokens = getTotalTokens(stdin);
  const manualPercent = Math.min(100, Math.round((totalTokens / size) * 100));

  // 优先使用原生百分比，但为 0 时用手动计算兜底
  const native = getNativePercent(stdin);
  if (native !== null && native > 0) {
    return native;
  }

  return manualPercent;
}

export function getBufferedPercent(stdin: StdinData): number {
  const size = stdin.context_window?.context_window_size;
  if (!size || size <= 0) {
    return 0;
  }

  const totalTokens = getTotalTokens(stdin);

  // 手动计算（含 buffer）
  const rawRatio = totalTokens / size;
  const LOW = 0.05;
  const HIGH = 0.50;
  const scale = Math.min(1, Math.max(0, (rawRatio - LOW) / (HIGH - LOW)));
  const buffer = size * AUTOCOMPACT_BUFFER_PERCENT * scale;
  const manualBuffered = Math.min(100, Math.round(((totalTokens + buffer) / size) * 100));

  // 优先使用原生百分比，但为 0 时用手动计算兜底
  const native = getNativePercent(stdin);
  if (native !== null && native > 0) {
    return native;
  }

  return manualBuffered;
}

export function isGLMModelId(modelId?: string): boolean {
  if (!modelId) {
    return false;
  }
  return /^glm-/i.test(modelId.trim());
}

export function normalizeGLMModelLabel(modelId: string): string | null {
  if (!isGLMModelId(modelId)) {
    return null;
  }
  const parts = modelId.trim().split('-');
  if (parts.length >= 1) {
    // GLM-5-Turbo 格式
    return parts.map((p, i) => i === 0 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)).join('-');
  }
  return 'GLM';
}

export function getModelName(stdin: StdinData): string {
  const displayName = stdin.model?.display_name?.trim();
  if (displayName) {
    // 对 GLM 模型 ID 做格式化显示
    const normalizedGLM = normalizeGLMModelLabel(displayName);
    if (normalizedGLM) {
      return normalizedGLM;
    }
    return displayName;
  }

  const modelId = stdin.model?.id?.trim();
  if (!modelId) {
    return 'Unknown';
  }

  const normalizedGLM = normalizeGLMModelLabel(modelId);
  if (normalizedGLM) {
    return normalizedGLM;
  }

  const normalizedBedrockLabel = normalizeBedrockModelLabel(modelId);
  return normalizedBedrockLabel ?? modelId;
}

export function isBedrockModelId(modelId?: string): boolean {
  if (!modelId) {
    return false;
  }
  const normalized = modelId.toLowerCase();
  return normalized.includes('anthropic.claude-');
}

export function getProviderLabel(stdin: StdinData): string | null {
  if (isBedrockModelId(stdin.model?.id)) {
    return 'Bedrock';
  }
  if (isGLMModelId(stdin.model?.id) || isGLMModelId(stdin.model?.display_name)) {
    return 'Zhipu';
  }
  return null;
}

function normalizeBedrockModelLabel(modelId: string): string | null {
  if (!isBedrockModelId(modelId)) {
    return null;
  }

  const lowercaseId = modelId.toLowerCase();
  const claudePrefix = 'anthropic.claude-';
  const claudeIndex = lowercaseId.indexOf(claudePrefix);
  if (claudeIndex === -1) {
    return null;
  }

  let suffix = lowercaseId.slice(claudeIndex + claudePrefix.length);
  suffix = suffix.replace(/-v\d+:\d+$/, '');
  suffix = suffix.replace(/-\d{8}$/, '');

  const tokens = suffix.split('-').filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }

  const familyIndex = tokens.findIndex((token) => token === 'haiku' || token === 'sonnet' || token === 'opus');
  if (familyIndex === -1) {
    return null;
  }

  const family = tokens[familyIndex];
  const beforeVersion = readNumericVersion(tokens, familyIndex - 1, -1).reverse();
  const afterVersion = readNumericVersion(tokens, familyIndex + 1, 1);
  const versionParts = beforeVersion.length >= afterVersion.length ? beforeVersion : afterVersion;
  const version = versionParts.length ? versionParts.join('.') : null;
  const familyLabel = family[0].toUpperCase() + family.slice(1);

  return version ? `Claude ${familyLabel} ${version}` : `Claude ${familyLabel}`;
}

function readNumericVersion(tokens: string[], startIndex: number, step: -1 | 1): string[] {
  const parts: string[] = [];
  for (let i = startIndex; i >= 0 && i < tokens.length; i += step) {
    if (!/^\d+$/.test(tokens[i])) {
      break;
    }
    parts.push(tokens[i]);
    if (parts.length === 2) {
      break;
    }
  }
  return parts;
}
