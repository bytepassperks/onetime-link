import { z } from 'zod';

const urlSchema = z.string().url().refine(
  (url) => {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  },
  { message: 'Only HTTP and HTTPS URLs are allowed' }
);

export function validateDestinationUrl(url: string): { valid: boolean; normalized: string; error?: string } {
  const result = urlSchema.safeParse(url);
  if (!result.success) {
    return { valid: false, normalized: url, error: result.error.issues[0]?.message || 'Invalid URL' };
  }

  try {
    const parsed = new URL(url);
    const normalized = parsed.toString();
    return { valid: true, normalized };
  } catch {
    return { valid: false, normalized: url, error: 'Failed to parse URL' };
  }
}
