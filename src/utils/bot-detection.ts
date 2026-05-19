// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const UAParser = require('ua-parser-js');
import crypto from 'crypto';

const BOT_PATTERNS = [
  /bot/i, /crawl/i, /spider/i, /slurp/i, /facebook/i, /twitter/i,
  /whatsapp/i, /telegram/i, /discord/i, /slack/i, /linkedin/i,
  /preview/i, /fetch/i, /wget/i, /curl/i, /http/i, /python/i,
  /java\//i, /ruby/i, /perl/i, /php/i, /go-http/i, /node-fetch/i,
  /axios/i, /undici/i, /got\//i, /postman/i, /insomnia/i,
  /googlebot/i, /bingbot/i, /yandex/i, /baidu/i, /duckduckbot/i,
  /semrush/i, /ahrefs/i, /mj12bot/i, /dotbot/i, /petalbot/i,
  /applebot/i, /mediapartners/i, /adsbot/i,
  /facebookexternalhit/i, /twitterbot/i, /linkedinbot/i,
  /skypeuripreview/i, /embedly/i, /quora/i, /outbrain/i,
  /pinterest/i, /redditbot/i, /rogerbot/i, /showyoubot/i,
  /flipboard/i, /tumblr/i, /bitly/i, /vkshare/i, /w3c_validator/i,
  /statuspage/i, /uptimerobot/i, /monitoring/i, /pingdom/i,
  /newrelic/i, /datadog/i, /headlesschrome/i, /phantomjs/i,
  /slimerjs/i, /casperjs/i, /selenium/i, /puppeteer/i,
];

const PREVIEW_PATTERNS = [
  /facebookexternalhit/i, /twitterbot/i, /linkedinbot/i,
  /slackbot/i, /discordbot/i, /telegrambot/i, /whatsapp/i,
  /skypeuripreview/i, /embedly/i, /outbrain/i, /pinterest/i,
  /redditbot/i, /vkshare/i,
];

export interface BotDetectionResult {
  isBot: boolean;
  isPreviewAgent: boolean;
  isSuspicious: boolean;
  reason: string | null;
}

export function detectBot(userAgent: string | undefined, method: string): BotDetectionResult {
  if (!userAgent || userAgent.trim() === '') {
    return { isBot: false, isPreviewAgent: false, isSuspicious: true, reason: 'empty_user_agent' };
  }

  if (method === 'HEAD' || method === 'OPTIONS') {
    return { isBot: false, isPreviewAgent: false, isSuspicious: true, reason: 'non_get_method' };
  }

  for (const pattern of PREVIEW_PATTERNS) {
    if (pattern.test(userAgent)) {
      return { isBot: true, isPreviewAgent: true, isSuspicious: false, reason: 'preview_agent' };
    }
  }

  for (const pattern of BOT_PATTERNS) {
    if (pattern.test(userAgent)) {
      return { isBot: true, isPreviewAgent: false, isSuspicious: false, reason: 'known_bot' };
    }
  }

  const parser = new UAParser(userAgent);
  const browser = parser.getBrowser();
  const os = parser.getOS();

  if (!browser.name && !os.name) {
    return { isBot: false, isPreviewAgent: false, isSuspicious: true, reason: 'unrecognized_ua' };
  }

  return { isBot: false, isPreviewAgent: false, isSuspicious: false, reason: null };
}

export function hashIp(ip: string): string {
  const salt = process.env.SESSION_SECRET || 'default-salt';
  return crypto.createHash('sha256').update(ip + salt).digest('hex').substring(0, 16);
}
