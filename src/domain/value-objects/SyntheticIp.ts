import IpAddress from './IpAddress';
import MacAddress from './MacAddress';

/**
 * Server-authoritative synthetic online IP derivation.
 *
 * Mirrors the Xenia client's `GNSTransport::SyntheticInaFromPeerKey`
 * (xenia-canary `src/xenia/kernel/gns_transport.cc:132`). Under GNS a console
 * advertises a deterministic `10.0.0.0/8` online IP derived from its MAC (its
 * GNS peer_key) instead of a real, non-P2P-routable public IP. Webservices
 * derives the SAME value here so the address it publishes in a session's XNADDR
 * (`inaOnline`) matches (a) what the host advertises over GNS, (b) what a
 * joiner's `XNetXnAddrToInAddr` maps, and (c) what the host's inbound
 * auto-register computes — all equal to the MAC hash, by construction. This
 * removes the previous "host only *assumes* inaOnline == hash(MAC)" coupling.
 * See `client_synthetics_derivation.md` §2 / §6.
 *
 * Verified against a live capture: MAC `7C1E523BB509` -> `10.194.130.158`.
 */
export default class SyntheticIp {
  // 64-bit mask for the fixed-width multiply/shift (mirrors the C uint64 math).
  private static readonly MASK64 = (1n << 64n) - 1n;
  // 2^64 / golden-ratio — the client's fibonacci mixing constant.
  private static readonly GOLDEN = 0x9e3779b97f4a7c15n;

  /**
   * Derive the synthetic online IP for a console from its MAC. The 48-bit MAC
   * IS the console's GNS peer_key (`XLiveAPI::StartGNS`).
   */
  public static fromMac(mac: MacAddress): IpAddress {
    // MacAddress stores 12 uppercase hex chars in the same byte order as the
    // client's MacAddress::to_uint64() (byte[0] most-significant of the 48).
    const peerKey = BigInt('0x' + mac.value) & 0xffffffffffffn;
    return new IpAddress(SyntheticIp.fromPeerKey(peerKey));
  }

  /**
   * Deterministic `peer_key` (uint64) -> dotted `10.b.c.d` string. Exact port
   * of the client's hash, including the network/broadcast host guards.
   */
  public static fromPeerKey(peerKey: bigint): string {
    // The client returns 0 (invalid) for a zero key; surface the unspecified
    // address so callers can reject it rather than minting a bogus 10.x.
    if (peerKey === 0n) {
      return '0.0.0.0';
    }

    let h = (peerKey * SyntheticIp.GOLDEN) & SyntheticIp.MASK64;
    h ^= h >> 29n;

    let host24 = Number(h & 0xffffffn); // 24 host bits
    if (host24 === 0) {
      host24 = 1; // avoid 10.0.0.0 (network)
    } else if (host24 === 0xffffff) {
      host24 = 0xfffffe; // avoid 10.255.255.255 (broadcast)
    }

    const b = (host24 >> 16) & 0xff;
    const c = (host24 >> 8) & 0xff;
    const d = host24 & 0xff;

    // "10.b.c.d" — the human-readable form of the client's network-order
    // s_addr (first octet `10` sits in the low byte). ipaddr.js round-trips
    // this to the same 32-bit value the client's XNADDR.inaOnline carries.
    return `10.${b}.${c}.${d}`;
  }
}
