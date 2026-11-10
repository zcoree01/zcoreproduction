import type { SupportStatus } from "@/modules/support/schemas";
import type { ProblemCategory, ProblemStatus } from "./schemas";

export type MyProblemReport = {
  id: string;
  category: ProblemCategory;
  status: ProblemStatus;
  description: string | null;
  pagePath: string | null;
  createdAt: string;
  lastMessageAt: string | null;
};

export type ReportMessage = {
  id: string;
  fromZcore: boolean;
  body: string;
  createdAt: string;
};

/** A support session Zcore proposed from a report. */
export type ReportSession = {
  id: string;
  reportId: string;
  status: SupportStatus;
  scheduledStart: string | null;
  durationMinutes: number | null;
  approvedUntil: string | null;
  reason: string;
  createdAt: string;
  decidedAt: string | null;
};

export type ReportThread = {
  messages: ReportMessage[];
  fileCount: number;
  sessions: ReportSession[];
};

/** Bell / dot candidate: a Zcore reply, or the decision on a proposed session. */
export type ReportNotice = {
  kind: "message" | "approved" | "rejected";
  key: string;
  reportId: string;
  detail: string;
  at: string;
};
