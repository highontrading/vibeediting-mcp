import { ACTIVATE_URL } from '../util/config.js';

export type LicenseReason =
  | 'invalid_format'
  | 'not_found'
  | 'revoked'
  | 'expired'
  | 'activation_limit'
  | 'bad_request'
  | 'server_error';

const help = `Help: ${ACTIVATE_URL}`;

export function missingKeyMessage(): string {
  return [
    'vibeediting is not activated on this computer yet: no license key was found.',
    'Ask the user for their license key (it looks like VIBE-XXXX-XXXX-XXXX-XXXX and is in their purchase email), then call activate_license with it. Nothing else needs to be installed or restarted.',
    help,
  ].join('\n');
}

export function reasonMessage(reason: LicenseReason | string): string {
  switch (reason) {
    case 'invalid_format':
    case 'not_found':
      return `Your vibeediting license key was not accepted. Check your key for typos (it looks like VIBE-XXXX-XXXX-XXXX-XXXX). ${help}`;
    case 'activation_limit':
      return `Your key is in use on 2 computers. Deactivate one (on that computer, say "Deactivate vibeediting on this computer"), or email support. ${help}`;
    case 'revoked':
      return `This key was disabled. Contact support. ${help}`;
    case 'expired':
      return `Your license has expired. ${help}`;
    case 'bad_request':
      return `The license check failed because the request was not understood. Restart your AI app to get the latest vibeediting version. If it keeps happening, contact support. ${help}`;
    default:
      return `The license check failed (${reason}). Try again in a minute. ${help}`;
  }
}

export function offlineNeverActivatedMessage(): string {
  return `I could not reach the vibeediting license server, and this computer has not been activated yet. Connect to the internet once and try again. Your videos stay on your computer; only the license key is checked. ${help}`;
}

export function graceExpiredMessage(days: number): string {
  return `I could not reach the vibeediting license server for more than ${days} days. Connect to the internet once so your license can be re-checked, then try again. ${help}`;
}
