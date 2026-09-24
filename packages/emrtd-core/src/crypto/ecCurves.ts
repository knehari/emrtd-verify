import { weierstrassN, type WeierstrassPoint, type WeierstrassPointCons } from "@noble/curves/abstract/weierstrass";

/**
 * Paramètres de domaine standardisés PACE (BSI TR-03110-3 Table 4 / Doc 9303 Part 11 §9.5.1,
 * "standardizedDomainParameters") — identifiants 8 à 18, courbes elliptiques uniquement (0 à 2 =
 * groupes MODP, non pris en charge : repli sur BAC). Valeurs générées depuis OpenSSL
 * (`openssl ecparam -name <courbe> -param_enc explicit`), pas recopiées à la main ; ecCurves.test.ts
 * vérifie chaque courbe contre `node:crypto` (même clé privée → même clé publique).
 */
interface CurveParams {
  name: string;
  p: bigint;
  a: bigint;
  b: bigint;
  Gx: bigint;
  Gy: bigint;
  n: bigint;
  h: bigint;
}

const STANDARDIZED_EC_PARAMETERS: Record<number, CurveParams> = {
  8: { name: "NIST P-192", p: 0xfffffffffffffffffffffffffffffffeffffffffffffffffn, a: 0xfffffffffffffffffffffffffffffffefffffffffffffffcn, b: 0x64210519e59c80e70fa7e9ab72243049feb8deecc146b9b1n, Gx: 0x188da80eb03090f67cbf20eb43a18800f4ff0afd82ff1012n, Gy: 0x7192b95ffc8da78631011ed6b24cdd573f977a11e794811n, n: 0xffffffffffffffffffffffff99def836146bc9b1b4d22831n, h: 1n },
  9: { name: "brainpoolP192r1", p: 0xc302f41d932a36cda7a3463093d18db78fce476de1a86297n, a: 0x6a91174076b1e0e19c39c031fe8685c1cae040e5c69a28efn, b: 0x469a28ef7c28cca3dc721d044f4496bcca7ef4146fbf25c9n, Gx: 0xc0a0647eaab6a48753b033c56cb0f0900a2f5c4853375fd6n, Gy: 0x14b690866abd5bb88b5f4828c1490002e6773fa2fa299b8fn, n: 0xc302f41d932a36cda7a3462f9e9e916b5be8f1029ac4acc1n, h: 1n },
  10: { name: "NIST P-224", p: 0xffffffffffffffffffffffffffffffff000000000000000000000001n, a: 0xfffffffffffffffffffffffffffffffefffffffffffffffffffffffen, b: 0xb4050a850c04b3abf54132565044b0b7d7bfd8ba270b39432355ffb4n, Gx: 0xb70e0cbd6bb4bf7f321390b94a03c1d356c21122343280d6115c1d21n, Gy: 0xbd376388b5f723fb4c22dfe6cd4375a05a07476444d5819985007e34n, n: 0xffffffffffffffffffffffffffff16a2e0b8f03e13dd29455c5c2a3dn, h: 1n },
  11: { name: "brainpoolP224r1", p: 0xd7c134aa264366862a18302575d1d787b09f075797da89f57ec8c0ffn, a: 0x68a5e62ca9ce6c1c299803a6c1530b514e182ad8b0042a59cad29f43n, b: 0x2580f63ccfe44138870713b1a92369e33e2135d266dbb372386c400bn, Gx: 0xd9029ad2c7e5cf4340823b2a87dc68c9e4ce3174c1e6efdee12c07dn, Gy: 0x58aa56f772c0726f24c6b89e4ecdac24354b9e99caa3f6d3761402cdn, n: 0xd7c134aa264366862a18302575d0fb98d116bc4b6ddebca3a5a7939fn, h: 1n },
  12: { name: "NIST P-256", p: 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn, a: 0xffffffff00000001000000000000000000000000fffffffffffffffffffffffcn, b: 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn, Gx: 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n, Gy: 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n, n: 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n, h: 1n },
  13: { name: "brainpoolP256r1", p: 0xa9fb57dba1eea9bc3e660a909d838d726e3bf623d52620282013481d1f6e5377n, a: 0x7d5a0975fc2c3057eef67530417affe7fb8055c126dc5c6ce94a4b44f330b5d9n, b: 0x26dc5c6ce94a4b44f330b5d9bbd77cbf958416295cf7e1ce6bccdc18ff8c07b6n, Gx: 0x8bd2aeb9cb7e57cb2c4b482ffc81b7afb9de27e1e3bd23c23a4453bd9ace3262n, Gy: 0x547ef835c3dac4fd97f8461a14611dc9c27745132ded8e545c1d54c72f046997n, n: 0xa9fb57dba1eea9bc3e660a909d838d718c397aa3b561a6f7901e0e82974856a7n, h: 1n },
  14: { name: "brainpoolP320r1", p: 0xd35e472036bc4fb7e13c785ed201e065f98fcfa6f6f40def4f92b9ec7893ec28fcd412b1f1b32e27n, a: 0x3ee30b568fbab0f883ccebd46d3f3bb8a2a73513f5eb79da66190eb085ffa9f492f375a97d860eb4n, b: 0x520883949dfdbc42d3ad198640688a6fe13f41349554b49acc31dccd884539816f5eb4ac8fb1f1a6n, Gx: 0x43bd7e9afb53d8b85289bcc48ee5bfe6f20137d10a087eb6e7871e2a10a599c710af8d0d39e20611n, Gy: 0x14fdd05545ec1cc8ab4093247f77275e0743ffed117182eaa9c77877aaac6ac7d35245d1692e8ee1n, n: 0xd35e472036bc4fb7e13c785ed201e065f98fcfa5b68f12a32d482ec7ee8658e98691555b44c59311n, h: 1n },
  15: { name: "NIST P-384", p: 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000ffffffffn, a: 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000fffffffcn, b: 0xb3312fa7e23ee7e4988e056be3f82d19181d9c6efe8141120314088f5013875ac656398d8a2ed19d2a85c8edd3ec2aefn, Gx: 0xaa87ca22be8b05378eb1c71ef320ad746e1d3b628ba79b9859f741e082542a385502f25dbf55296c3a545e3872760ab7n, Gy: 0x3617de4a96262c6f5d9e98bf9292dc29f8f41dbd289a147ce9da3113b5f0b8c00a60b1ce1d7e819d7a431d7c90ea0e5fn, n: 0xffffffffffffffffffffffffffffffffffffffffffffffffc7634d81f4372ddf581a0db248b0a77aecec196accc52973n, h: 1n },
  16: { name: "brainpoolP384r1", p: 0x8cb91e82a3386d280f5d6f7e50e641df152f7109ed5456b412b1da197fb71123acd3a729901d1a71874700133107ec53n, a: 0x7bc382c63d8c150c3c72080ace05afa0c2bea28e4fb22787139165efba91f90f8aa5814a503ad4eb04a8c7dd22ce2826n, b: 0x4a8c7dd22ce28268b39b55416f0447c2fb77de107dcd2a62e880ea53eeb62d57cb4390295dbc9943ab78696fa504c11n, Gx: 0x1d1c64f068cf45ffa2a63a81b7c13f6b8847a3e77ef14fe3db7fcafe0cbd10e8e826e03436d646aaef87b2e247d4af1en, Gy: 0x8abe1d7520f9c2a45cb1eb8e95cfd55262b70b29feec5864e19c054ff99129280e4646217791811142820341263c5315n, n: 0x8cb91e82a3386d280f5d6f7e50e641df152f7109ed5456b31f166e6cac0425a7cf3ab6af6b7fc3103b883202e9046565n, h: 1n },
  17: { name: "brainpoolP512r1", p: 0xaadd9db8dbe9c48b3fd4e6ae33c9fc07cb308db3b3c9d20ed6639cca703308717d4d9b009bc66842aecda12ae6a380e62881ff2f2d82c68528aa6056583a48f3n, a: 0x7830a3318b603b89e2327145ac234cc594cbdd8d3df91610a83441caea9863bc2ded5d5aa8253aa10a2ef1c98b9ac8b57f1117a72bf2c7b9e7c1ac4d77fc94can, b: 0x3df91610a83441caea9863bc2ded5d5aa8253aa10a2ef1c98b9ac8b57f1117a72bf2c7b9e7c1ac4d77fc94cadc083e67984050b75ebae5dd2809bd638016f723n, Gx: 0x81aee4bdd82ed9645a21322e9c4c6a9385ed9f70b5d916c1b43b62eef4d0098eff3b1f78e2d0d48d50d1687b93b97d5f7c6d5047406a5e688b352209bcb9f822n, Gy: 0x7dde385d566332ecc0eabfa9cf7822fdf209f70024a57b1aa000c55b881f8111b2dcde494a5f485e5bca4bd88a2763aed1ca2b2fa8f0540678cd1e0f3ad80892n, n: 0xaadd9db8dbe9c48b3fd4e6ae33c9fc07cb308db3b3c9d20ed6639cca70330870553e5c414ca92619418661197fac10471db1d381085ddaddb58796829ca90069n, h: 1n },
  18: { name: "NIST P-521", p: 0x1ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn, a: 0x1fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffcn, b: 0x51953eb9618e1c9a1f929a21a0b68540eea2da725b99b315f3b8b489918ef109e156193951ec7e937b1652c0bd3bb1bf073573df883d2c34f1ef451fd46b503f00n, Gx: 0xc6858e06b70404e9cd9e3ecb662395b4429c648139053fb521f828af606b4d3dbaa14b5e77efe75928fe1dc127a2ffa8de3348b3c1856a429bf97e7e31c2e5bd66n, Gy: 0x11839296a789a3bc0045c8a5fb42c7d1bd998f54449579b446817afbd17273e662c97ee72995ef42640c550b9013fad0761353c7086a272c24088be94769fd16650n, n: 0x1fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa51868783bf2f966b7fcc0148f709a5d03bb5c9b8899c47aebb6fb71e91386409n, h: 1n },
};

export type EcPoint = WeierstrassPoint<bigint>;

export interface EcDomain {
  parameterId: number;
  name: string;
  Point: WeierstrassPointCons<bigint>;
  /** Ordre du sous-groupe (n). */
  order: bigint;
  /** Taille en octets d'une coordonnée (⌈log2(p)/8⌉). */
  fieldLength: number;
}

const cache = new Map<number, EcDomain>();

/** Courbe correspondant à un identifiant de paramètres standardisé, ou `undefined` si non pris en charge. */
export function standardizedEcDomain(parameterId: number): EcDomain | undefined {
  const cached = cache.get(parameterId);
  if (cached) return cached;
  const params = STANDARDIZED_EC_PARAMETERS[parameterId];
  if (!params) return undefined;
  const { name, ...opts } = params;
  const domain: EcDomain = {
    parameterId,
    name,
    Point: weierstrassN(opts),
    order: params.n,
    fieldLength: Math.ceil(params.p.toString(16).length / 2),
  };
  cache.set(parameterId, domain);
  return domain;
}

export function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

export function bigIntToBytes(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) throw new Error(`Entier trop grand pour ${length} octets`);
  return out;
}

/** Encodage non compressé X9.62 (0x04 || x || y), seul format utilisé par PACE. */
export function encodePoint(domain: EcDomain, point: EcPoint): Uint8Array {
  const { x, y } = point.toAffine();
  const out = new Uint8Array(1 + 2 * domain.fieldLength);
  out[0] = 0x04;
  out.set(bigIntToBytes(x, domain.fieldLength), 1);
  out.set(bigIntToBytes(y, domain.fieldLength), 1 + domain.fieldLength);
  return out;
}

/** Décode un point non compressé et vérifie qu'il est bien sur la courbe (jamais faire confiance à la puce). */
export function decodePoint(domain: EcDomain, bytes: Uint8Array): EcPoint {
  if (bytes.length !== 1 + 2 * domain.fieldLength || bytes[0] !== 0x04) {
    throw new Error(`Point EC mal encodé (${bytes.length} octets, attendu 0x04 || x || y sur ${domain.fieldLength} octets chacun)`);
  }
  const x = bytesToBigInt(bytes.subarray(1, 1 + domain.fieldLength));
  const y = bytesToBigInt(bytes.subarray(1 + domain.fieldLength));
  const point = domain.Point.fromAffine({ x, y });
  point.assertValidity();
  if (point.equals(domain.Point.ZERO)) throw new Error("Point à l'infini refusé");
  return point;
}
