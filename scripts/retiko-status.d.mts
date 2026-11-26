export type ChecklistScope = "v1" | "post-v1";
export type ItemNature = "physical" | "decision" | "provider" | "legal" | "development";
export type ChecklistItem = { checked: boolean; text: string; nature: ItemNature };
export type ChecklistSection = {
  title: string;
  scope: ChecklistScope;
  items: ChecklistItem[];
  checked: number;
  total: number;
};

export type OrchestrationFamily = "phase" | "agent" | "auto" | "risk" | "state";
export type LabelClassification = Record<OrchestrationFamily, string[]> & { needsHuman: boolean };

export type CheckOutcome = "success" | "failure" | "pending" | "cancelled" | "neutral" | "skipped";
export type CheckSummary = {
  overall: "success" | "failure" | "pending" | "cancelled" | "none";
  total: number;
  counts: Record<CheckOutcome, number>;
  failing: string[];
  pending: string[];
  entries: { name: string; outcome: CheckOutcome; source: "check_run" | "status"; url: string | null }[];
};

export type GitHubCheckRun = {
  id?: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url?: string | null;
  check_suite?: { id: number } | null;
};
export type GitHubCheckSuite = { id: number; head_branch: string | null; latest_check_runs_count?: number };
export type GitHubCommitStatus = { context: string; state: string; target_url?: string | null; updated_at?: string };
export type GitHubLabel = string | { name?: string };

export type PullStatus =
  | "draft"
  | "not-analyzed"
  | "conflict"
  | "ci-failure"
  | "mergeability-unknown"
  | "ci-pending"
  | "ci-incomplete"
  | "behind"
  | "blocked"
  | "mergeable-no-checks"
  | "mergeable";

export type NormalizedIssue = {
  number: number;
  title: string;
  url: string | null;
  state: string;
  labels: string[];
  author: string | null;
  updatedAt: string | null;
  isPullRequest: boolean;
};

export type NormalizedPull = {
  number: number;
  title: string;
  url: string | null;
  draft: boolean;
  author: string | null;
  labels: string[];
  headSha: string | null;
  headRef: string | null;
  baseRef: string | null;
  updatedAt: string | null;
  mergeable: boolean | null;
  mergeableState: string | null;
  checks: CheckSummary | null;
  detailsCollected: boolean;
};

export type MergedPull = {
  number: number;
  title: string;
  url: string | null;
  mergedAt: string;
  mergeCommitSha: string | null;
  author: string | null;
};

export type StatusIssueRef = { number: number; state: string; url: string | null };

export type CollectedSnapshot = {
  repository: string;
  branch: { name: string; sha: string; message: string; committedAt: string | null; checks: CheckSummary };
  spec: { number: number; title: string; state: string; body: string; url: string | null };
  openIssues: NormalizedIssue[];
  openPulls: NormalizedPull[];
  recentlyMerged: MergedPull[];
  prDetailLimit: number;
};

export type StatusSnapshot = CollectedSnapshot & {
  serverUrl?: string;
  generatedAt: string | Date;
  runUrl?: string | null;
  statusIssue: StatusIssueRef | null;
  duplicateStatusIssues: number[];
};

export type StatusModel = {
  sections: ChecklistSection[];
  v1Sections: ChecklistSection[];
  postV1Sections: ChecklistSection[];
  gate: ChecklistSection | null;
  gateOpen: (ChecklistItem & { section: string })[];
  otherOpenHuman: (ChecklistItem & { section: string })[];
  issues: (NormalizedIssue & { orchestration: LabelClassification; citedBySpec: boolean; incident: boolean })[];
  pulls: (NormalizedPull & { orchestration: LabelClassification; status: PullStatus; dependency: boolean })[];
  orchestrated: ((NormalizedIssue | NormalizedPull) & { number: number; title: string; orchestration: LabelClassification; kind: "issue" | "pull" })[];
  human: string[];
  next: { group: string; items: string[] }[];
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type GitHubClient = {
  repository: string;
  repoPath: string;
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, payload: unknown): Promise<T>;
  patch<T = unknown>(path: string, payload: unknown): Promise<T>;
  paginate<T = unknown>(path: string, options?: {
    itemsKey?: string | null;
    maxPages?: number;
    stopAtLimit?: boolean;
    until?: ((items: T[], page: T[]) => boolean) | null;
  }): Promise<T[]>;
};

export declare const STATUS_ISSUE_TITLE: "RETIKO — ÉTAT COURANT";
export declare const STATUS_MARKER: "<!-- retiko-status:managed -->";
export declare const DEFAULT_SPEC_ISSUE: 88;
export declare const DEFAULT_BRANCH: "main";
export declare const STATUS_CHECK_NAME: "retiko-status";
export declare const MONITORING_INCIDENT_TITLE: string;
export declare const PR_DETAIL_LIMIT: number;
export declare const RECENT_MERGED_LIMIT: number;
export declare const BODY_BYTE_BUDGET: number;
export declare const ITEM_NATURES: Readonly<Record<ItemNature, Readonly<{ label: string; human: boolean }>>>;
export declare const ORCHESTRATION_FAMILIES: Readonly<Record<OrchestrationFamily, readonly string[]>>;
export declare const NEEDS_HUMAN_LABEL: "needs-human";
export declare const PULL_STATUSES: Readonly<Record<PullStatus, string>>;

export declare function escapeMarkdown(value: unknown): string;
export declare function formatUtc(value: string | Date | null | undefined): string;
export declare function fitBody(body: string, budget?: number): string;
export declare function classifyChecklistItem(text: string, sectionTitle?: string): ItemNature;
export declare function parseSpecChecklist(body: string | null | undefined): ChecklistSection[];
export declare function findGateSection(sections: ChecklistSection[]): ChecklistSection | null;
export declare function citesIssue(body: string | null | undefined, number: number): boolean;
export declare function classifyLabels(labels: GitHubLabel[] | null | undefined): LabelClassification;
export declare function hasOrchestration(classification: LabelClassification): boolean;
export declare function summarizeChecks(
  input?: { checkRuns?: GitHubCheckRun[]; statuses?: GitHubCommitStatus[] },
  options?: { exclude?: string[] },
): CheckSummary;
export declare function filterCheckRunsByBranch(checkRuns: GitHubCheckRun[], checkSuites: GitHubCheckSuite[], branch: string | null): GitHubCheckRun[];
export declare function classifyPullRequest(pull: Pick<NormalizedPull, "draft" | "detailsCollected" | "mergeable" | "mergeableState" | "checks">): PullStatus;
export declare function isDependencyPull(pull: { author: string | null }): boolean;
export declare function isStatusIssueCandidate(issue: Pick<NormalizedIssue, "number" | "title" | "isPullRequest">, specIssue?: number): boolean;
export declare function normalizeIssue(raw: Record<string, unknown>): NormalizedIssue;
export declare function normalizePull(raw: Record<string, unknown>): NormalizedPull;
export declare function selectRecentlyMerged(closedPulls: Record<string, unknown>[], limit?: number): MergedPull[];
export declare function nextPageUrl(linkHeader: string | null | undefined): string | null;

export declare class GitHubApiError extends Error {
  status: number;
  request: string;
  constructor(message: string, options?: { status?: number; request?: string });
}

export declare function createGitHubClient(options: {
  repository: string | undefined;
  token?: string | null;
  apiUrl?: string;
  fetchImpl?: FetchLike;
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): GitHubClient;

export declare function collectSnapshot(client: GitHubClient, options?: {
  specIssue?: number;
  branch?: string;
  prDetailLimit?: number;
  recentMergedLimit?: number;
  mergeabilityRetryMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<CollectedSnapshot>;

export declare function findStatusIssue(client: GitHubClient, openIssues: NormalizedIssue[], options?: { specIssue?: number }): Promise<{
  statusIssue: StatusIssueRef | null;
  duplicateStatusIssues: number[];
}>;

export declare function publishStatusReport(client: GitHubClient, options: {
  body: string;
  statusIssue: StatusIssueRef | null;
  specIssue?: number;
}): Promise<{ action: "created" | "updated" | "reopened"; number: number; url: string | null }>;

export declare function buildStatusModel(snapshot: StatusSnapshot): StatusModel;
export declare function renderStatusReport(snapshot: StatusSnapshot): string;

export declare function main(argv: string[], deps?: {
  env?: Record<string, string | undefined>;
  fetchImpl?: FetchLike;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  stdout?: { write(chunk: string): unknown };
  stderr?: { write(chunk: string): unknown };
}): Promise<number>;
