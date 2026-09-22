import { IsIn, IsString } from "class-validator";
import type { MobilePlatform } from "../device-attestation.service";

const MOBILE_PLATFORMS: MobilePlatform[] = ["ios", "android"];

/** Voir DeviceAttestationService.verify pour ce qui est réellement vérifié (structure, pas encore la chaîne cryptographique complète). */
export class DeviceAttestationRequestDto {
  @IsIn(MOBILE_PLATFORMS)
  platform!: MobilePlatform;

  @IsString()
  attestationToken!: string;

  @IsString()
  expectedNonce!: string;
}
