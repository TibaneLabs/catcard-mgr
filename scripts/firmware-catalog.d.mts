export declare const BOARDS: string[];
export declare function parseAssetName(name: string): { board: string; bitcoinOnly: boolean; games: boolean; version: string } | null;
export declare function parseSums(text: string): Map<string, string>;
export declare function fingerprint(releases: unknown[]): Promise<string>;
