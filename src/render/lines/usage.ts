import type { RenderContext } from '../../types.js';
import { isLimitReached } from '../../types.js';
import { getProviderLabel } from '../../stdin.js';
import { critical, warning, dim, getQuotaColor, quotaBar, RESET } from '../colors.js';

export function renderUsageLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  const colors = ctx.config?.colors;

  if (display?.showUsage === false) {
    return null;
  }

  // 智谱额度显示（非 Anthropic 提供商时）
  if (ctx.zhipuUsage) {
    return renderZhipuUsageLine(ctx.zhipuUsage, colors);
  }

  if (!ctx.usageData?.planName) {
    return null;
  }

  if (getProviderLabel(ctx.stdin)) {
    return null;
  }

  const label = dim('Usage');

  if (ctx.usageData.apiUnavailable) {
    const errorHint = formatUsageError(ctx.usageData.apiError);
    return `${label} ${warning(`⚠${errorHint}`, colors)}`;
  }

  if (isLimitReached(ctx.usageData)) {
    const resetTime = ctx.usageData.fiveHour === 100
      ? formatResetTime(ctx.usageData.fiveHourResetAt)
      : formatResetTime(ctx.usageData.sevenDayResetAt);
    return `${label} ${critical(`⚠ Limit reached${resetTime ? ` (resets ${resetTime})` : ''}`, colors)}`;
  }

  const threshold = display?.usageThreshold ?? 0;
  const fiveHour = ctx.usageData.fiveHour;
  const sevenDay = ctx.usageData.sevenDay;

  const effectiveUsage = Math.max(fiveHour ?? 0, sevenDay ?? 0);
  if (effectiveUsage < threshold) {
    return null;
  }

  const fiveHourDisplay = formatUsagePercent(ctx.usageData.fiveHour, colors);
  const fiveHourReset = formatResetTime(ctx.usageData.fiveHourResetAt);

  const usageBarEnabled = display?.usageBarEnabled ?? true;
  const fiveHourPart = usageBarEnabled
    ? (fiveHourReset
        ? `${quotaBar(fiveHour ?? 0, 10, colors)} ${fiveHourDisplay} (${fiveHourReset} / 5h)`
        : `${quotaBar(fiveHour ?? 0, 10, colors)} ${fiveHourDisplay}`)
    : (fiveHourReset
        ? `5h: ${fiveHourDisplay} (${fiveHourReset})`
        : `5h: ${fiveHourDisplay}`);

  const sevenDayThreshold = display?.sevenDayThreshold ?? 80;
  const syncingSuffix = ctx.usageData.apiError === 'rate-limited'
    ? ` ${dim('(syncing...)')}`
    : '';
  if (sevenDay !== null && sevenDay >= sevenDayThreshold) {
    const sevenDayDisplay = formatUsagePercent(sevenDay, colors);
    const sevenDayReset = formatResetTime(ctx.usageData.sevenDayResetAt);
    const sevenDayPart = usageBarEnabled
      ? (sevenDayReset
          ? `${quotaBar(sevenDay, 10, colors)} ${sevenDayDisplay} (${sevenDayReset} / 7d)`
          : `${quotaBar(sevenDay, 10, colors)} ${sevenDayDisplay}`)
      : (sevenDayReset
          ? `7d: ${sevenDayDisplay} (${sevenDayReset})`
          : `7d: ${sevenDayDisplay}`);
    return `${label} ${fiveHourPart} | ${sevenDayPart}${syncingSuffix}`;
  }

  return `${label} ${fiveHourPart}${syncingSuffix}`;
}

function renderZhipuUsageLine(
  zhipuUsage: import('../../zhipu-usage.js').ZhipuUsageData,
  colors: RenderContext['config']['colors'] | undefined,
): string | null {
  const label = dim('Quota');

  if (zhipuUsage.apiUnavailable) {
    const errorHint = zhipuUsage.apiError === 'no-token'
      ? 'no token'
      : (zhipuUsage.apiError === 'timeout' ? 'timeout' : 'err');
    return `${label} ${warning(`⚠(${errorHint})`, colors)}`;
  }

  const parts: string[] = [];

  // Token 额度 + 刷新时间点
  if (zhipuUsage.tokenPercentage !== null) {
    const tp = zhipuUsage.tokenPercentage;
    const color = getQuotaColor(tp, colors);
    const resetStr = formatResetDateTime(zhipuUsage.tokenNextReset);
    const resetSuffix = resetStr ? ` (${resetStr})` : '';
    parts.push(`token ${quotaBar(tp, 6, colors)} ${color}${tp}%${RESET}${dim(resetSuffix)}`);
  }

  // MCP 额度
  if (zhipuUsage.timePercentage !== null) {
    const mcpP = zhipuUsage.timePercentage;
    const color = getQuotaColor(mcpP, colors);
    parts.push(`mcp ${quotaBar(mcpP, 6, colors)} ${color}${mcpP}%${RESET}`);
  }

  if (parts.length === 0) {
    return null;
  }

  return `${label} ${parts.join(' │ ')}`;
}

function formatUsagePercent(percent: number | null, colors?: RenderContext['config']['colors']): string {
  if (percent === null) {
    return dim('--');
  }
  const color = getQuotaColor(percent, colors);
  return `${color}${percent}%${RESET}`;
}

function formatUsageError(error?: string): string {
  if (!error) return '';
  if (error === 'rate-limited') return ' (syncing...)';
  if (error.startsWith('http-')) return ` (${error.slice(5)})`;
  return ` (${error})`;
}

function formatResetTime(resetAt: Date | null): string {
  if (!resetAt) return '';
  const now = new Date();
  const diffMs = resetAt.getTime() - now.getTime();
  if (diffMs <= 0) return '';

  const diffMins = Math.ceil(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;

  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    if (remHours > 0) return `${days}d ${remHours}h`;
    return `${days}d`;
  }

  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatResetDateTime(resetAt: Date | null): string {
  if (!resetAt) return '';
  const h = resetAt.getHours().toString().padStart(2, '0');
  const m = resetAt.getMinutes().toString().padStart(2, '0');
  const month = (resetAt.getMonth() + 1).toString().padStart(2, '0');
  const day = resetAt.getDate().toString().padStart(2, '0');
  return `${month}-${day} ${h}:${m}`;
}
