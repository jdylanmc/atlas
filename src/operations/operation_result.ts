import type { Finding } from "../domain/finding.ts";

export const operationResultSchemaVersion = "1.0.0";
export const operationHandoffSchemaVersion = "1.0.0";

export interface OperationIdentity {
  readonly kind: string;
  readonly subject: string;
}

export type OperationReference =
  | {
      readonly reason: string;
      readonly state: "not-applicable" | "unknown";
    }
  | {
      readonly reference: string;
      readonly state: "known";
    };

export type OperationChanges =
  | {
      readonly reason: string;
      readonly state: "not-applicable" | "unknown";
    }
  | {
      readonly state: "available";
      readonly summary: string;
    };

export type OperationReviewLink =
  | {
      readonly reason: string;
      readonly state: "not-applicable" | "unknown";
    }
  | {
      readonly state: "available";
      readonly url: string;
    };

export type OperationDegradationState =
  | {
      readonly reason: string;
      readonly state: "not-degraded";
    }
  | {
      readonly reason: string;
      readonly state: "degraded";
    };

export type OperationHumanDecisions =
  | {
      readonly state: "none";
      readonly summary: string;
    }
  | {
      readonly decisions: readonly string[];
      readonly state: "pending";
    };

export interface OperationSummary {
  readonly disposition: "failed" | "success";
  readonly summary: string;
}

export interface OperationValidationState {
  readonly findings: readonly Finding[];
  readonly state: "failed" | "not-completed" | "passed";
}

export interface OperationHandoff<
  Operation extends OperationIdentity = OperationIdentity,
> {
  readonly "operation-handoff-schema": typeof operationHandoffSchemaVersion;
  readonly baseSnapshot: OperationReference;
  readonly degradationState: OperationDegradationState;
  readonly homeAtlas: OperationReference;
  readonly operation: Operation;
  readonly proposedChanges: OperationChanges;
  readonly recommendedNextAction: string;
  readonly result: OperationSummary;
  readonly reviewLink: OperationReviewLink;
  readonly unresolvedHumanDecisions: OperationHumanDecisions;
  readonly validationState: OperationValidationState;
}

export interface OperationResult<
  Operation extends OperationIdentity = OperationIdentity,
  Handoff extends OperationHandoff<Operation> = OperationHandoff<Operation>,
  Payload = unknown,
> {
  readonly "operation-result-schema": typeof operationResultSchemaVersion;
  readonly completion: "completed" | "not-completed";
  readonly disposition: "failed" | "success";
  readonly handoff: Handoff;
  readonly operation: Operation;
  readonly payload: Payload;
}
