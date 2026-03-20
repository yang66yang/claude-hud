import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { createDebug } from './debug.js';
import { getHudPluginDir } from './claude-config-dir.js';

const debug = createDebug('zhipu-usage');

// 缓存 5 分钟
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_FAILURE_TTL_MS = 15_000;

export interface ZhipuUsageData {
  tokenPercentage: number | null;   // Token 用量百分比
  tokenNextReset: Date | null;      // Token 重置时间
  timePercentage: number | null;    // 时间用量百分比
  timeRemaining: number | null;     // 时间剩余（秒）
  timeUsage: number | null;         // 时间已用（秒）
  timeTotal: number | null;         // 时间总量（秒）
  timeNextReset: Date | null;       // 时间重置时间
  level: string | null;             // 账户等级
  apiUnavailable?: boolean;
  apiError?: string;
}

interface ZhipuApiResponse {
  code: number;
  msg: string;
  data?: {
    limits: Array<{
      type: string;
      unit?: number;
      number?: number;
      usage?: number;
      currentValue?: number;
      remaining?: number;
      percentage?: number;
      nextResetTime?: number;
      usageDetails?: Array<{
        modelCode: string;
        usage: number;
      }>;
    }>;
    level?: string;
  };
  success?: boolean;
}

interface CacheFile {
  data: ZhipuUsageData;
  timestamp: number;
}

function getCachePath(homeDir: string): string {
  return path.join(getHudPluginDir(homeDir), '.zhipu-usage-cache.json');
}

function readCache(homeDir: string, now: number): ZhipuUsageData | null {
  try {
    const cachePath = getCachePath(homeDir);
    if (!fs.existsSync(cachePath)) return null;

    const content = fs.readFileSync(cachePath, 'utf8');
    const cache: CacheFile = JSON.parse(content);
    const ttl = cache.data.apiUnavailable ? CACHE_FAILURE_TTL_MS : CACHE_TTL_MS;

    if (now - cache.timestamp > ttl) return null;

    const data = cache.data;
    // 还原 Date 对象
    if (data.tokenNextReset && typeof data.tokenNextReset === 'string') {
      data.tokenNextReset = new Date(data.tokenNextReset);
    }
    if (data.timeNextReset && typeof data.timeNextReset === 'string') {
      data.timeNextReset = new Date(data.timeNextReset);
    }
    return data;
  } catch {
    return null;
  }
}

function writeCache(homeDir: string, data: ZhipuUsageData, now: number): void {
  try {
    const cacheDir = path.dirname(getCachePath(homeDir));
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    const cache: CacheFile = { data, timestamp: now };
    fs.writeFileSync(getCachePath(homeDir), JSON.stringify(cache), 'utf8');
  } catch (e) {
    debug('写入缓存失败:', e);
  }
}

function fetchJson(url: string, token: string): Promise<ZhipuApiResponse> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'claude-code/2.1',
      },
      timeout: 10000,
    };

    const transport = parsedUrl.protocol === 'https:' ? https : http;
    const req = transport.request(options, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('JSON 解析失败'));
        }
      });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

function parseResponse(resp: ZhipuApiResponse): ZhipuUsageData {
  const result: ZhipuUsageData = {
    tokenPercentage: null,
    tokenNextReset: null,
    timePercentage: null,
    timeRemaining: null,
    timeUsage: null,
    timeTotal: null,
    timeNextReset: null,
    level: resp.data?.level ?? null,
  };

  if (!resp.data?.limits) return result;

  for (const limit of resp.data.limits) {
    if (limit.type === 'TOKENS_LIMIT') {
      result.tokenPercentage = limit.percentage ?? null;
      result.tokenNextReset = limit.nextResetTime ? new Date(limit.nextResetTime) : null;
    } else if (limit.type === 'TIME_LIMIT') {
      result.timePercentage = limit.percentage ?? null;
      result.timeRemaining = limit.remaining ?? null;
      result.timeUsage = limit.currentValue ?? null;
      result.timeTotal = limit.usage ?? null;
      result.timeNextReset = limit.nextResetTime ? new Date(limit.nextResetTime) : null;
    }
  }

  return result;
}

export async function getZhipuUsage(): Promise<ZhipuUsageData> {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const now = Date.now();

  // 读取缓存
  const cached = readCache(homeDir, now);
  if (cached) {
    debug('使用缓存数据');
    return cached;
  }

  // 获取 token
  const token = process.env.ANTHROPIC_AUTH_TOKEN?.trim();
  if (!token) {
    const data: ZhipuUsageData = {
      tokenPercentage: null, tokenNextReset: null,
      timePercentage: null, timeRemaining: null,
      timeUsage: null, timeTotal: null, timeNextReset: null,
      level: null,
      apiUnavailable: true,
      apiError: 'no-token',
    };
    writeCache(homeDir, data, now);
    return data;
  }

  try {
    debug('请求智谱额度 API...');
    const resp = await fetchJson(
      'https://www.bigmodel.cn/api/monitor/usage/quota/limit',
      token,
    );

    if (resp.code !== 200 || !resp.success) {
      debug('API 返回错误:', resp.msg);
      const data: ZhipuUsageData = {
        tokenPercentage: null, tokenNextReset: null,
        timePercentage: null, timeRemaining: null,
        timeUsage: null, timeTotal: null, timeNextReset: null,
        level: resp.data?.level ?? null,
        apiUnavailable: true,
        apiError: resp.msg || `http-${resp.code}`,
      };
      writeCache(homeDir, data, now);
      return data;
    }

    const data = parseResponse(resp);
    writeCache(homeDir, data, now);
    return data;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    debug('请求失败:', msg);
    const data: ZhipuUsageData = {
      tokenPercentage: null, tokenNextReset: null,
      timePercentage: null, timeRemaining: null,
      timeUsage: null, timeTotal: null, timeNextReset: null,
      level: null,
      apiUnavailable: true,
      apiError: msg === 'timeout' ? 'timeout' : 'network',
    };
    writeCache(homeDir, data, now);
    return data;
  }
}
