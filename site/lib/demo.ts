import data from '@/data/demo.json';

export type Tone = 'cmd' | 'dim' | 'file' | 'plain' | 'answer';

export interface Line {
  text: string;
  tone: Tone;
}

export interface Pane {
  tokens: number;
  foot: string;
  lines: Line[];
}

export interface Scenario {
  id: string;
  label: string;
  question: string;
  without: Pane;
  with: Pane;
}

export interface Demo {
  generated: string;
  version: string;
  scenarios: Scenario[];
}

export const demo = data as Demo;
