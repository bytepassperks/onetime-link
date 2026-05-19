import { customAlphabet } from 'nanoid';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const generateId = customAlphabet(ALPHABET, 8);

export function generateSlug(): string {
  return generateId();
}

export function isValidSlug(slug: string): boolean {
  return /^[a-zA-Z0-9_-]{3,64}$/.test(slug);
}
