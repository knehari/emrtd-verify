import { Type } from "class-transformer";
import { IsArray, IsIn, IsInt, IsNumber, IsString, Min, ValidateNested } from "class-validator";
import type { LivenessActionType } from "@emrtd-verify/emrtd-core";

const LIVENESS_ACTION_VALUES: LivenessActionType[] = ["blink", "turn_head_left", "turn_head_right", "open_mouth", "smile"];

export class LivenessChallengeStepDto {
  @IsIn(LIVENESS_ACTION_VALUES)
  action!: LivenessActionType;

  @IsInt()
  @Min(0)
  windowStartMs!: number;

  @IsInt()
  @Min(0)
  windowEndMs!: number;
}

/** Doit être renvoyé EXACTEMENT tel qu'émis par `POST /v1/verifications/liveness-challenge` — voir LivenessChallengeService.verifyChallengeIntegrity, appelé avant toute vérification de la réponse elle-même. */
export class LivenessChallengeDto {
  @IsString()
  nonce!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LivenessChallengeStepDto)
  steps!: LivenessChallengeStepDto[];

  @IsInt()
  issuedAt!: number;

  @IsInt()
  expiresAt!: number;
}

/** Un échantillon de coefficients de forme faciale (ARKit blend shapes ou équivalent) — voir packages/emrtd-core/src/liveness/types.ts `LivenessSignalFrame`. */
export class LivenessSignalFrameDto {
  @IsInt()
  timestamp!: number;

  @IsNumber()
  eyeBlinkLeft!: number;

  @IsNumber()
  eyeBlinkRight!: number;

  @IsNumber()
  jawOpen!: number;

  @IsNumber()
  mouthSmileLeft!: number;

  @IsNumber()
  mouthSmileRight!: number;

  @IsNumber()
  headYawDegrees!: number;
}

/** Réponse mobile au challenge de liveness active (voir docs/facial-recognition.md "Détection de vivacité active"). */
export class ActiveLivenessResponseDto {
  @ValidateNested()
  @Type(() => LivenessChallengeDto)
  challenge!: LivenessChallengeDto;

  @IsString()
  signature!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LivenessSignalFrameDto)
  samples!: LivenessSignalFrameDto[];
}
