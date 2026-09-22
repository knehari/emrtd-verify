import { Type } from "class-transformer";
import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from "class-validator";
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

/** Composantes couleur [0, 1] — voir packages/emrtd-core/src/liveness/types.ts `LightChallengeStep`/`LightSignalSample`. */
export class RgbColorDto {
  @IsNumber()
  r!: number;

  @IsNumber()
  g!: number;

  @IsNumber()
  b!: number;
}

export class LightChallengeStepDto {
  @IsInt()
  @Min(0)
  atMs!: number;

  @ValidateNested()
  @Type(() => RgbColorDto)
  color!: RgbColorDto;
}

/** Doit être renvoyé EXACTEMENT tel qu'émis par `POST /v1/verifications/liveness-challenge` — voir LivenessChallengeService.verifyChallengeIntegrity, appelé avant toute vérification de la réponse elle-même. */
export class LivenessChallengeDto {
  @IsString()
  nonce!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LivenessChallengeStepDto)
  steps!: LivenessChallengeStepDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LightChallengeStepDto)
  lightSequence?: LightChallengeStepDto[];

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

  /** Position dans la séquence, à partir de 0 — voir packages/emrtd-core/src/liveness/frameIntegrity.ts. */
  @IsInt()
  @Min(0)
  frameIndex!: number;

  /** SHA-256 hex chaîné à la frame précédente — voir `computeFrameHash`/`verifyFrameChain` (frameIntegrity.ts). */
  @IsString()
  frameHash!: string;
}

/** Échantillon de lumière perçue/reflétée — voir packages/emrtd-core/src/liveness/types.ts `LightSignalSample`. */
export class LightSignalSampleDto {
  @IsInt()
  timestamp!: number;

  @ValidateNested()
  @Type(() => RgbColorDto)
  perceivedColor!: RgbColorDto;
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

  /** Requis uniquement si `challenge.lightSequence` a été émis (voir verifyLightChallenge, packages/emrtd-core). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LightSignalSampleDto)
  lightSamples?: LightSignalSampleDto[];
}
