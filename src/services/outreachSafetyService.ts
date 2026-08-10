import "server-only";
import { Prospect, OutreachStage, OutreachSequenceState } from "@/types";
import { ValidationError } from "@/lib/errors";

export class OutreachSafetyService {
  
  /**
   * Validates whether it is safe to send an outreach email.
   * Throws ValidationError if blocked. Returns true if safe.
   */
  validateSend(prospect: Prospect, requestedStage: OutreachStage): boolean {
    
    // 1. Check Suppression List
    if (prospect.isSuppressed) {
      throw new ValidationError(`Send blocked: Prospect is suppressed (${prospect.suppressionReason}).`);
    }

    // 2. Check Terminal Outreach States
    const terminalStates: OutreachSequenceState[] = ['COMPLETED', 'REPLIED', 'BOUNCED', 'UNSUBSCRIBED', 'STOPPED'];
    if (terminalStates.includes(prospect.outreachState)) {
      throw new ValidationError(`Send blocked: Prospect is in terminal outreach state (${prospect.outreachState}).`);
    }

    // 3. Idempotency: Verify the requested stage matches the expected next stage
    const requiredStateForStage: Record<OutreachStage, OutreachSequenceState> = {
      0: 'UNCONTACTED',
      1: 'INITIAL_SENT',
      2: 'FOLLOW_UP_1_SENT',
      3: 'FOLLOW_UP_2_SENT',
      4: 'FOLLOW_UP_3_SENT',
    };

    if (prospect.outreachState !== requiredStateForStage[requestedStage]) {
      throw new ValidationError(`Send blocked: Sequence state mismatch. Prospect is at ${prospect.outreachState}, but requested stage ${requestedStage} requires ${requiredStateForStage[requestedStage]}.`);
    }

    // 4. Basic Email Validation
    if (!prospect.contactEmail || !prospect.contactEmail.includes('@')) {
      throw new ValidationError("Send blocked: Invalid or missing contact email.");
    }

    return true;
  }

  /**
   * Generates a deterministic idempotency key for Resend.
   * Prevents duplicate sends on network retries.
   */
  generateIdempotencyKey(prospectId: string, stage: OutreachStage): string {
    return `prospect_${prospectId}_stage_${stage}`;
  }
}

export const outreachSafetyService = new OutreachSafetyService();