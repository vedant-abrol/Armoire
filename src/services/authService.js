import { base44 } from "../api/base44Client.js";

function isUnauthenticated(error) {
  return error?.status === 401 || error?.status === 403;
}

export async function getCurrentUser() {
  try {
    return await base44.auth.me();
  } catch (error) {
    if (isUnauthenticated(error)) return null;
    throw error;
  }
}

export async function loginWithPassword(email, password) {
  const response = await base44.auth.loginViaEmailPassword(email, password);
  return response.user?.email ? response.user : base44.auth.me();
}

export function registerWithPassword(email, password) {
  return base44.auth.register({ email, password });
}

export function verifyRegistration(email, otpCode) {
  return base44.auth.verifyOtp({ email, otpCode });
}

export function resendRegistrationCode(email) {
  return base44.auth.resendOtp(email);
}

export function logout() {
  base44.auth.logout(window.location.origin);
}
