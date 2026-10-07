const SEPARATOR = /\.|::/;

export const segmentsOf = (name: string): string[] => name.split(SEPARATOR);

export const lastSegment = (name: string): string => segmentsOf(name).at(-1) ?? name;
