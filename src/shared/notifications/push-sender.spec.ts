import { isKnownPushEndpoint } from './push-sender';

describe('isKnownPushEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc:def',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QGx1',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ])('acepta %s', (endpoint) => {
    expect(isKnownPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://169.254.169.254/latest/meta-data',
    'https://localhost/push',
    'https://fcm.googleapis.com:8443/fcm/send/abc',
    'https://user:pass@fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com.evil.test/fcm/send/abc',
    'https://evilpush.apple.com/x',
    'no es una url',
  ])('rechaza %s', (endpoint) => {
    expect(isKnownPushEndpoint(endpoint)).toBe(false);
  });
});
