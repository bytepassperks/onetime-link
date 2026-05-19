import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import prisma from '../config/database';

export function generateTotpSecret(email: string): { secret: string; uri: string } {
  const totp = new OTPAuth.TOTP({
    issuer: 'OneTimeLink',
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: new OTPAuth.Secret({ size: 20 }),
  });

  return {
    secret: totp.secret.base32,
    uri: totp.toString(),
  };
}

export function verifyTotpToken(secret: string, token: string): boolean {
  const totp = new OTPAuth.TOTP({
    issuer: 'OneTimeLink',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });

  const delta = totp.validate({ token, window: 1 });
  return delta !== null;
}

export async function generateQrCodeDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri, {
    width: 256,
    margin: 2,
    color: {
      dark: '#ffffff',
      light: '#1f2937',
    },
  });
}

export async function enableTotp(adminId: string, secret: string): Promise<void> {
  await prisma.admin.update({
    where: { id: adminId },
    data: {
      totpSecret: secret,
      totpEnabled: true,
    },
  });
}

export async function disableTotp(adminId: string): Promise<void> {
  await prisma.admin.update({
    where: { id: adminId },
    data: {
      totpSecret: null,
      totpEnabled: false,
    },
  });
}

export async function getAdminTotpStatus(adminId: string): Promise<{ enabled: boolean }> {
  const admin = await prisma.admin.findUnique({
    where: { id: adminId },
    select: { totpEnabled: true },
  });
  return { enabled: admin?.totpEnabled ?? false };
}
