export interface SaveData {
  id: string;
  empty?: boolean;
  slot: number;
  date: string;
  thumbnail?: string;
  textSnippet: string;
  route: string;
  fileName?: string;
  relativePath?: string;
  size?: number;
  format?: string;
  scriptId?: number;
  scriptName?: string;
  textEncoding?: string;
  recognized?: boolean;
  modifiedAt?: string;
  warnings?: string[];
}

export interface SaveOperationOptions {
  backup?: boolean;
  overwrite?: boolean;
  includeEmpty?: boolean;
}

export interface SaveOperationResult {
  saves: SaveData[];
  backups: string[];
}
