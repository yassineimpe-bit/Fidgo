/* eslint-disable @typescript-eslint/no-explicit-any -- GitHub REST shapes are intentionally duck-typed. */
export const LABELS: Readonly<Record<string, string>>;
export const PR_MARKER_PREFIX: string;
export function names(issue: any): string[];
export function isEligible(issue: any): boolean;
export function selectIssue(issues: any[]): any | null;
export function labelsAfterTransition(issue: any, from: string, to: string): string[];
export function prMarker(number: number): string;
export function matchingPullRequest(pulls: any[], number: number): any | null;
export function transition(api: any, issue: any, from: string, to: string): Promise<boolean>;
export function claimNext(api: any): Promise<any>;
export function reconcileIssue(api: any, issue: any, options?: { failed?: boolean; reason?: string }): Promise<any>;
export function createApi(options: { token: string; repository: string; fetchImpl?: typeof fetch }): any;
