import SyntheticIp from './SyntheticIp';
import MacAddress from './MacAddress';

describe('SyntheticIp', () => {
  it('matches the live capture (MAC 7C1E523BB509 -> 10.194.130.158)', () => {
    expect(SyntheticIp.fromMac(new MacAddress('7C1E523BB509')).value).toBe(
      '10.194.130.158',
    );
  });

  it('is case-insensitive on MAC input (MacAddress normalises to upper)', () => {
    expect(SyntheticIp.fromMac(new MacAddress('7c1e523bb509')).value).toBe(
      SyntheticIp.fromMac(new MacAddress('7C1E523BB509')).value,
    );
  });

  it('is deterministic and always in 10.0.0.0/8', () => {
    for (const mac of [
      '00224801AB02',
      'FFFFFFFFFFFF',
      '000000000001',
      'DEADBEEF0001',
    ]) {
      const ip = SyntheticIp.fromMac(new MacAddress(mac)).value;
      expect(ip).toBe(SyntheticIp.fromMac(new MacAddress(mac)).value); // stable
      expect(ip.startsWith('10.')).toBe(true);
    }
  });

  it('avoids the network (10.0.0.0) and broadcast (10.255.255.255) hosts', () => {
    // Guards act on host24; assert the property holds across a sweep of keys.
    for (let i = 1n; i < 5000n; i++) {
      const ip = SyntheticIp.fromPeerKey(i);
      expect(ip).not.toBe('10.0.0.0');
      expect(ip).not.toBe('10.255.255.255');
    }
  });

  it('returns the unspecified address for a zero peer_key', () => {
    expect(SyntheticIp.fromPeerKey(0n)).toBe('0.0.0.0');
  });
});
