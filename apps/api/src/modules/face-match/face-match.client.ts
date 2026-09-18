import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { FaceMatchResult } from "@emrtd-verify/shared-types";

export interface FaceMatchRequest {
  /** Image DG2 extraite de la puce. */
  referenceImage: Uint8Array;
  /** Capture vivante côté mobile. */
  probeImage: Uint8Array;
}

/**
 * Client HTTP interne vers services/face-match. L'API ne traite jamais elle-même
 * une image de visage : elle délègue systématiquement et ne conserve que le score
 * retourné (voir docs/facial-recognition.md et docs/gdpr-compliance.md).
 */
@Injectable()
export class FaceMatchClient {
  constructor(private readonly config: ConfigService) {}

  async compare(request: FaceMatchRequest): Promise<FaceMatchResult> {
    const baseUrl = this.config.get<string>("FACE_MATCH_URL");
    const apiKey = this.config.get<string>("FACE_MATCH_API_KEY");

    const response = await fetch(`${baseUrl}/v1/compare`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        reference_image: Buffer.from(request.referenceImage).toString("base64"),
        probe_image: Buffer.from(request.probeImage).toString("base64"),
      }),
    });

    if (!response.ok) {
      throw new Error(`services/face-match a répondu ${response.status}`);
    }

    const body = (await response.json()) as {
      similarity_score: number;
      match_decision: FaceMatchResult["matchDecision"];
      liveness_passed: boolean;
      quality_warnings: string[];
    };

    return {
      similarityScore: body.similarity_score,
      matchDecision: body.match_decision,
      livenessPassed: body.liveness_passed,
      qualityWarnings: body.quality_warnings,
    };
  }
}
