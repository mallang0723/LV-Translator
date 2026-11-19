export declare const COMMIT: string;
export declare const VENDOR: string;
export declare const PINS: Record<string, string>;
export declare const PATCHED: string[];
export declare function verify(root?: string): { problems: string[]; files: number; identical: number; patched: number; comparedWithGit: boolean };
