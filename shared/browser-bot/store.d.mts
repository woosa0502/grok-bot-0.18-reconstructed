export function stable(value: unknown): string;
export function digest(value: unknown): string;
export function problem(code: string, message: string, statusCode?: number): Error & { code: string; statusCode: number };
export function id(value: unknown, name?: string): string;
export function boundedText(value: unknown, name?: string, max?: number): string;
export class Store {
 constructor(file: string, options?: { readonly?: boolean });
 transaction<T>(fn: () => T): T;
 get(bucket: string, key: string): any;
 put<T>(bucket: string, key: string, value: T): T;
 insert(bucket: string, key: string, value: unknown): boolean;
 remove(bucket: string, key: string): void;
 values(bucket: string): any[];
 event(key: string, bot: string, value: unknown): void;
 events(bot: string, after?: number, limit?: number): any[];
 close(): void;
}
