declare module "js-yaml" {
	export type YAMLException = Error & {
		mark?: {
			line: number;
			column: number;
		};
	};

	export function load(input: string): unknown;
	export function dump(input: unknown, options?: Record<string, unknown>): string;
}
