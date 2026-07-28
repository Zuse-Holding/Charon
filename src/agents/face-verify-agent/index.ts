import { RekognitionClient, CompareFacesCommand } from "@aws-sdk/client-rekognition";
import { Source } from "../../types/research.js";

/**
 * Face Verify Agent (Charon, 1:1 identity verification) — given two photos
 * an analyst already has in hand for the same research subject (e.g. a
 * headshot from an OpenCorporates filing vs. a photo in a news article),
 * checks whether they're the same person via AWS Rekognition's
 * CompareFaces API.
 *
 * Deliberately narrow by design, not just by tier gating:
 *  - Takes exactly two images the caller already found/has through normal
 *    research. This agent never searches for or crawls photos itself —
 *    there is no path from "a name" to "a face" anywhere in here.
 *  - Images arrive as raw bytes (uploaded by the analyst in the browser,
 *    base64-decoded by the caller before this runs — see
 *    server/agent-server.ts's /person-research/verify-photo) rather than
 *    URLs, so nothing about them ever needs to be fetched, hosted, or
 *    written to Supabase Storage. Nothing here writes the bytes anywhere;
 *    they exist only for the duration of this one function call.
 *  - CompareFaces is a stateless pairwise call; neither this agent nor AWS
 *    indexes either face anywhere. The only thing that outlives this call
 *    is the resulting confidence score, which the caller writes to
 *    identity_verification_audit as a purpose-limited log, never the
 *    images themselves.
 *  - No embeddings, no face collection, no bulk/background mode. A future
 *    ask to "search the web for this face" is a different, much
 *    higher-risk tool, not an extension of this one — don't repurpose
 *    this agent for that.
 *
 * Requires AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION in env
 * (standard AWS SDK v3 credential/region resolution, no custom parsing
 * here). The IAM identity behind those keys is expected to be scoped to
 * rekognition:CompareFaces only — this agent never calls any other
 * Rekognition action, so it never needs broader permissions than that.
 */
const SIMILARITY_THRESHOLD = 80; // Rekognition's own suggested floor for a confident match

export interface FaceVerifyResult {
  match: boolean;
  confidence?: number; // 0-100 similarity score, set when CompareFaces returned a match
  notes?: string; // set on a well-understood non-match/failure reason rather than a bare false
  sources: Source[]; // always empty — see class doc comment, there's no web source to cite for a user-uploaded photo
}

export class FaceVerifyAgent {
  /**
   * @param imageA @param imageB Raw image bytes (JPEG/PNG), already
   *   decoded from the caller's base64 upload. Rekognition's own limit is
   *   5MB per image passed inline as Bytes — the caller is expected to
   *   enforce that before calling run() so this never has to guess at a
   *   partial/truncated image.
   */
  async run(imageA: Uint8Array, imageB: Uint8Array): Promise<FaceVerifyResult> {
    try {
      const client = new RekognitionClient({});
      const res = await client.send(
        new CompareFacesCommand({
          SourceImage: { Bytes: imageA },
          TargetImage: { Bytes: imageB },
          SimilarityThreshold: SIMILARITY_THRESHOLD,
        })
      );

      const best = res.FaceMatches?.[0];
      if (best) {
        return { match: true, confidence: best.Similarity, sources: [] };
      }
      return { match: false, notes: "No match above the confidence threshold.", sources: [] };
    } catch (err) {
      // Covers Rekognition's InvalidParameterException (no detectable face
      // in one or both images) along with any other API/network failure —
      // both read the same to the caller: not enough to call it a match.
      console.warn(`[face-verify-agent] comparison failed:`, err instanceof Error ? err.message : err);
      return {
        match: false,
        notes: "Comparison failed — no face detected in one or both photos, or the API call errored.",
        sources: [],
      };
    }
  }
}
