export interface Issue {
  rule: string | null;
  severity: string;
  message: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  url?: string | null;
}

export interface FileResult {
  file: string;
  issues: Issue[];
  error?: string;
}

export interface ScanResult {
  root: string;
  files: FileResult[];
  totalIssues: number;
  timedOut: boolean;
}
